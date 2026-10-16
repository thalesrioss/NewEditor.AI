import type { RemovalKind } from '@neweditor/core';
import type { Word } from '../asr.ts';
import { analyze, complement, keptRanges, type Analysis, type BorderOptions, type KeepRange, type Range } from './analyze.ts';
import { decide, keepMask, type DecisionResult } from './decide.ts';

export interface PlannedRemoval extends Range {
  kind: RemovalKind;
  reason: string;
}

export interface DecupagemPlan {
  analysis: Analysis;
  decision: DecisionResult;
  keeps: KeepRange[];
  removals: PlannedRemoval[];
  uncovered: number;
  stats: { sourceDuration: number; resultDuration: number; cuts: number };
}

export interface PlanHooks {
  onStage?: (stage: 'analyzing' | 'thinking' | 'cutting', message: string) => void;
}

const KIND_MAP: Record<string, RemovalKind> = {
  retake: 'retake',
  false_start: 'false_start',
  offscript: 'offscript',
  filler: 'filler',
};

export async function planDecupagem(
  words: Word[],
  env: Float32Array,
  duration: number,
  brief: string,
  hooks: PlanHooks = {},
  border: Partial<BorderOptions> = {},
): Promise<DecupagemPlan> {
  hooks.onStage?.('analyzing', 'Medindo pausas e procurando tomadas repetidas');
  const analysis = analyze(words, env);

  hooks.onStage?.('thinking', `Escolhendo as melhores tomadas (${analysis.utterances.length} falas, ${analysis.hints.length} pistas)`);
  const decision = await decide(words, analysis, brief);
  const { keep, segOf, uncovered } = keepMask(words, decision);

  const keeps = keptRanges(words, keep, analysis, border);
  const removals: PlannedRemoval[] = complement(keeps, duration).map((r) => {
    // Classifica pelo trecho cortado do modelo que mais se sobrepõe a esta remoção.
    let best: { kind: RemovalKind; reason: string; overlap: number } | undefined;
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const s = segOf[i];
      if (keep[i] || !s) continue;
      const ov = Math.min(r.end, w.end) - Math.max(r.start, w.start);
      if (ov <= 0) continue;
      if (!best || ov > best.overlap) best = { kind: KIND_MAP[s.kind] ?? 'manual', reason: s.reason, overlap: ov };
    }
    return best ? { ...r, kind: best.kind, reason: best.reason } : { ...r, kind: 'silence' as const, reason: 'pausa / ar morto' };
  });

  const resultDuration = keeps.reduce((a, k) => a + (k.end - k.start), 0);
  return { analysis, decision, keeps, removals, uncovered, stats: { sourceDuration: duration, resultDuration, cuts: removals.length } };
}
