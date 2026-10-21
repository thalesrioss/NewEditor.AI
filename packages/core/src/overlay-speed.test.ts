/**
 * CH-0004 (NewStudios): B-roll de 1,5 s num evento de 2,62 s não tinha velocidade nem congelar no overlay.
 * Agora tem: `set_overlay_speed` e o instante da fonte (`overlaySourceTime`) que o export e o preview usam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, OpError, overlayPlayback, overlaySourceTime } from './timeline.ts';
import { DEFAULT_TRACKS, type OverlayItem, type Timeline } from './types.ts';

const broll: OverlayItem = { id: 'b1', trackId: 'V2', role: 'broll', anchor: { assetId: 'a', at: 1 }, duration: 2.62, source: { type: 'media', assetId: 'br', in: 0.2 }, by: 'human' };
const tl = (): Timeline => ({
  fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 10, by: 'system' }], removals: [], pins: [], tracks: DEFAULT_TRACKS,
  overlays: [broll, { id: 't1', trackId: 'V3', role: 'lettering', anchor: { assetId: 'a', at: 1 }, duration: 1, source: { type: 'text', text: 'oi' }, by: 'human' }],
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('sem velocidade: fonte anda junto com a timeline (como antes)', () => {
  near(overlaySourceTime(broll, 1), 1.2);
});

test('câmera lenta: 1,5 s de fonte cobrem 2,62 s de evento', () => {
  const o = { ...broll, source: { type: 'media' as const, assetId: 'br', in: 0 }, speed: 1.5 / 2.62 };
  near(overlaySourceTime(o, 2.62), 1.5);
  near(overlaySourceTime(o, 1.31), 0.75);
});

test('congelar: depois de duração − freeze o quadro para', () => {
  const o = { ...broll, freeze: 1 };
  assert.deepEqual(overlayPlayback(o).moving.toFixed(2), '1.62');
  near(overlaySourceTime(o, 2), 0.2 + 1.62);
  near(overlaySourceTime(o, 2.6), 0.2 + 1.62);
});

test('set_overlay_speed grava, limpa com null/1/0 e valida', () => {
  let t = applyOp(tl(), { type: 'set_overlay_speed', id: 'b1', speed: 0.5725, freeze: 0.4 }, 'human');
  assert.equal(t.overlays[0]!.speed, 0.5725);
  assert.equal(t.overlays[0]!.freeze, 0.4);
  t = applyOp(t, { type: 'set_overlay_speed', id: 'b1', speed: 1 }, 'human');
  assert.equal(t.overlays[0]!.speed, undefined);
  assert.equal(t.overlays[0]!.freeze, 0.4); // ausente = fica
  t = applyOp(t, { type: 'set_overlay_speed', id: 'b1', freeze: null }, 'human');
  assert.equal('freeze' in t.overlays[0]!, false);
  assert.throws(() => applyOp(tl(), { type: 'set_overlay_speed', id: 'b1', speed: 0.1 }, 'human'), OpError);
  assert.throws(() => applyOp(tl(), { type: 'set_overlay_speed', id: 'b1', freeze: 11 }, 'human'), OpError);
  assert.throws(() => applyOp(tl(), { type: 'set_overlay_speed', id: 't1', speed: 0.5 }, 'human'), OpError);
});
