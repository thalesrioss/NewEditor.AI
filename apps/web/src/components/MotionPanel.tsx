import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clapperboard, ExternalLink, ImagePlus, Link2, Loader2, Plus, Sparkles, Trash2, Volume2, Wand2 } from 'lucide-react';
import { formatTime, MOTION_TEMPLATES, NARRATIVE_FUNCTIONS, resolveOverlay, type NarrativeFunction } from '@neweditor/core';
import { api, refUrl, type LinkMeta, type MotionRef, type StoryResponse } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { ConfirmButton, RangeField } from './ui.tsx';
import { MotionStudioCard } from './MotionStudioCard.tsx';

type Lib = { refs: MotionRef[]; categorias: string[]; familias: string[] };

export const FUNC_STYLE: Record<NarrativeFunction, string> = {
  explain: 'bg-sky-500/15 text-sky-300',
  prove: 'bg-amber-500/15 text-amber-300',
  contrast: 'bg-rose-500/15 text-rose-300',
  reveal: 'bg-violet-500/15 text-violet-300',
  emotion: 'bg-pink-500/15 text-pink-300',
  reset: 'bg-emerald-500/15 text-emerald-300',
};

/**
 * Aba Motion: os motions narrativos do vídeo (lidos da história inteira) e a biblioteca de referências —
 * cada referência é um .md no formato do Motion Studio, mostrada como card, igual à aba de mídia.
 */
export function MotionPanel() {
  const [view, setView] = useState<'video' | 'refs'>('video');
  const [lib, setLib] = useState<Lib | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // Só as referências de motion (as de lettering vivem na aba Texto).
  const reload = useCallback(() => api.motionRefs().then((l) => setLib({ ...l, refs: l.refs.filter((r) => r.uso !== 'lettering') })).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => void reload(), [reload]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MotionStudioCard />
      <div className="flex gap-1 border-b border-ink-750 p-2">
        {(
          [
            ['video', 'Neste vídeo'],
            ['refs', `Referências${lib ? ` · ${lib.refs.length}` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => {
              setView(id);
              if (id === 'refs') void reload();
            }}
            className={`flex-1 rounded-ui-md px-2 py-1.5 text-ui-xs font-semibold transition ${view === id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {err && <p className="px-3 pt-2 text-ui-xs text-rose-400">{err}</p>}
      <div className="min-h-0 flex-1">
        {view === 'video' ? (
          <VideoView
            lib={lib}
            onOpenRef={(id) => {
              setOpen(id);
              setView('refs');
            }}
          />
        ) : (
          <RefsView lib={lib} reload={reload} open={open} setOpen={setOpen} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Neste vídeo: leitura da história + obra-alvo + motions na timeline
// ---------------------------------------------------------------------------

function VideoView({ lib, onOpenRef }: { lib: Lib | null; onOpenRef: (id: string) => void }) {
  const project = useEditor((s) => s.project)!;
  const activity = useEditor((s) => s.activity);
  const select = useEditor((s) => s.select);
  const seek = useEditor((s) => s.seek);
  const [story, setStory] = useState<StoryResponse | null>(null);
  const [err, setErr] = useState('');
  const tl = project.timeline;
  const shape = `${tl.main.length}:${tl.removals.length}:${tl.motionRef ?? ''}`;
  useEffect(() => {
    api
      .story(project.id)
      .then((s) => (setStory(s), setErr('')))
      .catch((e: Error) => setErr(e.message));
  }, [project.id, shape]);

  const motions = useMemo(
    () =>
      tl.overlays
        .flatMap((o) => {
          const pos = resolveOverlay(tl, o);
          return o.source.type === 'motion' && pos ? [{ o, spec: o.source.motion, ...pos }] : [];
        })
        .sort((a, b) => a.start - b.start),
    [tl],
  );
  const ref = lib?.refs.find((r) => r.id === story?.ref?.id);
  const busy = activity.state === 'thinking' || activity.state === 'motion';
  const r = story?.reading;

  return (
    <div className="scroll-thin h-full space-y-3 overflow-y-auto p-3">
      {err && <p className="text-ui-xs text-ink-400">{err}</p>}
      {r && (
        <section className="space-y-2 rounded-ui-md border border-ink-750 bg-ink-800/60 p-3">
          <h4 className="text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">Leitura da história</h4>
          <div className="flex flex-wrap gap-1">
            {r.tema.map((t) => (
              <span key={t} className="rounded-full bg-ink-700 px-2 py-0.5 text-ui-xs text-ink-200">
                {t}
              </span>
            ))}
            {r.topicos.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full border border-nc-500/40 px-2 py-0.5 text-ui-xs text-nc-300">
                {t}
              </span>
            ))}
          </div>
          {(
            [
              ['Gancho', r.gancho],
              ['Virada', r.virada],
              ['Tese', r.tese],
              ['Fecho', r.fechamento],
            ] as const
          ).map(([k, b]) =>
            b ? (
              <button key={k} onClick={() => seek(b.start)} className="group flex w-full gap-2 text-left">
                <span className="w-12 shrink-0 pt-px text-ui-xs font-semibold text-ink-400 uppercase">{k}</span>
                <span className="line-clamp-2 flex-1 text-ui-xs leading-snug text-ink-300 group-hover:text-white">"{b.text}"</span>
                <span className="font-mono text-ui-xs text-ink-400">{formatTime(b.start)}</span>
              </button>
            ) : null,
          )}
          {r.ctaDesde !== undefined && <p className="text-ui-xs text-ink-400">CTA a partir de {formatTime(r.ctaDesde)} — fica sem motion.</p>}
        </section>
      )}

      <section className="flex items-center gap-2.5 rounded-ui-md border border-ink-750 bg-ink-800/60 p-2.5">
        <RefThumb refItem={ref} className="h-12 w-16 shrink-0 rounded-ui-md" />
        <div className="min-w-0 flex-1">
          <div className="text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">Obra-alvo {story?.ref?.auto ? '· sugerida' : ''}</div>
          <div className="truncate text-ui-sm font-semibold text-ink-100">{story?.ref?.obra ?? 'Estilo da casa'}</div>
          {story?.ref && <div className="line-clamp-2 text-ui-xs leading-snug text-ink-400">{story.ref.why}</div>}
          {ref && <Palette colors={ref.paleta} />}
        </div>
        {ref && (
          <button onClick={() => onOpenRef(ref.id)} className="self-start text-ui-xs text-nc-300 hover:text-white">
            trocar
          </button>
        )}
      </section>

      {motions.length > 0 && <SfxVolume />}

      <button
        disabled={busy || !story}
        onClick={() => void api.motionsAuto(project.id).catch((e: Error) => setErr(e.message))}
        className="flex w-full items-center justify-center gap-1.5 rounded-ui-md nc-gradient px-3 py-2 text-ui-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
        {busy ? activity.message || 'Trabalhando…' : motions.some((m) => m.o.by === 'agent') ? 'Refazer motions narrativos' : 'Criar motions narrativos'}
      </button>

      <div className="space-y-1.5">
        {motions.map(({ o, spec, start, end }) => (
          <button
            key={o.id}
            onClick={() => (seek(start), select({ kind: 'overlay', id: o.id }))}
            className="block w-full rounded-ui-md border border-ink-750 bg-ink-800 p-2.5 text-left transition hover:border-nc-500"
          >
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-ui-xs text-ink-400">{formatTime(start)}</span>
              <span className={`rounded px-1.5 py-px text-ui-xs font-semibold ${FUNC_STYLE[spec.funcao]}`}>{NARRATIVE_FUNCTIONS[spec.funcao].label}</span>
              <span className="truncate text-ui-xs font-semibold text-ink-100">{MOTION_TEMPLATES[spec.template].label}</span>
              <span className="ml-auto font-mono text-ui-xs text-ink-400">{(end - start).toFixed(1)}s</span>
              {o.by === 'human' && <span className="text-ui-xs text-nc-300" title="Ajustado à mão: o agente não refaz">✋</span>}
            </div>
            <p className="mt-1 line-clamp-2 text-ui-xs leading-snug text-ink-300">"{spec.fala}"</p>
            <p className="mt-0.5 line-clamp-2 text-ui-xs leading-snug text-ink-400">{spec.ideia}</p>
          </button>
        ))}
        {!motions.length && <p className="px-1 text-ui-xs leading-snug text-ink-400">O agente lê o vídeo inteiro, acha gancho, virada e tese, e põe um motion onde uma imagem conta melhor que a fala: número que prova, lista que explica, oposição, pergunta, citação.</p>}
      </div>
      {motions.length > 0 && <p className="px-1 text-ui-xs leading-snug text-ink-400">O MOTION_SPEC de cada um fica em motions.md no projeto — o mesmo contrato do Motion Studio.</p>}
    </div>
  );
}

/** Volume geral dos SFX dos motions (o nível base já vem calibrado pela voz). */
function SfxVolume() {
  const sendOp = useEditor((s) => s.sendOp);
  const db = useEditor((s) => s.project?.timeline.motionSfxDb ?? 0);
  return (
    <div className="rounded-ui-md border border-ink-750 bg-ink-800/60 px-3 py-2">
      <RangeField
        label="SFX dos motions"
        icon={<Volume2 size={12} className="text-ink-400" />}
        value={db}
        min={-24}
        max={12}
        step={1}
        unit="dB"
        resetTo={0}
        onCommit={(v) => sendOp({ op: { type: 'set_motion_sfx', gainDb: v }, note: `SFX dos motions em ${v > 0 ? '+' : ''}${v} dB` })}
        hint="0 dB = calibrado pela sua voz: o efeito fica abaixo da fala."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Biblioteca de referências
// ---------------------------------------------------------------------------

function RefsView({ lib, reload, open, setOpen }: { lib: Lib | null; reload: () => Promise<void>; open: string | null; setOpen: (id: string | null) => void }) {
  const project = useEditor((s) => s.project)!;
  const [filter, setFilter] = useState('todas');
  const [link, setLink] = useState('');
  const [draft, setDraft] = useState<LinkMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!lib) return <p className="p-4 text-ui-sm text-ink-400">Carregando…</p>;
  const current = open ? lib.refs.find((r) => r.id === open) : undefined;
  if (current) return <RefDetail refItem={current} lib={lib} reload={reload} onBack={() => setOpen(null)} />;
  if (draft) return <AddRef draft={draft} lib={lib} onCancel={() => setDraft(null)} onSaved={async (r) => (await reload(), setDraft(null), setLink(''), setOpen(r.id))} />;

  const used = (r: MotionRef) => r.usos.length > 0;
  const shown = lib.refs.filter((r) => filter === 'todas' || (filter === 'usadas' ? used(r) : r.categoria === filter));
  const fetchLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return;
    setBusy(true);
    setErr('');
    try {
      setDraft(await api.previewRef(link.trim()));
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={fetchLink} className="flex gap-1.5 border-b border-ink-750 p-3">
        <div className="flex flex-1 items-center gap-1.5 rounded-ui-md border border-ink-700 bg-ink-800 px-2">
          <Link2 size={13} className="shrink-0 text-ink-400" />
          <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Link da referência (Behance, YouTube…)" className="min-w-0 flex-1 bg-transparent py-1.5 text-ui-xs text-ink-100 placeholder:text-ink-400 focus:outline-none" />
        </div>
        <button disabled={busy} className="rounded-ui-md nc-gradient px-2.5 text-white disabled:opacity-50" title="Adicionar referência">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        </button>
      </form>
      {err && <p className="px-3 pt-2 text-ui-xs text-rose-400">{err}</p>}
      <div className="scroll-thin flex gap-1 overflow-x-auto px-3 pt-2.5 pb-1">
        {['todas', 'usadas', ...lib.categorias].map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={`shrink-0 rounded-full px-2 py-0.5 text-ui-xs ${filter === c ? 'bg-nc-500 text-white' : 'bg-ink-800 text-ink-400 hover:text-ink-200'}`}>
            {c === 'todas' ? 'Todas' : c === 'usadas' ? 'Já usadas' : c}
          </button>
        ))}
      </div>
      <div className="scroll-thin grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3">
        {shown.map((r) => (
          <RefCard key={r.id} r={r} target={project.timeline.motionRef === r.id} onClick={() => setOpen(r.id)} />
        ))}
        {!lib.refs.length && <ImportBrain onDone={reload} />}
        {lib.refs.length > 0 && !shown.length && <p className="col-span-2 pt-6 text-center text-ui-sm text-ink-400">Nada aqui ainda.</p>}
      </div>
    </div>
  );
}

function RefCard({ r, target, onClick }: { r: MotionRef; target: boolean; onClick: () => void }) {
  const uses = r.usos.reduce((a, u) => a + u.motions, 0);
  return (
    <button onClick={onClick} className={`group overflow-hidden rounded-ui-md border bg-ink-800 text-left transition hover:border-nc-500 ${target ? 'border-nc-500' : 'border-ink-700'}`} title={r.obra}>
      <div className="relative aspect-[4/3] bg-ink-900">
        <RefThumb refItem={r} className="absolute inset-0" />
        {target ? (
          <span className="absolute top-1 left-1 rounded bg-nc-500 px-1 text-ui-xs font-semibold text-white">obra-alvo</span>
        ) : r.usos.length ? (
          <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-ui-xs font-semibold text-ink-100">usada {uses > 0 ? `${uses}×` : ''}</span>
        ) : null}
        {r.quadros.length > 0 && <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-ui-xs text-white">{r.quadros.length} quadros</span>}
      </div>
      <div className="space-y-1 px-1.5 py-1.5">
        <div className="line-clamp-2 text-ui-xs leading-tight font-medium text-ink-100">{r.obra}</div>
        <div className="truncate text-ui-xs text-ink-400">{r.familias[0] ?? r.categoria}</div>
        <Palette colors={r.paleta} />
      </div>
    </button>
  );
}

function RefThumb({ refItem, className = '' }: { refItem?: MotionRef; className?: string }) {
  if (refItem?.capa) return <img src={refUrl(refItem.id, refItem.capa)} alt="" loading="lazy" className={`object-cover ${className}`} />;
  const p = refItem?.paleta ?? [];
  return (
    <div className={`flex items-center justify-center ${className}`} style={{ background: p.length > 1 ? `linear-gradient(135deg, ${p.slice(0, 3).join(', ')})` : '#1a1d24' }}>
      <Clapperboard size={16} className="text-white/40" />
    </div>
  );
}

function Palette({ colors, big = false }: { colors: string[]; big?: boolean }) {
  if (!colors.length) return null;
  return (
    <div className="flex gap-0.5">
      {colors.slice(0, 7).map((c) => (
        <span key={c} title={c} className={`${big ? 'h-6 flex-1 rounded' : 'h-2 w-2 rounded-full'} ring-1 ring-black/30`} style={{ background: c }} />
      ))}
    </div>
  );
}

function ImportBrain({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <div className="col-span-2 space-y-2 rounded-ui-md border border-dashed border-ink-600 p-4 text-center">
      <Sparkles size={18} className="mx-auto text-nc-300" />
      <p className="text-ui-xs leading-snug text-ink-300">Biblioteca vazia. Cole o link de um motion que você gosta acima, ou traga as referências do seu Motion Studio.</p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api.importRefs();
            setMsg(`${r.importadas} referências importadas`);
            await onDone();
          } catch (e) {
            setMsg((e as Error).message);
          }
          setBusy(false);
        }}
        className="rounded-ui-md border border-ink-600 px-3 py-1.5 text-ui-xs text-ink-100 hover:border-nc-500 disabled:opacity-50"
      >
        {busy ? 'Importando…' : 'Importar do Motion Studio - Brain'}
      </button>
      {msg && <p className="text-ui-xs text-ink-400">{msg}</p>}
    </div>
  );
}

/** Lê uma imagem colada (⌘V) ou arrastada como data URL. */
function pastedImage(e: React.ClipboardEvent | React.DragEvent): Promise<string> | null {
  const files = 'clipboardData' in e ? e.clipboardData.files : e.dataTransfer.files;
  const f = [...files].find((x) => x.type.startsWith('image/'));
  if (!f) return null;
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => res(String(rd.result));
    rd.onerror = rej;
    rd.readAsDataURL(f);
  });
}

function AddRef({ draft, lib, onCancel, onSaved }: { draft: LinkMeta; lib: Lib; onCancel: () => void; onSaved: (r: MotionRef) => void }) {
  const [obra, setObra] = useState(draft.titulo);
  const [categoria, setCategoria] = useState(draft.categoria);
  const [familias, setFamilias] = useState<string[]>([]);
  const [serve, setServe] = useState('');
  const [roubar, setRoubar] = useState('');
  const [capa, setCapa] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cover = capa ?? draft.imagem;
  return (
    <div
      className="scroll-thin h-full space-y-3 overflow-y-auto p-3"
      onPaste={(e) => {
        const p = pastedImage(e);
        if (p) void p.then(setCapa);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const p = pastedImage(e);
        if (p) void p.then(setCapa);
      }}
    >
      <button onClick={onCancel} className="flex items-center gap-1 text-ui-xs text-ink-400 hover:text-white">
        <ArrowLeft size={13} /> Voltar
      </button>
      <div className="relative aspect-video overflow-hidden rounded-ui-md bg-ink-900">
        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="flex h-full flex-col items-center justify-center gap-1 text-ui-xs text-ink-400"><ImagePlus size={18} />Cole (⌘V) ou arraste uma imagem para a capa</div>}
      </div>
      <p className="truncate text-ui-xs text-ink-400">{draft.link}</p>
      {draft.bloqueado && !capa && <p className="rounded-ui-md bg-amber-500/10 px-2 py-1.5 text-ui-xs leading-snug text-amber-200">Esse site não deixa ler a página automaticamente. Tire um print da obra e cole aqui (⌘V) ou arraste a imagem — a paleta sai dela.</p>}
      <Field label="Nome da obra">
        <input value={obra} onChange={(e) => setObra(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className="input py-1.5 text-ui-sm" />
      </Field>
      <Field label="Categoria">
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="input py-1.5 text-ui-sm">
          {lib.categorias.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Famílias (estética)">
        <Chips all={lib.familias} value={familias} onChange={setFamilias} />
      </Field>
      <Field label="Serve para (temas)">
        <input value={serve} onChange={(e) => setServe(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="filosofia, dados, emoção…" className="input py-1.5 text-ui-sm" />
      </Field>
      <Field label="O que você quer desse motion? (um por linha)">
        <textarea value={roubar} onChange={(e) => setRoubar(e.target.value)} onKeyDown={(e) => e.stopPropagation()} rows={3} className="input resize-none text-ui-sm" placeholder="Palavra-conceito dourada sobre a imagem…" />
      </Field>
      {err && <p className="text-ui-xs text-rose-400">{err}</p>}
      <button
        disabled={busy || !obra.trim()}
        onClick={async () => {
          setBusy(true);
          setErr('');
          try {
            onSaved(await api.createRef({ link: draft.link, obra, categoria, familias, serve, roubar: roubar.split('\n').map((x) => x.trim()).filter(Boolean), capa }));
          } catch (e) {
            setErr((e as Error).message);
            setBusy(false);
          }
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-ui-md nc-gradient py-2 text-ui-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Guardar referência (.md)
      </button>
    </div>
  );
}

function RefDetail({ refItem: r, lib, reload, onBack }: { refItem: MotionRef; lib: Lib; reload: () => Promise<void>; onBack: () => void }) {
  const project = useEditor((s) => s.project)!;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const isTarget = project.timeline.motionRef === r.id;
  const hasMotions = project.timeline.overlays.some((o) => o.source.type === 'motion');
  const act = (what: string, fn: () => Promise<unknown>) => async () => {
    setBusy(what);
    setErr('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };
  const patch = (p: Parameters<typeof api.patchRef>[1]) => void act('salvar', () => api.patchRef(r.id, p))();

  return (
    <div
      className="scroll-thin h-full space-y-3 overflow-y-auto p-3"
      onPaste={(e) => {
        const p = pastedImage(e);
        if (p) void act('quadro', async () => api.addRefFrame(r.id, await p))();
      }}
    >
      <button onClick={onBack} className="flex items-center gap-1 text-ui-xs text-ink-400 hover:text-white">
        <ArrowLeft size={13} /> Referências
      </button>
      <div className="overflow-hidden rounded-ui-md bg-ink-900">
        <RefThumb refItem={r} className="aspect-video w-full" />
      </div>
      <div>
        <h3 className="text-ui-md leading-tight font-semibold text-white">{r.obra}</h3>
        <p className="mt-0.5 text-ui-xs text-ink-400">
          {r.categoria}
          {r.familias.length ? ` · ${r.familias.join(' · ')}` : ''}
        </p>
        {r.link && (
          <a href={r.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-ui-xs text-nc-300 hover:text-white">
            Abrir original <ExternalLink size={11} />
          </a>
        )}
      </div>
      {r.resumo && <p className="border-l-2 border-nc-500/60 pl-2 text-ui-xs leading-snug text-ink-300 italic">{r.resumo}</p>}
      <Palette colors={r.paleta} big />

      <div className="grid grid-cols-1 gap-1.5">
        <button
          disabled={!!busy || isTarget}
          onClick={act('usar', () => api.useRef(project.id, r.id))}
          className="flex items-center justify-center gap-1.5 rounded-ui-md nc-gradient py-2 text-ui-sm font-semibold text-white disabled:opacity-50"
        >
          {isTarget ? <Check size={13} /> : <Sparkles size={13} />} {isTarget ? 'Obra-alvo deste vídeo' : hasMotions ? 'Usar neste vídeo (veste os motions)' : 'Usar como obra-alvo deste vídeo'}
        </button>
        {!hasMotions && (
          <button disabled={!!busy} onClick={act('criar', () => api.motionsAuto(project.id, r.id))} className="rounded-ui-md border border-ink-600 py-1.5 text-ui-xs text-ink-100 hover:border-nc-500 disabled:opacity-50">
            Criar os motions com esta referência
          </button>
        )}
      </div>
      {err && <p className="text-ui-xs text-rose-400">{err}</p>}

      {r.usos.length > 0 && (
        <p className="text-ui-xs text-ink-400">
          Usada em: {r.usos.map((u) => `${u.name}${u.motions ? ` (${u.motions})` : ''}`).join(' · ')}
          {r.usadoNaSerie ? ` · ${r.usadoNaSerie}× no Motion Studio` : ''}
        </p>
      )}

      <Section title="Como conta a história">
        <EditLine label="Fio condutor" value={r.fio} onSave={(v) => patch({ fio: v })} />
        <EditLine label="Mecanismo" value={r.mecanismo} onSave={(v) => patch({ mecanismo: v })} />
      </Section>
      <Section title="O que roubar">
        <EditList value={r.roubar} onSave={(v) => patch({ roubar: v })} />
      </Section>
      <Section title="Quando usar">
        <EditLine label="Serve para" value={r.serve} onSave={(v) => patch({ serve: v })} />
        <EditLine label="Evitar em" value={r.evitar} onSave={(v) => patch({ evitar: v })} />
      </Section>
      <Section title="Estética">
        <select value={r.categoria} onChange={(e) => patch({ categoria: e.target.value })} className="input py-1 text-ui-xs">
          {[...new Set([r.categoria, ...lib.categorias])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <Chips all={[...new Set([...lib.familias, ...r.familias])]} value={r.familias} onChange={(v) => patch({ familias: v })} />
      </Section>
      <Section title={`Storyboard · ${r.quadros.length} quadros`}>
        <div className="grid grid-cols-2 gap-1.5">
          {r.quadros.map((q) => (
            <figure key={q.file} className="overflow-hidden rounded bg-ink-900">
              <img src={refUrl(r.id, q.file)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
              {q.legenda && q.legenda !== '—' && <figcaption className="line-clamp-2 px-1 py-0.5 text-ui-xs leading-tight text-ink-400">{q.legenda}</figcaption>}
            </figure>
          ))}
        </div>
        <p className="text-ui-xs text-ink-400">{busy === 'quadro' ? 'Guardando quadro…' : 'Cole um print (⌘V) aqui para adicionar um quadro.'}</p>
      </Section>
      <p className="text-ui-xs text-ink-400">Arquivo: data/referencias/{r.id}/{r.file}</p>
      <ConfirmButton
        variant="ghost"
        size="sm"
        className="w-full"
        disabled={!!busy}
        icon={<Trash2 size={12} />}
        confirmLabel="Clique de novo: vai para a lixeira da biblioteca"
        onConfirm={() => void act('remover', async () => (await api.trashRef(r.id), onBack()))()}
      >
        Tirar da biblioteca
      </ConfirmButton>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-ui-xs font-medium text-ink-400">{label}</span>
      {children}
    </label>
  );
}

function Chips({ all, value, onChange }: { all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {all.map((f) => {
        const on = value.includes(f);
        return (
          <button key={f} type="button" onClick={() => onChange(on ? value.filter((x) => x !== f) : [...value, f])} className={`rounded-full px-2 py-0.5 text-ui-xs ${on ? 'bg-nc-500 text-white' : 'bg-ink-800 text-ink-400 hover:text-ink-200'}`}>
            {f}
          </button>
        );
      })}
    </div>
  );
}

function EditLine({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value === '—' ? '' : value);
  useEffect(() => setV(value === '—' ? '' : value), [value]);
  return (
    <label className="block">
      <span className="text-ui-xs font-semibold text-ink-400">{label}</span>
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== (value === '—' ? '' : value) && onSave(v)}
        onKeyDown={(e) => e.stopPropagation()}
        rows={Math.min(4, Math.max(1, Math.ceil(v.length / 38)))}
        className="w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-ui-xs leading-snug text-ink-200 hover:border-ink-700 focus:border-nc-500 focus:bg-ink-800 focus:outline-none"
        placeholder="—"
      />
    </label>
  );
}

function EditList({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }) {
  const text = value.filter((x) => x !== '—').join('\n');
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  return (
    <textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== text && onSave(v.split('\n').map((x) => x.trim()).filter(Boolean))}
      onKeyDown={(e) => e.stopPropagation()}
      rows={Math.min(9, Math.max(2, v.split('\n').length))}
      className="w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-ui-xs leading-snug text-ink-200 hover:border-ink-700 focus:border-nc-500 focus:bg-ink-800 focus:outline-none"
      placeholder="Um por linha"
    />
  );
}
