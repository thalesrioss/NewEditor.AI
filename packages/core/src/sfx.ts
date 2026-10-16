/**
 * SFX dos motions — foley sintetizado em código, um efeito por ação/transformação (regra do Motion Studio).
 * Receitas portadas do `sound.py` dos filmes do Motion Studio (whoosh, stamp, type_key, marker, clock_tick…).
 *
 * Tudo aqui é função pura e determinística (ruído com semente): o player toca exatamente as mesmas amostras
 * que o export mixa. `motionCues` deriva os efeitos dos MESMOS tempos que desenham o motion (motion.ts).
 */
import { mulberry32, type MotionSpec } from './motion.ts';

export const SFX_RATE = 48000;

export type SfxKind = 'whoosh' | 'swoosh' | 'stamp' | 'paper' | 'type' | 'marker' | 'tick' | 'thud' | 'impact' | 'riser' | 'boom' | 'tape' | 'ding' | 'pop' | 'shutter' | 'chalk' | 'crumple' | 'rip' | 'coin' | 'slap';

export interface SfxCue {
  /** Segundos desde o início do motion. */
  t: number;
  kind: SfxKind;
  /** Ganho linear (o som sai normalizado em pico 0,95). */
  gain: number;
  /** Duração, para os sons que esticam (whoosh, papel, marcador, riser). */
  len?: number;
  pitch?: number;
  /** −1 (esquerda) a 1 (direita). */
  pan?: number;
  /** whoosh/swoosh: 'out' desce de agudo para grave. */
  dir?: 'in' | 'out';
  seed: number;
}

/** De onde saem as amostras: foley sintetizado (sempre disponível) ou a biblioteca do CinePRO (nuvem, com cache). */
export type SfxBank = 'sintetizado' | 'cinepro';

/**
 * Cada efeito sintetizado tem um conceito equivalente na biblioteca do CinePRO: termos de busca (nome, pasta, tags)
 * e a duração que cabe. O agente escolhe uma amostra real determinística por `seed`; sem rede ou sem acerto, usa a síntese.
 */
export const SFX_CONCEPTS: Record<SfxKind, { termos: string[]; min: number; max: number; evita?: string[] }> = {
  whoosh: { termos: ['whoosh', 'woosh'], min: 0.15, max: 1.2, evita: ['weapon', 'gun', 'missile', 'torpedo', 'submarine', 'underwater', 'sword', 'arrow', 'magic', 'horror'] },
  swoosh: { termos: ['swoosh', 'swish', 'whoosh'], min: 0.1, max: 0.8, evita: ['weapon', 'gun', 'missile', 'torpedo', 'sword', 'magic', 'horror'] },
  stamp: { termos: ['stamp', 'slam', 'hit'], min: 0.1, max: 1.0, evita: ['timestamp', 'gun', 'weapon', 'glass', 'metal'] },
  paper: { termos: ['paper slide', 'paper', 'page'], min: 0.2, max: 1.2 },
  type: { termos: ['typewriter', 'keyboard', 'key press', 'type'], min: 0.05, max: 0.3 },
  marker: { termos: ['marker', 'pen', 'writing', 'scribble'], min: 0.2, max: 1.0 },
  tick: { termos: ['tick', 'click', 'clock'], min: 0.03, max: 0.3 },
  thud: { termos: ['thud', 'thump', 'drop'], min: 0.1, max: 1.0, evita: ['body', 'gore', 'horror', 'bass drop'] },
  impact: { termos: ['impact', 'hit'], min: 0.3, max: 2.5, evita: ['glass', 'weapon', 'gun', 'horror', 'scream'] },
  riser: { termos: ['riser', 'rise', 'build'], min: 1.0, max: 4.0 },
  boom: { termos: ['boom', 'sub', 'deep', 'braam'], min: 0.5, max: 3.0 },
  tape: { termos: ['tape', 'duct', 'adhesive'], min: 0.1, max: 0.8, evita: ['measure', 'cassette', 'vhs', 'recorder', 'deck', 'rewind'] },
  ding: { termos: ['ding', 'bell', 'chime'], min: 0.2, max: 1.5 },
  pop: { termos: ['pop', 'bubble', 'plop'], min: 0.05, max: 0.5 },
  shutter: { termos: ['shutter', 'camera', 'photo'], min: 0.05, max: 0.6 },
  chalk: { termos: ['chalk', 'chalkboard', 'blackboard'], min: 0.2, max: 1.5 },
  crumple: { termos: ['crumple', 'paper crush', 'crush'], min: 0.3, max: 1.5 },
  rip: { termos: ['rip', 'tear'], min: 0.1, max: 1.0 },
  coin: { termos: ['coin', 'coins', 'money'], min: 0.1, max: 1.0 },
  slap: { termos: ['slap', 'smack', 'hit'], min: 0.05, max: 0.6 },
};

/**
 * Dá a uma amostra real (mono) a mesma forma do foley sintetizado: corta na duração do efeito (`len` ou o teto do
 * conceito) com fade de saída, e normaliza em pico 0,95 × ganho. Igual no preview e no export.
 */
export function shapeSfxSample(x: Float32Array, c: SfxCue, sr = SFX_RATE): Float32Array {
  const want = Math.min(x.length, Math.max(1, Math.round((c.len ?? SFX_CONCEPTS[c.kind].max) * sr)));
  const y = x.slice(0, want);
  const fade = Math.min(y.length, Math.round(sr * Math.min(0.08, (c.len ?? 1) * 0.3)));
  for (let i = 0; i < fade; i++) y[y.length - 1 - i]! *= i / fade;
  let peak = 0;
  for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]!));
  const g = peak > 0 ? (0.95 / peak) * c.gain : 0;
  for (let i = 0; i < y.length; i++) y[i]! *= g;
  return y;
}

export const SFX_LABEL: Record<SfxKind, string> = {
  chalk: 'giz no quadro',
  crumple: 'papel amassado',
  rip: 'rasgo',
  coin: 'moeda',
  slap: 'tapa na mesa',
  whoosh: 'whoosh',
  swoosh: 'swoosh (corte)',
  stamp: 'carimbo no papel',
  paper: 'papel deslizando',
  type: 'máquina de escrever',
  marker: 'marcador no papel',
  tick: 'tique do contador',
  thud: 'baque',
  impact: 'impacto',
  riser: 'subida de tensão',
  boom: 'boom grave',
  tape: 'fita adesiva',
  ding: 'sino do contador',
  pop: 'pop',
  shutter: 'Obturador',
};

// ---------------------------------------------------------------------------
// Efeitos de cada motion (os mesmos tempos da animação)
// ---------------------------------------------------------------------------

const OUT = 0.35;

export function motionCues(spec: MotionSpec, dur: number): SfxCue[] {
  if (spec.sfx === false) return [];
  const c: SfxCue[] = [];
  let k = 0;
  const add = (t: number, kind: SfxKind, gain: number, extra: Partial<SfxCue> = {}) => {
    if (t < dur + 0.05) c.push({ t: Math.max(0, +t.toFixed(4)), kind, gain, seed: spec.seed * 31 + k++, ...extra });
  };
  const b = spec.beats;
  const exitAt = dur - OUT;
  switch (spec.template) {
    case 'palavra': {
      const b0 = b[0] ?? 0.2;
      const golpe = spec.funcao === 'reveal';
      add(b0 - 0.2, 'whoosh', 0.5, { len: 0.5 });
      add(b0 + 0.06, 'impact', golpe ? 0.85 : 0.55);
      add(b0 + 0.3, 'marker', 0.22, { len: 0.45 }); // a régua de acento se desenhando
      if (spec.texts[1]) add((b[1] ?? b0 + 0.7) - 0.02, 'paper', 0.2, { len: 0.4 });
      add(exitAt, 'whoosh', 0.28, { len: 0.35, dir: 'out' });
      break;
    }
    case 'pergunta': {
      const last = b[b.length - 1] ?? 1;
      add(0, 'boom', 0.4); // o "?" gigante cresce
      add(0, 'riser', 0.32, { len: Math.min(dur, last + 0.35) });
      b.forEach((t, i) => i !== spec.key && add(t - 0.02, 'tick', 0.16, { pitch: 0.9 + 0.08 * (i % 4), pan: -0.15 + 0.1 * (i % 3) }));
      if (spec.key !== undefined) add((b[spec.key] ?? last) + 0.04, 'impact', 0.7);
      add(exitAt, 'whoosh', 0.28, { len: 0.35, dir: 'out' });
      break;
    }
    case 'contraste': {
      const tA = b[0] ?? 0.2;
      const tB = b[1] ?? tA + 1;
      add(tA - 0.18, 'whoosh', 0.42, { len: 0.45, pan: -0.25 });
      add(tA + 0.08, 'thud', 0.4, { pan: -0.2 });
      if (spec.variant === 'negacao') add(tB - 0.1, 'marker', 0.5, { len: 0.34 }); // o risco
      else add(tB - 0.18, 'whoosh', 0.42, { len: 0.45, pan: 0.25 });
      add(tB + 0.06, 'impact', 0.72, { pan: 0.15 });
      add(exitAt, 'whoosh', 0.28, { len: 0.35, dir: 'out' });
      break;
    }
    case 'numero': {
      const tN = b[0] ?? 0.3;
      add(0, 'swoosh', 0.5, { len: 0.38 });
      // O contador desacelera como a curva da animação (outCubic): tiques densos no começo, espaçados no fim.
      const n = 12;
      for (let i = 1; i < n; i++) add(tN - 0.25 + 0.9 * (1 - Math.cbrt(1 - i / n)), 'tick', 0.22, { pitch: 0.85 + 0.5 * (i / n) });
      add(tN + 0.65, 'ding', 0.32);
      add(tN + 0.65, 'impact', 0.5);
      add(exitAt, 'swoosh', 0.42, { len: 0.36, dir: 'out' });
      break;
    }
    case 'lista': {
      add(0, 'swoosh', 0.5, { len: 0.38 });
      b.forEach((t, i) => {
        const pan = ((i % 3) - 1) * 0.25;
        add(t + 0.07, 'stamp', 0.6, { pan });
        add(t + 0.13, 'tape', 0.2, { pan });
      });
      add(exitAt, 'swoosh', 0.42, { len: 0.36, dir: 'out' });
      break;
    }
    case 'citacao': {
      add(0, 'paper', 0.45, { len: 0.55 });
      add(0.42, 'tape', 0.24, { pan: -0.35 });
      add(0.5, 'tape', 0.22, { pan: 0.35 });
      b.forEach((t, i) => {
        // Uma rajada curta por palavra (2–3 batidas), como tipos batendo no papel.
        const strikes = Math.min(3, Math.max(1, Math.ceil((spec.texts[i]?.length ?? 3) / 3)));
        for (let j = 0; j < strikes; j++) add(t + j * 0.036, 'type', 0.5 - j * 0.1, { pitch: 0.92 + 0.06 * ((i + j) % 3), pan: -0.2 + 0.4 * ((i * 7 + j) % 5) / 4 });
      });
      if (spec.key !== undefined) add((b[spec.key] ?? 0) + 0.15, 'marker', 0.38, { len: 0.42 });
      add(exitAt, 'paper', 0.3, { len: 0.35 });
      break;
    }
  }
  return c.sort((x, y) => x.t - y.t);
}

// ---------------------------------------------------------------------------
// DSP mínimo (biquads RBJ, ruído com semente)
// ---------------------------------------------------------------------------

type Buf = Float32Array;

function noise(n: number, rnd: () => number): Buf {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    // Box-Muller: gaussiano como o rng.standard_normal do sound.py
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    const m = Math.sqrt(-2 * Math.log(u));
    x[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) x[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return x;
}

function coeffs(type: 'lp' | 'hp' | 'bp', f: number, q: number, sr: number): [number, number, number, number, number] {
  const w0 = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cs = Math.cos(w0);
  const al = Math.sin(w0) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'lp') [b0, b1, b2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
  else if (type === 'hp') [b0, b1, b2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
  else [b0, b1, b2] = [al, 0, -al];
  const a0 = 1 + al;
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cs) / a0, (1 - al) / a0];
}

function biquad(x: Buf, type: 'lp' | 'hp' | 'bp', f: number, q: number, sr: number): Buf {
  const [b0, b1, b2, a1, a2] = coeffs(type, f, q, sr);
  const y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i]!;
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
const lp = (x: Buf, f: number, sr: number) => biquad(x, 'lp', f, Math.SQRT1_2, sr);
const hp = (x: Buf, f: number, sr: number) => biquad(x, 'hp', f, Math.SQRT1_2, sr);
/** Passa-banda de 4ª ordem (duas seções), como o butter(2, [lo, hi], 'band') do sound.py. */
function bp(x: Buf, lo: number, hi: number, sr: number): Buf {
  const f0 = Math.sqrt(lo * hi);
  const q = f0 / Math.max(1, hi - lo);
  return biquad(biquad(x, 'bp', f0, q, sr), 'bp', f0, q, sr);
}

/** Passa-banda cujo centro desliza f0 → f1 (coeficientes por bloco, estado contínuo). */
function sweepBp(x: Buf, f0: number, f1: number, q: number, sr: number): Buf {
  const y = new Float32Array(x.length);
  const st = [0, 0, 0, 0, 0, 0, 0, 0];
  const blk = 256;
  for (let s = 0; s < x.length; s += blk) {
    const k = s / Math.max(1, x.length - 1);
    const f = f0 * Math.pow(f1 / f0, k);
    const [b0, b1, b2, a1, a2] = coeffs('bp', f, q, sr);
    for (let i = s; i < Math.min(x.length, s + blk); i++) {
      // duas seções em cascata
      let v = b0 * x[i]! + b1 * st[0]! + b2 * st[1]! - a1 * st[2]! - a2 * st[3]!;
      st[1] = st[0]!;
      st[0] = x[i]!;
      st[3] = st[2]!;
      st[2] = v;
      const w = b0 * v + b1 * st[4]! + b2 * st[5]! - a1 * st[6]! - a2 * st[7]!;
      st[5] = st[4]!;
      st[4] = v;
      st[7] = st[6]!;
      st[6] = w;
      v = w;
      y[i] = v;
    }
  }
  return y;
}

const sec = (s: number, sr: number) => Math.max(1, Math.round(s * sr));
function env(n: number, sr: number, a: number, r: number, hold = 0): Buf {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / sr;
    e[i] = Math.min(1, x / Math.max(a, 1e-4)) * (x < a + hold ? 1 : Math.exp(-(x - a - hold) / r));
  }
  return e;
}
function hann(n: number): Buf {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1));
  return e;
}
const mul = (a: Buf, b: Buf, g = 1) => {
  const n = Math.min(a.length, b.length);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = a[i]! * b[i]! * g;
  return y;
};
function sum(n: number, ...xs: Buf[]): Buf {
  const y = new Float32Array(n);
  for (const x of xs) for (let i = 0; i < Math.min(n, x.length); i++) y[i] = y[i]! + x[i]!;
  return y;
}
function sine(n: number, sr: number, f: number | ((t: number) => number), g = 1): Buf {
  const y = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * (typeof f === 'number' ? f : f(i / sr))) / sr;
    y[i] = Math.sin(ph) * g;
  }
  return y;
}
function fadeIO(x: Buf, sr: number, fi: number, fo: number): Buf {
  const a = Math.min(Math.round(fi * sr), x.length >> 1);
  const b = Math.min(Math.round(fo * sr), x.length >> 1);
  for (let i = 0; i < a; i++) x[i]! *= i / a;
  for (let i = 0; i < b; i++) x[x.length - 1 - i]! *= i / b;
  return x;
}

// ---------------------------------------------------------------------------
// Biblioteca de foley
// ---------------------------------------------------------------------------

function render(c: SfxCue, sr: number): Buf {
  const rnd = mulberry32(c.seed);
  const N = (s: number) => noise(sec(s, sr), rnd);
  const p = c.pitch ?? 1;
  switch (c.kind) {
    case 'whoosh': {
      const L = c.len ?? 0.45;
      const [f0, f1] = c.dir === 'out' ? [3200, 350] : [300, 3200];
      return mul(sweepBp(N(L), f0, f1, 3, sr), hann(sec(L, sr)), 0.7);
    }
    case 'swoosh': {
      const L = c.len ?? 0.38;
      const n = sec(L, sr);
      const [f0, f1] = c.dir === 'out' ? [5000, 450] : [450, 5000];
      return sum(n, mul(sweepBp(N(L), f0, f1, 2.4, sr), hann(n), 0.8), mul(lp(N(L), 320, sr), hann(n), 0.3));
    }
    case 'stamp': {
      const n = sec(0.6, sr);
      return sum(n, mul(sine(n, sr, 85 * p), env(n, sr, 0.001, 0.07)), mul(bp(N(0.6), 300, 1500, sr), env(n, sr, 0.0005, 0.03), 0.8), mul(hp(N(0.6), 3000, sr), env(n, sr, 0.0005, 0.015), 0.4));
    }
    case 'paper': {
      const L = c.len ?? 0.6;
      return mul(bp(N(L), 1800, 6000, sr), hann(sec(L, sr)), 0.35);
    }
    case 'type': {
      const n = sec(0.12, sr);
      const strike = mul(bp(N(0.12), 1800 * p, 7000, sr), env(n, sr, 0.0003, 0.006), 1.1);
      const body = sum(n, mul(bp(N(0.12), 300, 1200, sr), env(n, sr, 0.0005, 0.025), 0.6), mul(sine(n, sr, 180 * p), env(n, sr, 0.0005, 0.02), 0.3));
      return sum(n, strike, body);
    }
    case 'marker': {
      const L = c.len ?? 0.4;
      const n = sec(L, sr);
      const wob = new Float32Array(n);
      for (let i = 0; i < n; i++) wob[i] = 0.6 + 0.4 * Math.sin((2 * Math.PI * 23 * i) / sr);
      return fadeIO(mul(bp(N(L), 2500, 6000, sr), wob, 0.35), sr, 0.02, 0.05);
    }
    case 'tick': {
      const n = sec(0.12, sr);
      return sum(n, mul(bp(N(0.12), 3000 * p, 8000, sr), env(n, sr, 0.0002, 0.004)), mul(sine(n, sr, 900 * p), env(n, sr, 0.0005, 0.02), 0.5), mul(bp(N(0.12), 500, 1400, sr), env(n, sr, 0.0005, 0.03), 0.5));
    }
    case 'thud': {
      const n = sec(0.3, sr);
      return sum(n, mul(sine(n, sr, 70), env(n, sr, 0.001, 0.05), 0.8), mul(bp(N(0.3), 200, 1200, sr), env(n, sr, 0.0005, 0.02), 0.4));
    }
    case 'impact': {
      // Golpe: grave que cai de tom + estalo + cauda de ar.
      const n = sec(0.9, sr);
      return sum(
        n,
        mul(sine(n, sr, (t) => 42 + 60 * Math.exp(-t * 9)), env(n, sr, 0.002, 0.22), 1),
        mul(bp(N(0.9), 150, 1200, sr), env(n, sr, 0.0005, 0.03), 0.6),
        mul(hp(N(0.9), 4000, sr), env(n, sr, 0.0003, 0.01), 0.35),
        mul(lp(N(0.9), 250, sr), env(n, sr, 0.003, 0.18), 0.4),
      );
    }
    case 'riser': {
      const L = Math.max(0.3, c.len ?? 1.5);
      const n = sec(L, sr);
      const ramp = new Float32Array(n);
      for (let i = 0; i < n; i++) ramp[i] = Math.pow(i / n, 2);
      return fadeIO(sum(n, mul(sweepBp(N(L), 200, 4000, 4, sr), ramp, 0.5), mul(sine(n, sr, (t) => 180 + 500 * (t / L)), ramp, 0.08)), sr, 0.01, 0.06);
    }
    case 'boom': {
      const n = sec(1.3, sr);
      return sum(n, mul(sine(n, sr, (t) => 28 + 55 * Math.exp(-t * 0.6)), env(n, sr, 0.005, 0.5), 0.9), mul(lp(N(1.3), 200, sr), env(n, sr, 0.002, 0.25), 0.6));
    }
    case 'tape': {
      const n = sec(0.15, sr);
      return mul(bp(N(0.15), 400, 3000, sr), env(n, sr, 0.0005, 0.02), 0.9);
    }
    case 'pop': {
      // "Pop standard": bolha curta — tom que cai rápido + clique.
      const n = sec(0.18, sr);
      return sum(n, mul(sine(n, sr, (t) => (300 + 700 * Math.exp(-t * 60)) * p), env(n, sr, 0.0008, 0.035), 1), mul(hp(N(0.18), 2500, sr), env(n, sr, 0.0002, 0.004), 0.35));
    }
    case 'shutter': {
      // Obturador de câmera (o flash do padrão): clique seco + corpo mecânico curto + eco de ar.
      const n = sec(0.22, sr);
      return sum(n, mul(hp(N(0.22), 3500, sr), env(n, sr, 0.0002, 0.006), 1), mul(bp(N(0.22), 900, 2600, sr), env(n, sr, 0.0006, 0.03), 0.7), mul(sine(n, sr, (t) => 180 + 120 * Math.exp(-t * 40)), env(n, sr, 0.001, 0.05), 0.5), mul(bp(N(0.22), 1500, 5000, sr), env(n, sr, 0.03, 0.09), 0.18));
    }
    case 'chalk': {
      // giz riscando o quadro: ruído alto, granulado, com oscilação da mão
      const L = c.len ?? 0.5;
      const n = sec(L, sr);
      const wob = new Float32Array(n);
      for (let i = 0; i < n; i++) wob[i] = 0.5 + 0.5 * Math.abs(Math.sin((2 * Math.PI * 9 * i) / sr + c.seed));
      return fadeIO(mul(bp(N(L), 3000, 9000, sr), wob, 0.4), sr, 0.03, 0.06);
    }
    case 'crumple': {
      // papel amassado: estalos em rajada, decaindo
      const L = c.len ?? 0.55;
      const n = sec(L, sr);
      const gate = new Float32Array(n);
      for (let i = 0; i < n; i++) gate[i] = Math.pow(1 - i / n, 1.4) * (rnd() > 0.82 ? 1 : 0.12);
      return mul(bp(N(L), 1200, 7000, sr), gate, 0.9);
    }
    case 'rip': {
      // rasgo: ruído que sobe de tom e acaba seco
      const L = c.len ?? 0.3;
      return mul(sweepBp(N(L), 900, 4500, 2.2, sr), env(sec(L, sr), sr, 0.004, 0.12), 0.9);
    }
    case 'coin': {
      // moeda caindo: dois tons metálicos curtos
      const n = sec(0.5, sr);
      return sum(n, mul(sine(n, sr, 2900 * p), env(n, sr, 0.0005, 0.12), 0.5), mul(sine(n, sr, 4300 * p), env(n, sr, 0.0005, 0.07), 0.3), mul(hp(N(0.5), 5000, sr), env(n, sr, 0.0003, 0.01), 0.25));
    }
    case 'slap': {
      // objeto pousando na mesa: tapa surdo + corpo
      const n = sec(0.28, sr);
      return sum(n, mul(sine(n, sr, (t) => 140 + 90 * Math.exp(-t * 50)), env(n, sr, 0.001, 0.06), 0.9), mul(bp(N(0.28), 500, 2500, sr), env(n, sr, 0.0006, 0.025), 0.7), mul(hp(N(0.28), 4000, sr), env(n, sr, 0.0003, 0.008), 0.3));
    }
    case 'ding': {
      const n = sec(0.9, sr);
      return sum(n, mul(sine(n, sr, 1568 * p), env(n, sr, 0.001, 0.35), 0.35), mul(sine(n, sr, 3136 * p), env(n, sr, 0.001, 0.18), 0.15), mul(sine(n, sr, 4600 * p), env(n, sr, 0.001, 0.1), 0.07));
    }
  }
}

/** Amostras mono de um efeito, normalizadas em pico 0,95 × ganho do efeito. Determinístico. */
export function synthSfx(c: SfxCue, sr = SFX_RATE): Float32Array {
  const x = render(c, sr);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
  const g = peak > 0 ? (0.95 / peak) * c.gain : 0;
  for (let i = 0; i < x.length; i++) x[i]! *= g;
  return x;
}

/** Pan de potência constante (igual ao `place` do sound.py). */
export const panGains = (pan = 0): [number, number] => [Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2];

// ---------------------------------------------------------------------------
// Nível em relação à fala
// ---------------------------------------------------------------------------

/** Nível típico da fala (dBFS RMS) a partir do envelope de energia: o percentil 80 dos quadros com som. */
export function speechLevelDb(envelope: Float32Array): number {
  const v: number[] = [];
  for (let i = 0; i < envelope.length; i += 2) if (envelope[i]! > -70) v.push(envelope[i]!);
  if (!v.length) return -24;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length * 0.8)]!;
}

/** Ganho do barramento de SFX (dB): picos dos efeitos alguns dB abaixo dos picos da fala, + ajuste do editor. */
export function sfxBusDb(speechDb: number, userDb = 0): number {
  return Math.max(-40, Math.min(0, speechDb + 10 + userDb));
}

/** Nomes de cue do Motion Studio (film.js) → foley do produto. Desconhecido vira 'pop'. */
export function normalizeSfxKind(kind: string): SfxKind {
  const k = kind.toLowerCase();
  const map: Record<string, SfxKind> = {
    card: 'slap', photo: 'slap', paper: 'paper', thud: 'thud', chalk: 'chalk', tape_slap: 'tape', tape_rip: 'rip', tape: 'tape', marker: 'marker', strike: 'marker', pen: 'marker',
    coins: 'coin', coin: 'coin', typewriter: 'type', type: 'type', rip: 'rip', crumple: 'crumple', pop: 'pop', boom: 'boom', tick: 'tick', count: 'tick', flip: 'swoosh', whoosh: 'whoosh', swoosh: 'swoosh', drop: 'thud', stamp: 'stamp', shutter: 'shutter', ding: 'ding', impact: 'impact', riser: 'riser',
  };
  return map[k] ?? 'pop';
}
