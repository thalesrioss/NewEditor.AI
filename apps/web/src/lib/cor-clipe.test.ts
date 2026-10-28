/** BL-0159 C3: alvo da aba Cor (arquivo ou clipe), clipes "desta câmera" e colar grade. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NEUTRAL_GRADE, normalizeTimeline } from '@neweditor/core';
import { clipeDaCor, clipesDaCamera, colarGrade } from './cor-clipe.ts';

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
  assert.deepEqual(colarGrade(copiada, doArquivo, 'arquivo'), { ...copiada, input: 'slog3', codeRange: 'full' });
  assert.deepEqual(colarGrade(copiada, NEUTRAL_GRADE, 'clipe'), copiada);
});
