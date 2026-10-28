/**
 * Sincronia por trecho (FB-0180 A4/A5): a imagem da entrega comparada com a fonte no instante da voz, clipe a clipe.
 * A fonte passa pela MESMA geometria do render (reframe, zoom, âncora) e as duas viram miniaturas cinza normalizadas;
 * a correlação em ±0,5 s diz onde a imagem da entrega está na fonte. Deslocamento > 1 quadro = imagem fora do instante
 * da voz (cobertura de outro momento sem nome, quadro perdido na decodificação, câmera mal sincronizada).
 * Trecho sem movimento (correlação plana) ou coberto por B-roll/motion fica fora: não dá para afirmar nada.
 * Deslocamento sem pico nítido (máximo na borda da busca ou colado no 2º pico, CH-0040) é reconferido pelo sinal de
 * movimento em até 6 s com busca de ±1 s; só reprova se esse sinal também tiver pico nítido.
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
/** Reconferência pelo sinal de movimento quando a curva de luma é plana (CH-0040): janela e folga maiores. */
const JANELA_LONGA = 6.0;
const MARGEM_LONGA = 1.0;
/** Quanto o máximo precisa ficar acima do 2º pico (a mais de 2 quadros) para valer como prova. */
const FOLGA_LUMA = 0.05;
const FOLGA_MOV = 0.15;
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

/**
 * Melhor deslocamento (quadros) de `a` dentro de `b`, o contraste da curva (melhor − mediana), o 2º pico (melhor
 * correlação a mais de 2 quadros do máximo) e se o máximo caiu na borda da busca (o pico real pode estar fora). Puro.
 */
export function melhorLag(a: Float32Array[], b: Float32Array[]): { lag: number; corr: number; contraste: number; segundo: number; borda: boolean } | null {
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
  let segundo = -Infinity;
  for (let k = 0; k < sc.length; k++) if (Math.abs(k - lag) > 2 && sc[k]! > segundo) segundo = sc[k]!;
  return { lag, corr: sc[lag]!, contraste: sc[lag]! - med, segundo, borda: sc.length > 1 && (lag === 0 || lag === sc.length - 1) };
}

/** Sinal de movimento: quanto a imagem muda de um quadro para o seguinte (média de |diferença|). Ignora o fundo parado. Puro. */
export function movimento(f: Float32Array[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < f.length; i++) {
    const x = f[i]!, y = f[i + 1]!;
    let s = 0;
    for (let k = 0; k < x.length; k++) s += Math.abs(y[k]! - x[k]!);
    out.push(s / x.length);
  }
  return out;
}

/** Como melhorLag, para séries de movimento: correlação de Pearson de `a` contra cada janela de `b`. Puro. */
export function melhorLagMov(a: number[], b: number[]): ReturnType<typeof melhorLag> {
  const L = a.length;
  if (L < 10 || b.length < L) return null;
  const z = (v: number[]) => { const m = v.reduce((x, y) => x + y, 0) / v.length; const s = Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / v.length) + 1e-9; return v.map((x) => (x - m) / s); };
  const za = z(a);
  const sc: number[] = [];
  for (let k = 0; k + L <= b.length; k++) {
    const zb = z(b.slice(k, k + L));
    let s = 0;
    for (let i = 0; i < L; i++) s += za[i]! * zb[i]!;
    sc.push(s / L);
  }
  let lag = 0;
  for (let k = 1; k < sc.length; k++) if (sc[k]! > sc[lag]!) lag = k;
  const med = [...sc].sort((x, y) => x - y)[Math.floor(sc.length / 2)]!;
  let segundo = -Infinity;
  for (let k = 0; k < sc.length; k++) if (Math.abs(k - lag) > 2 && sc[k]! > segundo) segundo = sc[k]!;
  return { lag, corr: sc[lag]!, contraste: sc[lag]! - med, segundo, borda: sc.length > 1 && (lag === 0 || lag === sc.length - 1) };
}

/**
 * Só reprova com pico nítido (CH-0040): máximo dentro da busca e acima do 2º pico. Curva plana (plano quase parado logo
 * após o corte) põe o máximo em qualquer lugar, muitas vezes na borda, e isso não é prova de imagem fora do instante.
 */
const nitido = (r: { corr: number; segundo: number; borda: boolean }, folga: number) => r.corr >= 0.6 && !r.borda && r.corr - r.segundo >= folga;

/** Trechos da faixa principal que dá para conferir: sem rampa, velocidade nem congelamento, e sem camada por cima. */
function trechos(p: Pick<Project, 'assets' | 'timeline'>): { c: Clip; start: number; t0: number; len: number; longo: number }[] {
  const tl = p.timeline;
  const starts = clipStarts(tl);
  // Camada com alfa (lettering, motion transparente) não esconde o rosto: só a de tela cheia tira o trecho.
  const opaca = (id: string) => { const a = p.assets.find((x) => x.id === id); return !!a && a.kind !== 'audio' && !a.alpha; };
  const capas = tl.overlays.filter((o) => (o.role === 'broll' || o.role === 'motion') && o.source.type === 'media' && opaca(o.source.assetId) && overlayActive(tl, o)).map((o) => resolveOverlay(tl, o)).filter((x): x is { start: number; end: number } => !!x);
  const livre = (t0: number, len: number) => !capas.some((o) => o.start < t0 + len && o.end > t0);
  const out: { c: Clip; start: number; t0: number; len: number; longo: number }[] = [];
  tl.main.forEach((c, i) => {
    const d = clipDuration(c);
    if (d < JANELA * 0.6 + 0.3 || (c.speed ?? 1) !== 1 || c.freeze || (c.zoomTo !== undefined && c.zoomTo !== c.zoom) || c.framingTo) return;
    const len = Math.min(JANELA, d - 0.3);
    const fim = starts[i]! + d - 0.1;
    // A janela livre de camada mais cedo no clipe (passo de 0,25 s).
    for (let t0 = starts[i]! + 0.15; t0 + len <= fim; t0 += 0.25) {
      if (livre(t0, len)) {
        // Janela longa para o sinal de movimento: estende enquanto o clipe segue livre de camada (até JANELA_LONGA).
        let longo = len;
        while (longo + 0.25 <= JANELA_LONGA && t0 + longo + 0.25 <= fim && livre(t0, longo + 0.25)) longo += 0.25;
        out.push({ c, start: starts[i]!, t0, len, longo });
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
  let planos = 0;
  for (const { c, start, t0, len, longo } of trechos(p)) {
    const a = assets.get(c.assetId);
    const cam = c.cam ? assets.get(c.cam) : undefined;
    const src = cam ?? a;
    if (!src || src.kind !== 'video') continue;
    const off = cam ? (cam.syncOffset ?? 0) : 0;
    const srcT = c.in + off + (t0 - start);
    const geo = segmentVideoFilter(src, { ...c, zoomTo: undefined, framingTo: undefined, freeze: undefined }, fps, W, H, '', !!tl.reframe);
    // Imagem da entrega e da fonte (com folga `margem` de cada lado); devolve as miniaturas e o lag esperado (quadros).
    const ler = async (janela: number, margem: number) => {
      const ss = Math.max(0, srcT - margem);
      const fin = await thumbs(['-ss', t0.toFixed(4), '-i', file, '-t', janela.toFixed(4), '-vf', `fps=${fpsRational(fps)},scale=${TW}:${TH}`]);
      const fon = await thumbs(['-ss', ss.toFixed(4), '-i', src.path, '-t', (srcT - ss + janela + margem).toFixed(4), '-vf', `${geo},scale=${TW}:${TH}`]);
      return { fin, fon, esperado: Math.round((srcT - ss) * fps) };
    };
    let r: ReturnType<typeof melhorLag>, desloc: number;
    try {
      const m = await ler(len, MARGEM);
      r = melhorLag(m.fin, m.fon);
      if (!r || r.corr < 0.6 || r.contraste < 0.03) {
        inconclusivos++;
        continue;
      }
      desloc = r.lag - m.esperado;
      // Deslocamento sem pico nítido (curva plana, máximo na borda): confere pelo sinal de movimento em janela e busca
      // maiores. Só reprova se o movimento tiver pico nítido; se não tiver, o trecho fica sem veredito (CH-0040).
      if (Math.abs(desloc) > 1 && !nitido(r, FOLGA_LUMA)) {
        const l = await ler(longo, MARGEM_LONGA);
        const rm = melhorLagMov(movimento(l.fin), movimento(l.fon));
        if (!rm || !nitido(rm, FOLGA_MOV)) {
          planos++;
          continue;
        }
        r = rm;
        desloc = rm.lag - l.esperado;
      }
    } catch {
      inconclusivos++;
      continue;
    }
    conferidos++;
    if (Math.abs(desloc) > 1) ruins.push(`${t0.toFixed(2).replace('.', ',')} s (${src.name}: ${desloc > 0 ? '+' : ''}${desloc} quadros, corr ${r.corr.toFixed(2)})`);
  }
  const avisos = inconclusivos ? [`sync por trecho: ${inconclusivos} trecho(s) sem movimento ou sem fonte legível, não conferidos`] : [];
  if (planos) avisos.push(`sync por trecho: ${planos} trecho(s) com curva plana (máximo na borda ou sem pico nítido, nem no sinal de movimento), sem veredito: confira a olho`);
  if (!conferidos) return { achados: [], avisos: [...avisos, 'sync por trecho: nenhum trecho conferível'] };
  return {
    achados: [{ regra: 'sync-trecho', ok: !ruins.length, medido: ruins.length ? `imagem fora do instante da voz em ${ruins.join('; ')}` : `${conferidos} trecho(s) no instante da voz`, limite: '≤ 1 quadro', ...(ruins.length ? { onde: ruins[0] } : {}) }],
    avisos,
  };
}
