/** BL-0159 C3: alvo da aba Cor (arquivo ou clipe), clipes "desta câmera" e colar grade. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLut, NEUTRAL_GRADE, normalizeTimeline, type ColorGrade } from '@neweditor/core';
import { clipeDaCor, clipesDaCamera, colarGrade, gradeDoArquivoAoVivo } from './cor-clipe.ts';

const tl = normalizeTimeline({
  fps: 30,
  width: 1080,
  height: 1920,
  main: [
    { id: 'c1', assetId: 'a1', in: 0, out: 2, by: 'human' },
    { id: 'c2', assetId: 'a2', in: 0, out: 2, by: 'human' },
    { id: 'c3', assetId: 'a1', in: 2, out: 4, by: 'human', cam: 'cam2' },
    { id: 'c4', assetId: 'a1', in: 4, out: 6, by: 'human' },
  ],
});

test('clipe da aba Cor: o selecionado, senão o sob o cursor', () => {
  assert.equal(clipeDaCor(tl, 'c3', 0.5)?.id, 'c3');
  assert.equal(clipeDaCor(tl, null, 2.5)?.id, 'c2');
  assert.equal(clipeDaCor(tl, 'sumiu', 0.5)?.id, 'c1');
  assert.equal(clipeDaCor(undefined, null, 0), null);
});

test('clipes desta câmera: mesmo arquivo, ou a mesma 2ª câmera', () => {
  assert.deepEqual(clipesDaCamera(tl, tl.main[0]!), ['c1', 'c4']);
  assert.deepEqual(clipesDaCamera(tl, tl.main[2]!), ['c3']);
  assert.deepEqual(clipesDaCamera(tl, tl.main[1]!), ['c2']);
});

test('colar no arquivo mantém a entrada do arquivo; no clipe, cola como veio', () => {
  const copiada = { ...NEUTRAL_GRADE, exposure: 0.5, temperature: 0.2 };
  const doArquivo = { ...NEUTRAL_GRADE, input: 'slog3' as const, codeRange: 'full' as const, contrast: 0.3 };
  assert.deepEqual(colarGrade({ grade: copiada, alvo: 'arquivo' }, doArquivo, 'arquivo'), { ...copiada, input: 'slog3', codeRange: 'full' });
  assert.deepEqual(colarGrade({ grade: copiada, alvo: 'clipe' }, NEUTRAL_GRADE, 'clipe'), copiada);
});

test('copiar em Arquivo e colar em Este clipe não aplica as primárias do arquivo duas vezes', () => {
  // A grade do arquivo já entra no render de todos os clipes dele; colada no clipe, entraria de novo por cima.
  const doArquivo: ColorGrade = { ...NEUTRAL_GRADE, input: 'slog3', codeRange: 'full', exposure: 0.3, contrast: 0.2 };
  const soArquivo = buildLut(doArquivo, 9);
  // Reproduz o defeito: a mesma grade como grade do clipe muda a LUT composta (exposição e contraste duas vezes).
  assert.notDeepEqual(buildLut(doArquivo, 9, null, null, { grade: doArquivo }), soArquivo);
  // Agora a cola entre alvos diferentes não acontece, nos dois sentidos; a LUT do clipe fica a do arquivo.
  assert.equal(colarGrade({ grade: doArquivo, alvo: 'arquivo' }, NEUTRAL_GRADE, 'clipe'), null);
  assert.equal(colarGrade({ grade: { ...NEUTRAL_GRADE, exposure: -0.2 }, alvo: 'clipe' }, doArquivo, 'arquivo'), null);
  // Do clipe para outro clipe segue valendo.
  const deClipe = { ...NEUTRAL_GRADE, exposure: -0.2 };
  assert.deepEqual(buildLut(doArquivo, 9, null, null, { grade: colarGrade({ grade: deClipe, alvo: 'clipe' }, NEUTRAL_GRADE, 'clipe')! }), buildLut(doArquivo, 9, null, null, { grade: deClipe }));
});

test('player antigo: rascunho de Este clipe (com clipId) não troca a grade do arquivo durante o arraste', () => {
  const doArquivo: ColorGrade = { ...NEUTRAL_GRADE, input: 'slog3', codeRange: 'full', exposure: 0.3 };
  const grades = { a1: doArquivo };
  const rascunhoClipe = { assetId: 'a1', clipId: 'c1', grade: { ...NEUTRAL_GRADE, exposure: -0.4 } };
  // Antes: o rascunho do clipe (Rec.709, sem conversão) entrava no lugar da do arquivo e o LOG aparecia cru.
  assert.equal(gradeDoArquivoAoVivo(rascunhoClipe, 'a1', grades), doArquivo);
  assert.equal(gradeDoArquivoAoVivo(rascunhoClipe, 'a1', grades)?.input, 'slog3');
  // Rascunho do arquivo segue ao vivo; de outro arquivo ou sem rascunho, a gravada.
  const rascunhoArquivo = { assetId: 'a1', grade: { ...doArquivo, exposure: 0.6 } };
  assert.equal(gradeDoArquivoAoVivo(rascunhoArquivo, 'a1', grades), rascunhoArquivo.grade);
  assert.equal(gradeDoArquivoAoVivo(rascunhoArquivo, 'a2', grades), undefined);
  assert.equal(gradeDoArquivoAoVivo(null, 'a1', grades), doArquivo);
});
