/**
 * CH-0043 (Pedro, equity-sales/eq2210-14): 'eu' 47,46 e 'vou' 47,48 no transcript. O "dividir" no 'vou' casou com o
 * 'eu' pela folga de 0,02 s (o servidor guardou uma edição a menos e o 'eu' virou bloco de 1 quadro). A edição de
 * legenda e a correção de palavra ficam presas à palavra exata.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, normalizeTimeline } from './timeline.ts';
import { buildCues, DEFAULT_CAPTIONS, fixedText, wordTimingError } from './text.ts';

const words = {
  a: [
    { w: 'Então', start: 47.0, end: 47.4 },
    { w: 'eu', start: 47.46, end: 47.48 },
    { w: 'vou', start: 47.48, end: 47.7 },
    { w: 'falar', start: 47.7, end: 48.1 },
    { w: 'disso.', start: 48.1, end: 48.6 },
  ],
};
const s = { ...DEFAULT_CAPTIONS, enabled: true, style: 'frase' as const };
const tl0 = () => normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 46, out: 50, by: 'agent' }] });
const blocos = (t: ReturnType<typeof tl0>) => buildCues(t, words, s).map((c) => c.words.map((w) => w.text).join(' '));

test('dividir em palavras a 0,02 s: cada uma guarda a própria edição', () => {
  let t = applyOp(tl0(), { type: 'edit_captions', edits: [{ assetId: 'a', at: 47.46, patch: { split: true } }] }, 'human');
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 47.48, patch: { split: true } }] }, 'human');
  assert.equal(t.captionEdits?.length, 2);
  assert.deepEqual(t.captionEdits?.map((e) => e.at).sort(), [47.46, 47.48]);
  assert.deepEqual(blocos(t), ['Então', 'eu', 'vou falar disso.']);
});

test('dividir só no vou não divide no eu', () => {
  const t = applyOp(tl0(), { type: 'edit_captions', edits: [{ assetId: 'a', at: 47.48, patch: { split: true } }] }, 'human');
  assert.deepEqual(blocos(t), ['Então eu', 'vou falar disso.']);
});

test('texto e apagar na legenda do vizinho não vazam', () => {
  let t = applyOp(tl0(), { type: 'edit_captions', edits: [{ assetId: 'a', at: 47.48, patch: { split: true } }] }, 'human');
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 47.46, patch: { hidden: true } }] }, 'human');
  assert.equal(t.captionEdits?.length, 2);
  // 'eu' está no meio do bloco "Então eu": o apagar nele não pega o bloco do 'vou' (antes pegava).
  const cues = buildCues(t, words, s, { includeHidden: true });
  assert.deepEqual(cues.map((c) => !!c.hidden), [false, false]);
});

test('ruído de ponto flutuante continua casando com a mesma palavra', () => {
  let t = applyOp(tl0(), { type: 'edit_captions', edits: [{ assetId: 'a', at: 47.48, patch: { split: true } }] }, 'human');
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 47.480000001, patch: { split: null as unknown as boolean } }] }, 'human');
  assert.equal(t.captionEdits?.length, 0);
});

test('fix_words: a grafia corrigida do vou não troca o eu', () => {
  const t = applyOp(tl0(), { type: 'fix_words', fixes: [{ assetId: 'a', at: 47.48, text: 'vô' }] }, 'human');
  assert.equal(fixedText(t, 'a', words.a[1]!), 'eu');
  assert.equal(fixedText(t, 'a', words.a[2]!), 'vô');
  assert.equal(wordTimingError(t, 'a', words.a, [47.47]), "fix_words: não há palavra começando em 47.47 s na transcrição deste asset");
});

test('ajuste antigo gravado a 0,015 s do início (eq2210-04) continua na palavra mais próxima, não na vizinha', () => {
  // 'dividir' guardado em 47,495: o mais perto é o 'vou' (47,48), não o 'falar' (47,70) nem o 'eu' (47,46).
  const t = { ...tl0(), captionEdits: [{ assetId: 'a', at: 47.495, split: true }] };
  assert.deepEqual(blocos(t), ['Então eu', 'vou falar disso.']);
  // Ajuste novo no início exato soma com o antigo (e vence no mesmo campo).
  const t2 = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 47.48, patch: { text: 'vô falar disso.' } }] }, 'human');
  assert.deepEqual(blocos(t2), ['Então eu', 'vô falar disso.']);
});
