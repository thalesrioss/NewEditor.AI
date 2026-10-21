/**
 * Importar transcrição conferida (CH-0002, NewStudios): quando o ASR erra palavra ou tempo (retake, fala
 * rápida), o editor traz a transcrição que ele conferiu e ela passa a ser a do asset. Aceita o formato do
 * Editor Brain ({ words: [{ w, start, end }] }) e o do Whisper ({ segments: [{ words: [{ word, start, end }] }] }).
 * A do ASR fica guardada em transcript.asr-original.json; os centros sonoros são medidos de novo na forma de onda.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Transcript, Word } from './asr.ts';
import { analyze } from './decupagem/analyze.ts';
import { readEnvelope } from './media.ts';
import { store } from './store.ts';

type InWord = { w?: unknown; word?: unknown; text?: unknown; start?: unknown; end?: unknown; p?: unknown; probability?: unknown };
type InSegment = { start?: unknown; end?: unknown; text?: unknown; words?: InWord[] };
export interface TranscriptInput {
  words?: InWord[];
  segments?: InSegment[];
  language?: string;
  /** Quem conferiu (vai para o arquivo, para o rastro). */
  fonte?: string;
}

const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Valida e normaliza: texto não vazio, 0 ≤ start ≤ end ≤ duração, em ordem de início. */
export function parseTranscriptInput(body: TranscriptInput, duration: number): { words: Word[]; segments: Transcript['segments'] } {
  const raw: InWord[] = Array.isArray(body?.words) && body.words.length ? body.words : Array.isArray(body?.segments) ? body.segments.flatMap((s) => (Array.isArray(s?.words) ? s.words : [])) : [];
  if (!raw.length) throw bad('transcrição vazia: mande words [{ w, start, end }] ou segments [{ words: [{ word, start, end }] }]');
  const words: Word[] = raw.map((x, i) => {
    const w = String(x?.w ?? x?.word ?? x?.text ?? '').trim();
    const start = Number(x?.start);
    const end = Number(x?.end);
    if (!w) throw bad(`palavra ${i + 1} sem texto`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) throw bad(`palavra ${i + 1} ("${w}") com tempo inválido: start ${String(x?.start)}, end ${String(x?.end)}`);
    if (duration > 0 && start > duration + 0.05) throw bad(`palavra ${i + 1} ("${w}") começa em ${start}s, depois do fim do arquivo (${r3(duration)}s)`);
    const p = Number(x?.p ?? x?.probability ?? 1);
    return { w, start: r3(start), end: r3(duration > 0 ? Math.min(end, duration) : end), p: Number.isFinite(p) ? r3(p) : 1 };
  });
  words.sort((a, b) => a.start - b.start || a.end - b.end);
  // Segmentos: os que vieram (com texto), senão um por pausa de 0,7 s ou mais entre palavras.
  const given = Array.isArray(body?.segments) ? body.segments.filter((s) => Number.isFinite(Number(s?.start)) && Number.isFinite(Number(s?.end)) && String(s?.text ?? '').trim()) : [];
  const segments: Transcript['segments'] = given.length
    ? given.map((s) => ({ start: r3(Number(s.start)), end: r3(Number(s.end)), text: String(s.text).trim() }))
    : words.reduce<Transcript['segments']>((acc, w) => {
        const last = acc[acc.length - 1];
        if (last && w.start - last.end < 0.7) Object.assign(last, { end: Math.max(last.end, w.end), text: `${last.text} ${w.w}` });
        else acc.push({ start: w.start, end: w.end, text: w.w });
        return acc;
      }, []);
  return { words, segments };
}

/** Troca a transcrição do asset pela conferida; devolve quantas palavras ficaram. */
export async function importTranscript(projectId: string, assetId: string, body: TranscriptInput): Promise<{ palavras: number; original: string | null }> {
  const a = store.get(projectId).assets.find((x) => x.id === assetId);
  if (!a) throw Object.assign(new Error('asset não existe'), { statusCode: 404 });
  const dir = path.join(store.dir(projectId), a.id);
  await fs.mkdir(dir, { recursive: true });
  const { words, segments } = parseTranscriptInput(body, a.duration ?? 0);
  const file = path.join(dir, 'transcript.json');
  const backup = path.join(dir, 'transcript.asr-original.json');
  // Guarda a do ASR só na primeira importação (importar de novo não apaga o original).
  let original: string | null = null;
  try {
    await fs.access(backup);
    original = `${a.id}/transcript.asr-original.json`;
  } catch {
    try {
      await fs.copyFile(file, backup, fs.constants.COPYFILE_EXCL);
      original = `${a.id}/transcript.asr-original.json`;
    } catch {
      /* não havia transcrição do ASR */
    }
  }
  let centers: number[] = [];
  if (a.envelope) {
    try {
      centers = analyze(words, await readEnvelope(path.join(store.dir(projectId), a.envelope))).centers;
    } catch {
      /* sem forma de onda: centro = meio da palavra */
    }
  }
  words.forEach((w, i) => (w.c = r3(centers[i] ?? (w.start + w.end) / 2)));
  const tr: Transcript & { importado: string; fonte?: string } = { language: body.language ?? 'pt', duration: a.duration ?? 0, model: 'importado', importado: new Date().toISOString(), fonte: body.fonte, words, segments };
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(tr));
  await fs.rename(tmp, file);
  // Reenvia o asset: o Editor Brain recarrega a transcrição (e um bruto sem papel vira fala).
  store.upsertAsset(projectId, { ...a, transcript: `${a.id}/transcript.json`, role: a.role ?? 'fala' });
  store.log(projectId, 'human', `Transcrição de ${a.name} importada (${words.length} palavras${body.fonte ? `, ${body.fonte}` : ''}); a do ASR ficou em transcript.asr-original.json`);
  return { palavras: words.length, original };
}
