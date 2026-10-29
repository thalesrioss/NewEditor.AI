/**
 * Registro do Thales no Cérebro (força-tarefa 27/10, frente R): append nos dois formatos (memória da NewStudios e
 * cofre no molde do PROTOCOLO_GLOBAL), sem repetir o mesmo ref, cofre ausente, a rota, a leitura por cliente com o
 * perfil, e a captura pela tela (comentário com Origin da 5410 grava; agente por curl, sem Origin, não).
 * Tudo em pastas temporárias: os arquivos reais nunca são tocados.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-registro-'));
const MEM = path.join(tmp, 'newstudios', 'memoria');
const COFRE = path.join(tmp, 'cofre', 'NewStudios', '_SISTEMA');
process.env.NEWSTUDIOS_MEMORIA = MEM;
process.env.CEREBRO_COFRE = COFRE;
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_PRODUTORA = path.join(tmp, 'newstudios');
fs.mkdirSync(MEM, { recursive: true });
fs.mkdirSync(COFRE, { recursive: true });
fs.mkdirSync(path.join(tmp, 'newstudios', 'producao', 'equity-sales'), { recursive: true });
fs.mkdirSync(process.env.NEWEDITOR_DATA, { recursive: true });

// Uma linha de cada arquivo no formato que já existe lá (a do cofre sem quebra no fim, de propósito).
const NS_COR = '{"data": "2026-10-26", "quem": "studio-editor-2 (Lia), R2 retroativo 27/10", "projeto": "equity-sales/eq2210-01..20", "origem": "Thales (Slack #diretoria, 26/10 20:06)", "pedido_literal": "sobre o destaque dos Letterings vermelho do Guilherme", "antes": "destaque dourado", "depois": "destaque vermelho"}\n';
const COFRE_COR = '{"skill": "07-motion-studio (lettering)", "projeto": "equity-sales/eq2210-01..20", "data": "2026-10-26", "ORIGINAL_DECISION": "destaque dourado", "USER_CORRECTION": "sobre o destaque dos Letterings vermelho do Guilherme", "CONTEXT": "", "REASON": "", "RESULT": "destaque vermelho", "PATTERN": "", "CONFIDENCE": "NÍVEL 2", "origem": "Thales (Slack #diretoria, 26/10 20:06)", "fonte": "newstudios"}';
fs.writeFileSync(path.join(MEM, 'correcoes.jsonl'), NS_COR);
fs.writeFileSync(path.join(COFRE, 'correcoes.jsonl'), COFRE_COR);
fs.writeFileSync(path.join(MEM, 'decisoes.jsonl'), '{"data": "2026-10-20", "quem": "studio-editor-1", "projeto": "brane/6ad8c0b9", "condicao": "x", "decisao": "y", "resultado": "z", "nivel": "MEDIDO"}\n');

const { registrarThales, linhasThales, lerPerfil, contextoThales, clienteDoProjeto, projetoCurto } = await import('./registro-thales.ts');
const { anotarOpHumana, canalDaTela, fecharSessaoHumana, resumoSessao } = await import('./registro-tela.ts');
const { rotasRegistro } = await import('./routes/registro.ts');
const { rotasRevisao } = await import('./routes/revisao.ts');
const { store } = await import('./store.ts');

const linhas = (arq: string) => fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean);
const ultima = (arq: string) => JSON.parse(linhas(arq).at(-1)!) as Record<string, string>;

describe('registro do Thales no Cérebro (frente R)', () => {
  let app: FastifyInstance;
  before(async () => {
    await store.load();
    app = Fastify();
    await rotasRegistro(app);
    await rotasRevisao(app);
    await app.ready();
  });
  after(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('alteração vai para correcoes.jsonl dos dois lados, cada um no seu formato, sem mexer no que já estava', async () => {
    const r = await registrarThales({ tipo: 'alteracao', canal: 'slack', pedido: 'Cor e tem uns takes onde o áudio do Leandro está desincronizado', antes: 'v6 com boca de outro momento', depois: 'cortar na pausa', projeto: 'eq2210-03', cliente: 'Equity Sales', ref: '1793072012.038469', quando: '2026-10-27 00:33', quem: 'studio-gestor-1' });
    assert.equal(r.newstudios?.gravado, true);
    assert.equal(r.cofre?.gravado, true);
    assert.deepEqual(r.avisos, []);
    assert.ok(fs.readFileSync(path.join(MEM, 'correcoes.jsonl'), 'utf8').startsWith(NS_COR));
    // A linha velha do cofre (sem quebra no fim) continua inteira e a nova vem na linha de baixo.
    assert.equal(linhas(path.join(COFRE, 'correcoes.jsonl'))[0], COFRE_COR);

    const ns = ultima(path.join(MEM, 'correcoes.jsonl'));
    assert.deepEqual(Object.keys(ns).slice(0, 7), ['data', 'quem', 'projeto', 'origem', 'pedido_literal', 'antes', 'depois']);
    assert.equal(ns.origem, 'Thales');
    assert.equal(ns.data, '2026-10-27');
    assert.equal(ns.projeto, 'equity-sales/eq2210-03');
    assert.equal(ns.quem, 'studio-gestor-1');
    assert.equal(ns.pedido_literal, 'Cor e tem uns takes onde o áudio do Leandro está desincronizado');
    assert.match(linhas(path.join(MEM, 'correcoes.jsonl')).at(-1)!, /^\{"data": "2026-10-27", "quem": /);

    const cf = ultima(path.join(COFRE, 'correcoes.jsonl'));
    for (const k of ['skill', 'projeto', 'data', 'titulo', 'ORIGINAL_DECISION', 'USER_CORRECTION', 'CONTEXT', 'REASON', 'RESULT', 'PATTERN', 'CONFIDENCE']) assert.ok(k in cf, k);
    assert.equal(cf.origem, 'Thales');
    assert.equal(cf.fonte, 'newstudios');
    assert.equal(cf.ORIGINAL_DECISION, 'v6 com boca de outro momento');
    assert.equal(cf.RESULT, 'cortar na pausa');
    assert.equal(cf.ref, '1793072012.038469');
  });

  test('aprovação vai para decisoes.jsonl: NewStudios no mesmo molde, cofre com decision/level/…/learning', async () => {
    fs.writeFileSync(path.join(COFRE, 'decisoes.jsonl'), '');
    await registrarThales({ tipo: 'aprovacao', canal: 'trello', pedido: 'card movido para Aprovado', depois: 'eq2210-15 v4 aprovada', cliente: 'equity-sales', projeto: 'eq2210-15', ref: 'trello-abc' });
    const ns = ultima(path.join(MEM, 'decisoes.jsonl'));
    assert.equal(ns.origem, 'Thales');
    assert.equal(ns.tipo, 'aprovacao');
    assert.equal(ns.pedido_literal, 'card movido para Aprovado');
    const cf = ultima(path.join(COFRE, 'decisoes.jsonl'));
    assert.deepEqual(Object.keys(cf).slice(0, 16), ['skill', 'projeto', 'data', 'titulo', 'decision', 'level', 'context', 'justification', 'evidence', 'confidence', 'alternatives', 'result', 'learning', 'origem', 'fonte', 'registrado_por']);
    assert.equal(cf.decision, 'eq2210-15 v4 aprovada');
    assert.equal(cf.justification, 'decisão do Thales: card movido para Aprovado');
    assert.equal(cf.fonte, 'newstudios');
  });

  test('mesmo ref não grava duas vezes', async () => {
    const n0 = linhas(path.join(MEM, 'correcoes.jsonl')).length;
    const c0 = linhas(path.join(COFRE, 'correcoes.jsonl')).length;
    const r = await registrarThales({ tipo: 'alteracao', canal: 'slack', pedido: 'repetido', cliente: 'equity-sales', ref: '1793072012.038469' });
    assert.equal(r.newstudios?.duplicado, true);
    assert.equal(r.cofre?.duplicado, true);
    assert.equal(linhas(path.join(MEM, 'correcoes.jsonl')).length, n0);
    assert.equal(linhas(path.join(COFRE, 'correcoes.jsonl')).length, c0);
  });

  test('cofre ausente: grava só na NewStudios e avisa, sem falhar', async () => {
    process.env.CEREBRO_COFRE = path.join(tmp, 'nao-existe', 'NewStudios', '_SISTEMA');
    try {
      const r = await registrarThales({ tipo: 'reprovacao', canal: 'aprovacoes', pedido: 'formato reprovado', cliente: 'equity-sales', ref: 'apr-1' });
      assert.equal(r.newstudios?.gravado, true);
      assert.equal(r.cofre, null);
      assert.match(r.avisos.join(' '), /cofre não encontrado/);
      assert.equal(fs.existsSync(process.env.CEREBRO_COFRE), false);
    } finally {
      process.env.CEREBRO_COFRE = COFRE;
    }
  });

  test('rota POST /api/cerebro/registro grava; tipo ou pedido inválido é 400', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/cerebro/registro', payload: { tipo: 'alteracao', canal: 'slack', pedido: 'legenda amarela no destaque', cliente: 'equity-sales', projeto: 'eq2210-07', ref: 'rota-1' } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().newstudios.gravado, true);
    assert.equal(ultima(path.join(MEM, 'correcoes.jsonl')).pedido_literal, 'legenda amarela no destaque');
    const ruim = await app.inject({ method: 'POST', url: '/api/cerebro/registro', payload: { tipo: 'gostei', canal: 'slack', pedido: 'x' } });
    assert.equal(ruim.statusCode, 400);
    const vazio = await app.inject({ method: 'POST', url: '/api/cerebro/registro', payload: { tipo: 'alteracao', canal: 'slack', pedido: ' ' } });
    assert.equal(vazio.statusCode, 400);
  });

  test('leitura por cliente: origem Thales das duas fontes, sem repetir, mais nova primeiro; perfil gravado', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/cerebro/cliente/equity-sales/thales?limit=20' });
    assert.equal(r.statusCode, 200);
    const { linhas: ls, perfil } = r.json() as { linhas: { pedido: string; fontes: string[]; data: string }[]; perfil: { cliente: string; ultimasCorrecoes: unknown[]; preferencias: { tema: string }[] } };
    // A fala do destaque vermelho está nas duas fontes (sem ref): aparece uma vez, com as duas fontes.
    const destaque = ls.filter((l) => l.pedido.startsWith('sobre o destaque'));
    assert.equal(destaque.length, 1);
    assert.deepEqual(destaque[0]!.fontes.sort(), ['cofre', 'newstudios']);
    // Ref repetido entre as fontes também não duplica.
    assert.equal(ls.filter((l) => l.pedido.startsWith('Cor e tem uns takes')).length, 1);
    assert.equal(ls.some((l) => l.pedido === 'repetido'), false);
    assert.ok(ls[0]!.data >= ls.at(-1)!.data);
    // Linha de outro cliente (brane) e linha sem origem Thales ficam de fora.
    assert.equal(ls.some((l) => l.pedido === 'y'), false);
    assert.equal(perfil.cliente, 'equity-sales');
    assert.ok(perfil.ultimasCorrecoes.length >= 3);
    assert.ok(perfil.preferencias.some((p) => p.tema === 'sincronia'));
    assert.ok(fs.existsSync(path.join(process.env.NEWEDITOR_DATA!, 'perfis', 'thales', 'equity-sales.json')));
    assert.equal((await lerPerfil('Equity Sales'))?.cliente, 'equity-sales');
    assert.equal((await linhasThales('equity-sales', 2)).length, 2);
  });

  test('cliente e código do projeto; contexto do agente traz as correções do cliente', async () => {
    const p = { id: 'prj_x', name: 'Equity Sales eq2210-03 - 6.200 seguidores (Tomás)', assets: [] };
    assert.equal(await clienteDoProjeto(p), 'equity-sales');
    assert.equal(projetoCurto(p), 'eq2210-03');
    assert.equal(await clienteDoProjeto({ ...p, name: 'Outro', assets: [{ path: path.join(tmp, 'newstudios', 'producao', 'brane', '6ad8c0b9-x', 'bruto', 'a.mp4') }] as never }), 'brane');
    const ctx = await contextoThales(p);
    assert.match(ctx, /Últimas correções do Thales para equity-sales/);
    assert.match(ctx, /desincronizado/);
    assert.equal(await contextoThales({ ...p, name: 'Sem cliente' }), '');
  });

  test('tela: canal pelo Origin; resumo da edição à mão com antes/depois', () => {
    assert.equal(canalDaTela({ origin: 'http://localhost:5410' }), 'tela-5410');
    assert.equal(canalDaTela({ origin: 'http://localhost:5173' }), 'editor-brain');
    assert.equal(canalDaTela({}), null);
    const a = { fps: 30, width: 1080, height: 1920, main: [], removals: [], overlays: [], tracks: [] } as never;
    const b = { fps: 30, width: 1080, height: 1920, main: [], removals: [], overlays: [], tracks: [], grades: { as1: { exposure: 0.2 } } } as never;
    const r = resumoSessao(a, b, new Map([['set_grade', 12], ['move_overlay', 2]]), ['Cor do C3039']);
    assert.equal(r.pedido, 'Editou à mão na tela (set_grade ×12, move_overlay ×2): Cor do C3039');
    assert.match(r.depois, /cor mudou/);
    assert.match(r.depois, /exposure/);
  });

  test('tela: comentário com Origin da 5410 grava como alteração do Thales; sem Origin (agente) não', async () => {
    const p = await store.create('Equity Sales eq2210-09 Funil ampulheta', '');
    const antes = linhas(path.join(MEM, 'correcoes.jsonl')).length;
    const sem = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/comments`, payload: { at: 3, text: 'pedido de agente' } });
    assert.equal(sem.statusCode, 200);
    const tela = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/comments`, headers: { origin: 'http://localhost:5410' }, payload: { at: 12.5, text: 'tira esse zoom, ficou forçado' } });
    assert.equal(tela.statusCode, 200);
    for (let i = 0; i < 40 && linhas(path.join(MEM, 'correcoes.jsonl')).length === antes; i++) await new Promise((r) => setTimeout(r, 50));
    const novas = linhas(path.join(MEM, 'correcoes.jsonl')).slice(antes).map((l) => JSON.parse(l) as Record<string, string>);
    assert.equal(novas.length, 1);
    assert.equal(novas[0]!.pedido_literal, 'tira esse zoom, ficou forçado');
    assert.equal(novas[0]!.canal, 'tela-5410');
    assert.equal(novas[0]!.projeto, 'equity-sales/eq2210-09');
    assert.equal(ultima(path.join(COFRE, 'correcoes.jsonl')).USER_CORRECTION, 'tira esse zoom, ficou forçado');
  });

  test('tela: edição à mão vira 1 linha só ao fechar a sessão (Devolver ao agente), com o resumo', async () => {
    const p = await store.create('Equity Sales eq2210-11 Conteúdo simples', '');
    const antes = linhas(path.join(MEM, 'correcoes.jsonl')).length;
    for (const exposure of [0.1, 0.2, 0.3]) {
      const op = { type: 'set_grade' as const, assetId: 'as1', grade: { exposure } as never };
      anotarOpHumana(p.id, op, 'tela-5410', 'Cor do C3050');
      store.apply(p.id, { by: 'human', op });
    }
    assert.equal(linhas(path.join(MEM, 'correcoes.jsonl')).length, antes);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/sessao-humana/fechar` });
    assert.equal(r.json().gravado, true);
    const novas = linhas(path.join(MEM, 'correcoes.jsonl')).slice(antes).map((l) => JSON.parse(l) as Record<string, string>);
    assert.equal(novas.length, 1);
    assert.equal(novas[0]!.pedido_literal, 'Editou à mão na tela (set_grade ×3): Cor do C3050');
    assert.match(novas[0]!.depois ?? '', /cor mudou/);
    assert.equal(await fecharSessaoHumana(p.id), false);
  });
});
