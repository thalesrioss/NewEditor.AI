/**
 * Cérebro local, camada 3 (ADR-003 / ADR-007 I-9): um modelo aberto rodando no próprio Mac (MLX), só para o
 * que as regras não resolvem — melhor tomada, pedido em texto livre, palavra-chave, briefing. Sem API, sem
 * custo, sem o material sair da máquina.
 *
 * Fica DESLIGADO até ganhar das regras no benchmark (portão da ADR-003). Liga por `data/settings.json`
 * (`{"llm": {"enabled": true}}`) ou `NEWEDITOR_LLM=on`. O processo Python sobe na primeira pergunta e
 * fica vivo; se cair, a próxima pergunta sobe de novo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { DATA_DIR, ROOT } from './config.ts';

const SCRIPT = path.join(ROOT, 'services', 'llm', 'serve.py');
const SETTINGS = path.join(path.dirname(DATA_DIR), 'settings.json');
export const DEFAULT_MODEL = 'mlx-community/Qwen3-8B-4bit';

export interface LlmSettings {
  enabled: boolean;
  model: string;
  /** Para que a camada 3 pode ser usada (cada uso só liga depois de ganhar no benchmark). */
  usos: { tomada: boolean; comando: boolean; palavraChave: boolean; briefing: boolean; broll: boolean };
}

const DEFAULT_SETTINGS: LlmSettings = { enabled: process.env.NEWEDITOR_LLM === 'on', model: DEFAULT_MODEL, usos: { tomada: false, comando: true, palavraChave: false, briefing: true, broll: true } };

export async function llmSettings(): Promise<LlmSettings> {
  try {
    const j = JSON.parse(await fs.readFile(SETTINGS, 'utf8')) as { llm?: Partial<LlmSettings> };
    return { ...DEFAULT_SETTINGS, ...(j.llm ?? {}), usos: { ...DEFAULT_SETTINGS.usos, ...(j.llm?.usos ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setLlmSettings(patch: Partial<LlmSettings>): Promise<LlmSettings> {
  const cur = await llmSettings();
  const next: LlmSettings = { ...cur, ...patch, usos: { ...cur.usos, ...(patch.usos ?? {}) } };
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(await fs.readFile(SETTINGS, 'utf8')) as Record<string, unknown>;
  } catch {
    /* sem settings ainda */
  }
  await fs.writeFile(SETTINGS, JSON.stringify({ ...all, llm: next }, null, 2));
  if (!next.enabled || next.model !== cur.model) stop();
  return next;
}

/** O modelo já está baixado? (não baixa: isso é decisão do Thales) */
export async function modelDownloaded(model = DEFAULT_MODEL): Promise<boolean> {
  const home = process.env.HF_HUB_CACHE ?? path.join(process.env.HF_HOME ?? path.join(process.env.HOME ?? '', '.cache', 'huggingface'), 'hub');
  try {
    const dir = path.join(home, `models--${model.replace('/', '--')}`, 'snapshots');
    const snaps = await fs.readdir(dir);
    return snaps.length > 0;
  } catch {
    return false;
  }
}

interface Pending {
  resolve: (text: string) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

let proc: ChildProcess | null = null;
let ready: Promise<void> | null = null;
const pending = new Map<string, Pending>();
let seq = 0;

function stop(): void {
  proc?.kill('SIGTERM');
  proc = null;
  ready = null;
  for (const [, p] of pending) (clearTimeout(p.timer), p.reject(new Error('LLM reiniciado')));
  pending.clear();
}

async function ensure(model: string): Promise<void> {
  if (proc && ready) return ready;
  const child = spawn('uv', ['run', '--quiet', '--python', '3.12', '--with', 'mlx-lm', SCRIPT, model], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc = child;
  child.stderr?.on('data', () => undefined);
  child.on('exit', () => {
    if (proc === child) stop();
  });
  ready = new Promise<void>((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout! });
    const t = setTimeout(() => reject(new Error('o LLM local demorou demais para carregar')), 180_000);
    rl.on('line', (line) => {
      let msg: { ready?: boolean; id?: string; text?: string; error?: string };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        return;
      }
      if (msg.ready) return (clearTimeout(t), resolve());
      const p = msg.id ? pending.get(msg.id) : undefined;
      if (!p) return;
      pending.delete(msg.id!);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.text ?? '');
    });
  });
  return ready;
}

export interface Ask {
  system?: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
}

/** Pergunta ao modelo local. Lança se a camada 3 estiver desligada. */
export async function askLocal(q: Ask): Promise<string> {
  const s = await llmSettings();
  if (!s.enabled) throw new Error('LLM local desligado (data/settings.json → llm.enabled)');
  await ensure(s.model);
  const id = `q${++seq}`;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => (pending.delete(id), reject(new Error('o LLM local não respondeu a tempo'))), q.timeoutMs ?? 60_000);
    pending.set(id, { resolve, reject, timer });
    proc!.stdin!.write(`${JSON.stringify({ id, system: q.system, user: q.user, max_tokens: q.maxTokens ?? 400, json: q.json ?? false })}\n`);
  });
}

/** Pergunta esperando JSON; tolera texto em volta. */
export async function askJson<T>(q: Ask): Promise<T> {
  const text = await askLocal({ ...q, json: true });
  const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(text);
  if (!m) throw new Error(`resposta do LLM sem JSON: ${text.slice(0, 120)}`);
  return JSON.parse(m[0]) as T;
}

/** Disponível para um uso específico? (ligado + uso habilitado) */
export async function llmFor(uso: keyof LlmSettings['usos']): Promise<boolean> {
  const s = await llmSettings();
  return s.enabled && s.usos[uso];
}
