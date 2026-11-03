/**
 * Correção de cor automática (sem API): detecta LOG pela medida do quadro e pela marca do arquivo,
 * e acerta exposição e balanço de branco olhando os pixels do ORIGINAL.
 */
import { gradePixel, guessInput, manageGrade, NEUTRAL_GRADE, type ColorGrade, type MediaAsset } from '@neweditor/core';
import { knownCapture } from './capture-profile.ts';
import { cineproCube } from './cinepro.ts';
import { run } from './media.ts';

interface Stats {
  ylow: number;
  ymax: number;
  sat: number;
}

/** signalstats normalizado para escala de 10 bits. */
async function frameStats(file: string, t: number): Promise<Stats & { brand: string }> {
  const out = (await run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=mode=print:file=-', '-f', 'null', '-'])).toString();
  const get = (k: string) => Number(new RegExp(`signalstats\\.${k}=([\\d.]+)`).exec(out)?.[1] ?? NaN);
  const probe = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt:format_tags=major_brand', '-of', 'default=nw=1', file])).toString();
  const tenBit = /p10|p12|p16/.test(probe);
  const k = tenBit ? 1 : 4;
  return { ylow: get('YLOW') * k, ymax: get('YMAX') * k, sat: get('SATAVG') * k, brand: /major_brand=(\S+)/.exec(probe)?.[1] ?? '' };
}

/** Pixels RGB (0..1) de alguns quadros do original, pequenos. */
async function samplePixels(file: string, times: number[]): Promise<Float32Array[]> {
  const frames: Float32Array[] = [];
  for (const t of times) {
    const raw = await run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=96:-2:in_color_matrix=bt709,format=rgb48le', '-f', 'rawvideo', '-']);
    const px = new Float32Array(raw.length / 2);
    for (let i = 0; i < px.length; i++) px[i] = raw.readUInt16LE(i * 2) / 65535;
    frames.push(px);
  }
  return frames;
}

const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;

export async function autoGrade(asset: MediaAsset): Promise<{ grade: ColorGrade; why: string }> {
  const times = [0.2, 0.5, 0.8].map((f) => Math.max(0, asset.duration * f));
  const st = await frameStats(asset.path, times[1]!);
  // A entrada do arquivo (XML da câmera) manda; o palpite pelo quadro só vale para arquivo sem metadado de cor.
  // Curva `desconhecida` (BL-0175) não é cor lida: o palpite segue valendo, como antes.
  const color = knownCapture(asset.color) ? asset.color : undefined;
  const base: ColorGrade = manageGrade({ ...NEUTRAL_GRADE, input: guessInput(st, st.brand) }, color)!;
  const input = base.input;
  const inCube = base.inputLut ? await cineproCube(base.inputLut.id).catch(() => null) : null;
  const frames = await samplePixels(asset.path, times);

  // 1. Exposição: as altas luzes do assunto (p95) vão para ~72% — não a média, que numa sala escura engana.
  const lumas: number[] = [];
  const mids: [number, number, number][] = [];
  for (const px of frames)
    for (let i = 0; i < px.length; i += 3) {
      const o = gradePixel([px[i]!, px[i + 1]!, px[i + 2]!], base, inCube);
      const y = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2];
      lumas.push(y);
      if (y > 0.25 && y < 0.75) mids.push(o);
    }
  const p95 = pct(lumas, 0.95);
  const exposure = Math.max(-1.5, Math.min(1.5, Math.log2(0.72 / Math.max(0.05, p95)) * 0.8));

  // 2. Balanço de branco: mundo cinza nos meios-tons (pele e fundo neutro tendem ao neutro na média).
  let temperature = 0;
  let tint = 0;
  if (mids.length > 50) {
    const avg = mids.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((v) => v / mids.length);
    const [r, g, b] = avg as [number, number, number];
    // Pele puxa a média para o quente: só corrige metade do desvio, e com limite.
    temperature = Math.max(-0.35, Math.min(0.35, ((b - r) / ((r + b) / 2)) * 0.5));
    tint = Math.max(-0.3, Math.min(0.3, ((r + b) / 2 - g) / g));
  }
  const grade: ColorGrade = { ...base, exposure: Math.round(exposure * 20) / 20, temperature: Math.round(temperature * 100) / 100, tint: Math.round(tint * 100) / 100 };
  const label = input === 'rec709' ? 'imagem já em Rec.709' : color ? `${color.gamma ?? input} lido do arquivo${input === 'slog3' ? ', conversão LC-709 Type A embutida' : base.inputLut ? ', LUT de entrada' : ''}` : `${input === 'slog3' ? 'Sony S-Log3' : input} (preto em ${Math.round(st.ylow)}/1023${st.brand ? `, arquivo ${st.brand}` : ''})`;
  return { grade, why: `${label}; exposição ${grade.exposure >= 0 ? '+' : ''}${grade.exposure} stop, temperatura ${grade.temperature}, matiz ${grade.tint}` };
}
