/**
 * CinePRO dentro do Editor Brain (pedido do Thales, 2026-10-12), pela nuvem do CinePRO: o mesmo catálogo
 * branded do plugin. Duas abas usam este painel — CinePRO (modo "som": SFX e trilhas) e Efeitos (modo
 * "visual": overlays, transições, flares, frames, GIFs). Árvore de pastas, busca, lista ou grade, prévia
 * (áudio toca; vídeo e imagem mostram miniatura) e "+" no cursor. Arrastar para a timeline também vale.
 * Os arquivos são baixados da CDN na primeira vez e ficam em cache no servidor.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, LayoutGrid, List, Pause, Play, Plus, RefreshCw, Search } from 'lucide-react';
import { api, cineproFileUrl, cineproThumbUrl, type CineproItem, type CineproNode, type CineproResumo, type CineproTipo } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { Button, IconButton } from './ui.tsx';
import { CINEPRO_MIME } from '../editor/shared.ts';

const LS_VIEW = 'ne-cinepro-view';

export function CineproPanel({ modo }: { modo: 'som' | 'visual' }) {
  const project = useEditor((s) => s.project);
  const [resumo, setResumo] = useState<CineproResumo | null>(null);
  const [erro, setErro] = useState('');
  const [pasta, setPasta] = useState('');
  const [tipo, setTipo] = useState<CineproTipo | ''>('');
  const [busca, setBusca] = useState('');
  const [view, setView] = useState<'grade' | 'lista'>(() => (localStorage.getItem(LS_VIEW) === 'lista' ? 'lista' : 'grade'));
  const [lista, setLista] = useState<{ total: number; itens: CineproItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const audio = useRef<HTMLAudioElement>(null);

  const load = () => api.cinepro(modo).then(setResumo).catch((e: Error) => setErro(e.message));
  useEffect(() => {
    setResumo(null);
    setPasta('');
    setTipo('');
    setBusca('');
    void load();
  }, [modo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => {
      api.cineproItens({ modo, pasta: pasta || undefined, tipo: tipo || undefined, busca: busca.trim() || undefined, limit: 160 }).then(setLista).catch((e: Error) => setErro(e.message));
    }, 180);
    return () => clearTimeout(t);
  }, [modo, pasta, tipo, busca, resumo?.builtAt]);
  useEffect(() => () => audio.current?.pause(), []);
  useEffect(() => localStorage.setItem(LS_VIEW, view), [view]);

  const toggleAudio = (it: CineproItem) => {
    const el = audio.current!;
    if (playing === it.id) {
      el.pause();
      setPlaying(null);
      return;
    }
    useEditor.getState().setPlaying(false);
    el.src = cineproFileUrl(it.id);
    el.currentTime = 0;
    void el.play().catch(() => undefined);
    setPlaying(it.id);
  };
  const usar = async (it: CineproItem) => {
    if (!project) return;
    setBusy(true);
    setMsg(`Baixando ${it.nome}…`);
    try {
      const r = await api.cineproUsar(project.id, it.id, useEditor.getState().playhead);
      setMsg(`${it.nome} → ${r.trackId}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
    setTimeout(() => setMsg(''), 5000);
  };
  const atualizar = async () => {
    setBusy(true);
    await api.cineproReindexar().catch((e: Error) => setErro(e.message));
    await load();
    setBusy(false);
  };

  if (erro && !resumo) return <p className="p-4 text-ui-xs text-rose-300">{erro}</p>;
  if (!resumo) return <p className="p-4 text-ui-xs text-ink-400">Lendo o catálogo da nuvem do CinePRO…</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      <div className="space-y-1.5 border-b border-ink-750 p-2">
        <label className="flex items-center gap-1.5 rounded-ui-md border border-ink-700 bg-ink-900 px-2">
          <Search size={12} className="text-ink-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={`Buscar em ${resumo.total.toLocaleString('pt-BR')} ${modo === 'som' ? 'sons' : 'efeitos'}…`} aria-label="Buscar no CinePRO" className="w-full bg-transparent py-1 text-ui-xs text-ink-100 outline-none" />
          {busca && (
            <button onClick={() => setBusca('')} className="text-ink-400 hover:text-white" aria-label="Limpar busca">
              ✕
            </button>
          )}
        </label>
        <div className="flex items-center gap-1">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as CineproTipo | '')} className="input min-w-0 flex-1 py-1 text-ui-xs" aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {(Object.keys(resumo.tipos) as CineproTipo[])
              .filter((t) => resumo.porTipo[t])
              .map((t) => (
                <option key={t} value={t}>
                  {resumo.tipos[t]} · {resumo.porTipo[t]}
                </option>
              ))}
          </select>
          <IconButton label="Ver em grade" active={view === 'grade'} className="!p-1" onClick={() => setView('grade')}>
            <LayoutGrid size={13} />
          </IconButton>
          <IconButton label="Ver em lista" active={view === 'lista'} className="!p-1" onClick={() => setView('lista')}>
            <List size={13} />
          </IconButton>
          <IconButton label="Atualizar o catálogo da nuvem" className="!p-1" disabled={busy} onClick={atualizar}>
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="scroll-thin w-[132px] shrink-0 overflow-y-auto border-r border-ink-750 py-1">
          <TreeButton label="Tudo" count={resumo.total} depth={0} active={pasta === ''} onClick={() => setPasta('')} />
          {resumo.arvore.map((n) => (
            <Tree key={n.rel} node={n} depth={0} sel={pasta} onSel={setPasta} />
          ))}
        </aside>
        <div className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto p-2">
          {msg && <p className="mb-2 rounded-ui-md bg-ink-800 px-2 py-1 text-ui-xs text-emerald-300">{msg}</p>}
          {!lista ? (
            <p className="text-ui-xs text-ink-400">Procurando…</p>
          ) : !lista.itens.length ? (
            <p className="text-ui-xs text-ink-400">Nada com esse nome aqui.</p>
          ) : view === 'grade' ? (
            <div className="grid grid-cols-2 gap-1.5">
              {lista.itens.map((it) => (
                <Card key={it.id} it={it} playing={playing === it.id} onPlay={() => toggleAudio(it)} onUse={() => usar(it)} />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-ink-750/60">
              {lista.itens.map((it) => (
                <RowItem key={it.id} it={it} playing={playing === it.id} onPlay={() => toggleAudio(it)} onUse={() => usar(it)} />
              ))}
            </div>
          )}
          {lista && lista.total > lista.itens.length && <p className="mt-2 text-center text-ui-xs text-ink-400">{lista.itens.length} de {lista.total}: refine a busca ou entre numa pasta.</p>}
        </div>
      </div>
      <p className="border-t border-ink-750 px-3 py-1.5 text-ui-xs leading-snug text-ink-400">
        {modo === 'som' ? '"+" põe no cursor: SFX em A2, trilha em A3 (substitui a atual). Arrastar para a trilha também vale. Os arquivos vêm da nuvem do CinePRO e ficam em cache.' : '"+" põe no cursor: vídeo com alfa em V3, o resto em V2 até o corte. Looks (LUTs) ficam na aba Cor; presets do Premiere só aparecem.'}
      </p>
    </div>
  );
}

function Tree({ node, depth, sel, onSel }: { node: CineproNode; depth: number; sel: string; onSel: (rel: string) => void }) {
  const [open, setOpen] = useState(depth === 0);
  const active = sel === node.rel;
  const inside = sel.startsWith(`${node.rel}/`);
  return (
    <div>
      <TreeButton
        label={node.nome.replace(/^CinePRO /, '')}
        count={node.itens}
        depth={depth}
        active={active}
        open={node.filhos.length ? open || inside : undefined}
        onToggle={() => setOpen(!open)}
        onClick={() => {
          onSel(node.rel);
          if (!open) setOpen(true);
        }}
      />
      {(open || inside) && node.filhos.map((c) => <Tree key={c.rel} node={c} depth={depth + 1} sel={sel} onSel={onSel} />)}
    </div>
  );
}

function TreeButton({ label, count, depth, active, open, onToggle, onClick }: { label: string; count: number; depth: number; active: boolean; open?: boolean; onToggle?: () => void; onClick: () => void }) {
  return (
    <div className={`flex items-center gap-0.5 pr-1 ${active ? 'bg-nc-500/15 text-white' : 'text-ink-300 hover:bg-ink-800'}`} style={{ paddingLeft: 4 + depth * 10 }}>
      {open !== undefined ? (
        <button onClick={onToggle} className="rounded p-0.5 text-ink-400 hover:text-white" aria-label={open ? 'Recolher' : 'Expandir'}>
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
      ) : (
        <span className="w-[14px]" />
      )}
      <button onClick={onClick} className="min-w-0 flex-1 truncate py-1 text-left text-ui-xs" title={label}>
        {label}
      </button>
      <span className="text-ui-2xs text-ink-500">{count}</span>
    </div>
  );
}

function useDrag(it: CineproItem) {
  return {
    draggable: it.insere,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(CINEPRO_MIME, it.id);
      e.dataTransfer.effectAllowed = 'copy';
    },
  };
}

const isAudio = (it: CineproItem) => it.kind === 'audio';
const tip = (it: CineproItem) => `${it.categoria}${it.pasta ? `/${it.pasta}` : ''}\n${it.nome}.${it.ext}${it.tags.length ? `\n${it.tags.join(', ')}` : ''}${it.tamanho ? `\n${(it.tamanho / 1e6).toFixed(1)} MB` : ''}`;

function Card({ it, playing, onPlay, onUse }: { it: CineproItem; playing: boolean; onPlay: () => void; onUse: () => void }) {
  const drag = useDrag(it);
  return (
    <div {...drag} className={`group overflow-hidden rounded-ui-md border border-ink-700 bg-ink-800 transition ${it.insere ? 'cursor-grab hover:border-nc-500' : 'opacity-70'}`} title={tip(it)}>
      <div className="relative aspect-video bg-ink-900">
        {it.thumb ? <img src={cineproThumbUrl(it.id)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} /> : null}
        {isAudio(it) && (
          <button onClick={onPlay} aria-label={playing ? 'Parar' : 'Ouvir'} className={`absolute inset-0 flex items-center justify-center ${playing ? 'bg-nc-500/30' : 'bg-black/20 hover:bg-black/40'}`}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white">{playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}</span>
          </button>
        )}
        <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-ui-xs font-semibold text-ink-200">{it.ext.toUpperCase()}</span>
        {it.insere && (
          <button aria-label="Inserir no cursor" title="Inserir no cursor" onClick={onUse} className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-nc-500 text-white opacity-0 shadow transition group-hover:opacity-100 hover:brightness-110">
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="truncate px-1.5 py-1 text-ui-xs text-ink-300">{it.nome}</div>
    </div>
  );
}

function RowItem({ it, playing, onPlay, onUse }: { it: CineproItem; playing: boolean; onPlay: () => void; onUse: () => void }) {
  const drag = useDrag(it);
  return (
    <div {...drag} className={`group flex items-center gap-2 py-1 ${it.insere ? 'cursor-grab hover:bg-ink-800' : 'opacity-70'}`} title={tip(it)}>
      {isAudio(it) ? (
        <button onClick={onPlay} aria-label={playing ? 'Parar' : 'Ouvir'} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${playing ? 'bg-nc-500 text-white' : 'bg-ink-700 text-ink-200 hover:bg-nc-500 hover:text-white'}`}>
          {playing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-px" />}
        </button>
      ) : it.thumb ? (
        <img src={cineproThumbUrl(it.id)} alt="" loading="lazy" className="h-6 w-10 shrink-0 rounded object-cover" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      ) : (
        <FolderOpen size={14} className="shrink-0 text-ink-500" />
      )}
      <span className="min-w-0 flex-1 truncate text-ui-xs text-ink-200">{it.nome}</span>
      <span className="shrink-0 text-ui-xs text-ink-500">{it.ext}</span>
      {it.insere && (
        <Button size="sm" variant="ghost" className="!h-6 !px-1.5 opacity-0 group-hover:opacity-100" onClick={onUse} aria-label="Inserir no cursor">
          <Plus size={12} />
        </Button>
      )}
    </div>
  );
}
