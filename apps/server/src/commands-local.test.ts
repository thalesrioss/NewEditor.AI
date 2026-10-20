/**
 * Pedidos de zoom pelo chat no modo local (BL-0020 / FB-0018): com texto entre aspas o zoom vai no
 * clipe que contém essa fala; fala que não está na timeline responde "Não achei" e não muda nada;
 * sem aspas, continua no clipe sob o cursor. Projeto montado à mão (asset + transcrição de fixture),
 * sem FFmpeg nem ASR.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-cmd-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

let projectId = '';

// Fonte de 20 s; a timeline usa 0–5, 5–10 e 12–20 (10–12 foi cortado).
const words = [
  ['oi', 1.0, 1.3],
  ['pessoal', 1.3, 1.8],
  ['cresceu', 2.0, 2.4],
  ['40%', 2.4, 2.9],
  ['tudo', 6.0, 6.3],
  ['mudou', 6.3, 6.7],
  ['cortado', 10.5, 11.0],
  ['eu', 13.0, 13.2],
  ['tomo', 13.2, 13.5],
  ['decisões', 13.5, 14.0],
  ['melhores', 14.0, 14.5],
].map(([w, start, end]) => ({ w: w as string, start: start as number, end: end as number, p: 0.99 }));

before(async () => {
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Teste de comandos', 'projeto de teste');
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
    },
  });
});

// Espera o debounce de gravação (400 ms) antes de apagar a pasta.
after(async () => {
  await new Promise((r) => setTimeout(r, 600));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const zooms = async () => {
  const { store } = await import('./store.ts');
  return Object.fromEntries(store.get(projectId).timeline.main.map((c) => [c.id, c.zoom ?? 1]));
};

describe('zoom pelo chat', () => {
  test('palavra entre aspas: zoom no clipe dessa fala, não no do cursor', async () => {
    const { runLocalCommand } = await import('./commands-local.ts');
    const answer = await runLocalCommand(projectId, 'dá um zoom de 1.2 em "Tudo"', 0);
    assert.deepEqual(await zooms(), { c1: 1, c2: 1.2, c3: 1 });
    assert.match(answer, /zoom 1\.2× no clipe 2 \(0:05, onde fala "Tudo"\)/);
  });

  test('frase entre aspas: acha a frase inteira na transcrição', async () => {
    const { runLocalCommand } = await import('./commands-local.ts');
    const answer = await runLocalCommand(projectId, 'dá um zoom de 1.1 na frase “eu tomo decisões melhores”', 0);
    assert.deepEqual(await zooms(), { c1: 1, c2: 1, c3: 1.1 });
    assert.match(answer, /clipe 3/);
  });

  test('texto que não está na fala da timeline: "Não achei" e timeline intacta', async () => {
    const { runLocalCommand } = await import('./commands-local.ts');
    const { store } = await import('./store.ts');
    for (const cited of ['não existe isso', 'cortado']) {
      const v = store.get(projectId).version;
      const answer = await runLocalCommand(projectId, `dá um zoom de 1.3 em "${cited}"`, 0);
      assert.equal(answer, `Não achei "${cited}" na fala.`);
      assert.equal(store.get(projectId).version, v, 'nenhuma operação aplicada');
      assert.deepEqual(await zooms(), { c1: 1, c2: 1, c3: 1 });
    }
  });

  test('sem aspas: mantém o clipe sob o cursor', async () => {
    const { runLocalCommand } = await import('./commands-local.ts');
    const answer = await runLocalCommand(projectId, 'dá um zoom de 1.2 aqui', 11);
    assert.deepEqual(await zooms(), { c1: 1, c2: 1, c3: 1.2 });
    assert.match(answer, /zoom 1\.2× no clipe 3 \(0:10\)\.$/);
  });

  test('número dentro das aspas não vira o valor do zoom', async () => {
    const { runLocalCommand } = await import('./commands-local.ts');
    // Sem tirar a citação, "40%" viraria zoom 1.4.
    await runLocalCommand(projectId, 'dá um zoom em "cresceu 40%"', 8);
    assert.deepEqual(await zooms(), { c1: 1.1, c2: 1, c3: 1 });
  });
});

// BL-0076 / FB-0126: o punch-in automático (ritmo.ts) deixa `zoomTo` no clipe; o zoom pedido no chat é fixo.
describe('zoom do chat sobre punch-in automático', () => {
  const punchIn = async () => {
    const { store } = await import('./store.ts');
    store.apply(projectId, { by: 'agent', op: { type: 'set_zoom', clipId: 'c2', zoom: 1.083, zoomTo: 1.1 } });
  };
  const c2 = async () => {
    const { store } = await import('./store.ts');
    return store.get(projectId).timeline.main.find((c) => c.id === 'c2')!;
  };

  test('"zoom de 1.2" fica 1.2 fixo, sem herdar o zoomTo 1.1', async () => {
    const { zoomAt } = await import('@neweditor/core');
    const { runCommand } = await import('./agent.ts');
    await punchIn();
    await runCommand(projectId, 'dá um zoom de 1.2 em "tudo mudou"', 0);
    const c = await c2();
    assert.equal(c.zoom, 1.2);
    assert.equal('zoomTo' in c, false);
    assert.equal(zoomAt(c, 4.9), 1.2);
  });

  test('"tira o zoom" deixa o clipe sem zoom nenhum (não vira zoom-in 1→1.1)', async () => {
    const { zoomAt } = await import('@neweditor/core');
    const { runCommand } = await import('./agent.ts');
    await punchIn();
    await runCommand(projectId, 'tira o zoom em "tudo mudou"', 0);
    const c = await c2();
    assert.equal(c.zoom ?? 1, 1);
    assert.equal('zoomTo' in c, false);
    assert.equal(zoomAt(c, 0), 1);
    assert.equal(zoomAt(c, 4.9), 1);
  });

  test('o pedido é um passo de desfazer: 1 desfazer volta o punch-in animado', async () => {
    const { store } = await import('./store.ts');
    const { runCommand } = await import('./agent.ts');
    await punchIn();
    await runCommand(projectId, 'dá um zoom de 1.2 em "tudo mudou"', 0);
    assert.equal(store.undo(projectId), true);
    const c = await c2();
    assert.equal(c.zoom, 1.083);
    assert.equal(c.zoomTo, 1.1);
  });

  test('clipe sem zoomTo continua igual', async () => {
    const { runCommand } = await import('./agent.ts');
    await runCommand(projectId, 'dá um zoom de 1.2 em "tudo mudou"', 0);
    const c = await c2();
    assert.equal(c.zoom, 1.2);
    assert.equal('zoomTo' in c, false);
  });
});
