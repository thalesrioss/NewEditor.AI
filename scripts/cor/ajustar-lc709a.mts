/**
 * BL-0159 C1 — de onde vêm `LC709A_MATRIX` e `LC709A_TONE` (packages/core/src/color.ts). Roda uma vez, fora do app:
 * a LUT oficial da Sony (SLog3SGamut3.CineToLC-709TypeA.cube, v1.04.04, vem com o DaVinci) é só a régua do ajuste;
 * o app nunca a lê.
 *
 *  1. curva de tom: 17 nós em Catmull-Rom sobre o código S-Log3, mínimos quadrados no eixo neutro da oficial;
 *  2. matriz em linear de cena (linhas somam 1, cinza fica cinza), partindo da pública S-Gamut3.Cine → Rec.709,
 *     Nelder-Mead minimizando o ΔE2000 médio contra a oficial nos pixels de quadros S-Log3 reais.
 *
 * Uso:
 *   node scripts/cor/ajustar-lc709a.mts <oficial.cube> <quadro.rgb48> [<quadro.rgb48> …]
 * Quadros: rgb48le cru, código S-Log3 de faixa cheia, ex.:
 *   ffmpeg -ss 2 -i C3030.MP4 -frames:v 1 -vf "scale=270:480:in_color_matrix=bt709:in_range=pc:out_range=pc:flags=area,format=rgb48le" -f rawvideo C3030.rgb48
 * (o quadro medido na régua, C3039, fica FORA do ajuste).
 */
import fs from 'node:fs';

type V3 = [number, number, number];
const [official, ...frames] = process.argv.slice(2);
if (!official || !frames.length) throw new Error('uso: ajustar-lc709a.mts <oficial.cube> <quadro.rgb48>…');

const cube = (() => {
  let n = 0;
  const v: number[] = [];
  for (const raw of fs.readFileSync(official, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (/^LUT_3D_SIZE/i.test(l)) n = Number(l.split(/\s+/)[1]);
    else if (/^[-+\d.]/.test(l)) v.push(...l.split(/\s+/).slice(0, 3).map(Number));
  }
  return { n, data: v };
})();
const node = (r: number, g: number, b: number): V3 => {
  const i = ((b * cube.n + g) * cube.n + r) * 3;
  return [cube.data[i]!, cube.data[i + 1]!, cube.data[i + 2]!];
};
const sample = (rgb: V3): V3 => {
  const n = cube.n;
  const p = rgb.map((v) => Math.min(1, Math.max(0, v)) * (n - 1));
  const i = p.map((v) => Math.min(n - 2, Math.floor(v)));
  const f = p.map((v, k) => v - i[k]!);
  const o: V3 = [0, 0, 0];
  for (let db = 0; db < 2; db++)
    for (let dg = 0; dg < 2; dg++)
      for (let dr = 0; dr < 2; dr++) {
        const w = (dr ? f[0]! : 1 - f[0]!) * (dg ? f[1]! : 1 - f[1]!) * (db ? f[2]! : 1 - f[2]!);
        const v = node(i[0]! + dr, i[1]! + dg, i[2]! + db);
        for (let k = 0; k < 3; k++) o[k] += w * v[k]!;
      }
  return o;
};

// Curva S-Log3 publicada pela Sony.
const decode = (x: number) => {
  const v = x * 1023;
  return v >= 171.2102946929 ? Math.pow(10, (v - 420) / 261.5) * 0.19 - 0.01 : ((v - 95) * 0.01125) / (171.2102946929 - 95);
};
const encode = (l: number) => (l >= 0.01125 ? 420 + Math.log10((l + 0.01) / 0.19) * 261.5 : 95 + (l * (171.2102946929 - 95)) / 0.01125) / 1023;

// Catmull-Rom uniforme (linear nos valores dos nós).
function crWeights(K: number, u: number): number[] {
  const t = Math.min(1, Math.max(0, u)) * (K - 1);
  const i = Math.min(K - 2, Math.floor(t)), f = t - i;
  const c = [-0.5 * f ** 3 + f * f - 0.5 * f, 1.5 * f ** 3 - 2.5 * f * f + 1, -1.5 * f ** 3 + 2 * f * f + 0.5 * f, 0.5 * f ** 3 - 0.5 * f * f];
  const w = new Array<number>(K).fill(0);
  [i - 1, i, i + 1, i + 2].forEach((j, q) => (w[Math.max(0, Math.min(K - 1, j))]! += c[q]!));
  return w;
}
const cr = (k: number[], u: number) => crWeights(k.length, u).reduce((s, w, j) => s + w * k[j]!, 0);

// 1. Curva de tom: mínimos quadrados no eixo neutro (média dos 3 canais).
const K = 17;
const A = Array.from({ length: K }, () => new Array<number>(K).fill(0));
const bv = new Array<number>(K).fill(0);
for (let i = 0; i < cube.n; i++) {
  const o = node(i, i, i);
  const y = (o[0] + o[1] + o[2]) / 3;
  const w = crWeights(K, i / (cube.n - 1));
  for (let a = 0; a < K; a++) {
    bv[a]! += w[a]! * y;
    for (let c = 0; c < K; c++) A[a]![c]! += w[a]! * w[c]!;
  }
}
for (let i = 0; i < K; i++) {
  for (let r = i + 1; r < K; r++) {
    const m = A[r]![i]! / A[i]![i]!;
    for (let c = i; c < K; c++) A[r]![c]! -= m * A[i]![c]!;
    bv[r]! -= m * bv[i]!;
  }
}
const tone = new Array<number>(K);
for (let i = K - 1; i >= 0; i--) {
  let s = bv[i]!;
  for (let c = i + 1; c < K; c++) s -= A[i]![c]! * tone[c]!;
  tone[i] = s / A[i]![i]!;
}

// ΔE2000 (exibição Rec.709, EOTF 2,4, D65).
const XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
const WP = [0.95047, 1, 1.08883];
const lab = (rgb: V3): V3 => {
  const l = rgb.map((v) => Math.pow(Math.min(1, Math.max(0, v)), 2.4));
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [0, 1, 2].map((i) => f((XYZ[i * 3]! * l[0]! + XYZ[i * 3 + 1]! * l[1]! + XYZ[i * 3 + 2]! * l[2]!) / WP[i]!)) as V3;
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
function de2000([L1, a1, b1]: V3, [L2, a2, b2]: V3): number {
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (x: number, y: number) => (x === 0 && y === 0 ? 0 : (Math.atan2(y, x) / rad + 360) % 360);
  const h1p = hue(a1p, b1), h2p = hue(a2p, b2);
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p < -180 ? h2p - h1p + 360 : h2p - h1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) > 180 ? (hbp + (hbp < 360 ? 360 : -360)) / 2 : hbp / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * 30 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad) * RC;
  return Math.sqrt(((L2 - L1) / SL) ** 2 + ((C2p - C1p) / SC) ** 2 + (dHp / SH) ** 2 + RT * ((C2p - C1p) / SC) * (dHp / SH));
}

// 2. Matriz: pixels reais (1 a cada 31), Nelder-Mead nos 6 termos livres.
const px: V3[] = [];
for (const f of frames) {
  const b = fs.readFileSync(f);
  for (let i = 0; i + 6 <= b.length; i += 6 * 31) px.push([b.readUInt16LE(i) / 65535, b.readUInt16LE(i + 2) / 65535, b.readUInt16LE(i + 4) / 65535]);
}
const ref = px.map((p) => lab(sample(p)));
const lin = px.map((p) => p.map(decode) as V3);
const full = (p: number[]) => [p[0]!, p[1]!, 1 - p[0]! - p[1]!, p[2]!, p[3]!, 1 - p[2]! - p[3]!, p[4]!, p[5]!, 1 - p[4]! - p[5]!];
const loss = (p: number[]) => {
  const m = full(p);
  let s = 0;
  for (let i = 0; i < lin.length; i++) {
    const [r, g, b] = lin[i]!;
    s += de2000(lab([0, 1, 2].map((k) => cr(tone, encode(m[k * 3]! * r + m[k * 3 + 1]! * g + m[k * 3 + 2]! * b))) as V3), ref[i]!);
  }
  return s / lin.length;
};
function nelderMead(f: (x: number[]) => number, x0: number[], iters: number, step: number) {
  let P = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))].map((x) => ({ x, v: f(x) }));
  const n = x0.length;
  for (let it = 0; it < iters; it++) {
    P.sort((a, b) => a.v - b.v);
    const cen = x0.map((_, j) => P.slice(0, n).reduce((s, p) => s + p.x[j]!, 0) / n);
    const w = P[n]!;
    const r = cen.map((c, j) => c + (c - w.x[j]!));
    const vr = f(r);
    if (vr < P[0]!.v) {
      const e = cen.map((c, j) => c + 2 * (c - w.x[j]!));
      const ve = f(e);
      P[n] = ve < vr ? { x: e, v: ve } : { x: r, v: vr };
    } else if (vr < P[n - 1]!.v) P[n] = { x: r, v: vr };
    else {
      const k = cen.map((c, j) => c + 0.5 * (w.x[j]! - c));
      const vk = f(k);
      if (vk < w.v) P[n] = { x: k, v: vk };
      else P = P.map((p, i) => (i === 0 ? p : (() => { const x = p.x.map((v, j) => P[0]!.x[j]! + 0.5 * (v - P[0]!.x[j]!)); return { x, v: f(x) }; })()));
    }
  }
  return P.sort((a, b) => a.v - b.v)[0]!;
}
const PUB = [1.6269474, -0.5401385, -0.1785155, 1.4179409, -0.0444361, -0.1959199];
console.log(`pixels: ${px.length}; ΔE2000 médio com a matriz pública: ${loss(PUB).toFixed(3)}`);
let best = nelderMead(loss, PUB, 900, 0.05);
best = nelderMead(loss, best.x, 400, 0.01);
console.log(`ΔE2000 médio com a matriz ajustada: ${best.v.toFixed(3)}`);
console.log(`const LC709A_MATRIX: M3 = [${full(best.x).map((v) => +v.toFixed(6)).join(', ')}];`);
console.log(`const LC709A_TONE = [${tone.map((v) => +v.toFixed(6)).join(', ')}];`);
