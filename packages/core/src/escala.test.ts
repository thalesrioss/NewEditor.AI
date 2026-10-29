import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipScale, escalaAviso, overlayScale } from './escala.ts';

const tl = { width: 1080, height: 1920 };

test('4K deitado recortado em 9:16 (reframe): 1215 px de largura, zoom 1,5 amplia 1,33× (FB-0180 A3)', () => {
  const s = clipScale({ width: 3840, height: 2160 }, { zoom: 1.5, framing: { x: 0.5 } }, { ...tl, reframe: true })!;
  assert.ok(Math.abs(s - (1920 / 2160) * 1.5) < 1e-9);
  assert.match(escalaAviso(s, 'Zoom')!, /gate técnico reprova/);
});

test('4K em pé (2160×3840): zoom 2,3 ainda é 1,15× e só avisa; zoom 1,8 não amplia', () => {
  assert.ok(Math.abs(clipScale({ width: 2160, height: 3840 }, { zoom: 2.3 }, tl)! - 1.15) < 1e-9);
  assert.doesNotMatch(escalaAviso(1.15, 'Zoom')!, /reprova/);
  assert.equal(escalaAviso(clipScale({ width: 2160, height: 3840 }, { zoom: 1.8 }, tl), 'Zoom'), null);
});

test('zoom animado conta o maior; B-roll 1080 com zoom 1,5 amplia 1,5×', () => {
  assert.ok(Math.abs(clipScale({ width: 2160, height: 3840 }, { zoom: 1.2, zoomTo: 3 }, tl)! - 1.5) < 1e-9);
  assert.ok(Math.abs(overlayScale({ width: 1080, height: 1920 }, { zoom: 1.5 }, tl)! - 1.5) < 1e-9);
});
