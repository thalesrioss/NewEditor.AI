import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { Clip } from '@neweditor/core';
import { segmentVideoFilter } from './render.ts';

const clip = (extra: Partial<Clip> = {}): Clip => ({ id: 'c', assetId: 'a', in: 0, out: 2, by: 'agent', ...extra });
const src = { width: 1080, height: 1920 };

test('rampa de enquadramento liga o zoompan com a âncora animada, mesmo com zoom fixo (CH-0036)', () => {
  const vf = segmentVideoFilter(src, clip({ zoom: 1.5, framing: { y: 0.36 }, framingTo: { y: 0, start: 0.3, dur: 0.7, ease: 'linear' } }), 30, 1080, 1920);
  assert.match(vf, /zoompan=z='1\.5\+\(0\.0000\)/);
  assert.match(vf, /y='\(ih-ih\/zoom\)\*\(0\.3600\+\(-0\.3600\)\*min\(1\\,max\(0\\,\(on-9\.000\)\/21\.000\)\)\)'/);
  // x sem rampa continua fixo; sem framingTo nada muda (crop do zoom fixo).
  assert.match(vf, /x='\(iw-iw\/zoom\)\*0\.5000'/);
  assert.match(segmentVideoFilter(src, clip({ zoom: 1.5, framing: { y: 0.36 } }), 30, 1080, 1920), /^crop=iw\/1\.5:/);
  // Ease-out é o padrão.
  assert.match(segmentVideoFilter(src, clip({ zoom: 1.5, framingTo: { x: 0.2 } }), 30, 1080, 1920), /x='\(iw-iw\/zoom\)\*\(0\.5000\+\(-0\.3000\)\*\(1-pow\(1-min/);
});

/** Linha mais clara (0–1, coluna do meio) de cada quadro pedido do trecho. */
function brightestRows(vf: string, frames: number[]): number[] {
  // "Cabeça" (faixa branca de 4 px) que sobe na fonte de y 0,36 a 0,24 entre 0,3 s e 1,0 s: o fim do tilt da câmera.
  const y = "if(lt(t\\,0.3)\\,689\\,if(gt(t\\,1.0)\\,459\\,689-230*(t-0.3)/0.7))";
  const last = Math.max(...frames) + 1;
  const fonte = `color=black:s=1080x1920:d=2:r=30[f];color=white:s=1080x4:d=2:r=30[c];[f][c]overlay=x=0:y='${y}'`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', fonte, '-vf', `${vf},crop=1:ih:540:0,format=gray`, '-frames:v', String(last), '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, String(r.stderr));
  const px = r.stdout as Buffer;
  return frames.map((n) => {
    const col = px.subarray(n * 1920, (n + 1) * 1920);
    let best = 0;
    for (let i = 1; i < col.length; i++) if (col[i]! > col[best]!) best = i;
    return best / 1920;
  });
}

test('no ffmpeg, a rampa de y segura a cabeça no lugar enquanto ela sobe na fonte; sem rampa ela sobe 0,18 da tela (CH-0036)', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  // Zoom 1,5: a âncora que deixa a cabeça (fonte s) em 0,36 da tela é (s − 0,36/1,5) / (1 − 1/1,5): 0,36 → 0.
  const frames = [0, 15, 24, 30, 45];
  const com = brightestRows(segmentVideoFilter(src, clip({ zoom: 1.5, framing: { y: 0.36 }, framingTo: { y: 0, start: 0.3, dur: 0.7, ease: 'linear' } }), 30, 1080, 1920), frames);
  const sem = brightestRows(segmentVideoFilter(src, clip({ zoom: 1.5, framing: { y: 0.36 } }), 30, 1080, 1920), frames);
  for (const [i, v] of com.entries()) assert.ok(Math.abs(v - 0.36) <= 0.006, `com rampa, quadro ${frames[i]}: ${v}`);
  assert.ok(Math.abs(sem[0]! - 0.36) <= 0.006 && Math.abs(sem[4]! - 0.18) <= 0.006, `sem rampa: ${sem.join(', ')}`);
});
