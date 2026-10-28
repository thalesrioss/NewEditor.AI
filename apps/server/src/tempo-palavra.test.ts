/**
 * CH-0041 (NewStudios, eq2210-20): a legenda do 'ele' (bruto C3070) entrava 3–4 quadros depois da voz porque o ASR
 * marca o início em 179,95 e a forma de onda mostra a voz em 179,85 (início do trecho na timeline). A op `fix_words`
 * passa a aceitar start/end: a legenda (preview e render usam o mesmo buildCues) abre na voz, com desfazer, e o
 * tempo é validado contra a transcrição. Sem ASR e sem FFmpeg: asset e transcrição são escritos aqui.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-tempo-palavra-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const { store } = await import('./store.ts');
const { buildCues, DEFAULT_CAPTIONS, OpError } = await import('@neweditor/core');

const WORDS = [
  { w: 'isso', start: 179.2, end: 179.5 },
  { w: 'ok.', start: 179.5, end: 179.8 },
  { w: 'ele', start: 179.95, end: 180.2 },
  { w: 'falou', start: 180.2, end: 180.6 },
  { w: 'tudo.', start: 180.6, end: 181.0 },
];

/** eq2210-20: trecho do C3070 começando em 179,85 (a voz), legenda ligada. */
async function projeto() {
  const p = await store.create('CH-0041', '');
  const id = 'ast_c3070';
  fs.mkdirSync(path.join(store.dir(p.id), id), { recursive: true });
  fs.writeFileSync(path.join(store.dir(p.id), id, 'transcript.json'), JSON.stringify({ language: 'pt', duration: 300, model: 'whisper', words: WORDS, segments: [] }));
  store.upsertAsset(p.id, { id, name: 'C3070.MP4', path: '/x/C3070.MP4', kind: 'video', duration: 300, hasAudio: true, role: 'fala', transcript: `${id}/transcript.json` });
  store.apply(p.id, { by: 'agent', op: { type: 'set_main', clips: [{ id: 'c1', assetId: id, in: 179.85, out: 182, by: 'agent' }] } });
  store.apply(p.id, { by: 'agent', op: { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, enabled: true, style: 'frase' } } });
  return { pid: p.id, id };
}

const cues = (pid: string) => {
  const tl = store.get(pid).timeline;
  return buildCues(tl, { ast_c3070: WORDS }, tl.captions!);
};
const recusa = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => e instanceof OpError && re.test(e.message));

describe('corrigir início e fim de palavra (CH-0041)', () => {
  after(async () => {
    await store.flush();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('o caso do Tomás: start do ele em 179,85 abre a legenda no 1º quadro do trecho, e desfaz', async () => {
    const { pid, id } = await projeto();
    assert.equal(cues(pid)[0]!.start.toFixed(3), '0.100'); // o bug: 3 quadros a 30 fps depois da voz
    store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 179.95, start: 179.85 }] } });
    const c = cues(pid)[0]!;
    assert.equal(c.start, 0);
    assert.equal(c.words[0]!.text, 'ele');
    assert.equal(c.words[0]!.start, 0);
    assert.equal(c.words[0]!.src?.at, 179.95, 'a palavra continua identificada pelo início do ASR (ajustes de legenda presos a ela seguem valendo)');
    assert.deepEqual(store.get(pid).timeline.wordFixes, [{ assetId: id, at: 179.95, start: 179.85 }]);
    assert.ok(store.undo(pid));
    assert.equal(cues(pid)[0]!.start.toFixed(3), '0.100');
    assert.ok(store.redo(pid));
    assert.equal(cues(pid)[0]!.start, 0);
  });

  test('grafia e tempo convivem: trocar o texto não perde o tempo, e null volta ao tempo do ASR', async () => {
    const { pid, id } = await projeto();
    store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 179.95, start: 179.85 }] } });
    store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 179.95, text: 'Ele' }] } });
    assert.deepEqual(store.get(pid).timeline.wordFixes, [{ assetId: id, at: 179.95, text: 'Ele', start: 179.85 }]);
    assert.equal(cues(pid)[0]!.words[0]!.text, 'Ele');
    assert.equal(cues(pid)[0]!.start, 0);
    store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 179.95, start: null }] } });
    assert.equal(cues(pid)[0]!.start.toFixed(3), '0.100');
    store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 179.95, text: '' }] } });
    assert.equal(store.get(pid).timeline.wordFixes?.length, 0);
  });

  test('fim da palavra também corrige (o destaque da palavra anda junto)', async () => {
    const { pid, id } = await projeto();
    store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 179.95, start: 179.85, end: 180.1 }, { assetId: id, at: 180.2, start: 180.1 }] } });
    const ws = cues(pid)[0]!.words;
    assert.equal(ws[0]!.end.toFixed(3), '0.250');
    assert.equal(ws[1]!.start.toFixed(3), '0.250');
  });

  test('recusa tempo inválido e a timeline fica como estava', async () => {
    const { pid, id } = await projeto();
    const antes = JSON.stringify(store.get(pid).timeline);
    const op = (f: Record<string, unknown>) => () => store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 179.95, ...f }] } });
    recusa(op({ start: 180.3, end: 180.1 }), /menor que end/);
    recusa(op({ start: 180.25 }), /start 180.25 ≥ end 180.2/);
    recusa(op({ start: -1 }), /número ≥ 0/);
    recusa(op({ start: 179.7 }), /antes do fim de 'ok\.'.*179\.8/);
    recusa(op({ end: 180.4 }), /depois do início de 'falou'/);
    recusa(op({ start: 182.1, end: 182.2 }), /depois do início de 'falou'/);
    recusa(() => store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 150, start: 150.1 }] } }), /não há palavra começando em 150/);
    // Fora do trecho: 'isso' e 'ok.' não estão na montagem; 'tudo.' está e não pode sair do clipe 179,85–182.
    store.apply(pid, { by: 'agent', op: { type: 'set_main', clips: [{ id: 'c1', assetId: id, in: 179.85, out: 180.9, by: 'agent' }] } });
    const antes2 = JSON.stringify(store.get(pid).timeline);
    recusa(() => store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 180.6, end: 181.5 }] } }), /sairia do trecho 179.85–180.9/);
    assert.equal(JSON.stringify(store.get(pid).timeline), antes2);
    assert.notEqual(antes, antes2);
    // A vizinha corrigida na mesma op libera o espaço.
    store.apply(pid, { by: 'agent', op: { type: 'set_main', clips: [{ id: 'c1', assetId: id, in: 179.85, out: 182, by: 'agent' }] } });
    store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 179.5, end: 179.7 }, { assetId: id, at: 179.95, start: 179.75 }] } });
    assert.equal(store.get(pid).timeline.wordFixes?.length, 2);
  });

  test('correção só de grafia não depende da transcrição (como antes)', async () => {
    const { pid, id } = await projeto();
    store.apply(pid, { by: 'human', op: { type: 'fix_words', fixes: [{ assetId: id, at: 999, text: 'qualquer' }] } });
    assert.equal(store.get(pid).timeline.wordFixes?.[0]?.text, 'qualquer');
  });
});
