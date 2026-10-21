/**
 * CH-0014: render de verdade da legenda (camada de texto do Chrome). Fala vermelha, B-roll azul na entrada do 2º clipe,
 * legenda verde (texto e tarja). Confere: (1) a legenda com altura própria sai na altura dela, a outra na global;
 * (2) no 1º quadro do clipe, com o B-roll, a legenda do clipe anterior não aparece por cima.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-leg-trecho-'));
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
  projectId = (await store.create('CH-0014', 'legenda por trecho')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('legenda por trecho e no corte com B-roll (CH-0014)', () => {
  test('altura própria no render e nenhum quadro da legenda anterior sobre o B-roll', async () => {
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const f = await ingest(projectId, fala, 'broll');
    const b = await ingest(projectId, broll, 'broll');
    // Transcrição: "Olá." no 1º clipe, "mudar tudo." até perto do corte, e a 1ª palavra do 2º clipe 2 quadros depois dele.
    const words = [
      { w: 'Olá.', start: 0.1, end: 0.4 },
      { w: 'mudar', start: 0.8, end: 1.2 },
      { w: 'tudo.', start: 1.6, end: 1.95 },
      { w: 'Existe', start: 2.56, end: 2.9 },
      { w: 'um', start: 3.0, end: 3.2 },
    ];
    fs.mkdirSync(path.join(store.dir(projectId), f.id), { recursive: true });
    fs.writeFileSync(path.join(store.dir(projectId), f.id, 'transcript.json'), JSON.stringify({ words }));
    store.upsertAsset(projectId, { ...store.get(projectId).assets.find((a) => a.id === f.id)!, transcript: `${f.id}/transcript.json` });
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: f.id, in: 0, out: 2, by: 'human' }, { id: 'c2', assetId: f.id, in: 2.5, out: 4.5, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: 30 } });
    store.apply(projectId, { by: 'human', op: { type: 'set_captions', captions: { enabled: true, style: 'reels', uppercase: false, highlight: false, position: 0.5, size: 8, color: '#00ff00', box: true, boxColor: '#00ff00', boxOpacity: 1, shadow: 0 } } });
    const trackId = store.get(projectId).timeline.tracks.find((t) => t.roles.includes('broll'))!.id;
    store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId, role: 'broll', anchor: { assetId: f.id, at: 2.5 }, duration: 1, source: { type: 'media', assetId: b.id, in: 0 } } } });
    // "Olá." sobe para 25% da altura só ela.
    store.apply(projectId, { by: 'human', op: { type: 'edit_captions', edits: [{ assetId: f.id, at: 0.1, patch: { position: 0.25 } }] } });
    const res = await render(store.get(projectId), store.dir(projectId));
    const out = path.join(store.dir(projectId), res.file);
    const col = (y: number) => {
      const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `crop=2:2:44:${y},format=rgb24`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
      return (i: number) => ({ r: raw[i * 12]!, g: raw[i * 12 + 1]!, b: raw[i * 12 + 2]! });
    };
    const meio = col(79), alto = col(39);
    const verde = (p: { r: number; g: number; b: number }) => p.g > 150 && p.r < 100 && p.b < 100;
    // t = 0,2 s (quadro 6): "Olá." no alto, nada no meio.
    assert.ok(verde(alto(6)), `quadro 6, 25% da altura deveria ter a legenda: ${JSON.stringify(alto(6))}`);
    assert.ok(!verde(meio(6)), `quadro 6, meio deveria estar sem legenda: ${JSON.stringify(meio(6))}`);
    // t = 1,0 s (quadro 30): "mudar tudo." na altura global (meio).
    assert.ok(verde(meio(30)), `quadro 30, meio deveria ter a legenda: ${JSON.stringify(meio(30))}`);
    // Quadros 60 e 61 (entrada do 2º clipe, B-roll): azul, sem a legenda do clipe anterior.
    for (const i of [60, 61]) assert.ok(meio(i).b > 150 && meio(i).g < 100, `quadro ${i} deveria ser o B-roll sem legenda: ${JSON.stringify(meio(i))}`);
    assert.ok(verde(meio(58)), 'quadro 58 (antes do corte) ainda tem a legenda');
  });
});
