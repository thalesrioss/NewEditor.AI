/** BL-0023: os seletores de perfil (Novo projeto, editor, gaveta) e o QC falam o mesmo nome. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillProfile, HOUSE_PROFILE, PERSONALIZADO_ID, profileLabel, profileOptions, profileValue, type ClientProfile } from './profile.ts';

const perfil = (p: Partial<ClientProfile> & { id: string; nome: string }): ClientProfile => fillProfile({ atualizadoEm: '2026-10-20T00:00:00.000Z', ...p });
const thales = perfil({ id: 'thales-rios-talk-head', nome: 'Thales Rios — Talk Head (padrão validado)', padraoCasa: true, validado: true });
const daniel = perfil({ id: 'daniel-sun-talk-head', nome: 'Daniel Sun Talk Head', validado: false });
const reels = perfil({ id: 'leo-reels', nome: 'Leo', formatoPeca: 'reels', validado: true });
// Como o /api/perfis devolve: o da casa primeiro.
const perfis = [thales, daniel, reels];

test('o perfil que é o padrão da casa diz que é o da casa', () => {
  assert.equal(profileLabel(thales), 'Padrão da casa · Thales Rios — Talk Head (padrão validado)');
  assert.equal(profileLabel(HOUSE_PROFILE), 'Padrão da casa (NewContent)');
  assert.equal(profileLabel(daniel), 'Daniel Sun Talk Head (teste)');
  assert.match(profileLabel(reels), /^Leo · /);
});

test('opções: o padrão da casa uma vez só e primeiro, Personalizado no fim', () => {
  const ops = profileOptions(perfis, { personalizado: true });
  assert.deepEqual(ops.map((o) => o.value), ['thales-rios-talk-head', 'daniel-sun-talk-head', 'leo-reels', PERSONALIZADO_ID]);
  assert.equal(ops.filter((o) => o.label.startsWith('Padrão da casa')).length, 1);
  assert.equal(ops[1]!.label, profileLabel(daniel));
  // Sem perfil marcado como da casa: entra o genérico, sem duplicar.
  assert.deepEqual(profileOptions([HOUSE_PROFILE, daniel]).map((o) => o.value), ['casa', 'daniel-sun-talk-head']);
});

test('valor do seletor: projeto sem perfil ou com perfil que sumiu mostra o padrão da casa', () => {
  assert.equal(profileValue(perfis, undefined), 'thales-rios-talk-head');
  assert.equal(profileValue(perfis, 'apagado'), 'thales-rios-talk-head');
  assert.equal(profileValue(perfis, 'casa'), 'thales-rios-talk-head');
  assert.equal(profileValue(perfis, 'daniel-sun-talk-head'), 'daniel-sun-talk-head');
  assert.equal(profileValue(perfis, PERSONALIZADO_ID), PERSONALIZADO_ID);
  assert.equal(profileValue([HOUSE_PROFILE], undefined), 'casa');
});
