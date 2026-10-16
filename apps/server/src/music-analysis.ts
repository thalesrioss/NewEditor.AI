/**
 * Trilha por BPM e clima (ADR-007 N-4): mede cada música da biblioteca uma vez (BPM, energia, onde acaba a
 * introdução calma, fase da batida) e escolhe a trilha pelo ritmo do corte. A música entra num tempo forte,
 * no nível que o perfil do cliente pede, e o começo calmo da faixa cai no começo da peça.
 *
 * Tudo local: FFmpeg decodifica os primeiros 100 s em mono 11,025 Hz; o resto é aritmética.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import { run } from './media.ts';

export interface TrackAnalysis {
  bpm: number;
  /** Confiança da batida (0–1). */
  beatConf: number;
  /** Energia média (dBFS) e "clima" derivado. */
  energyDb: number;
  clima: 'calma' | 'media' | 'agitada';
  /** Fim da introdução calma (s): a partir daqui a faixa está no nível normal. */
  introEnd: number;
  /** Instante (s) de um tempo forte logo depois da introdução — por onde a trilha deve começar. */
  startAt: number;
  mtimeMs: number;
}

const CACHE = path.join(path.dirname(DATA_DIR), 'music-cache.json');
let cache: Record<string, TrackAnalysis> | null = null;

async function loadCache(): Promise<Record<string, TrackAnalysis>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE, 'utf8')) as Record<string, TrackAnalysis>;
  } catch {
    cache = {};
  }
  return cache;
}

/** Clima pela energia média (faixas medidas na biblioteca do Thales: −29 a −8 dBFS, mediana −13). */
export function climaOf(energyDb: number): TrackAnalysis['clima'] {
  return energyDb < -21 ? 'calma' : energyDb < -14 ? 'media' : 'agitada';
}

export async function cachedAnalysis(file: string): Promise<TrackAnalysis | null> {
  const c = await loadCache();
  const a = c[file];
  if (!a) return null;
  try {
    const st = await fs.stat(file);
    return st.mtimeMs === a.mtimeMs ? { ...a, clima: climaOf(a.energyDb) } : null;
  } catch {
    return null;
  }
}

const SR = 11025;
const HOP = Math.round(SR * 0.01);

export async function analyzeTrack(file: string): Promise<TrackAnalysis> {
  const hit = await cachedAnalysis(file);
  if (hit) return hit;
  const raw = await run('ffmpeg', ['-v', 'error', '-t', '100', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  const x = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  // Energia por 10 ms e "força de ataque" (subida de energia).
  const n = Math.floor(x.length / HOP);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < HOP; k++) s += x[i * HOP + k]! ** 2;
    e[i] = Math.sqrt(s / HOP);
  }
  const db = Array.from(e, (v) => 20 * Math.log10(v + 1e-6));
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, db[i]! - db[i - 1]!);
  // Autocorrelação da força de ataque nos períodos de 50–200 BPM.
  let best = { period: 60, score: -1 };
  const mean = onset.reduce((a, b) => a + b, 0) / n;
  for (let p = Math.round(60 / 200 / 0.01); p <= Math.round(60 / 50 / 0.01); p++) {
    let s = 0;
    for (let i = p; i < n; i++) s += (onset[i]! - mean) * (onset[i - p]! - mean);
    s /= n - p;
    // Preferência por períodos "musicais" (evita contar o dobro): leve bônus para 80–130 BPM.
    const bpm = 60 / (p * 0.01);
    const w = bpm >= 80 && bpm <= 130 ? 1.08 : 1;
    if (s * w > best.score) best = { period: p, score: s * w };
  }
  const bpm = Math.round(60 / (best.period * 0.01));
  const beatConf = Math.max(0, Math.min(1, best.score / 4));
  // Fase da batida: deslocamento onde os ataques somam mais.
  let phase = 0;
  let ps = -1;
  for (let o = 0; o < best.period; o++) {
    let s = 0;
    for (let i = o; i < n; i += best.period) s += onset[i]!;
    if (s > ps) ((ps = s), (phase = o));
  }
  const energyDb = db.reduce((a, b) => a + b, 0) / n;
  const sortedDb = [...db].sort((a, b) => a - b);
  const median = sortedDb[Math.floor(n / 2)]!;
  // Introdução calma: até a energia (média móvel de 1 s) chegar a 70% do caminho entre o piso e a mediana.
  const floor = sortedDb[Math.floor(n * 0.1)]!;
  const target = floor + (median - floor) * 0.7;
  let introEnd = 0;
  for (let i = 100; i < n; i++) {
    let s = 0;
    for (let k = i - 100; k < i; k++) s += db[k]!;
    if (s / 100 >= target) {
      introEnd = Math.max(0, (i - 100) * 0.01);
      break;
    }
  }
  // Começo num tempo forte logo antes do fim da intro (para a peça abrir já na batida que vai subir).
  const periodS = best.period * 0.01;
  const phaseS = phase * 0.01;
  let startAt = phaseS + Math.floor(Math.max(0, introEnd - phaseS) / periodS) * periodS;
  startAt = Math.max(0, Math.round(startAt * 100) / 100);
  const clima = climaOf(energyDb);
  const a: TrackAnalysis = { bpm, beatConf: Math.round(beatConf * 100) / 100, energyDb: Math.round(energyDb * 10) / 10, clima, introEnd: Math.round(introEnd * 10) / 10, startAt, mtimeMs: (await fs.stat(file)).mtimeMs };
  const c = await loadCache();
  c[file] = a;
  await fs.writeFile(CACHE, JSON.stringify(c, null, 1)).catch(() => undefined);
  return a;
}

/** BPM que combina com o ritmo do corte: uma batida forte (compasso de 4) por corte mediano. */
export function targetBpm(medianClipS: number): number {
  const bpm = (60 / Math.max(0.8, medianClipS)) * 4;
  return Math.max(70, Math.min(130, Math.round(bpm)));
}
