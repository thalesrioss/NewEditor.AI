import { create } from 'zustand';
import { normalizeTimeline, type AgentActivity, type ColorGrade, type ClientMessage, type HistoryState, type LogEntry, type MediaAsset, type OpEnvelope, type Project, type ServerMessage } from '@neweditor/core';
import { mediaUrl } from './api.ts';
import type { Timeline } from '@neweditor/core';

export interface Word {
  w: string;
  start: number;
  end: number;
  p: number;
  /** Centro sonoro medido (quando existe, é mais confiável que o tempo do ASR). */
  c?: number;
}

/** Legenda: `id` é a chave estável dela (asset@início da 1ª palavra no bruto). */
export type Selection = { kind: 'clip'; id: string } | { kind: 'overlay'; id: string } | { kind: 'caption'; id: string } | null;
export interface WordSelection {
  assetId: string;
  from: number;
  to: number;
}

interface EditorState {
  project: Project | null;
  connected: boolean;
  logs: LogEntry[];
  activity: AgentActivity;
  history: HistoryState;
  /** Última operação recebida — a timeline usa para piscar o ponto alterado. */
  lastOp: { envelope: OpEnvelope; at: number } | null;

  playhead: number;
  playing: boolean;
  /** Pedido de seek para o player (nonce muda a cada pedido). */
  seekReq: { t: number; nonce: number } | null;
  selection: Selection;
  wordSel: WordSelection | null;
  pxPerSec: number;

  envelopes: Record<string, Float32Array>;
  transcripts: Record<string, Word[]>;
  /** Correção de cor sendo arrastada (preview ao vivo antes de gravar); com `clipId`, é a grade daquele clipe (BL-0159 C3). */
  gradeDraft: { assetId: string; grade: ColorGrade; clipId?: string } | null;
  /** Segurando "antes": mostra o original sem correção. */
  compare: boolean;
  /** Marcas de entrada/saída (I/O) na timeline: Delete corta o intervalo. */
  marks: { in?: number; out?: number };
  /** Overlays selecionados além do principal (Shift+clique ou laço). */
  multi: string[];
  /** Clipes da fala selecionados além do principal (Shift+clique ou laço). */
  multiClips: string[];
  /** A timeline acompanha o cursor durante o play (pagina quando ele sai da tela). */
  follow: boolean;
  /** Ímã da timeline: encaixa no cursor, em clipes, overlays e palavras. */
  magnet: boolean;
  /** Linha guia do ímã (tempo da timeline) enquanto arrasta. */
  guide: number | null;
  /** Folha de atalhos aberta. */
  shortcutsOpen: boolean;
  /** Pedido pré-preenchido para o agente (clique direito → "Pedir ao agente aqui"). */
  agentDraft: string | null;
  /** A timeline de antes da última passada do agente (segurar B mostra o "antes"). */
  beforeAgent: Timeline | null;
  showBefore: boolean;

  connect(projectId: string): () => void;
  send(msg: ClientMessage): void;
  sendOp(envelope: Omit<OpEnvelope, 'by'>): void;
  seek(t: number): void;
  setPlayhead(t: number): void;
  setPlaying(p: boolean): void;
  select(s: Selection): void;
  selectWords(s: WordSelection | null): void;
  setPxPerSec(v: number): void;
  setGradeDraft(d: { assetId: string; grade: ColorGrade; clipId?: string } | null): void;
  setCompare(v: boolean): void;
  setMarks(m: { in?: number; out?: number }): void;
  toggleMulti(id: string): void;
  toggleMultiClip(id: string): void;
  /** Seleção em grupo (laço): o primeiro vira o principal, o resto vai para `multi`/`multiClips`. */
  selectMany(clipIds: string[], overlayIds: string[]): void;
  setFollow(v: boolean): void;
  setMagnet(v: boolean): void;
  setGuide(t: number | null): void;
  setShortcutsOpen(v: boolean): void;
  askAgent(text: string | null): void;
  setBeforeAgent(t: Timeline | null): void;
  setShowBefore(v: boolean): void;
}

let ws: WebSocket | null = null;

const EMPTY_HISTORY: HistoryState = { canUndo: false, canRedo: false };

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  connected: false,
  logs: [],
  activity: { state: 'idle', message: '' },
  history: EMPTY_HISTORY,
  lastOp: null,
  playhead: 0,
  playing: false,
  seekReq: null,
  selection: null,
  wordSel: null,
  pxPerSec: 40,
  envelopes: {},
  transcripts: {},
  gradeDraft: null,
  compare: false,
  marks: {},
  multi: [],
  multiClips: [],
  follow: true,
  magnet: true,
  guide: null,
  shortcutsOpen: false,
  agentDraft: null,
  beforeAgent: null,
  showBefore: false,

  connect(projectId) {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    set({ project: null, logs: [], activity: { state: 'idle', message: '' }, history: EMPTY_HISTORY, playhead: 0, playing: false, selection: null, wordSel: null, envelopes: {}, transcripts: {} });

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/ws/${projectId}`);
      ws = sock;
      sock.onopen = () => set({ connected: true });
      sock.onclose = () => {
        set({ connected: false });
        if (!closed) retry = setTimeout(open, 1200);
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        switch (msg.type) {
          case 'snapshot':
            set({ project: { ...msg.project, timeline: normalizeTimeline(msg.project.timeline) }, history: msg.history });
            msg.project.assets.forEach((a) => loadAssetData(projectId, a));
            break;
          case 'op': {
            const p = get().project;
            if (!p) break;
            const timeline = normalizeTimeline(msg.timeline);
            // Seleção que deixou de existir (clipe dividido/apagado) é descartada.
            const sel = get().selection;
            const stillThere = !sel || sel.kind === 'caption' || (sel.kind === 'clip' ? timeline.main.some((c) => c.id === sel.id) : timeline.overlays.some((o) => o.id === sel.id));
            set({ project: { ...p, timeline, version: msg.version }, history: msg.history, lastOp: { envelope: msg.envelope, at: Date.now() }, selection: stillThere ? sel : null });
            break;
          }
          case 'activity':
            set({ activity: msg.activity });
            break;
          case 'log':
            set((s) => ({ logs: [...s.logs.filter((l) => l.id !== msg.entry.id), msg.entry].slice(-300) }));
            break;
          case 'asset': {
            const p = get().project;
            if (!p) break;
            const assets = p.assets.some((a) => a.id === msg.asset.id) ? p.assets.map((a) => (a.id === msg.asset.id ? msg.asset : a)) : [...p.assets, msg.asset];
            set({ project: { ...p, assets } });
            loadAssetData(projectId, msg.asset);
            break;
          }
        }
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
      ws = null;
    };
  },

  send(msg) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  },

  sendOp(envelope) {
    const p = get().project;
    get().send({ type: 'op', envelope: { ...envelope, by: 'human' }, baseVersion: p?.version ?? 0 });
  },

  seek(t) {
    set({ playhead: Math.max(0, t), seekReq: { t: Math.max(0, t), nonce: Math.random() } });
  },
  setPlayhead(t) {
    set({ playhead: t });
  },
  setPlaying(p) {
    set({ playing: p });
  },
  select(s) {
    set({ selection: s, wordSel: null, multi: [], multiClips: [] });
  },
  toggleMultiClip(id) {
    const { multiClips, selection } = get();
    if (selection?.kind !== 'clip') return set({ selection: { kind: 'clip', id }, multi: [], multiClips: [] });
    if (selection.id === id) return;
    set({ multiClips: multiClips.includes(id) ? multiClips.filter((x) => x !== id) : [...multiClips, id] });
  },
  selectMany(clipIds, overlayIds) {
    if (overlayIds.length) set({ selection: { kind: 'overlay', id: overlayIds[0]! }, multi: overlayIds.slice(1), multiClips: clipIds, wordSel: null });
    else if (clipIds.length) set({ selection: { kind: 'clip', id: clipIds[0]! }, multi: [], multiClips: clipIds.slice(1), wordSel: null });
    else set({ selection: null, multi: [], multiClips: [] });
  },
  setFollow(v) {
    set({ follow: v });
  },
  setMarks(m) {
    set({ marks: m });
  },
  toggleMulti(id) {
    const { multi, selection } = get();
    if (selection?.kind !== 'overlay') return set({ selection: { kind: 'overlay', id }, multi: [] });
    if (selection.id === id) return;
    set({ multi: multi.includes(id) ? multi.filter((x) => x !== id) : [...multi, id] });
  },
  setMagnet(v) {
    set({ magnet: v });
  },
  setGuide(t) {
    set({ guide: t });
  },
  setShortcutsOpen(v) {
    set({ shortcutsOpen: v });
  },
  askAgent(text) {
    set({ agentDraft: text });
  },
  setBeforeAgent(t) {
    set({ beforeAgent: t });
  },
  setShowBefore(v) {
    set({ showBefore: v && !!get().beforeAgent });
  },
  selectWords(s) {
    set({ wordSel: s, selection: s ? null : get().selection });
  },
  setGradeDraft(d) {
    set({ gradeDraft: d });
  },
  setCompare(v) {
    set({ compare: v });
  },
  setPxPerSec(v) {
    set({ pxPerSec: Math.max(0.3, Math.min(400, v)) });
  },
}));

const loading = new Set<string>();

/** Baixa envelope (waveform) e transcrição de um asset assim que existirem. */
function loadAssetData(projectId: string, a: MediaAsset): void {
  const st = useEditor.getState();
  if (a.envelope && !st.envelopes[a.id] && !loading.has(`env:${a.id}`)) {
    loading.add(`env:${a.id}`);
    fetch(mediaUrl(projectId, a.envelope))
      .then((r) => r.arrayBuffer())
      .then((b) => useEditor.setState((s) => ({ envelopes: { ...s.envelopes, [a.id]: new Float32Array(b) } })))
      .finally(() => loading.delete(`env:${a.id}`));
  }
  if (a.transcript && !loading.has(`tr:${a.id}`)) {
    loading.add(`tr:${a.id}`);
    fetch(mediaUrl(projectId, a.transcript), { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ words: Word[] }>)
      .then((j) => useEditor.setState((s) => ({ transcripts: { ...s.transcripts, [a.id]: j.words } })))
      .finally(() => loading.delete(`tr:${a.id}`));
  }
}

/** Recarrega a transcrição (o servidor grava os centros sonoros depois da primeira decupagem). */
export function reloadTranscripts(projectId: string): void {
  useEditor.getState().project?.assets.forEach((a) => loadAssetData(projectId, a));
}

// Só em desenvolvimento: acesso à store pelo console (testes do motor de preview).
if (import.meta.env.DEV) (window as unknown as { __ne: typeof useEditor }).__ne = useEditor;
