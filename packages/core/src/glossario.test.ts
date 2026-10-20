/** BL-0081: glossário do cliente no perfil — limite, ordem (o mais recente primeiro), sem duplicata e argumentos do ASR. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addGlossario, asrGlossarioArgs, fillProfile, GLOSSARIO_MAX, glossarioKey, glossarioWords, normGlossario } from './profile.ts';

test('sem duplicata ignorando caixa e acento; aparado; vazio sai', () => {
  assert.deepEqual(normGlossario(['  Eustocina ', 'eustocina', 'EUSTÓCINA', '', '   ', 'Daniel  Sun']), ['Eustocina', 'Daniel Sun']);
  assert.equal(glossarioKey('Ação'), 'acao');
});

test('o mais recente entra no topo; repetido sobe com a grafia nova', () => {
  let g = addGlossario(undefined, 'Eustocina');
  g = addGlossario(g, 'Daniel Sun');
  assert.deepEqual(g, ['Daniel Sun', 'Eustocina']);
  assert.deepEqual(addGlossario(g, 'eustócina'), ['eustócina', 'Daniel Sun']);
});

test('no máximo 30 termos: passando, sai o mais antigo', () => {
  let g: string[] = [];
  for (let i = 1; i <= 35; i++) g = addGlossario(g, `Termo${i}`);
  assert.equal(GLOSSARIO_MAX, 30);
  assert.equal(g.length, 30);
  assert.equal(g[0], 'Termo35');
  assert.equal(g[29], 'Termo6');
  assert.equal(normGlossario(Array.from({ length: 40 }, (_, i) => `t${i}`)).length, 30);
});

test('perfil: glossário normalizado ao carregar; perfil sem glossário continua sem o campo', () => {
  const p = fillProfile({ id: 'x', nome: 'X', glossario: ['A', 'a', 'B'] });
  assert.deepEqual(p.glossario, ['A', 'B']);
  assert.equal('glossario' in fillProfile({ id: 'y', nome: 'Y' }), false);
});

test('palavras do glossário: termo de várias palavras conta palavra a palavra, sem caixa e sem acento', () => {
  const w = glossarioWords(['Daniel Sun', 'Eustócina', 'Coca-Cola']);
  for (const k of ['daniel', 'sun', 'eustocina', 'coca', 'cola']) assert.ok(w.has(k), k);
  assert.equal(w.has('eustosina'), false);
});

test('ASR: sem glossário nenhum argumento extra; com glossário, os termos limpos', () => {
  assert.deepEqual(asrGlossarioArgs(undefined), []);
  assert.deepEqual(asrGlossarioArgs([]), []);
  assert.deepEqual(asrGlossarioArgs(['  ', '']), []);
  assert.deepEqual(asrGlossarioArgs(['Eustocina', 'Daniel Sun', 'eustocina']), ['--glossario', 'Eustocina, Daniel Sun']);
});
