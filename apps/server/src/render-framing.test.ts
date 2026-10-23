/**
 * CH-0003: o filtro do export com o enquadramento do B-roll, rodado no FFmpeg de verdade.
 * Fonte 16:9 com a metade esquerda vermelha e a direita azul; quadro 9:16. O centro do recorte decide a cor.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-framing-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
const src = path.join(tmp, 'src.mp4');

const { coverFilter } = await import('./render.ts');

before(() => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=960x1080:rate=30', '-f', 'lavfi', '-i', 'color=c=blue:size=960x1080:rate=30', '-filter_complex', '[0][1]hstack', '-t', '0.2', '-pix_fmt', 'yuv420p', src]);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Cor média (r, g, b) do quadro 108×192 que o filtro gera. */
function cor(framing?: { x?: number; y?: number; zoom?: number }): [number, number, number] {
  const vf = `${coverFilter({ width: 1920, height: 1080 }, 108, 192, framing)},format=rgb24`;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-']);
  assert.equal(buf.length, 108 * 192 * 3);
  const s = [0, 0, 0];
  for (let i = 0; i < buf.length; i += 3) for (let k = 0; k < 3; k++) s[k]! += buf[i + k]!;
  return s.map((v) => v / (108 * 192)) as [number, number, number];
}

test('sem enquadramento: recorte central (metade vermelho, metade azul)', () => {
  const [r, , b] = cor();
  assert.ok(r > 80 && b > 80, `r ${r} b ${b}`);
});

test('x = 0 pega só a esquerda (vermelho) e x = 1 só a direita (azul)', () => {
  const [r0, , b0] = cor({ x: 0 });
  assert.ok(r0 > 200 && b0 < 40, `esquerda r ${r0} b ${b0}`);
  const [r1, , b1] = cor({ x: 1 });
  assert.ok(b1 > 200 && r1 < 40, `direita r ${r1} b ${b1}`);
});

test('zoom 2 no centro da metade direita continua só azul e na resolução do quadro', () => {
  const [r, , b] = cor({ x: 0.75, zoom: 2 });
  assert.ok(b > 200 && r < 40, `r ${r} b ${b}`);
});
