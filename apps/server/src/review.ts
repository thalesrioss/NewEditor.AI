/**
 * Revisão da decupagem — o que o editor humano precisa olhar antes de liberar a finalização.
 *
 * Em vez de assistir o vídeo inteiro, uma fila curta, na ordem do vídeo:
 *  - tomadas que o agente descartou (escolha de tomada é onde ele mais erra);
 *  - cortes grandes de "bastidor";
 *  - dúvidas que o próprio agente registrou na decupagem;
 *  - palavras que ficaram no corte e estão fora do dicionário (a transcrição ouviu errado: "eustosina") ou com
 *    pouca confiança — a grafia corrigida vale para legenda, lettering e motion.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixedText, sameWordAt, sourceToTimeline, type Project, type TextWord } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { misspelled } from './spell.ts';
import { store } from './store.ts';

export interface ReviewDoubt {
  id: string;
  kind: 'tomada' | 'corte' | 'agente' | 'palavra' | 'nome';
  assetId: string;
  /** Trecho no bruto (para ouvir). */
  in: number;
  out: number;
  /** Onde fica na timeline (o corte, ou a palavra). */
  at: number | null;
  text: string;
  question: string;
  removalId?: string;
  /** Palavra: início no bruto (identifica a correção) e sugestões do corretor. */
  wordAt?: number;
  suggestions?: string[];
  /** alta = decisão de verdade (tomada completa, conteúdo cortado, grafia); baixa = rotina (fragmento abandonado). */
  prioridade: 'alta' | 'baixa';
  /** Tomada: o trecho que o agente deixou no lugar desta (para trocar uma pela outra). */
  swap?: { in: number; out: number; text: string };
}

/** Tem frase completa (termina em . ? ! sem ser reticência) com pelo menos `min` palavras? */
const hasSentence = (t: string, min: number) => t.split(/(?<=[.?!])(?<!\.\.\.)(?<!…)\s+/).some((s) => /[^.][.?!]$/.test(s.trim()) && s.trim().split(/\s+/).length >= min);

const STOPLIKE = /^(tá|ta|pra|pro|né|aí|tô|cê|vc|hum|ahn|eh|ah|oh|ok)$/i;
const strip = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

export async function reviewDoubts(p: Project): Promise<ReviewDoubt[]> {
  const dir = store.dir(p.id);
  const tl = p.timeline;
  const resolved = new Set(p.review?.resolvidas ?? []);
  const out: ReviewDoubt[] = [];
  const ids = [...new Set(tl.main.map((c) => c.assetId))];

  for (const assetId of ids) {
    const a = p.assets.find((x) => x.id === assetId);
    if (!a?.transcript) continue;
    const words: TextWord[] = (await readTranscript(path.join(dir, a.transcript))).words;
    const between = (i0: number, i1: number) => words.filter((w) => (w.c ?? (w.start + w.end) / 2) >= i0 && (w.c ?? (w.start + w.end) / 2) < i1);
    const textOf = (ws: TextWord[]) => ws.map((w) => fixedText(tl, assetId, w)).join(' ');
    const nearAt = (src: number) => sourceToTimeline(tl, assetId, src) ?? sourceToTimeline(tl, assetId, src + 0.05);
    /** Posição de um corte na timeline: onde a fala que sobrou encosta nele. */
    const cutAt = (i0: number, i1: number) => {
      const kept = tl.main.filter((c) => c.assetId === assetId);
      const after = kept.find((c) => c.in >= i1 - 0.05);
      return after ? nearAt(after.in) : nearAt(i0 - 0.05);
    };

    // 1–2. Cortes do agente que são decisão (tomada / bastidor grande).
    for (const r of tl.removals.filter((x) => x.assetId === assetId && x.by === 'agent')) {
      const ws = between(r.in, r.out).filter((w) => strip(w.w).length > 0);
      const take = r.kind === 'retake' || r.kind === 'false_start';
      const big = r.kind === 'offscript' && ws.length >= 5;
      if (!(take && ws.length >= 3) && !big) continue;
      // A tomada que ficou: a fala mantida logo depois do corte, até o fim da frase.
      let swap: ReviewDoubt['swap'];
      if (take) {
        const keptAfter = words.filter((w) => {
          const m = w.c ?? (w.start + w.end) / 2;
          return m >= r.out - 0.02 && m < r.out + 30 && tl.main.some((c) => c.assetId === assetId && m >= c.in && m < c.out);
        });
        const first = keptAfter[0];
        if (first && first.start - r.out < 3) {
          let k = 0;
          while (k < keptAfter.length - 1 && k < 24 && !/[^.][.?!]$/.test(keptAfter[k]!.w)) k++;
          const seg = keptAfter.slice(0, k + 1);
          swap = { in: Math.max(r.out, seg[0]!.start - 0.03), out: seg[seg.length - 1]!.end + 0.03, text: textOf(seg) };
        }
      }
      out.push({
        id: `cut:${assetId}:${r.in.toFixed(2)}`,
        kind: take ? 'tomada' : 'corte',
        assetId,
        in: r.in,
        out: r.out,
        at: cutAt(r.in, r.out),
        text: textOf(ws),
        question: take ? 'Cortei esta tomada e deixei a seguinte. Esta era melhor?' : `Cortei como ${r.reason.split(':')[0] || 'bastidor'}. Era isso mesmo?`,
        removalId: r.id,
        prioridade: hasSentence(textOf(ws), take ? 4 : 5) ? 'alta' : 'baixa',
        swap,
      });
    }

    // 3. Dúvidas registradas pelo próprio agente.
    try {
      const dec = JSON.parse(await fs.readFile(path.join(dir, assetId, 'decupagem.json'), 'utf8')) as { decision?: { doubts?: { from: number; to: number; question: string }[] } };
      for (const d of dec.decision?.doubts ?? []) {
        const ws = words.slice(d.from, d.to + 1);
        if (!ws.length) continue;
        out.push({ id: `agente:${assetId}:${ws[0]!.start.toFixed(2)}`, kind: 'agente', assetId, in: ws[0]!.start, out: ws[ws.length - 1]!.end, at: nearAt(ws[0]!.start) ?? cutAt(ws[0]!.start, ws[ws.length - 1]!.end), text: textOf(ws), question: d.question, prioridade: 'alta' });
      }
    } catch {
      /* sem decupagem salva */
    }

    // 4. Palavras no corte: fora do dicionário (provável erro da transcrição) ou de baixa confiança.
    const kept = words.filter((w) => {
      const m = w.c ?? (w.start + w.end) / 2;
      return tl.main.some((c) => c.assetId === assetId && m >= c.in && m < c.out);
    });
    const tokens = kept.map((w) => strip(fixedText(tl, assetId, w))).filter((t) => t.length >= 3 && !/\d/.test(t) && !STOPLIKE.test(t));
    const wrong = await misspelled(tokens);
    for (const w of kept) {
      const fixed = tl.wordFixes?.some((f) => f.text !== undefined && f.assetId === assetId && sameWordAt(f.at, w.start));
      if (fixed) continue;
      const t = strip(w.w);
      const sug = wrong.get(t);
      // Confiança baixa só conta em palavra longa (as curtas comuns vêm com p baixo à toa).
      const lowConf = ((w as TextWord & { p?: number }).p ?? 1) < 0.1 && t.length >= 6 && !STOPLIKE.test(t);
      if (!sug && !lowConf) continue;
      const name = /^\p{Lu}/u.test(t) && !!sug;
      out.push({
        id: `palavra:${assetId}:${w.start.toFixed(2)}`,
        kind: name ? 'nome' : 'palavra',
        assetId,
        in: Math.max(0, w.start - 1.2),
        out: w.end + 1.2,
        at: nearAt(w.start),
        text: t,
        question: name ? `Confira a grafia do nome "${t}".` : sug ? `"${t}" não está no dicionário — a transcrição pode ter ouvido errado.` : `A transcrição ficou em dúvida em "${t}".`,
        wordAt: w.start,
        suggestions: sug ?? [],
        prioridade: 'alta',
      });
    }
  }
  return out.filter((d) => !resolved.has(d.id)).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}
