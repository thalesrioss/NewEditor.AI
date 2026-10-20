/**
 * Testes do perfil por projeto (BL-0023): todo projeto nasce com `profileId` gravado (Manual e Gestor) e o QC
 * cita o perfil escolhido com o mesmo nome dos seletores. Pasta de dados temporária, com dois perfis no disco:
 * o da casa (Thales, 16:9) e um de teste (Daniel, 9:16).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-perfil-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const perfisDir = path.join(tmp, 'data', 'perfis'); // PROFILES_DIR = <NEWEDITOR_DATA>/perfis
const app = Fastify();

before(async () => {
  fs.mkdirSync(perfisDir, { recursive: true });
  const at = '2026-10-20T00:00:00.000Z';
  fs.writeFileSync(path.join(perfisDir, 'thales.json'), JSON.stringify({ id: 'thales', nome: 'Thales Rios — Talk Head (padrão validado)', padraoCasa: true, validado: true, formato: { width: 3840, height: 2160 }, atualizadoEm: at }));
  fs.writeFileSync(path.join(perfisDir, 'daniel.json'), JSON.stringify({ id: 'daniel', nome: 'Daniel Sun Talk Head', validado: false, formato: { width: 1080, height: 1920 }, atualizadoEm: at }));
  const { store } = await import('./store.ts');
  await store.load();
  const { rotasProjetos } = await import('./routes/projetos.ts');
  await rotasProjetos(app);
});
after(async () => {
  await app.close();
  await new Promise((r) => setTimeout(r, 600)); // o store grava o project.json 400 ms depois do último update
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function criar(name: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/projects', payload: { name } });
  assert.equal(r.statusCode, 200);
  return (r.json() as { id: string }).id;
}

describe('perfil gravado no projeto', () => {
  test('Manual sem escolha grava o padrão da casa e o QC cita "Padrão da casa"', async () => {
    const { store } = await import('./store.ts');
    const { runQc } = await import('./qc.ts');
    const id = await criar('Manual casa');
    assert.equal(store.get(id).profileId, 'thales');
    store.setFormat(id, { width: 1080, height: 1920 });
    const formato = (await runQc(id)).issues.find((i) => i.regra === 'formato');
    assert.ok(formato, 'QC deveria avisar do formato');
    assert.match(formato.texto, /o padrão "Padrão da casa · Thales Rios — Talk Head \(padrão validado\)" é 3840×2160/);
  });

  test('perfil escolhido no editor vale no QC com o nome do seletor', async () => {
    const { store } = await import('./store.ts');
    const { runQc } = await import('./qc.ts');
    const id = await criar('Manual Daniel');
    const r = await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload: { profileId: 'daniel' } });
    assert.equal(r.statusCode, 200);
    assert.equal(store.get(id).profileId, 'daniel');
    store.setFormat(id, { width: 1920, height: 1080 });
    const formato = (await runQc(id)).issues.find((i) => i.regra === 'formato');
    assert.match(formato?.texto ?? '', /o padrão "Daniel Sun Talk Head \(teste\)" é 1080×1920/);
  });

  test('Gestor (tarefa colada) sem perfil do cliente grava o padrão da casa', async () => {
    const { store } = await import('./store.ts');
    const { createFromTask } = await import('./gestor.ts');
    const r = await createFromTask('Reels 9:16 sobre treino, tom direto.');
    assert.equal(store.get(r.projectId).profileId, 'thales');
    const r2 = await createFromTask('Reels 9:16 sobre treino.', { profileId: 'daniel' });
    assert.equal(store.get(r2.projectId).profileId, 'daniel');
  });
});
