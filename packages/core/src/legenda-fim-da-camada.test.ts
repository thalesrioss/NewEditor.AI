/**
 * CH-0016 (Pedro, Brane 6ad8c09f): depois do CH-0014, legenda colada ao FIM de uma camada (motion/card) sumia quando a
 * camada passava 1 quadro do começo dela; e o "forçar" de uma palavra só valia se ela fosse a 1ª do bloco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, normalizeTimeline } from './timeline.ts';
import { buildCues, cueVisible, DEFAULT_CAPTIONS } from './text.ts';

const s = { ...DEFAULT_CAPTIONS, enabled: true, style: 'reels' as const };
const w = { a: [{ w: 'Se', start: 3.02, end: 3.2 }, { w: 'tem', start: 3.25, end: 3.45 }, { w: 'uma', start: 3.5, end: 3.8 }, { w: 'regra.', start: 3.85, end: 4.3 }] };
const tl = (duration: number) =>
  applyOp(normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 6, by: 'agent' }] }), { type: 'add_overlay', item: { trackId: 'V3', role: 'motion', anchor: { assetId: 'a', at: 1 }, duration, source: { type: 'media', assetId: 'm', in: 0 } } }, 'agent');

test('camada que acaba 1 quadro depois do começo da legenda não a esconde; a legenda entra quando a camada sai', () => {
  const t = tl(2.02 + 1 / 30); // motion de 1,00 a 3,053: passa 1 quadro da legenda 'Se tem uma' (3,02)
  const c = buildCues(t, w, s)[0]!;
  assert.equal(c.words[0]!.text, 'Se');
  assert.ok(cueVisible(c), `coberta por ${c.coveredBy}`);
  assert.ok(Math.abs(c.start - 3.0533) < 1e-3, `começa quando o motion sai (${c.start})`);
});

test('camada que cobre o começo da legenda de fato (mais de 2 quadros) continua escondendo', () => {
  const c = buildCues(tl(2.02 + 0.2), w, s)[0]!;
  assert.equal(c.coveredBy, 'motion');
  assert.equal(cueVisible(c), false);
});

test('forçar numa palavra do meio do bloco vale para o bloco inteiro', () => {
  let t = tl(4);
  assert.equal(buildCues(t, w, s).some(cueVisible), false);
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 3.25, patch: { force: true } }] }, 'human');
  const bloco = buildCues(t, w, s).find((c) => c.words.some((x) => x.text === 'tem'))!;
  assert.ok(cueVisible(bloco), `bloco '${bloco.words.map((x) => x.text).join(' ')}' forçado`);
});
