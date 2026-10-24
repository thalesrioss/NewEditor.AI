import path from 'node:path';
import { buildCues, type Project, type TextWord } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { store } from './store.ts';

/**
 * Legenda ligada sem nenhuma palavra para mostrar (CH-0031): o arquivo da montagem ficou sem transcrição
 * (registrado com outro nome, transcrição importada perdida). Antes o render saía sem legenda em silêncio.
 * Devolve o aviso, ou null quando está tudo certo (legenda desligada, há palavras ou não há clipe).
 */
export function captionsWithoutWords(p: Project, cues: number): string | null {
  const tl = p.timeline;
  if (!tl.captions?.enabled || cues > 0 || !tl.main.length) return null;
  const ids = [...new Set(tl.main.map((c) => c.assetId))];
  const sem = ids.map((id) => p.assets.find((a) => a.id === id)).filter((a) => a && !a.transcript).map((a) => a!.name);
  return `legenda ligada, mas nenhuma palavra transcrita nos clipes da montagem${sem.length ? ` (sem transcrição: ${sem.join(', ')})` : ''} — sai sem legenda; importe a transcrição (POST /assets/<id>/transcript) ou desligue a legenda`;
}

/** O mesmo aviso, lendo as transcrições do projeto (para o QC). */
export async function captionsWithoutWordsOf(p: Project): Promise<string | null> {
  if (!p.timeline.captions?.enabled) return null;
  const transcripts: Record<string, TextWord[]> = {};
  for (const a of p.assets) if (a.transcript) transcripts[a.id] = (await readTranscript(path.join(store.dir(p.id), a.transcript)).catch(() => ({ words: [] }))).words;
  return captionsWithoutWords(p, buildCues(p.timeline, transcripts, p.timeline.captions, { includeHidden: true }).length);
}
