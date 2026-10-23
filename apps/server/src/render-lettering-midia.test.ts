/**
 * BL-0100 (candidato da Lia, 21/10 rodada 8): overlay com papel `lettering` e fonte de mídia (PNG ou ProRes com alfa do
 * template do cliente) sumia no render: o export só compunha mídia de `broll` e `motion`, e a legenda ainda saía
 * escondida embaixo dele. Render de verdade: fala vermelha, lettering azul de 1 s na V3; o quadro tem que sair azul.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-lettering-midia-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const fala = path.join(tmp, 'fala.mp4');
const letreiro = path.join(tmp, 'letreiro.mp4');
let projectId = '';

before(async () => {
  ff(['-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=3', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);
  ff(['-f', 'lavfi', '-i', 'color=blue:s=90x160:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', letreiro]);
  const { store } = await import('./store.ts');
  await store.load();
  projectId = (await store.create('BL-0100', 'lettering de mídia')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('lettering com fonte de mídia no export (BL-0100)', () => {
  test('o arquivo do lettering entra no render no tempo dele', async () => {
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const f = await ingest(projectId, fala, 'broll');
    const l = await ingest(projectId, letreiro, 'broll');
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: f.id, in: 0, out: 3, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: 30 } });
    store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId: 'V3', role: 'lettering', anchor: { assetId: f.id, at: 1 }, duration: 1, source: { type: 'media', assetId: l.id, in: 0 } } } });
    const res = await render(store.get(projectId), store.dir(projectId));
    const out = path.join(store.dir(projectId), res.file);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'crop=2:2:44:79,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const px = (i: number) => ({ r: raw[i * 12]!, g: raw[i * 12 + 1]!, b: raw[i * 12 + 2]! });
    const azul = (i: number) => px(i).b > 150 && px(i).r < 100;
    const vermelho = (i: number) => px(i).r > 150 && px(i).b < 100;
    assert.ok(vermelho(15), `quadro 15 deveria ser a fala: ${JSON.stringify(px(15))}`);
    for (const i of [31, 45, 58]) assert.ok(azul(i), `quadro ${i} deveria mostrar o lettering: ${JSON.stringify(px(i))}`);
    assert.ok(vermelho(75), `quadro 75 deveria voltar à fala: ${JSON.stringify(px(75))}`);
  });
});
