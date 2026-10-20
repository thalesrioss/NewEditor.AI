import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diasAtePrazo, seloPrazo } from './prazo.ts';

// BL-0077: prazo em dias de calendário, igual de manhã e de noite.
for (const [rotulo, agora] of [
  ['08:00', new Date(2026, 9, 20, 8, 0)],
  ['23:30', new Date(2026, 9, 20, 23, 30)],
  ['00:00', new Date(2026, 9, 20, 0, 0)],
] as const) {
  describe(`diasAtePrazo com agora = 20/10/2026 ${rotulo}`, () => {
    test('prazo hoje → 0 (sem -0)', () => assert.ok(Object.is(diasAtePrazo('2026-10-20', agora), 0)));
    test('prazo ontem → -1', () => assert.equal(diasAtePrazo('2026-10-19', agora), -1));
    test('prazo amanhã → 1', () => assert.equal(diasAtePrazo('2026-10-21', agora), 1));
    test('sexta 23/10 → 3', () => assert.equal(diasAtePrazo('2026-10-23', agora), 3));
    test('6 meses à frente (vira mês, ano e horário de verão) → 181', () => assert.equal(diasAtePrazo('2027-04-19', agora), 181));
    test('vira o mês: 02/11 → 13', () => assert.equal(diasAtePrazo('2026-11-02', agora), 13));
  });
}

test('prazo com hora (ISO completo) usa só a data', () => assert.equal(diasAtePrazo('2026-10-19T12:00:00', new Date(2026, 9, 20, 8)), -1));
test('prazo inválido → null', () => {
  assert.equal(diasAtePrazo('', new Date(2026, 9, 20)), null);
  assert.equal(diasAtePrazo('sexta', new Date(2026, 9, 20)), null);
});

describe('seloPrazo', () => {
  test('hoje → "entrega hoje" âmbar', () => assert.deepEqual(seloPrazo(0), { texto: 'entrega hoje', tom: 'perto' }));
  test('ontem → "atrasado 1d" vermelho', () => assert.deepEqual(seloPrazo(-1), { texto: 'atrasado 1d', tom: 'atrasado' }));
  test('amanhã → âmbar', () => assert.deepEqual(seloPrazo(1), { texto: 'entrega em 1d', tom: 'perto' }));
  test('sexta → "entrega em 3d" neutro', () => assert.deepEqual(seloPrazo(3), { texto: 'entrega em 3d', tom: 'folga' }));
});
