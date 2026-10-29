/**
 * Sincronia por trecho (FB-0180 A4/A5): a imagem da entrega comparada com a fonte no instante da voz, clipe a clipe.
 * A fonte passa pela MESMA geometria do render (reframe, zoom, âncora) e as duas viram miniaturas cinza normalizadas;
 * a correlação em ±0,5 s diz onde a imagem da entrega está na fonte. Deslocamento > 1 quadro = imagem fora do instante
 * da voz (cobertura de outro momento sem nome, quadro perdido na decodificação, câmera mal sincronizada).
 * Trecho sem movimento (correlação plana) ou coberto por B-roll/motion fica fora: não dá para afirmar nada.
 */
import { clipDuration, clipStarts, overlayActive, resolveOverlay, type Clip, type Project } from '@neweditor/core';
import { run } from './media.ts';
import { deliverySize, exactFps, fpsRational, segmentVideoFilter } from './render.ts';
import type { QcAchado } from './qc-tecnico.ts';

const TW = 36;
const TH = 64;
/** Folga de busca na fonte (s) de cada lado. */
const MARGEM = 0.5;
const JANELA = 1.0;
const MAX_TRECHOS = 12;

async function thumbs(args: string[]): Promise<Float32Array[]> {
  const raw = await run('ffmpeg', ['-v', 'error', ...args, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const n = TW * TH;
  const out: Float32Array[] = [];
  for (let i = 0; i + n <= raw.length; i += n) {
    const f = new Float32Array(n);
    let m = 0;
    for (let k = 0; k < n; k++) m += f[k] = raw[i + k]!;
    m /= n;
    let s = 0;
    for (let k = 0; k < n; k++) s += (f[k]! - m) ** 2;
    s = Math.sqrt(s / n) + 1e-6;
    for (let k = 0; k < n; k++) f[k] = (f[k]! - m) / s;
    out.push(f);
  }
  return out;
}

/** Melhor deslocamento (quadros) de `a` dentro de `b` e o contraste da curva (melhor − mediana). Puro. */
export function melhorLag(a: Float32Array[], b: Float32Array[]): { lag: number; corr: number; contraste: number } | null {
  const L = a.length;
  if (L < 5 || b.length < L) return null;
  const n = a[0]!.length;
  const sc: number[] = [];
  for (let k = 0; k + L <= b.length; k++) {
    let s = 0;
    for (let i = 0; i < L; i++) {
      const x = a[i]!, y = b[k + i]!;
      let d = 0;
      for (let j = 0; j < n; j++) d += x[j]! * y[j]!;
      s += d / n;
    }
    sc.push(s / L);
  }
  let lag = 0;
  for (let k = 1; k < sc.length; k++) if (sc[k]! > sc[lag]!) lag = k;
  const med = [...sc].sort((x, y) => x - y)[Math.floor(sc.length / 2)]!;
  return { lag, corr: sc[lag]!, contraste: sc[lag]! - med };
}

/** Trechos da faixa principal que dá para conferir: sem rampa, velocidade nem congelamento, e sem camada por cima. */
function trechos(p: Pick<Project, 'assets' | 'timeline'>): { c: Clip; start: number; t0: number; len: number }[] {
  const tl = p.timeline;
  const starts = clipStarts(tl);
  // Camada com alfa (lettering, motion transparente) não esconde o rosto: só a de tela cheia tira o trecho.
  const opaca = (id: string) => { const a = p.assets.find((x) => x.id === id); return !!a && a.kind !== 'audio' && !a.alpha; };
  const capas = tl.overlays.filter((o) => (o.role === 'broll' || o.role === 'motion') && o.source.type === 'media' && opaca(o.source.assetId) && overlayActive(tl, o)).map((o) => resolveOverlay(tl, o)).filter((x): x is { start: number; end: number } => !!x);
  const out: { c: Clip; start: number; t0: number; len: number }[] = [];
  tl.main.forEach((c, i) => {
    const d = clipDuration(c);
    if (d < JANELA * 0.6 + 0.3 || (c.speed ?? 1) !== 1 || c.freeze || (c.zoomTo !== undefined && c.zoomTo !== c.zoom) || c.framingTo) return;
    const len = Math.min(JANELA, d - 0.3);
    // A janela livre de camada mais cedo no clipe (passo de 0,25 s).
    for (let t0 = starts[i]! + 0.15; t0 + len <= starts[i]! + d - 0.1; t0 += 0.25) {
      if (!capas.some((o) => o.start < t0 + len && o.end > t0)) {
        out.push({ c, start: starts[i]!, t0, len });
        return;
      }
    }
  });
  if (out.length <= MAX_TRECHOS) return out;
  return Array.from({ length: MAX_TRECHOS }, (_, k) => out[Math.floor((k * out.length) / MAX_TRECHOS)]!);
}

export async function syncPorTrecho(file: string, p: Pick<Project, 'assets' | 'timeline'>): Promise<{ achados: QcAchado[]; avisos: string[] }> {
  const tl = p.timeline;
  const fps = exactFps(tl.fps || 30);
  const { W, H } = deliverySize(tl);
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  const ruins: string[] = [];
  let conferidos = 0;
  let inconclusivos = 0;
  for (const { c, start, t0, len } of trechos(p)) {
    const a = assets.get(c.assetId);
    const cam = c.cam ? assets.get(c.cam) : undefined;
    const src = cam ?? a;
    if (!src || src.kind !== 'video') continue;
    const off = cam ? (cam.syncOffset ?? 0) : 0;
    const srcT = c.in + off + (t0 - start);
    const ss = Math.max(0, srcT - MARGEM);
    const geo = segmentVideoFilter(src, { ...c, zoomTo: undefined, framingTo: undefined, freeze: undefined }, fps, W, H, '', !!tl.reframe);
    let fin: Float32Array[], fon: Float32Array[];
    try {
      fin = await thumbs(['-ss', t0.toFixed(4), '-i', file, '-t', len.toFixed(4), '-vf', `fps=${fpsRational(fps)},scale=${TW}:${TH}`]);
      fon = await thumbs(['-ss', ss.toFixed(4), '-i', src.path, '-t', (srcT - ss + len + MARGEM).toFixed(4), '-vf', `${geo},scale=${TW}:${TH}`]);
    } catch {
      inconclusivos++;
      continue;
    }
    const r = melhorLag(fin, fon);
    if (!r || r.corr < 0.6 || r.contraste < 0.03) {
      inconclusivos++;
      continue;
    }
    conferidos++;
    const desloc = r.lag - Math.round((srcT - ss) * fps);
    if (Math.abs(desloc) > 1) ruins.push(`${t0.toFixed(2).replace('.', ',')} s (${src.name}: ${desloc > 0 ? '+' : ''}${desloc} quadros, corr ${r.corr.toFixed(2)})`);
  }
  const avisos = inconclusivos ? [`sync por trecho: ${inconclusivos} trecho(s) sem movimento ou sem fonte legível, não conferidos`] : [];
  if (!conferidos) return { achados: [], avisos: [...avisos, 'sync por trecho: nenhum trecho conferível'] };
  return {
    achados: [{ regra: 'sync-trecho', ok: !ruins.length, medido: ruins.length ? `imagem fora do instante da voz em ${ruins.join('; ')}` : `${conferidos} trecho(s) no instante da voz`, limite: '≤ 1 quadro', ...(ruins.length ? { onde: ruins[0] } : {}) }],
    avisos,
  };
}
