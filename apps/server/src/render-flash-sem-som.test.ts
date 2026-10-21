/**
 * CH-0010: o set_flash sempre somava o obturador sintetizado no bus do A2, e a editora não conseguia ter o flash
 * visual com a amostra dela (Camera Shutter_01 do CinePRO) no lugar. Com `sfx: false` o flash fica só visual.
 * Render de verdade: fala muda (vermelha), flash na entrada do 2º clipe; mede o áudio em volta do flash.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-flash-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const fala = path.join(tmp, 'fala.mp4');
let projectId = '';
let assetId = '';

before(async () => {
  ff(['-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=5', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);
  const { store } = await import('./store.ts');
  const { ingest } = await import('./ingest.ts');
  await store.load();
  projectId = (await store.create('CH-0010', 'flash sem som')).id;
  assetId = (await ingest(projectId, fala, 'broll')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Pico (dBFS) do áudio do render entre 1,9 e 2,4 s, e se o quadro do flash (t = 2 s) saiu sem o vermelho da fala. */
async function renderFlash(sfx: boolean | undefined) {
  const { store } = await import('./store.ts');
  const { render } = await import('./render.ts');
  store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId, in: 0, out: 2, by: 'human' }, { id: 'c2', assetId, in: 2.5, out: 4.5, by: 'human' }] } });
  store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: 30 } });
  store.apply(projectId, { by: 'human', op: { type: 'set_flash', clipId: 'c2', on: true, sfx } });
  const res = await render(store.get(projectId), store.dir(projectId));
  const out = path.join(store.dir(projectId), res.file);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1.9', '-t', '0.5', '-i', out, '-vn', '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
  let peak = 0;
  for (let i = 0; i + 4 <= pcm.length; i += 4) peak = Math.max(peak, Math.abs(pcm.readFloatLE(i)));
  const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', '2.0', '-i', out, '-frames:v', '1', '-vf', 'crop=2:2:44:79,format=rgb24', '-f', 'rawvideo', '-']);
  return { db: peak > 0 ? 20 * Math.log10(peak) : -Infinity, vermelho: px[0]! > 150 && px[2]! < 100 };
}

describe('flash sem obturador (CH-0010)', () => {
  test('padrão: o flash leva o obturador sintetizado', async () => {
    const r = await renderFlash(undefined);
    assert.ok(r.db > -40, `obturador deveria soar perto do flash (pico ${r.db.toFixed(1)} dBFS)`);
    assert.equal(r.vermelho, false, 'quadro do flash deveria sair invertido');
  });
  test('sfx: false: o flash continua na imagem e o áudio fica mudo', async () => {
    const r = await renderFlash(false);
    assert.ok(r.db < -60, `não deveria ter obturador (pico ${r.db.toFixed(1)} dBFS)`);
    assert.equal(r.vermelho, false, 'quadro do flash deveria sair invertido');
  });
});
