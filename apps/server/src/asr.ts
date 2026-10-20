import fs from 'node:fs/promises';
import { asrGlossarioArgs } from '@neweditor/core';
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
export async function transcribe(wavPath: string, outJson: string, language = 'pt', chunks?: { start: number; end: number }[], glossario?: string[]): Promise<Transcript> {
  let chunksFile: string | undefined;
  if (chunks?.length) {
    chunksFile = outJson.replace(/\.json$/, '.chunks.json');
    await fs.writeFile(chunksFile, JSON.stringify(chunks.map((c) => [Math.round(c.start * 1000) / 1000, Math.round(c.end * 1000) / 1000])));
  }
  await atomic(outJson, (tmp) => run('uv', asrArgs(wavPath, tmp, language, chunksFile, glossario)));
  return readTranscript(outJson);
}

/** Argumentos do `uv` para o script de ASR. Glossário vazio (BL-0081) = os mesmos argumentos de antes. */
export function asrArgs(wavPath: string, outJson: string, language: string, chunksFile?: string, glossario?: string[]): string[] {
  return ['run', '--quiet', '--python', '3.12', '--with', 'mlx-whisper', ASR_SCRIPT, wavPath, outJson, language, ...(chunksFile ? ['--chunks', chunksFile] : []), ...asrGlossarioArgs(glossario)];
}

/** Grava o centro sonoro de cada palavra no próprio transcript (o Editor Brain usa para riscar o que saiu). */
export async function writeCenters(file: string, tr: Transcript, centers: number[]): Promise<void> {
  tr.words.forEach((w, i) => (w.c = Math.round((centers[i] ?? (w.start + w.end) / 2) * 1000) / 1000));
  await fs.writeFile(file, JSON.stringify(tr));
}

export async function readTranscript(file: string): Promise<Transcript> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Transcript;
}
