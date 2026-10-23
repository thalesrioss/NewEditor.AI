/**
 * Fila GLOBAL de trabalho do agente (ADR-004 / ADR-007 F-2, F-6): um conteúdo por vez, como o canvas pede.
 * O Kanban mostra a posição de cada projeto na fila.
 *
 * Trabalhos NOMEADOS (`enqueueJob`) são gravados em data/fila.json e retomados quando o servidor reinicia
 * (um render ou uma decupagem interrompida volta sozinha). `enqueue` continua existindo para trabalhos
 * avulsos, que não sobrevivem a reinício.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

export type JobKind = 'decupagem' | 'finalizar' | 'render' | 'alteracoes' | 'ingest';

export interface Job {
  id: string;
  projectId: string;
  kind: JobKind | 'avulso';
  label: string;
  payload?: Record<string, unknown>;
  /** Menor = antes. Pedidos do humano (render, alteração) passam na frente do que é automático. */
  priority: number;
  at: string;
  state: 'fila' | 'rodando';
}

type Handler = (projectId: string, payload: Record<string, unknown>, job: Job) => Promise<unknown>;

const FILE = path.join(path.dirname(DATA_DIR), 'fila.json');
/** Como terminou o último trabalho nomeado de cada projeto (CH-0019): sobrevive a reinício, para quem pergunta por HTTP. */
const RESULTS_FILE = path.join(path.dirname(DATA_DIR), 'fila-resultados.json');
const handlers = new Map<JobKind, Handler>();
const queue: (Job & { run: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void })[] = [];
let running: (typeof queue)[number] | null = null;
const cancelled = new Set<string>();
let seq = 0;

export interface JobResult {
  jobId: string;
  kind: JobKind;
  label: string;
  estado: 'ok' | 'falhou';
  at: string;
  erro?: string;
}
let results: Record<string, JobResult> | null = null;

async function loadResults(): Promise<Record<string, JobResult>> {
  if (!results) {
    try {
      results = JSON.parse(await fs.readFile(RESULTS_FILE, 'utf8')) as Record<string, JobResult>;
    } catch {
      results = {};
    }
  }
  return results;
}

async function recordResult(job: Job, e?: unknown): Promise<void> {
  if (job.kind === 'avulso') return;
  const r = await loadResults();
  r[job.projectId] = { jobId: job.id, kind: job.kind, label: job.label, estado: e === undefined ? 'ok' : 'falhou', at: new Date().toISOString(), ...(e !== undefined && { erro: explicarFalha(e instanceof Error ? e.message : String(e)) }) };
  await fs.writeFile(RESULTS_FILE, JSON.stringify(r, null, 1)).catch(() => undefined);
}

/** Último trabalho nomeado do projeto que terminou (ok ou falhou). */
export async function lastResult(projectId: string): Promise<JobResult | undefined> {
  return (await loadResults())[projectId];
}

/**
 * Erro do ffmpeg num arquivo de disco externo (/Volumes/...) quase sempre é o disco que dormiu ou desconectou:
 * diz isso ao editor em vez de só "moov atom not found" (CH-0019).
 */
export function explicarFalha(msg: string): string {
  const vol = /\/Volumes\/([^/]+)\//.exec(msg)?.[1];
  if (vol && /moov atom not found|Invalid data found|No such file|Input\/output error|Operation not permitted/i.test(msg)) {
    return `${msg.trim()}\nO arquivo está no disco externo "${vol}": confira se ele está conectado e peça o trabalho de novo.`;
  }
  return msg;
}

export function registerJob(kind: JobKind, handler: Handler): void {
  handlers.set(kind, handler);
}

export function isBusy(projectId: string): string | undefined {
  if (running?.projectId === projectId) return running.label;
  return queue.find((j) => j.projectId === projectId)?.label;
}

/** Posição na fila (1 = próximo). 0 = rodando agora. undefined = nada na fila para este projeto. */
export function queuePosition(projectId: string): number | undefined {
  if (running?.projectId === projectId) return 0;
  const i = queue.findIndex((j) => j.projectId === projectId);
  return i >= 0 ? i + 1 : undefined;
}

export function queueState(): { running: Job | null; queue: Job[] } {
  const strip = (j: (typeof queue)[number]): Job => ({ id: j.id, projectId: j.projectId, kind: j.kind, label: j.label, payload: j.payload, priority: j.priority, at: j.at, state: j.state });
  return { running: running ? strip(running) : null, queue: queue.map(strip) };
}

export function cancelJob(id: string): boolean {
  const i = queue.findIndex((j) => j.id === id);
  if (i >= 0) {
    const [j] = queue.splice(i, 1);
    j!.reject(new Error('cancelado'));
    void persist();
    return true;
  }
  if (running?.id === id) {
    // Quem está rodando confere `isCancelled` entre os passos.
    cancelled.add(id);
    return true;
  }
  return false;
}

/** Cancela tudo que está na fila para o projeto e marca o que estiver rodando (quem roda confere `isCancelled`). */
export function cancelJobsFor(projectId: string): number {
  let n = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i]!.projectId !== projectId) continue;
    const [j] = queue.splice(i, 1);
    j!.reject(new Error('cancelado: projeto apagado'));
    n++;
  }
  if (running?.projectId === projectId) {
    cancelled.add(running.id);
    n++;
  }
  if (n) void persist();
  return n;
}

export const isCancelled = (id: string) => cancelled.has(id);

function push(job: Omit<Job, 'state'> & { run: () => Promise<unknown> }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    queue.push({ ...job, state: 'fila', resolve, reject });
    queue.sort((a, b) => a.priority - b.priority || a.at.localeCompare(b.at));
    void persist();
    void pump();
  });
}

async function pump(): Promise<void> {
  if (running || !queue.length) return;
  running = queue.shift()!;
  running.state = 'rodando';
  await persist();
  try {
    const v = await running.run();
    await recordResult(running);
    running.resolve(v);
  } catch (e) {
    await recordResult(running, e);
    running.reject(e);
  } finally {
    cancelled.delete(running.id);
    running = null;
    await persist();
    void pump();
  }
}

/** Trabalho avulso (não sobrevive a reinício). */
export function enqueue<T>(projectId: string, label: string, job: () => Promise<T>, priority = 5): Promise<T> {
  return push({ id: `job_${Date.now().toString(36)}_${++seq}`, projectId, kind: 'avulso', label, priority, at: new Date().toISOString(), run: job }) as Promise<T>;
}

/** Trabalho nomeado: gravado na fila e retomado se o servidor reiniciar. */
export function enqueueJob<T>(projectId: string, kind: JobKind, payload: Record<string, unknown> = {}, opts: { label?: string; priority?: number; id?: string } = {}): Promise<T> {
  const h = handlers.get(kind);
  if (!h) throw new Error(`trabalho "${kind}" sem executor`);
  const id = opts.id ?? `job_${Date.now().toString(36)}_${++seq}`;
  const label = opts.label ?? LABEL[kind];
  const job: Omit<Job, 'state'> = { id, projectId, kind, label, payload, priority: opts.priority ?? PRIORITY[kind], at: new Date().toISOString() };
  return push({ ...job, run: () => h(projectId, payload, { ...job, state: 'rodando' }) }) as Promise<T>;
}

const LABEL: Record<JobKind, string> = { decupagem: 'decupando', finalizar: 'finalizando', render: 'renderizando', alteracoes: 'fazendo alterações', ingest: 'preparando o material' };
const PRIORITY: Record<JobKind, number> = { render: 1, alteracoes: 2, finalizar: 3, decupagem: 4, ingest: 4 };

async function persist(): Promise<void> {
  const list = [...(running && running.kind !== 'avulso' ? [running] : []), ...queue.filter((j) => j.kind !== 'avulso')].map((j) => ({ id: j.id, projectId: j.projectId, kind: j.kind, label: j.label, payload: j.payload, priority: j.priority, at: j.at }));
  await fs.writeFile(FILE, JSON.stringify(list, null, 1)).catch(() => undefined);
}

/** Na subida do servidor: volta a fila gravada (quem estava rodando volta para o começo da fila). */
export async function resumeJobs(onError: (projectId: string, kind: string, e: unknown) => void): Promise<number> {
  let saved: Omit<Job, 'state'>[] = [];
  try {
    saved = JSON.parse(await fs.readFile(FILE, 'utf8')) as Omit<Job, 'state'>[];
  } catch {
    return 0;
  }
  let n = 0;
  for (const j of saved) {
    if (j.kind === 'avulso' || !handlers.has(j.kind)) continue;
    n++;
    enqueueJob(j.projectId, j.kind, j.payload, { label: j.label, priority: j.priority, id: j.id }).catch((e) => onError(j.projectId, j.kind, e));
  }
  return n;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
