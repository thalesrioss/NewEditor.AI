/**
 * Um pedido do chat = um passo de desfazer (BL-0055, FB-0081): "tira as pausas longas" com 3 pausas vira UM passo
 * com o rótulo do pedido, um desfazer volta a timeline ao estado de antes, pedido sem efeito não cria passo (nem
 * apaga o refazer), e a resposta do agente leva o id do passo para o chat oferecer "Desfazer este pedido".
 * Projeto montado à mão (fala + envelope sintético), sem FFmpeg nem ASR.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { LogEntry, ServerMessage } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-desfazer-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_BRAIN = 'local';

let projectId = '';

// Três pausas longas dentro do clipe (0,9–10,6): 2,9–4,0 · 5,3–6,5 · 8,0–9,2. As das pontas ficam fora dele.
const words = [
  ['oi', 1.0, 1.4],
  ['pessoal', 1.4, 2.9],
  ['hoje', 4.0, 4.6],
  ['eu', 4.6, 5.3],
  ['vou', 6.5, 7.2],
  ['mostrar', 7.2, 8.0],
  ['tudo', 9.2, 9.8],
  ['isso', 9.8, 10.5],
].map(([w, start, end]) => ({ w: w as string, start: start as number, end: end as number, p: 0.99 }));

/** Envelope em dB a 100 Hz (ENV_HOP 0,01 s): voz nas palavras, quase silêncio no resto. */
function envelope(dur: number): Buffer {
  const env = new Float32Array(Math.round(dur / 0.01));
  for (let f = 0; f < env.length; f++) {
    const t = f * 0.01;
    env[f] = words.some((w) => t >= w.start && t < w.end) ? -20 : -70;
  }
  return Buffer.from(env.buffer);
}

before(async () => {
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Teste do desfazer por pedido', 'projeto de teste');
  projectId = p.id;
  fs.writeFileSync(path.join(store.dir(p.id), 'transcript.json'), JSON.stringify({ language: 'pt', duration: 12, model: 'fixture', words, segments: [] }));
  fs.writeFileSync(path.join(store.dir(p.id), 'envelope.f32'), envelope(12));
  store.upsertAsset(p.id, { id: 'a1', name: 'fala.mp4', path: path.join(tmp, 'fala.mp4'), kind: 'video', duration: 12, hasAudio: true, role: 'fala', transcript: 'transcript.json', envelope: 'envelope.f32' });
});

beforeEach(async () => {
  const { store } = await import('./store.ts');
  store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: 'a1', in: 0.9, out: 10.6, by: 'human' }], removals: [] } });
});

after(async () => {
  await (await import('./store.ts')).store.flush(); // grava o que espera o debounce de 400 ms antes de apagar a pasta
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** O que a tela recebe ao abrir o projeto: logs e estado do histórico. */
async function tela(): Promise<{ logs: LogEntry[]; history: Extract<ServerMessage, { type: 'snapshot' }>['history'] }> {
  const { store } = await import('./store.ts');
  const logs: LogEntry[] = [];
  let history!: Extract<ServerMessage, { type: 'snapshot' }>['history'];
  const ws = {
    send: (s: string) => {
      const m = JSON.parse(s) as ServerMessage;
      if (m.type === 'log') logs.push(m.entry);
      if (m.type === 'snapshot') history = m.history;
    },
  };
  store.attach(projectId, ws as never);
  store.detach(projectId, ws as never);
  return { logs, history };
}

describe('um pedido do chat = um passo de desfazer', () => {
  test('"tira as pausas longas" (3 pausas) vira 1 passo com o rótulo do pedido; 1 desfazer volta ao estado de antes', async () => {
    const { store } = await import('./store.ts');
    const { runCommand } = await import('./agent.ts');
    const antes = structuredClone(store.get(projectId).timeline);
    const labelAntes = store.historyState(projectId).undoLabel;

    const r = await runCommand(projectId, 'tira as pausas longas', 0);
    assert.match(r, /^Encurtei 3 pausas/);
    assert.equal(store.get(projectId).timeline.removals.length, 3);
    const h = store.historyState(projectId);
    assert.equal(h.undoLabel, 'Pedido: "tira as pausas longas"');
    assert.ok(h.undoId);

    // A resposta do agente leva o passo: o chat mostra "Desfazer este pedido" enquanto ele for o topo.
    const { logs, history } = await tela();
    assert.equal(history.undoId, h.undoId);
    assert.equal(logs.filter((e) => e.by === 'agent').at(-1)!.step, h.undoId);

    assert.equal(store.undo(projectId), true);
    assert.deepEqual(store.get(projectId).timeline, antes);
    assert.equal(store.historyState(projectId).undoLabel, labelAntes, 'um desfazer só, não N');
  });

  test('pedido que não muda nada não cria passo e não apaga o refazer', async () => {
    const { store } = await import('./store.ts');
    const { runCommand } = await import('./agent.ts');
    await runCommand(projectId, 'tira as pausas longas', 0);
    store.undo(projectId);
    const h0 = store.historyState(projectId);
    assert.equal(h0.canRedo, true);

    const r = await runCommand(projectId, 'troca a fonte do lettering', 0);
    assert.match(r, /^Ainda não entendi/);
    assert.deepEqual(store.historyState(projectId), h0);
    // A resposta tem um passo que não existe mais: o chat não oferece desfazer.
    const resposta = (await tela()).logs.filter((e) => e.by === 'agent').at(-1)!;
    assert.notEqual(resposta.step, store.historyState(projectId).undoId);
  });

  test('"desfaz" pelo chat desfaz o pedido inteiro (roda fora da transação)', async () => {
    const { store } = await import('./store.ts');
    const { runCommand } = await import('./agent.ts');
    const antes = structuredClone(store.get(projectId).timeline);
    await runCommand(projectId, 'tira as pausas longas', 0);
    const r = await runCommand(projectId, 'desfaz', 0);
    assert.equal(r, 'Desfiz a última alteração.');
    assert.deepEqual(store.get(projectId).timeline, antes);
  });

  test('desfazer + refazer devolve o pedido ao topo com o mesmo passo (o botão volta, FB-0098)', async () => {
    const { store } = await import('./store.ts');
    const { runCommand } = await import('./agent.ts');
    await runCommand(projectId, 'tira as pausas longas', 0);
    const passo = (await tela()).logs.filter((e) => e.by === 'agent').at(-1)!.step;
    assert.ok(passo);
    assert.equal(store.undo(projectId), true);
    assert.notEqual(store.historyState(projectId).undoId, passo);
    assert.equal(store.redo(projectId), true);
    const h = store.historyState(projectId);
    assert.equal(h.undoId, passo);
    assert.equal(h.undoLabel, 'Pedido: "tira as pausas longas"');
  });

  test('rótulo longo corta no fim de palavra, com "…" e aspas fechadas (FB-0099)', async () => {
    const { rotuloDoPedido } = await import('./agent.ts');
    assert.equal(rotuloDoPedido('  tira as pausas   longas '), 'Pedido: "tira as pausas longas"');
    assert.equal(rotuloDoPedido('tira a parte em que ele fala "pra acordar cedo"'), 'Pedido: "tira a parte em que ele fala "pra…""');
    assert.equal(rotuloDoPedido('deixa o gancho mais curto e tira a respiração do começo'), 'Pedido: "deixa o gancho mais curto e tira a…"');
    assert.equal(rotuloDoPedido('a'.repeat(50)), `Pedido: "${'a'.repeat(40)}…"`);
  });

  test('o próximo pedido tira o botão do anterior (o topo passa a ser o dele)', async () => {
    const { store } = await import('./store.ts');
    const { runCommand } = await import('./agent.ts');
    await runCommand(projectId, 'tira as pausas longas', 0);
    const primeiro = store.historyState(projectId).undoId;
    await runCommand(projectId, 'divide aqui', 3);
    const h = store.historyState(projectId);
    assert.equal(h.undoLabel, 'Pedido: "divide aqui"');
    assert.notEqual(h.undoId, primeiro);
  });
});
