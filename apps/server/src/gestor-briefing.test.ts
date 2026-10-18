/**
 * Briefing da tarefa só com o que está no texto (BL-0045, ADR-0004): prazo relativo por regra e o que o LLM
 * local devolve passa por validação. O LLM é simulado devolvendo o lixo visto no FB-0058/FB-0060.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-briefing-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const HOJE = '2026-10-17'; // sábado
const TAREFA_DAVI = 'Material: /Users/thalesrioss/Downloads/davi-lo-15-dias-sem-treinar_v245.mp4\nCliente: Davi Lo. Reels até 60s, tirar gaguejadas e repetições, legenda amarela.';
const TAREFA_04H = 'oi! preciso de um corte pro insta, legenda amarela. entrega sexta. link https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view';
/** O que o LLM local devolveu nas rodadas do tester. */
const lixo = async () => ({ formato: 'reels', prazo: '2023-10-15', tom: 'tensos', cliente: 'cliente não especificado', naoPodeFaltar: ['legenda amarela', 'chamada para o curso'] });

describe('prazoDoTexto', async () => {
  const { prazoDoTexto } = await import('./gestor.ts');
  test('sem prazo no texto → nada', () => assert.equal(prazoDoTexto(TAREFA_DAVI, HOJE), undefined));
  test('"entrega sexta" → a próxima sexta', () => assert.equal(prazoDoTexto(TAREFA_04H, HOJE), '2026-10-23'));
  test('"Prazo 20/10" → ano de hoje', () => assert.equal(prazoDoTexto('Reels. Prazo 20/10.', HOJE), '2026-10-20'));
  test('"pra amanhã" e "entrega hoje"', () => {
    assert.equal(prazoDoTexto('preciso pra amanhã', HOJE), '2026-10-18');
    assert.equal(prazoDoTexto('Entrega hoje, por favor', HOJE), HOJE);
  });
  test('dia da semana igual a hoje → semana que vem; "-feira" sem palavra de prazo vale', () => {
    assert.equal(prazoDoTexto('entrega sábado', HOJE), '2026-10-24');
    assert.equal(prazoDoTexto('gravamos na terça-feira', HOJE), '2026-10-20');
  });
  test('"segunda" sem palavra de prazo não é data', () => assert.equal(prazoDoTexto('a segunda versão ficou melhor', HOJE), undefined));
  test('ordinal depois de "para"/"até" não é data', () => {
    assert.equal(prazoDoTexto('quero mudar para a segunda opção', '2026-12-28'), undefined);
    assert.equal(prazoDoTexto('até a quinta cena tá bom', '2026-12-28'), undefined);
    assert.equal(prazoDoTexto('até hoje ninguém mostrou isso', HOJE), undefined);
  });
  test('dia com palavra forte ou fechando a frase continua valendo', () => {
    assert.equal(prazoDoTexto('entrega quinta', '2026-12-28'), '2026-12-31');
    assert.equal(prazoDoTexto('preciso pra sexta que vem', HOJE), '2026-10-23');
    assert.equal(prazoDoTexto('entrega até a sexta e o resto depois', HOJE), '2026-10-23');
    assert.equal(prazoDoTexto('consegue até quinta?', HOJE), '2026-10-22');
  });
  test('dd/mm sem ano que já passou há meses → ano que vem', () => {
    assert.equal(prazoDoTexto('Prazo 05/01', '2026-12-28'), '2027-01-05');
    assert.equal(prazoDoTexto('Prazo 10/10', HOJE), '2026-10-10');
  });
});

describe('valorVazio', async () => {
  const { valorVazio } = await import('./gestor.ts');
  test('respostas de "não sei" do LLM', () => {
    for (const v of ['não especificado', 'Nao Informado', 'null', 'N/A', 'nenhum', '-', 'cliente não especificado', '', null]) assert.equal(valorVazio(v), true, String(v));
    for (const v of ['Davi Lo', 'leve', 'Nenhum de Nós']) assert.equal(valorVazio(v), false, v);
  });
});

describe('parseTask com LLM simulado', async () => {
  const { parseTask } = await import('./gestor.ts');
  test('tarefa do Davi (sem prazo): nada inventado, cliente por regra, pedidos fora do "Não pode faltar"', async () => {
    const b = await parseTask(TAREFA_DAVI, { hoje: HOJE, ask: lixo });
    assert.equal(b.prazo, undefined);
    assert.equal(b.tom, undefined);
    assert.equal(b.cliente, 'Davi Lo');
    assert.equal(b.formato, 'reels');
    assert.deepEqual(b.duracaoAlvoS, [36, 60]);
    assert.deepEqual(b.pedidos, ['tirar gaguejadas e repetições', 'legenda amarela']);
    assert.equal(b.naoPodeFaltar, undefined); // "legenda amarela" é pedido; "chamada para o curso" não está no texto
  });
  test('tarefa da 04h ("entrega sexta"): prazo por regra, cliente inventado descartado', async () => {
    const b = await parseTask(TAREFA_04H, { hoje: HOJE, ask: lixo });
    assert.equal(b.prazo, '2026-10-23');
    assert.equal(b.cliente, undefined);
    assert.deepEqual(b.pedidos, ['legenda amarela']);
  });
  test('"Prazo 20/10" vence o prazo do LLM', async () => {
    const b = await parseTask('Reels pro Davi. Prazo 20/10.', { hoje: HOJE, ask: async () => ({ prazo: '2026-11-30' }) });
    assert.equal(b.prazo, '2026-10-20');
  });
  test('prazo do LLM só com palavra de prazo no texto, dentro de [hoje, hoje+365]', async () => {
    const texto = 'Entrega no dia do lançamento do curso.';
    assert.equal((await parseTask(texto, { hoje: HOJE, ask: async () => ({ prazo: '2026-11-03' }) })).prazo, '2026-11-03');
    assert.equal((await parseTask(texto, { hoje: HOJE, ask: async () => ({ prazo: '2028-01-01' }) })).prazo, undefined);
    assert.equal((await parseTask(texto, { hoje: HOJE, ask: async () => ({ prazo: '2026-02-30' }) })).prazo, undefined);
    assert.equal((await parseTask('Reels do curso.', { hoje: HOJE, ask: async () => ({ prazo: '2026-11-03' }) })).prazo, undefined);
  });
  test('tom e cliente do LLM valem quando estão no texto', async () => {
    const b = await parseTask('Vídeo da Clínica Sorriso, bem animado e alto astral.', { hoje: HOJE, ask: async () => ({ tom: 'animado', cliente: 'Clínica Sorriso', formato: 'banana' }) });
    assert.equal(b.tom, 'animado');
    assert.equal(b.cliente, 'Clínica Sorriso');
    assert.equal(b.formato, undefined);
  });
  test('LLM que falha ou devolve não-objeto: fica a regra', async () => {
    assert.equal((await parseTask(TAREFA_DAVI, { hoje: HOJE, ask: async () => { throw new Error('timeout'); } })).cliente, 'Davi Lo');
    assert.equal((await parseTask(TAREFA_DAVI, { hoje: HOJE, ask: async () => null as unknown as Record<string, unknown> })).cliente, 'Davi Lo');
  });
});
