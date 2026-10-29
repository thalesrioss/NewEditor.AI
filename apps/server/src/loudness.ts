/**
 * Loudness de entrega (CH-0007): o QC mede o MP4 final (AAC já codificado), então a conferência é feita nele.
 * Alvo: −14 LUFS integrado (±0,5) e pico real ≤ −1,5 dBTP (ficha técnica B3 da série Equity, CH-0038; era −1).
 *
 * A mixagem (já com a 1ª passada do loudnorm) sai em WAV junto do vídeo; daqui: ganho calculado pela medida, limitador
 * com 4× de sobreamostragem (aproxima o pico real), AAC UMA vez, mede o MP4. Se ainda estiver fora (o AAC passa o
 * pico; o limitador tira um pouco do integrado), corrige ganho e teto e codifica de novo a partir do mesmo WAV — nunca
 * AAC sobre AAC. O vídeo é copiado.
 */
import fs from 'node:fs/promises';
import { NO_INPUT_META, run } from './media.ts';

export const DELIVERY = { I: -14, TP: -1.5, LRA: 11, tolI: 0.5, maxTP: -1.5 } as const;
/**
 * CH-0038: o `ebur128` mostra o pico com 1 casa e o revisor mede com 2 (loudnorm `input_tp`): −1,42 aparecia como
 * −1,4. A entrega mira 0,1 dB abaixo do teto, e o limitador já começa com margem para o que o AAC passa (~0,1 dB).
 */
const TP_TARGET = DELIVERY.maxTP - 0.1;
const FIRST_CEILING = DELIVERY.maxTP - 0.2;

export interface Loudness {
  /** Integrado (LUFS). */
  i: number;
  /** Pico real (dBTP). */
  tp: number;
}

/** Medida EBU R128 do 1º áudio do arquivo (a mesma do `ebur128` que o QC usa). */
export async function measureLoudness(file: string): Promise<Loudness> {
  let err = '';
  await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { onStderr: (s) => (err = (err + s).slice(-4000)) });
  const s = err.slice(err.lastIndexOf('Summary:'));
  const num = (re: RegExp) => {
    const m = re.exec(s);
    return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : NaN;
  };
  return { i: num(/I:\s+(-inf|-?[\d.]+) LUFS/), tp: num(/Peak:\s+(-inf|-?[\d.]+) dBFS/) };
}

export function withinDelivery(m: Loudness): boolean {
  return Math.abs(m.i - DELIVERY.I) <= DELIVERY.tolI && m.tp <= TP_TARGET;
}

const AAC = ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000'];
/** Abaixo disso (LUFS) é silêncio: vai sem ganho. */
const SILENCE = -50;
/** Teto de ganho da correção (dB), para mixagem muito baixa não virar ruído amplificado. */
const MAX_GAIN = 20;

/**
 * Junta o vídeo (copiado) com a mixagem em WAV, no alvo de entrega, medindo o MP4 codificado.
 * `video` pode ter áudio ou não (só o vídeo é usado). Silêncio vai sem ganho; `ok` = dentro do alvo (ou silêncio).
 */
export async function deliverAudio(video: string, wav: string, out: string, duration: number, maxPasses = 4): Promise<{ before: Loudness; after: Loudness; passes: number; ok: boolean }> {
  const before = await measureLoudness(wav);
  // Silêncio ou quase (o ebur128 dá −70 no piso): sem ganho, para não levantar ruído de fundo.
  const audible = before.i > SILENCE;
  const encode = (gain: number, ceiling: number) => {
    const af = audible
      ? `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${(10 ** (ceiling / 20)).toFixed(4)}:attack=5:release=60:level=false,aresample=48000,apad`
      : 'apad';
    return run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', af, ...AAC, ...NO_INPUT_META, '-t', String(duration), '-movflags', '+faststart', out]);
  };
  const clamp = (g: number) => Math.max(-MAX_GAIN, Math.min(MAX_GAIN, g));
  let gain = audible ? clamp(DELIVERY.I - before.i) : 0;
  let ceiling: number = FIRST_CEILING;
  let best: { m: Loudness; gain: number; ceiling: number; miss: number } | null = null;
  let after: Loudness = before;
  let passes = 0;
  while (passes < maxPasses) {
    passes++;
    await encode(gain, ceiling);
    after = await measureLoudness(out);
    if (!audible || withinDelivery(after)) return { before, after, passes, ok: true };
    const m = miss(after);
    if (!best || m < best.miss) best = { m: after, gain, ceiling, miss: m };
    // Ajuste fino: o que faltou no integrado vira ganho; o que o AAC passou do pico abaixa o teto.
    gain = clamp(gain + DELIVERY.I - after.i);
    if (after.tp > TP_TARGET) ceiling -= after.tp - TP_TARGET + 0.1;
  }
  // Não fechou (material muito denso, o AAC passa o pico de forma irregular): fica a passada mais perto do alvo.
  if (best && best.m !== after) {
    await encode(best.gain, best.ceiling);
    after = await measureLoudness(out);
  }
  return { before, after, passes, ok: false };
}

/** Quanto falta para o alvo (0 = dentro): LU fora da tolerância + dB acima do pico. */
export function miss(m: Loudness): number {
  return Math.max(0, Math.abs(m.i - DELIVERY.I) - DELIVERY.tolI) + Math.max(0, m.tp - TP_TARGET);
}

/** Mesmo processo para um MP4 já renderizado (contorno de entrega antiga): extrai o áudio uma vez e refaz. */
export async function fixDeliveredFile(file: string, out: string, duration: number): Promise<{ before: Loudness; after: Loudness; passes: number; ok: boolean }> {
  const wav = `${out}.mix.wav`;
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'pcm_f32le', wav]);
    const r = await deliverAudio(file, wav, out, duration);
    return { ...r, before: await measureLoudness(file) };
  } finally {
    await fs.rm(wav, { force: true });
  }
}
