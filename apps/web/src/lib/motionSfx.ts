import { useEffect, useMemo, useRef } from 'react';
import { flashShutterCues, letteringCues, MOTION_SFX_TRACK, motionCues, overlayActive, resolveOverlay, trackFlag, sfxBusDb, SFX_RATE, shapeSfxSample, speechLevelDb, synthSfx, type SfxCue, type Timeline } from '@neweditor/core';
import { cineproFileUrl } from './api.ts';

/** Amostras reais do CinePRO (banco 'cinepro'): escolhidas pelo servidor (mesma semente do export), decodificadas uma vez. */
const realSamples = new Map<string, Float32Array | null>();
const realPending = new Map<string, Promise<void>>();
function loadReal(ctx: AudioContext, c: SfxCue): Promise<void> {
  const key = `${c.kind}:${c.seed}`;
  if (realSamples.has(key)) return Promise.resolve();
  const pending = realPending.get(key);
  if (pending) return pending;
  const p: Promise<void> = fetch(`/api/cinepro/pick?kind=${c.kind}&seed=${c.seed}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`pick ${r.status}`))))
      .then((it: { id: string }) => fetch(cineproFileUrl(it.id)))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`arquivo ${r.status}`))))
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => {
        realSamples.set(key, audio.getChannelData(0).slice(0, Math.round(audio.sampleRate * 6)));
      })
      .catch(() => {
        realSamples.set(key, null);
      })
      .finally(() => realPending.delete(key));
  realPending.set(key, p);
  return p;
}
import { useEditor } from './store.ts';

/** Todos os SFX dos motions no tempo da timeline (mesma função que o export usa). */
export function timelineCues(tl: Timeline): { key: string; at: number; cue: SfxCue }[] {
  if (trackFlag(tl, MOTION_SFX_TRACK, 'muted')) return [];
  const flashes = flashShutterCues(tl).map(({ clipId, at, cue }) => ({ key: `flash:${clipId}`, at, cue }));
  return [...flashes, ...tl.overlays
    .flatMap((o) => {
      if (!overlayActive(tl, o)) return [];
      const pos = resolveOverlay(tl, o);
      if (!pos) return [];
      let cues: SfxCue[];
      if (o.source.type === 'motion') cues = motionCues(o.source.motion, pos.end - pos.start);
      else if (o.source.type === 'lettering') cues = letteringCues(o.source.lettering, pos.end - pos.start);
      else if (o.role === 'motion' && o.sfx?.length) cues = o.sfx;
      else return [];
      return cues.map((cue, i) => ({ key: `${o.id}:${i}`, at: pos.start + cue.t, cue }));
    })].sort((a, b) => a.at - b.at);
}

/**
 * Toca os SFX dos motions no preview: agenda cada efeito no relógio do Web Audio com ~250 ms de antecedência,
 * com as MESMAS amostras do export (síntese determinística do core).
 */
export function useMotionSfx(getCtx: () => AudioContext | null, playing: boolean): void {
  const timeline = useEditor((s) => s.project?.timeline);
  const envelopes = useEditor((s) => s.envelopes);
  const cues = useMemo(() => (timeline ? timelineCues(timeline) : []), [timeline]);
  const bank = timeline?.sfxBank ?? 'sintetizado';
  const mainIds = useMemo(() => [...new Set((timeline?.main ?? []).map((c) => c.assetId))].join(','), [timeline?.main]);
  const busDb = useMemo(() => {
    const lv = mainIds
      .split(',')
      .filter((id) => envelopes[id])
      .map((id) => speechLevelDb(envelopes[id]!));
    return sfxBusDb(lv.length ? lv.reduce((a, b) => a + b, 0) / lv.length : -24, timeline?.motionSfxDb ?? 0);
  }, [envelopes, mainIds, timeline?.motionSfxDb]);

  const buffers = useRef(new Map<string, AudioBuffer>());
  const live = useRef(new Map<string, AudioBufferSourceNode>());
  const bus = useRef<GainNode | null>(null);

  const stopAll = () => {
    for (const s of live.current.values()) {
      try {
        s.stop();
      } catch {
        /* já parou */
      }
    }
    live.current.clear();
  };

  // Volume do barramento (o StereoPanner reparte a −3 dB; o export usa pan com +3 dB → compensa com √2).
  useEffect(() => {
    if (bus.current) bus.current.gain.value = Math.pow(10, busDb / 20) * Math.SQRT2;
  }, [busDb]);

  useEffect(() => {
    if (!playing || !cues.length) {
      stopAll();
      return;
    }
    let raf = 0;
    let last = useEditor.getState().playhead;
    const loop = () => {
      const c = getCtx();
      const ph = useEditor.getState().playhead;
      if (c) {
        if (!bus.current || bus.current.context !== c) {
          bus.current = c.createGain();
          bus.current.gain.value = Math.pow(10, busDb / 20) * Math.SQRT2;
          bus.current.connect(c.destination);
        }
        // Pulo (seek) → cancela o que estava agendado.
        if (ph < last - 0.05 || ph > last + 0.6) stopAll();
        last = ph;
        for (const it of cues) {
          const dt = it.at - ph;
          if (dt > 0.25) break;
          if (dt < -0.03 || live.current.has(it.key)) continue;
          const id = `${bank}:${JSON.stringify({ ...it.cue, t: 0 })}`;
          let buf = buffers.current.get(id);
          if (!buf) {
            // Banco CinePRO: a amostra real, já com a forma do efeito; sem ela (ainda carregando ou sem acerto), a síntese.
            const real = bank === 'cinepro' ? realSamples.get(`${it.cue.kind}:${it.cue.seed}`) : null;
            if (bank === 'cinepro' && real === undefined) {
              void loadReal(c, it.cue);
              continue;
            }
            const sr = real ? c.sampleRate : SFX_RATE;
            const x = real ? shapeSfxSample(real, it.cue, sr) : synthSfx(it.cue);
            buf = new AudioBuffer({ numberOfChannels: 1, length: x.length, sampleRate: sr });
            buf.getChannelData(0).set(x);
            buffers.current.set(id, buf);
          }
          const src = c.createBufferSource();
          src.buffer = buf;
          const pan = c.createStereoPanner();
          pan.pan.value = it.cue.pan ?? 0;
          src.connect(pan).connect(bus.current);
          src.start(c.currentTime + Math.max(0, dt), dt < 0 ? -dt : 0);
          live.current.set(it.key, src);
          src.onended = () => {
            if (live.current.get(it.key) === src) live.current.delete(it.key);
          };
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cues, bank]);

  // Banco CinePRO: pré-carrega as amostras de todas as cues (para o play não perder as primeiras).
  useEffect(() => {
    if (bank !== 'cinepro') return;
    const c = getCtx();
    if (!c) return;
    for (const it of cues) void loadReal(c, it.cue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bank, cues, playing]);
}
