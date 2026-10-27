/**
 * CH-0003 (NewStudios): B-roll 16:9 na V2 de timeline 9:16 saía com recorte central fixo (pegava tarja preta,
 * ombro do entrevistador e crédito). Agora o overlay tem centro (x, y) e zoom, com a mesma conta no export e no preview.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, coverCrop, framingAt, OpError } from './timeline.ts';
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

test('CH-0032: anchor clip lê x/y como o clipe principal (mesmo x, mesmo zoom, mesmo recorte)', () => {
  const k = 1 / 1.85;
  const a = coverCrop(1080, 1920, 1080, 1920, { x: 0.72, y: 0.3, zoom: 1.85, anchor: 'clip' });
  // clipe principal: crop=iw/z:ih/z:x=(iw-ow)*ax:y=(ih-oh)*ay
  near(a.u0, (1 - k) * 0.72);
  near(a.v0, (1 - k) * 0.3);
  near(a.kx, k);
  // o contorno do chamado (centro 0,601) dá o mesmo recorte no modo de sempre
  near(coverCrop(1080, 1920, 1080, 1920, { x: (1 - k) * 0.72 + k / 2, zoom: 1.85 }).u0, a.u0);
  // B-roll 16:9 em 9:16: âncora 0 e 1 encostam nas bordas
  near(coverCrop(1920, 1080, 1080, 1920, { x: 0, anchor: 'clip' }).u0, 0);
  const d = coverCrop(1920, 1080, 1080, 1920, { x: 1, anchor: 'clip' });
  near(d.u0 + d.kx, 1);
});

test('CH-0032: set_overlay_framing guarda anchor clip entre edições; center volta ao padrão', () => {
  let t = applyOp(tl(), { type: 'set_overlay_framing', id: 'b1', framing: { x: 0.72, zoom: 1.85, anchor: 'clip' } }, 'human');
  assert.deepEqual(t.overlays[0]!.framing, { x: 0.72, y: 0.5, zoom: 1.85, anchor: 'clip' });
  t = applyOp(t, { type: 'set_overlay_framing', id: 'b1', framing: { y: 0.3 } }, 'human');
  assert.equal(t.overlays[0]!.framing?.anchor, 'clip');
  t = applyOp(t, { type: 'set_overlay_framing', id: 'b1', framing: { anchor: 'center' } }, 'human');
  assert.deepEqual(t.overlays[0]!.framing, { x: 0.72, y: 0.3, zoom: 1.85 });
  t = applyOp(t, { type: 'set_overlay_framing', id: 'b1', framing: { x: 0.5, y: 0.5, zoom: 1, anchor: 'clip' } }, 'human');
  assert.equal(t.overlays[0]!.framing?.anchor, 'clip');
});

test('CH-0036: set_framing com to grava a rampa, mescla campos, valida e null tira', () => {
  let t = applyOp(tl(), { type: 'set_framing', clipId: 'c1', y: 0.36, to: { y: 0.24, start: 0.2, dur: 0.7 } }, 'human');
  assert.deepEqual(t.main[0]!.framing, { y: 0.36 });
  assert.deepEqual(t.main[0]!.framingTo, { y: 0.24, start: 0.2, dur: 0.7 });
  t = applyOp(t, { type: 'set_framing', clipId: 'c1', to: { x: 1.3, ease: 'linear' } }, 'human');
  assert.deepEqual(t.main[0]!.framingTo, { y: 0.24, start: 0.2, dur: 0.7, x: 1, ease: 'linear' });
  // set_framing sem `to` mantém a rampa.
  t = applyOp(t, { type: 'set_framing', clipId: 'c1', x: 0.4 }, 'human');
  assert.equal(t.main[0]!.framingTo?.y, 0.24);
  assert.throws(() => applyOp(t, { type: 'set_framing', clipId: 'c1', to: { dur: 0 } }, 'human'), OpError);
  assert.throws(() => applyOp(t, { type: 'set_framing', clipId: 'c1', to: { start: -1 } }, 'human'), OpError);
  assert.throws(() => applyOp(t, { type: 'set_framing', clipId: 'c1', to: { ease: 'bounce' as 'out' } }, 'human'), OpError);
  t = applyOp(t, { type: 'set_framing', clipId: 'c1', to: null }, 'human');
  assert.equal('framingTo' in t.main[0]!, false);
});

test('CH-0036: framingAt anda só dentro da janela (ease-out padrão, linear opcional)', () => {
  const c = { id: 'c', assetId: 'a', in: 0, out: 2, by: 'human' as const, framing: { y: 0.36 }, framingTo: { y: 0, start: 0.3, dur: 0.7, ease: 'linear' as const } };
  assert.equal(framingAt(c, 0).y, 0.36);
  assert.equal(framingAt(c, 0.3).y, 0.36);
  assert.ok(Math.abs(framingAt(c, 0.65).y! - 0.18) < 1e-9);
  assert.equal(framingAt(c, 1.5).y, 0);
  assert.equal(framingAt(c, 1.5).x, undefined);
  const out = { ...c, framingTo: { y: 0, start: 0.3, dur: 0.7 } };
  assert.ok(framingAt(out, 0.65).y! < 0.18, 'ease-out anda mais no começo');
  // Sem dur vai até o fim do clipe; x sem framing parte do centro.
  assert.ok(Math.abs(framingAt({ ...c, framing: undefined, framingTo: { x: 0, ease: 'linear' as const } }, 1).x! - 0.25) < 1e-9);
});
