import { useEffect, useMemo, useRef, useState } from 'react';
import { locate, placeWords, resolveRegionFx, timelineDuration, type Timeline } from '@neweditor/core';
import { mediaUrl, proxyOf } from '../lib/api.ts';
import { Engine } from '../lib/engine/engine.ts';
import { useMotionSfx } from '../lib/motionSfx.ts';
import { loadCube } from '../lib/looks.ts';
import { useEditor } from '../lib/store.ts';
import { AudioCard, EmptyPlayer, MediaMotionLayer, TextLayer } from './PlayerParts.tsx';

/**
 * Preview pelo motor único (ADR-005): WebCodecs + compositor WebGL, quadro exato em qualquer instante,
 * áudio agendado por amostra. Texto/lettering/motion por cima com o mesmo HTML do export.
 */
export function EnginePlayer() {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const seekReq = useEditor((s) => s.seekReq);
  const transcripts = useEditor((s) => s.transcripts);
  const gradeDraft = useEditor((s) => s.gradeDraft);
  const compare = useEditor((s) => s.compare);
  const playhead = useEditor((s) => s.playhead);
  const showBefore = useEditor((s) => s.showBefore);
  const beforeAgent = useEditor((s) => s.beforeAgent);
  const timeline = showBefore && beforeAgent ? beforeAgent : project?.timeline;
  const total = timeline ? timelineDuration(timeline) : 0;
  const aspect = timeline?.width && timeline.height ? timeline.width / timeline.height : 9 / 16;

  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [frameH, setFrameH] = useState(400);
  const [error, setError] = useState('');

  // Motor: um por projeto.
  useEffect(() => {
    if (!canvas.current || !project) return;
    try {
      const pid = project.id;
      engine.current = new Engine(canvas.current, (a, tl) => {
        const rel = proxyOf(a, tl ?? undefined);
        return rel ? mediaUrl(pid, rel) : null;
      });
      if (import.meta.env.DEV) (window as unknown as { __engine: Engine | null }).__engine = engine.current;
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      engine.current?.close();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Fala da timeline (para o ducking da trilha): palavras juntadas em trechos.
  const speech = useMemo(() => {
    if (!timeline) return [] as [number, number][];
    const out: [number, number][] = [];
    for (const w of placeWords(timeline, transcripts)) {
      const last = out[out.length - 1];
      if (last && w.start - last[1] < 0.3) last[1] = w.end;
      else out.push([w.start, w.end]);
    }
    return out;
  }, [timeline, transcripts]);

  useEffect(() => {
    if (timeline && project) engine.current?.setTimeline(timeline, project.assets, speech);
  }, [timeline, project?.assets, speech]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => engine.current?.setGrade(gradeDraft, !compare), [gradeDraft, compare]);
  // Looks do CinePRO nas correções (ou no rascunho): baixa o .cube e entrega ao compositor, que refaz a LUT.
  useEffect(() => {
    const ids = new Set<string>();
    // LUT de entrada de fabricante (color management por clipe) vem pelo mesmo caminho dos looks; S-Log3 é embutida no core.
    for (const g of [...Object.values(timeline?.grades ?? {}), ...(timeline?.main ?? []).flatMap((c) => (c.grade ? [c.grade] : [])), ...(gradeDraft ? [gradeDraft.grade] : [])]) {
      if (g.lut) ids.add(g.lut.id);
      if (g.inputLut) ids.add(g.inputLut.id);
    }
    for (const id of ids) {
      const comp = engine.current?.compositor;
      if (!comp || comp.hasCube(id)) continue;
      loadCube(id).then((c) => engine.current?.compositor.setCube(id, c)).catch(() => undefined);
    }
  }, [timeline?.grades, timeline?.main, gradeDraft]);

  // Tocar / pausar / pular.
  useEffect(() => {
    const e = engine.current;
    if (!e || !timeline?.main.length) return;
    if (playing) {
      let at = useEditor.getState().playhead;
      if (at >= total - 0.05) at = 0;
      e.play(at);
    } else e.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  useEffect(() => {
    if (seekReq) engine.current?.seek(seekReq.t);
  }, [seekReq]);

  // Quadro a quadro da tela: em reprodução o relógio é o do áudio; parado, o cursor da timeline.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const e = engine.current;
      const st = useEditor.getState();
      if (e) {
        if (e.isPlaying) {
          const t = e.time();
          const end = st.project ? timelineDuration(st.project.timeline) : 0;
          if (t >= end) {
            st.setPlaying(false);
            st.setPlayhead(end);
          } else st.setPlayhead(t);
          e.draw(t);
        } else e.draw(st.playhead);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Tamanho do canvas acompanha o quadro mostrado.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setFrameH(el.clientHeight);
      engine.current?.compositor.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // SFX dos motions/letterings: no mesmo relógio de áudio do motor.
  useMotionSfx(() => engine.current?.ctx ?? null, playing);

  const loc = timeline?.main.length ? locate(timeline, Math.min(playhead, Math.max(0, total - 0.001))) : null;
  const asset = loc ? project?.assets.find((a) => a.id === loc.clip.assetId) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3">
        <div ref={frame} className="relative max-h-full max-w-full overflow-hidden bg-black shadow-[var(--shadow-ui-2)] ring-1 ring-ink-700" style={{ aspectRatio: aspect, height: '100%' }}>
          <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
          {timeline?.regionFx?.length ? <RegionFxLayer timeline={timeline} t={playhead} frameH={frameH} /> : null}
          {asset?.kind === 'audio' && <AudioCard asset={asset} t={loc!.sourceTime} />}
          {!timeline?.main.length && <EmptyPlayer />}
          {error && <p className="absolute inset-x-4 top-4 rounded bg-rose-500/20 p-2 text-ui-xs text-rose-200">Motor novo indisponível: {error}. Use o clássico.</p>}
          <MediaMotionLayer />
          <TextLayer frameH={frameH} aspect={aspect} />
        </div>
      </div>
    </div>
  );
}

/**
 * Efeito por região no preview (CH-0033): desfoque do que está atrás (backdrop-filter) no retângulo, com a borda
 * suave por máscara. Fica entre a fala e o lettering/legenda, como no export. Aproximação: a limpeza aparece como
 * desfoque forte e a proteção dos pixels escuros só entra no render.
 */
function RegionFxLayer({ timeline, t, frameH }: { timeline: Timeline; t: number; frameH: number }) {
  if (timeline.trackState?.V1?.hidden) return null;
  const k = frameH / 1920;
  return (
    <>
      {(timeline.regionFx ?? []).map((fx) => {
        const pos = resolveRegionFx(timeline, fx);
        if (!pos || t < pos.start || t >= pos.end) return null;
        const blur = (fx.mode === 'clean' ? 6 + fx.strength * 34 : 3 + fx.strength * 57) * k;
        const fade = fx.fade ? Math.min(1, (t - pos.start) / fx.fade, (pos.end - t) / fx.fade) : 1;
        const f = fx.feather * frameH;
        const mask = f > 0.5 ? `linear-gradient(to right, transparent, #000 ${f}px, #000 calc(100% - ${f}px), transparent), linear-gradient(to bottom, transparent, #000 ${f}px, #000 calc(100% - ${f}px), transparent)` : undefined;
        return (
          <div
            key={fx.id}
            className="pointer-events-none absolute"
            title={fx.reason ?? 'efeito por região'}
            style={{
              left: `calc(${fx.rect.x * 100}% - ${f / 2}px)`,
              top: `calc(${fx.rect.y * 100}% - ${f / 2}px)`,
              width: `calc(${fx.rect.w * 100}% + ${f}px)`,
              height: `calc(${fx.rect.h * 100}% + ${f}px)`,
              backdropFilter: `blur(${blur.toFixed(1)}px)`,
              WebkitBackdropFilter: `blur(${blur.toFixed(1)}px)`,
              opacity: fade,
              maskImage: mask,
              WebkitMaskImage: mask,
              maskComposite: mask ? 'intersect' : undefined,
              WebkitMaskComposite: mask ? 'source-in' : undefined,
            }}
          />
        );
      })}
    </>
  );
}
