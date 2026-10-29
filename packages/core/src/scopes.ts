/**
 * Scopes de cor (BL-0159 C2): waveform de luma, parade RGB e vetorscópio, calculados sobre o quadro JÁ com a
 * grade (o mesmo pixel que o player mostra). Conta pura, sem DOM: o ColorPanel lê os pixels do canvas do
 * player e desenha as imagens que saem daqui.
 *
 * Convenções (as do Resolve em Rec.709): luma Y' = 0,2126 R' + 0,7152 G' + 0,0722 B' sobre os valores já
 * codificados; Cb = (B' − Y') / 1,8556 e Cr = (R' − Y') / 1,5748, ambos em −0,5..0,5.
 */

/** Níveis verticais do waveform e do parade (0 = preto embaixo, 255 = branco em cima). */
export const SCOPE_LEVELS = 256;
/** Lado do vetorscópio em células (Cb na horizontal, Cr na vertical, centro = neutro). */
export const VECTOR_SIZE = 256;
/** Linha de pele (I-line) no vetorscópio: 123° a partir do eixo +Cb, sentido anti-horário. */
export const SKIN_LINE_DEG = 123;

export interface Scopes {
  /** Colunas do waveform (largura da imagem reduzida). */
  cols: number;
  /** Contagem por coluna × nível, linha a linha: índice = nível * cols + coluna. */
  luma: Uint32Array;
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Contagem por célula do vetorscópio: índice = linha * VECTOR_SIZE + coluna (linha 0 = Cr máximo). */
  vector: Uint32Array;
  /** Pixels contados. */
  n: number;
}

/**
 * Conta os scopes de um quadro RGBA (8 bits, como o `getImageData`). `cols` é a resolução horizontal do waveform;
 * `rect` limita a área (em pixels) para não contar a tarja preta do letterbox.
 */
export function computeScopes(px: Uint8Array | Uint8ClampedArray, w: number, h: number, opts: { cols?: number; rect?: { x: number; y: number; w: number; h: number } } = {}): Scopes {
  const r0 = opts.rect ?? { x: 0, y: 0, w, h };
  const x0 = Math.max(0, Math.floor(r0.x));
  const y0 = Math.max(0, Math.floor(r0.y));
  const x1 = Math.min(w, Math.ceil(r0.x + r0.w));
  const y1 = Math.min(h, Math.ceil(r0.y + r0.h));
  const cw = Math.max(1, x1 - x0);
  const cols = Math.max(1, Math.min(opts.cols ?? 256, cw));
  const L = SCOPE_LEVELS;
  const V = VECTOR_SIZE;
  const luma = new Uint32Array(cols * L);
  const r = new Uint32Array(cols * L);
  const g = new Uint32Array(cols * L);
  const b = new Uint32Array(cols * L);
  const vector = new Uint32Array(V * V);
  // Coluna de cada x, uma vez por quadro (evita a divisão no laço interno).
  const colOf = new Uint16Array(cw);
  for (let x = 0; x < cw; x++) colOf[x] = Math.min(cols - 1, Math.floor((x * cols) / cw));
  const vs = V - 1;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    let i = (y * w + x0) * 4;
    for (let x = 0; x < cw; x++, i += 4) {
      const R = px[i]!;
      const G = px[i + 1]!;
      const B = px[i + 2]!;
      const c = colOf[x]!;
      const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      luma[((Y + 0.5) | 0) * cols + c]!++;
      r[R * cols + c]!++;
      g[G * cols + c]!++;
      b[B * cols + c]!++;
      // Cb e Cr em −0,5..0,5 → célula; Cr para cima.
      const cb = (B - Y) / (255 * 1.8556);
      const cr = (R - Y) / (255 * 1.5748);
      const vx = ((cb + 0.5) * vs + 0.5) | 0;
      const vy = ((0.5 - cr) * vs + 0.5) | 0;
      vector[vy * V + vx]!++;
      n++;
    }
  }
  return { cols, luma, r, g, b, vector, n };
}

/** Célula (coluna, linha) do vetorscópio em que cai uma cor R'G'B' em 0..1. Usado no teste e na linha de pele. */
export function vectorCell(R: number, G: number, B: number): { x: number; y: number; angleDeg: number; sat: number } {
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const cb = (B - Y) / 1.8556;
  const cr = (R - Y) / 1.5748;
  const vs = VECTOR_SIZE - 1;
  const deg = (Math.atan2(cr, cb) * 180) / Math.PI;
  return { x: Math.round((cb + 0.5) * vs), y: Math.round((0.5 - cr) * vs), angleDeg: deg < 0 ? deg + 360 : deg, sat: Math.hypot(cb, cr) };
}

/** Intensidade de exibição: raiz da contagem normalizada pelo pico (os traços fracos continuam visíveis). */
function intensity(hist: Uint32Array): (v: number) => number {
  let peak = 0;
  for (const v of hist) if (v > peak) peak = v;
  const k = peak ? 1 / Math.sqrt(peak) : 0;
  return (v) => (v ? Math.min(1, 0.18 + 0.82 * Math.sqrt(v) * k) : 0);
}

/**
 * Imagem RGBA (cols × SCOPE_LEVELS) do waveform de luma, ou do parade RGB (3·cols × SCOPE_LEVELS, R | G | B lado a lado).
 * Branco em cima, preto embaixo, como no Resolve.
 */
export function waveformImage(s: Scopes, mode: 'luma' | 'parade'): { width: number; height: number; data: Uint8ClampedArray } {
  const L = SCOPE_LEVELS;
  const parts: [Uint32Array, [number, number, number]][] = mode === 'luma' ? [[s.luma, [235, 240, 235]]] : [[s.r, [255, 70, 70]], [s.g, [70, 235, 90]], [s.b, [80, 140, 255]]];
  const width = s.cols * parts.length;
  const data = new Uint8ClampedArray(width * L * 4);
  parts.forEach(([hist, [cr, cg, cb]], p) => {
    const f = intensity(hist);
    for (let lv = 0; lv < L; lv++) {
      const row = L - 1 - lv;
      for (let c = 0; c < s.cols; c++) {
        const a = f(hist[lv * s.cols + c]!);
        if (!a) continue;
        const o = (row * width + p * s.cols + c) * 4;
        data[o] = cr * a;
        data[o + 1] = cg * a;
        data[o + 2] = cb * a;
        data[o + 3] = 255;
      }
    }
  });
  return { width, height: L, data };
}

/** Imagem RGBA (VECTOR_SIZE²) do vetorscópio: cada célula tingida com a própria cor que representa. */
export function vectorImage(s: Scopes): { width: number; height: number; data: Uint8ClampedArray } {
  const V = VECTOR_SIZE;
  const data = new Uint8ClampedArray(V * V * 4);
  const f = intensity(s.vector);
  const vs = V - 1;
  for (let y = 0; y < V; y++) {
    const cr = 0.5 - y / vs;
    for (let x = 0; x < V; x++) {
      const a = f(s.vector[y * V + x]!);
      if (!a) continue;
      const cb = x / vs - 0.5;
      // Cor da célula com Y' = 0,6 (tingimento leve: mostra para onde a cor puxa).
      const Y = 0.6;
      const R = Y + 1.5748 * cr;
      const B = Y + 1.8556 * cb;
      const G = (Y - 0.2126 * R - 0.0722 * B) / 0.7152;
      const o = (y * V + x) * 4;
      const mix = (v: number) => 255 * a * (0.45 + 0.55 * Math.min(1, Math.max(0, v)));
      data[o] = mix(R);
      data[o + 1] = mix(G);
      data[o + 2] = mix(B);
      data[o + 3] = 255;
    }
  }
  return { width: V, height: V, data };
}
