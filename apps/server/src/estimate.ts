/**
 * Tempo de cada etapa (ADR-007, I-10): grava quanto cada etapa levou em cada projeto e estima as próximas
 * pelo histórico (mediana de segundos por minuto de material), com um chute inicial só enquanto não há dados.
 */
import { timelineDuration, type Project, type StepId } from '@neweditor/core';
import { store } from './store.ts';

/** Chute inicial, em segundos por minuto de material, enquanto não há histórico. */
const SEED: Record<StepId, { perMin: number; fixed: number; base: 'bruto' | 'timeline' }> = {
  ingest: { perMin: 4, fixed: 10, base: 'bruto' },
  decupar: { perMin: 1.2, fixed: 8, base: 'bruto' },
  revisao: { perMin: 90, fixed: 60, base: 'timeline' },
  cor: { perMin: 0, fixed: 5, base: 'timeline' },
  legenda: { perMin: 0, fixed: 1, base: 'timeline' },
  motions: { perMin: 1.5, fixed: 4, base: 'timeline' },
  letterings: { perMin: 1, fixed: 3, base: 'timeline' },
  qc: { perMin: 0.5, fixed: 2, base: 'timeline' },
  final: { perMin: 60, fixed: 60, base: 'timeline' },
  render: { perMin: 40, fixed: 10, base: 'timeline' },
  alteracao: { perMin: 20, fixed: 30, base: 'timeline' },
  broll: { perMin: 6, fixed: 8, base: 'timeline' },
  trilha: { perMin: 0.5, fixed: 6, base: 'timeline' },
};

const rawMin = (p: Project) => p.assets.filter((a) => a.role === 'fala').reduce((s, a) => s + a.duration, 0) / 60;
const tlMin = (p: Project) => timelineDuration(p.timeline) / 60;

export function stepStart(projectId: string, step: StepId): void {
  const p = store.get(projectId);
  const timings = { ...(p.timings ?? {}) };
  timings[step] = { startedAt: new Date().toISOString() };
  store.update(projectId, { timings });
}

export function stepEnd(projectId: string, step: StepId): number | undefined {
  const p = store.get(projectId);
  const t = p.timings?.[step];
  if (!t || t.endedAt) return t?.seconds;
  const seconds = Math.max(0, (Date.now() - new Date(t.startedAt).getTime()) / 1000);
  store.update(projectId, { timings: { ...p.timings, [step]: { ...t, endedAt: new Date().toISOString(), seconds } } });
  return seconds;
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Segundos por minuto de material observados em TODOS os projetos (mediana), por etapa. */
function observed(step: StepId): { perMin?: number; n: number } {
  const base = SEED[step].base;
  const rates: number[] = [];
  for (const p of store.list()) {
    const t = p.timings?.[step];
    const mins = base === 'bruto' ? rawMin(p) : tlMin(p);
    if (t?.seconds && mins > 0.2) rates.push(t.seconds / mins);
  }
  return { perMin: median(rates), n: rates.length };
}

export interface StepEstimate {
  step: StepId;
  seconds: number;
  /** De quantos projetos veio a calibração (0 = chute inicial). */
  amostras: number;
}

/** Estimativa de uma etapa para este projeto. */
export function estimateStep(p: Project, step: StepId): StepEstimate {
  const seed = SEED[step];
  const mins = seed.base === 'bruto' ? rawMin(p) : tlMin(p) || rawMin(p) * 0.3;
  const obs = observed(step);
  const perMin = obs.perMin ?? seed.perMin;
  return { step, seconds: Math.round((obs.n ? 0 : seed.fixed) + perMin * mins), amostras: obs.n };
}

/** Etapas do agente que ainda faltam, pelo status, e o total estimado. */
export function estimateRemaining(p: Project): { steps: StepEstimate[]; totalSeconds: number } {
  const order: StepId[] = ['decupar', 'cor', 'legenda', 'broll', 'trilha', 'motions', 'letterings', 'qc', 'render'];
  const from: Record<string, number> = { fila: 0, decupando: 0, revisao: 1, finalizando: 1, editado: 6, alteracao: 6, entregue: 7 };
  const steps = order.slice(from[p.status] ?? 0).map((s) => estimateStep(p, s));
  return { steps, totalSeconds: steps.reduce((a, s) => a + s.seconds, 0) };
}
