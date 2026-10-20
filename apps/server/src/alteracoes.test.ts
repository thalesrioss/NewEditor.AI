/**
 * Alteração sem efeito não conta como feita (BL-0049, FB-0063): o status de cada comentário sai da timeline
 * (mudou → feito; não mudou → manual), não do texto da resposta. Projeto montado à mão, sem FFmpeg nem ASR.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-alteracoes-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_BRAIN = 'local';

let projectId = '';

const words = [
  ['oi', 1.0, 1.3],
  ['pessoal', 1.3, 1.8],
  ['tudo', 6.0, 6.3],
  ['mudou', 6.3, 6.7],
  ['eu', 13.0, 13.2],
  ['tomo', 13.2, 13.5],
].map(([w, start, end]) => ({ w: w as string, start: start as number, end: end as number, p: 0.99 }));

before(async () => {
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Teste de alterações', 'projeto de teste');
  projectId = p.id;
  fs.writeFileSync(path.join(store.dir(p.id), 'transcript.json'), JSON.stringify({ language: 'pt', duration: 20, model: 'fixture', words, segments: [] }));
  store.upsertAsset(p.id, { id: 'a1', name: 'fala.mp4', path: path.join(tmp, 'fala.mp4'), kind: 'video', duration: 20, hasAudio: true, role: 'fala', transcript: 'transcript.json' });
  store.apply(p.id, {
    by: 'human',
    op: {
      type: 'set_main',
      clips: [
        { id: 'c1', assetId: 'a1', in: 0, out: 10, by: 'human' },
        { id: 'c2', assetId: 'a1', in: 12, out: 20, by: 'human' },
      ],
      removals: [],
    },
  });
});

after(async () => {
  await (await import('./store.ts')).store.flush(); // grava o que espera o debounce de 400 ms antes de apagar a pasta
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runAlteracoes', () => {
  test('conta só o que mudou a timeline: corte feito, frase já cortada e pedido fora da gramática', async () => {
    const { store } = await import('./store.ts');
    const { addComment, runAlteracoes } = await import('./alteracoes.ts');
    const { listNotifications } = await import('./notify.ts');
    const corte = addComment(projectId, { at: 1, text: "tira o trecho onde ele fala 'tudo mudou'" });
    const repetido = addComment(projectId, { at: 2, text: "tira o trecho onde ele fala 'tudo mudou'" });
    const fora = addComment(projectId, { at: 3, text: 'troca a fonte do lettering' });

    assert.deepEqual(await runAlteracoes(projectId), { feitos: 1, manuais: 2 });

    const status = new Map((store.get(projectId).comments ?? []).map((c) => [c.id, c]));
    assert.equal(status.get(corte.id)!.status, 'feito');
    assert.equal(status.get(repetido.id)!.status, 'manual');
    assert.equal(status.get(fora.id)!.status, 'manual');
    assert.ok(status.get(fora.id)!.resposta, 'o manual guarda a resposta do agente');
    assert.equal(store.get(projectId).versions?.at(-1)?.label, 'Alterações (1 feitas, 2 manuais)');
    const [n] = (await listNotifications()).filter((x) => x.projectId === projectId);
    assert.match(n!.text, /1 pedido\(s\) atendido\(s\), 2 para fazer à mão/);
  });
});
