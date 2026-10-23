/**
 * CH-0011: o set_flash invertia só a faixa principal (negate antes das camadas). Com B-roll de tela cheia no 1º quadro
 * do clipe, o flash sumia (T12 do v454). Render de verdade: fala vermelha, B-roll azul cobrindo a entrada do 2º clipe
 * com flash; o quadro do flash tem que sair invertido e sem cor, e o B-roll volta logo depois.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-flash-cam-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const fala = path.join(tmp, 'fala.mp4');
const broll = path.join(tmp, 'broll.mp4');
let projectId = '';

before(async () => {
  ff(['-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=5', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);
  ff(['-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', broll]);
  const { store } = await import('./store.ts');
  await store.load();
  projectId = (await store.create('CH-0011', 'flash sobre B-roll')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('flash sobre as camadas de vídeo (CH-0011)', () => {
  test('B-roll de tela cheia na entrada do clipe: o flash aparece por cima dele', async () => {
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const f = await ingest(projectId, fala, 'broll');
    const b = await ingest(projectId, broll, 'broll');
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: f.id, in: 0, out: 2, by: 'human' }, { id: 'c2', assetId: f.id, in: 2.5, out: 4.5, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: 30 } });
    const trackId = store.get(projectId).timeline.tracks.find((t) => t.roles.includes('broll'))!.id;
    // B-roll ancorado na entrada do 2º clipe (fonte 2,5 s = timeline 2,0 s), 1 s de duração.
    store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId, role: 'broll', anchor: { assetId: f.id, at: 2.5 }, duration: 1, source: { type: 'media', assetId: b.id, in: 0 } } } });
    store.apply(projectId, { by: 'human', op: { type: 'set_flash', clipId: 'c2', on: true, sfx: false } });
    const res = await render(store.get(projectId), store.dir(projectId));
    const out = path.join(store.dir(projectId), res.file);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'crop=2:2:44:79,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const px = (i: number) => ({ r: raw[i * 12]!, g: raw[i * 12 + 1]!, b: raw[i * 12 + 2]! });
    const azul = (i: number) => px(i).b > 150 && px(i).r < 100;
    // Quadros 60 e 61 (t = 2,0 s, 2 quadros): flash = azul invertido e sem cor (cinza), nunca o azul do B-roll.
    for (const i of [60, 61]) {
      const p = px(i);
      assert.ok(!azul(i), `quadro ${i} saiu azul (B-roll sem flash): ${JSON.stringify(p)}`);
      assert.ok(Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) < 40, `quadro ${i} deveria sair sem cor: ${JSON.stringify(p)}`);
    }
    // Antes do flash, a fala; depois dele, o B-roll de volta.
    assert.ok(px(58).r > 150 && px(58).b < 100, 'quadro 58 deveria ser a fala');
    assert.ok(azul(63), `quadro 63 deveria ser o B-roll: ${JSON.stringify(px(63))}`);
  });
});
