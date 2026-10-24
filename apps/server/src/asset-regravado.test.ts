/**
 * CH-0031 (NewStudios, Pedro): intermediário ProRes regravado no mesmo caminho (46,0 → 46,4 s) ficou com a
 * duração antiga; registrado com nome novo, a transcrição mandada logo depois do registro sumiu (o fim do proxy
 * regravava o asset sem `transcript`) e o render saiu sem legenda, sem aviso. Aqui: o mesmo caminho é medido de
 * novo no mesmo asset, a transcrição importada no meio da preparação fica (B-roll e fala com ASR falso) e a
 * legenda ligada sem palavras vira aviso.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { Project } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-regravado-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const { store } = await import('./store.ts');
const { ingest } = await import('./ingest.ts');
const { importTranscript } = await import('./transcript-import.ts');
const { captionsWithoutWords } = await import('./legenda-vazia.ts');
await store.load();

const video = (file: string, seconds: number) =>
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=30000/1001', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);

/** Espera o asset do caminho aparecer no projeto (o registro é síncrono; a preparação segue). */
async function assetOf(pid: string, file: string) {
  for (let i = 0; i < 200; i++) {
    const a = store.get(pid).assets.find((x) => x.path === file);
    if (a) return a;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('asset não apareceu');
}

after(async () => {
  await store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('arquivo regravado no mesmo caminho: mesmo asset, duração nova, proxy refeito', async () => {
  const pid = (await store.create('CH-0031 regravado', '')).id;
  const file = path.join(tmp, 'inter.mp4');
  video(file, 2);
  const a1 = await ingest(pid, file, 'broll');
  assert.ok(Math.abs(a1.duration - 2) < 0.1);
  store.apply(pid, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: a1.id, in: 0, out: a1.duration, by: 'human' }], removals: [] } });
  fs.utimesSync(file, new Date(), new Date(Date.now() - 60_000)); // mtime antigo de propósito
  const old = store.get(pid).assets[0]!.file!;
  video(file, 3);
  const a2 = await ingest(pid, file, 'broll');
  const assets = store.get(pid).assets;
  assert.equal(assets.length, 1, 'não duplica o asset');
  assert.equal(a2.id, a1.id, 'os clipes continuam apontando para o mesmo asset');
  assert.ok(Math.abs(assets[0]!.duration - 3) < 0.1, `duração ${assets[0]!.duration}`);
  assert.notDeepEqual(assets[0]!.file, old);
  assert.ok(assets[0]!.proxy);
  // Registrar de novo sem mudar: nada muda.
  const a3 = await ingest(pid, file, 'broll');
  assert.equal(a3.id, a1.id);
  assert.equal(store.get(pid).assets.length, 1);
});

test('transcrição importada logo depois do registro (B-roll, proxy ainda rodando) não some', async () => {
  const pid = (await store.create('CH-0031 transcricao', '')).id;
  const file = path.join(tmp, 'cob4.mp4');
  video(file, 3);
  const job = ingest(pid, file, 'broll');
  const a = await assetOf(pid, file);
  assert.equal(a.proxy, undefined, 'a importação tem que chegar antes do fim do proxy');
  await importTranscript(pid, a.id, { words: [{ w: 'controla.', start: 0.5, end: 1.0 }] });
  await job;
  const cur = store.get(pid).assets.find((x) => x.id === a.id)!;
  assert.ok(cur.proxy);
  assert.equal(cur.transcript, `${a.id}/transcript.json`);
});

test('fala: ASR que termina depois da importação não sobrescreve a transcrição importada', async () => {
  const pid = (await store.create('CH-0031 asr', '')).id;
  const file = path.join(tmp, 'fala.mp4');
  video(file, 3);
  // uv falso: demora e escreve uma transcrição "do ASR" no arquivo pedido (9º argumento).
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'uv'), `#!/bin/sh\nsleep 1.5\necho '{"language":"pt","duration":3,"model":"falso","words":[{"w":"asr","start":0.1,"end":0.4}],"segments":[]}' > "$9"\n`, { mode: 0o755 });
  const path0 = process.env.PATH;
  process.env.PATH = `${bin}:${path0}`;
  try {
    const job = ingest(pid, file, 'fala');
    const a = await assetOf(pid, file);
    await importTranscript(pid, a.id, { words: [{ w: 'conferida', start: 0.5, end: 1.0 }] });
    await job;
    const dir = path.join(store.dir(pid), a.id);
    const tr = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8'));
    assert.equal(tr.words[0].w, 'conferida');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'transcript.asr-original.json'), 'utf8')).words[0].w, 'asr');
    assert.equal(store.get(pid).assets.find((x) => x.id === a.id)!.transcript, `${a.id}/transcript.json`);
  } finally {
    process.env.PATH = path0;
  }
});

test('legenda ligada sem nenhuma palavra: aviso com o arquivo sem transcrição', () => {
  const p = {
    id: 'p',
    assets: [{ id: 'a', name: 'C3036_B_62s4_cob4.mov', path: '/x', kind: 'video', duration: 46.4, hasAudio: true }],
    timeline: { main: [{ id: 'c', assetId: 'a', in: 0, out: 46.28, by: 'human' }], captions: { enabled: true } },
  } as unknown as Project;
  assert.match(captionsWithoutWords(p, 0) ?? '', /sem transcrição: C3036_B_62s4_cob4\.mov/);
  assert.equal(captionsWithoutWords(p, 12), null);
  assert.equal(captionsWithoutWords({ ...p, timeline: { ...p.timeline, captions: { enabled: false } } } as unknown as Project, 0), null);
});
