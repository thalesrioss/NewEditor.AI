import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Download, ExternalLink, Film, LayoutGrid, Play, Search, SlidersHorizontal, X } from 'lucide-react';
import { api, type VideoEditado } from '../lib/api.ts';
import { Notifications } from './Notifications.tsx';

/** Um card da produtora com as versões entregues, a mais nova primeiro. */
interface GrupoCard {
  card: string;
  cliente: string;
  titulo: string;
  etapa: string;
  editor: string;
  trello?: string;
  drive?: string;
  projectId?: string;
  emEdicaoPor?: string;
  data: string;
  versoes: VideoEditado[];
}

const fmtData = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtMb = (b: number) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0).replace('.', ',')} MB`;
/** "studio-editor-1 (Pedro)" → "Pedro". */
const nomeEditor = (e: string) => /\(([^)]+)\)/.exec(e)?.[1] ?? e;

/**
 * Central da produtora (FB-0169): todos os vídeos editados, de todos os editores (humanos e agentes), agrupados por
 * card. Cada versão toca aqui mesmo; do card se abre o projeto no editor para assumir. Atualiza sozinho.
 */
export function VideosPage() {
  const [videos, setVideos] = useState<VideoEditado[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cliente, setCliente] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [tocando, setTocando] = useState<VideoEditado | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .videos()
        .then((r) => (setVideos(r.videos), setErro(null), setLoaded(true)))
        .catch((e: Error) => (setErro(e.message), setLoaded(true)));
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const grupos = useMemo(() => {
    const m = new Map<string, GrupoCard>();
    for (const v of videos) {
      const g = m.get(v.card) ?? { card: v.card, cliente: v.cliente, titulo: v.titulo, etapa: v.etapa, editor: v.editor, trello: v.trello, drive: v.drive, projectId: v.projectId, emEdicaoPor: v.emEdicaoPor, data: v.data, versoes: [] };
      g.versoes.push(v);
      if (v.data > g.data) g.data = v.data;
      m.set(v.card, g);
    }
    for (const g of m.values()) g.versoes.sort((a, b) => (b.versao ?? 0) - (a.versao ?? 0) || b.data.localeCompare(a.data));
    return [...m.values()].sort((a, b) => b.data.localeCompare(a.data));
  }, [videos]);
  const clientes = useMemo(() => [...new Set(grupos.map((g) => g.cliente))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [grupos]);
  const q = busca.trim().toLocaleLowerCase('pt-BR');
  const visiveis = grupos.filter((g) => (!cliente || g.cliente === cliente) && (!q || `${g.cliente} ${g.titulo} ${g.editor} ${g.card}`.toLocaleLowerCase('pt-BR').includes(q)));

  return (
    <div className="flex h-full flex-col">
      <header className="ne-titlebar flex items-center gap-3 border-b border-ink-750 px-6 py-4">
        <img src="/logo-mark.png" alt="NewContent" className="h-8" />
        <div>
          <div className="text-base font-semibold">
            NewEditor<span className="nc-text-gradient">.AI</span>
          </div>
          <div className="text-ui-sm text-ink-400">
            Vídeos editados · {videos.length} {videos.length === 1 ? 'versão' : 'versões'} em {grupos.length} {grupos.length === 1 ? 'card' : 'cards'}
          </div>
        </div>
        <label className="ml-6 flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-ui-sm text-ink-300 focus-within:border-ink-500">
          <Search size={13} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, vídeo ou editor" className="w-56 bg-transparent text-white outline-none placeholder:text-ink-500" />
        </label>
        <div className="ml-auto flex items-center gap-2">
          <a href="#/" className="flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-ui-sm text-ink-300 hover:border-ink-500 hover:text-white" title="Kanban dos projetos de edição">
            <LayoutGrid size={13} /> Projetos
          </a>
          <a href="#/cerebro" className="flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-ui-sm text-ink-300 hover:border-ink-500 hover:text-white">
            <BrainCircuit size={13} /> Cérebro
          </a>
          <a href="#/perfis" className="flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-ui-sm text-ink-300 hover:border-ink-500 hover:text-white">
            <SlidersHorizontal size={13} /> Perfis
          </a>
          <Notifications />
        </div>
      </header>

      {clientes.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-ink-750 px-6 py-2.5">
          {[null, ...clientes].map((c) => (
            <button key={c ?? '*'} onClick={() => setCliente(c)} aria-pressed={cliente === c} className={`rounded-full border px-3 py-0.5 text-ui-sm transition ${cliente === c ? 'border-nc-400 bg-nc-500/15 text-white' : 'border-ink-700 text-ink-300 hover:border-ink-500 hover:text-white'}`}>
              {c ?? 'Todos'}
            </button>
          ))}
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        {erro && <div className="rounded-[var(--radius-ui-md)] border border-red-500/40 bg-red-500/10 px-4 py-2 text-ui-sm text-red-200">Não consegui ler os vídeos: {erro}</div>}
        {loaded && !erro && !videos.length && (
          <div className="mx-auto max-w-md rounded-[var(--radius-ui-lg)] border border-ink-750 bg-ink-850 p-6 text-center text-ui-sm text-ink-300">
            Nenhum vídeo editado ainda. Cada versão salva em <span className="font-mono">producao/&lt;cliente&gt;/&lt;card&gt;/entrega/</span> aparece aqui sozinha.
          </div>
        )}
        {visiveis.map((g) => (
          <section key={g.card} className="rounded-[var(--radius-ui-lg)] border border-ink-750 bg-ink-850 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="text-ui-xs font-semibold tracking-wide text-nc-300 uppercase">{g.cliente}</div>
              <div className="text-sm font-semibold text-white">{g.titulo}</div>
              {g.etapa && <span className="rounded-full bg-ink-750 px-2 py-0.5 text-ui-xs text-ink-200">{g.etapa}</span>}
              {g.editor && <span className="text-ui-xs text-ink-400">editor: {nomeEditor(g.editor)}</span>}
              {g.emEdicaoPor && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-ui-xs font-semibold text-amber-200" title="O editor agente deste card não é redisparado até devolver a edição">
                  Em edição por {g.emEdicaoPor}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2 text-ui-sm">
                {g.trello && (
                  <a href={g.trello} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-ink-300 hover:text-white">
                    Trello <ExternalLink size={12} />
                  </a>
                )}
                {g.drive && (
                  <a href={g.drive} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-ink-300 hover:text-white">
                    Drive <ExternalLink size={12} />
                  </a>
                )}
                {g.projectId ? (
                  <a href={`#/p/${g.projectId}`} className="flex items-center gap-1.5 rounded-lg nc-gradient px-3 py-1 text-xs font-semibold text-white" title="Abrir o projeto no editor para assumir a edição">
                    <Film size={13} /> Abrir projeto
                  </a>
                ) : (
                  <span className="text-ui-xs text-ink-500" title="Nenhum projeto do Editor Brain usa o bruto deste card">sem projeto no Editor Brain</span>
                )}
              </div>
            </div>
            <div className="scroll-thin flex gap-3 overflow-x-auto pb-1">
              {g.versoes.map((v) => (
                <button key={v.id} onClick={() => setTocando(v)} className="group w-[150px] shrink-0 text-left" title={v.arquivo}>
                  <div className="relative aspect-[9/16] overflow-hidden rounded-[var(--radius-ui-md)] bg-black ring-1 ring-ink-750 transition group-hover:ring-nc-400">
                    <video src={`${v.url}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                      <Play size={28} className="rounded-full bg-black/60 p-1.5 text-white" />
                    </div>
                    <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 text-ui-xs font-semibold text-white">{v.versao ? `v${v.versao}` : 'versão'}</span>
                  </div>
                  <div className="mt-1 text-ui-xs text-ink-400">
                    {fmtData(v.data)} · {fmtMb(v.bytes)}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {tocando && <PlayerModal v={tocando} onClose={() => setTocando(null)} />}
    </div>
  );
}

function PlayerModal({ v, onClose }: { v: VideoEditado; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="anim-pop flex max-h-full flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-ink-750 px-4 py-2.5">
          <div className="text-sm font-semibold">
            {v.titulo} {v.versao ? `· v${v.versao}` : ''}
          </div>
          <div className="truncate font-mono text-ui-xs text-ink-400">{v.arquivo}</div>
          {v.projectId && (
            <a href={`#/p/${v.projectId}`} className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:text-white">
              <Film size={13} /> Abrir projeto
            </a>
          )}
          <a href={v.url} download={v.arquivo} className={`${v.projectId ? '' : 'ml-auto '}flex items-center gap-1.5 rounded-lg nc-gradient px-3 py-1.5 text-xs font-semibold text-white`}>
            <Download size={13} /> Baixar
          </a>
          <button aria-label="Fechar (Esc)" onClick={onClose} className="rounded-md p-1 text-ink-400 hover:text-white" title="Fechar (Esc)">
            <X size={16} />
          </button>
        </div>
        <video src={v.url} controls autoPlay playsInline className="h-[78vh] bg-black" />
      </div>
    </div>
  );
}
