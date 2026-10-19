/**
 * Corte por frase não deixa sílaba solta (BL-0021 / FB-0022): o agente cortou a pausa 51,18–51,34 e depois,
 * a pedido, a frase 51,45–53,11; sobrava o "Da" (0,11 s) como um clipe "pisca". Agora o corte por frase vai
 * até a remoção vizinha quando o resto é mais curto que um "pisca", numa operação só (um passo de desfazer).
 * Projeto montado à mão (asset + transcrição de fixture), sem FFmpeg nem ASR.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-frase-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

let projectId = '';

const words = [
  ['de', 50.6, 50.8],
  ['tudo', 50.8, 51.1],
  ['da', 51.34, 51.45],
  ['empresa', 51.48, 52.2],
  ['casamento', 52.3, 53.06],
  ['a', 53.2, 53.3],
  ['vida', 53.3, 53.6],
  ['social', 53.6, 54.1],
].map(([w, start, end]) => ({ w: w as string, start: start as number, end: end as number, p: 0.99 }));

before(async () => {
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Teste de corte por frase', 'projeto de teste');
  projectId = p.id;
  fs.writeFileSync(path.join(store.dir(p.id), 'transcript.json'), JSON.stringify({ language: 'pt', duration: 60, model: 'fixture', words, segments: [] }));
  store.upsertAsset(p.id, { id: 'a1', name: 'fala.mp4', path: path.join(tmp, 'fala.mp4'), kind: 'video', duration: 60, hasAudio: true, role: 'fala', transcript: 'transcript.json' });
});

beforeEach(async () => {
  const { store } = await import('./store.ts');
  store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: 'a1', in: 0, out: 60, by: 'system' }], removals: [] } });
  store.apply(projectId, { by: 'agent', op: { type: 'cut_source', assetId: 'a1', in: 51.18, out: 51.34, kind: 'silence', reason: 'pausa' } });
});

// Espera o debounce de gravação (400 ms) antes de apagar a pasta.
after(async () => {
  await new Promise((r) => setTimeout(r, 600));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('caso do FB-0022: um corte 51,18–53,11, sem o "Da" solto, um passo de desfazer, QC sem pisca', async () => {
  const { store } = await import('./store.ts');
  const { runLocalCommand } = await import('./commands-local.ts');
  const { runQc } = await import('./qc.ts');
  const before = store.get(projectId).timeline;

  const answer = await runLocalCommand(projectId, 'tira o trecho onde ele fala "empresa casamento"', 0);
  assert.match(answer, /Cortei "empresa casamento"/);

  const tl = store.get(projectId).timeline;
  assert.equal(tl.main.length, 2);
  close(tl.main[0]!.out, 51.18);
  close(tl.main[1]!.in, 53.11);
  // Sem buraco: as duas remoções se encostam em 51,34 e cobrem 51,18–53,11.
  const rs = tl.removals.map((r) => [r.in, r.out]);
  assert.equal(rs.length, 2);
  close(rs[0]![1]!, rs[1]![0]!);
  close(rs[1]![1]!, 53.11);

  const qc = await runQc(projectId);
  assert.ok(!qc.issues.some((i) => i.regra === 'pisca'), JSON.stringify(qc.issues.filter((i) => i.regra === 'pisca')));

  // Um ⌘Z volta ao estado só com a pausa cortada.
  assert.ok(store.undo(projectId));
  assert.deepEqual(store.get(projectId).timeline, before);
});

test('resto longo (≥ 0,35 s) fica: o corte por frase não engole fala de verdade', async () => {
  const { store } = await import('./store.ts');
  const { runLocalCommand } = await import('./commands-local.ts');
  await runLocalCommand(projectId, 'tira o trecho onde ele fala "casamento"', 0);
  const tl = store.get(projectId).timeline;
  // 51,34–52,27 (o "da empresa") continua na timeline.
  assert.equal(tl.main.length, 3);
  close(tl.main[1]!.in, 51.34);
  close(tl.main[1]!.out, 52.27);
});
