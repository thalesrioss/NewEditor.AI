import fs from 'node:fs/promises';
import { ASR_SCRIPT } from './config.ts';
import { atomic, run } from './media.ts';

export interface Word {
  w: string;
  start: number;
  end: number;
  p: number;
  /** Centro sonoro medido na forma de onda (o ASR estica palavras por cima do silêncio). */
  c?: number;
  /** Trecho de fala de onde a palavra veio (transcrição por trecho). */
  k?: number;
}

export interface Transcript {
  language: string;
  duration: number;
  model: string;
  words: Word[];
  segments: { start: number; end: number; text: string }[];
}

/**
 * Transcreve local (mlx-whisper no Apple Silicon), com timestamp por palavra.
 * Com `chunks`, cada trecho de fala é transcrito separado — o texto passa a bater com o áudio mesmo
 * quando a pessoa repete a frase várias vezes (ver speechChunks).
 */
export async function transcribe(wavPath: string, outJson: string, language = 'pt', chunks?: { start: number; end: number }[]): Promise<Transcript> {
  const extra: string[] = [];
  if (chunks?.length) {
    const f = outJson.replace(/\.json$/, '.chunks.json');
    await fs.writeFile(f, JSON.stringify(chunks.map((c) => [Math.round(c.start * 1000) / 1000, Math.round(c.end * 1000) / 1000])));
    extra.push('--chunks', f);
  }
  await atomic(outJson, (tmp) => run('uv', ['run', '--quiet', '--python', '3.12', '--with', 'mlx-whisper', ASR_SCRIPT, wavPath, tmp, language, ...extra]));
  return readTranscript(outJson);
}

/** Grava o centro sonoro de cada palavra no próprio transcript (o Editor Brain usa para riscar o que saiu). */
export async function writeCenters(file: string, tr: Transcript, centers: number[]): Promise<void> {
  tr.words.forEach((w, i) => (w.c = Math.round((centers[i] ?? (w.start + w.end) / 2) * 1000) / 1000));
  await fs.writeFile(file, JSON.stringify(tr));
}

export async function readTranscript(file: string): Promise<Transcript> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Transcript;
}
