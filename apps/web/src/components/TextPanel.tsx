import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Captions, Check, Crosshair, Download, Loader2, Plus, Sparkles, Trash2, Type, Wand2 } from 'lucide-react';
import { anchorAt, buildCues, DEFAULT_CAPTIONS, formatTime, LETTERING_STYLES, letteringAccent, letteringFrameHtml, letteringFromText, resolveOverlay, type CaptionSettings, type LetteringSpec, type LetteringStyleId } from '@neweditor/core';
import { api, refUrl, type ImportStatus, type MotionRef } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { RangeField } from './ui.tsx';
import { CaptionList } from './CaptionList.tsx';

type Amount = 'pouco' | 'medio' | 'muito';
const SAMPLE: LetteringSpec = {
  estilo: 'auto-serifa',
  seed: 1,
  words: [
    { text: 'e', at: 0.15, line: 0 },
    { text: 'me', at: 0.3, line: 0 },
    { text: 'custou', at: 0.45, line: 0 },
    { text: '23', at: 0.75, line: 1, destaque: true },
    { text: 'reais', at: 0.95, line: 1, destaque: true },
  ],
};

/** Aba Texto: legenda automática + lettering automático (no lugar da legenda) + referências de lettering. */
export function TextPanel() {
  const [view, setView] = useState<'texto' | 'lista' | 'refs'>('texto');
  const [refs, setRefs] = useState<MotionRef[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const reload = useCallback(() => api.motionRefs().then((l) => setRefs(l.refs.filter((r) => r.uso === 'lettering'))), []);
  useEffect(() => void reload().catch(() => setRefs([])), [reload]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-ink-750 p-2">
        {(
          [
            ['texto', 'Estilo'],
            ['lista', 'Legendas'],
            ['refs', `Referências${refs ? ` · ${refs.length}` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => (setView(id), id === 'refs' && void reload())} className={`flex-1 rounded-ui-md px-2 py-1.5 text-ui-xs font-semibold transition ${view === id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {view === 'lista' ? (
          <CaptionList />
        ) : view === 'texto' ? (
          <TextView
            refs={refs ?? []}
            onPickStyle={(id) => {
              setOpen(id ?? null);
              setView('refs');
            }}
          />
        ) : (
          <LetteringRefs refs={refs} reload={reload} open={open} setOpen={setOpen} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legenda + lettering automático
// ---------------------------------------------------------------------------

function TextView({ refs, onPickStyle }: { refs: MotionRef[]; onPickStyle: (id?: string) => void }) {
  const project = useEditor((s) => s.project);
  const transcripts = useEditor((s) => s.transcripts);
  const sendOp = useEditor((s) => s.sendOp);
  const seek = useEditor((s) => s.seek);
  const select = useEditor((s) => s.select);
  const activity = useEditor((s) => s.activity);
  const [err, setErr] = useState('');
  const [amount, setAmount] = useState<Amount>('medio');
  const tl = project?.timeline;
  const caps: CaptionSettings = tl?.captions ?? DEFAULT_CAPTIONS;
  const cues = useMemo(() => (tl ? buildCues(tl, transcripts, { ...caps, enabled: true }) : []), [tl, transcripts, caps]);
  if (!project || !tl) return null;

  const setCaps = (patch: Partial<CaptionSettings>) => sendOp({ op: { type: 'set_captions', captions: { ...caps, ...patch } }, note: patch.enabled === undefined ? 'Ajustou a legenda' : patch.enabled ? 'Ligou a legenda automática' : 'Desligou a legenda' });
  const letterings = tl.overlays
    .filter((o) => o.role === 'lettering')
    .map((o) => ({ o, pos: resolveOverlay(tl, o), spec: o.source.type === 'lettering' ? o.source.lettering : o.source.type === 'text' ? letteringFromText(o.source.text) : null }))
    .sort((a, b) => (a.pos?.start ?? 0) - (b.pos?.start ?? 0));
  const busy = activity.state === 'thinking' || activity.state === 'motion';
  const ref = refs.find((r) => r.id === tl.letteringRef);
  const estilo = (ref?.estilo as LetteringStyleId) ?? 'auto-serifa';
  const sample = letterings.find((l) => l.spec)?.spec ?? SAMPLE;

  return (
    <div className="scroll-thin h-full space-y-5 overflow-y-auto p-4">
      <section className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-ui-sm font-semibold tracking-wide text-ink-300 uppercase">
          <Sparkles size={14} /> Lettering automático
        </h3>
        <p className="text-ui-xs leading-snug text-ink-400">Nas palavras-chave, a legenda vira lettering: o trecho falado em volta fica pequeno e a chave ganha o destaque, palavra por palavra. Sempre no lugar da legenda, nunca sobre o rosto.</p>

        <button onClick={() => onPickStyle(ref?.id)} className="flex w-full items-center gap-2.5 rounded-ui-md border border-ink-700 bg-ink-800/60 p-2 text-left transition hover:border-nc-500">
          <StylePreview spec={{ ...sample, estilo, accent: ref?.accent }} className="h-20 w-[45px] shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <div className="text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">Estilo do vídeo</div>
            <div className="truncate text-ui-sm font-semibold text-ink-100">{LETTERING_STYLES[estilo].label}</div>
            <div className="truncate text-ui-xs text-ink-400">{ref ? `Referência: ${ref.obra}` : 'Padrão (modelo Auto) — toque para escolher'}</div>
          </div>
          <span className="text-ui-xs text-nc-300">trocar</span>
        </button>

        <div className="flex rounded-ui-md border border-ink-700 p-0.5">
          {(
            [
              ['pouco', 'Pouco'],
              ['medio', 'Médio'],
              ['muito', 'Muito'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setAmount(id)} className={`flex-1 rounded-ui-md py-1 text-ui-xs font-semibold ${amount === id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}>
              {label}
            </button>
          ))}
        </div>

        <RangeField
          label="Posição dos letterings"
          value={Math.round((letterings.find((l) => l.spec?.y !== undefined)?.spec?.y ?? caps.position) * 100)}
          min={10}
          max={92}
          step={1}
          unit="%"
          resetTo={Math.round(caps.position * 100)}
          onCommit={(v) => {
            const y = v / 100;
            for (const { o, spec } of letterings) if (spec && o.source.type === 'lettering') sendOp({ op: { type: 'set_overlay_lettering', id: o.id, lettering: { ...spec, y } }, note: `Letterings em ${v}% do quadro` });
            if (!letterings.length) setCaps({ position: y });
          }}
          hint="Vale para todos os letterings; cada um pode ser ajustado nas propriedades"
        />
        <div className="flex gap-1.5">
          <button
            disabled={busy}
            onClick={() => {
              setErr('');
              api.letteringAuto(project.id, amount).catch((e: Error) => setErr(e.message));
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-ui-md nc-gradient px-3 py-2 text-ui-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {letterings.some((l) => l.o.by !== 'human') ? 'Refazer letterings' : 'Criar letterings'}
          </button>
          <button aria-label="Lettering no cursor"
            title="Lettering no cursor"
            onClick={() => {
              const text = window.prompt('Texto do lettering — a palavra-chave entre *asteriscos* (ex.: "e me custou *23 reais*")');
              const anchor = anchorAt(tl, useEditor.getState().playhead);
              if (!text?.trim() || !anchor) return;
              const spec = { ...letteringFromText(text.trim(), estilo), accent: ref?.accent, refId: ref?.id, refName: ref?.obra };
              sendOp({ op: { type: 'add_overlay', item: { trackId: 'V3', role: 'lettering', anchor, duration: 2.4, source: { type: 'lettering', lettering: spec } } }, note: `Lettering "${text.trim().replace(/\*/g, '')}"` });
            }}
            className="rounded-ui-md border border-ink-600 px-2.5 text-ink-200 hover:border-nc-500"
          >
            <Plus size={14} />
          </button>
        </div>
        {err && <p className="text-ui-xs text-rose-400">{err}</p>}

        <div className="space-y-1.5">
          {letterings.length === 0 && <p className="text-ui-xs text-ink-400">Nenhum lettering ainda.</p>}
          {letterings.map(({ o, pos, spec }) => (
            <div key={o.id} className="group flex items-center gap-2 rounded-ui-md border border-ink-700 bg-ink-800 px-2 py-1.5">
              <span className="w-9 shrink-0 font-mono text-ui-xs text-ink-400">{pos ? formatTime(pos.start) : 'órfão'}</span>
              <button onClick={() => pos && (seek(pos.start), select({ kind: 'overlay', id: o.id }))} className="min-w-0 flex-1 truncate text-left text-ui-sm" title={o.reason}>
                {spec?.words.map((w, i) => (
                  <span key={i} className={w.destaque ? 'font-bold text-white' : 'text-ink-400'}>
                    {w.text}{' '}
                  </span>
                ))}
              </button>
              {o.by === 'human' && <span className="text-ui-xs text-nc-300" title="Ajustado à mão: o agente não refaz">✋</span>}
              {pos && (
                <button aria-label="Ir até" onClick={() => (seek(pos.start), select({ kind: 'overlay', id: o.id }))} className="text-ink-400 hover:text-white" title="Ir até">
                  <Crosshair size={13} />
                </button>
              )}
              <button aria-label="Remover" onClick={() => sendOp({ op: { type: 'remove_overlay', id: o.id }, note: 'Removeu um lettering' })} className="text-ink-400 hover:text-rose-400" title="Remover">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview do estilo (o mesmo desenho do export, em loop)
// ---------------------------------------------------------------------------

export function StylePreview({ spec, className = '' }: { spec: LetteringSpec; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(80);
  const [t, setT] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const last = Math.max(...spec.words.map((w) => w.at), 0);
  const dur = last + 1.6;
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      setT((((performance.now() - t0) / 1000) % (dur + 0.4)) - 0.2);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dur]);
  const words = spec.words.map((w) => ({ ...w, at: w.at - spec.words[0]!.at + 0.15 }));
  return (
    <div ref={box} className={`relative overflow-hidden bg-gradient-to-b from-[#1b2230] to-[#0b0d12] ${className}`} style={{ ['--u' as string]: `${h / 100}px`, aspectRatio: '9 / 16' }}>
      <div className="ne-text-layer" dangerouslySetInnerHTML={{ __html: letteringFrameHtml({ ...spec, words }, Math.max(0, t), dur, 56.25, 0.62) }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Referências de lettering
// ---------------------------------------------------------------------------

function LetteringRefs({ refs, reload, open, setOpen }: { refs: MotionRef[] | null; reload: () => Promise<void>; open: string | null; setOpen: (id: string | null) => void }) {
  const project = useEditor((s) => s.project)!;
  const [filter, setFilter] = useState('todas');
  if (!refs) return <p className="p-4 text-ui-sm text-ink-400">Carregando…</p>;
  const current = open ? refs.find((r) => r.id === open) : undefined;
  if (current) return <RefDetail r={current} reload={reload} onBack={() => setOpen(null)} />;
  const cats = [...new Set(refs.map((r) => r.categoria))];
  const shown = refs.filter((r) => filter === 'todas' || (filter === 'usadas' ? r.usos.length > 0 : r.categoria === filter));
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!refs.length ? (
        <ImportModels onDone={reload} />
      ) : (
        <div className="scroll-thin flex gap-1 overflow-x-auto px-3 pt-2.5 pb-1">
          {['todas', 'usadas', ...cats].map((c) => (
            <button key={c} onClick={() => setFilter(c)} className={`shrink-0 rounded-full px-2 py-0.5 text-ui-xs ${filter === c ? 'bg-nc-500 text-white' : 'bg-ink-800 text-ink-400 hover:text-ink-200'}`}>
              {c === 'todas' ? 'Todas' : c === 'usadas' ? 'Já usadas' : c}
            </button>
          ))}
        </div>
      )}
      <div className="scroll-thin grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3">
        {shown.map((r) => (
          <RefCard key={r.id} r={r} active={project.timeline.letteringRef === r.id} onClick={() => setOpen(r.id)} />
        ))}
      </div>
    </div>
  );
}

function RefCard({ r, active, onClick }: { r: MotionRef; active: boolean; onClick: () => void }) {
  const vid = useRef<HTMLVideoElement>(null);
  const estilo = r.estilo as LetteringStyleId | undefined;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => void vid.current?.play().catch(() => undefined)}
      onMouseLeave={() => {
        const v = vid.current;
        if (v) (v.pause(), (v.currentTime = 0));
      }}
      className={`group overflow-hidden rounded-ui-md border bg-ink-800 text-left transition hover:border-nc-500 ${active ? 'border-nc-500' : 'border-ink-700'}`}
      title={r.obra}
    >
      <div className="relative aspect-video bg-black">
        {r.preview ? (
          <video ref={vid} src={refUrl(r.id, r.preview)} poster={r.capa ? refUrl(r.id, r.capa) : undefined} muted loop playsInline preload="none" className="absolute inset-0 h-full w-full object-cover" />
        ) : r.capa ? (
          <img src={refUrl(r.id, r.capa)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        {active && <span className="absolute top-1 left-1 rounded bg-nc-500 px-1 text-ui-xs font-semibold text-white">neste vídeo</span>}
        {r.accent && <span className="absolute right-1 bottom-1 h-2.5 w-2.5 rounded-full ring-1 ring-black/40" style={{ background: r.accent }} />}
      </div>
      <div className="px-1.5 py-1.5">
        <div className="truncate text-ui-xs font-medium text-ink-100">{r.obra.replace(/^.*? · /, '')}</div>
        <div className="truncate text-ui-xs text-ink-400">{estilo && LETTERING_STYLES[estilo] ? LETTERING_STYLES[estilo].label : r.categoria}</div>
      </div>
    </button>
  );
}

function ImportModels({ onDone }: { onDone: () => Promise<void> }) {
  const [path, setPath] = useState('');
  const [st, setSt] = useState<(ImportStatus & { origem?: string }) | null>(null);
  useEffect(() => {
    api.importLetteringStatus().then((s) => (setSt(s), setPath(s.origem)));
  }, []);
  useEffect(() => {
    if (!st?.running) return;
    const id = window.setInterval(async () => {
      const s = await api.importLetteringStatus();
      setSt(s);
      if (!s.running) (window.clearInterval(id), void onDone());
    }, 1200);
    return () => window.clearInterval(id);
  }, [st?.running, onDone]);
  return (
    <div className="m-3 space-y-2 rounded-ui-md border border-dashed border-ink-600 p-4 text-center">
      <Type size={18} className="mx-auto text-nc-300" />
      <p className="text-ui-xs leading-snug text-ink-300">Traga os modelos de lettering do Legendas Master (Premiere) como referência: cada modelo vira um card com o vídeo dele e o estilo do NewEditor que o reproduz.</p>
      <input value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className="input w-full py-1 font-mono text-ui-xs" />
      <button
        disabled={st?.running}
        onClick={async () => setSt(await api.importLettering(path))}
        className="inline-flex items-center gap-1.5 rounded-ui-md nc-gradient px-3 py-1.5 text-ui-xs font-semibold text-white disabled:opacity-50"
      >
        {st?.running ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {st?.running ? `Importando ${st.done}/${st.total || '…'}` : 'Importar modelos'}
      </button>
      {st?.error && <p className="text-ui-xs text-rose-400">{st.error}</p>}
    </div>
  );
}

function RefDetail({ r, reload, onBack }: { r: MotionRef; reload: () => Promise<void>; onBack: () => void }) {
  const project = useEditor((s) => s.project)!;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const active = project.timeline.letteringRef === r.id;
  const estilo = (r.estilo as LetteringStyleId) ?? 'auto-serifa';
  const sampleFromVideo = project.timeline.overlays.find((o) => o.source.type === 'lettering');
  const sample = sampleFromVideo?.source.type === 'lettering' ? sampleFromVideo.source.lettering : SAMPLE;
  const patch = async (p: Parameters<typeof api.patchRef>[1]) => {
    try {
      await api.patchRef(r.id, p);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="scroll-thin h-full space-y-3 overflow-y-auto p-3">
      <button onClick={onBack} className="flex items-center gap-1 text-ui-xs text-ink-400 hover:text-white">
        <ArrowLeft size={13} /> Referências
      </button>
      <div>
        <h3 className="text-ui-md leading-tight font-semibold text-white">{r.obra}</h3>
        <p className="mt-0.5 text-ui-xs text-ink-400">{r.categoria} · Legendas Master</p>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <figure className="space-y-1">
          <div className="overflow-hidden rounded-ui-md bg-black">{r.preview ? <video src={refUrl(r.id, r.preview)} muted loop autoPlay playsInline className="aspect-video w-full object-cover" /> : r.capa ? <img src={refUrl(r.id, r.capa)} alt="" className="aspect-video w-full object-cover" /> : null}</div>
          <figcaption className="text-ui-xs text-ink-400">Original</figcaption>
        </figure>
        <figure className="space-y-1">
          <StylePreview spec={{ ...sample, estilo, accent: r.accent }} className="h-[118px] rounded-ui-md" />
          <figcaption className="text-ui-xs text-ink-400">No NewEditor</figcaption>
        </figure>
      </div>

      <label className="block space-y-1">
        <span className="text-ui-xs font-medium text-ink-400">Estilo que reproduz esta referência</span>
        <select value={estilo} onChange={(e) => void patch({ estilo: e.target.value })} className="input py-1.5 text-ui-sm">
          {Object.entries(LETTERING_STYLES).map(([id, s]) => (
            <option key={id} value={id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="block text-ui-xs leading-snug text-ink-400">{LETTERING_STYLES[estilo].desc}</span>
      </label>
      <label className="flex items-center justify-between text-ui-xs text-ink-300">
        Cor de acento
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-ui-xs text-ink-400">{letteringAccent({ estilo, words: [], seed: 0, accent: r.accent })}</span>
          <input type="color" value={r.accent ?? LETTERING_STYLES[estilo].accent ?? '#ffffff'} onChange={(e) => void patch({ accent: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-ink-600 bg-transparent" />
        </span>
      </label>
      {!!r.sfx?.length && <p className="text-ui-xs text-ink-400">SFX do modelo original: {r.sfx.join(' · ')}</p>}

      <button
        disabled={busy || active}
        onClick={async () => {
          setBusy(true);
          setErr('');
          try {
            await api.letteringRef(project.id, r.id);
            await reload();
          } catch (e) {
            setErr((e as Error).message);
          }
          setBusy(false);
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-ui-md nc-gradient py-2 text-ui-sm font-semibold text-white disabled:opacity-50"
      >
        {active ? <Check size={13} /> : <Sparkles size={13} />} {active ? 'Estilo deste vídeo' : 'Usar neste vídeo (veste os letterings)'}
      </button>
      {err && <p className="text-ui-xs text-rose-400">{err}</p>}
      <p className="text-ui-xs text-ink-400">Arquivo: data/referencias/{r.id}/{r.file}</p>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-nc-500' : 'bg-ink-600'}`} role="switch" aria-checked={on}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}
