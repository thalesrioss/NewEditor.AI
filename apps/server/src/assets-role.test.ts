/**
 * BL-0100 (FEEDBACK-EDITOR-BRAIN 20/10): render do Motion Studio importado por `POST /assets` entrava como B-roll
 * (biblioteca mostrava "B-roll"). Agora o corpo aceita `role` (fala, broll, motion); papel inválido devolve 400.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-assets-role-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
const app = Fastify();
const motion = path.join(tmp, 'motion.mp4');
let projectId = '';

before(async () => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=90x160:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', motion]);
  const { store } = await import('./store.ts');
  await store.load();
  projectId = (await store.create('BL-0100', 'papel no import')).id;
  const { rotasProjetos } = await import('./routes/projetos.ts');
  await rotasProjetos(app);
});
after(async () => {
  await app.close();
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('POST /assets com papel (BL-0100)', () => {
  test('role motion entra como motion; role inválido devolve 400', async () => {
    const { store } = await import('./store.ts');
    const ruim = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/assets`, payload: { path: motion, role: 'cam' } });
    assert.equal(ruim.statusCode, 400);
    const ok = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/assets`, payload: { path: motion, role: 'motion' } });
    assert.equal(ok.statusCode, 200);
    for (let i = 0; i < 100 && !store.get(projectId).assets.length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(store.get(projectId).assets[0]?.role, 'motion');
    // Espera o import terminar (proxy e miniatura) antes de apagar a pasta temporária.
    const { isBusy } = await import('./jobs.ts');
    for (let i = 0; i < 200 && isBusy(projectId); i++) await new Promise((r) => setTimeout(r, 100));
  });
});
