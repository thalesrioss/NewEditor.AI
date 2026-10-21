import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blurValue, rangeMax } from './rangeField.ts';

test('BL-0108: clicar no campo e sair sem editar não grava (zoom 2,6 da API não vira 1,3)', () => {
  assert.equal(blurValue('2.60', '2.60'), null);
  assert.equal(blurValue(' 2.60 ', '2.60'), null);
  assert.equal(blurValue('1,12', '2.60'), 1.12);
  assert.equal(blurValue('abc', '2.60'), 0);
});

test('BL-0108: a faixa do controle inclui o valor atual quando ele passa da referência da casa', () => {
  assert.equal(rangeMax(1.3, 1.1), 1.3);
  assert.equal(rangeMax(1.3, 2.6), 2.6);
});
