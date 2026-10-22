/**
 * CH-0021 (Pedro, Guilherme Alvares 6ad367fb): "juntar" numa palavra que começa no mesmo instante em que um lettering
 * entra era ignorado: a regra de camada (CH-0014) fechava o bloco antes, a palavra virava bloco sozinha e sumia sob o
 * lettering. Caso real: 'o' (52,38) de 'o senso' com SENSO DE DONO em 52,38.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, normalizeTimeline } from './timeline.ts';
import { buildCues, cueVisible, DEFAULT_CAPTIONS } from './text.ts';

const s = { ...DEFAULT_CAPTIONS, enabled: true, style: 'reels' as const };
const w = {
  a: [
    { w: 'É', start: 1.8, end: 2.0 },
    { w: 'ter', start: 2.05, end: 2.3 },
    { w: 'o', start: 2.38, end: 2.45 },
    { w: 'senso', start: 2.5, end: 2.9 },
    { w: 'de', start: 2.95, end: 3.05 },
    { w: 'dono.', start: 3.1, end: 3.5 },
  ],
};
const base = () =>
  applyOp(
    normalizeTimeline({ fps: 29.97, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 6, by: 'agent' }] }),
    { type: 'add_overlay', item: { trackId: 'V3', role: 'motion', anchor: { assetId: 'a', at: 2.38 }, duration: 1.2, source: { type: 'media', assetId: 'm', in: 0 } } },
    'agent',
  );
const texto = (c: { words: { text: string }[] }) => c.words.map((x) => x.text).join(' ');

test('sem ajuste, a camada que entra na palavra continua abrindo legenda nova (CH-0014)', () => {
  const cues = buildCues(base(), w, s);
  const o = cues.find((c) => c.words.some((x) => x.text === 'o'))!;
  assert.equal(o.words[0]!.text, 'o');
});

test('juntar na palavra que começa junto com a camada a leva para a legenda anterior, visível', () => {
  const t = applyOp(base(), { type: 'edit_captions', edits: [{ assetId: 'a', at: 2.38, patch: { join: true } }] }, 'human');
  const cues = buildCues(t, w, s);
  const o = cues.find((c) => c.words.some((x) => x.text === 'o'))!;
  assert.equal(texto(o), 'É ter o');
  assert.ok(cueVisible(o), `coberta por ${o.coveredBy}`);
  assert.ok(o.end <= 2.38 + 1e-6, `sai quando o lettering entra (${o.end})`);
  // A palavra depois da camada continua fora do bloco anterior.
  const senso = cues.find((c) => c.words.some((x) => x.text === 'senso'))!;
  assert.equal(senso.words[0]!.text, 'senso');
});
