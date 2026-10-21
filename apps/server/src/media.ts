import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MediaAsset } from '@neweditor/core';
import { ANALYSIS_RATE, ENV_HOP, ENV_WIN } from './config.ts';

/** Processos filhos vivos (FFmpeg, ASR). Morrem junto com o servidor — sem órfão escrevendo arquivo. */
const children = new Set<ChildProcess>();
function killChildren(): void {
  for (const c of children) c.kill('SIGKILL');
  children.clear();
}
process.once('exit', killChildren);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(sig, () => {
    killChildren();
    process.exit(0);
  });
}

/**
 * Escreve um arquivo de forma atômica: o gerador escreve num temporário único e só no fim ele vira o
 * arquivo final. Um proxy nunca fica pela metade nem misturado com outra escrita.
 */
export async function atomic<T>(final: string, write: (tmp: string) => Promise<T>): Promise<T> {
  const ext = path.extname(final);
  const tmp = `${final.slice(0, final.length - ext.length)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  try {
    const r = await write(tmp);
    await fs.rename(tmp, final);
    return r;
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

/**
 * Onde estão o FFmpeg e o ffprobe: o app empacotado aponta os binários que leva consigo por NEWEDITOR_FFMPEG /
 * NEWEDITOR_FFPROBE; no repositório (e quando o Homebrew está instalado) vale o do PATH.
 */
export const FFMPEG_BIN = process.env.NEWEDITOR_FFMPEG || 'ffmpeg';
export const FFPROBE_BIN = process.env.NEWEDITOR_FFPROBE || 'ffprobe';
const BIN: Record<string, string> = { ffmpeg: FFMPEG_BIN, ffprobe: FFPROBE_BIN };

let ffmpegMajorCache: Promise<number> | null = null;
/** Versão maior do FFmpeg em uso (7 = Homebrew atual, 6 = o empacotado no app). Medida uma vez. */
export function ffmpegMajor(): Promise<number> {
  ffmpegMajorCache ??= run('ffmpeg', ['-version']).then(
    (out) => Number(/ffmpeg version (?:n)?(\d+)/.exec(out.toString())?.[1]) || 7,
    () => 7,
  );
  return ffmpegMajorCache;
}

/** Os argumentos para ler um grafo de filtros de um arquivo: `-/filter_complex` (7+) ou `-filter_complex_script` (6). */
export async function filterGraphArgs(file: string): Promise<string[]> {
  return (await ffmpegMajor()) >= 7 ? ['-/filter_complex', file] : ['-filter_complex_script', file];
}

/**
 * Opções de saída que não herdam nada dos insumos: sem capítulos (o MP4 virava menu "Chapter 13/14" e trilha de texto
 * do filme usado como B-roll) e sem metadados (título, comentário) do bruto ou do B-roll — BL-0085.
 */
export const NO_INPUT_META = ['-map_metadata', '-1', '-map_chapters', '-1'] as const;

export function run(cmd: string, args: string[], opts: { onStderr?: (line: string) => void } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN[cmd] ?? cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(p);
    p.on('exit', () => children.delete(p));
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      err = (err + s).slice(-8000);
      opts.onStderr?.(s);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} saiu com ${code}: ${err.slice(-1500)}`))));
  });
}

interface ProbeStream {
  codec_type: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
  disposition?: { attached_pic?: number };
}

export async function probe(file: string): Promise<Omit<MediaAsset, 'id' | 'name' | 'path'>> {
  const raw = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
  const j = JSON.parse(raw.toString()) as { format: { duration?: string }; streams: ProbeStream[] };
  // Capa de álbum (MP3/M4A) vem como "vídeo" de um quadro: não é vídeo.
  const v = j.streams.find((s) => s.codec_type === 'video' && s.width && !s.disposition?.attached_pic);
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(j.format.duration ?? 0);
  if (!v && !a) throw new Error('arquivo sem vídeo nem áudio');
  const fpsStr = v?.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v?.r_frame_rate;
  const fps = fpsStr ? (() => { const [n, d] = fpsStr.split('/').map(Number); return d ? n! / d : n; })() : undefined;
  // Vídeo de celular vem com rotação no metadado: largura/altura reais são as do display.
  const rot = Math.abs(v?.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? Number(v?.tags?.rotate ?? 0));
  const swap = rot === 90 || rot === 270;
  const isImage = !!v && duration < 0.1 && !a;
  return {
    kind: isImage ? 'image' : v ? 'video' : 'audio',
    duration,
    width: v ? (swap ? v.height : v.width) : undefined,
    height: v ? (swap ? v.width : v.height) : undefined,
    fps: fps ? Math.round(fps * 1000) / 1000 : undefined,
    hasAudio: !!a,
    ...(v && /yuva|rgba|argb|abgr|bgra|gbrap|ya8|ya16/.test(v.pix_fmt ?? '') ? { alpha: true } : {}),
  };
}

/** Lado menor do proxy: leve para o navegador, nítido o bastante para julgar enquadramento. */
const PROXY_SHORT_SIDE = 540;

function proxySize(asset: MediaAsset): { w: number; h: number } {
  const W = asset.width ?? 1920;
  const H = asset.height ?? 1080;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return W >= H ? { w: even((W / H) * PROXY_SHORT_SIDE), h: PROXY_SHORT_SIDE } : { w: PROXY_SHORT_SIDE, h: even((H / W) * PROXY_SHORT_SIDE) };
}

/**
 * Proxy leve para o Editor Brain: lado menor 540 px, keyframe a cada 0,25 s (seek instantâneo).
 * Vídeo: decodifica na GPU (VideoToolbox) e codifica em H.264 por hardware — metade da CPU do caminho em
 * software, sobrando processador para o ASR rodar em paralelo. A redução fica na CPU de propósito:
 * no caminho 100% GPU o FFmpeg ignora a rotação de vídeo de celular (sai deitado e esmagado).
 * O original nunca é tocado — o render final sai dele.
 */
export async function makeProxy(asset: MediaAsset, outDir: string, onProgress?: (p: number) => void): Promise<string> {
  const isVideo = asset.kind === 'video';
  if (asset.kind === 'image') {
    // Imagem (frame de filme, PNG com alfa, GIF): um PNG no tamanho do proxy, com o alfa preservado.
    const { w, h } = proxySize(asset);
    const rel = 'proxy.png';
    await atomic(path.join(outDir, rel), (tmp) => run('ffmpeg', ['-y', '-v', 'error', '-i', asset.path, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=lanczos,format=rgba`, '-f', 'image2', '-c:v', 'png', tmp]));
    return rel;
  }
  const rel = isVideo ? (asset.alpha ? 'proxy.webm' : 'proxy.mp4') : 'proxy.m4a';
  const out = path.join(outDir, rel);
  const gop = String(Math.max(6, Math.round((asset.fps ?? 30) / 4)));
  const progress = (line: string) => {
    const m = /time=(\d+):(\d+):([\d.]+)/.exec(line);
    if (m && onProgress && asset.duration) onProgress(Math.min(1, (+m[1]! * 3600 + +m[2]! * 60 + +m[3]!) / asset.duration));
  };
  if (!isVideo) {
    await atomic(out, (tmp) => run('ffmpeg', ['-y', '-v', 'error', '-stats', '-i', asset.path, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp], { onStderr: progress }));
    return rel;
  }
  const { w, h } = proxySize(asset);
  if (asset.alpha) {
    // Motion com alfa (ProRes 4444): WebM VP9 com canal alfa — o <video> do preview compõe por cima da fala.
    await atomic(out, (tmp) => run('ffmpeg', ['-y', '-v', 'error', '-stats', '-i', asset.path, '-map', '0:v:0', '-vf', `scale=${w}:${h}:flags=fast_bilinear,format=yuva420p`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '1800k', '-deadline', 'realtime', '-cpu-used', '4', '-g', gop, '-an', tmp], { onStderr: progress }));
    return rel;
  }
  const vf = `scale=${w}:${h}:flags=fast_bilinear,format=yuv420p`;
  const audio = asset.hasAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : [];
  // Arquivo de câmera às vezes traz áudio começando antes do vídeo: zera os tempos, senão o Chrome
  // recusa o primeiro pacote de áudio (timestamp negativo) e o proxy não toca.
  const tail = (tmp: string) => [...audio, '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', tmp];
  await atomic(out, async (tmp) => {
    try {
      await run('ffmpeg', ['-y', '-v', 'error', '-stats', '-hwaccel', 'videotoolbox', '-i', asset.path, '-map', '0:v:0', '-vf', vf, '-c:v', 'h264_videotoolbox', '-b:v', '2000k', '-g', gop, ...tail(tmp)], { onStderr: progress });
    } catch {
      await run('ffmpeg', ['-y', '-v', 'error', '-stats', '-i', asset.path, '-map', '0:v:0', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-g', gop, '-keyint_min', gop, '-sc_threshold', '0', ...tail(tmp)], { onStderr: progress });
    }
  });
  return rel;
}

/**
 * Filmstrip: um quadro a cada `interval` s (no máx. ~1200 quadros), numa grade JPEG.
 * Lê só os keyframes (`-skip_frame nokey`): em 4K isso é dezenas de vezes mais rápido que decodificar tudo.
 * A timeline recorta o quadro certo da grade via CSS — barato até para vídeo de 1 h.
 */
export async function makeThumbs(asset: MediaAsset, outDir: string): Promise<NonNullable<MediaAsset['thumbs']>> {
  const h = 72;
  const w = Math.max(16, Math.round(((asset.width ?? 16) / (asset.height ?? 9)) * h / 2) * 2);
  const interval = Math.max(1, Math.ceil(asset.duration / 1200));
  const count = Math.max(1, Math.ceil(asset.duration / interval));
  const cols = 20;
  const rows = Math.ceil(count / cols);
  // JPEG pede YUV de faixa cheia (yuvj420p): o FFmpeg 7+ recusa a faixa limitada do proxy no encoder mjpeg.
  const file = 'thumbs.jpg';
  const vf = `fps=1/${interval},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},tile=${cols}x${rows}`;
  const args = (soKeyframes: boolean) => ['-y', '-v', 'error', ...(soKeyframes ? ['-skip_frame', 'nokey'] : []), '-i', asset.path, '-vf', vf, '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '5'];
  await atomic(path.join(outDir, file), async (tmp) => {
    // Decodificar só keyframes é muito mais rápido numa bruta longa; num clipe curto (um GOP só, comum em gravação
    // de tela e em overlays) o `fps` pode não soltar quadro nenhum e o FFmpeg sai sem escrever: aí decodifica tudo.
    if (asset.duration > 30) {
      await run('ffmpeg', [...args(true), tmp]);
      if (await fs.stat(tmp).then((st) => st.size > 0, () => false)) return;
    }
    await run('ffmpeg', [...args(false), tmp]);
  });
  return { file, interval, w, h, cols, count };
}

/** WAV 16 kHz mono — entrada do ASR e da análise de energia. */
export async function makeWav16k(asset: MediaAsset, outDir: string): Promise<string> {
  const rel = 'audio16k.wav';
  await atomic(path.join(outDir, rel), (tmp) => run('ffmpeg', ['-y', '-v', 'error', '-i', asset.path, '-map', '0:a:0', '-ac', '1', '-ar', String(ANALYSIS_RATE), '-c:a', 'pcm_s16le', tmp]));
  return rel;
}

/**
 * Envelope de energia em dBFS: RMS em janela de 20 ms, passo de 10 ms.
 * Salvo como Float32 cru (o front desenha a waveform direto dele).
 */
export async function makeEnvelope(wavPath: string, outDir: string): Promise<string> {
  const buf = await fs.readFile(wavPath);
  // Acha o chunk "data" (não assume header de 44 bytes).
  let off = 12;
  let dataStart = 44;
  let dataLen = buf.length - 44;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      dataStart = off + 8;
      dataLen = Math.min(len, buf.length - dataStart);
      break;
    }
    off += 8 + len + (len % 2);
  }
  const n = Math.floor(dataLen / 2);
  const hop = Math.round(ENV_HOP * ANALYSIS_RATE);
  const win = Math.round(ENV_WIN * ANALYSIS_RATE);
  const frames = Math.max(1, Math.ceil(n / hop));
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = f * hop - Math.floor((win - hop) / 2);
    let sum = 0;
    let cnt = 0;
    for (let i = Math.max(0, a); i < Math.min(n, a + win); i++) {
      const s = buf.readInt16LE(dataStart + i * 2) / 32768;
      sum += s * s;
      cnt++;
    }
    const rms = cnt ? Math.sqrt(sum / cnt) : 0;
    env[f] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  }
  const rel = 'envelope.f32';
  await atomic(path.join(outDir, rel), (tmp) => fs.writeFile(tmp, Buffer.from(env.buffer)));
  return rel;
}

export async function readEnvelope(file: string): Promise<Float32Array> {
  const b = await fs.readFile(file);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
