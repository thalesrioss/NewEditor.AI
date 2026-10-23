/**
 * CH-0024 (NewStudios, Tomás): o render desenhava os overlays na ordem em que entraram na timeline, não por trilha.
 * Um B-roll (V2) adicionado depois de um motion de arquivo (V3, título fixo) saía por cima dele. Render de verdade:
 * fala vermelha, motion verde na V3 posto primeiro, B-roll azul na V2 posto depois no mesmo trecho; o quadro tem
 * que sair verde (V3 em cima). O preview usa a mesma ordem (`overlaysInDrawOrder`).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { overlaysInDrawOrder, type OverlayItem } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-ordem-trilhas-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const fala = path.join(tmp, 'fala.mp4');
const motion = path.join(tmp, 'motion.mp4');
const broll = path.join(tmp, 'broll.mp4');
let projectId = '';

before(async () => {
  ff(['-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=4', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);
  ff(['-f', 'lavfi', '-i', 'color=green:s=160x90:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', motion]);
  ff(['-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', broll]);
  const { store } = await import('./store.ts');
  await store.load();
  projectId = (await store.create('CH-0024', 'V3 acima de V2')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('ordem das trilhas de imagem (CH-0024)', () => {
  test('ordem de desenho: por trilha (V2 antes de V3), estável dentro da trilha', () => {
    const o = (id: string, trackId: string, role: OverlayItem['role']) => ({ id, trackId, role }) as OverlayItem;
    const ordem = overlaysInDrawOrder([o('t', 'V3', 'motion'), o('b1', 'V2', 'broll'), o('l', 'V3', 'lettering'), o('b2', 'V2', 'broll'), o('s', 'A2', 'sfx')]);
    assert.deepEqual(ordem.map((x) => x.id), ['s', 'b1', 'b2', 't', 'l']);
  });

  test('B-roll V2 posto depois do motion V3: no render o V3 continua por cima', async () => {
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const f = await ingest(projectId, fala, 'broll');
    const m = await ingest(projectId, motion, 'broll');
    const b = await ingest(projectId, broll, 'broll');
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: f.id, in: 0, out: 4, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: 30 } });
    // Título (motion de arquivo) na V3 no vídeo inteiro, posto PRIMEIRO; B-roll na V2 de 1 a 2 s, posto DEPOIS.
    store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId: 'V3', role: 'motion', anchor: { assetId: f.id, at: 0 }, duration: 4, source: { type: 'media', assetId: m.id, in: 0 } } } });
    store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId: 'V2', role: 'broll', anchor: { assetId: f.id, at: 1 }, duration: 1, source: { type: 'media', assetId: b.id, in: 0 } } } });
    const tl = store.get(projectId).timeline;
    assert.deepEqual(tl.overlays.map((o) => o.trackId), ['V3', 'V2'], 'a ordem de inserção é V3 e depois V2');
    const res = await render(store.get(projectId), store.dir(projectId));
    const out = path.join(store.dir(projectId), res.file);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'crop=2:2:44:79,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const px = (i: number) => ({ r: raw[i * 12]!, g: raw[i * 12 + 1]!, b: raw[i * 12 + 2]! });
    const verde = (i: number) => px(i).g > 90 && px(i).r < 80 && px(i).b < 80;
    // Quadro 45 (1,5 s, dentro do B-roll): o motion da V3 por cima, nunca o azul do B-roll.
    for (const i of [15, 45, 75]) assert.ok(verde(i), `quadro ${i} deveria ser o motion da V3: ${JSON.stringify(px(i))}`);
  });
});
