/**
 * CH-0003 (NewStudios): B-roll 16:9 na V2 de timeline 9:16 saía com recorte central fixo (pegava tarja preta,
 * ombro do entrevistador e crédito). Agora o overlay tem centro (x, y) e zoom, com a mesma conta no export e no preview.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, coverCrop, OpError } from './timeline.ts';
import { DEFAULT_TRACKS, type Timeline } from './types.ts';

const tl = (): Timeline => ({
  fps: 30,
  width: 1080,
  height: 1920,
  main: [{ id: 'c1', assetId: 'a', in: 0, out: 10, by: 'system' }],
  removals: [],
  pins: [],
  tracks: DEFAULT_TRACKS,
  overlays: [
    { id: 'b1', trackId: 'V2', role: 'broll', anchor: { assetId: 'a', at: 1 }, duration: 2.6, source: { type: 'media', assetId: 'br', in: 0 }, by: 'human' },
    { id: 't1', trackId: 'V3', role: 'lettering', anchor: { assetId: 'a', at: 1 }, duration: 1, source: { type: 'text', text: 'oi' }, by: 'human' },
  ],
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-4, `${a} ≠ ${b}`);

test('coverCrop sem enquadramento = recorte central de antes (16:9 em 9:16)', () => {
  const c = coverCrop(1920, 1080, 1080, 1920);
  near(c.kx, (9 / 16) / (16 / 9));
  near(c.ky, 1);
  near(c.u0, 0.5 - c.kx / 2);
  near(c.v0, 0);
});

test('coverCrop: centro à esquerda encosta na borda; zoom 2 corta metade e libera o vertical', () => {
  const esq = coverCrop(1920, 1080, 1080, 1920, { x: 0 });
  near(esq.u0, 0);
  const z = coverCrop(1920, 1080, 1080, 1920, { x: 0.7, y: 0.25, zoom: 2 });
  near(z.ky, 0.5);
  near(z.v0, 0); // y 0.25 com altura 0.5 = encosta no topo
  near(z.u0 + z.kx / 2, 0.7);
  // o recorte tem a proporção do quadro
  near((z.kx * 1920) / (z.ky * 1080), 1080 / 1920);
});

test('set_overlay_framing grava, mescla campos e limita; null ou padrão limpa', () => {
  let t = applyOp(tl(), { type: 'set_overlay_framing', id: 'b1', framing: { x: 0.2, zoom: 9 } }, 'human');
  assert.deepEqual(t.overlays[0]!.framing, { x: 0.2, y: 0.5, zoom: 4 });
  t = applyOp(t, { type: 'set_overlay_framing', id: 'b1', framing: { y: 1.4 } }, 'human');
  assert.deepEqual(t.overlays[0]!.framing, { x: 0.2, y: 1, zoom: 4 });
  t = applyOp(t, { type: 'set_overlay_framing', id: 'b1', framing: null }, 'human');
  assert.equal(t.overlays[0]!.framing, undefined);
  t = applyOp(t, { type: 'set_overlay_framing', id: 'b1', framing: { x: 0.5, y: 0.5, zoom: 1 } }, 'human');
  assert.equal('framing' in t.overlays[0]!, false);
});

test('set_overlay_framing em overlay que não é mídia ou inexistente é erro', () => {
  assert.throws(() => applyOp(tl(), { type: 'set_overlay_framing', id: 't1', framing: { x: 0 } }, 'human'), OpError);
  assert.throws(() => applyOp(tl(), { type: 'set_overlay_framing', id: 'nada', framing: { x: 0 } }, 'human'), OpError);
});
