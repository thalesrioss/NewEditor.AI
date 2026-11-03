/**
 * BL-0161 (fatias 1 e 2): padrão de cor do cliente no perfil. (1) O perfil guarda a grade e até 3 stills (na pasta do
 * perfil); o 4º é recusado. (2) Projeto do cliente recebe a grade nos clipes da fala (não nos outros), por cima da
 * conversão LOG do arquivo, marcada como herdada, num passo de desfazer; perfil sem padrão deixa a timeline igual.
 * Montado à mão (sem FFmpeg): assets e montagem crua postos direto no store, como a importação deixa.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify from 'fastify';
import { clipGradeOf, NEUTRAL_GRADE, type ColorGrade, type MediaAsset } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-padrao-cor-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const perfisDir = path.join(tmp, 'data', 'perfis');
const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
// PNG 1×1.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const padraoEquity: ColorGrade = { ...NEUTRAL_GRADE, exposure: -0.2, temperature: 0.15, saturation: 1.1, contrast: 0.12 };
const arquivoLog: ColorGrade = { ...NEUTRAL_GRADE, input: 'slog3', codeRange: 'full', exposure: 0.3 };

before(async () => {
  fs.mkdirSync(perfisDir, { recursive: true });
  const at = '2026-10-31T00:00:00.000Z';
  fs.writeFileSync(path.join(perfisDir, 'thales.json'), JSON.stringify({ id: 'thales', nome: 'Thales Rios', padraoCasa: true, validado: true, atualizadoEm: at }));
  fs.writeFileSync(path.join(perfisDir, 'equity.json'), JSON.stringify({ id: 'equity', nome: 'Equity', cliente: 'Equity', validado: true, atualizadoEm: at }));
  fs.writeFileSync(path.join(perfisDir, 'daniel.json'), JSON.stringify({ id: 'daniel', nome: 'Daniel Sun', atualizadoEm: at }));
  const { store } = await import('./store.ts');
  await store.load();
  await (await import('./routes/projetos.ts')).rotasProjetos(app);
  await (await import('./routes/bibliotecas.ts')).rotasBibliotecas(app);
});
after(async () => {
  await app.close();
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Projeto do perfil com a montagem crua da importação: 2 clipes da fala LOG (S-Log3 já convertido no arquivo) + 1 de B-roll. */
async function projetoMontado(profileId: string): Promise<string> {
  const { store } = await import('./store.ts');
  const r = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: `Projeto ${profileId}` } });
  const id = (r.json() as { id: string }).id;
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload: { profileId } })).statusCode, 200);
  const color = { input: 'slog3' as const, fonte: 'xml' as const, codeRange: 'full' as const };
  const fala: MediaAsset = { id: 'fala1', name: 'fala.mp4', path: '/x/fala.mp4', kind: 'video', duration: 10, hasAudio: true, role: 'fala', color };
  const broll: MediaAsset = { id: 'broll1', name: 'broll.mp4', path: '/x/broll.mp4', kind: 'video', duration: 5, hasAudio: false, role: 'broll' };
  store.upsertAsset(id, fala);
  store.upsertAsset(id, broll);
  store.apply(id, { by: 'system', op: { type: 'set_grade', assetId: 'fala1', grade: arquivoLog } });
  store.apply(id, {
    by: 'system',
    op: {
      type: 'set_main',
      clips: [
        { id: 'c1', assetId: 'fala1', in: 0, out: 4, by: 'system' },
        { id: 'c2', assetId: 'broll1', in: 0, out: 2, by: 'system' },
        { id: 'c3', assetId: 'fala1', in: 4, out: 10, by: 'system' },
      ],
      removals: [],
    },
  });
  return id;
}

describe('padrão de cor do cliente no perfil (BL-0161)', () => {
  test('salva grade + 1 still no perfil Equity e lê de volta (grade sem conversão de entrada, still na pasta do perfil)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/perfis/equity/padrao-cor', payload: { grade: { ...padraoEquity, input: 'slog3', codeRange: 'full' }, stills: [PNG] } });
    assert.equal(r.statusCode, 200, r.body);
    const lido = (await app.inject({ method: 'GET', url: '/api/perfis/equity/padrao-cor' })).json() as { padrao: { grade: ColorGrade; stills: string[] } };
    assert.deepEqual(lido.padrao.grade, clipGradeOf(padraoEquity));
    assert.equal(lido.padrao.stills.length, 1);
    const file = path.join(perfisDir, 'equity', 'stills', lido.padrao.stills[0]!);
    assert.ok(fs.existsSync(file), 'still gravado na pasta do perfil');
    const img = await app.inject({ method: 'GET', url: `/api/perfis/equity/padrao-cor/stills/${lido.padrao.stills[0]}` });
    assert.equal(img.statusCode, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.deepEqual(img.rawPayload, fs.readFileSync(file));
    // Gravado no JSON do perfil (sobrevive a reiniciar).
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(perfisDir, 'equity.json'), 'utf8')).cor.padrao.stills, lido.padrao.stills);
    // Perfil que não existe: 404, não cai no padrão da casa.
    assert.equal((await app.inject({ method: 'GET', url: '/api/perfis/nao-existe/padrao-cor' })).statusCode, 404);
  });

  test('até 3 stills: o 4º é recusado com erro claro e nada muda', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/perfis/equity/padrao-cor', payload: { grade: padraoEquity, stills: [PNG, PNG] } });
    assert.equal(r.statusCode, 200, r.body);
    const quarto = await app.inject({ method: 'POST', url: '/api/perfis/equity/padrao-cor', payload: { grade: { ...padraoEquity, exposure: 1 }, stills: [PNG] } });
    assert.equal(quarto.statusCode, 409);
    assert.match((quarto.json() as { message: string }).message, /no máximo 3 stills de referência: Equity já tem 3\. Apague um still/);
    const lido = (await app.inject({ method: 'GET', url: '/api/perfis/equity/padrao-cor' })).json() as { padrao: { grade: ColorGrade; stills: string[] } };
    assert.equal(lido.padrao.stills.length, 3);
    assert.equal(lido.padrao.grade.exposure, padraoEquity.exposure, 'a grade do pedido recusado não grava');
    assert.equal(fs.readdirSync(path.join(perfisDir, 'equity', 'stills')).length, 3);
    // Still inválido: 400.
    const ruim = await app.inject({ method: 'POST', url: '/api/perfis/daniel/padrao-cor', payload: { grade: padraoEquity, stills: ['nao-e-imagem'] } });
    assert.equal(ruim.statusCode, 400);
    // Apagando um, cabe de novo; e só a grade (sem stills) atualiza sem mexer neles.
    const del = await app.inject({ method: 'DELETE', url: `/api/perfis/equity/padrao-cor/stills/${lido.padrao.stills[0]}` });
    assert.equal(del.statusCode, 200);
    assert.equal(fs.readdirSync(path.join(perfisDir, 'equity', 'stills')).length, 2);
    const so = await app.inject({ method: 'POST', url: '/api/perfis/equity/padrao-cor', payload: { grade: padraoEquity } });
    assert.equal((so.json() as { padrao: { stills: string[] } }).padrao.stills.length, 2);
  });

  test('projeto novo do Equity: só os clipes da fala recebem a grade, marcados herdados, com a conversão LOG do arquivo intacta; desfazer tira', async () => {
    const { store } = await import('./store.ts');
    const { herdarPadraoCor } = await import('./padrao-cor.ts');
    const id = await projetoMontado('equity');
    const antes = structuredClone(store.get(id).timeline);
    assert.equal(await herdarPadraoCor(id), 2);
    const tl = store.get(id).timeline;
    const [c1, c2, c3] = tl.main;
    for (const c of [c1!, c3!]) {
      assert.deepEqual(c.grade, clipGradeOf(padraoEquity));
      assert.equal(c.gradeHerdada, 'equity');
    }
    assert.equal(c2!.grade, undefined, 'B-roll não recebe');
    assert.equal(c2!.gradeHerdada, undefined);
    assert.deepEqual(tl.grades?.fala1, arquivoLog, 'a grade do arquivo (input/codeRange da fonte) fica como estava');
    // De novo: nada (os clipes já têm grade); um passo só no desfazer.
    assert.equal(await herdarPadraoCor(id), 0);
    assert.ok(store.undo(id));
    assert.deepEqual(store.get(id).timeline, antes);
    assert.ok(store.redo(id));
    assert.equal(store.get(id).timeline.main[0]!.gradeHerdada, 'equity');
    // Mexer na grade do clipe à mão tira a marca de herdada; o corte leva grade e marca para os dois pedaços.
    store.apply(id, { by: 'human', op: { type: 'set_clip_grade', clipIds: ['c1'], grade: { ...padraoEquity, exposure: 0.5 } } });
    assert.equal(store.get(id).timeline.main[0]!.gradeHerdada, undefined);
    store.apply(id, { by: 'human', op: { type: 'split', time: 8 } });
    const pedacos = store.get(id).timeline.main.filter((c) => c.assetId === 'fala1' && c.in >= 4);
    assert.equal(pedacos.length, 2);
    for (const c of pedacos) assert.equal(c.gradeHerdada, 'equity');
  });

  test('projeto de perfil sem padrão de cor: timeline idêntica e nenhum passo de desfazer', async () => {
    const { store } = await import('./store.ts');
    const { herdarPadraoCor } = await import('./padrao-cor.ts');
    const id = await projetoMontado('daniel');
    const antes = JSON.stringify(store.get(id).timeline);
    const passos = store.undoLabels(id).length;
    assert.equal(await herdarPadraoCor(id), 0);
    assert.equal(JSON.stringify(store.get(id).timeline), antes);
    assert.equal(store.undoLabels(id).length, passos);
    // Perfil novo copiado do Equity não leva o padrão de cor dele (os stills são da pasta do Equity).
    const { createProfile } = await import('./profiles.ts');
    assert.equal((await createProfile('Equity Shorts', 'equity')).cor.padrao, undefined);
  });

  test('pela aba Cor: salva no perfil do projeto; "Personalizado" recusa', async () => {
    const { store } = await import('./store.ts');
    const id = await projetoMontado('daniel');
    const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/padrao-cor`, payload: { grade: padraoEquity, stills: [PNG] } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((r.json() as { perfil: string }).perfil, 'daniel');
    const g = (await app.inject({ method: 'GET', url: `/api/projects/${id}/padrao-cor` })).json() as { perfil: string; padrao: { stills: string[] } };
    assert.equal(g.perfil, 'daniel');
    assert.equal(g.padrao.stills.length, 1);
    store.update(id, { profileId: 'personalizado' });
    const p = await app.inject({ method: 'POST', url: `/api/projects/${id}/padrao-cor`, payload: { grade: padraoEquity } });
    assert.equal(p.statusCode, 409);
    assert.match((p.json() as { message: string }).message, /"Personalizado" não guarda padrão de cor/);
  });
});
