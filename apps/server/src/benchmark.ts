/**
 * Banco de benchmark da decupagem (ADR-007, I-2 e I-4): cada corte APROVADO pelo humano vira um gabarito em
 * data/benchmark/<projeto>/gabarito.json. `npm run bench:all` roda o cérebro local em todos e imprime a tabela
 * (IoU de tempo, palavras iguais, o que o agente cortou demais e o que deixou passar). O histórico fica em
 * resultados.jsonl, então uma regressão aparece como queda em relação à rodada anterior.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@neweditor/core';
import { DATA_DIR } from './config.ts';
import { store } from './store.ts';

export const BENCH_DIR = path.join(path.dirname(DATA_DIR), 'benchmark');

export interface Gabarito {
  projectId: string;
  name: string;
  client?: string;
  profileId?: string;
  savedAt: string;
  /** 'aprovado' = corte base aprovado na revisão; 'entregue' = peça final (passou por corte editorial). */
  label: 'aprovado' | 'entregue';
  assets: { id: string; name: string; path: string; duration: number; transcript: string; envelope: string }[];
  /** Trechos mantidos no bruto, por asset. */
  kept: Record<string, { in: number; out: number }[]>;
  removals: { assetId: string; in: number; out: number; kind: string; by: string }[];
}

export async function saveGabarito(p: Project, label: Gabarito['label']): Promise<string | null> {
  const dir = store.dir(p.id);
  const assets = p.assets.filter((a) => a.transcript && a.envelope && p.timeline.main.some((c) => c.assetId === a.id));
  if (!assets.length) return null;
  const kept: Gabarito['kept'] = {};
  for (const c of p.timeline.main) (kept[c.assetId] ??= []).push({ in: c.in, out: c.out });
  const g: Gabarito = {
    projectId: p.id,
    name: p.name,
    client: p.client,
    profileId: p.profileId,
    savedAt: new Date().toISOString(),
    label,
    assets: assets.map((a) => ({ id: a.id, name: a.name, path: a.path, duration: a.duration, transcript: path.join(dir, a.transcript!), envelope: path.join(dir, a.envelope!) })),
    kept,
    removals: p.timeline.removals.map((r) => ({ assetId: r.assetId, in: r.in, out: r.out, kind: r.kind, by: r.by })),
  };
  const out = path.join(BENCH_DIR, p.id);
  await fs.mkdir(out, { recursive: true });
  const file = path.join(out, `gabarito-${label}.json`);
  await fs.writeFile(file, JSON.stringify(g, null, 1));
  return file;
}

export async function listGabaritos(): Promise<Gabarito[]> {
  const out: Gabarito[] = [];
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(BENCH_DIR);
  } catch {
    return out;
  }
  for (const d of dirs) {
    for (const label of ['aprovado', 'entregue'] as const) {
      try {
        out.push(JSON.parse(await fs.readFile(path.join(BENCH_DIR, d, `gabarito-${label}.json`), 'utf8')) as Gabarito);
      } catch {
        /* sem esse gabarito */
      }
    }
  }
  return out;
}

export interface BenchResult {
  projectId: string;
  name: string;
  label: string;
  profileId?: string;
  iou: number;
  words: number;
  /** Segundos que o agente cortou e o humano manteve, e vice-versa. */
  cortouDemais: number;
  deixouPassar: number;
  at: string;
}

const RESULTS = path.join(BENCH_DIR, 'resultados.jsonl');

export async function appendResult(r: BenchResult): Promise<void> {
  await fs.mkdir(BENCH_DIR, { recursive: true });
  await fs.appendFile(RESULTS, `${JSON.stringify(r)}\n`);
}

export async function previousResult(projectId: string, label: string): Promise<BenchResult | undefined> {
  try {
    const lines = (await fs.readFile(RESULTS, 'utf8')).trim().split('\n');
    return lines.map((l) => JSON.parse(l) as BenchResult).filter((r) => r.projectId === projectId && r.label === label).pop();
  } catch {
    return undefined;
  }
}

/** IoU de tempo entre dois conjuntos de trechos (segundos de interseção / união). */
export function rangeIou(a: { in: number; out: number }[], b: { in: number; out: number }[]): { iou: number; onlyA: number; onlyB: number } {
  const len = (r: { in: number; out: number }[]) => r.reduce((s, x) => s + Math.max(0, x.out - x.in), 0);
  let inter = 0;
  for (const x of a) for (const y of b) inter += Math.max(0, Math.min(x.out, y.out) - Math.max(x.in, y.in));
  const la = len(a);
  const lb = len(b);
  const union = la + lb - inter;
  return { iou: union > 0 ? inter / union : 1, onlyA: la - inter, onlyB: lb - inter };
}
