/**
 * CH-0002 (NewStudios): ASR com palavra trocada ("nunca doa" por "dorme") e tempo 1,8 s atrasado em fala com
 * retake. O editor importa a transcrição conferida: ela vira a do asset, a do ASR fica guardada e os centros
 * sonoros são medidos de novo. Sem ASR e sem FFmpeg: asset, transcrição e forma de onda são escritos aqui.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-trimport-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const { store } = await import('./store.ts');
const { importTranscript, parseTranscriptInput } = await import('./transcript-import.ts');

/** Projeto com um bruto de 5 s: fala (energia) de 1,0 a 2,0 s e transcrição do ASR errada. */
async function projeto() {
  const p = await store.create('CH-0002', '');
  const id = 'ast_fala';
  const dir = path.join(store.dir(p.id), id);
  fs.mkdirSync(dir, { recursive: true });
  const env = new Float32Array(500).map((_, i) => (i >= 100 && i < 200 ? 0.5 : 0.001));
  fs.writeFileSync(path.join(dir, 'envelope.f32'), Buffer.from(env.buffer));
  const asr = { language: 'pt', duration: 5, model: 'whisper', words: [{ w: 'nunca', start: 2.8, end: 3.1, p: 0.9 }, { w: 'doa', start: 3.1, end: 3.4, p: 0.4 }], segments: [{ start: 2.8, end: 3.4, text: 'nunca doa' }] };
  fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify(asr));
  store.upsertAsset(p.id, { id, name: 'C0606.MP4', path: '/x/C0606.MP4', kind: 'video', duration: 5, hasAudio: true, role: 'fala', envelope: `${id}/envelope.f32`, transcript: `${id}/transcript.json` });
  return { pid: p.id, id, dir };
}

const ler = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

describe('importar transcrição conferida (CH-0002)', () => {
  after(async () => {
    await store.flush();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('troca palavra e tempo, guarda a do ASR e mede os centros', async () => {
    const { pid, id, dir } = await projeto();
    // fora de ordem de propósito: o servidor ordena por início
    const r = await importTranscript(pid, id, { words: [{ w: 'dorme.', start: 1.5, end: 2.0 }, { w: 'nunca', start: 1.0, end: 1.5 }], fonte: 'Lia' });
    assert.equal(r.palavras, 2);
    const tr = ler(path.join(dir, 'transcript.json'));
    assert.deepEqual(tr.words.map((w: { w: string }) => w.w), ['nunca', 'dorme.']);
    assert.equal(tr.words[0].start, 1);
    assert.equal(tr.model, 'importado');
    assert.equal(tr.fonte, 'Lia');
    for (const w of tr.words) assert.ok(w.c >= w.start && w.c <= w.end, `centro ${w.c} fora de ${w.start}-${w.end}`);
    assert.equal(tr.segments[0].text, 'nunca dorme.');
    assert.equal(ler(path.join(dir, 'transcript.asr-original.json')).words[1].w, 'doa');
    // importar de novo não sobrescreve o original do ASR
    await importTranscript(pid, id, { words: [{ w: 'dorme', start: 1.5, end: 2.0 }] });
    assert.equal(ler(path.join(dir, 'transcript.asr-original.json')).words[1].w, 'doa');
    assert.equal(store.get(pid).assets.find((a) => a.id === id)?.transcript, `${id}/transcript.json`);
  });

  test('aceita o JSON do Whisper (segments[].words[].word)', () => {
    const { words, segments } = parseTranscriptInput({ segments: [{ start: 1, end: 2, text: ' E o seu agente', words: [{ word: ' E', start: 1, end: 1.1, probability: 0.9 }, { word: ' agente', start: 1.1, end: 2 }] }] }, 5);
    assert.deepEqual(words.map((w) => w.w), ['E', 'agente']);
    assert.equal(words[0]?.p, 0.9);
    assert.equal(segments[0]?.text, 'E o seu agente');
  });

  test('entrada inválida é erro 400 com a palavra culpada', () => {
    const e400 = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error & { statusCode?: number }) => e.statusCode === 400 && re.test(e.message));
    e400(() => parseTranscriptInput({}, 5), /vazia/);
    e400(() => parseTranscriptInput({ words: [{ w: 'oi', start: 2, end: 1 }] }, 5), /palavra 1 \("oi"\) com tempo inválido/);
    e400(() => parseTranscriptInput({ words: [{ w: 'oi', start: 9, end: 9.2 }] }, 5), /depois do fim/);
    e400(() => parseTranscriptInput({ words: [{ w: ' ', start: 1, end: 2 }] }, 5), /sem texto/);
  });

  test('asset que não existe é 404', async () => {
    const { pid } = await projeto();
    await assert.rejects(importTranscript(pid, 'nao_existe', { words: [{ w: 'oi', start: 0, end: 1 }] }), (e: Error & { statusCode?: number }) => e.statusCode === 404);
  });
});
