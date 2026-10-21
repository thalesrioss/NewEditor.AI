import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { buildCues, clipStarts, cueHtml, DEFAULT_CAPTIONS, formatTime, isNeutral, letteringFrameHtml, letteringFromText, locate, motionHtml, placeWords, resolveOverlay, timelineDuration, type Clip, type MediaAsset, overlayActive, overlayPlayback, trackFlag, zoomAt, clipSpeed } from '@neweditor/core';
import { mediaUrl, proxyOf } from '../lib/api.ts';
import { GradeCanvas } from './GradeCanvas.tsx';
import { AudioCard, EmptyPlayer, TextLayer } from './PlayerParts.tsx';
import { useMotionSfx } from '../lib/motionSfx.ts';
import { useEditor } from '../lib/store.ts';

/** Antecedência com que o próximo clipe começa a tocar (mudo) antes do corte. */
const PREROLL = 0.03;
/** Rampa de volume no corte — curta o bastante para não engolir consoante, longa o bastante para não estalar. */
const RAMP = 0.004;
const MUSIC_GAIN = 0.18;

/**
 * Preview da timeline a partir dos proxies (ADR-002).
 *
 * Dois elementos de mídia em revezamento; o ÁUDIO passa pelo Web Audio, e o corte é feito no relógio
 * de áudio: o clipe que sai vai a zero exatamente no ponto de saída, e o que entra só abre o volume
 * quando chega no ponto de entrada. Assim nenhum pedaço do trecho cortado vaza no play.
 */
/** Motor clássico (prévia rápida): dois <video> em revezamento, com o corte feito no relógio do Web Audio. */
export function LegacyPlayer() {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const seekReq = useEditor((s) => s.seekReq);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  const playhead = useEditor((s) => s.playhead);
  const transcripts = useEditor((s) => s.transcripts);
  const gradeDraft = useEditor((s) => s.gradeDraft);
  const compare = useEditor((s) => s.compare);

  const refs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const active = useRef(0);
  const idx = useRef(0);
  const raf = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const gains = useRef<GainNode[]>([]);
  const pending = useRef<{ idx: number; timers: number[]; opened: boolean } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [srcTime, setSrcTime] = useState<{ assetId: string; t: number } | null>(null);

  const timeline = project?.timeline;
  const assets = useMemo(() => new Map((project?.assets ?? []).map((a) => [a.id, a])), [project?.assets]);
  const total = timeline ? timelineDuration(timeline) : 0;

  const urlOf = (clip: Clip | undefined) => {
    const a = clip ? assets.get(clip.assetId) : undefined;
    const rel = a && proxyOf(a, timeline);
    return rel && project ? mediaUrl(project.id, rel) : '';
  };

  const prepare = (el: HTMLVideoElement | null, clip: Clip | undefined, t: number) => {
    if (!el || !clip) return;
    const url = urlOf(clip);
    if (!url) return;
    // Em erro (ex.: o servidor reiniciou no meio do carregamento), reatribuir o src recarrega.
    if (!el.src.endsWith(url) || el.error) el.src = url;
    el.playbackRate = clipSpeed(clip);
    const set = () => {
      el.currentTime = t;
    };
    if (el.readyState >= 1) set();
    else el.addEventListener('loadedmetadata', set, { once: true });
  };

  /** Liga os dois elementos no Web Audio (uma vez só — precisa de gesto do usuário). */
  const ensureAudio = () => {
    if (!ctx.current) {
      const c = new AudioContext({ latencyHint: 'interactive' });
      gains.current = refs.map((r, i) => {
        const g = c.createGain();
        g.gain.value = i === active.current ? 1 : 0;
        c.createMediaElementSource(r.current!).connect(g).connect(c.destination);
        return g;
      });
      ctx.current = c;
    }
    void ctx.current.resume();
  };

  const setGainsNow = () => {
    const c = ctx.current;
    if (!c) return;
    gains.current.forEach((g, i) => {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(i === active.current ? 1 : 0, c.currentTime);
    });
  };

  const clearPending = () => {
    pending.current?.timers.forEach((t) => clearTimeout(t));
    pending.current = null;
  };

  const relocate = (t: number) => {
    if (!timeline?.main.length) return;
    clearPending();
    const loc = locate(timeline, Math.min(t, Math.max(0, total - 0.001)));
    if (!loc) return;
    idx.current = loc.index;
    prepare(refs[active.current]!.current, loc.clip, loc.sourceTime);
    prepare(refs[1 - active.current]!.current, timeline.main[loc.index + 1], timeline.main[loc.index + 1]?.in ?? 0);
    setGainsNow();
    setActiveIdx(active.current);
    setSrcTime({ assetId: loc.clip.assetId, t: loc.sourceTime });
  };

  // Vídeo que falhou ao carregar tenta de novo sozinho e volta para o lugar do cursor.
  const relocateRef = useRef(relocate);
  relocateRef.current = relocate;
  useEffect(() => {
    const timers: number[] = [];
    const off = refs.map((r) => {
      const el = r.current;
      if (!el) return () => undefined;
      let tries = 0;
      const onError = () => {
        if (tries++ >= 10) return;
        timers.push(
          window.setTimeout(() => {
            if (!el.error || !el.src) return;
            el.addEventListener('loadedmetadata', () => relocateRef.current(useEditor.getState().playhead), { once: true });
            el.src = el.src;
          }, 1500),
        );
      };
      const onLoad = () => (tries = 0);
      el.addEventListener('error', onError);
      el.addEventListener('loadeddata', onLoad);
      return () => (el.removeEventListener('error', onError), el.removeEventListener('loadeddata', onLoad));
    });
    return () => (off.forEach((f) => f()), timers.forEach((t) => clearTimeout(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proxy da fala trocou (voz limpa ligada/desligada/pronta): recarrega no mesmo ponto.
  const mainUrls = useMemo(() => [...new Set(timeline?.main.map((c) => c.assetId))].map((id) => urlOf(timeline?.main.find((c) => c.assetId === id))).join('|'), [timeline, assets]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstUrls = useRef(true);
  useEffect(() => {
    if (firstUrls.current) return void (firstUrls.current = false);
    if (useEditor.getState().playing) setPlaying(false);
    relocate(useEditor.getState().playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainUrls]);

  useEffect(() => {
    if (seekReq) relocate(seekReq.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekReq]);

  // A timeline mudou (agente cortou ao vivo): reposiciona sem perder o lugar.
  useEffect(() => {
    if (!timeline) return;
    const el = refs[active.current]!.current;
    const cur = timeline.main[idx.current];
    if (playing && el && cur) {
      const st = el.currentTime;
      const i = timeline.main.findIndex((c) => c.assetId === cur.assetId && st >= c.in - 0.01 && st < c.out);
      if (i >= 0) {
        idx.current = i;
        clearPending();
        setGainsNow();
        prepare(refs[1 - active.current]!.current, timeline.main[i + 1], timeline.main[i + 1]?.in ?? 0);
        return;
      }
    }
    relocate(useEditor.getState().playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  useEffect(() => {
    if (!timeline?.main.length) return;
    if (!playing) {
      clearPending();
      refs.forEach((r) => r.current?.pause());
      setGainsNow();
      return;
    }
    ensureAudio();
    if (useEditor.getState().playhead >= total - 0.05) relocate(0);
    setGainsNow();
    void refs[active.current]!.current?.play().catch(() => setPlaying(false));

    const tick = () => {
      const tl = useEditor.getState().project?.timeline;
      const cur = refs[active.current]!.current;
      const clip = tl?.main[idx.current];
      const c = ctx.current;
      if (!tl || !cur || !clip || !c) return;
      const remaining = clip.out - cur.currentTime;
      const next = tl.main[idx.current + 1];
      const continuous = !!next && next.assetId === clip.assetId && Math.abs(next.in - clip.out) < 0.05;

      if (!next && remaining <= 0.02) {
        cur.pause();
        setPlaying(false);
        setPlayhead(timelineDuration(tl));
        return;
      }
      if (continuous && remaining <= 0) idx.current++;

      // Agenda o corte no relógio de áudio assim que ele estiver perto.
      if (next && !continuous && !pending.current && remaining < 0.25) {
        const myIdx = idx.current;
        const gOut = gains.current[active.current]!;
        const tCut = c.currentTime + Math.max(0, remaining);
        gOut.gain.cancelScheduledValues(c.currentTime);
        gOut.gain.setValueAtTime(1, Math.max(c.currentTime, tCut - RAMP));
        gOut.gain.linearRampToValueAtTime(0, tCut);
        const standby = refs[1 - active.current]!.current!;
        if (Math.abs(standby.currentTime - next.in) > 0.04) standby.currentTime = next.in;
        const timers = [
          window.setTimeout(() => void standby.play(), Math.max(0, (remaining - PREROLL) * 1000)),
          window.setTimeout(() => {
            if (!pending.current || pending.current.idx !== myIdx) return;
            const old = refs[active.current]!.current!;
            active.current = 1 - active.current;
            idx.current = myIdx + 1;
            setActiveIdx(active.current);
            old.pause();
            const after = useEditor.getState().project?.timeline.main[idx.current + 1];
            prepare(old, after, after?.in ?? 0);
            pending.current = null;
          }, Math.max(0, remaining * 1000)),
        ];
        pending.current = { idx: myIdx, timers, opened: false };
      }
      // O clipe que entra só abre o volume quando chega no ponto de entrada.
      if (pending.current && !pending.current.opened && next) {
        const standby = refs[1 - active.current]!.current!;
        if (!standby.paused && standby.currentTime >= next.in - 0.002) {
          const gIn = gains.current[1 - active.current]!;
          gIn.gain.cancelScheduledValues(c.currentTime);
          gIn.gain.setValueAtTime(0, c.currentTime);
          gIn.gain.linearRampToValueAtTime(1, c.currentTime + RAMP);
          pending.current.opened = true;
        }
      }

      const k = idx.current;
      const el = refs[active.current]!.current!;
      const cc = tl.main[k]!;
      setPlayhead((clipStarts(tl)[k] ?? 0) + Math.max(0, Math.min(el.currentTime, cc.out) - cc.in));
      setSrcTime({ assetId: cc.assetId, t: el.currentTime });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      clearPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline?.main.length === 0]);

  // SFX dos motions: mesmas amostras do export, agendadas no relógio de áudio.
  useMotionSfx(() => ctx.current, playing);

  const clip = timeline?.main[idx.current];
  const asset = clip ? assets.get(clip.assetId) : undefined;
  const isAudio = asset?.kind === 'audio';
  // O quadro é sempre o formato da ENTREGA (9:16 num Reels), mesmo quando a fala é só áudio.
  const aspect = timeline?.width && timeline.height ? timeline.width / timeline.height : 9 / 16;
  const locNow = timeline?.main.length ? locate(timeline, playhead) : null;
  const zoom = locNow ? zoomAt(locNow.clip, locNow.local) : (clip?.zoom ?? 1);
  // Legenda de verdade (a mesma do export) — derivada da transcrição + cortes.
  const caps = timeline?.captions ?? DEFAULT_CAPTIONS;
  const cues = useMemo(() => (timeline && caps.enabled ? buildCues(timeline, transcripts, caps) : []), [timeline, transcripts, caps]);
  // Cor: o vídeo ativo passa pelo mesmo LUT do export (rascunho ao vivo enquanto arrasta).
  const grade = asset && (gradeDraft?.assetId === asset.id ? gradeDraft.grade : timeline?.grades?.[asset.id]);
  const showGrade = !!asset && asset.kind === 'video' && !!grade && !isNeutral(grade) && !compare;
  const getActiveVideo = useCallback(() => refs[active.current]!.current, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A1 muda: o som da fala sai (a imagem continua).
  const speechMuted = !!timeline && trackFlag(timeline, 'A1', 'muted');
  useEffect(() => {
    refs.forEach((r) => r.current && (r.current.muted = speechMuted));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechMuted]);

  // Tem fala agora? (para o ducking da trilha no preview)
  const placed = useMemo(() => (timeline ? placeWords(timeline, transcripts) : []), [timeline, transcripts]);
  const speaking = placed.some((w) => playhead >= w.start - 0.1 && playhead <= w.end + 0.3);

  // Lettering ou motion na tela → a legenda sai (mesma regra do export).
  const letteringOn = (timeline?.overlays ?? []).some((o) => {
    if ((o.role !== 'lettering' && !(o.role === 'motion' && o.source.type === 'motion')) || !timeline || !overlayActive(timeline, o)) return false;
    const pos = resolveOverlay(timeline, o);
    return !!pos && playhead >= pos.start && playhead < pos.end;
  });
  const cue = letteringOn ? undefined : cues.find((c) => playhead >= c.start && playhead < c.end);
  const frame = useRef<HTMLDivElement>(null);
  const [frameH, setFrameH] = useState(400);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Overlays ativos no cursor (com folga para pré-carregar o próximo).
  const near = useMemo(() => {
    if (!timeline) return [];
    return timeline.overlays.flatMap((o) => {
      if (!overlayActive(timeline, o)) return [];
      const pos = resolveOverlay(timeline, o);
      return pos && pos.end > playhead - 0.5 && pos.start < playhead + 1.5 ? [{ o, ...pos }] : [];
    });
  }, [timeline, playhead]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3">
        <div ref={frame} className="relative max-h-full max-w-full overflow-hidden bg-black shadow-[var(--shadow-ui-2)] ring-1 ring-ink-700" style={{ aspectRatio: aspect, height: '100%' }}>
          {refs.map((r, i) => (
            <video
              key={i}
              ref={r}
              playsInline
              preload="auto"
              crossOrigin="anonymous"
              className="absolute inset-0 h-full w-full object-contain"
              style={{ opacity: activeIdx === i && !isAudio ? 1 : 0, transform: activeIdx === i ? `scale(${zoom})` : undefined }}
            />
          ))}
          {showGrade && grade && <GradeCanvas getVideo={getActiveVideo} grade={grade} style={{ transform: `scale(${zoom})` }} />}
          {isAudio && <AudioCard asset={asset} t={srcTime?.t ?? 0} />}
          {project &&
            near.map(({ o, start, end }) => {
              const a = o.source.type === 'media' ? assets.get(o.source.assetId) : undefined;
              const on = playhead >= start && playhead < end;
              if ((o.role === 'broll' || o.role === 'motion' || o.role === 'lettering') && a?.proxy && o.source.type === 'media' && a.kind === 'image') return <img key={o.id} src={mediaUrl(project.id, a.proxy)} alt="" className="pointer-events-none absolute inset-0 h-full w-full" style={{ objectFit: a.alpha ? 'contain' : 'cover', opacity: on ? 1 : 0 }} />;
              if ((o.role === 'broll' || o.role === 'motion' || o.role === 'lettering') && a?.proxy && o.source.type === 'media') return <OverlayMedia key={o.id} kind="video" url={mediaUrl(project.id, a.proxy)} srcIn={o.source.in} start={start} visible={on} playing={playing} playhead={playhead} speed={overlayPlayback(o).speed} moving={overlayPlayback(o).moving} />;
              if ((o.role === 'sfx' || o.role === 'music') && a?.proxy && o.source.type === 'media') {
                // Mesma mixagem do export: dB, fades e ducking (abaixa ~10 dB quando tem fala).
                const m = o.mix;
                let vol = m ? Math.pow(10, m.gainDb / 20) : o.role === 'music' ? MUSIC_GAIN : 1;
                if (m && m.fadeIn > 0) vol *= Math.min(1, Math.max(0, (playhead - start) / m.fadeIn));
                if (m && m.fadeOut > 0) vol *= Math.min(1, Math.max(0, (end - playhead) / m.fadeOut));
                if ((m?.duck ?? o.role === 'music') && speaking) vol *= 0.32;
                return <OverlayMedia key={o.id} kind="audio" url={mediaUrl(project.id, a.proxy)} srcIn={o.source.in} start={start} visible={on} playing={playing} playhead={playhead} volume={vol} />;
              }
              return null; // lettering e motion: desenhados na camada de texto abaixo
            })}
          {!timeline?.main.length && <EmptyPlayer />}
          <TextLayer frameH={frameH} aspect={aspect} />
        </div>
      </div>
    </div>
  );
}

/** B-roll / SFX / trilha sincronizados ao cursor da timeline. */
function OverlayMedia(props: { kind: 'video' | 'audio'; url: string; srcIn: number; start: number; visible: boolean; playing: boolean; playhead: number; volume?: number; speed?: number; moving?: number }) {
  const { kind, url, srcIn, start, visible, playing, playhead, volume = 1, speed = 1, moving = Infinity } = props;
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  // Velocidade e congelamento do B-roll (CH-0004): depois de `moving` s o quadro fica parado.
  const local = Math.max(0, playhead - start);
  const frozen = local >= moving;
  const want = srcIn + Math.min(local, moving) * speed;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = volume;
    if (el.playbackRate !== speed) el.playbackRate = speed;
    if (visible && playing && !frozen) {
      if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = want;
      if (el.paused) void el.play().catch(() => undefined);
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
    }
  });
  if (kind === 'audio') return <audio ref={ref} src={url} preload="auto" />;
  return <video ref={ref} src={url} muted playsInline preload="auto" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: visible ? 1 : 0 }} />;
}
