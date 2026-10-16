/**
 * Decupagem — parte MEDIDA (determinística).
 *
 * Regras herdadas do Cérebro do Editor (memórias 04 e 06):
 *  - ASR não é fonte de tempo: os timestamps de palavra são contíguos e o silêncio mora DENTRO da palavra.
 *    Bordas saem da forma de onda (janela 20 ms, passo 10 ms), não do ASR.
 *  - Limiar se mede no próprio material (piso de ruído varia muito); guardar o PROCEDIMENTO, não o valor.
 *  - Onde a borda é corte DENTRO de fala contínua, não há onset para medir — o tempo da palavra serve.
 *  - Comparar intervalos por sobreposição, nunca por contenção.
 */
import { ENV_HOP } from '../config.ts';
import type { Word } from '../asr.ts';

export interface Range {
  start: number;
  end: number;
}

export interface Utterance extends Range {
  id: number;
  /** índice da primeira e da última palavra */
  from: number;
  to: number;
  text: string;
}

export interface Levels {
  floor: number;
  speech: number;
  thr: number;
}

export interface Analysis {
  levels: Levels;
  /** 1 = fala, por frame de 10 ms (já sem respiros/ruído isolados). */
  voiced: Uint8Array;
  /** Pausas (todas as regiões sem fala ≥ 80 ms). */
  pauses: Range[];
  /** Centro "sonoro" de cada palavra (média dos frames com fala dentro dela). */
  centers: number[];
  utterances: Utterance[];
  hints: string[];
  /** Palavras com mais núcleos silábicos na energia do que o texto tem: repetição escondida pelo ASR ("ningu… ninguém"). */
  suspects: { i: number; nuclei: number; expected: number }[];
}

export interface AnalyzeOptions {
  /** Pausa mínima que separa duas falas (s). */
  splitPause: number;
}

const DEFAULTS: AnalyzeOptions = { splitPause: 0.3 };

const t2f = (t: number) => Math.round(t / ENV_HOP);
const f2t = (f: number) => f * ENV_HOP;

export function percentile(arr: ArrayLike<number>, q: number): number {
  const a = Float32Array.from(arr).sort();
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]!;
}

export function measureLevels(env: Float32Array): Levels {
  const floor = percentile(env, 0.1);
  const speech = percentile(env, 0.9);
  const range = Math.max(0, speech - floor);
  // Respiro fica ~25–30 dB abaixo da fala: o limiar acompanha o nível da fala (no máx. 24 dB abaixo),
  // mas nunca desce até perto do piso de ruído (material ao vivo tem piso alto).
  const thr = Math.min(speech - 8, Math.max(floor + range * 0.35, speech - 24));
  return { floor, speech, thr };
}

/** Runs de valor `v` num array binário, em frames [a, b). */
function runsOf(bits: Uint8Array, v: number): [number, number][] {
  const out: [number, number][] = [];
  let a = -1;
  for (let i = 0; i <= bits.length; i++) {
    const on = i < bits.length && bits[i] === v;
    if (on && a < 0) a = i;
    if (!on && a >= 0) {
      out.push([a, i]);
      a = -1;
    }
  }
  return out;
}

export function voicing(env: Float32Array, thr: number): Uint8Array {
  const v = new Uint8Array(env.length);
  for (let i = 0; i < env.length; i++) v[i] = env[i]! > thr ? 1 : 0;
  // Fecha buracos < 80 ms (oclusivas, micro-pausas dentro da palavra).
  for (const [a, b] of runsOf(v, 0)) if (b - a < 8 && a > 0 && b < v.length) v.fill(1, a, b);
  // Remove estalos < 50 ms.
  for (const [a, b] of runsOf(v, 1)) if (b - a < 5) v.fill(0, a, b);
  return v;
}

/**
 * Trechos de fala para o ASR transcrever SEPARADOS.
 *
 * Por quê: transcrevendo o arquivo inteiro, o Whisper trata 3 tentativas da mesma frase como se ela
 * tivesse sido dita uma vez e espalha as palavras pelas tentativas — o texto não bate com o áudio
 * (no "Felicidade", o clipe que o ASR chamava de "não resolve." continha a frase inteira). Trecho a
 * trecho, o texto de cada um é exatamente o que tem nele, e o retake aparece como retake.
 */
export function speechChunks(env: Float32Array, opts: { gap?: number; maxLen?: number; pad?: number } = {}): Range[] {
  const gap = opts.gap ?? 0.35;
  const maxLen = opts.maxLen ?? 18;
  const pad = opts.pad ?? 0.12;
  const { thr } = measureLevels(env);
  const v = voicing(env, thr);
  // Runs de fala; junta os separados por menos de `gap`.
  let runs = runsOf(v, 1).map(([a, b]) => ({ start: f2t(a), end: f2t(b) }));
  const merged: Range[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < gap) last.end = r.end;
    else merged.push({ ...r });
  }
  runs = merged.filter((r) => r.end - r.start >= 0.12);
  // Trecho longo demais (fala corrida) é partido na maior pausa interna, para o ASR não "limpar" de novo.
  const split = (r: Range): Range[] => {
    if (r.end - r.start <= maxLen) return [r];
    let best = -1;
    let bestLen = 0;
    let a = -1;
    for (let f = t2f(r.start + 2); f <= t2f(r.end - 2); f++) {
      if (!v[f] && a < 0) a = f;
      if (v[f] && a >= 0) {
        if (f - a > bestLen) {
          bestLen = f - a;
          best = Math.round((a + f) / 2);
        }
        a = -1;
      }
    }
    if (best < 0) best = t2f((r.start + r.end) / 2);
    return [...split({ start: r.start, end: f2t(best) }), ...split({ start: f2t(best), end: r.end })];
  };
  const chunks = runs.flatMap(split);
  // Folga para o ASR ouvir o ataque e a cauda da palavra, sem invadir o trecho vizinho.
  return chunks.map((c, i) => {
    const prev = chunks[i - 1];
    const next = chunks[i + 1];
    return {
      start: Math.max(0, prev ? Math.max(c.start - pad, (prev.end + c.start) / 2) : c.start - pad),
      end: next ? Math.min(c.end + pad, (c.end + next.start) / 2) : c.end + pad,
    };
  });
}

export function normalizeToken(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function lcs(a: string[], b: string[]): number {
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Sílabas de uma palavra em português: grupos de vogais (ditongos contam uma). */
export function syllables(word: string): number {
  const w = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  const groups = w.match(/[aeiouy]+/g) ?? [];
  return groups.length;
}

export function analyze(words: Word[], env: Float32Array, opts: Partial<AnalyzeOptions> = {}): Analysis {
  const o = { ...DEFAULTS, ...opts };
  const levels = measureLevels(env);
  const voiced = voicing(env, levels.thr);

  // Centro sonoro de cada palavra: o meio do MAIOR trecho contínuo com som dentro do intervalo do ASR.
  // (Média de todos os frames seria puxada por ruído quando o ASR estica a palavra sobre um silêncio.)
  const centers = words.map((w) => {
    let best: [number, number] | null = null;
    let a = -1;
    const end = Math.min(voiced.length, t2f(w.end));
    for (let f = t2f(w.start); f <= end; f++) {
      const on = f < end && voiced[f] === 1;
      if (on && a < 0) a = f;
      if (!on && a >= 0) {
        if (!best || f - a > best[1] - best[0]) best = [a, f];
        a = -1;
      }
    }
    return best ? f2t((best[0] + best[1]) / 2) : (w.start + w.end) / 2;
  });

  // Regiões com energia mas sem nenhuma palavra perto = respiro / ruído / batida na mesa.
  // Elas não podem "quebrar" um silêncio em dois.
  const sorted = [...centers].sort((a, b) => a - b);
  const hasWordNear = (a: number, b: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < a) lo = mid + 1;
      else hi = mid;
    }
    return lo < sorted.length && sorted[lo]! <= b;
  };
  for (const [a, b] of runsOf(voiced, 1)) {
    if (!hasWordNear(f2t(a) - 0.15, f2t(b) + 0.15)) voiced.fill(0, a, b);
  }

  const pauses: Range[] = runsOf(voiced, 0)
    .filter(([a, b]) => b - a >= 8)
    .map(([a, b]) => ({ start: f2t(a), end: f2t(b) }));

  // Segmenta em falas nas pausas longas. A própria pausa é a borda: fim de uma fala = início da pausa.
  const splitPauses = pauses.filter((p) => p.end - p.start >= o.splitPause);
  const utterances: Utterance[] = [];
  let from = 0;
  let pi = 0;
  let prevPause: Range | undefined;
  for (let i = 0; i < words.length; i++) {
    const next = i + 1 < words.length ? centers[i + 1]! : Infinity;
    while (pi < splitPauses.length && splitPauses[pi]!.end <= centers[i]!) pi++;
    const p = splitPauses[pi];
    const pauseHere = p !== undefined && p.start >= centers[i]! - 0.05 && p.end <= next + 0.05 ? p : undefined;
    if (i === words.length - 1 || pauseHere) {
      const u = makeUtterance(utterances.length, from, i, words, voiced);
      if (prevPause) u.start = Math.max(prevPause.end, Math.min(u.start, u.end - 0.05));
      if (pauseHere) u.end = Math.min(u.end, pauseHere.start);
      if (u.end - u.start < 0.05) u.end = u.start + 0.05;
      utterances.push(u);
      from = i + 1;
      prevPause = pauseHere;
    }
  }

  // Núcleos silábicos: picos de energia dentro da palavra. "ninguém" tem 2; se a energia mostra 4 no espaço
  // dela, a pessoa tentou duas vezes e o ASR fundiu as tentativas numa palavra só.
  const suspects: Analysis['suspects'] = [];
  words.forEach((w, i) => {
    const expected = syllables(w.w);
    if (expected < 2 || w.end - w.start < 0.45) return;
    const a = t2f(w.start);
    const b = Math.min(env.length - 1, t2f(w.end));
    let nuclei = 0;
    let above = false;
    let peak = -Infinity;
    const gate = levels.thr + (levels.speech - levels.thr) * 0.35;
    for (let f = a; f <= b; f++) {
      const v = env[f]!;
      if (v > gate) {
        if (!above) ((above = true), (peak = v));
        else peak = Math.max(peak, v);
      } else if (above) {
        above = false;
        if (peak > gate + 3) nuclei++;
      }
    }
    if (above && peak > gate + 3) nuclei++;
    if (nuclei >= Math.max(3, Math.round(expected * 1.8))) suspects.push({ i, nuclei, expected });
  });
  const hints = retakeHints(utterances, words);
  for (const s of suspects) hints.push(`#${s.i} "${words[s.i]!.w}": ${s.nuclei} núcleos de energia para ${s.expected} sílabas — possível repetição fundida pelo ASR`);
  return { levels, voiced, pauses, centers, utterances, hints, suspects };
}

function makeUtterance(id: number, from: number, to: number, words: Word[], voiced: Uint8Array): Utterance {
  const a = words[from]!;
  const b = words[to]!;
  // Onset real: primeiro frame com fala a partir de (início ASR − 0,3 s); offset: último frame com fala até (fim ASR + 0,3 s).
  let fs = Math.max(0, t2f(a.start - 0.3));
  const fsMax = Math.min(voiced.length - 1, t2f(a.end));
  while (fs < fsMax && !voiced[fs]) fs++;
  let fe = Math.min(voiced.length - 1, t2f(b.end + 0.3));
  const feMin = Math.max(0, t2f(b.start));
  while (fe > feMin && !voiced[fe]) fe--;
  const start = fs < fsMax ? f2t(fs) : a.start;
  const end = fe > feMin ? f2t(fe + 1) : b.end;
  return { id, from, to, start, end: Math.max(end, start + 0.05), text: words.slice(from, to + 1).map((w) => w.w).join(' ') };
}

/** Pistas para o modelo: falas que parecem tomadas da mesma frase, e reinícios dentro da mesma fala. */
function retakeHints(utts: Utterance[], words: Word[]): string[] {
  const toks = utts.map((u) => words.slice(u.from, u.to + 1).map((w) => normalizeToken(w.w)).filter(Boolean));
  const hints: string[] = [];
  for (let j = 0; j < utts.length; j++) {
    for (let i = Math.max(0, j - 8); i < j; i++) {
      const a = toks[i]!;
      const b = toks[j]!;
      if (Math.min(a.length, b.length) < 2) continue;
      if (utts[j]!.start - utts[i]!.end > 60) continue;
      const sim = lcs(a, b) / Math.min(a.length, b.length);
      const samePrefix = a[0] === b[0] && a[1] === b[1];
      if (sim >= 0.6 || (samePrefix && sim >= 0.4)) {
        hints.push(`U${utts[j]!.id} parece outra tomada de U${utts[i]!.id} (similaridade ${sim.toFixed(2)}${samePrefix ? ', mesmo começo' : ''})`);
      }
    }
    // Reinício interno: n-grama (2..4) repetido a até 12 palavras de distância.
    const t = toks[j]!;
    const base = utts[j]!.from;
    // Um reinício = um par (x, y). Estende o n-grama ao máximo e marca as posições cobertas
    // para não reportar o mesmo reinício como vários n-gramas menores.
    const covered = new Set<string>();
    for (let x = 0; x < t.length; x++) {
      for (let y = x + 1; y < t.length && y - x <= 12; y++) {
        if (covered.has(`${x}:${y - x}`)) continue;
        let n = 0;
        while (y + n < t.length && x + n < y && t[x + n] === t[y + n]) n++;
        if (n < 2) continue;
        for (let k = 0; k < n; k++) covered.add(`${x + k}:${y - x}`);
        hints.push(`U${utts[j]!.id}: "${t.slice(x, x + n).join(' ')}" se repete (#${base + x} e #${base + y}) — possível reinício dentro da fala`);
      }
    }
  }
  return hints;
}

// ---------------------------------------------------------------------------
// Decisão (palavras mantidas) → intervalos de fonte com bordas medidas
// ---------------------------------------------------------------------------

export interface BorderOptions {
  headPad: number;
  tailPad: number;
  /** Pausas internas maiores que isto são encurtadas… */
  maxPause: number;
  /** …para esta duração. */
  pauseTarget: number;
}

export const BORDER_DEFAULTS: BorderOptions = { headPad: 0.06, tailPad: 0.1, maxPause: 0.3, pauseTarget: 0.16 };

export interface KeepRange extends Range {
  from: number;
  to: number;
}

export function keptRanges(words: Word[], keep: boolean[], an: Analysis, opts: Partial<BorderOptions> = {}): KeepRange[] {
  const o = { ...BORDER_DEFAULTS, ...opts };
  const uttOf = new Int32Array(words.length);
  for (const u of an.utterances) uttOf.fill(u.id, u.from, u.to + 1);

  // Pausa entre a palavra i e i+1 (se houver), por sobreposição com o intervalo entre os centros.
  const pauseBetween = (i: number): Range | undefined => {
    const a = an.centers[i]!;
    const b = an.centers[i + 1]!;
    return an.pauses.find((p) => p.start < b && p.end > a);
  };

  const spans: [number, number][] = [];
  for (let i = 0; i < words.length; i++) {
    if (!keep[i]) continue;
    if (spans.length && spans[spans.length - 1]![1] === i - 1) spans[spans.length - 1]![1] = i;
    else spans.push([i, i]);
  }

  const out: KeepRange[] = [];
  for (const [a, b] of spans) {
    const ua = an.utterances[uttOf[a]!]!;
    const ub = an.utterances[uttOf[b]!]!;
    let start: number;
    if (a === ua.from) {
      start = ua.start - o.headPad;
      const prev = an.utterances[ua.id - 1];
      if (prev) start = Math.max(start, prev.end + 0.03);
    } else {
      const p = pauseBetween(a - 1);
      start = p ? Math.max(p.start, p.end - o.headPad) : words[a]!.start;
    }
    let end: number;
    if (b === ub.to) {
      end = ub.end + o.tailPad;
      const next = an.utterances[ub.id + 1];
      if (next) end = Math.min(end, next.start - 0.03);
    } else {
      const p = pauseBetween(b);
      end = p ? Math.min(p.end, p.start + o.tailPad) : words[b]!.end;
    }
    start = Math.max(0, start);
    if (end - start < 0.05) continue;

    // Encurta pausas internas longas, deixando `pauseTarget` de respiro.
    let cursor = start;
    for (const p of an.pauses) {
      if (p.start <= start + 0.02 || p.end >= end - 0.02) continue;
      if (p.end - p.start <= o.maxPause) continue;
      const half = o.pauseTarget / 2;
      out.push({ start: cursor, end: p.start + half, from: a, to: b });
      cursor = p.end - half;
    }
    out.push({ start: cursor, end, from: a, to: b });
  }
  // Junta o que ficou colado.
  const merged: KeepRange[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < 0.04) {
      last.end = Math.max(last.end, r.end);
      last.to = r.to;
    } else merged.push({ ...r });
  }
  return merged;
}

export function complement(keeps: Range[], duration: number): Range[] {
  const out: Range[] = [];
  let t = 0;
  for (const k of keeps) {
    if (k.start - t > 0.01) out.push({ start: t, end: k.start });
    t = Math.max(t, k.end);
  }
  if (duration - t > 0.01) out.push({ start: t, end: duration });
  return out;
}

/** Texto para o modelo: cada fala com seus tempos e palavras indexadas. */
export function renderForModel(words: Word[], an: Analysis): string {
  const lines: string[] = [];
  let prevEnd = 0;
  for (const u of an.utterances) {
    const gap = u.start - prevEnd;
    prevEnd = u.end;
    const ws = words
      .slice(u.from, u.to + 1)
      .map((w, k) => `${u.from + k}:${w.w}${w.p < 0.5 ? '(?)' : ''}`)
      .join(' ');
    lines.push(`U${u.id} [${u.start.toFixed(2)}–${u.end.toFixed(2)}] pausa antes ${gap.toFixed(1)}s | ${ws}`);
  }
  return lines.join('\n');
}
