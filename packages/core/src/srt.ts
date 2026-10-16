/** Legendas em .srt: ler, escrever e importar presas à fala (funções puras). */
import { placeWords, type Cue, type CueWord, type TextWord } from './text.ts';
import type { CaptionEditOp, Timeline } from './types.ts';

export interface SrtBlock {
  start: number;
  end: number;
  text: string;
}

const srtTime = (s: string) => {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
  return m ? +m[1]! * 3600 + +m[2]! * 60 + +m[3]! + +m[4]!.padEnd(3, '0').slice(0, 3) / 1000 : NaN;
};

/** Lê um .srt (ignora numeração, tags <i> e {\an8}). */
export function parseSrt(text: string): SrtBlock[] {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .flatMap((blk) => {
      const lines = blk.split('\n').map((l) => l.trim()).filter(Boolean);
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) return [];
      const [a, b] = lines[i]!.split('-->');
      const start = srtTime(a!);
      const end = srtTime(b!);
      const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>|\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
      return Number.isFinite(start) && Number.isFinite(end) && body ? [{ start, end, text: body }] : [];
    });
}

/**
 * Converte um .srt em ajustes de legenda presos à fala: cada bloco vira uma legenda sobre as palavras ditas no
 * tempo dele (texto do arquivo, mesmas fronteiras); trechos de fala sem bloco ficam ocultos. Substitui os ajustes atuais.
 */
export function srtToEdits(tl: Timeline, transcripts: Record<string, TextWord[] | undefined>, blocks: SrtBlock[]): { edits: CaptionEditOp[]; matched: number; skipped: number } {
  const words = placeWords(tl, transcripts).filter((w) => w.src);
  const reset: CaptionEditOp[] = (tl.captionEdits ?? []).map((e) => ({ assetId: e.assetId, at: e.at, patch: null }));
  const blockOf = (w: CueWord) => {
    const mid = (w.start + w.end) / 2;
    return blocks.findIndex((b) => mid >= b.start && mid < b.end);
  };
  const edits: CaptionEditOp[] = [];
  const used = new Set<number>();
  let prev: number | undefined;
  for (const w of words) {
    const b = blockOf(w);
    const id = { assetId: w.src!.assetId, at: w.src!.at };
    if (b >= 0 && b !== prev) {
      edits.push({ ...id, patch: { split: true, join: false, hidden: false, text: blocks[b]!.text } });
      used.add(b);
    } else if (b < 0 && prev !== -1) edits.push({ ...id, patch: { split: true, join: false, hidden: true, text: null } });
    else edits.push({ ...id, patch: { join: true, split: false, hidden: false, text: null } });
    prev = b;
  }
  return { edits: [...reset, ...edits], matched: used.size, skipped: blocks.length - used.size };
}

const stamp = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
};

/** Escreve as legendas visíveis em .srt. */
export function toSrt(cues: Cue[]): string {
  return cues
    .filter((c) => !c.hidden)
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.words.map((w) => w.text).join(' ')}\n`)
    .join('\n');
}
