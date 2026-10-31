/**
 * Cérebro do Editor (#/cerebro): o vault do Obsidian como um grafo em 3D — as notas, o que as liga e o que
 * o produto leu delas (perfis). Arraste para girar, roda para aproximar, clique numa nota para ler.
 * Só leitura: editar é no Obsidian (botão "Abrir no Obsidian").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BrainCircuit, Crosshair, ExternalLink, Eye, EyeOff, FolderTree, Orbit, RefreshCw, Search, Tag, X } from 'lucide-react';
import { CEREBRO_CAMADA_LABEL, CEREBRO_EDGE_LABEL, CEREBRO_KIND_LABEL, type CerebroCamada, type CerebroEdgeKind, type CerebroGraph, type CerebroKind, type CerebroNode, type CerebroNote, type CerebroVaultId } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { DEFAULT_FORCES, draw, isHub, makeBodies, pick, project, step, visible, type Body, type Camera, type Spring } from '../lib/graph3d.ts';
import { Button, IconButton } from './ui.tsx';

/** Cérebro do Editor em tons frios; Motion Studio Brain em tons quentes. */
const KIND_COLOR: Record<CerebroKind, string> = {
  cerebro: '#ffffff',
  pasta: '#7d869a',
  raiz: '#e8eaef',
  canvas: '#fde68a',
  sistema: '#8fb0ff',
  memoria: '#c4b5fd',
  brain: '#818cf8',
  padrao: '#fbbf24',
  motion: '#fdba74',
  projeto: '#22d3ee',
  arquivo: '#5eead4',
  montagem: '#99f6e4',
  saida: '#9aa2b2',
  perfil: '#34d399',
  referencia: '#fb7185',
  mapa: '#f9a8d4',
  aprovado: '#fcd34d',
  recusado: '#f87171',
  alteracao: '#fdba74',
  registro: '#fda4af',
  asset: '#e879f9',
  filme: '#fb923c',
  tecnologia: '#a3e635',
};
const VAULT_COLOR: Record<CerebroVaultId, string> = { editor: '#8fb0ff', motion: '#fb923c' };
/** Cada projeto ganha um tom próprio da família ciano/teal (como os grupos de cor do Obsidian). */
const PROJECT_PALETTE = ['#5eead4', '#67e8f9', '#7dd3fc', '#2dd4bf', '#22d3ee', '#38bdf8', '#99f6e4', '#a5f3fc', '#bae6fd', '#0ea5e9', '#14b8a6', '#06b6d4'];

function colorFor(groups: string[]): (n: CerebroNode) => string {
  const projects = groups.filter((g) => g.startsWith('editor/montagens/'));
  return (n) => {
    if (n.kind === 'cerebro') return VAULT_COLOR[n.vault];
    if (n.kind === 'padrao' && n.casa) return '#34d399';
    if (n.kind === 'arquivo' || n.kind === 'projeto') {
      const i = projects.indexOf(n.group);
      return i >= 0 ? PROJECT_PALETTE[i % PROJECT_PALETTE.length]! : KIND_COLOR[n.kind];
    }
    return KIND_COLOR[n.kind];
  };
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function obsidianUrl(vault: string, p: string): string {
  const file = p.endsWith('.md') ? p.slice(0, -3) : p;
  return `obsidian://open?vault=${encodeURIComponent(vault)}${file ? `&file=${encodeURIComponent(file)}` : ''}`;
}

export function CerebroPage() {
  const [graph, setGraph] = useState<CerebroGraph | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rotate, setRotate] = useState(true);
  const [folderEdges, setFolderEdges] = useState(true);
  const [labels, setLabels] = useState<'auto' | 'all' | 'hover'>('auto');
  const [camada, setCamada] = useState<'todas' | 'padrao' | 'meu'>('todas');
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sim = useRef<{ bodies: Body[]; springs: Spring[]; byId: Map<string, Body> } | null>(null);
  const cam = useRef<Camera>({ yaw: 0.4, pitch: 0.25, dist: 640, tx: 0, ty: 0, tz: 0 });
  const alpha = useRef(1);
  const lastInput = useRef(0);
  const hover = useRef<Body | null>(null);
  const selected = useRef<Body | null>(null);
  const opts = useRef({ hidden, folderEdges, labels, match: null as Set<string> | null, rotate, camada });
  const retries = useRef(0);

  /** Enquadra a nuvem inteira: alvo no centro de massa, distância pelo raio (95º percentil). */
  const fit = (bodies: Body[]) => {
    const n = bodies.length || 1;
    const cx = bodies.reduce((a, b) => a + b.x, 0) / n;
    const cy = bodies.reduce((a, b) => a + b.y, 0) / n;
    const cz = bodies.reduce((a, b) => a + b.z, 0) / n;
    const ds = bodies.map((b) => Math.hypot(b.x - cx, b.y - cy, b.z - cz)).sort((a, b) => a - b);
    const R = ds[Math.floor(ds.length * 0.95)] ?? 300;
    const box = wrap.current?.getBoundingClientRect();
    const w = box?.width || 1000;
    const h = box?.height || 800;
    const f = Math.max(w, h) * 0.9;
    const dist = Math.max(160, Math.min(2400, (R * f) / (0.4 * Math.min(w, h)) + R * 0.35));
    // A legenda cobre a esquerda: desloca o alvo para a nuvem centrar na área livre.
    const yaw = 0.4;
    const dw = (110 * dist) / f;
    cam.current = { yaw, pitch: 0.22, dist, tx: cx - dw * Math.cos(yaw), ty: cy, tz: cz + dw * Math.sin(yaw) };
    lastInput.current = performance.now();
  };
  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError('');
    try {
      const g = await api.cerebroGrafo(refresh);
      setGraph(g);
      const colorOf = colorFor(g.grupos.map((x) => x.id));
      const s = makeBodies(g.nodes, g.edges, colorOf);
      // Aquecimento até quase parar: a nuvem já nasce no tamanho final; na tela só assenta.
      for (let i = 0; i < 380; i++) step(s.bodies, s.springs, DEFAULT_FORCES, Math.max(0.06, 1 - i / 300));
      sim.current = s;
      alpha.current = 0.1;
      fit(s.bodies);
      selected.current = selectedId ? (s.byId.get(selectedId) ?? null) : null;
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      // O servidor reinicia quando um arquivo muda (502 do proxy): tenta de novo em vez de ficar na tela vazia.
      if (/5\d\d|fetch|rede/i.test(msg) && retries.current < 6) {
        retries.current++;
        setTimeout(() => void load(refresh), 2500);
      }
    } finally {
      setBusy(false);
    }
  }, [selectedId]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Busca: nós cujo rótulo ou caminho batem.
  const match = useMemo(() => {
    const needle = fold(q.trim());
    if (!needle || !graph) return null;
    return new Set(graph.nodes.filter((n) => fold(n.label).includes(needle) || fold(n.path).includes(needle)).map((n) => n.id));
  }, [q, graph]);
  useEffect(() => {
    opts.current = { hidden, folderEdges, labels, match, rotate, camada };
  }, [hidden, folderEdges, labels, match, rotate, camada]);
  // Trocou a camada: reenquadra só o que ficou visível.
  useEffect(() => {
    const s = sim.current;
    if (!s) return;
    const vis = s.bodies.filter((b) => visible(b, hidden, camada) && b.node.kind !== 'cerebro');
    if (vis.length) fit(vis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camada]);

  // Laço de desenho.
  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let w = 1;
    let h = 1;
    const resize = () => {
      const r = box.getBoundingClientRect();
      w = Math.max(1, Math.floor(r.width));
      h = Math.max(1, Math.floor(r.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.floor(w * dpr);
      el.height = Math.floor(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    const frame = () => {
      const s = sim.current;
      if (s) {
        if (alpha.current > 0.004) {
          step(s.bodies, s.springs, DEFAULT_FORCES, alpha.current);
          alpha.current *= 0.985;
        }
        const idle = performance.now() - lastInput.current > 2500;
        if (opts.current.rotate && idle && !hover.current) cam.current.yaw += 0.0022;
        project(s.bodies, cam.current, w, h);
        draw(ctx, s.bodies, s.springs, w, h, {
          hover: hover.current,
          selected: selected.current,
          match: opts.current.match,
          hidden: opts.current.hidden,
          camada: opts.current.camada,
          showFolderEdges: opts.current.folderEdges,
          labels: opts.current.labels,
          dpr: Math.min(2, window.devicePixelRatio || 1),
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Ponteiro: órbita, zoom, hover, clique.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let down: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      const p = pos(e);
      down = { x: p.x, y: p.y, yaw: cam.current.yaw, pitch: cam.current.pitch, moved: false };
      lastInput.current = performance.now();
    };
    const onMove = (e: PointerEvent) => {
      const p = pos(e);
      if (down) {
        const dx = p.x - down.x;
        const dy = p.y - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
        if (down.moved) {
          cam.current.yaw = down.yaw + dx * 0.006;
          cam.current.pitch = Math.max(-1.4, Math.min(1.4, down.pitch + dy * 0.006));
          el.style.cursor = 'grabbing';
        }
        lastInput.current = performance.now();
        return;
      }
      const b = sim.current ? pick(sim.current.bodies, p.x, p.y, opts.current.hidden, opts.current.camada) : null;
      if (b !== hover.current) {
        hover.current = b;
        setHoverId(b?.id ?? null);
        el.style.cursor = b ? 'pointer' : 'grab';
      }
    };
    const onUp = (e: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      const wasClick = down && !down.moved;
      down = null;
      el.style.cursor = hover.current ? 'pointer' : 'grab';
      if (wasClick) {
        const p = pos(e);
        const b = sim.current ? pick(sim.current.bodies, p.x, p.y, opts.current.hidden, opts.current.camada) : null;
        selected.current = b;
        setSelectedId(b?.id ?? null);
      }
      lastInput.current = performance.now();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.current.dist = Math.max(120, Math.min(2400, cam.current.dist * Math.pow(1.0015, e.deltaY)));
      lastInput.current = performance.now();
    };
    const onDbl = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const b = sim.current ? pick(sim.current.bodies, e.clientX - r.left, e.clientY - r.top, opts.current.hidden, opts.current.camada) : null;
      if (b) focusBody(b);
    };
    const onLeave = () => {
      hover.current = null;
      setHoverId(null);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
    };
  }, []);

  const focusBody = (b: Body) => {
    cam.current.tx = b.x;
    cam.current.ty = b.y;
    cam.current.tz = b.z;
    cam.current.dist = Math.min(cam.current.dist, 320);
    selected.current = b;
    setSelectedId(b.id);
    lastInput.current = performance.now();
  };
  const recenter = () => {
    if (sim.current) fit(sim.current.bodies);
    select(null);
  };
  const select = (id: string | null) => {
    const b = id && sim.current ? (sim.current.byId.get(id) ?? null) : null;
    selected.current = b;
    setSelectedId(b?.id ?? null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleGroup = (g: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  const selNode = graph?.nodes.find((n) => n.id === selectedId) ?? null;
  const hoverNode = graph?.nodes.find((n) => n.id === hoverId) ?? null;
  const matchList = useMemo(() => {
    if (!match || !graph) return [];
    const deg = new Map<string, number>();
    for (const e of graph.edges) {
      deg.set(e.s, (deg.get(e.s) ?? 0) + 1);
      deg.set(e.t, (deg.get(e.t) ?? 0) + 1);
    }
    return graph.nodes
      .filter((n) => match.has(n.id))
      .sort((a, b) => Number(!!b.casa) - Number(!!a.casa) || (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0))
      .slice(0, 12);
  }, [match, graph]);

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <header className="ne-titlebar flex items-center gap-3 border-b border-ink-750 px-6 py-3">
        <a href="#/" className="rounded-ui-md p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white" aria-label="Voltar ao Kanban">
          <ArrowLeft size={18} />
        </a>
        <BrainCircuit size={20} className="text-nc-300" />
        <div>
          <div className="text-ui-lg font-semibold">Cérebro do Editor</div>
          <div className="text-ui-xs whitespace-nowrap text-ink-400">
            {graph ? `${graph.vaults.length} cérebros · ${graph.nodes.filter((n) => !isHub(n) && n.kind !== 'perfil').length} notas · ${graph.edges.length} ligações · ${graph.pontes} pontes` : 'O conhecimento e as notas conectadas, como no Obsidian — em 3D'}
          </div>
        </div>
        {graph && (
          <div className="ml-4 flex items-center rounded-full border border-ink-700 bg-ink-850 p-0.5 text-ui-xs" role="radiogroup" aria-label="Camada do conhecimento">
            {(
              [
                ['todas', 'Tudo', `${graph.camadas.oficio + graph.camadas.pessoal + graph.camadas.cliente} notas`],
                ['padrao', 'Padrão', `O que todo editor recebe: ${graph.camadas.oficio} de ofício — ${CEREBRO_CAMADA_LABEL.oficio}`],
                ['meu', 'Meu', `${graph.camadas.pessoal} pessoais + ${graph.camadas.cliente} de clientes — ${CEREBRO_CAMADA_LABEL.pessoal}`],
              ] as const
            ).map(([id, label, tip]) => (
              <button key={id} role="radio" aria-checked={camada === id} title={tip} onClick={() => setCamada(id)} className={`rounded-full px-2.5 py-1 whitespace-nowrap transition ${camada === id ? 'bg-nc-500/25 text-white' : 'text-ink-300 hover:text-white'}`}>
                {label}
                <span className="ml-1 text-ui-2xs text-ink-400">{id === 'todas' ? graph.camadas.oficio + graph.camadas.pessoal + graph.camadas.cliente : id === 'padrao' ? graph.camadas.oficio : graph.camadas.pessoal + graph.camadas.cliente}</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative ml-3 w-56 min-w-[7rem]">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-400" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setListOpen(true);
            }}
            onFocus={() => setListOpen(true)}
            onBlur={() => setTimeout(() => setListOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matchList[0]) {
                const b = sim.current?.byId.get(matchList[0].id);
                if (b) focusBody(b);
                setListOpen(false);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                setListOpen(false);
                (e.target as HTMLInputElement).blur();
              }
              e.stopPropagation();
            }}
            placeholder="Buscar nota, projeto, cliente…"
            className="w-full rounded-full border border-ink-700 bg-ink-850 py-1.5 pr-8 pl-8 text-ui-sm text-ink-100 placeholder:text-ink-400 focus:border-nc-500 focus:outline-none"
            aria-label="Buscar no Cérebro"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-400 hover:text-white" aria-label="Limpar busca">
              <X size={13} />
            </button>
          )}
          {listOpen && matchList.length > 0 && (
            <ul className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-ui-md border border-ink-700 bg-ink-850 py-1 shadow-ui-2">
              {matchList.map((n) => (
                <li key={n.id}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const b = sim.current?.byId.get(n.id);
                      if (b) focusBody(b);
                      setListOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui-sm text-ink-200 hover:bg-ink-800"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sim.current?.byId.get(n.id)?.color ?? KIND_COLOR[n.kind] }} />
                    <span className="truncate">{n.label}</span>
                    <span className="ml-auto shrink-0 text-ui-xs text-ink-400">{CEREBRO_KIND_LABEL[n.kind]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <IconButton label={rotate ? 'Parar de girar' : 'Girar sozinho'} onClick={() => setRotate((r) => !r)} active={rotate}>
            <Orbit size={15} />
          </IconButton>
          <IconButton label={folderEdges ? 'Esconder ligações de pasta' : 'Mostrar ligações de pasta'} onClick={() => setFolderEdges((f) => !f)} active={folderEdges}>
            <FolderTree size={15} />
          </IconButton>
          <IconButton
            label={labels === 'auto' ? 'Rótulos: conforme a escala (clique: todos)' : labels === 'all' ? 'Rótulos: todos (clique: só no foco)' : 'Rótulos: só no foco (clique: conforme a escala)'}
            onClick={() => setLabels((l) => (l === 'auto' ? 'all' : l === 'all' ? 'hover' : 'auto'))}
            active={labels === 'all'}
            className={labels === 'hover' ? 'opacity-50' : ''}
          >
            <Tag size={15} />
          </IconButton>
          <IconButton label="Centralizar" onClick={recenter}>
            <Crosshair size={15} />
          </IconButton>
          <IconButton label="Reler o vault" onClick={() => void load(true)} className={busy ? 'animate-spin' : ''}>
            <RefreshCw size={15} />
          </IconButton>
          {graph?.vaults.map((v) => (
            <a key={v.id} href={obsidianUrl(v.name, '')} className="ml-1 flex h-7 items-center gap-1 rounded-full border border-ink-700 px-2 text-ui-xs text-ink-300 hover:border-ink-500 hover:text-white" title={`Abrir "${v.name}" no Obsidian`} aria-label={`Abrir ${v.label} no Obsidian`}>
              <span className="h-2 w-2 rounded-full" style={{ background: VAULT_COLOR[v.id] }} />
              <ExternalLink size={12} />
            </a>
          ))}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div ref={wrap} className="relative min-w-0 flex-1 overflow-hidden">
          <canvas ref={canvas} className="block h-full w-full cursor-grab" aria-label="Grafo do Cérebro do Editor em 3D" />
          {error && <p className="absolute top-3 left-3 rounded-ui-md bg-rose-500/15 px-3 py-1.5 text-ui-sm text-rose-300">{error}</p>}
          {!graph && !error && <p className="absolute inset-0 flex items-center justify-center text-ui-sm text-ink-400">Lendo o vault…</p>}

          {graph && (
            <div className="scroll-thin absolute top-3 left-3 max-h-[calc(100%-5rem)] w-60 overflow-y-auto rounded-ui-lg border border-ink-750/80 bg-ink-900/80 p-2 backdrop-blur">
              {graph.vaults.map((v) => {
                const mine = graph.grupos.filter((g) => g.vault === v.id);
                const allOff = mine.every((g) => hidden.has(g.id));
                return (
                  <div key={v.id} className="mb-2">
                    <button
                      onClick={() =>
                        setHidden((h) => {
                          const n = new Set(h);
                          for (const g of mine) allOff ? n.delete(g.id) : n.add(g.id);
                          return n;
                        })
                      }
                      className="flex w-full items-center gap-2 rounded-ui-sm px-1 py-1 text-left hover:bg-ink-800"
                      title={v.papel}
                      aria-pressed={!allOff}
                    >
                      <span className="h-3 w-3 shrink-0 rounded-full border-2" style={{ borderColor: VAULT_COLOR[v.id], background: allOff ? 'transparent' : VAULT_COLOR[v.id], boxShadow: allOff ? 'none' : `0 0 8px ${VAULT_COLOR[v.id]}` }} />
                      <span className={`truncate text-ui-xs font-semibold ${allOff ? 'text-ink-500' : 'text-white'}`}>{v.label}</span>
                      <span className="ml-auto text-ui-2xs text-ink-400">{v.notas}</span>
                      {allOff ? <EyeOff size={11} className="shrink-0 text-ink-500" /> : <Eye size={11} className="shrink-0 text-ink-500 opacity-0" />}
                    </button>
                    {mine
                      .filter((g) => g.kind !== 'cerebro')
                      .map((g) => {
                        const off = hidden.has(g.id);
                        const sample = graph.nodes.find((n) => n.group === g.id && !isHub(n)) ?? graph.nodes.find((n) => n.group === g.id);
                        const color = sample ? (sim.current?.byId.get(sample.id)?.color ?? KIND_COLOR[sample.kind]) : '#fff';
                        return (
                          <button key={g.id} onClick={() => toggleGroup(g.id)} className={`flex w-full items-center gap-2 rounded-ui-sm py-0.5 pr-1.5 pl-4 text-left text-ui-xs hover:bg-ink-800 ${off ? 'text-ink-500' : 'text-ink-200'}`} aria-pressed={!off}>
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: off ? 'transparent' : color, boxShadow: off ? `inset 0 0 0 1.5px ${color}` : 'none' }} />
                            <span className="truncate">{g.label}</span>
                            <span className="ml-auto text-ui-2xs text-ink-400">{g.n}</span>
                            {off ? <EyeOff size={11} className="shrink-0 text-ink-500" /> : <Eye size={11} className="shrink-0 text-ink-500 opacity-0" />}
                          </button>
                        );
                      })}
                  </div>
                );
              })}
              <div className="mt-2 border-t border-ink-750 px-1 pt-2 text-ui-xs text-ink-400">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" /> padrão da casa
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full border border-dashed border-amber-400" /> teste que não ficou bom
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="h-0 w-4 border-t-2 border-dashed border-orange-400" /> ponte entre cérebros
                </div>
              </div>
            </div>
          )}

          {hoverNode && !selNode && (
            <div className="pointer-events-none absolute right-3 bottom-3 max-w-sm rounded-ui-md border border-ink-750 bg-ink-900/90 px-3 py-2 backdrop-blur">
              <div className="text-ui-sm font-medium text-white">{hoverNode.label}</div>
              <div className="text-ui-xs text-ink-400">
                <span style={{ color: VAULT_COLOR[hoverNode.vault] }}>{graph?.vaults.find((v) => v.id === hoverNode.vault)?.label}</span> · {CEREBRO_KIND_LABEL[hoverNode.kind]} · {hoverNode.camada === 'oficio' ? 'ofício' : hoverNode.camada === 'pessoal' ? 'pessoal' : 'cliente'}
                {hoverNode.path ? ` · ${hoverNode.path}` : ''}
              </div>
              {hoverNode.excerpt && <p className="mt-1 line-clamp-2 text-ui-xs text-ink-300">{hoverNode.excerpt}</p>}
            </div>
          )}
          <p className="pointer-events-none absolute bottom-3 left-3 text-ui-xs text-ink-500">arraste para girar · roda para aproximar · clique para ler · duplo clique para centralizar · Esc limpa</p>
        </div>

        {graph && selNode && <NoteDrawer graph={graph} node={selNode} colorOf={(id) => sim.current?.byId.get(id)?.color ?? '#fff'} onSelect={(id) => select(id)} onFocus={(id) => {
          const b = sim.current?.byId.get(id);
          if (b) focusBody(b);
        }} onClose={() => select(null)} />}
      </div>
    </div>
  );
}

function NoteDrawer({ graph, node, colorOf, onSelect, onFocus, onClose }: { graph: CerebroGraph; node: CerebroNode; colorOf: (id: string) => string; onSelect: (id: string) => void; onFocus: (id: string) => void; onClose: () => void }) {
  const [note, setNote] = useState<CerebroNote | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setNote(null);
    setErr('');
    if (!/\.(md|canvas)$/i.test(node.path)) return;
    let stop = false;
    api
      .cerebroNota(node.vault, node.path)
      .then((n) => !stop && setNote(n))
      .catch((e: Error) => !stop && setErr(e.message));
    return () => {
      stop = true;
    };
  }, [node.id, node.path, node.kind]);

  const links = useMemo(() => {
    const byKind = new Map<CerebroEdgeKind, { id: string; label: string; w: number }[]>();
    for (const e of graph.edges) {
      const other = e.s === node.id ? e.t : e.t === node.id ? e.s : null;
      if (!other) continue;
      const n = graph.nodes.find((x) => x.id === other);
      if (!n) continue;
      byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), { id: n.id, label: n.label, w: e.w }]);
    }
    return [...byKind.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [graph, node.id]);
  const total = links.reduce((s, [, l]) => s + l.length, 0);
  const perfilId = node.kind === 'perfil' ? node.id.split(':').pop()! : null;
  const vault = graph.vaults.find((v) => v.id === node.vault);
  const isNote = /\.(md|canvas)$/i.test(node.path);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-ink-750 bg-ink-850">
      <div className="flex items-start gap-2 border-b border-ink-750 px-4 py-3">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(node.id) }} />
        <div className="min-w-0 flex-1">
          <div className="text-ui-md font-semibold text-white">{node.label}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-ui-xs text-ink-400">
            <span className="rounded px-1.5 py-px font-semibold" style={{ background: `${VAULT_COLOR[node.vault]}22`, color: VAULT_COLOR[node.vault] }}>{vault?.label}</span>
            <span className="rounded bg-ink-750 px-1.5 py-px">{CEREBRO_KIND_LABEL[node.kind]}</span>
            <span className={`rounded px-1.5 py-px font-semibold ${node.camada === 'oficio' ? 'bg-ink-700 text-ink-200' : node.camada === 'pessoal' ? 'bg-nc-500/20 text-nc-300' : 'bg-amber-400/15 text-amber-300'}`} title={CEREBRO_CAMADA_LABEL[node.camada]}>
              {node.camada === 'oficio' ? 'ofício · embarca' : node.camada === 'pessoal' ? 'pessoal · só seu' : 'cliente'}
            </span>
            {node.casa && <span className="rounded bg-emerald-400/15 px-1.5 py-px font-semibold text-emerald-300">padrão da casa</span>}
            {node.teste && <span className="rounded bg-amber-400/15 px-1.5 py-px font-semibold text-amber-300">teste</span>}
            {node.words > 0 && <span>{node.words} palavras</span>}
            {node.mtime > 0 && <span>· {new Date(node.mtime).toLocaleDateString('pt-BR')}</span>}
            <span>· {total} ligações</span>
          </div>
          {node.path && <div className="mt-1 truncate font-mono text-ui-xs text-ink-500" title={node.path}>{node.path}</div>}
        </div>
        <IconButton label="Fechar" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="flex gap-2 border-b border-ink-750 px-4 py-2">
        {node.path || node.kind === 'cerebro' ? (
          <a href={obsidianUrl(vault?.name ?? '', isNote ? node.path : '')} className="flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-ui-sm text-ink-200 hover:border-ink-500 hover:text-white">
            <ExternalLink size={13} /> Abrir no Obsidian
          </a>
        ) : perfilId ? (
          <a href={`#/perfis`} className="flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-ui-sm text-ink-200 hover:border-ink-500 hover:text-white">
            <ExternalLink size={13} /> Ver o perfil no produto
          </a>
        ) : null}
        <Button size="sm" icon={<Crosshair size={13} />} onClick={() => onFocus(node.id)}>
          Centralizar
        </Button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {links.length > 0 && (
          <div className="border-b border-ink-750 px-4 py-3">
            <div className="mb-1.5 text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">Ligações</div>
            {links.map(([kind, list]) => (
              <div key={kind} className="mb-2">
                <div className="text-ui-xs text-ink-400">
                  {CEREBRO_EDGE_LABEL[kind]} · {list.length}
                </div>
                <ul className="mt-0.5">
                  {list.slice(0, 14).map((l) => (
                    <li key={l.id}>
                      <button onClick={() => onSelect(l.id)} onDoubleClick={() => onFocus(l.id)} className="flex w-full items-center gap-2 rounded-ui-sm px-1.5 py-0.5 text-left text-ui-xs text-ink-200 hover:bg-ink-800">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(l.id) }} />
                        <span className="truncate">{l.label}</span>
                        {(kind === 'decisao' || kind === 'correcao') && l.w > 1 && <span className="ml-auto text-ui-2xs text-ink-400">×{l.w}</span>}
                      </button>
                    </li>
                  ))}
                  {list.length > 14 && <li className="px-1.5 text-ui-xs text-ink-500">… e mais {list.length - 14}</li>}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-3">
          {err && <p className="text-ui-xs text-rose-300">{err}</p>}
          {note ? (
            <>
              <Markdown text={note.content} />
              {note.truncated && <p className="mt-3 text-ui-xs text-ink-500">Prévia: a nota é maior — abra no Obsidian para ler inteira.</p>}
            </>
          ) : !isNote ? (
            <p className="text-ui-sm text-ink-300">{node.excerpt}</p>
          ) : (
            !err && <p className="text-ui-xs text-ink-400">Lendo a nota…</p>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Markdown mínimo (títulos, listas, tabelas/código em mono, negrito, código inline) — prévia, não editor. */
function Markdown({ text }: { text: string }) {
  const lines = text.replace(/^---[\s\S]*?---\s*/m, '').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((p, k) => (p.startsWith('**') ? <strong key={k} className="font-semibold text-white">{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={k} className="rounded bg-ink-750 px-1 font-mono text-ui-xs text-nc-300">{p.slice(1, -1)}</code> : p));
  };
  while (i < lines.length) {
    const l = lines[i]!;
    if (/^```/.test(l) || /^\s*\|/.test(l)) {
      const fence = /^```/.test(l);
      const block: string[] = [];
      if (fence) i++;
      while (i < lines.length && (fence ? !/^```/.test(lines[i]!) : /^\s*\|/.test(lines[i]!))) block.push(lines[i++]!);
      if (fence) i++;
      out.push(<pre key={key++} className="scroll-thin my-2 overflow-x-auto rounded-ui-md bg-ink-900 p-2 font-mono text-ui-xs leading-snug text-ink-200">{block.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      const lvl = h[1]!.length;
      out.push(<div key={key++} className={`${lvl === 1 ? 'mt-1 text-ui-md font-semibold text-white' : lvl === 2 ? 'mt-3 text-ui-sm font-semibold text-white' : 'mt-2 text-ui-xs font-semibold tracking-wide text-ink-300 uppercase'}`}>{inline(h[2]!)}</div>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ''));
      out.push(<ul key={key++} className="my-1 list-disc space-y-0.5 pl-4 text-ui-xs text-ink-200">{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ul>);
      continue;
    }
    if (/^\s*>/.test(l)) {
      out.push(<blockquote key={key++} className="my-1 border-l-2 border-nc-500/60 pl-2 text-ui-xs text-ink-300 italic">{inline(l.replace(/^\s*>\s?/, ''))}</blockquote>);
      i++;
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const para: string[] = [l];
    i++;
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\s*\||\s*([-*]|\d+\.)\s|\s*>)/.test(lines[i]!)) para.push(lines[i++]!);
    out.push(<p key={key++} className="my-1 text-ui-xs leading-relaxed text-ink-200">{inline(para.join(' '))}</p>);
  }
  return <div>{out}</div>;
}
