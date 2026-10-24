/**
 * CH-0035: com duas falas no projeto, o sync-cam alinhava toda 2ª câmera contra a primeira fala.
 * Envelopes sintéticos (dBFS a cada 10 ms): a câmera é a fala B atrasada 1,5 s.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { MediaAsset } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-multicam-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

let projectId = '';

/** Fala sintética: rajadas de 0,2–1 s com silêncio entre elas, sequência pseudoaleatória pela semente. */
function envelope(seed: number, seconds: number): Float32Array {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = new Float32Array(seconds * 100);
  let i = 0;
  while (i < out.length) {
    const on = 20 + Math.floor(rnd() * 80);
    const off = 10 + Math.floor(rnd() * 60);
    for (let k = 0; k < on && i < out.length; k++) out[i++] = -20 + rnd() * 6;
    for (let k = 0; k < off && i < out.length; k++) out[i++] = -70;
  }
  return out;
}
const delay = (e: Float32Array, s: number) => {
  const n = Math.round(s * 100);
  const out = new Float32Array(e.length + n).fill(-70);
  out.set(e, n);
  return out;
};

before(async () => {
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Teste multicâmera', 'CH-0035');
  projectId = p.id;
  const dir = store.dir(projectId);
  const a = envelope(7, 120);
  const b = envelope(99, 120);
  const cam = delay(b, 1.5);
  const add = (id: string, role: MediaAsset['role'], e: Float32Array) => {
    fs.writeFileSync(path.join(dir, `${id}.f32`), Buffer.from(e.buffer));
    store.upsertAsset(projectId, { id, name: id, path: `/tmp/${id}.mp4`, kind: 'video', duration: e.length / 100, hasAudio: true, role, envelope: `${id}.f32` });
  };
  add('C3029', 'fala', a);
  add('C3062', 'fala', b);
  add('CAM2', 'broll', cam);
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('sem fala no pedido: escolhe a fala que correlaciona (a 2ª), não a primeira do projeto', async () => {
  const { syncCamera } = await import('./multicam.ts');
  const { store } = await import('./store.ts');
  const r = await syncCamera(projectId, 'CAM2');
  assert.equal(r.fala, 'C3062');
  assert.ok(Math.abs(r.offset - 1.5) <= 0.02, `offset ${r.offset}`);
  const cam = store.get(projectId).assets.find((a) => a.id === 'CAM2')!;
  assert.equal(cam.role, 'cam');
  assert.equal(cam.syncFala, 'C3062');
});

test('fala de referência explícita e offset manual', async () => {
  const { syncCamera } = await import('./multicam.ts');
  const r = await syncCamera(projectId, 'CAM2', { fala: 'C3062' });
  assert.equal(r.fala, 'C3062');
  assert.ok(Math.abs(r.offset - 1.5) <= 0.02);
  const m = await syncCamera(projectId, 'CAM2', { fala: 'C3029', offset: 0 });
  assert.deepEqual([m.fala, m.offset, m.confianca], ['C3029', 0, 1]);
  await assert.rejects(syncCamera(projectId, 'CAM2', { offset: 0 }), /diga qual/);
  await assert.rejects(syncCamera(projectId, 'CAM2', { fala: 'nao-existe' }), /não existe/);
});

test('alternância automática só usa a câmera nos clipes da fala dela', async () => {
  const { syncCamera, autoMulticam } = await import('./multicam.ts');
  const { store } = await import('./store.ts');
  await syncCamera(projectId, 'CAM2', { fala: 'C3062' });
  const clips = ['C3029', 'C3062'].flatMap((assetId) => [0, 10, 20, 30].map((t) => ({ assetId, in: t, out: t + 8 })));
  store.apply(projectId, { by: 'system', op: { type: 'set_main', clips: clips.map((c, i) => ({ id: `k${i}`, ...c })), removals: [] } } as never);
  await autoMulticam(projectId);
  const main = store.get(projectId).timeline.main;
  assert.ok(main.some((c) => c.cam === 'CAM2'), 'alguma troca para a câmera 2');
  assert.ok(main.filter((c) => c.assetId === 'C3029').every((c) => !c.cam), 'clipe da C3029 com a câmera da C3062');
});
