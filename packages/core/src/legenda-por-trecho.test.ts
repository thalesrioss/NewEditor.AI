/**
 * CH-0014 (Tomás, Davi Lo 6ad8c2a1): na tela dividida a legenda precisava ir para a emenda só naquele trecho
 * (a posição era só global), e o B-roll ancorado no 1º quadro de um clipe mostrava, nesse quadro, a legenda do clipe
 * anterior por cima (ela fica até a próxima palavra, que vem depois do corte).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, normalizeTimeline } from './timeline.ts';
import { buildCues, captionInlineStyle, cueCaptions, cueVisible, DEFAULT_CAPTIONS } from './text.ts';

const words = { a: ['Um', 'dois.', 'Três', 'quatro.', 'Cinco', 'seis.', 'Sete', 'oito.'].map((w, i) => ({ w, start: 1 + i * 0.5, end: 1.4 + i * 0.5 })) };
const s = { ...DEFAULT_CAPTIONS, enabled: true, style: 'reels' as const, position: 0.72 };
const tl0 = () => normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 10, by: 'agent' }] });
const alturas = (t: ReturnType<typeof tl0>) => buildCues(t, words, s).map((c) => cueCaptions(s, c).position);

test('posição por bloco: só aquela legenda muda de altura, presa à palavra (sobrevive a corte)', () => {
  let t = applyOp(tl0(), { type: 'edit_captions', edits: [{ assetId: 'a', at: 2, patch: { position: 0.47 } }] }, 'human');
  assert.deepEqual(alturas(t), [0.72, 0.47, 0.72, 0.72]);
  t = applyOp(t, { type: 'cut_source', assetId: 'a', in: 0, out: 0.9, kind: 'silence', reason: 'pausa' }, 'agent');
  assert.deepEqual(alturas(t), [0.72, 0.47, 0.72, 0.72]);
  // O mesmo HTML/CSS do preview e do export: top na altura própria.
  assert.match(captionInlineStyle(cueCaptions(s, buildCues(t, words, s)[1])), /^top:47\.00%/);
  // null volta à posição global e o ajuste some.
  t = applyOp(t, JSON.parse(JSON.stringify({ type: 'edit_captions', edits: [{ assetId: 'a', at: 2, patch: { position: null } }] })), 'human');
  assert.deepEqual(alturas(t), [0.72, 0.72, 0.72, 0.72]);
  assert.equal(t.captionEdits?.length, 0);
});

test('posição por trecho (until): todas as legendas que começam no trecho; o ajuste de um bloco vence o do trecho', () => {
  let t = applyOp(tl0(), { type: 'edit_captions', edits: [{ assetId: 'a', at: 2, patch: { position: 0.5, until: 3.5 } }] }, 'human');
  assert.deepEqual(alturas(t), [0.72, 0.5, 0.5, 0.72]);
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 3, patch: { position: 0.3 } }] }, 'human');
  assert.deepEqual(alturas(t), [0.72, 0.5, 0.3, 0.72]);
  // Fora da área segura é trazido para dentro; until sem posição (ou antes de at) não fica.
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 3, patch: { position: 1.4 } }, { assetId: 'a', at: 4, patch: { until: 5 } }] }, 'human');
  assert.equal(alturas(t)[2], 0.94);
  assert.equal(t.captionEdits?.find((e) => e.at === 4), undefined);
});

test('B-roll no 1º quadro do clipe: a legenda do clipe anterior acaba no corte, não aparece por cima', () => {
  // Dois clipes; a 1ª palavra do 2º clipe vem 0,06 s (2 quadros) depois do corte, como no bruto do Davi.
  const w = { a: [{ w: 'mudar', start: 1, end: 1.4 }, { w: 'tudo.', start: 1.5, end: 1.9 }, { w: 'Existe', start: 5.06, end: 5.4 }, { w: 'um', start: 5.45, end: 5.6 }] };
  let t = normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0.9, out: 2.0, by: 'agent' }, { id: 'c2', assetId: 'a', in: 5.0, out: 6.0, by: 'agent' }] });
  const corte = 1.1; // fim do c1 na timeline
  const antes = buildCues(t, w, s);
  assert.ok(antes[0]!.end > corte, 'sem B-roll a legenda segue até a próxima palavra (não pisca)');
  t = applyOp(t, { type: 'add_overlay', item: { trackId: 'V2', role: 'broll', anchor: { assetId: 'a', at: 5.0 }, duration: 0.6, source: { type: 'media', assetId: 'b', in: 0 } } }, 'human');
  const cues = buildCues(t, w, s);
  assert.ok(Math.abs(cues[0]!.end - corte) < 1e-9, `legenda do clipe anterior acaba no corte (${cues[0]!.end})`);
  assert.ok(cueVisible(cues[0]!));
  // No quadro do corte (33 a 30 fps) nenhuma legenda visível fica por cima do B-roll.
  const q = Math.round(corte * 30) / 30 + 1e-6;
  assert.equal(cues.find((c) => q >= c.start && q < c.end && cueVisible(c)), undefined);
  // Palavra curta no fim do clipe não se junta com a 1ª do clipe seguinte (senão a legenda some inteira sob o B-roll).
  const curta = { a: [{ w: 'tudo.', start: 1.6, end: 1.95 }, { w: 'Existe', start: 5.06, end: 5.4 }] };
  assert.deepEqual(buildCues(t, curta, s).map((c) => [c.words.map((x) => x.text).join(' '), c.coveredBy ?? '']), [['tudo.', ''], ['Existe', 'broll']]);
  // Legenda forçada pelo editor continua inteira.
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 1, patch: { force: true } }] }, 'human');
  assert.ok(buildCues(t, w, s)[0]!.end > corte);
});
