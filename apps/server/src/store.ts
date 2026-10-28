import fs from 'node:fs/promises';
import path from 'node:path';
import {
  applyOp,
  clipScale,
  escalaAviso,
  manageGrade,
  overlayScale,
  type TimelineOp,
  normalizeTimeline,
  uid,
  type AgentActivity,
  type HistoryState,
  type LogEntry,
  type MediaAsset,
  type OpEnvelope,
  type Project,
  type ServerMessage,
  type Timeline,
} from '@neweditor/core';
import { DATA_DIR } from './config.ts';

interface Socket {
  close?: () => void;
  send(data: string): void;
  readyState: number;
}

/** Um passo de desfazer: o estado ANTES de uma operação (ou de um lote inteiro). */
interface Step {
  /** Só passos de transação têm id (o chat oferece "Desfazer este pedido" enquanto ele for o topo). */
  id?: string;
  label: string;
  timeline: Timeline;
}

interface History {
  undo: Step[];
  redo: Step[];
}

const HISTORY_LIMIT = 60;

/**
 * Estado vivo dos projetos. Toda edição passa por `apply()`: valida, incrementa a versão,
 * persiste e transmite para todo mundo conectado ao projeto.
 *
 * Desfazer é por PASSO, não por operação: `transaction()` agrupa um lote (ex.: uma decupagem com
 * 37 cortes) num passo só. O histórico é salvo em disco e sobrevive a reinício do servidor.
 */
class Store {
  private projects = new Map<string, Project>();
  private sockets = new Map<string, Set<Socket>>();
  private history = new Map<string, History>();
  private openTx = new Map<string, { label: string; step: string }>();
  private logs = new Map<string, LogEntry[]>();
  private activity = new Map<string, AgentActivity>();
  private saveTimers = new Map<string, NodeJS.Timeout>();

  dir(id: string): string {
    return path.join(DATA_DIR, id);
  }

  async load(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    for (const id of await fs.readdir(DATA_DIR)) {
      try {
        const p = JSON.parse(await fs.readFile(path.join(DATA_DIR, id, 'project.json'), 'utf8')) as Project;
        p.timeline = normalizeTimeline(p.timeline);
        // Status antigo "editando" (antes do portão de revisão): se já tem corte, está esperando revisão.
        if ((p.status as string) === 'editando') p.status = p.timeline.main.length ? 'revisao' : 'fila';
        this.projects.set(p.id, p);
        try {
          const h = JSON.parse(await fs.readFile(path.join(DATA_DIR, id, 'history.json'), 'utf8')) as History;
          this.history.set(p.id, { undo: h.undo.map((s) => ({ ...s, timeline: normalizeTimeline(s.timeline) })), redo: h.redo.map((s) => ({ ...s, timeline: normalizeTimeline(s.timeline) })) });
        } catch {
          /* sem histórico salvo */
        }
      } catch {
        /* pasta sem project.json */
      }
    }
  }

  /** Apaga o projeto da memória e move a pasta para data/_lixeira/projects (reversível à mão). */
  async remove(id: string): Promise<string> {
    if (!this.projects.has(id)) throw Object.assign(new Error('projeto não existe'), { statusCode: 404 });
    clearTimeout(this.saveTimers.get(id));
    this.saveTimers.delete(id);
    for (const ws of this.sockets.get(id) ?? []) ws.close?.();
    this.sockets.delete(id);
    this.projects.delete(id);
    this.history.delete(id);
    this.logs.delete(id);
    this.activity.delete(id);
    this.openTx.delete(id);
    const lixeira = path.join(path.dirname(DATA_DIR), '_lixeira', 'projects');
    await fs.mkdir(lixeira, { recursive: true });
    let dest = path.join(lixeira, id);
    if (await fs.stat(dest).catch(() => null)) dest = `${dest}-${Date.now().toString(36)}`;
    await fs.rename(this.dir(id), dest).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
    return dest;
  }

  list(): Project[] {
    return [...this.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Project {
    const p = this.projects.get(id);
    if (!p) throw Object.assign(new Error(`projeto ${id} não existe`), { statusCode: 404 });
    return p;
  }

  async create(name: string, brief: string): Promise<Project> {
    const p: Project = {
      id: uid('prj'),
      name,
      brief,
      status: 'fila',
      createdAt: new Date().toISOString(),
      assets: [],
      timeline: normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [] }),
      version: 0,
    };
    await fs.mkdir(this.dir(p.id), { recursive: true });
    this.projects.set(p.id, p);
    await this.persist(p.id);
    return p;
  }

  update(id: string, patch: Partial<Pick<Project, 'name' | 'brief' | 'status' | 'review' | 'client' | 'dueAt' | 'profileId' | 'task' | 'timings' | 'qc' | 'comments' | 'versions'>>): Project {
    const p = this.get(id);
    Object.assign(p, patch);
    this.schedulePersist(id);
    this.broadcast(id, { type: 'snapshot', project: p, history: this.historyState(id) });
    return p;
  }

  /** Muda o formato da timeline sem passar pelo histórico (pelo primeiro vídeo, ou pela tarefa com `formatoManual`). */
  setFormat(id: string, fmt: Partial<Pick<Timeline, 'width' | 'height' | 'fps' | 'formatoManual'>>): void {
    const p = this.get(id);
    p.timeline = { ...p.timeline, ...fmt };
    // Grava e avisa a tela: o formato muda logo na importação, minutos antes da primeira operação (CH-0005).
    this.schedulePersist(id);
    this.broadcast(id, { type: 'snapshot', project: p, history: this.historyState(id) });
  }

  upsertAsset(id: string, asset: MediaAsset): void {
    const p = this.get(id);
    const i = p.assets.findIndex((a) => a.id === asset.id);
    if (i >= 0) p.assets[i] = asset;
    else p.assets.push(asset);
    this.schedulePersist(id);
    this.broadcast(id, { type: 'asset', asset });
  }

  /** Remove um asset que nada na timeline usa (os arquivos derivados ficam no disco, inofensivos). */
  removeAsset(id: string, assetId: string): void {
    const p = this.get(id);
    const used = p.timeline.main.some((c) => c.assetId === assetId) || p.timeline.overlays.some((o) => o.source.type === 'media' && o.source.assetId === assetId);
    if (used) throw Object.assign(new Error('esse arquivo está em uso na timeline'), { statusCode: 409 });
    p.assets = p.assets.filter((a) => a.id !== assetId);
    this.schedulePersist(id);
    this.broadcast(id, { type: 'snapshot', project: p, history: this.historyState(id) });
  }

  // --- Edição + histórico -----------------------------------------------------

  private hist(id: string): History {
    let h = this.history.get(id);
    if (!h) {
      h = { undo: [], redo: [] };
      this.history.set(id, h);
    }
    return h;
  }

  historyState(id: string): HistoryState {
    const h = this.hist(id);
    return { canUndo: h.undo.length > 0, canRedo: h.redo.length > 0, undoLabel: h.undo.at(-1)?.label, redoLabel: h.redo.at(-1)?.label, undoId: h.undo.at(-1)?.id };
  }

  private pushStep(id: string, label: string, timeline: Timeline, stepId?: string): void {
    const h = this.hist(id);
    h.undo.push({ ...(stepId && { id: stepId }), label, timeline });
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo = [];
  }

  /**
   * Agrupa todas as operações feitas dentro de `fn` num ÚNICO passo de desfazer.
   * Transações aninhadas viram parte da transação de fora. Lote que não mudou a timeline não deixa passo
   * (nem apaga o refazer).
   */
  async transaction<T>(id: string, label: string, fn: () => Promise<T>): Promise<T> {
    if (this.openTx.has(id)) return fn();
    const h = this.hist(id);
    const prev = { undo: [...h.undo], redo: h.redo };
    const before = this.get(id).timeline;
    const step = uid('step');
    this.pushStep(id, label, before, step);
    this.openTx.set(id, { label, step });
    try {
      return await fn();
    } finally {
      this.openTx.delete(id);
      if (this.projects.has(id) && JSON.stringify(this.get(id).timeline) === JSON.stringify(before)) Object.assign(h, prev);
      this.schedulePersist(id);
      this.broadcastHistory(id);
    }
  }

  /** Aplica uma operação. Lança OpError se inválida (nada muda). */
  apply(id: string, env: OpEnvelope): Project {
    const p = this.get(id);
    // Color management por clipe: arquivo LOG (cor lida do XML da câmera) nunca recebe grade como Rec.709 (FB-0180).
    if (env.op.type === 'set_grade' && env.op.grade) {
      const color = p.assets.find((a) => a.id === (env.op as { assetId: string }).assetId)?.color;
      env = { ...env, op: { ...env.op, grade: manageGrade(env.op.grade, color)! } };
    }
    const next = applyOp(p.timeline, env.op, env.by);
    if (!this.openTx.has(id)) this.pushStep(id, env.note ?? LABEL[env.op.type] ?? 'Alteração', p.timeline);
    p.timeline = next;
    p.version++;
    this.schedulePersist(id);
    this.broadcast(id, { type: 'op', envelope: env, version: p.version, timeline: next, history: this.historyState(id) });
    if (env.note) this.log(id, env.by, env.note);
    const escala = escalaDaOp(p, env.op);
    if (escala) this.log(id, 'system', escala);
    this.changed(id);
    return p;
  }

  undo(id: string): boolean {
    return this.travel(id, 'undo');
  }

  redo(id: string): boolean {
    return this.travel(id, 'redo');
  }

  private travel(id: string, dir: 'undo' | 'redo'): boolean {
    if (this.openTx.has(id)) return false; // não desfaz no meio do agente trabalhando
    const p = this.get(id);
    const h = this.hist(id);
    const step = (dir === 'undo' ? h.undo : h.redo).pop();
    if (!step) return false;
    // Leva o id do passo junto: depois de desfazer + refazer o pedido volta ao topo com o mesmo id (FB-0098).
    (dir === 'undo' ? h.redo : h.undo).push({ ...step, timeline: p.timeline });
    p.timeline = step.timeline;
    p.version++;
    this.schedulePersist(id);
    this.broadcast(id, {
      type: 'op',
      envelope: { op: { type: 'set_main', clips: step.timeline.main, removals: step.timeline.removals }, by: 'human' },
      version: p.version,
      timeline: step.timeline,
      history: this.historyState(id),
    });
    this.log(id, 'human', `${dir === 'undo' ? 'Desfez' : 'Refez'}: ${step.label}`);
    this.changed(id);
    return true;
  }

  private watchers: ((id: string) => void)[] = [];
  /** Avisa quando a timeline de um projeto muda (operação, desfazer, refazer). */
  onTimeline(fn: (id: string) => void): void {
    this.watchers.push(fn);
  }
  private changed(id: string): void {
    for (const fn of this.watchers) fn(id);
  }

  private broadcastHistory(id: string): void {
    const p = this.get(id);
    this.broadcast(id, { type: 'op', envelope: { op: { type: 'set_main', clips: p.timeline.main, removals: p.timeline.removals }, by: 'system' }, version: p.version, timeline: p.timeline, history: this.historyState(id) });
  }

  log(id: string, by: LogEntry['by'], text: string, suggestion?: LogEntry['suggestion']): void {
    const step = this.openTx.get(id)?.step;
    const entry: LogEntry = { id: uid('log'), at: new Date().toISOString(), by, text, ...(suggestion && { suggestion }), ...(step && { step }) };
    const l = this.logs.get(id) ?? [];
    l.push(entry);
    if (l.length > 500) l.shift();
    this.logs.set(id, l);
    this.broadcast(id, { type: 'log', entry });
  }

  setActivity(id: string, activity: AgentActivity): void {
    this.activity.set(id, activity);
    this.broadcast(id, { type: 'activity', activity });
  }

  isBusyEditing(id: string): boolean {
    return this.openTx.has(id);
  }

  // --- WebSocket -----------------------------------------------------------

  attach(id: string, ws: Socket): void {
    const set = this.sockets.get(id) ?? new Set();
    set.add(ws);
    this.sockets.set(id, set);
    const send = (m: ServerMessage) => ws.send(JSON.stringify(m));
    send({ type: 'snapshot', project: this.get(id), history: this.historyState(id) });
    for (const entry of (this.logs.get(id) ?? []).slice(-80)) send({ type: 'log', entry });
    const act = this.activity.get(id);
    if (act) send({ type: 'activity', activity: act });
  }

  detach(id: string, ws: Socket): void {
    this.sockets.get(id)?.delete(ws);
  }

  broadcast(id: string, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.get(id) ?? []) if (ws.readyState === 1) ws.send(data);
  }

  // --- Persistência ----------------------------------------------------------

  private schedulePersist(id: string): void {
    clearTimeout(this.saveTimers.get(id));
    this.saveTimers.set(
      id,
      setTimeout(() => {
        this.saveTimers.delete(id);
        void this.persist(id);
      }, 400),
    );
  }

  /**
   * Grava agora o que está esperando o debounce e aguarda as gravações em curso.
   * Para testes e desligamento: depois do `await`, nenhum `project.json` está sendo escrito.
   */
  async flush(): Promise<void> {
    const pendentes = [...this.saveTimers.keys()];
    for (const id of pendentes) clearTimeout(this.saveTimers.get(id));
    this.saveTimers.clear();
    await Promise.all(pendentes.map((id) => this.persist(id)));
    await Promise.all(this.writing.values());
  }

  /** Gravações em curso por projeto, encadeadas para nunca escreverem o mesmo `.tmp` ao mesmo tempo. */
  private writing = new Map<string, Promise<void>>();

  private persist(id: string): Promise<void> {
    const next = (this.writing.get(id) ?? Promise.resolve()).then(async () => {
      const p = this.projects.get(id);
      if (!p) return;
      await writeAtomic(path.join(this.dir(id), 'project.json'), JSON.stringify(p, null, 2));
      const h = this.history.get(id);
      if (h) await writeAtomic(path.join(this.dir(id), 'history.json'), JSON.stringify(h));
    });
    // A cadeia não rejeita (uma falha não trava as próximas gravações); quem chamou recebe o erro em `next`.
    const settled = next.then(
      () => {},
      () => {},
    );
    this.writing.set(id, settled);
    void settled.then(() => {
      if (this.writing.get(id) === settled) this.writing.delete(id);
    });
    return next;
  }
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await fs.writeFile(file + '.tmp', data);
  await fs.rename(file + '.tmp', file);
}

const LABEL: Record<string, string> = {
  set_main: 'Nova montagem',
  cut_source: 'Corte',
  cut_timeline: 'Corte',
  restore: 'Restaurar trecho',
  trim: 'Aparar clipe',
  delete_clip: 'Remover clipe',
  move_clip: 'Mover clipe',
  split: 'Dividir clipe',
  set_zoom: 'Zoom',
  add_overlay: 'Adicionar overlay',
  move_overlay: 'Mover overlay',
  trim_overlay: 'Ajustar overlay',
  remove_overlay: 'Remover overlay',
  set_voice_denoise: 'Limpeza da voz',
  set_clip_grade: 'Cor do clipe',
};

export const store = new Store();

/** Aviso de escala efetiva na própria operação de zoom/enquadramento (FB-0180 A3). */
function escalaDaOp(p: Project, op: TimelineOp): string | null {
  const asset = (id: string | undefined) => p.assets.find((a) => a.id === id);
  if (op.type === 'set_zoom') {
    const c = p.timeline.main.find((x) => x.id === op.clipId);
    const a = c && (asset(c.cam) ?? asset(c.assetId));
    return c && a ? escalaAviso(clipScale(a, c, p.timeline), `Zoom no clipe ${c.id}`) : null;
  }
  if (op.type === 'set_overlay_framing') {
    const o = p.timeline.overlays.find((x) => x.id === op.id);
    const a = o?.source.type === 'media' ? asset(o.source.assetId) : undefined;
    return o && a && a.kind !== 'image' ? escalaAviso(overlayScale(a, o.framing, p.timeline), `Enquadramento do B-roll ${o.id}`) : null;
  }
  return null;
}
