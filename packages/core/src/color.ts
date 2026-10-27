/**
 * Correção de cor → Rec.709. Um único LUT 3D sai daqui e é usado nos dois lados:
 * export (FFmpeg lut3d, arquivo .cube) e preview (textura 3D no WebGL) — o que se vê é o que se entrega.
 *
 * Pipeline por pixel:
 *   código (RGB do vídeo) → decodifica a curva LOG da câmera → linear de cena no gamut da câmera
 *   → matriz para o gamut Rec.709 (calculada das primárias publicadas) → balanço de branco + exposição
 *   → tone map fílmico → curva de exibição Rec.709 → contraste, altas/sombras, brancos/pretos, saturação.
 *
 * As curvas e primárias são as publicadas pelos fabricantes; o tone map é o da casa — por isso a conversão é um PONTO
 * DE PARTIDA, ajustável pelos controles primários. Quando a LUT oficial do fabricante está no disco (Sony S-Log3, a
 * que vem com o DaVinci), ela substitui curva + tone map (`inputLut`), como o Input Color Space do DaVinci.
 */

export type InputTransform = 'rec709' | 'slog3' | 'vlog' | 'clog3' | 'applelog' | 'flog2' | 'nlog' | 'logc3' | 'logc4' | 'bmdfilm5';

export interface ColorGrade {
  input: InputTransform;
  /** Exposição em stops (−3..3). */
  exposure: number;
  /** −1..1 em todos os controles abaixo, 0 = neutro. */
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  /** 0..2 (1 = neutro). */
  saturation: number;
  vibrance: number;
  /** Rodas de cor (lift/gamma/gain), RGB em −1..1, no espaço de exibição (como no DaVinci). */
  wheels?: { lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number] };
  /** HSL por faixa de matiz (8 faixas: vermelho, laranja, amarelo, verde, ciano, azul, roxo, magenta): matiz −1..1 (±30°), saturação −1..1, luminância −1..1. */
  hsl?: { h: number; s: number; l: number }[];
  /** Curvas (luma, R, G, B): 5 pontos de controle em x = 0, ¼, ½, ¾, 1 com o valor de saída 0..1 (identidade = [0, .25, .5, .75, 1]). */
  curves?: { luma: number[]; r: number[]; g: number[]; b: number[] };
  /**
   * Look (LUT .cube) aplicado DEPOIS da conversão e das primárias, com força 0–1 (CinePRO Looks ou importado).
   * `id` do catálogo CinePRO, ou um .cube do disco: `path` absoluto, que vira `id` = `local:<path>` (ver `localLutId`).
   */
  lut?: { id: string; nome: string; strength: number; path?: string };
  /** Textura, aplicada no quadro (não cabe na LUT): nitidez 0..1, vinheta 0..1, grão 0..1. Igual no WebGL e no FFmpeg. */
  sharpen?: number;
  vignette?: number;
  grain?: number;
  /**
   * Conversão de entrada pela LUT oficial do fabricante (como o Input Color Space do DaVinci): .cube "full in full out"
   * no lugar da curva + tone map da casa. Vem do arquivo (`MediaAsset.color`), não do editor: `manageGrade` põe.
   */
  inputLut?: { id: string; nome: string };
  /**
   * Como o RGB que chega (FFmpeg/navegador) vira valor de código da curva LOG: 'full' = já é o código (bruto yuvj de
   * câmera, faixa cheia: a conversão não expande); 'legal' (padrão) = faixa 64–940 expandida para 0..1.
   */
  codeRange?: 'full' | 'legal';
}

/** Espaço de cor de entrada de um arquivo, lido do próprio arquivo (XML da câmera) ou herdado do bruto de origem. */
export interface SourceColor {
  input: InputTransform;
  /** Como veio escrito no arquivo (ex.: s-log3-cine, s-gamut3-cine). */
  gamma?: string;
  gamut?: string;
  modelo?: string;
  /** 'xml' = metadado da câmera no arquivo; 'herdado' = de outro arquivo com o mesmo clipe (`de`). */
  fonte: 'xml' | 'herdado';
  de?: string;
  codeRange: 'full' | 'legal';
  /** LUT oficial de conversão encontrada no disco (id `local:<caminho>`). */
  inputLut?: { id: string; nome: string };
}

/**
 * Color management por clipe (como o DaVinci): arquivo LOG converte sempre pela entrada do arquivo, nunca como Rec.709.
 * Sem grade, devolve uma neutra só com a conversão. Arquivo Rec.709 (ou sem cor lida): a grade passa igual.
 */
export function manageGrade(g: ColorGrade | undefined, color: SourceColor | undefined): ColorGrade | undefined {
  if (!color || color.input === 'rec709') return g;
  const base = g ?? NEUTRAL_GRADE;
  const out: ColorGrade = { ...base, input: color.input, codeRange: color.codeRange };
  if (color.inputLut) out.inputLut = color.inputLut;
  else delete out.inputLut;
  return out;
}

/** A grade estava em Rec.709 sobre arquivo LOG (feita olhando a imagem lavada): os ajustes dela precisam ser revistos. */
export const gradeWasForced = (g: ColorGrade | undefined, color: SourceColor | undefined): boolean => !!g && !!color && color.input !== 'rec709' && g.input !== color.input;

/** Look de um .cube do disco (fora do catálogo CinePRO): o id carrega o caminho absoluto. */
export const LOCAL_LUT_PREFIX = 'local:';
export const localLutId = (file: string): string => `${LOCAL_LUT_PREFIX}${file}`;
/** O caminho do .cube de um look local, ou null se o look é do catálogo. */
export const localLutPath = (id: string | undefined): string | null => (id?.startsWith(LOCAL_LUT_PREFIX) ? id.slice(LOCAL_LUT_PREFIX.length) : null);

/** `lut: { path }` (sem id) vira um look local com id e nome; o resto passa igual. */
export function normalizeGradeLut(g: ColorGrade): ColorGrade {
  const l = g.lut as (Partial<NonNullable<ColorGrade['lut']>> & { path?: string }) | undefined;
  if (!l) return g;
  const file = l.path ?? localLutPath(l.id) ?? undefined;
  if (!file) return g;
  const strength = Number.isFinite(l.strength) ? Math.max(0, Math.min(1, Number(l.strength))) : 1;
  const nome = l.nome || file.split('/').pop()!.replace(/\.cube$/i, '');
  return { ...g, lut: { id: localLutId(file), nome, strength, path: file } };
}

export const NEUTRAL_GRADE: ColorGrade = { input: 'rec709', exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, saturation: 1, vibrance: 0 };

export const INPUT_TRANSFORMS: { id: InputTransform; label: string; camera: string }[] = [
  { id: 'rec709', label: 'Rec.709 (sem LOG)', camera: 'Perfil padrão / já corrigido' },
  { id: 'slog3', label: 'S-Log3 · S-Gamut3.Cine', camera: 'Sony (FX3, FX30, A7S III, A7 IV, ZV-E1…)' },
  { id: 'vlog', label: 'V-Log · V-Gamut', camera: 'Panasonic (GH5/6/7, S5, BGH1)' },
  { id: 'clog3', label: 'C-Log3 · Cinema Gamut', camera: 'Canon (R5 C, C70, R6 II, C300)' },
  { id: 'applelog', label: 'Apple Log · Rec.2020', camera: 'iPhone 15/16/17 Pro' },
  { id: 'flog2', label: 'F-Log2 · F-Gamut', camera: 'Fujifilm (X-H2S, X-S20, X-T5)' },
  { id: 'nlog', label: 'N-Log · Rec.2020', camera: 'Nikon (Z8, Z9, Zf, Z6 III)' },
  { id: 'logc3', label: 'LogC3 · ARRI Wide Gamut 3', camera: 'ARRI Alexa (EI 800)' },
  { id: 'logc4', label: 'LogC4 · ARRI Wide Gamut 4', camera: 'ARRI Alexa 35' },
  { id: 'bmdfilm5', label: 'Blackmagic Film Gen5', camera: 'Blackmagic (Pocket 4K/6K, Pyxis)' },
];

// ---------------------------------------------------------------------------------------------
// Curvas LOG → linear de cena. Entrada: valor de código normalizado (0..1 em escala de 10 bits).
// ---------------------------------------------------------------------------------------------

const DECODE: Record<InputTransform, (x: number) => number> = {
  rec709: (x) => Math.pow(Math.max(0, x), 2.4),
  slog3: (x) => {
    const v = x * 1023;
    return v >= 171.2102946929 ? Math.pow(10, (v - 420) / 261.5) * 0.19 - 0.01 : ((v - 95) * 0.01125) / (171.2102946929 - 95);
  },
  vlog: (x) => (x < 0.181 ? (x - 0.125) / 5.6 : Math.pow(10, (x - 0.598206) / 0.241514) - 0.00873),
  clog3: (x) => {
    const l = x < 0.097465473 ? -(Math.pow(10, (0.12783901 - x) / 0.36726845) - 1) / 14.98325 : x <= 0.15277891 ? (x - 0.12512219) / 1.9754798 : (Math.pow(10, (x - 0.12240537) / 0.36726845) - 1) / 14.98325;
    return l * 0.9;
  },
  applelog: (x) => {
    const R0 = -0.05641088, Rt = 0.01, c = 47.28711236, b = 0.00964052, g = 0.08550479, d = 0.69336945;
    const Pt = c * (Rt - R0) ** 2;
    return x >= Pt ? Math.pow(2, (x - d) / g) - b : x >= 0 ? Math.sqrt(x / c) + R0 : R0;
  },
  flog2: (x) => (x >= 0.100686685370811 ? (Math.pow(10, (x - 0.384316) / 0.245281) - 0.064829) / 5.555556 : (x - 0.092864) / 8.799461),
  nlog: (x) => {
    const v = x * 1023;
    return v < 452 ? Math.pow(v / 650, 3) - 0.0075 : Math.exp((v - 619) / 150);
  },
  logc3: (x) => (x > 0.149658 ? (Math.pow(10, (x - 0.385537) / 0.24719) - 0.052272) / 5.555556 : (x - 0.092809) / 5.367655),
  logc4: (x) => {
    const a = (2 ** 18 - 16) / 117.45, b = (1023 - 95) / 1023, c = 95 / 1023;
    const s = (7 * Math.LN2 * 2 ** (7 - (14 * c) / b)) / (a * b);
    const t = (2 ** (14 * (-c / b) + 6) - 64) / a;
    return x >= 0 ? (2 ** ((14 * (x - c)) / b + 6) - 64) / a : x * s + t;
  },
  bmdfilm5: (x) => (x < 8.283605932402494 * 0.005 + 0.09246575342465753 ? (x - 0.09246575342465753) / 8.283605932402494 : Math.exp((x - 0.5300133392291939) / 0.08692876065491224) - 0.005494072432257808),
};

/** Linear de cena → código (inversa do DECODE), só onde há LUT oficial de entrada. */
const ENCODE: Partial<Record<InputTransform, (l: number) => number>> = {
  slog3: (l) => (l >= 0.01125 ? 420 + Math.log10((l + 0.01) / 0.19) * 261.5 : 95 + (l * (171.2102946929 - 95)) / 0.01125) / 1023,
};

// ---------------------------------------------------------------------------------------------
// Gamuts: matriz para Rec.709 calculada das primárias (CIE xy) publicadas, branco D65.
// ---------------------------------------------------------------------------------------------

type XY = [number, number];
type M3 = [number, number, number, number, number, number, number, number, number];

const PRIMARIES: Record<string, [XY, XY, XY]> = {
  rec709: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]],
  rec2020: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]],
  sgamut3cine: [[0.766, 0.275], [0.225, 0.8], [0.089, -0.087]],
  vgamut: [[0.73, 0.28], [0.165, 0.84], [0.1, -0.03]],
  cinemagamut: [[0.74, 0.27], [0.17, 1.14], [0.08, -0.1]],
  awg3: [[0.684, 0.313], [0.221, 0.848], [0.0861, -0.102]],
  awg4: [[0.7347, 0.2653], [0.1424, 0.8576], [0.0991, -0.0308]],
  bmdwg5: [[0.7177, 0.3171], [0.228, 0.8616], [0.1006, -0.082]],
};
const GAMUT_OF: Record<InputTransform, keyof typeof PRIMARIES> = {
  rec709: 'rec709', slog3: 'sgamut3cine', vlog: 'vgamut', clog3: 'cinemagamut', applelog: 'rec2020', flog2: 'rec2020', nlog: 'rec2020', logc3: 'awg3', logc4: 'awg4', bmdfilm5: 'bmdwg5',
};
const D65: XY = [0.3127, 0.329];

function inv3(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
function mul3(m: M3, n: M3): M3 {
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) acc += m[i * 3 + k]! * n[k * 3 + j]!;
      r.push(acc);
    }
  return r as M3;
}
function rgbToXyz([r, g, b]: [XY, XY, XY]): M3 {
  const col = ([x, y]: XY) => [x / y, 1, (1 - x - y) / y] as const;
  const [R, G, B] = [col(r), col(g), col(b)];
  const P: M3 = [R[0], G[0], B[0], R[1], G[1], B[1], R[2], G[2], B[2]];
  const W = col(D65);
  const S = inv3(P);
  const s = [S[0] * W[0] + S[1] * W[1] + S[2] * W[2], S[3] * W[0] + S[4] * W[1] + S[5] * W[2], S[6] * W[0] + S[7] * W[1] + S[8] * W[2]];
  return [P[0] * s[0]!, P[1] * s[1]!, P[2] * s[2]!, P[3] * s[0]!, P[4] * s[1]!, P[5] * s[2]!, P[6] * s[0]!, P[7] * s[1]!, P[8] * s[2]!];
}
const TO_709 = new Map<string, M3>();
function toRec709(gamut: keyof typeof PRIMARIES): M3 {
  let m = TO_709.get(gamut);
  if (!m) {
    m = mul3(inv3(rgbToXyz(PRIMARIES.rec709!)), rgbToXyz(PRIMARIES[gamut]!));
    TO_709.set(gamut, m);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Pixel
// ---------------------------------------------------------------------------------------------

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Tone map fílmico (ajuste do ACES de Narkowicz), em linear de exibição. */
const filmic = (x: number) => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
/** Cinza médio (18%) cai em ~42% na exibição — referência de broadcast. */
const SCENE_SCALE = 0.6;

/**
 * Aplica a correção num pixel. Entrada: RGB do vídeo já em 0..1 (o FFmpeg e o navegador expandem a faixa
 * legal 64–940 para 0..1); a curva LOG espera o valor de código original, então volta para ele aqui.
 */
export function gradePixel(rgb: [number, number, number], g: ColorGrade, inputCube?: CubeLut | null): [number, number, number] {
  const decode = DECODE[g.input];
  const isLog = g.input !== 'rec709';
  // RGB 0..1 → valor de código de 10 bits normalizado (faixa legal expandida, ou já o código na fonte de faixa cheia).
  const code = (v: number) => (isLog && g.codeRange !== 'full' ? (64 + v * 876) / 1023 : v);
  const wr = 1 + 0.18 * g.temperature - 0.04 * g.tint;
  const wg = 1 + 0.12 * g.tint;
  const wb = 1 - 0.18 * g.temperature - 0.04 * g.tint;
  const lumaW = 0.2126 * wr + 0.7152 * wg + 0.0722 * wb;
  let out: number[];
  const encode = ENCODE[g.input];
  if (isLog && inputCube && encode) {
    // LUT oficial (Input Color Space do DaVinci): balanço e exposição em linear de cena no gamut da câmera, de volta
    // para a curva LOG, e a LUT do fabricante leva para a exibição. Grade neutra = a LUT pura.
    let c = rgb.map(code) as [number, number, number];
    if (g.exposure || g.temperature || g.tint) {
      const k = Math.pow(2, g.exposure);
      c = c.map((v, i) => encode(decode(v) * ((k * [wr, wg, wb][i]!) / lumaW))) as [number, number, number];
    }
    out = sampleCube(inputCube, c);
  } else {
    let [r, gg, b] = rgb.map((v) => decode(code(v))) as [number, number, number];
    const m = toRec709(GAMUT_OF[g.input]);
    [r, gg, b] = [m[0] * r + m[1] * gg + m[2] * b, m[3] * r + m[4] * gg + m[5] * b, m[6] * r + m[7] * gg + m[8] * b];

    // Balanço de branco (em linear) e exposição.
    const k = Math.pow(2, g.exposure) * (isLog ? SCENE_SCALE : 1);
    r *= (k * wr) / lumaW;
    gg *= (k * wg) / lumaW;
    b *= (k * wb) / lumaW;

    // Para a exibição: LOG passa pelo tone map fílmico; material Rec.709 só volta para a curva de exibição.
    const toDisplay = (v: number) => Math.pow(clamp(isLog ? filmic(Math.max(0, v)) : v), 1 / 2.4);
    out = [toDisplay(r), toDisplay(gg), toDisplay(b)];
  }

  // Ajustes primários, no espaço de exibição.
  const bl = g.blacks * 0.08;
  const wh = 1 - g.whites * 0.08;
  out = out.map((v) => clamp((v - bl) / Math.max(0.05, wh - bl), -0.2, 1.2));
  out = out.map((v) => {
    let y = v;
    y += g.shadows * 0.22 * (1 - smooth(0, 0.55, y)) * Math.max(0, y + 0.05);
    y += g.highlights * 0.2 * smooth(0.45, 1, y) * (1.05 - y);
    y = 0.42 + (y - 0.42) * (1 + g.contrast * 0.55);
    return y;
  });
  const Y = 0.2126 * out[0]! + 0.7152 * out[1]! + 0.0722 * out[2]!;
  const sat = Math.max(...out) - Math.min(...out);
  const s = g.saturation * (1 + g.vibrance * 0.6 * (1 - clamp(sat * 2)));
  out = out.map((v) => clamp(Y + (v - Y) * s));
  // Secundárias (fase 3, ADR-011): rodas, HSL por faixa e curvas, nesta ordem, no espaço de exibição.
  if (g.wheels) out = applyWheels(out as [number, number, number], g.wheels);
  if (g.hsl?.length) out = applyHsl(out as [number, number, number], g.hsl);
  if (g.curves) out = applyCurves(out as [number, number, number], g.curves);
  return out as [number, number, number];
}

const IDENTITY_CURVE = [0, 0.25, 0.5, 0.75, 1];
export const NEUTRAL_WHEELS: NonNullable<ColorGrade['wheels']> = { lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0] };
export const NEUTRAL_HSL: NonNullable<ColorGrade['hsl']> = Array.from({ length: 8 }, () => ({ h: 0, s: 0, l: 0 }));
export const NEUTRAL_CURVES: NonNullable<ColorGrade['curves']> = { luma: [...IDENTITY_CURVE], r: [...IDENTITY_CURVE], g: [...IDENTITY_CURVE], b: [...IDENTITY_CURVE] };
export const HSL_BANDS = ['Vermelho', 'Laranja', 'Amarelo', 'Verde', 'Ciano', 'Azul', 'Roxo', 'Magenta'] as const;
export const HSL_BAND_HUES = [0, 30, 60, 120, 180, 240, 280, 320];

/** Lift (sombras), gamma (meios-tons) e gain (altas), como as rodas do DaVinci: o efeito cai onde a luz está. */
function applyWheels(c: [number, number, number], w: NonNullable<ColorGrade['wheels']>): [number, number, number] {
  return c.map((v, i) => {
    let y = v + w.lift[i]! * 0.25 * (1 - v);
    y = y * (1 + w.gain[i]! * 0.5);
    const gm = Math.pow(2, -w.gamma[i]! * 0.8);
    y = Math.pow(clamp(y), gm);
    return clamp(y);
  }) as [number, number, number];
}

/** HSL por faixa de matiz com pesos suaves entre faixas vizinhas (sem degrau). */
function applyHsl(c: [number, number, number], bands: { h: number; s: number; l: number }[]): [number, number, number] {
  const max = Math.max(...c), min = Math.min(...c);
  const d = max - min;
  if (d < 1e-4) return c;
  const l = (max + min) / 2;
  const sat = d / (1 - Math.abs(2 * l - 1) || 1);
  let h = max === c[0] ? ((c[1] - c[2]) / d) % 6 : max === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  h = ((h * 60) % 360 + 360) % 360;
  let dh = 0, ds = 0, dl = 0, wsum = 0;
  bands.forEach((b, i) => {
    if (!b || (!b.h && !b.s && !b.l)) return;
    const center = HSL_BAND_HUES[i]!;
    let dist = Math.abs(h - center);
    dist = Math.min(dist, 360 - dist);
    const w = Math.max(0, 1 - dist / 40) * Math.min(1, sat * 3);
    if (w <= 0) return;
    dh += b.h * 30 * w;
    ds += b.s * w;
    dl += b.l * w;
    wsum += w;
  });
  if (!wsum) return c;
  const h2 = ((h + dh) % 360 + 360) % 360;
  const s2 = clamp(sat * (1 + ds * 0.8));
  const l2 = clamp(l + dl * 0.25 * (1 - Math.abs(2 * l - 1)));
  // HSL → RGB
  const C = (1 - Math.abs(2 * l2 - 1)) * s2;
  const X = C * (1 - Math.abs(((h2 / 60) % 2) - 1));
  const m = l2 - C / 2;
  const k = Math.floor(h2 / 60) % 6;
  const tbl: [number, number, number][] = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]];
  const [r, gg, b] = tbl[k]!;
  return [clamp(r + m), clamp(gg + m), clamp(b + m)];
}

/** Curva por 5 pontos (Catmull-Rom monotônica o bastante para cor): x = 0, ¼, ½, ¾, 1. */
export function curveAt(pts: number[], x: number): number {
  const p = pts.length === 5 ? pts : IDENTITY_CURVE;
  const t = clamp(x) * 4;
  const i = Math.min(3, Math.floor(t));
  const f = t - i;
  const p0 = p[Math.max(0, i - 1)]!, p1 = p[i]!, p2 = p[i + 1]!, p3 = p[Math.min(4, i + 2)]!;
  const v = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  return clamp(v);
}
function applyCurves(c: [number, number, number], cv: NonNullable<ColorGrade['curves']>): [number, number, number] {
  let out: [number, number, number] = [curveAt(cv.r, c[0]), curveAt(cv.g, c[1]), curveAt(cv.b, c[2])];
  const Y = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  const Y2 = curveAt(cv.luma, Y);
  const k = Y > 1e-4 ? Y2 / Y : 1;
  out = [clamp(out[0] * k), clamp(out[1] * k), clamp(out[2] * k)];
  return out;
}

/** Os ajustes de textura (nitidez, vinheta, grão) do grade, já com os padrões. */
export const textureOf = (g: ColorGrade | null | undefined) => ({ sharpen: g?.sharpen ?? 0, vignette: g?.vignette ?? 0, grain: g?.grain ?? 0 });
export const hasTexture = (g: ColorGrade | null | undefined) => !!g && ((g.sharpen ?? 0) > 0 || (g.vignette ?? 0) > 0 || (g.grain ?? 0) > 0);

/** Um LUT .cube lido: N³ amostras RGB (R varia mais rápido), com o domínio. */
export interface CubeLut {
  n: number;
  data: Float32Array;
  min: [number, number, number];
  max: [number, number, number];
  title?: string;
}

/** Lê um arquivo .cube (LUT_3D_SIZE; linhas "r g b"; DOMAIN_MIN/MAX opcionais). LUT 1D não é aceito. */
export function parseCube(text: string): CubeLut {
  let n = 0;
  let title: string | undefined;
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [1, 1, 1];
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, '');
    else if (up.startsWith('LUT_3D_SIZE')) n = Number(line.split(/\s+/)[1]);
    else if (up.startsWith('LUT_1D_SIZE')) throw new Error('LUT 1D não é suportada (precisa ser LUT_3D)');
    else if (up.startsWith('DOMAIN_MIN')) line.split(/\s+/).slice(1, 4).forEach((v, i) => (min[i] = Number(v)));
    else if (up.startsWith('DOMAIN_MAX')) line.split(/\s+/).slice(1, 4).forEach((v, i) => (max[i] = Number(v)));
    else if (/^[-+\d.]/.test(line)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) vals.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }
  if (!n || vals.length < n * n * n * 3) throw new Error(`.cube inválido (${n ? `esperava ${n ** 3} amostras, veio ${vals.length / 3}` : 'sem LUT_3D_SIZE'})`);
  return { n, data: Float32Array.from(vals.slice(0, n * n * n * 3)), min, max, title };
}

/** Amostra trilinear do .cube (entrada e saída em 0..1). */
export function sampleCube(c: CubeLut, rgb: [number, number, number]): [number, number, number] {
  const n = c.n;
  const idx = (r: number, g: number, b: number) => ((b * n + g) * n + r) * 3;
  const pos = rgb.map((v, i) => clamp((v - c.min[i]!) / Math.max(1e-6, c.max[i]! - c.min[i]!)) * (n - 1)) as [number, number, number];
  const i0 = pos.map((p) => Math.min(n - 2, Math.floor(p))) as [number, number, number];
  const f = pos.map((p, i) => p - i0[i]!) as [number, number, number];
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let acc = 0;
    for (let db = 0; db <= 1; db++)
      for (let dg = 0; dg <= 1; dg++)
        for (let dr = 0; dr <= 1; dr++) {
          const w = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2]);
          acc += w * c.data[idx(i0[0] + dr, i0[1] + dg, i0[2] + db) + k]!;
        }
    out[k] = clamp(acc);
  }
  return out;
}

/**
 * LUT 3D (N³), ordem do .cube: R varia mais rápido. Com `cube` (o look do grade, já lido), ele entra depois
 * da conversão e das primárias, na força pedida — igual no WebGL e no FFmpeg.
 */
export function buildLut(g: ColorGrade, n = 33, cube?: CubeLut | null, inputCube?: CubeLut | null): Float32Array {
  const lut = new Float32Array(n * n * n * 3);
  const k = g.lut && cube ? clamp(g.lut.strength) : 0;
  const inCube = g.inputLut ? inputCube : null;
  let i = 0;
  for (let bi = 0; bi < n; bi++)
    for (let gi = 0; gi < n; gi++)
      for (let ri = 0; ri < n; ri++) {
        let o = gradePixel([ri / (n - 1), gi / (n - 1), bi / (n - 1)], g, inCube);
        if (k > 0) {
          const l = sampleCube(cube!, o);
          o = [o[0] + (l[0] - o[0]) * k, o[1] + (l[1] - o[1]) * k, o[2] + (l[2] - o[2]) * k];
        }
        lut[i++] = o[0];
        lut[i++] = o[1];
        lut[i++] = o[2];
      }
  return lut;
}

export function lutToCube(lut: Float32Array, n = 33, title = 'NewEditor.AI'): string {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${n}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < lut.length; i += 3) lines.push(`${lut[i]!.toFixed(6)} ${lut[i + 1]!.toFixed(6)} ${lut[i + 2]!.toFixed(6)}`);
  return lines.join('\n') + '\n';
}

export const isNeutral = (g: ColorGrade | undefined) => !g || JSON.stringify(g) === JSON.stringify(NEUTRAL_GRADE);

/**
 * Palpite de entrada pela medida do quadro (valores de 10 bits): preto em ~95 é S-Log3; ~128 é V-Log/C-Log3.
 * A marca do arquivo desempata (XAVC = Sony).
 */
export function guessInput(stats: { ylow: number; ymax: number; sat: number }, brand = ''): InputTransform {
  // LOG: preto alto (S-Log3 ≈ 95/1023) e pouca saturação. Um S-Log3 bem exposto passa de 760 no YMAX — o preto
  // e a saturação é que denunciam, sobretudo em XAVC (Sony). Rec.709 de câmera tem preto perto de 64 e saturação > 12.
  const logBlack = stats.ylow >= 85 && stats.ylow <= 140;
  const sony = /xavc/i.test(brand);
  const flat = (stats.ymax < 760 && stats.sat < 12) || (logBlack && stats.sat < (sony ? 14 : 8));
  if (!flat) return 'rec709';
  if (/xavc/i.test(brand) || (stats.ylow >= 85 && stats.ylow <= 112)) return 'slog3';
  if (stats.ylow > 112 && stats.ylow <= 140) return 'vlog';
  return 'slog3';
}
