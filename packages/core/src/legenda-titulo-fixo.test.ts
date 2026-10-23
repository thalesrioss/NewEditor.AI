/**
 * CH-0022 (Pedro, Equity Sales eq2210): os reels do Leandro têm título fixo em 2 linhas no topo durante o vídeo
 * inteiro, com a legenda no meio. Lettering de 47 s escondia a legenda do vídeo todo; com `keepCaptions` ele convive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, normalizeTimeline } from './timeline.ts';
import { buildCues, cueVisible, DEFAULT_CAPTIONS } from './text.ts';

const s = { ...DEFAULT_CAPTIONS, enabled: true, style: 'reels' as const };
const w = { a: [{ w: 'Talento', start: 1, end: 1.5 }, { w: 'não', start: 1.6, end: 1.9 }, { w: 'sustenta', start: 2.4, end: 3 }, { w: 'crescimento.', start: 3.1, end: 3.8 }] };
const base = normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 6, by: 'agent' }] });
const titulo = (keepCaptions?: boolean) =>
  applyOp(base, { type: 'add_overlay', item: { id: 'tit', trackId: 'V3', role: 'lettering', anchor: { assetId: 'a', at: 0 }, duration: 6, source: { type: 'text', text: 'TÍTULO' }, ...(keepCaptions ? { keepCaptions } : {}) } }, 'human');

test('lettering do vídeo inteiro sem a flag esconde todas as legendas (regra da casa)', () => {
  assert.equal(buildCues(titulo(), w, s).some(cueVisible), false);
});

test('título fixo (keepCaptions) não esconde nem quebra a legenda', () => {
  const sem = buildCues(base, w, s);
  const com = buildCues(titulo(true), w, s);
  assert.ok(com.length > 0 && com.every(cueVisible));
  assert.deepEqual(com.map((c) => [c.start, c.end, c.words.map((x) => x.text).join(' ')]), sem.map((c) => [c.start, c.end, c.words.map((x) => x.text).join(' ')]));
});

test('set_overlay_keep_captions liga e desliga', () => {
  let t = applyOp(titulo(), { type: 'set_overlay_keep_captions', id: 'tit', keep: true }, 'human');
  assert.equal(t.overlays[0]!.keepCaptions, true);
  assert.ok(buildCues(t, w, s).every(cueVisible));
  t = applyOp(t, { type: 'set_overlay_keep_captions', id: 'tit', keep: false }, 'human');
  assert.equal('keepCaptions' in t.overlays[0]!, false);
  assert.equal(buildCues(t, w, s).some(cueVisible), false);
  assert.throws(() => applyOp(t, { type: 'set_overlay_keep_captions', id: 'x', keep: true }, 'human'));
});

test('B-roll em cima continua escondendo a legenda mesmo com o título fixo', () => {
  const t = applyOp(titulo(true), { type: 'add_overlay', item: { trackId: 'V2', role: 'broll', anchor: { assetId: 'a', at: 2.3 }, duration: 2, source: { type: 'media', assetId: 'b', in: 0 } } }, 'agent');
  const c = buildCues(t, w, s).find((x) => x.words.some((y) => y.text === 'sustenta'))!;
  assert.equal(c.coveredBy, 'broll');
});
