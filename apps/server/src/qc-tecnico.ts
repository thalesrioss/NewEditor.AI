/**
 * QC técnico (gate de entrega, força-tarefa de 27/10/2026, frente Q3): mede o MP4 final e reprova o que o revisor
 * não enxerga a olho. Reprova se qualquer regra falhar:
 *
 *  1. perfil de entrega (ffprobe): h264, yuv420p, faixa tv, bt709 nos 3 campos, fps nominal CFR, AAC 48 kHz;
 *  2. níveis: Y fora de 16–235 em mais de 0,5% dos pixels (código armazenado, ~1 quadro/s);
 *  3. saturação: SATAVG do centro do quadro abaixo de 0,7× a assinatura dos aprovados do cliente;
 *  4. imagem parada sob fala: freeze ≥ 0,15 s ou quadros repetidos em cadência (câmera lenta) com fala;
 *  5. com o projeto: escala efetiva > 1,25, velocidade ≠ 1 e congelamento sob fala, boca de outro momento
 *     (cobertura do mesmo falante fora do instante da voz, ou cobertura embutida no arquivo) e 2ª câmera sem
 *     sincronia medida.
 *
 * Fala = energia da voz na própria entrega (passa-faixa 150–4000 Hz, acima do p95 − 18 dB): trilha alta conta.
 */
import path from 'node:path';
import { clipScale, overlayScale, clipDuration, clipPlayed, clipSpeed, clipStarts, coverCrop, FLASH_FRAMES, locate, normalizeTimeline, overlayActive, overlaySourceTime, resolveOverlay, timelineDuration, type Clip, type MediaAsset, type OverlayItem, type Project } from '@neweditor/core';
import { run } from './media.ts';
import { syncPorTrecho } from './qc-sync.ts';
import { fpsRational } from './render.ts';

export interface QcAchado {
  regra: string;
  ok: boolean;
  medido: string;
  limite: string;
  /** Onde (tempo na peça, clipe, arquivo), legível. */
  onde?: string;
  /** Início na peça (s), quando houver. */
  at?: number;
}

export interface QcTecnico {
  aprovado: boolean;
  arquivo: string;
  achados: QcAchado[];
  /** Não reprovam: o que o gate não conseguiu conferir ou usou por padrão. */
  avisos: string[];
}

/** Medida dos vídeos aprovados do cliente (a régua de cor). `satavg` = o menos saturado dos aprovados. */
export interface Assinatura {
  satavg: number;
  fonte: string;
  arquivos?: { file: string; satavg: number }[];
}

/** Sem assinatura: os 4 aprovados do Leandro medidos em 27/10 (SATAVG 7 a 12); vale o menor. */
export const ASSINATURA_PADRAO: Assinatura = { satavg: 7, fonte: 'padrão (aprovados do Leandro, SATAVG 7 a 12, medidos em 27/10/2026)' };

export const LIMITES = {
  /** Fração máxima de pixels com Y fora de 16–235. */
  niveis: 0.005,
  /** Saturação mínima, em fração da assinatura. */
  saturacao: 0.7,
  /** Freeze mínimo que reprova sob fala (s). */
  freeze: 0.15,
  /** Escala efetiva máxima (pixel da fonte → pixel da entrega). */
  escala: 1.25,
  /** Quadros repetidos isolados em 1 s que fazem a cadência de câmera lenta. */
  cadencia: 4,
};

export interface Trecho {
  start: number;
  end: number;
}

export interface QcTecnicoOpts {
  project?: Project;
  assinatura?: Assinatura;
  /** fps da entrega esperado (sem projeto: 29,97). */
  fps?: number;
}

const n = (x: number, d = 2) => x.toFixed(d).replace('.', ',');
const pct = (x: number) => `${n(x * 100, 2)}%`;
const tt = (s: number) => `${n(s, 2)} s`;
const trecho = (a: number, b: number) => `${n(a, 2)}–${n(b, 2)} s`;
const overlap = (a: Trecho, b: Trecho) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const falaEm = (fala: Trecho[] | undefined, t: Trecho) => (fala ? fala.reduce((s, f) => s + overlap(f, t), 0) : t.end - t.start);

// ---------------------------------------------------------------------------
// 1. Perfil de entrega
// ---------------------------------------------------------------------------

export interface PerfilMedido {
  video?: { codec_name?: string; pix_fmt?: string; color_range?: string; color_space?: string; color_primaries?: string; color_transfer?: string; r_frame_rate?: string; avg_frame_rate?: string; width?: number; height?: number };
  audio?: { codec_name?: string; sample_rate?: string };
  duration: number;
  bitRate?: number;
}

export async function medirPerfil(file: string): Promise<PerfilMedido> {
  const raw = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
  const j = JSON.parse(raw.toString()) as { format: { duration?: string; bit_rate?: string }; streams: (Record<string, string | number> & { codec_type: string; disposition?: { attached_pic?: number } })[] };
  const v = j.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return { video: v as PerfilMedido['video'], audio: a as PerfilMedido['audio'], duration: Number(j.format.duration ?? 0), bitRate: Number(j.format.bit_rate ?? 0) || undefined };
}

/** fps da entrega como fração reduzida, a MESMA conta do render (29,97 → 30000/1001; celular 30,011 → 30/1). */
export function fpsAlvo(fps = 29.97): string {
  const r = fpsRational(fps);
  if (r.includes('/')) return r;
  const x = Number(r);
  return Number.isInteger(x) ? `${x}/1` : reduz(`${Math.round(x * 1000)}/1000`);
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
function reduz(s?: string): string {
  const [a, b] = (s ?? '').split('/').map(Number);
  if (!a || !b) return s ?? '?';
  const g = gcd(a, b);
  return `${a / g}/${b / g}`;
}
const valor = (s?: string) => {
  const [a, b] = (s ?? '').split('/').map(Number);
  return b ? a! / b : Number.NaN;
};

/** Achados do perfil de entrega (puro): um por etiqueta. */
export function achadosPerfil(p: PerfilMedido, fps?: number): QcAchado[] {
  const v = p.video;
  const a = p.audio;
  const out: QcAchado[] = [];
  const campo = (regra: string, medido: string | undefined, limite: string) => out.push({ regra, ok: medido === limite, medido: medido ?? 'ausente', limite });
  if (!v) out.push({ regra: 'perfil:video', ok: false, medido: 'sem vídeo', limite: 'h264' });
  else {
    campo('perfil:codec', v.codec_name, 'h264');
    campo('perfil:pix_fmt', v.pix_fmt, 'yuv420p');
    campo('perfil:color_range', v.color_range, 'tv');
    campo('perfil:colorspace', v.color_space, 'bt709');
    campo('perfil:color_primaries', v.color_primaries, 'bt709');
    campo('perfil:color_transfer', v.color_transfer, 'bt709');
    const alvo = fpsAlvo(fps);
    campo('perfil:fps', reduz(v.r_frame_rate), alvo);
    const r = valor(v.r_frame_rate);
    const avg = valor(v.avg_frame_rate);
    out.push({ regra: 'perfil:cfr', ok: Number.isFinite(r) && Math.abs(avg - r) / r < 5e-4, medido: `r ${v.r_frame_rate} · avg ${v.avg_frame_rate}`, limite: 'avg = r (CFR)' });
  }
  if (!a) out.push({ regra: 'perfil:audio', ok: false, medido: 'sem áudio', limite: 'aac 48000 Hz' });
  else {
    campo('perfil:audio_codec', a.codec_name, 'aac');
    campo('perfil:audio_rate', a.sample_rate, '48000');
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Níveis e 3. saturação
// ---------------------------------------------------------------------------

/** Largura da amostra de níveis (Y, vizinho mais próximo: não mistura pixel, o código lido é o armazenado). */
const NIVEIS_W = 360;

/**
 * Plano Y como gravado, ~1 quadro/s: `extractplanes=y` copia o código (sem conversão de faixa) e a redução é por
 * vizinho, em cinza (sem matriz nem faixa).
 */
export async function amostrarY(file: string): Promise<Uint8Array> {
  const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', `fps=1,extractplanes=y,scale=${NIVEIS_W}:-2:flags=neighbor`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

export function niveis(y: Uint8Array): { baixo: number; alto: number; ymin: number; ymax: number } {
  let lo = 0;
  let hi = 0;
  let ymin = 255;
  let ymax = 0;
  for (const v of y) {
    if (v < 16) lo++;
    else if (v > 235) hi++;
    if (v < ymin) ymin = v;
    if (v > ymax) ymax = v;
  }
  const t = Math.max(1, y.length);
  return { baixo: lo / t, alto: hi / t, ymin, ymax };
}

export function achadoNiveis(m: ReturnType<typeof niveis>): QcAchado {
  const fora = m.baixo + m.alto;
  return { regra: 'niveis', ok: fora <= LIMITES.niveis, medido: `Y<16 ${pct(m.baixo)} · Y>235 ${pct(m.alto)} (YMIN ${m.ymin}, YMAX ${m.ymax})`, limite: `fora de 16–235 ≤ ${pct(LIMITES.niveis)}` };
}

/**
 * SATAVG médio (signalstats) do centro do quadro (metade da largura e da altura), ~1 quadro/s, na escala da faixa tv:
 * em faixa cheia (pc/yuvj) o croma vai a ±127 em vez de ±112, então a medida é multiplicada por 224/255.
 */
export async function medirSatavg(file: string, perfil?: PerfilMedido): Promise<number> {
  const v = (perfil ?? (await medirPerfil(file))).video;
  const escala = v?.color_range === 'pc' || /^yuvj/.test(v?.pix_fmt ?? '') ? 224 / 255 : 1;
  const vals: number[] = [];
  let buf = '';
  await run('ffmpeg', ['-v', 'info', '-nostats', '-i', file, '-an', '-vf', 'fps=1,crop=iw/2:ih/2,signalstats,metadata=mode=print:key=lavfi.signalstats.SATAVG', '-f', 'null', '-'], {
    onStderr: (s) => {
      buf += s;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) {
        const m = /lavfi\.signalstats\.SATAVG=([\d.]+)/.exec(l);
        if (m) vals.push(Number(m[1]));
      }
    },
  });
  const m = /lavfi\.signalstats\.SATAVG=([\d.]+)/.exec(buf);
  if (m) vals.push(Number(m[1]));
  return vals.length ? (escala * vals.reduce((a, b) => a + b, 0)) / vals.length : 0;
}

export function achadoSaturacao(satavg: number, ass: Assinatura): QcAchado {
  const min = LIMITES.saturacao * ass.satavg;
  return { regra: 'saturacao', ok: satavg >= min, medido: `SATAVG ${n(satavg, 1)} (${n(satavg / ass.satavg, 2)}× a assinatura)`, limite: `≥ ${n(min, 1)} (0,7 × ${n(ass.satavg, 1)}, ${ass.fonte})` };
}

/** Assinatura de cor dos aprovados do cliente: SATAVG de cada um, medido como na entrega; vale o menor. */
export async function assinaturaDe(files: string[]): Promise<Assinatura> {
  if (!files.length) throw new Error('assinatura sem arquivos');
  const arquivos = [];
  for (const file of files) arquivos.push({ file, satavg: Math.round((await medirSatavg(file)) * 100) / 100 });
  const satavg = Math.min(...arquivos.map((a) => a.satavg));
  return { satavg, fonte: `aprovados do cliente (${arquivos.length}: SATAVG ${arquivos.map((a) => n(a.satavg, 1)).join(', ')}; vale o menor)`, arquivos };
}

// ---------------------------------------------------------------------------
// 4. Fala, freeze, cadência e cortes
// ---------------------------------------------------------------------------

const ENV_RATE = 16000;
const ENV_HOP = 0.01;

/** Energia da voz (dBFS, janela 20 ms, passo 10 ms) depois de um passa-faixa da voz. */
export async function envelopeVoz(file: string): Promise<Float32Array> {
  const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-af', 'highpass=f=150,lowpass=f=4000', '-ac', '1', '-ar', String(ENV_RATE), '-f', 's16le', '-']).catch(() => Buffer.alloc(0));
  const s = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
  const hop = ENV_RATE * ENV_HOP;
  const win = hop * 2;
  const env = new Float32Array(Math.max(0, Math.ceil(s.length / hop)));
  for (let f = 0; f < env.length; f++) {
    let sum = 0;
    let cnt = 0;
    for (let i = f * hop - hop / 2; i < f * hop + win - hop / 2; i++) {
      if (i < 0 || i >= s.length) continue;
      const x = s[i]! / 32768;
      sum += x * x;
      cnt++;
    }
    const rms = cnt ? Math.sqrt(sum / cnt) : 0;
    env[f] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  }
  return env;
}

/** Trechos com fala: acima de max(−45, p95 − 18) dB, vãos < 0,12 s juntados (respiro entre frases fica fora), trechos < 0,1 s fora. */
export function trechosDeFala(db: Float32Array, hop = ENV_HOP): Trecho[] {
  if (!db.length) return [];
  const sorted = Float32Array.from(db).sort();
  const thr = Math.max(-45, sorted[Math.floor(0.95 * (sorted.length - 1))]! - 18);
  const out: Trecho[] = [];
  let a = -1;
  for (let i = 0; i <= db.length; i++) {
    const on = i < db.length && db[i]! > thr;
    if (on && a < 0) a = i;
    if (!on && a >= 0) {
      const t = { start: a * hop, end: i * hop };
      const prev = out[out.length - 1];
      if (prev && t.start - prev.end < 0.12) prev.end = t.end;
      else out.push(t);
      a = -1;
    }
  }
  return out.filter((t) => t.end - t.start >= 0.1);
}

/** Imagem parada (freezedetect, ruído −60 dB). */
export async function medirFreezes(file: string, d = 0.1): Promise<Trecho[]> {
  let log = '';
  await run('ffmpeg', ['-v', 'info', '-nostats', '-i', file, '-an', '-vf', `freezedetect=n=0.001:d=${d}`, '-f', 'null', '-'], { onStderr: (s) => (log += s) });
  const out: Trecho[] = [];
  for (const m of log.matchAll(/freeze_(start|end): ([\d.]+)/g)) {
    if (m[1] === 'start') out.push({ start: Number(m[2]), end: Number.NaN });
    else if (out.length) out[out.length - 1]!.end = Number(m[2]);
  }
  return out;
}

/** Diferença média (0–255) de cada quadro para o anterior, em cinza 96×96, todos os quadros. */
export async function diferencasQuadro(file: string): Promise<Float32Array> {
  const S = 96 * 96;
  const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', 'scale=96:96:flags=area,format=gray', '-f', 'rawvideo', '-']);
  const q = Math.floor(raw.byteLength / S);
  const d = new Float32Array(q);
  for (let i = 1; i < q; i++) {
    let s = 0;
    for (let k = 0; k < S; k++) s += Math.abs(raw[i * S + k]! - raw[(i - 1) * S + k]!);
    d[i] = s / S;
  }
  return d;
}

const mediana = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * Cortes de plano: salto ≥ 20 que é ≥ 3× o movimento de um lado e ≥ 1,5× o do outro (6 quadros). Panorâmica e
 * chicote sobem a diferença dos dois lados e não contam. Devolve o tempo do 1º quadro do plano novo.
 */
export function cortesDe(d: ArrayLike<number>, fps: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < d.length; i++) {
    const v = d[i]!;
    if (v < 20) continue;
    // d[0] não é medida (não há quadro anterior): fica fora da vizinhança.
    const viz = (ks: number[]) => mediana(ks.filter((k) => k >= 1 && k < d.length).map((k) => d[k]!));
    const antes = viz([1, 2, 3, 4, 5, 6].map((k) => i - k));
    const depois = viz([1, 2, 3, 4, 5, 6].map((k) => i + k));
    if (v >= 3 * Math.max(1, Math.min(antes, depois)) && v >= 1.5 * Math.max(antes, depois)) out.push(i / fps);
  }
  return out;
}

/**
 * Câmera lenta por repetição de quadro (setpts + fps): quadro igual ao anterior (< 0,6) entre quadros que mexem (> 1,5),
 * em cadência: ≥ 4 repetições em 1 s. Freeze (vários iguais seguidos) fica com o freezedetect.
 */
export function camaraLenta(d: ArrayLike<number>, fps: number): Trecho[] {
  const reps: number[] = [];
  for (let i = 1; i < d.length - 1; i++) if (d[i]! < 0.6 && d[i - 1]! > 1.5 && d[i + 1]! > 1.5) reps.push(i);
  const out: Trecho[] = [];
  let grupo: number[] = [];
  const fecha = () => {
    if (grupo.length >= LIMITES.cadencia) {
      const denso = grupo.some((r) => grupo.filter((x) => x >= r && x < r + fps).length >= LIMITES.cadencia);
      if (denso) out.push({ start: (grupo[0]! - 1) / fps, end: (grupo[grupo.length - 1]! + 1) / fps });
    }
    grupo = [];
  };
  for (const r of reps) {
    if (grupo.length && r - grupo[grupo.length - 1]! > fps / 2) fecha();
    grupo.push(r);
  }
  fecha();
  return out;
}

// ---------------------------------------------------------------------------
// 5. Projeto: escala, velocidade, boca de outro momento, sincronia da câmera
// ---------------------------------------------------------------------------

/** Id do clipe Sony no nome do arquivo (C3050_B_86s3_cob2.mov → C3050). */
export function clipeSony(file: string): string | null {
  const m = /(?:^|[^A-Za-z0-9])(C\d{4})(?![0-9])/i.exec(path.basename(file));
  return m ? m[1]!.toUpperCase() : null;
}

/** Tempo de origem no bruto escrito no nome (C3050_B_86s3_cob2 → 86,3; C3100_cob_43s60 → 43,60; C3100_66s_x → 66). */
export function origemDoNome(file: string): number | null {
  const m = /_(\d+)s(\d*)(?=[_.]|$)/.exec(path.basename(file));
  return m ? Number(`${m[1]}.${m[2] || '0'}`) : null;
}

const ehBruto = (file: string) => /^C\d{4}\.(mp4|mov|mxf)$/i.test(path.basename(file));
const ehCob = (file: string) => /(^|[_\-. ])cob/i.test(path.basename(file));

/** Instante do bruto (clipe Sony e segundos) mostrado no tempo `t` de um arquivo; null = não dá para saber. */
function instanteBruto(a: MediaAsset, t: number, assets: Map<string, MediaAsset>): { sony: string | null; t: number } | null {
  const sony = clipeSony(a.path) ?? clipeSony(a.name);
  if (a.role === 'cam' || a.syncOffset !== undefined) {
    if (a.syncOffset === undefined) return null;
    const fala = (a.syncFala && assets.get(a.syncFala)) || [...assets.values()].find((x) => x.role === 'fala' && (clipeSony(x.path) ?? clipeSony(x.name)) === sony);
    return fala && fala !== a ? instanteBruto(fala, t - a.syncOffset, assets) : null;
  }
  if (ehBruto(a.path) || ehBruto(a.name)) return { sony, t };
  const o = origemDoNome(a.path) ?? origemDoNome(a.name);
  return o === null ? null : { sony, t: o + t };
}

export interface MedidasRender {
  fala?: Trecho[];
  cortes?: number[];
  duracao?: number;
}

/**
 * Achados do projeto (puro). Sem `fala`, todo trecho conta como fala. `cortes` (da entrega) localiza a cobertura
 * embutida e os cortes que a timeline não explica.
 */
export function achadosProjeto(project: Pick<Project, 'assets' | 'timeline'>, med: MedidasRender = {}): { achados: QcAchado[]; avisos: string[] } {
  const tl = normalizeTimeline(project.timeline);
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const fps = tl.fps || 29.97;
  const quadro = 1 / fps;
  const starts = clipStarts(tl);
  const out: QcAchado[] = [];
  const avisos: string[] = [];
  const nome = (id: string) => path.basename(assets.get(id)?.path ?? id);
  const temFala = (t: Trecho) => falaEm(med.fala, t) >= Math.min(0.1, (t.end - t.start) * 0.5);
  if (med.duracao !== undefined && Math.abs(timelineDuration(tl) - med.duracao) > 0.2) avisos.push(`o projeto (${tt(timelineDuration(tl))}) não tem a duração da entrega (${tt(med.duracao)}): as regras do projeto podem não descrever este arquivo`);

  // Falante: o que está na trilha principal (fala e câmeras) e seus clipes Sony.
  const falante = new Set<string>();
  for (const c of tl.main) {
    falante.add(c.assetId);
    if (c.cam) falante.add(c.cam);
  }
  for (const a of project.assets) if (a.role === 'fala' || a.role === 'cam') falante.add(a.id);
  const sonyFalante = new Set([...falante].map((id) => assets.get(id)).flatMap((a) => (a ? [clipeSony(a.path) ?? clipeSony(a.name)] : [])).filter((x): x is string => !!x));
  const doFalante = (a: MediaAsset) => falante.has(a.id) || a.role === 'cam' || sonyFalante.has(clipeSony(a.path) ?? clipeSony(a.name) ?? '-');

  // Overlays de imagem visíveis, e o que é de outra coisa (cobre a fala: corte, freeze e cadência ali não são boca).
  const visiveis = tl.overlays.filter((o) => (o.role === 'broll' || o.role === 'motion') && overlayActive(tl, o) && o.source.type === 'media');
  const cobreOutro: Trecho[] = [];
  const bordas: number[] = [...starts, timelineDuration(tl)];
  // Fim do flash de entrada: a volta do negativo para a imagem é troca de plano no detector, mas é da timeline (FB-0189).
  tl.main.forEach((c, i) => c.flash && bordas.push(starts[i]! + FLASH_FRAMES * quadro));
  for (const o of tl.overlays) {
    const pos = resolveOverlay(tl, o);
    if (!pos || o.role === 'music' || o.role === 'sfx') continue;
    bordas.push(pos.start, pos.end);
    if (o.source.type === 'composition') cobreOutro.push(pos);
    if (o.source.type === 'media' && overlayActive(tl, o)) {
      const a = assets.get(o.source.assetId);
      if (a && a.kind !== 'audio' && !a.alpha && !doFalante(a) && (o.role === 'broll' || o.role === 'motion')) cobreOutro.push(pos);
    }
  }
  const coberto = (t: number) => cobreOutro.some((c) => t >= c.start - quadro && t <= c.end + quadro);

  // (a) Escala efetiva.
  let piorEscala = 0;
  tl.main.forEach((c, i) => {
    const src = assets.get(c.cam ?? c.assetId) ?? assets.get(c.assetId);
    if (!src || src.kind === 'audio') return;
    // Sobre o tamanho de ENTREGA (lado curto 1080), a mesma conta do aviso da operação (`clipScale` do núcleo).
    const e = clipScale(src, c, tl) ?? 0;
    piorEscala = Math.max(piorEscala, e);
    if (e > LIMITES.escala) out.push({ regra: 'escala', ok: false, medido: `${n(e, 2)}× (zoom ${n(Math.max(c.zoom ?? 1, c.zoomTo ?? 1), 2)} sobre ${src.width}×${src.height})`, limite: `≤ ${n(LIMITES.escala, 2)}×`, onde: `clipe ${i + 1} (${nome(src.id)}) em ${tt(starts[i]!)}`, at: starts[i] });
  });
  for (const o of visiveis) {
    if (o.source.type !== 'media') continue;
    const a = assets.get(o.source.assetId);
    const pos = resolveOverlay(tl, o);
    if (!a || !pos || a.alpha || a.kind === 'audio') continue;
    const e = overlayScale(a, o.framing, tl) ?? 0;
    piorEscala = Math.max(piorEscala, e);
    if (e > LIMITES.escala) out.push({ regra: 'escala', ok: false, medido: `${n(e, 2)}× (B-roll${o.framing ? ` zoom ${n(o.framing.zoom, 2)}` : ''} sobre ${a.width}×${a.height})`, limite: `≤ ${n(LIMITES.escala, 2)}×`, onde: `${o.id} (${nome(a.id)}) em ${trecho(pos.start, pos.end)}`, at: pos.start });
  }
  if (!out.some((x) => x.regra === 'escala')) out.push({ regra: 'escala', ok: true, medido: `máx. ${n(piorEscala, 2)}×`, limite: `≤ ${n(LIMITES.escala, 2)}×` });
  if (project.assets.some((a) => !ehBruto(a.path) && a.kind === 'video' && (falante.has(a.id) || visiveis.some((o) => o.source.type === 'media' && o.source.assetId === a.id)) && a.role !== 'motion' && !a.alpha && clipeSony(a.path)))
    avisos.push('intermediários do falante (recorte/punch-in já embutido no arquivo): a escala medida é sobre o arquivo, o zoom de dentro dele não aparece no projeto');

  // (b) Velocidade e congelamento na trilha principal.
  tl.main.forEach((c, i) => {
    const t0 = starts[i]!;
    const played = { start: t0, end: t0 + clipPlayed(c) };
    if (clipSpeed(c) !== 1 && temFala(played)) out.push({ regra: 'velocidade', ok: false, medido: `velocidade ${n(clipSpeed(c), 2)} com fala`, limite: 'velocidade 1 sob fala', onde: `clipe ${i + 1} (${nome(c.assetId)}) em ${trecho(played.start, played.end)}`, at: t0 });
    if (c.freeze && c.freeze > 0) {
      const fr = { start: played.end, end: t0 + clipDuration(c) };
      if (temFala(fr)) out.push({ regra: 'congelamento', ok: false, medido: `quadro congelado ${tt(c.freeze)} com fala`, limite: 'sem congelamento sob fala', onde: `clipe ${i + 1} em ${trecho(fr.start, fr.end)}`, at: fr.start });
    }
  });
  for (const o of visiveis) {
    const a = o.source.type === 'media' ? assets.get(o.source.assetId) : undefined;
    const pos = resolveOverlay(tl, o);
    if (!a || !pos || !doFalante(a)) continue;
    if (o.speed && o.speed !== 1 && temFala(pos)) out.push({ regra: 'velocidade', ok: false, medido: `cobertura do falante a ${n(o.speed, 2)}× com fala`, limite: 'velocidade 1 sob fala', onde: `${o.id} (${nome(a.id)}) em ${trecho(pos.start, pos.end)}`, at: pos.start });
  }
  if (!out.some((x) => x.regra === 'velocidade')) out.push({ regra: 'velocidade', ok: true, medido: 'velocidade 1 sob fala', limite: 'velocidade 1 sob fala' });
  if (!out.some((x) => x.regra === 'congelamento')) out.push({ regra: 'congelamento', ok: true, medido: 'nenhum clipe congelado sob fala', limite: 'sem congelamento sob fala' });

  // (c) Boca de outro momento: cobertura do mesmo falante fora do instante da voz embaixo (> 1 quadro).
  for (const o of visiveis) {
    if (o.source.type !== 'media') continue;
    const a = assets.get(o.source.assetId);
    const pos = resolveOverlay(tl, o);
    if (!a || !pos || a.kind !== 'video' || !doFalante(a)) continue;
    let pior: { dt: number; voz: number; img: number; t: number; outro?: string } | null = null;
    let desconhecido = false;
    const passos = Math.max(2, Math.ceil((pos.end - pos.start) / quadro));
    for (let k = 0; k < passos; k++) {
      const t = Math.min(pos.end - 1e-3, pos.start + k * quadro + 1e-3);
      if (!temFala({ start: t - quadro / 2, end: t + quadro / 2 })) continue;
      const loc = locate(tl, t);
      if (!loc || loc.local > clipPlayed(loc.clip)) continue;
      const vozAsset = assets.get(loc.clip.assetId);
      const voz = vozAsset ? instanteBruto(vozAsset, loc.sourceTime, assets) : null;
      const img = instanteBruto(a, overlaySourceTime(o, t - pos.start), assets);
      if (!voz || !img) {
        desconhecido = true;
        continue;
      }
      if (voz.sony && img.sony && voz.sony !== img.sony) {
        pior = { dt: Number.POSITIVE_INFINITY, voz: voz.t, img: img.t, t, outro: `${img.sony} sob a voz do ${voz.sony}` };
        break;
      }
      const dt = Math.abs(img.t - voz.t);
      if (!pior || dt > pior.dt) pior = { dt, voz: voz.t, img: img.t, t };
    }
    const onde = `${o.id} (${nome(a.id)}) em ${trecho(pos.start, pos.end)}`;
    if (pior && pior.dt > quadro + 1e-3)
      out.push({ regra: 'boca-outro-momento', ok: false, medido: pior.outro ? `imagem de outro clipe: ${pior.outro}` : `imagem do bruto em ${tt(pior.img)} sob a voz de ${tt(pior.voz)} (Δ ${n(pior.dt, 2)} s = ${Math.round(pior.dt * fps)} quadros)`, limite: '≤ 1 quadro', onde, at: pos.start });
    else if (desconhecido) avisos.push(`cobertura do mesmo falante sem instante verificável pelo projeto em ${onde} (arquivo sem tempo de origem no nome nem syncOffset): a sincronia por trecho confere pela imagem`);
  }
  // Cobertura embutida: arquivo do falante com "cob" no nome na trilha principal (a troca de imagem está dentro dele).
  // Com os cortes da entrega, acusa o clipe onde a troca aparece; sem corte em nenhum clipe do arquivo, acusa todos.
  const cortes = med.cortes ?? [];
  const usados = new Set<number>();
  const cob = tl.main
    .map((c, i) => ({ c, i, t0: starts[i]!, t1: starts[i]! + clipDuration(c), a: assets.get(c.assetId) }))
    .filter((x) => x.a && ehCob(x.a.path) && temFala({ start: x.t0, end: x.t1 }))
    .map((x) => ({ ...x, dentro: cortes.filter((t) => t > x.t0 + 3 * quadro && t < x.t1 - 3 * quadro && !bordas.some((b) => Math.abs(b - t) <= 3 * quadro)) }));
  for (const x of cob) {
    const localizado = cob.some((y) => y.a === x.a && y.dentro.length);
    if (med.cortes && localizado && !x.dentro.length) continue;
    x.dentro.forEach((t) => usados.add(t));
    out.push({ regra: 'boca-outro-momento', ok: false, medido: `cobertura embutida no arquivo (nome "cob")${x.dentro.length ? `; troca de plano dentro do clipe em ${x.dentro.map((t) => n(t, 2)).join(', ')} s` : med.cortes ? '; troca de plano não localizada (pode coincidir com o corte)' : ''}`, limite: 'imagem no instante da voz', onde: `clipe ${x.i + 1} (${nome(x.a!.id)}) em ${trecho(x.t0, x.t1)}`, at: x.dentro[0] ?? x.t0 });
  }
  if (!out.some((x) => x.regra === 'boca-outro-momento')) out.push({ regra: 'boca-outro-momento', ok: true, medido: 'nenhuma cobertura do falante fora do instante', limite: '≤ 1 quadro' });

  // Corte na entrega que a timeline não explica (dentro de um clipe, fora de overlay de outra coisa): troca de plano embutida no arquivo.
  if (med.cortes) {
    const soltos = cortes.filter((t) => !usados.has(t) && !bordas.some((b) => Math.abs(b - t) <= 3 * quadro) && !coberto(t) && temFala({ start: t - 0.2, end: t + 0.2 }));
    for (const t of soltos) {
      const loc = locate(tl, t);
      out.push({ regra: 'corte-embutido', ok: false, medido: 'troca de plano dentro de um clipe, sob fala (o arquivo já traz outro trecho)', limite: 'corte só onde a timeline corta', onde: `${tt(t)}${loc ? ` (clipe ${loc.index + 1}, ${nome(loc.clip.cam ?? loc.clip.assetId)})` : ''}`, at: t });
    }
    if (!soltos.length) out.push({ regra: 'corte-embutido', ok: true, medido: 'todo corte da entrega está na timeline', limite: 'corte só onde a timeline corta' });
  }

  // (d) 2ª câmera com sincronia medida (pelo áudio, confiança ≥ 0,8).
  const cams = new Map<string, number[]>();
  tl.main.forEach((c, i) => c.cam && cams.set(c.cam, [...(cams.get(c.cam) ?? []), i]));
  for (const [id, idx] of cams) {
    const cam = assets.get(id);
    if (!cam) continue;
    const conf = cam.syncConfianca;
    const onde = `${nome(id)} (clipes ${idx.map((i) => i + 1).join(', ')}, desde ${tt(starts[idx[0]!]!)})`;
    const outraFala = idx.some((i) => cam.syncFala && tl.main[i]!.assetId !== cam.syncFala);
    let medido = '';
    if (cam.syncOffset === undefined) medido = 'sem syncOffset';
    else if (conf === undefined) medido = `offset ${n(cam.syncOffset, 2)} s sem medida pelo áudio (manual, ou sincronizada antes de 27/10): refaça "2ª câmera → alinhar pelo áudio"`;
    else if (conf < 0.8) medido = `confiança ${n(conf, 2)}`;
    else if (outraFala) medido = 'sincronizada com outra fala (syncFala)';
    out.push({ regra: 'sync-camera', ok: !medido, medido: medido || `offset ${n(cam.syncOffset ?? 0, 2)} s, confiança ${n(conf ?? 0, 2)}`, limite: 'alinhada pelo áudio, confiança ≥ 0,8', onde, at: starts[idx[0]!] });
  }
  return { achados: out, avisos };
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/** Freeze e câmera lenta sob fala (puro); `fora` = trechos cobertos por outra coisa (B-roll de terceiros). */
export function achadosMovimento(freezes: Trecho[], lentas: Trecho[], fala: Trecho[], fora: Trecho[] = []): QcAchado[] {
  const out: QcAchado[] = [];
  // `fora` juntado (inserts encostados cobrem um trecho só); 90% coberto = não é a imagem do falante.
  const junto = [...fora].sort((a, b) => a.start - b.start).reduce<Trecho[]>((acc, f) => {
    const u = acc[acc.length - 1];
    if (u && f.start <= u.end + 0.05) u.end = Math.max(u.end, f.end);
    else acc.push({ ...f });
    return acc;
  }, []);
  const longe = (t: Trecho) => junto.reduce((s, f) => s + overlap(f, t), 0) < (t.end - t.start) * 0.9;
  for (const f of freezes) {
    const d = f.end - f.start;
    const comFala = falaEm(fala, f);
    if (d >= LIMITES.freeze - 1e-3 && comFala >= Math.min(0.1, d / 2) && longe(f)) out.push({ regra: 'freeze-sob-fala', ok: false, medido: `imagem parada ${tt(d)} com ${tt(comFala)} de fala`, limite: `freeze < ${tt(LIMITES.freeze)} sob fala`, onde: trecho(f.start, f.end), at: f.start });
  }
  if (!out.length) out.push({ regra: 'freeze-sob-fala', ok: true, medido: `${freezes.length} freeze(s), nenhum ≥ ${tt(LIMITES.freeze)} com fala`, limite: `freeze < ${tt(LIMITES.freeze)} sob fala` });
  const lentasFala = lentas.filter((l) => falaEm(fala, l) >= 0.1 && longe(l));
  for (const l of lentasFala) out.push({ regra: 'camera-lenta', ok: false, medido: `quadros repetidos em cadência por ${tt(l.end - l.start)} com fala`, limite: 'sem repetição de quadro sob fala', onde: trecho(l.start, l.end), at: l.start });
  if (!lentasFala.length) out.push({ regra: 'camera-lenta', ok: true, medido: 'sem cadência de quadro repetido sob fala', limite: 'sem repetição de quadro sob fala' });
  return out;
}

/** Trechos da peça cobertos por B-roll/motion que não é o falante (para não acusar freeze de um gráfico parado). */
function cobertosPorOutro(project: Pick<Project, 'assets' | 'timeline'>): Trecho[] {
  const tl = normalizeTimeline(project.timeline);
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const falante = new Set(tl.main.flatMap((c) => [c.assetId, ...(c.cam ? [c.cam] : [])]));
  const sony = new Set([...falante].map((id) => clipeSony(assets.get(id)?.path ?? '')).filter(Boolean));
  const out: Trecho[] = [];
  for (const o of tl.overlays) {
    if ((o.role !== 'broll' && o.role !== 'motion') || !overlayActive(tl, o)) continue;
    const pos = resolveOverlay(tl, o);
    if (!pos) continue;
    if (o.source.type === 'composition') out.push(pos);
    if (o.source.type !== 'media') continue;
    const a = assets.get(o.source.assetId);
    if (a && !a.alpha && a.kind !== 'audio' && !falante.has(a.id) && a.role !== 'cam' && !sony.has(clipeSony(a.path))) out.push(pos);
  }
  return out;
}

/** Trechos da peça cuja imagem vem de fonte com fps diferente do da timeline (> 1%). */
function fpsConvertidos(project: Pick<Project, 'assets' | 'timeline'>): Trecho[] {
  const tl = normalizeTimeline(project.timeline);
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const fps = tl.fps || 29.97;
  const starts = clipStarts(tl);
  return tl.main.flatMap((c, i) => {
    const src = assets.get(c.cam ?? c.assetId);
    return src?.fps && Math.abs(src.fps / fps - 1) > 0.01 ? [{ start: starts[i]!, end: starts[i]! + clipDuration(c) }] : [];
  });
}

export async function qcTecnico(file: string, opts: QcTecnicoOpts = {}): Promise<QcTecnico> {
  const fps = opts.project?.timeline.fps ?? opts.fps ?? 29.97;
  const avisos: string[] = [];
  const perfil = await medirPerfil(file);
  const achados: QcAchado[] = achadosPerfil(perfil, fps);
  const [y, satavg, env, freezes, diffs] = await Promise.all([amostrarY(file), medirSatavg(file, perfil), envelopeVoz(file), medirFreezes(file), diferencasQuadro(file)]);
  achados.push(achadoNiveis(niveis(y)));
  const ass = opts.assinatura ?? ASSINATURA_PADRAO;
  if (!opts.assinatura) avisos.push(`saturação contra o ${ASSINATURA_PADRAO.fonte}`);
  // Sem a assinatura do cliente a régua do Leandro não vale para outro cliente: a saturação só avisa.
  const sat = achadoSaturacao(satavg, ass);
  if (!opts.assinatura && !sat.ok) avisos.push(`saturação baixa contra o padrão (${sat.medido}); sem assinatura do cliente, não reprova`);
  achados.push(opts.assinatura ? sat : { ...sat, ok: true });
  const fala = trechosDeFala(env);
  const fpsArq = valor(perfil.video?.avg_frame_rate) || valor(perfil.video?.r_frame_rate) || fps;
  for (const f of freezes) if (Number.isNaN(f.end)) f.end = perfil.duration;
  // Fonte em outro fps (23,976 numa timeline 29,97): o `fps=` do render repete 1 quadro a cada 4, cadência que não é
  // câmera lenta. Esses clipes ficam fora da regra de cadência (o freeze continua valendo).
  const conversao = opts.project ? fpsConvertidos(opts.project) : [];
  const lentas = camaraLenta(diffs, fpsArq).filter((l) => !conversao.some((c) => overlap(c, l) >= (l.end - l.start) * 0.5));
  achados.push(...achadosMovimento(freezes, lentas, fala, opts.project ? cobertosPorOutro(opts.project) : []));
  if (opts.project) {
    const r = achadosProjeto(opts.project, { fala, cortes: cortesDe(diffs, fpsArq), duracao: perfil.duration });
    achados.push(...r.achados);
    avisos.push(...r.avisos);
    // Sincronia por trecho: a imagem da entrega contra a fonte no instante da voz (precisa dos brutos no disco).
    const s = await syncPorTrecho(file, opts.project);
    achados.push(...s.achados);
    avisos.push(...s.avisos);
  } else avisos.push('sem projeto: escala, velocidade, cobertura e sincronia da câmera não conferidas');
  return { aprovado: achados.every((a) => a.ok), arquivo: file, achados, avisos };
}

/** Tabela curta do resultado (CLI e log do render): reprovações primeiro. */
export function tabelaQc(r: QcTecnico): string {
  const linhas = [`${r.aprovado ? 'APROVADO' : 'REPROVADO'}  ${path.basename(r.arquivo)}`];
  const ord = [...r.achados].sort((a, b) => Number(a.ok) - Number(b.ok));
  for (const a of ord) linhas.push(`  ${a.ok ? 'ok  ' : 'FALHA'} ${a.regra.padEnd(22)} ${a.medido}${a.ok ? '' : `  [limite: ${a.limite}]`}${a.onde ? `  @ ${a.onde}` : ''}`);
  for (const a of r.avisos) linhas.push(`  aviso: ${a}`);
  return linhas.join('\n');
}
