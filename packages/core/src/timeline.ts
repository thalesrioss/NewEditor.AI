import { DEFAULT_TRACKS, TIMELINE_ANCHOR, type Actor, type CaptionEdit, type Clip, type OverlayItem, type Pin, type Removal, type Seconds, type Timeline, type TimelineOp } from './types.ts';
import { MOTION_TEMPLATES, type MotionTemplateId } from './motion.ts';
import { normalizeGradeLut } from './color.ts';

/** Menor duração de clipe que mantemos; abaixo disso é resíduo de corte. */
export const MIN_CLIP: Seconds = 0.04;

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Garante os campos novos em projetos salvos antes da multitrilha. */
export function normalizeTimeline(t: Partial<Timeline> & Pick<Timeline, 'fps' | 'width' | 'height' | 'main'>): Timeline {
  return {
    ...t,
    removals: t.removals ?? [],
    pins: t.pins ?? [],
    tracks: t.tracks?.length ? t.tracks : DEFAULT_TRACKS,
    overlays: t.overlays ?? [],
  } as Timeline;
}

export const clipSpeed = (c: Clip): number => (c.speed && c.speed > 0 ? c.speed : 1);
/** Quanto do clipe TOCA (fonte ÷ velocidade), sem o congelamento. */
export const clipPlayed = (c: Clip): Seconds => (c.out - c.in) / clipSpeed(c);
/** Duração no tempo de saída: fonte ÷ velocidade + congelamento no fim. */
export const clipDuration = (c: Clip): Seconds => clipPlayed(c) + (c.freeze ?? 0);
/** Zoom no instante `local` (s desde o início do clipe): fixo, ou animado de `zoom` até `zoomTo` com ease-out. */
export function zoomAt(c: Clip, local: Seconds): number {
  const z0 = c.zoom ?? 1;
  const z1 = c.zoomTo ?? z0;
  if (z1 === z0) return z0;
  const p = Math.min(1, Math.max(0, local / Math.max(0.01, clipPlayed(c))));
  return z0 + (z1 - z0) * (1 - Math.pow(1 - p, 3));
}
/** Duração do flash de entrada (2 quadros). */
export const FLASH_FRAMES = 2;

export function timelineDuration(t: Timeline): Seconds {
  return t.main.reduce((acc, c) => acc + clipDuration(c), 0);
}

/** Início de cada clipe no tempo de saída. */
/** Obturador de cada flash, no tempo da timeline (export e preview). Flash com `flashSfx: false` fica só visual. */
export function flashShutterCues(t: Timeline): { clipId: string; at: Seconds; cue: { t: number; kind: 'shutter'; gain: number; seed: number } }[] {
  const starts = clipStarts(t);
  return t.main
    .flatMap((c, i) => (c.flash ? [{ c, at: starts[i]! }] : []))
    .map(({ c, at }, i) => ({ clipId: c.id, at, sfx: c.flashSfx !== false, cue: { t: 0, kind: 'shutter' as const, gain: 0.9, seed: 7000 + i } }))
    .filter((x) => x.sfx)
    .map(({ clipId, at, cue }) => ({ clipId, at, cue }));
}

export function clipStarts(t: Timeline): Seconds[] {
  const starts: Seconds[] = [];
  let acc = 0;
  for (const c of t.main) {
    starts.push(acc);
    acc += clipDuration(c);
  }
  return starts;
}

/** Onde está o tempo de saída `time`: índice do clipe e tempo correspondente na fonte. */
export function locate(t: Timeline, time: Seconds): { index: number; clip: Clip; sourceTime: Seconds; clipStart: Seconds; local: Seconds } | null {
  let acc = 0;
  for (let i = 0; i < t.main.length; i++) {
    const c = t.main[i]!;
    const d = clipDuration(c);
    if (time < acc + d || i === t.main.length - 1) {
      const local = Math.min(Math.max(time - acc, 0), d);
      // Durante o congelamento a fonte para no último quadro.
      return { index: i, clip: c, sourceTime: c.in + Math.min(local, clipPlayed(c)) * clipSpeed(c), clipStart: acc, local };
    }
    acc += d;
  }
  return null;
}

/** Tempo de saída correspondente a um ponto da fonte (se esse ponto está na timeline). */
export function sourceToTimeline(t: Timeline, assetId: string, sourceTime: Seconds): Seconds | null {
  let acc = 0;
  for (const c of t.main) {
    if (c.assetId === assetId && sourceTime >= c.in && sourceTime <= c.out) return acc + (sourceTime - c.in) / clipSpeed(c);
    acc += clipDuration(c);
  }
  return null;
}

/** Posição de um overlay na timeline; null = o instante da fala onde ele estava ancorado foi cortado (órfão). */
export function resolveOverlay(t: Timeline, item: OverlayItem): { start: Seconds; end: Seconds } | null {
  const start = item.anchor.assetId === TIMELINE_ANCHOR ? item.anchor.at : sourceToTimeline(t, item.anchor.assetId, item.anchor.at);
  if (start === null) return null;
  return { start, end: item.toEnd ? Math.max(start, timelineDuration(t)) : start + item.duration };
}

/** O ponto de âncora existe na timeline? (âncora de timeline sempre existe) */
function anchorValid(t: Timeline, assetId: string, at: Seconds): boolean {
  return assetId === TIMELINE_ANCHOR || sourceToTimeline(t, assetId, at) !== null;
}

/** Âncora (instante da fala) correspondente a um tempo da timeline. */
export function anchorAt(t: Timeline, time: Seconds): { assetId: string; at: Seconds } | null {
  const loc = locate(t, time);
  return loc ? { assetId: loc.clip.assetId, at: loc.sourceTime } : null;
}

// ---------------------------------------------------------------------------
// Intervalos
// ---------------------------------------------------------------------------

interface Ranged {
  assetId: string;
  in: Seconds;
  out: Seconds;
}

/** Tira [a, b) de cada intervalo do asset, preservando os demais campos. */
function subtractFrom<T extends Ranged & { id: string }>(items: T[], assetId: string, a: Seconds, b: Seconds, prefix: string): T[] {
  return items.flatMap((x) => {
    if (x.assetId !== assetId || b <= x.in || a >= x.out) return [x];
    const parts: T[] = [];
    if (a - x.in >= MIN_CLIP) parts.push({ ...x, out: a });
    if (x.out - b >= MIN_CLIP) parts.push({ ...x, id: parts.length ? uid(prefix) : x.id, in: b });
    return parts;
  });
}

/** Remove [a, b) da fonte de um clipe, devolvendo 0, 1 ou 2 pedaços. */
function subtractRange(c: Clip, a: number, b: number): Clip[] {
  return subtractFrom([c], c.assetId, a, b, 'clip');
}

/** Clipe abaixo disso vira "pisca" (QC avisa). */
export const PISCA: Seconds = 0.35;

/**
 * Bordas de um corte por frase [a, b) na fonte, estendidas até a remoção vizinha quando o que sobraria entre
 * as duas é mais curto que `PISCA` (a sílaba solta do FB-0022). Só estende até a borda de um trecho já removido;
 * corte de clipe (split) ou começo do material não contam como vizinho.
 */
export function snapCut(t: Timeline, assetId: string, a: Seconds, b: Seconds): { in: Seconds; out: Seconds } {
  const removedAt = (x: Seconds, side: 'in' | 'out') => t.removals.some((r) => r.assetId === assetId && Math.abs(r[side] - x) < 1e-3);
  let lo = a;
  let hi = b;
  for (const c of t.main) {
    if (c.assetId !== assetId || c.out <= a || c.in >= b) continue;
    if (c.in < a && a - c.in < PISCA && removedAt(c.in, 'out')) lo = Math.min(lo, c.in);
    if (c.out > b && c.out - b < PISCA && removedAt(c.out, 'in')) hi = Math.max(hi, c.out);
  }
  return { in: lo, out: hi };
}

const sortRanges = <T extends Ranged>(xs: T[]): T[] => [...xs].sort((x, y) => x.assetId.localeCompare(y.assetId) || x.in - y.in);

function addPin(pins: Pin[], assetId: string, a: Seconds, b: Seconds, reason: string): Pin[] {
  return sortRanges([...subtractFrom(pins, assetId, a, b, 'pin'), { id: uid('pin'), assetId, in: a, out: b, reason }]);
}

export class OpError extends Error {}

/**
 * Aplica uma operação e devolve uma NOVA timeline (imutável — facilita desfazer e diff).
 * Lança OpError se a operação não fizer sentido; a timeline original fica intacta.
 *
 * Regra "nada se perde": tudo que sai da trilha principal vira Removal (restaurável); tudo que o
 * HUMANO devolve vira Pin (uma nova decupagem automática não corta ali de novo).
 */
export function applyOp(tIn: Timeline, op: TimelineOp, by: Actor): Timeline {
  const t = normalizeTimeline(tIn);
  const now = Date.now();
  switch (op.type) {
    case 'set_main':
      return { ...t, main: op.clips.filter((c) => clipDuration(c) >= MIN_CLIP), removals: sortRanges(op.removals ?? t.removals) };

    case 'cut_source': {
      if (op.out <= op.in) throw new OpError('cut_source: out precisa ser maior que in');
      const main = t.main.flatMap((c) => (c.assetId === op.assetId ? subtractRange(c, op.in, op.out) : [c]));
      const removal: Removal = { id: uid('rm'), assetId: op.assetId, in: op.in, out: op.out, kind: op.kind, reason: op.reason, by, at: now };
      const pins = by === 'human' ? subtractFrom(t.pins, op.assetId, op.in, op.out, 'pin') : t.pins;
      return { ...t, main, pins, removals: sortRanges([...t.removals, removal]) };
    }

    case 'cut_timeline': {
      if (op.end <= op.start) throw new OpError('cut_timeline: end precisa ser maior que start');
      const removals: Removal[] = [];
      const main: Clip[] = [];
      let pins = t.pins;
      let acc = 0;
      for (const c of t.main) {
        const d = clipDuration(c);
        const a = Math.max(op.start - acc, 0);
        const b = Math.min(op.end - acc, d);
        if (b > a) {
          removals.push({ id: uid('rm'), assetId: c.assetId, in: c.in + a, out: c.in + b, kind: 'manual', reason: op.reason, by, at: now });
          main.push(...subtractRange(c, c.in + a, c.in + b));
          if (by === 'human') pins = subtractFrom(pins, c.assetId, c.in + a, c.in + b, 'pin');
        } else main.push(c);
        acc += d;
      }
      return { ...t, main, pins, removals: sortRanges([...t.removals, ...removals]) };
    }

    case 'restore': {
      const r = t.removals.find((x) => x.id === op.removalId);
      if (!r) throw new OpError(`restore: trecho ${op.removalId} não existe`);
      const restored: Clip = { id: uid('clip'), assetId: r.assetId, in: r.in, out: r.out, by, reason: `restaurado: ${r.reason}` };
      // Insere na posição cronológica da fonte (antes do primeiro clipe do mesmo asset que começa depois dele).
      let idx = t.main.length;
      for (let i = 0; i < t.main.length; i++) {
        const c = t.main[i]!;
        if (c.assetId === r.assetId && c.in >= r.out) {
          idx = i;
          break;
        }
      }
      const main = [...t.main.slice(0, idx), restored, ...t.main.slice(idx)];
      const pins = by === 'human' ? addPin(t.pins, r.assetId, r.in, r.out, `restaurado pelo editor: ${r.reason}`) : t.pins;
      return { ...t, main: coalesce(main), pins, removals: t.removals.filter((x) => x.id !== r.id) };
    }

    case 'trim': {
      const c = t.main.find((x) => x.id === op.clipId);
      if (!c) throw new OpError(`trim: clipe ${op.clipId} não existe`);
      const next = { ...c, in: Math.max(0, op.in ?? c.in), out: op.out ?? c.out };
      if (clipDuration(next) < MIN_CLIP) throw new OpError('trim: clipe ficaria curto demais');
      let removals = t.removals;
      let pins = t.pins;
      const shrink: [number, number][] = [];
      const grow: [number, number][] = [];
      if (next.in > c.in) shrink.push([c.in, next.in]);
      if (next.in < c.in) grow.push([next.in, c.in]);
      if (next.out < c.out) shrink.push([next.out, c.out]);
      if (next.out > c.out) grow.push([c.out, next.out]);
      for (const [a, b] of shrink) removals = [...removals, { id: uid('rm'), assetId: c.assetId, in: a, out: b, kind: 'manual', reason: 'aparado na timeline', by, at: now }];
      for (const [a, b] of grow) {
        // O que voltou para a timeline deixa de ser "removido".
        removals = subtractFrom(removals, c.assetId, a, b, 'rm');
        if (by === 'human') pins = addPin(pins, c.assetId, a, b, 'estendido pelo editor');
      }
      return { ...t, main: t.main.map((x) => (x.id === c.id ? next : x)), removals: sortRanges(removals), pins };
    }

    case 'delete_clip': {
      const c = t.main.find((x) => x.id === op.clipId);
      if (!c) throw new OpError(`delete_clip: clipe ${op.clipId} não existe`);
      const removal: Removal = { id: uid('rm'), assetId: c.assetId, in: c.in, out: c.out, kind: 'manual', reason: op.reason ?? 'clipe removido', by, at: now };
      const pins = by === 'human' ? subtractFrom(t.pins, c.assetId, c.in, c.out, 'pin') : t.pins;
      return { ...t, main: t.main.filter((x) => x.id !== c.id), pins, removals: sortRanges([...t.removals, removal]) };
    }

    case 'move_clip': {
      const from = t.main.findIndex((x) => x.id === op.clipId);
      if (from < 0) throw new OpError(`move_clip: clipe ${op.clipId} não existe`);
      const main = [...t.main];
      const [c] = main.splice(from, 1);
      main.splice(Math.max(0, Math.min(op.toIndex, main.length)), 0, c!);
      return { ...t, main };
    }

    case 'split': {
      const loc = locate(t, op.time);
      if (!loc) throw new OpError('split: tempo fora da timeline');
      const { index, clip, sourceTime } = loc;
      if (sourceTime - clip.in < MIN_CLIP || clip.out - sourceTime < MIN_CLIP) return t;
      const a: Clip = { ...clip, out: sourceTime, freeze: undefined };
      const b: Clip = { ...clip, id: uid('clip'), in: sourceTime, flash: undefined, flashSfx: undefined };
      return { ...t, main: [...t.main.slice(0, index), a, b, ...t.main.slice(index + 1)] };
    }

    case 'set_zoom': {
      // Até 4×: bruto 4K vertical numa timeline 1080 aguenta ~2× nativo; acima disso é upscale (refs da Brane a ~2,6×).
      if (!(op.zoom >= 1 && op.zoom <= MAX_CLIP_ZOOM)) throw new OpError(`set_zoom: zoom entre 1 e ${MAX_CLIP_ZOOM}`);
      if (op.zoomTo !== undefined && op.zoomTo !== null && !(op.zoomTo >= 1 && op.zoomTo <= MAX_CLIP_ZOOM)) throw new OpError(`set_zoom: zoomTo entre 1 e ${MAX_CLIP_ZOOM}`);
      return {
        ...t,
        main: t.main.map((c) => {
          if (c.id !== op.clipId) return c;
          const next: Clip = { ...c };
          if (op.zoom === 1) delete next.zoom;
          else next.zoom = op.zoom;
          if (op.zoomTo === null || (op.zoomTo !== undefined && op.zoomTo === (next.zoom ?? 1))) delete next.zoomTo;
          else if (op.zoomTo !== undefined) next.zoomTo = op.zoomTo;
          return next;
        }),
      };
    }
    case 'set_flash':
      return {
        ...t,
        main: t.main.map((c) => {
          if (c.id !== op.clipId) return c;
          const next: Clip = { ...c };
          if (op.on) next.flash = true;
          else delete next.flash;
          if (!op.on || op.sfx === true) delete next.flashSfx;
          else if (op.sfx === false) next.flashSfx = false;
          return next;
        }),
      };
    case 'set_speed': {
      if (op.speed !== undefined && op.speed !== null && (op.speed < 0.25 || op.speed > 4)) throw new OpError('set_speed: velocidade entre 0,25 e 4');
      if (op.freeze !== undefined && op.freeze !== null && (op.freeze < 0 || op.freeze > 10)) throw new OpError('set_speed: congelamento entre 0 e 10 s');
      return {
        ...t,
        main: t.main.map((c) => {
          if (c.id !== op.clipId) return c;
          const next: Clip = { ...c };
          if (op.speed !== undefined) {
            if (op.speed === null || Math.abs(op.speed - 1) < 1e-6) delete next.speed;
            else next.speed = op.speed;
          }
          if (op.freeze !== undefined) {
            if (op.freeze === null || op.freeze <= 0) delete next.freeze;
            else next.freeze = op.freeze;
          }
          return next;
        }),
      };
    }
    case 'set_cam':
      return {
        ...t,
        main: t.main.map((c) => {
          if (c.id !== op.clipId) return c;
          const next: Clip = { ...c };
          if (op.assetId) next.cam = op.assetId;
          else delete next.cam;
          return next;
        }),
      };
    case 'set_framing':
      return {
        ...t,
        main: t.main.map((c) => {
          if (c.id !== op.clipId) return c;
          const next: Clip = { ...c };
          const framing = { ...c.framing };
          for (const k of ['x', 'y'] as const) {
            const v = op[k];
            if (v === null) delete framing[k];
            else if (v !== undefined) {
              if (!Number.isFinite(v)) throw new OpError(`set_framing: ${k} entre 0 e 1`);
              framing[k] = Math.min(1, Math.max(0, v));
            }
          }
          if (framing.x === undefined && framing.y === undefined) delete next.framing;
          else next.framing = framing;
          return next;
        }),
      };
    case 'set_reframe': {
      const { reframe: _drop, ...rest } = t;
      return op.on ? { ...rest, reframe: true } : rest;
    }
    case 'set_sfx_bank':
      return { ...t, sfxBank: op.bank };
    case 'set_format': {
      const w = Math.round(op.width);
      const h = Math.round(op.height);
      const fps = op.fps ?? t.fps;
      if (!(w >= 64 && w <= 8192 && h >= 64 && h <= 8192)) throw new OpError('set_format: largura e altura entre 64 e 8192 px');
      if (w % 2 || h % 2) throw new OpError('set_format: largura e altura precisam ser pares (codec)');
      if (!(fps >= 1 && fps <= 120)) throw new OpError('set_format: fps entre 1 e 120');
      return { ...t, width: w, height: h, fps, formatoManual: true };
    }

    case 'add_overlay': {
      const track = t.tracks.find((x) => x.id === op.item.trackId);
      if (!track) throw new OpError(`add_overlay: trilha ${op.item.trackId} não existe`);
      if (!track.roles.includes(op.item.role)) throw new OpError(`add_overlay: a trilha ${track.label} não aceita ${op.item.role}`);
      if (op.item.duration < MIN_CLIP) throw new OpError('add_overlay: duração curta demais');
      if (!anchorValid(t, op.item.anchor.assetId, op.item.anchor.at)) throw new OpError('add_overlay: o ponto de âncora não está na timeline');
      const item: OverlayItem = { ...op.item, id: op.item.id ?? uid('ov'), by };
      return { ...t, overlays: [...t.overlays, item] };
    }

    case 'move_overlay': {
      if (!t.overlays.some((o) => o.id === op.id)) throw new OpError(`move_overlay: ${op.id} não existe`);
      if (!anchorValid(t, op.anchor.assetId, op.anchor.at)) throw new OpError('move_overlay: o ponto de âncora não está na timeline');
      return { ...t, overlays: t.overlays.map((o) => (o.id === op.id ? { ...o, anchor: op.anchor, trackId: op.trackId ?? o.trackId, by: by === 'human' ? by : o.by } : o)) };
    }

    case 'trim_overlay': {
      if (op.duration < MIN_CLIP) throw new OpError('trim_overlay: duração curta demais');
      return {
        ...t,
        overlays: t.overlays.map((o) =>
          o.id !== op.id ? o : { ...o, duration: op.duration, by: by === 'human' ? by : o.by, source: o.source.type === 'media' && op.sourceIn !== undefined ? { ...o.source, in: Math.max(0, op.sourceIn) } : o.source },
        ),
      };
    }

    case 'remove_overlay':
      return { ...t, overlays: t.overlays.filter((o) => o.id !== op.id) };

    case 'set_overlay_mix':
      return {
        ...t,
        overlays: t.overlays.map((o) =>
          o.id !== op.id ? o : { ...o, mix: op.mix, source: o.source.type === 'media' && op.sourceIn !== undefined ? { ...o.source, in: Math.max(0, op.sourceIn) } : o.source },
        ),
      };

    case 'set_grade': {
      const grades = { ...(t.grades ?? {}) };
      if (op.grade) grades[op.assetId] = normalizeGradeLut(op.grade);
      else delete grades[op.assetId];
      return { ...t, grades };
    }

    case 'set_captions':
      return { ...t, captions: op.captions };

    case 'set_overlay_framing': {
      const o0 = t.overlays.find((o) => o.id === op.id);
      if (!o0 || o0.source.type !== 'media') throw new OpError('set_overlay_framing: overlay de mídia não encontrado');
      const f = op.framing === null ? null : normalizeFraming({ ...(o0.framing ?? DEFAULT_FRAMING), ...op.framing });
      return {
        ...t,
        overlays: t.overlays.map((o) => {
          if (o.id !== op.id) return o;
          const { framing: _drop, ...rest } = o;
          return f && !isDefaultFraming(f) ? { ...rest, framing: f } : rest;
        }),
      };
    }
    case 'set_overlay_speed': {
      if (op.speed !== undefined && op.speed !== null && !(op.speed >= 0.25 && op.speed <= 4)) throw new OpError('set_overlay_speed: velocidade entre 0,25 e 4');
      if (op.freeze !== undefined && op.freeze !== null && !(op.freeze >= 0 && op.freeze <= 10)) throw new OpError('set_overlay_speed: congelamento entre 0 e 10 s');
      if (!t.overlays.some((o) => o.id === op.id && o.source.type === 'media')) throw new OpError('set_overlay_speed: overlay de mídia não encontrado');
      return {
        ...t,
        overlays: t.overlays.map((o) => {
          if (o.id !== op.id) return o;
          const next: OverlayItem = { ...o };
          if (op.speed !== undefined) {
            if (op.speed === null || Math.abs(op.speed - 1) < 1e-6) delete next.speed;
            else next.speed = Math.round(op.speed * 10000) / 10000;
          }
          if (op.freeze !== undefined) {
            if (op.freeze === null || op.freeze <= 0) delete next.freeze;
            else next.freeze = Math.round(op.freeze * 1000) / 1000;
          }
          return next;
        }),
      };
    }
    case 'set_overlay_text':
      return { ...t, overlays: t.overlays.map((o) => (o.id === op.id && o.source.type === 'text' ? { ...o, source: { type: 'text' as const, text: op.text } } : o)) };
    case 'set_overlay_motion':
      if (!t.overlays.some((o) => o.id === op.id && o.source.type === 'motion')) throw new OpError('motion não encontrado');
      return { ...t, overlays: t.overlays.map((o) => (o.id === op.id ? { ...o, by: by === 'human' ? by : o.by, source: { type: 'motion' as const, motion: op.motion } } : o)) };
    case 'set_overlay_lettering':
      if (!t.overlays.some((o) => o.id === op.id && o.role === 'lettering')) throw new OpError('lettering não encontrado');
      return { ...t, overlays: t.overlays.map((o) => (o.id === op.id ? { ...o, by: by === 'human' ? by : o.by, source: { type: 'lettering' as const, lettering: op.lettering } } : o)) };
    case 'set_overlay_sfx':
      if (!t.overlays.some((o) => o.id === op.id)) throw new OpError('overlay não encontrado');
      return { ...t, overlays: t.overlays.map((o) => (o.id === op.id ? { ...o, sfx: op.sfx } : o)) };
    case 'set_lettering_ref': {
      const { letteringRef: _drop, ...rest } = t;
      return op.refId ? { ...rest, letteringRef: op.refId } : rest;
    }
    case 'fix_words': {
      let fixes = [...(t.wordFixes ?? [])];
      for (const f of op.fixes) {
        fixes = fixes.filter((x) => !(x.assetId === f.assetId && Math.abs(x.at - f.at) < 0.02));
        if (f.text.trim()) fixes.push({ assetId: f.assetId, at: f.at, text: f.text.trim() });
      }
      return { ...t, wordFixes: fixes };
    }
    case 'edit_captions': {
      let list = [...(t.captionEdits ?? [])];
      for (const ed of op.edits) {
        const same = (e: { assetId: string; at: number }) => e.assetId === ed.assetId && Math.abs(e.at - ed.at) < 0.02;
        const prev = list.find(same);
        list = list.filter((e) => !same(e));
        if (!ed.patch) continue;
        const merged: Record<string, unknown> = { ...prev, ...ed.patch, assetId: ed.assetId, at: prev?.at ?? ed.at };
        // Campo zerado (null/false) sai; ajuste sem nada vira automático de novo.
        for (const k of ['text', 'hidden', 'force', 'split', 'join']) if (merged[k] === undefined || merged[k] === null || merged[k] === false) delete merged[k];
        if (merged.text !== undefined || merged.hidden || merged.force || merged.split || merged.join) list.push(merged as unknown as CaptionEdit);
      }
      return { ...t, captionEdits: list };
    }
    case 'set_motion_sfx':
      return { ...t, motionSfxDb: Math.max(-24, Math.min(12, op.gainDb)) };
    case 'set_track_state': {
      const cur = { ...(t.trackState?.[op.trackId] ?? {}), ...op.patch };
      for (const k of Object.keys(cur) as (keyof typeof cur)[]) if (!cur[k]) delete cur[k];
      const all = { ...(t.trackState ?? {}) };
      if (Object.keys(cur).length) all[op.trackId] = cur;
      else delete all[op.trackId];
      const { trackState: _drop, ...rest } = t;
      return Object.keys(all).length ? { ...rest, trackState: all } : rest;
    }
    case 'set_voice_chain': {
      const { voiceChain: _drop, ...rest } = t;
      return op.on ? { ...rest, voiceChain: true } : rest;
    }
    case 'set_voice_denoise': {
      const { voiceDenoise: _drop, ...rest } = t;
      const mix = Math.round(Math.max(0, Math.min(1, op.amount)) * 100) / 100;
      return mix > 0 ? { ...rest, voiceDenoise: mix } : rest;
    }
    case 'set_motion_ref': {
      const { motionRef: _drop, ...rest } = t;
      return op.refId ? { ...rest, motionRef: op.refId } : rest;
    }
  }
}

/** Junta clipes vizinhos que são continuação exata um do outro na fonte. */
export function coalesce(main: Clip[]): Clip[] {
  const out: Clip[] = [];
  for (const c of main) {
    const prev = out[out.length - 1];
    const same = (a: Clip, b: Clip) => (a.zoom ?? 1) === (b.zoom ?? 1) && a.zoomTo === b.zoomTo && !b.flash && clipSpeed(a) === clipSpeed(b) && !a.freeze && a.cam === b.cam && a.framing?.x === b.framing?.x && a.framing?.y === b.framing?.y;
    if (prev && prev.assetId === c.assetId && Math.abs(prev.out - c.in) < 1e-3 && same(prev, c)) {
      out[out.length - 1] = { ...prev, out: c.out };
    } else out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regras editoriais (canvas: "nunca o mesmo B-roll ou o mesmo motion mais de 2 vezes")
// ---------------------------------------------------------------------------

export interface EditorialWarning {
  level: 'erro' | 'aviso';
  message: string;
  overlayIds: string[];
}

export const MAX_REPEAT = 2;
/** Referência do Cérebro do Editor: insert de B-roll com menos de ~3,3 s vira "pisca". */
export const MIN_BROLL: Seconds = 3.3;

export function overlayKey(o: OverlayItem): string | null {
  if (o.source.type === 'media') return `media:${o.source.assetId}`;
  if (o.source.type === 'composition') return `comp:${o.source.compositionId}`;
  // "Nunca o mesmo motion mais de 2×": o mesmo template (mecanismo visual) conta como o mesmo motion.
  if (o.source.type === 'motion') return `motion:${o.source.motion.template}`;
  return null;
}

export function editorialWarnings(t: Timeline, assetName: (id: string) => string = (id) => id): EditorialWarning[] {
  const tl = normalizeTimeline(t);
  const out: EditorialWarning[] = [];
  const uses = new Map<string, OverlayItem[]>();
  for (const o of tl.overlays) {
    if (o.role !== 'broll' && o.role !== 'motion') continue;
    const k = overlayKey(o);
    if (k) uses.set(k, [...(uses.get(k) ?? []), o]);
  }
  for (const [k, items] of uses) {
    if (items.length > MAX_REPEAT) {
      const name = k.startsWith('media:') ? assetName(k.slice(6)) : k.startsWith('motion:') ? `Motion ${MOTION_TEMPLATES[k.slice(7) as MotionTemplateId]?.label ?? k.slice(7)}` : k.slice(5);
      out.push({ level: 'erro', message: `"${name}" usado ${items.length}× — o limite é ${MAX_REPEAT}× para não ficar repetitivo`, overlayIds: items.map((i) => i.id) });
    }
  }
  for (const o of tl.overlays) {
    if (resolveOverlay(tl, o) === null) out.push({ level: 'aviso', message: 'Overlay órfão: o trecho de fala onde ele estava foi cortado', overlayIds: [o.id] });
    else if (o.role === 'broll' && o.duration < MIN_BROLL) out.push({ level: 'aviso', message: `B-roll de ${o.duration.toFixed(1)}s — abaixo de ${MIN_BROLL}s vira "pisca"`, overlayIds: [o.id] });
  }
  return out;
}

export function formatTime(s: Seconds, withMs = false): string {
  const sign = s < 0 ? '-' : '';
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const whole = Math.floor(sec);
  const base = `${sign}${m}:${String(whole).padStart(2, '0')}`;
  return withMs ? `${base}.${String(Math.round((sec - whole) * 1000)).padStart(3, '0')}` : base;
}

/** Trilha que guarda os SFX dos motions/letterings (sintetizados): o mudo da A2 vale para eles também. */
export const MOTION_SFX_TRACK = 'A2';

/** O overlay aparece/soa? (trilha oculta some da imagem; trilha muda some do som) */
export function overlayActive(t: Timeline, o: OverlayItem): boolean {
  const st = t.trackState?.[o.trackId];
  if (!st) return true;
  const audio = o.role === 'music' || o.role === 'sfx';
  return audio ? !st.muted : !st.hidden;
}

export function trackFlag(t: Timeline, trackId: string, flag: 'hidden' | 'muted' | 'locked'): boolean {
  return !!t.trackState?.[trackId]?.[flag];
}

/**
 * Fim do corte (clipe da trilha principal) que contém o instante `t` — para motion e B-roll irem até o corte
 * (regra do Thales: parar no meio do clipe fica mal acabado). Em cima de um corte, devolve o fim do próximo.
 */
export function cutEndAfter(t: Timeline, at: Seconds): Seconds {
  const starts = clipStarts(t);
  for (let i = 0; i < t.main.length; i++) {
    const end = starts[i]! + clipDuration(t.main[i]!);
    if (at < end - 0.02) return end;
  }
  return starts.length ? starts[starts.length - 1]! + clipDuration(t.main[t.main.length - 1]!) : at;
}

// --- Enquadramento do B-roll (CH-0003) ---------------------------------------------------------

export const DEFAULT_FRAMING: import('./types.ts').OverlayFraming = { x: 0.5, y: 0.5, zoom: 1 };
export const MAX_FRAMING_ZOOM = 4;
/** Teto do zoom de clipe (`set_zoom`), o mesmo do enquadramento de B-roll. */
export const MAX_CLIP_ZOOM = MAX_FRAMING_ZOOM;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function normalizeFraming(f: Partial<import('./types.ts').OverlayFraming>): import('./types.ts').OverlayFraming {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return { x: r4(clamp01(num(f.x, 0.5))), y: r4(clamp01(num(f.y, 0.5))), zoom: r4(Math.min(MAX_FRAMING_ZOOM, Math.max(1, num(f.zoom, 1)))) };
}

export function isDefaultFraming(f: import('./types.ts').OverlayFraming): boolean {
  return f.x === 0.5 && f.y === 0.5 && f.zoom === 1;
}

/**
 * Recorte de uma fonte `sw`×`sh` que preenche o quadro `W`×`H` ("cover"), com centro e zoom: frações da
 * fonte (u0, v0 = canto superior esquerdo; kx, ky = largura e altura). O mesmo número no export (FFmpeg
 * crop) e no preview (WebGL), para o quadro sair igual nos dois. O recorte nunca sai da fonte: centro
 * perto da borda encosta na borda.
 */
export function coverCrop(sw: number, sh: number, W: number, H: number, framing?: Partial<import('./types.ts').OverlayFraming> | null): { u0: number; v0: number; kx: number; ky: number } {
  const f = normalizeFraming(framing ?? {});
  const ar = sw / sh;
  const AR = W / H;
  const kx = Math.min(1, AR / ar) / f.zoom;
  const ky = Math.min(1, ar / AR) / f.zoom;
  const cx = Math.min(1 - kx / 2, Math.max(kx / 2, f.x));
  const cy = Math.min(1 - ky / 2, Math.max(ky / 2, f.y));
  return { u0: cx - kx / 2, v0: cy - ky / 2, kx, ky };
}

// --- Velocidade e congelamento do B-roll (CH-0004) ----------------------------------------------

/** Quanto da fonte o overlay toca antes de congelar (s de fonte) e por quanto tempo da timeline ele anda. */
export function overlayPlayback(o: Pick<OverlayItem, 'duration' | 'speed' | 'freeze'>, duration = o.duration): { speed: number; moving: Seconds; frozen: Seconds; sourceSpan: Seconds } {
  const speed = o.speed && o.speed > 0 ? o.speed : 1;
  const frozen = Math.min(Math.max(0, o.freeze ?? 0), duration);
  const moving = Math.max(0, duration - frozen);
  return { speed, moving, frozen, sourceSpan: moving * speed };
}

/** Instante da fonte mostrado `local` s depois do início do overlay (com velocidade e congelamento). */
export function overlaySourceTime(o: Pick<OverlayItem, 'duration' | 'speed' | 'freeze' | 'source'>, local: Seconds): Seconds {
  const srcIn = o.source.type === 'media' ? o.source.in : 0;
  const { speed, moving } = overlayPlayback(o);
  return srcIn + Math.min(Math.max(0, local), moving) * speed;
}
