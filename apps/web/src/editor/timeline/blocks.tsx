import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftToLine, ArrowRightToLine, Eye, EyeOff, Headphones, Lock, MessageSquarePlus, Scissors, SkipBack, Trash2, Unlock, Volume2, VolumeX, Zap } from 'lucide-react';
import { anchorAt, clipSpeed, clipStarts, cutEndAfter, formatTime, letteringCues, MOTION_TEMPLATES, motionCues, overlaySourceTime, resolveOverlay, soloMuted, timelineDuration, trackFlag, TRACK_HEIGHT_MAX, TRACK_HEIGHT_MIN, type Clip, type MediaAsset, type OverlayItem, type OverlayRole, type Track, DEFAULT_CAPTIONS } from '@neweditor/core';
import { api, mediaUrl } from '../../lib/api.ts';
import { CaptionInput, captionActions, cueText, useCaptionCues } from '../../lib/captions.tsx';
import { useEditor, type Word } from '../../lib/store.ts';
import { IconButton } from '../../components/ui.tsx';
import { ASSET_MIME, CINEPRO_MIME, openRightTab, ROLE_STYLE } from '../shared.ts';
import { openMenu } from './ContextMenu.tsx';

const SNAP_PX = 8;
const COVER_LABEL = { lettering: 'lettering', motion: 'motion', broll: 'B-roll' } as const;

// ---------------------------------------------------------------------------
// Cabeçalho de trilha (CapCut: rótulo curto + olho / som / cadeado)
// ---------------------------------------------------------------------------

/** Ícones do cabeçalho: discretos até o mouse (ou o foco do teclado) chegar na trilha; ligados ficam acesos. */
const headerBtn = (on?: boolean) => `!p-0.5 ${on ? '' : 'opacity-40 group-hover:opacity-100 focus-visible:opacity-100'}`;

/**
 * Alça de altura na borda de baixo do cabeçalho (BL-0160): arrastar muda a altura da trilha ao vivo e grava no
 * projeto ao soltar (`set_track_state` com `height`); duplo clique volta ao padrão; setas ↑/↓ no teclado.
 */
export function HeightHandle({ id, h, onLive }: { id: string; h: number; onLive: (id: string, h: number | null) => void }) {
  const sendOp = useEditor((s) => s.sendOp);
  const clamp = (v: number) => Math.round(Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, v)));
  const commit = (v: number) => sendOp({ op: { type: 'set_track_state', trackId: id, patch: { height: v } }, note: v ? `Altura de ${id}: ${v} px` : `Altura de ${id} de volta ao padrão` });
  const down = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    let v = h;
    const move = (ev: MouseEvent) => {
      v = clamp(h + ev.clientY - y0);
      onLive(id, v);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (v !== h) commit(v);
      else onLive(id, null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Altura da trilha ${id}`}
      aria-valuenow={h}
      aria-valuemin={TRACK_HEIGHT_MIN}
      aria-valuemax={TRACK_HEIGHT_MAX}
      tabIndex={0}
      title={`Arraste para mudar a altura de ${id} · duplo clique volta ao padrão`}
      onMouseDown={down}
      onDoubleClick={() => (onLive(id, null), commit(0))}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        e.stopPropagation();
        const v = clamp(h + (e.key === 'ArrowDown' ? 4 : -4));
        onLive(id, v);
        commit(v);
      }}
      className="absolute inset-x-0 -bottom-[3px] z-[var(--z-track)] h-[6px] cursor-row-resize hover:bg-nc-400/40 focus-visible:bg-nc-400/40"
    />
  );
}

export function TrackHeader({ id, name, h, strong, kind, onHeight }: { id: string; name: string; h: number; strong?: boolean; kind: 'video' | 'audio' | 'main'; onHeight: (id: string, h: number | null) => void }) {
  const state = useEditor((s) => s.project?.timeline.trackState?.[id]);
  const soloOff = useEditor((s) => !!s.project && soloMuted(s.project.timeline, id));
  const sendOp = useEditor((s) => s.sendOp);
  const set = (patch: { hidden?: boolean; muted?: boolean; locked?: boolean; solo?: boolean }, note: string) => sendOp({ op: { type: 'set_track_state', trackId: id, patch }, note });
  const compact = h < 24; // trilha muito baixa: só o rótulo e os botões
  return (
    <div className={`group relative flex items-center gap-1 border-b border-ink-750/60 pr-1 pl-1.5 ${state?.hidden || state?.muted || soloOff ? 'opacity-60' : ''}`} style={{ height: h }}>
      <span className={`w-6 shrink-0 rounded-ui-sm text-center font-mono text-ui-xs font-semibold leading-4 ${strong ? 'bg-nc-500/30 text-nc-300' : 'bg-ink-750 text-ink-300'}`}>{id}</span>
      {!compact && (
        <span className="min-w-0 flex-1 truncate text-ui-xs text-ink-400" title={name}>
          {name}
        </span>
      )}
      <span className="ml-auto flex items-center">
        {kind !== 'audio' && (
          <IconButton label={state?.hidden ? `Mostrar ${id}` : `Ocultar ${id} (sai do vídeo e do export)`} className={headerBtn(state?.hidden)} active={state?.hidden} onClick={() => set({ hidden: !state?.hidden }, state?.hidden ? `Mostrou ${id}` : `Ocultou ${id}`)}>
            {state?.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </IconButton>
        )}
        {kind === 'audio' && (
          <IconButton label={state?.muted ? `Ligar o som de ${id}` : soloOff ? `${id} está muda pelo solo de outra trilha (clique para mudo fixo)` : `Mudo em ${id} (vale no export)`} className={headerBtn(state?.muted)} active={state?.muted} onClick={() => set({ muted: !state?.muted }, state?.muted ? `Som de ${id} de volta` : `Mudo em ${id}`)}>
            {state?.muted || soloOff ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </IconButton>
        )}
        {kind === 'audio' && (
          <IconButton label={state?.solo ? `Tirar o solo de ${id}` : `Solo em ${id} (só as trilhas em solo soam, no preview e no export)`} className={`${headerBtn(state?.solo)} ${state?.solo ? '!bg-warn/20 !text-warn' : ''}`} active={state?.solo} onClick={() => set({ solo: !state?.solo }, state?.solo ? `Tirou o solo de ${id}` : `Solo em ${id}`)}>
            <Headphones size={12} />
          </IconButton>
        )}
        <IconButton label={state?.locked ? `Destravar ${id}` : `Travar ${id} (protege da edição)`} className={headerBtn(state?.locked)} active={state?.locked} onClick={() => set({ locked: !state?.locked }, state?.locked ? `Destravou ${id}` : `Travou ${id}`)}>
          {state?.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </IconButton>
      </span>
      <HeightHandle id={id} h={h} onLive={onHeight} />
    </div>
  );
}

export function CaptionHeader({ h, onHeight }: { h: number; onHeight: (id: string, h: number | null) => void }) {
  const caps = useEditor((s) => s.project?.timeline.captions);
  const sendOp = useEditor((s) => s.sendOp);
  const on = !!caps?.enabled;
  return (
    <div className="group relative flex items-center gap-1 border-b border-ink-750/60 pr-1 pl-1.5" style={{ height: h }}>
      <span className="w-6 shrink-0 rounded-ui-sm bg-teal-500/20 text-center font-mono text-ui-xs font-semibold leading-4 text-teal-300">LG</span>
      <span className="min-w-0 flex-1 truncate text-ui-xs text-ink-400">Legenda</span>
      <IconButton label={on ? 'Legenda ligada (clique para esconder do vídeo)' : 'Legenda desligada (clique para ligar)'} className="!p-0.5" active={!on} onClick={() => sendOp({ op: { type: 'set_captions', captions: { ...(caps ?? DEFAULT_CAPTIONS), enabled: !on } }, note: on ? 'Desligou a legenda' : 'Ligou a legenda automática' })}>
        {on ? <Eye size={12} /> : <EyeOff size={12} />}
      </IconButton>
      <HeightHandle id="LG" h={h} onLive={onHeight} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// LG — uma legenda por bloco, no tempo da fala
// ---------------------------------------------------------------------------

export function CaptionLane({ pps, pad, h, selectedKey }: { pps: number; pad: number; h: number; selectedKey?: string }) {
  const cues = useCaptionCues();
  const enabled = useEditor((s) => !!s.project?.timeline.captions?.enabled);
  const select = useEditor((s) => s.select);
  const seek = useEditor((s) => s.seek);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div data-lane="LG" className={`relative border-b border-ink-750/60 ${enabled ? '' : 'opacity-45'}`} style={{ height: h, marginLeft: pad }} title={enabled ? undefined : 'Legenda desligada — ligue no olho do cabeçalho'}>
      {cues.map((c) => {
        const sel = c.key === selectedKey;
        const isEditing = editing === c.key;
        return (
          <div
            key={c.key}
            onMouseDown={(e) => {
              e.stopPropagation();
              select({ kind: 'caption', id: c.key! });
              seek(c.start + 0.01);
            }}
            onDoubleClick={() => setEditing(c.key!)}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: 'Editar o texto', onClick: () => setEditing(c.key!) },
                { label: c.forced ? 'Voltar a esconder sob a camada' : 'Mostrar mesmo sob a camada', disabled: !c.coveredBy, onClick: () => captionActions.toggleForce(c) },
                { label: 'Voltar ao automático', disabled: !(c.edited || c.hidden), onClick: () => captionActions.reset(c) },
                'sep',
                { label: c.hidden ? 'Restaurar legenda' : 'Apagar legenda', shortcut: 'Delete', danger: !c.hidden, icon: <Trash2 size={13} />, onClick: () => captionActions.toggleHidden(c) },
              ])
            }
            className={`group/cue absolute top-1 bottom-1 rounded-ui-sm border ${isEditing ? 'z-50' : sel ? 'z-10 ring-2 ring-white/70' : ''} ${c.hidden ? 'border-dashed border-ink-500 bg-transparent opacity-50' : c.coveredBy && !c.forced ? 'border-dashed border-teal-400/40 bg-teal-500/5 opacity-40 hover:opacity-70' : 'border-teal-400/70 bg-teal-500/25 hover:bg-teal-500/35'}`}
            style={{ left: c.start * pps, width: Math.max(3, (c.end - c.start) * pps - 1) }}
            title={`${cueText(c)}${c.edited ? `\n(editada — automático: "${c.original}")` : ''}${c.hidden ? '\n(apagada — selecione e restaure)' : ''}${c.coveredBy ? (c.forced ? `\n(mostrada mesmo com ${COVER_LABEL[c.coveredBy]} em cima)` : `\n(oculta: há ${COVER_LABEL[c.coveredBy]} em cima — clique no olho para mostrar)`) : ''}\nDuplo clique edita · Enter no meio divide · ⌫ no começo junta com a anterior`}
          >
            {c.coveredBy && !isEditing && (c.end - c.start) * pps > 26 && (
              <button
                aria-label={c.forced ? 'Voltar a esconder sob a camada' : 'Mostrar mesmo sob a camada'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => (e.stopPropagation(), captionActions.toggleForce(c))}
                className={`absolute top-0.5 right-0.5 z-10 rounded p-px ${c.forced ? 'text-teal-200' : 'text-ink-400 opacity-0 group-hover/cue:opacity-100 focus-visible:opacity-100'} hover:text-white`}
              >
                {c.forced ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
            )}
            {isEditing ? (
              <CaptionInput cue={c} cues={cues} autoFocus onDone={() => setEditing(null)} className="absolute top-0 left-0 h-full min-w-[240px] rounded-ui-sm border border-teal-300 bg-ink-900 px-1.5 text-ui-xs text-white shadow-ui-2 outline-none" />
            ) : (
              <span className={`block truncate px-1 text-ui-xs leading-[18px] ${c.hidden ? 'text-ink-400 line-through' : 'text-teal-50'}`}>
                {c.edited && <span className="mr-0.5 text-amber-300">✎</span>}
                {cueText(c)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// V1 — clipe da fala (filmstrip, aparar, badges)
// ---------------------------------------------------------------------------

/** Pontos de ímã para o trim: começo e fim de palavra. */
function snapTargets(words: Word[] | undefined, edge: 'in' | 'out'): number[] {
  if (!words) return [];
  return words.map((w) => (edge === 'in' ? w.start : w.end));
}

/**
 * Filmstrip (BL-0160): miniaturas do arquivo lado a lado dentro do bloco, na altura da trilha. `srcAt(local)` diz
 * que instante da fonte aparece `local` s depois do começo do bloco (corte, velocidade, congelamento).
 */
export function Filmstrip({ asset, width, h, pps, srcAt }: { asset: MediaAsset; width: number; h: number; pps: number; srcAt: (local: number) => number }) {
  const projectId = useEditor((s) => s.project?.id);
  const th = asset.thumbs;
  if (!th || !projectId || h < 8 || width < 2) return null;
  const tw = (th.w * h) / th.h;
  const rows = Math.ceil(th.count / th.cols);
  const n = Math.min(300, Math.ceil(width / tw));
  const url = `url(${mediaUrl(projectId, th.file)})`;
  const tiles: React.ReactNode[] = [];
  for (let k = 0; k < n; k++) {
    const f = Math.max(0, Math.min(th.count - 1, Math.floor(srcAt(((k + 0.5) * tw) / pps) / th.interval)));
    tiles.push(
      <div
        key={k}
        className="absolute top-0 h-full"
        style={{ left: k * tw, width: tw, backgroundImage: url, backgroundSize: `${th.cols * tw}px ${rows * h}px`, backgroundPosition: `${-(f % th.cols) * tw}px ${-Math.floor(f / th.cols) * h}px` }}
      />,
    );
  }
  return <div className="pointer-events-none absolute inset-0 overflow-hidden">{tiles}</div>;
}

export function ClipBlock({ clip, index, x, w, h, pps, selected, asset }: { clip: Clip; index: number; x: number; w: number; h: number; pps: number; selected: boolean; asset?: MediaAsset }) {
  const words = useEditor((s) => (asset ? s.transcripts[asset.id] : undefined));
  const select = useEditor((s) => s.select);
  const sendOp = useEditor((s) => s.sendOp);
  const inGroup = useEditor((s) => s.multiClips.includes(clip.id));
  const [drag, setDrag] = useState<{ edge: 'in' | 'out'; value: number } | null>(null);
  const locked = useEditor((s) => !!s.project && trackFlag(s.project.timeline, 'V1', 'locked'));
  const label = useMemo(() => words?.filter((wd) => wd.end > clip.in && wd.start < clip.out).map((wd) => wd.w).join(' ') ?? '', [words, clip.in, clip.out]);
  const sel = selected || inGroup;

  const shownIn = drag?.edge === 'in' ? drag.value : clip.in;
  const shownOut = drag?.edge === 'out' ? drag.value : clip.out;
  const dx = (shownIn - clip.in) * pps;
  const shownW = Math.max(2, (shownOut - shownIn) * pps);

  const startTrim = (edge: 'in' | 'out') => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    select({ kind: 'clip', id: clip.id });
    if (locked) return;
    const x0 = e.clientX;
    const base = edge === 'in' ? clip.in : clip.out;
    const targets = useEditor.getState().magnet ? snapTargets(words, edge) : [];
    const max = asset?.duration ?? Infinity;
    let value = base;
    const move = (ev: MouseEvent) => {
      let v = base + (ev.clientX - x0) / pps;
      const near = targets.reduce((best, t) => (Math.abs(t - v) < Math.abs(best - v) ? t : best), Infinity);
      if (Math.abs(near - v) * pps < SNAP_PX) v = near;
      v = edge === 'in' ? Math.max(0, Math.min(v, clip.out - 0.1)) : Math.min(max, Math.max(v, clip.in + 0.1));
      value = v;
      setDrag({ edge, value: v });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      if (Math.abs(value - base) > 0.005) sendOp({ op: { type: 'trim', clipId: clip.id, [edge]: value }, note: `Aparou o ${edge === 'in' ? 'início' : 'fim'} de um clipe` });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const th = asset?.thumbs;
  const speed = clipSpeed(clip);

  const timeOf = (clientX: number, el: HTMLElement) => {
    const st = useEditor.getState();
    const tl = st.project?.timeline;
    return tl ? (clipStarts(tl)[index] ?? 0) + (clientX - el.getBoundingClientRect().left) / pps : st.playhead;
  };
  const menu = (e: React.MouseEvent) => {
    const st = useEditor.getState();
    const at = timeOf(e.clientX, e.currentTarget as HTMLElement);
    if (!selected) select({ kind: 'clip', id: clip.id });
    openMenu(e, [
      { label: 'Dividir aqui', shortcut: '⌘B', icon: <Scissors size={13} />, disabled: locked, onClick: () => st.sendOp({ op: { type: 'split', time: at }, note: `Dividiu em ${formatTime(at)}` }) },
      { label: 'Aparar o começo até aqui', shortcut: 'Q', icon: <ArrowLeftToLine size={13} />, disabled: locked, onClick: () => st.sendOp({ op: { type: 'trim', clipId: clip.id, in: clip.in + (at - (clipStarts(st.project!.timeline)[index] ?? 0)) }, note: 'Aparou o começo (menu)' }) },
      { label: 'Aparar o fim a partir daqui', shortcut: 'W', icon: <ArrowRightToLine size={13} />, disabled: locked, onClick: () => st.sendOp({ op: { type: 'trim', clipId: clip.id, out: clip.in + (at - (clipStarts(st.project!.timeline)[index] ?? 0)) }, note: 'Aparou o fim (menu)' }) },
      { label: clip.flash ? 'Tirar o flash da entrada' : 'Flash na entrada', icon: <Zap size={13} />, onClick: () => st.sendOp({ op: { type: 'set_flash', clipId: clip.id, on: !clip.flash }, note: clip.flash ? 'Tirou o flash' : 'Flash na entrada' }) },
      'sep',
      {
        label: 'Pedir ao agente aqui…',
        icon: <MessageSquarePlus size={13} />,
        onClick: () => {
          st.seek(at);
          st.askAgent(`Em ${formatTime(at, true)} (${label.slice(0, 50) || 'este trecho'}): `);
          openRightTab('agente');
        },
      },
      'sep',
      { label: 'Remover clipe', shortcut: 'Delete', icon: <Trash2 size={13} />, danger: true, disabled: locked, onClick: () => (st.sendOp({ op: { type: 'delete_clip', clipId: clip.id, reason: 'removido pelo editor' }, note: 'Removeu um clipe' }), select(null)) },
    ]);
  };

  return (
    <div
      data-clip-id={clip.id}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.shiftKey) return useEditor.getState().toggleMultiClip(clip.id);
        if (!selected) select({ kind: 'clip', id: clip.id });
      }}
      onContextMenu={menu}
      className={`group absolute top-px bottom-px overflow-hidden rounded-ui-sm border ${sel ? 'z-10 border-white ring-2 ring-white/40' : 'border-nc-500/60 hover:border-nc-300'} ${th ? 'bg-ink-800' : 'bg-nc-600/25'}`}
      style={{ left: x + dx, width: shownW - 1 }}
      title={label}
    >
      {asset && <Filmstrip asset={asset} width={shownW} h={h - 6} pps={pps} srcAt={(local) => Math.min(shownOut, shownIn + local * speed)} />}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 to-transparent px-1.5 pt-0.5 pb-2">{shownW > 44 && <div className="truncate text-ui-xs font-medium text-white/90">{label || asset?.name}</div>}</div>
      <div className="absolute right-1 bottom-0.5 flex gap-0.5">
        {clip.speed && Math.abs(clip.speed - 1) > 0.01 && <span className="rounded bg-black/70 px-1 text-ui-xs font-semibold text-white">{clip.speed}×</span>}
        {clip.freeze ? <span className="rounded bg-black/70 px-1 text-ui-xs text-white">❄ {clip.freeze.toFixed(1)}s</span> : null}
        {clip.flash && <span className="rounded bg-amber-300/90 px-1 text-ui-xs font-bold text-ink-950">⚡</span>}
        {clip.zoom && clip.zoom > 1 && (
          <span className="rounded bg-cyan-nc/90 px-1 text-ui-xs font-bold text-ink-950">
            {clip.zoom}×{clip.zoomTo ? `→${clip.zoomTo}×` : ''}
          </span>
        )}
      </div>
      {drag && <span className="absolute bottom-0.5 left-1 rounded bg-black/80 px-1 font-mono text-ui-xs text-white">{formatTime(drag.value, true)}</span>}
      {/* Alças de aparar (CapCut: aparecem no clipe selecionado ou sob o mouse) */}
      <div className={`absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize rounded-l-[5px] ${sel ? 'bg-white/70' : 'bg-white/0 group-hover:bg-white/35'}`} onMouseDown={startTrim('in')} />
      <div className={`absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize rounded-r-[5px] ${sel ? 'bg-white/70' : 'bg-white/0 group-hover:bg-white/35'}`} onMouseDown={startTrim('out')} />
    </div>
  );
}

export function WaveBlock({ clip, x, w, h }: { clip: Clip; x: number; w: number; h: number }) {
  const env = useEditor((s) => s.envelopes[clip.assetId]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cw = Math.max(1, Math.min(16000, Math.floor(w)));
  const H = Math.max(4, h - 4);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !env) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = cw * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(143,176,255,0.95)');
    grad.addColorStop(1, 'rgba(0,180,255,0.6)');
    ctx.fillStyle = grad;
    const dur = clip.out - clip.in;
    const mid = H / 2;
    for (let px = 0; px < cw; px++) {
      const a = Math.floor((clip.in + (px / cw) * dur) * 100);
      const b = Math.max(a + 1, Math.floor((clip.in + ((px + 1) / cw) * dur) * 100));
      let mx = -120;
      for (let f = a; f < b && f < env.length; f++) mx = Math.max(mx, env[f]!);
      const h = Math.max(0.5, Math.min(1, (mx + 60) / 52) * (mid - 1));
      ctx.fillRect(px, mid - h, 0.9, h * 2);
    }
  }, [env, cw, H, clip.in, clip.out]);
  return (
    <div className="absolute top-0.5 bottom-0.5 overflow-hidden rounded-ui-sm border border-nc-600/40 bg-nc-600/10" style={{ left: x, width: Math.max(2, w - 1) }}>
      <canvas ref={canvas} style={{ width: cw, height: H }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// V2 / V3 / A2 / A3 — camadas (overlays) presas à fala
// ---------------------------------------------------------------------------

/** Que papel um asset solto nesta trilha assume (null = não cabe aqui). */
function roleForDrop(track: Track, a: MediaAsset): OverlayRole | null {
  if (track.id === 'V3') return a.role === 'motion' || a.alpha ? 'motion' : null;
  if (track.kind === 'video') return a.kind !== 'audio' && a.role !== 'fala' ? 'broll' : null;
  if (a.kind === 'audio' || a.hasAudio) return track.roles.includes('music') ? 'music' : 'sfx';
  return null;
}

export function OverlayTrack(props: { track?: Track; h: number; items: OverlayItem[]; pps: number; pad: number; timeAt: (x: number) => number; selectedId?: string; bad: Set<string>; assets: Map<string, MediaAsset> }) {
  const { track, h, items, pps, pad, timeAt, selectedId, bad, assets } = props;
  const project = useEditor((s) => s.project);
  const sendOp = useEditor((s) => s.sendOp);
  const [over, setOver] = useState<'ok' | 'nao' | null>(null);
  if (!track || !project) return <div style={{ height: h }} />;
  const locked = trackFlag(project.timeline, track.id, 'locked');
  const off = trackFlag(project.timeline, track.id, 'hidden') || trackFlag(project.timeline, track.id, 'muted');

  const dragged = (e: React.DragEvent) => assets.get(e.dataTransfer.getData(ASSET_MIME));
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    // Item do CinePRO: o servidor importa e põe na trilha certa (SFX A2, trilha A3, alfa V3, resto V2).
    const cine = e.dataTransfer.getData(CINEPRO_MIME);
    if (cine) {
      void api.cineproUsar(project.id, cine, timeAt(e.clientX)).catch(() => undefined);
      return;
    }
    const a = dragged(e);
    if (!a) return;
    const role = roleForDrop(track, a);
    if (!role) return;
    const tl = project.timeline;
    const t = timeAt(e.clientX);
    const anchor = anchorAt(tl, t);
    if (!anchor) return;
    const remaining = timelineDuration(tl) - t;
    const toCut = cutEndAfter(tl, t) - t;
    const duration = Math.max(0.5, Math.min(a.duration || 4, role === 'broll' ? Math.max(1, toCut) : role === 'music' ? remaining : a.duration || 1, remaining));
    sendOp({ op: { type: 'add_overlay', item: { trackId: track.id, role, anchor, duration, source: { type: 'media', assetId: a.id, in: 0 } } }, note: `${ROLE_STYLE[role].label}: ${a.name} em ${formatTime(t)}` });
  };

  return (
    <div
      data-lane={track.id}
      className={`relative border-b border-ink-750/50 transition-colors ${over === 'ok' ? 'bg-nc-500/15' : over === 'nao' ? 'bg-rose-500/10' : ''} ${off ? 'hatch opacity-40' : ''}`}
      style={{ height: h, marginLeft: pad }}
      onDragOver={(e) => {
        if (locked || !(e.dataTransfer.types.includes(ASSET_MIME) || e.dataTransfer.types.includes(CINEPRO_MIME))) return;
        e.preventDefault();
        // O tipo do asset não é legível no dragover: mostra "pode" e decide no drop.
        setOver('ok');
      }}
      onDragLeave={() => setOver(null)}
      onDrop={onDrop}
    >
      {items.map((o) => (
        <OverlayBlock key={o.id} item={o} h={h} pps={pps} timeAt={timeAt} selected={o.id === selectedId} bad={bad.has(o.id)} locked={locked} asset={o.source.type === 'media' ? assets.get(o.source.assetId) : undefined} />
      ))}
    </div>
  );
}

export function OverlayBlock({ item, h, pps, timeAt, selected: primary, bad, asset, locked }: { item: OverlayItem; h: number; pps: number; timeAt: (x: number) => number; selected: boolean; bad: boolean; asset?: MediaAsset; locked: boolean }) {
  const timeline = useEditor((s) => s.project?.timeline);
  const select = useEditor((s) => s.select);
  const inMulti = useEditor((s) => s.multi.includes(item.id));
  const selected = primary || inMulti;
  const sendOp = useEditor((s) => s.sendOp);
  const [drag, setDrag] = useState<{ start?: number; end?: number } | null>(null);
  if (!timeline) return null;
  const pos = resolveOverlay(timeline, item);
  if (!pos) return null; // órfão: aparece só nos alertas
  const start = drag?.start ?? pos.start;
  const end = drag?.end ?? pos.end;
  const st = ROLE_STYLE[item.role];
  const text =
    item.source.type === 'text'
      ? item.source.text
      : item.source.type === 'media'
        ? (asset?.name ?? 'mídia')
        : item.source.type === 'motion'
          ? `${MOTION_TEMPLATES[item.source.motion.template].label} · ${item.source.motion.texts.slice(0, 5).join(' ')}`
          : item.source.type === 'lettering'
            ? item.source.lettering.words.map((w) => (w.destaque ? w.text.toLocaleUpperCase('pt-BR') : w.text)).join(' ')
            : item.source.compositionId;

  const begin = (mode: 'move' | 'right' | 'left') => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey) return useEditor.getState().toggleMulti(item.id);
    if (!selected) select({ kind: 'overlay', id: item.id });
    if (locked) return;
    const t0 = timeAt(e.clientX);
    let s = pos.start;
    let en = pos.end;
    let moved = false;
    // Ímã: cursor, emendas da fala, início/fim dos outros overlays.
    const st0 = useEditor.getState();
    const targets = st0.magnet
      ? [
          st0.playhead,
          ...clipStarts(timeline),
          timelineDuration(timeline),
          ...timeline.overlays
            .filter((o) => o.id !== item.id)
            .flatMap((o) => {
              const p = resolveOverlay(timeline, o);
              return p ? [p.start, p.end] : [];
            }),
        ]
      : [];
    const snap = (v: number) => {
      const near = targets.reduce((best, t) => (Math.abs(t - v) < Math.abs(best - v) ? t : best), Infinity);
      if (Math.abs(near - v) * pps < SNAP_PX) {
        useEditor.getState().setGuide(near);
        return near;
      }
      useEditor.getState().setGuide(null);
      return v;
    };
    const move = (ev: MouseEvent) => {
      const dt = timeAt(ev.clientX) - t0;
      if (Math.abs(dt) * pps > 2) moved = true;
      if (mode === 'move') {
        const raw = Math.max(0, pos.start + dt);
        const a = snap(raw);
        if (a !== raw) s = a;
        else {
          const b = snap(raw + item.duration);
          s = b !== raw + item.duration ? b - item.duration : raw;
        }
        en = s + item.duration;
      } else if (mode === 'right') en = Math.max(pos.start + 0.3, snap(pos.end + dt));
      else s = Math.max(0, Math.min(pos.end - 0.3, snap(pos.start + dt)));
      setDrag({ start: s, end: en });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      useEditor.getState().setGuide(null);
      setDrag(null);
      if (!moved) return;
      if (mode === 'move' && Math.abs(s - pos.start) > 0.01) {
        const anchor = anchorAt(timeline, s);
        if (anchor) sendOp({ op: { type: 'move_overlay', id: item.id, anchor }, note: `Moveu ${st.label} para ${formatTime(s)}` });
      }
      if (mode === 'right' && Math.abs(en - pos.end) > 0.01) sendOp({ op: { type: 'trim_overlay', id: item.id, duration: en - pos.start }, note: `${st.label} com ${(en - pos.start).toFixed(1)}s` });
      if (mode === 'left' && Math.abs(s - pos.start) > 0.01) {
        // Aparar pela esquerda = mover a âncora e encurtar (a mídia continua no mesmo ponto da fonte).
        const anchor = anchorAt(timeline, s);
        if (!anchor) return;
        const sourceIn = item.source.type === 'media' ? Math.max(0, item.source.in + (s - pos.start)) : undefined;
        sendOp({ op: { type: 'move_overlay', id: item.id, anchor }, note: `Aparou o início de ${st.label}` });
        sendOp({ op: { type: 'trim_overlay', id: item.id, duration: pos.end - s, sourceIn }, note: `${st.label} com ${(pos.end - s).toFixed(1)}s` });
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const menu = (e: React.MouseEvent) => {
    const s0 = useEditor.getState();
    if (!selected) select({ kind: 'overlay', id: item.id });
    const cutEnd = cutEndAfter(timeline, pos.end - 0.05);
    openMenu(e, [
      { label: 'Ir para o início', icon: <SkipBack size={13} />, onClick: () => s0.seek(pos.start) },
      { label: `Esticar até o corte (${formatTime(cutEnd, true)})`, icon: <ArrowRightToLine size={13} />, disabled: locked || Math.abs(cutEnd - pos.end) < 0.02, onClick: () => s0.sendOp({ op: { type: 'trim_overlay', id: item.id, duration: cutEnd - pos.start }, note: `${st.label} até o corte` }) },
      { label: 'Ajustes…', onClick: () => openRightTab('ajustes') },
      'sep',
      { label: `Remover ${st.label.toLowerCase()}`, shortcut: 'Delete', icon: <Trash2 size={13} />, danger: true, disabled: locked, onClick: () => (s0.sendOp({ op: { type: 'remove_overlay', id: item.id }, note: `Removeu ${st.label}` }), select(null)) },
    ]);
  };

  const cues = item.source.type === 'motion' ? motionCues(item.source.motion, end - start) : item.source.type === 'lettering' ? letteringCues(item.source.lettering, end - start) : (item.sfx ?? []);
  return (
    <div
      data-overlay-id={item.id}
      onMouseDown={begin('move')}
      onContextMenu={menu}
      className={`group absolute top-0.5 bottom-0.5 overflow-hidden rounded-ui-sm border ${locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${selected ? 'z-10 ring-2 ring-white/70' : ''} ${bad ? 'outline-2 outline-rose-500' : ''}`}
      style={{ left: start * pps, width: Math.max(4, (end - start) * pps), background: st.bg, borderColor: selected ? '#fff' : st.border }}
      title={`${st.label}: ${text}${bad ? '\n⚠ repetido mais de 2×' : ''}`}
    >
      {item.role === 'broll' && asset?.thumbs && <Filmstrip asset={asset} width={(end - start) * pps} h={h - 6} pps={pps} srcAt={(local) => overlaySourceTime(item, local + (start - pos.start))} />}
      <div className={`relative flex items-center gap-1 truncate px-1.5 text-ui-xs leading-[1.6] font-medium text-white/90 ${item.role === 'broll' && asset?.thumbs ? 'bg-gradient-to-b from-black/75 to-transparent pb-1' : ''}`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: st.solid }} />
        {bad && '⚠ '}
        {text}
      </div>
      {/* SFX do motion: uma marca por efeito, no instante em que soa. */}
      {cues.map((c, i) => (
        <span key={i} className="pointer-events-none absolute bottom-0.5 h-1 w-px bg-white/70" style={{ left: c.t * pps }} title={c.kind} />
      ))}
      {!locked && (
        <>
          <div className={`absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize ${selected ? 'bg-white/60' : 'group-hover:bg-white/35'}`} onMouseDown={begin('left')} />
          <div className={`absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize ${selected ? 'bg-white/60' : 'group-hover:bg-white/35'}`} onMouseDown={begin('right')} />
        </>
      )}
    </div>
  );
}
