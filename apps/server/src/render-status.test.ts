/**
 * BL-0103: render pela API com id de trabalho. A NewStudios esperava o MP4 parar de crescer para saber que o render
 * acabou; agora `POST /render` devolve `job` e `GET /render/:job` diz fila, rodando (pct), pronto (arquivo e
 * loudness) ou erro. Render de verdade, curto e sintético (seno, não silêncio: ver FB-0165).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-render-status-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const app = Fastify();
const fala = path.join(tmp, 'fala.mp4');
let projectId = '';
let vazioId = '';

before(async () => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);
  const { store } = await import('./store.ts');
  const { ingest } = await import('./ingest.ts');
  const { registerJob } = await import('./jobs.ts');
  const { renderJob, rotasRender } = await import('./routes/render.ts');
  await store.load();
  registerJob('render', (id, _payload, job) => renderJob(id, job.id));
  await rotasRender(app);
  projectId = (await store.create('BL-0103', 'status do render')).id;
  const assetId = (await ingest(projectId, fala, 'broll')).id;
  store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId, in: 0, out: 2, by: 'human' }] } });
  store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: 30 } });
  vazioId = (await store.create('BL-0103 vazio', 'timeline vazia')).id;
});
after(async () => {
  await app.close();
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Status = { job: string; estado: string; pct?: number; file?: string; caminho?: string; bytes?: number; lufs?: number; truePeak?: number; mensagem?: string };

async function acompanhar(id: string, job: string): Promise<{ vistos: string[]; fim: Status }> {
  const vistos: string[] = [];
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    const r = await app.inject({ method: 'GET', url: `/api/projects/${id}/render/${job}` });
    assert.equal(r.statusCode, 200);
    const s = r.json() as Status;
    if (vistos.at(-1) !== s.estado) vistos.push(s.estado);
    if (s.estado === 'pronto' || s.estado === 'erro') return { vistos, fim: s };
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error(`render ${job} não terminou: ${vistos.join(' → ')}`);
}

describe('status do render pela API (BL-0103)', () => {
  test('POST devolve o job; o status passa por rodando e termina pronto com o arquivo e a medida', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/render` });
    assert.equal(r.statusCode, 200);
    const body = r.json() as { job: string; queued: boolean; posicao?: number };
    assert.match(body.job, /^rnd_/);
    assert.equal(body.queued, true);
    const { vistos, fim } = await acompanhar(projectId, body.job);
    assert.ok(vistos.includes('rodando'), `deveria passar por rodando (${vistos.join(' → ')})`);
    assert.equal(fim.estado, 'pronto', fim.mensagem);
    assert.match(fim.file!, /^renders\/.+\.mp4$/);
    assert.ok(fs.existsSync(fim.caminho!), 'arquivo do render deveria existir');
    assert.equal(fim.bytes, fs.statSync(fim.caminho!).size, 'pronto só com o arquivo inteiro no disco');
    assert.ok(Number.isFinite(fim.lufs) && Math.abs(fim.lufs! + 14) <= 1, `loudness perto de −14 (${fim.lufs})`);
    assert.ok(Number.isFinite(fim.truePeak) && fim.truePeak! <= -1, `pico ≤ −1 dBTP (${fim.truePeak})`);
  });

  test('render que falha vem como erro com a mensagem', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/projects/${vazioId}/render` });
    const { fim } = await acompanhar(vazioId, (r.json() as { job: string }).job);
    assert.equal(fim.estado, 'erro');
    assert.match(fim.mensagem!, /timeline vazia/);
  });

  test('job inexistente, ou de outro projeto, é 404', async () => {
    assert.equal((await app.inject({ method: 'GET', url: `/api/projects/${projectId}/render/rnd_nao_existe` })).statusCode, 404);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${vazioId}/render` });
    const job = (r.json() as { job: string }).job;
    assert.equal((await app.inject({ method: 'GET', url: `/api/projects/${projectId}/render/${job}` })).statusCode, 404);
    await acompanhar(vazioId, job);
  });
});
