/**
 * Decupagem — parte EDITORIAL: decide quais palavras ficam.
 * Dois cérebros com a mesma saída (partição da fala em trechos MANTER / CORTAR com tipo e motivo):
 *  - local  (padrão): regras em código, sem API — ver local.ts
 *  - claude (opcional): ../claude/decide.ts, carregado só quando pedido (o SDK não entra no modo local)
 */
import { z } from 'zod';
import type { Word } from '../asr.ts';
import { BRAIN } from '../config.ts';
import type { Analysis } from './analyze.ts';
import { decideLocal } from './local.ts';

const Segment = z.object({
  from: z.number().int().describe('índice da primeira palavra do trecho'),
  to: z.number().int().describe('índice da última palavra do trecho (inclusive)'),
  keep: z.boolean(),
  kind: z.enum(['conteudo', 'retake', 'false_start', 'offscript', 'filler']),
  reason: z.string().describe('justificativa curta, em português'),
});

export const Decision = z.object({
  segments: z.array(Segment).describe('partição de TODAS as palavras, em ordem, sem buracos nem sobreposição'),
  summary: z.string().describe('3 a 5 linhas: o que o corte base faz e onde está mais frágil'),
  doubts: z
    .array(z.object({ from: z.number().int(), to: z.number().int(), question: z.string() }))
    .describe('trechos onde havia mais de uma escolha legítima e o humano deveria olhar'),
});

export type DecisionResult = z.infer<typeof Decision>;
export type DecisionSegment = z.infer<typeof Segment>;

export async function decide(words: Word[], an: Analysis, brief: string, brain = BRAIN): Promise<DecisionResult> {
  if (brain !== 'claude') return decideLocal(words, an);
  const { decideClaude } = await import('../claude/decide.ts');
  return decideClaude(words, an, brief);
}

/** Converte a partição em "fica/sai" por palavra, sendo conservador com o que o modelo não cobriu. */
export function keepMask(words: Word[], d: DecisionResult): { keep: boolean[]; segOf: (DecisionSegment | undefined)[]; uncovered: number } {
  const keep = new Array<boolean>(words.length).fill(true);
  const segOf = new Array<DecisionSegment | undefined>(words.length).fill(undefined);
  for (const s of d.segments) {
    for (let i = Math.max(0, s.from); i <= Math.min(words.length - 1, s.to); i++) {
      keep[i] = s.keep;
      segOf[i] = s;
    }
  }
  const uncovered = segOf.filter((s) => !s).length;
  return { keep, segOf, uncovered };
}
