/**
 * CH-0008: B-rolls encostados (fim de um = início do outro) deixavam 1 quadro da fala aparecer entre eles no render
 * (v084, 29,97 fps: E06 35,584+1,001 = E07 36,585). Causa: o stream do overlay acabava um quadro antes da janela
 * `between(t, início, fim)` e o `eof_action=pass` mostrava a fala. Aqui: render de verdade (fala vermelha, B-roll azul)
 * com os tempos do chamado, conferindo quadro a quadro. Fixtures geradas pelo FFmpeg.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-ovq-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
// Import dinâmico: um import estático do render.ts carregaria o config.ts antes da linha acima e o projeto de teste
// iria para a pasta de dados real (na bancada, ferramentas/editor-brain/data, um "CH-0008" a cada instalação).
const { overlayFrames } = await import('./render.ts');

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const fala = path.join(tmp, 'fala.mp4');
const broll = path.join(tmp, 'broll.mp4');
const FPS = 29.97;
let projectId = '';

before(async () => {
  ff(['-f', 'lavfi', '-i', 'color=red:s=160x90:r=2997/100:d=39', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000', '-t', '39', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);
  ff(['-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30000/1001:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', broll]);
  const { store } = await import('./store.ts');
  await store.load();
  projectId = (await store.create('CH-0008', 'overlays encostados')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('overlays no grid de quadros (CH-0008)', () => {
  test('janelas encostadas dividem os quadros sem vão nem sobreposição', () => {
    const a = overlayFrames(35.584, 36.585, FPS);
    const b = overlayFrames(36.585, 37.885, FPS);
    assert.equal(a.f1, b.f0);
    assert.ok(a.f0 < a.f1);
    // Overlay mais curto que um quadro ainda ocupa um quadro.
    const c = overlayFrames(10, 10.01, FPS);
    assert.equal(c.f1 - c.f0, 1);
  });

  test('render: B-rolls encostados (tempos do v084) não deixam quadro da fala aparecer entre eles', async () => {
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const f = await ingest(projectId, fala, 'broll');
    const b = await ingest(projectId, broll, 'broll');
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: f.id, in: 0, out: 38.5, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: FPS } });
    const tl = store.get(projectId).timeline;
    const trackId = tl.tracks.find((t) => t.roles.includes('broll'))!.id;
    const add = (at: number, duration: number, inn: number) =>
      store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId, role: 'broll', anchor: { assetId: f.id, at }, duration, source: { type: 'media', assetId: b.id, in: inn } } } });
    add(35.584, 1.001, 1.1); // E06
    add(36.585, 1.3, 1.7); // E07, encostado
    add(37.885, 0.4, 0.2); // terceiro, encostado no E07
    const res = await render(store.get(projectId), store.dir(projectId));
    const out = path.join(store.dir(projectId), res.file);
    // Um pixel do centro de cada quadro: vermelho = fala aparecendo.
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'crop=2:2:44:79,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const n = raw.length / 12;
    const vermelhos: number[] = [];
    for (let i = 0; i < n; i++) if (raw[i * 12]! > 150 && raw[i * 12 + 2]! < 100) vermelhos.push(i);
    const f0 = overlayFrames(35.584, 1, FPS).f0;
    const f1 = overlayFrames(37.885, 38.285, FPS).f1;
    const dentro = vermelhos.filter((i) => i >= f0 && i < f1);
    assert.deepEqual(dentro, [], `fala aparecendo nos quadros ${dentro.join(', ')} (entre ${f0} e ${f1 - 1})`);
    // E a fala volta logo depois do último B-roll, e aparece antes do primeiro.
    assert.ok(vermelhos.includes(f1), `quadro ${f1} deveria ser fala`);
    assert.ok(vermelhos.includes(f0 - 1), `quadro ${f0 - 1} deveria ser fala`);
  });
});
