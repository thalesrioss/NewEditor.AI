/**
 * Reescrita do LLM local nunca muda a timeline sozinha (BL-0048, ADR-0005, FB-0062/FB-0065): quando o
 * interpretador local não entende, a frase reescrita vira sugestão no chat ("Aplicar"); molde copiado ao pé da
 * letra é descartado; nenhum `human` no log com texto que o editor não mandou. LLM simulado com as reescritas
 * vistas no FB-0062. Projeto montado à mão, sem FFmpeg nem ASR.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { LogEntry, ServerMessage } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-agent-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_BRAIN = 'local';

let projectId = '';

const words = [
  ['oi', 1.0, 1.3],
  ['pessoal', 1.3, 1.8],
  ['cresceu', 2.0, 2.4],
  ['muito', 2.4, 2.9],
  ['tudo', 6.0, 6.3],
  ['mudou', 6.3, 6.7],
  ['eu', 13.0, 13.2],
  ['tomo', 13.2, 13.5],
  ['decisões', 13.5, 14.0],
  ['melhores', 14.0, 14.5],
].map(([w, start, end]) => ({ w: w as string, start: start as number, end: end as number, p: 0.99 }));

/** Pedido do cliente → o que o LLM local devolveu (FB-0062). */
const REESCRITAS: Record<string, string | null> = {
  'abaixa a música nesse trecho': "tira o trecho onde ele fala 'oi pessoal cresceu muito'",
  'a legenda tá pequena, aumenta um pouco': 'dá um zoom de 1.05 a 1.3 aqui',
  'coloca um som de whoosh nessa transição': 'dá um zoom de 1.05 aqui',
  'deixa a cor mais quente aqui': "tira o trecho onde ele fala 'tudo mudou'",
  'troca a fonte do lettering': null,
};
const deps = {
  llm: async () => true,
  ask: async (q: { user: string }) => ({ comando: REESCRITAS[/Pedido do editor: "(.*)"/.exec(q.user)![1]!] ?? null }),
};

before(async () => {
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Teste do agente', 'projeto de teste');
  projectId = p.id;
  fs.writeFileSync(path.join(store.dir(p.id), 'transcript.json'), JSON.stringify({ language: 'pt', duration: 20, model: 'fixture', words, segments: [] }));
  store.upsertAsset(p.id, { id: 'a1', name: 'fala.mp4', path: path.join(tmp, 'fala.mp4'), kind: 'video', duration: 20, hasAudio: true, role: 'fala', transcript: 'transcript.json' });
});

beforeEach(async () => {
  const { store } = await import('./store.ts');
  store.apply(projectId, {
    by: 'human',
    op: {
      type: 'set_main',
      clips: [
        { id: 'c1', assetId: 'a1', in: 0, out: 5, by: 'human' },
        { id: 'c2', assetId: 'a1', in: 5, out: 10, by: 'human' },
        { id: 'c3', assetId: 'a1', in: 12, out: 20, by: 'human' },
      ],
      removals: [],
    },
  });
});

// Espera o debounce de gravação (400 ms) antes de apagar a pasta.
after(async () => {
  await new Promise((r) => setTimeout(r, 600));
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** O que a tela recebe ao abrir o projeto (últimos 80 logs). */
async function logs(): Promise<LogEntry[]> {
  const { store } = await import('./store.ts');
  const out: LogEntry[] = [];
  const ws = { send: (s: string) => { const m = JSON.parse(s) as ServerMessage; if (m.type === 'log') out.push(m.entry); } };
  store.attach(projectId, ws as never);
  store.detach(projectId, ws as never);
  return out;
}

describe('reescrita do LLM local', () => {
  test('os 5 pedidos do FB-0062: timeline idêntica, sugestão ou "Ainda não entendi"', async () => {
    const { store } = await import('./store.ts');
    const { runCommand, SUGESTAO } = await import('./agent.ts');
    const antes = structuredClone(store.get(projectId).timeline);
    const respostas: Record<string, string> = {};
    for (const pedido of Object.keys(REESCRITAS)) respostas[pedido] = await runCommand(projectId, pedido, 3, deps);
    assert.deepEqual(store.get(projectId).timeline, antes);

    assert.equal(respostas['abaixa a música nesse trecho'], `${SUGESTAO} "tira o trecho onde ele fala 'oi pessoal cresceu muito'"`);
    assert.equal(respostas['coloca um som de whoosh nessa transição'], `${SUGESTAO} "dá um zoom de 1.05 aqui"`);
    assert.equal(respostas['deixa a cor mais quente aqui'], `${SUGESTAO} "tira o trecho onde ele fala 'tudo mudou'"`);
    assert.match(respostas['a legenda tá pequena, aumenta um pouco']!, /^Ainda não entendi/); // molde literal
    assert.match(respostas['troca a fonte do lettering']!, /^Ainda não entendi/);

    const l = await logs();
    const humanos = l.filter((e) => e.by === 'human').map((e) => e.text);
    assert.deepEqual(humanos.filter((t) => !(t in REESCRITAS)), [], 'nenhum human com texto que o editor não mandou');
    const sugestoes = l.filter((e) => e.suggestion);
    assert.equal(sugestoes.length, 3);
    assert.ok(sugestoes.every((e) => e.by === 'agent'));
    assert.deepEqual(sugestoes[0]!.suggestion, { text: "tira o trecho onde ele fala 'oi pessoal cresceu muito'", playhead: 3 });
  });

  test('"Aplicar" manda a sugestão como pedido: aí sim muda a timeline e entra como human', async () => {
    const { store } = await import('./store.ts');
    const { runCommand } = await import('./agent.ts');
    const v0 = store.get(projectId).version;
    const sugestao = (await logs()).find((e) => e.suggestion)!.suggestion!;
    const r = await runCommand(projectId, sugestao.text, sugestao.playhead, deps);
    assert.match(r, /^Cortei/);
    assert.ok(store.get(projectId).version > v0);
    assert.equal((await logs()).filter((e) => e.by === 'human').at(-1)!.text, sugestao.text);
  });

  test('pedido que a gramática local entende segue direto, sem passar pelo LLM', async () => {
    const { store } = await import('./store.ts');
    const { runCommand } = await import('./agent.ts');
    let chamou = false;
    const r = await runCommand(projectId, "tira o trecho onde ele fala 'tudo mudou'", 0, { llm: async () => true, ask: async () => ((chamou = true), { comando: null }) });
    assert.match(r, /^Cortei/);
    assert.equal(chamou, false);
    assert.ok(store.get(projectId).timeline.removals.length > 0);
  });
});
