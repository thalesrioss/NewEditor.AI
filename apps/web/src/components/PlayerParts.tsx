import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCues, captionDefaults, captionInlineStyle, clipStarts, cueCaptions, cueHtml, cueVisible, DEFAULT_CAPTIONS, FLASH_FRAMES, letteringFrameHtml, letteringFromText, motionHtml, overlayActive, overlaysInDrawOrder, resolveOverlay, type LetteringSpec, type MediaAsset, frameCenter } from '@neweditor/core';
import { captionActions, cueText } from '../lib/captions.tsx';
import { webcodecsAvailable } from '../lib/engine/media.ts';
import { useEditor } from '../lib/store.ts';
import { mediaUrl } from '../lib/api.ts';

/**
 * Camada de texto (legenda, lettering, motion): o MESMO HTML/CSS que o Chrome desenha no export.
 * No preview ela é editável: arrastar a legenda ou um lettering muda a posição (CapCut: mexer "livre" no player);
 * a alça no canto da legenda muda a escala; duplo clique edita o texto.
 */
export function TextLayer({ frameH, aspect }: { frameH: number; aspect: number }) {
  const showBefore = useEditor((s) => s.showBefore);
  const beforeAgent = useEditor((s) => s.beforeAgent);
  const timeline = useEditor((s) => (showBefore && beforeAgent ? beforeAgent : s.project?.timeline));
  const transcripts = useEditor((s) => s.transcripts);
  // Legenda, lettering e motion decidem pelo meio do quadro, como o export (BL-0101): trocam no mesmo quadro.
  const playhead = frameCenter(useEditor((s) => s.playhead), timeline?.fps ?? 30);
  const sendOp = useEditor((s) => s.sendOp);
  const caps = timeline?.captions ?? DEFAULT_CAPTIONS;
  const cues = useMemo(() => (timeline && caps.enabled ? buildCues(timeline, transcripts, caps) : []), [timeline, transcripts, caps]);
  const near = useMemo(() => {
    if (!timeline) return [];
    return timeline.overlays.flatMap((o) => {
      if ((o.role !== 'lettering' && o.role !== 'motion') || !overlayActive(timeline, o)) return [];
      const pos = resolveOverlay(timeline, o);
      return pos && pos.end > playhead && pos.start <= playhead ? [{ o, ...pos }] : [];
    });
  }, [timeline, playhead]);
  // Flash de entrada (2 quadros invertidos): a mesma janela do export.
  const flash = useMemo(() => {
    if (!timeline) return false;
    const starts = clipStarts(timeline);
    const fd = FLASH_FRAMES / (timeline.fps || 30);
    return timeline.main.some((c, i) => c.flash && playhead >= starts[i]! && playhead < starts[i]! + fd);
  }, [timeline, playhead]);
  // Lettering, motion ou B-roll em cima → a legenda sai, salvo se o editor mandou mostrar (mesma regra do export).
  const cue = cues.find((c) => playhead >= c.start && playhead < c.end && cueVisible(c));
  // Duplo clique na legenda do player: edita ali mesmo (o mesmo HTML do export).
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const save = () => {
    if (!editing) return;
    const c = cues.find((x) => x.key === editing.key);
    if (c) captionActions.setText(c, editing.text);
    setEditing(null);
  };

  // Arrasto livre no player: a legenda (x, altura) e os letterings (x, altura); alça da legenda = escala.
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ kind: 'caption' | 'lettering' | 'scale'; id?: string; dx: number; dy: number; k: number } | null>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [capRect, setCapRect] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = capRef.current, root = layer.current;
    if (!el || !root || (!hover && drag?.kind !== 'scale')) return setCapRect(null);
    const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    setCapRect({ l: a.left - b.left, t: a.top - b.top, w: a.width, h: a.height });
  }, [hover, drag, playhead, caps, cue?.key]);

  const startDrag = (kind: 'caption' | 'lettering' | 'scale', id: string | undefined, e: React.MouseEvent) => {
    if (e.button !== 0 || !layer.current || showBefore) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = layer.current.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let dx = 0, dy = 0, k = 1, moved = false;
    const move = (ev: MouseEvent) => {
      dx = (ev.clientX - x0) / rect.width;
      dy = (ev.clientY - y0) / rect.height;
      if (kind === 'scale') k = Math.max(0.3, Math.min(3, 1 + (ev.clientX - x0) / Math.max(60, rect.width * 0.25)));
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 3) moved = true;
      setDrag({ kind, id, dx, dy, k });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      if (!moved) return;
      const st = useEditor.getState();
      const tl = st.project?.timeline;
      if (!tl) return;
      const c = tl.captions ?? DEFAULT_CAPTIONS;
      const d = captionDefaults(c);
      const own = cue?.position !== undefined ? cue.words[0]?.src : undefined;
      if (kind === 'caption' && own && cue?.position !== undefined) {
        // Legenda com altura própria (ajuste por bloco/trecho): o arraste move só ela, na vertical.
        const position = Math.max(0.06, Math.min(0.94, cue.position + dy));
        sendOp({ op: { type: 'edit_captions', edits: [{ assetId: own.assetId, at: own.at, patch: { position: Math.round(position * 1000) / 1000 } }] }, note: `Moveu esta legenda para ${Math.round(position * 100)}% de altura` });
      } else if (kind === 'caption') {
        const x = Math.max(0.05, Math.min(0.95, d.x + dx)), position = Math.max(0.04, Math.min(0.96, d.position + dy));
        sendOp({ op: { type: 'set_captions', captions: { ...c, x: Math.round(x * 1000) / 1000, position: Math.round(position * 1000) / 1000 } }, note: `Moveu a legenda para ${Math.round(position * 100)}% de altura` });
      } else if (kind === 'scale') {
        sendOp({ op: { type: 'set_captions', captions: { ...c, scale: Math.round(d.scale * k * 100) / 100 } }, note: `Escala da legenda ${Math.round(d.scale * k * 100)}%` });
      } else if (kind === 'lettering' && id) {
        const o = tl.overlays.find((x) => x.id === id);
        if (!o || o.source.type !== 'lettering') return;
        const sp = o.source.lettering;
        const y = Math.max(0.05, Math.min(0.95, (sp.y ?? c.position) + dy));
        const x = Math.max(0.1, Math.min(0.9, (sp.x ?? 0.5) + dx));
        sendOp({ op: { type: 'set_overlay_lettering', id, lettering: { ...sp, y: Math.round(y * 1000) / 1000, x: Math.abs(dx) > 0.01 ? Math.round(x * 1000) / 1000 : sp.x, align: Math.abs(dx) > 0.01 ? 'center' : sp.align } }, note: `Moveu o lettering para ${Math.round(y * 100)}% de altura` });
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Enquanto arrasta, a legenda e o lettering seguem o mouse (sem gravar).
  const cueCaps = cueCaptions(caps, cue);
  const liveCaps = drag?.kind === 'caption' ? { ...cueCaps, x: cue?.position !== undefined ? captionDefaults(caps).x : captionDefaults(caps).x + drag.dx, position: cueCaps.position + drag.dy } : drag?.kind === 'scale' ? { ...cueCaps, scale: captionDefaults(caps).scale * drag.k } : cueCaps;
  const liveSpec = (id: string, spec: LetteringSpec): LetteringSpec => (drag?.kind === 'lettering' && drag.id === id ? { ...spec, y: (spec.y ?? caps.position) + drag.dy, x: Math.abs(drag.dx) > 0.01 ? (spec.x ?? 0.5) + drag.dx : spec.x, align: Math.abs(drag.dx) > 0.01 ? 'center' : spec.align } : spec);

  return (
    <div ref={layer} className={`ne-text-layer${showBefore ? '' : ' editable'}`} style={{ ['--u' as string]: `${frameH / 100}px` }}>
      {flash && <div className="absolute inset-0 bg-white" style={{ mixBlendMode: 'difference' }} />}
      {near.map(({ o, start, end }) =>
        o.source.type === 'motion' ? <div key={o.id} dangerouslySetInnerHTML={{ __html: motionHtml(o.source.motion, playhead - start, end - start, aspect * 100) }} /> : null,
      )}
      {near.map(({ o, start, end }) => {
        if (o.role !== 'lettering') return null;
        const spec = o.source.type === 'lettering' ? o.source.lettering : o.source.type === 'text' ? letteringFromText(o.source.text) : null;
        if (!spec) return null;
        return (
          <div
            key={o.id}
            className={drag?.kind === 'lettering' && drag.id === o.id ? 'dragging' : undefined}
            onMouseDown={(e) => o.source.type === 'lettering' && startDrag('lettering', o.id, e)}
            onClick={(e) => (e.stopPropagation(), useEditor.getState().select({ kind: 'overlay', id: o.id }))}
            title="Arraste para mover o lettering"
            dangerouslySetInnerHTML={{ __html: letteringFrameHtml(liveSpec(o.id, spec), playhead - start, end - start, aspect * 100, caps.position) }}
          />
        );
      })}
      {cue && editing?.key !== cue.key && (
        <div
          ref={capRef}
          className={`ne-caption ${caps.style}${caps.box ? ' boxed' : ''}${drag?.kind === 'caption' ? ' dragging' : ''}`}
          style={{ ...inlineToObject(captionInlineStyle(liveCaps, drag ? undefined : { t: playhead, start: cue.start, end: cue.end })), pointerEvents: 'auto' }}
          title="Arraste para mover · duplo clique edita o texto · alça no canto muda a escala"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onMouseDown={(e) => startDrag('caption', undefined, e)}
          onClick={(e) => (e.stopPropagation(), useEditor.getState().select({ kind: 'caption', id: cue.key! }))}
          onDoubleClick={() => {
            useEditor.getState().setPlaying(false);
            setEditing({ key: cue.key!, text: cueText(cue) });
          }}
          dangerouslySetInnerHTML={{ __html: `<span>${cueHtml(cue, liveCaps, playhead)}</span>` }}
        />
      )}
      {capRect && cue && !editing && (
        <div
          role="slider"
          aria-label="Escala da legenda"
          title="Arraste para mudar a escala da legenda"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onMouseDown={(e) => startDrag('scale', undefined, e)}
          className="absolute z-10 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-nc-500 shadow"
          style={{ left: capRect.l + capRect.w - 2, top: capRect.t + capRect.h - 2, pointerEvents: 'auto' }}
        />
      )}
      {editing && (
        <input
          autoFocus
          aria-label="Texto da legenda"
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setEditing(null);
            if (e.key === 'Enter') save();
          }}
          onBlur={save}
          className="absolute inset-x-[6%] -translate-y-1/2 rounded-ui-md border-2 border-nc-400 bg-black/80 px-2 py-1 text-center text-ui-lg font-bold text-white outline-none"
          style={{ top: `${caps.position * 100}%`, pointerEvents: 'auto' }}
        />
      )}
    </div>
  );
}

/** Motor de preview escolhido: WebCodecs (ADR-005) ou o clássico de reserva. Fica salvo no navegador. */
export function useEngineMode(): ['webcodecs' | 'classico', (m: 'webcodecs' | 'classico') => void] {
  const [mode, setMode] = useState<'webcodecs' | 'classico'>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('ne-engine');
    } catch {
      /* sem armazenamento */
    }
    return saved === 'classico' || !webcodecsAvailable() ? 'classico' : 'webcodecs';
  });
  const set = (m: 'webcodecs' | 'classico') => {
    try {
      localStorage.setItem('ne-engine', m);
    } catch {
      /* sem armazenamento */
    }
    setMode(m);
  };
  return [mode, set];
}

export function AudioCard({ asset, t }: { asset: MediaAsset; t: number }) {
  const env = useEditor((s) => s.envelopes[asset.id]);
  const bars = 48;
  const f0 = Math.floor(t * 100);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-ink-850 to-ink-950">
      <img src="/logo-mark.png" alt="" className="h-14 opacity-90" />
      <div className="flex h-24 items-center gap-[3px]">
        {Array.from({ length: bars }, (_, i) => {
          const f = f0 + (i - bars / 2) * 2;
          const db = env && f >= 0 && f < env.length ? env[f]! : -90;
          const h = Math.max(0.04, Math.min(1, (db + 60) / 50));
          return <span key={i} className="block w-[4px] rounded-full" style={{ height: `${h * 100}%`, background: i === bars / 2 ? '#fff' : 'linear-gradient(#4f84ff,#00b4ff)', opacity: i < bars / 2 ? 0.5 : 1 }} />;
        })}
      </div>
      <div className="text-ui-sm text-ink-400">{asset.name} · áudio</div>
    </div>
  );
}

export function EmptyPlayer() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-400">
      <img src="/logo-mark.png" alt="" className="h-12 opacity-40 grayscale" />
      <p className="text-ui-md">Arraste um vídeo para começar</p>
    </div>
  );
}

/** "a:b;c:d" → objeto de estilo do React (custom properties incluídas). */
export function inlineToObject(css: string): React.CSSProperties {
  const o: Record<string, string> = {};
  for (const part of css.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (!k) continue;
    o[k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return o as React.CSSProperties;
}

/**
 * Motions do Motion Studio (vídeo com alfa, proxy WebM) desenhados como <video> por cima do quadro —
 * no motor novo o canvas (WebCodecs) não decodifica WebM com alfa, então esta camada DOM faz o papel.
 */
export function MediaMotionLayer() {
  const project = useEditor((s) => s.project);
  const timeline = project?.timeline;
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const at = frameCenter(playhead, timeline?.fps ?? 30); // entra e sai no quadro do export (BL-0101)
  const items = useMemo(() => {
    if (!timeline || !project) return [];
    // V2 embaixo, V3 em cima, como no export (CH-0024); o B-roll de vídeo já vai no canvas, abaixo desta camada.
    return overlaysInDrawOrder(timeline.overlays).flatMap((o) => {
      if (o.source.type !== 'media' || !overlayActive(timeline, o)) return [];
      const src = o.source;
      const a = project.assets.find((x) => x.id === src.assetId);
      // Motions do Studio (vídeo com alfa) e imagens (frames, PNG com alfa, GIF) em B-roll ou motion.
      if (!a || (o.role !== 'motion' && !(o.role === 'broll' && a.kind === 'image'))) return [];
      const pos = resolveOverlay(timeline, o);
      if (!pos || !a.proxy || pos.end < playhead - 1.5 || pos.start > playhead + 1.5) return [];
      return [{ id: o.id, url: mediaUrl(project.id, a.proxy), srcIn: src.in ?? 0, start: pos.start, end: pos.end, image: a.kind === 'image', alpha: !!a.alpha }];
    });
  }, [timeline, project, playhead]);
  return (
    <>
      {items.map((it) =>
        it.image ? (
          <img key={it.id} src={it.url} alt="" className="pointer-events-none absolute inset-0 h-full w-full" style={{ objectFit: it.alpha ? 'contain' : 'cover', opacity: at >= it.start && at < it.end ? 1 : 0 }} />
        ) : (
          <AlphaVideo key={it.id} url={it.url} srcIn={it.srcIn} start={it.start} visible={at >= it.start && at < it.end} playing={playing} playhead={playhead} />
        ),
      )}
    </>
  );
}

function AlphaVideo({ url, srcIn, start, visible, playing, playhead }: { url: string; srcIn: number; start: number; visible: boolean; playing: boolean; playhead: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const want = srcIn + Math.max(0, playhead - start);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (visible && playing) {
      if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = want;
      if (el.paused) void el.play().catch(() => undefined);
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
    }
  });
  return <video ref={ref} src={url} muted playsInline preload="auto" className="pointer-events-none absolute inset-0 h-full w-full object-contain" style={{ opacity: visible ? 1 : 0 }} />;
}
