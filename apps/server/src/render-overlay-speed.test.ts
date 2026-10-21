/**
 * CH-0004: o tempo do B-roll no export (velocidade e congelamento), rodado no FFmpeg de verdade.
 * Fonte de 1,5 s: 0,75 s vermelho e 0,75 s azul. A cor em cada instante diz qual trecho da fonte saiu.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { OverlayItem } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-ovspeed-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
const src = path.join(tmp, 'src.mp4');
const { overlayTiming } = await import('./render.ts');

before(() => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=64x64:rate=30:d=0.75', '-f', 'lavfi', '-i', 'color=c=blue:size=64x64:rate=30:d=0.75', '-filter_complex', '[0][1]concat=n=2:v=1', '-pix_fmt', 'yuv420p', src]);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const item = (p: Partial<OverlayItem>): OverlayItem => ({ id: 'b', trackId: 'V2', role: 'broll', anchor: { assetId: 'a', at: 0 }, duration: 2.62, source: { type: 'media', assetId: 'br', in: 0 }, by: 'human', ...p });

/** Quadros do overlay (64×64 rgb24) como sai do filtro, a 30 fps, com início em 0. */
function quadros(o: OverlayItem): ('r' | 'b')[] {
  const vf = `${overlayTiming(o, 0, 0, o.duration)},fps=30,format=rgb24`;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vf', vf, '-f', 'rawvideo', '-']);
  const n = 64 * 64 * 3;
  const out: ('r' | 'b')[] = [];
  for (let i = 0; i + n <= buf.length; i += n) out.push(buf[i + 32 * 64 * 3 + 32 * 3]! > buf[i + 32 * 64 * 3 + 32 * 3 + 2]! ? 'r' : 'b');
  return out;
}
const at = (q: ('r' | 'b')[], t: number) => q[Math.floor(t * 30)];

test('sem velocidade a fonte de 1,5 s acaba antes do evento de 2,62 s (o problema)', () => {
  assert.ok(quadros(item({})).length <= 46);
});

test('velocidade 1,5/2,62: cobre o evento inteiro, vermelho até a metade e azul depois', () => {
  const q = quadros(item({ speed: 1.5 / 2.62 }));
  assert.ok(q.length >= Math.floor(2.62 * 30), `${q.length} quadros`);
  assert.equal(at(q, 1.0), 'r');
  assert.equal(at(q, 2.0), 'b');
  assert.equal(at(q, 2.6), 'b');
});

test('congelar 2 s: anda 0,62 s (vermelho) e fica parado no vermelho até o fim', () => {
  const q = quadros(item({ freeze: 2 }));
  assert.ok(q.length >= Math.floor(2.62 * 30), `${q.length} quadros`);
  assert.equal(at(q, 0.3), 'r');
  assert.equal(at(q, 2.5), 'r');
});
