/**
 * Motions narrativos — composições em HTML que são FUNÇÃO PURA DO TEMPO (contrato do Motion Studio):
 * `motionHtml(spec, t)` desenha o quadro t do zero. Sem transição CSS, sem timer, sem estado entre quadros,
 * ruído só com semente. O mesmo HTML é desenhado ao vivo no player e capturado pelo Chrome no export.
 *
 * Unidades: `--u` = 1% da altura do quadro (igual à camada de texto), então o motion escala junto com o preview.
 */

export type MotionTemplateId = 'palavra' | 'pergunta' | 'contraste' | 'numero' | 'lista' | 'citacao';
export type NarrativeFunction = 'explain' | 'prove' | 'contrast' | 'reveal' | 'emotion' | 'reset';

export const NARRATIVE_FUNCTIONS: Record<NarrativeFunction, { label: string; desc: string }> = {
  explain: { label: 'Explicar', desc: 'o espectador precisa entender um conceito' },
  prove: { label: 'Provar', desc: 'um dado sustenta o que está sendo dito' },
  contrast: { label: 'Contrastar', desc: 'duas ideias em oposição' },
  reveal: { label: 'Revelar', desc: 'pergunta ou virada que prende a atenção' },
  emotion: { label: 'Emocionar', desc: 'o momento pede sentir, não entender' },
  reset: { label: 'Respiro', desc: 'muda de capítulo e reacende a atenção' },
};

export const MOTION_TEMPLATES: Record<MotionTemplateId, { label: string; desc: string; modo: 'sobre o vídeo' | 'corte' }> = {
  palavra: { label: 'Palavra-conceito', desc: 'A palavra que define a ideia ocupa o vazio acima da cabeça, com o fundo escurecido.', modo: 'sobre o vídeo' },
  pergunta: { label: 'Pergunta', desc: 'A pergunta se monta palavra por palavra no tempo da fala, com um "?" gigante atrás.', modo: 'sobre o vídeo' },
  contraste: { label: 'Contraste', desc: 'Os dois lados da ideia emolduram o rosto; o segundo ganha o acento ou risca o primeiro.', modo: 'sobre o vídeo' },
  numero: { label: 'Número gigante', desc: 'Corte para o número contando até o valor no instante em que ele é dito.', modo: 'corte' },
  lista: { label: 'Lista em cartões', desc: 'Corte para cartões que caem um a um, cada item no tempo em que é falado.', modo: 'corte' },
  citacao: { label: 'Citação em papel', desc: 'Um papel sobe sobre o corpo e a frase é datilografada no ritmo da fala.', modo: 'sobre o vídeo' },
};

export interface MotionStyle {
  bg: string;
  ink: string;
  accent: string;
  paper: string;
  paperInk: string;
  font: 'serif' | 'grotesk' | 'maquina';
  material: 'liso' | 'papel' | 'grao';
}

export interface MotionSpec {
  template: MotionTemplateId;
  funcao: NarrativeFunction;
  /** Fala literal do trecho (vai para o MOTION_SPEC e para a revisão humana). */
  fala: string;
  /** A imagem que mostra o que a fala diz (roteiro visual: frase ↔ imagem). */
  ideia: string;
  /** Elementos na tela (palavra, itens, número + unidade, lados A/B, palavras da frase). */
  texts: string[];
  /** Quando cada elemento entra, em segundos desde o início do motion — no tempo da fala. */
  beats: number[];
  /** Índice do elemento que leva o acento. */
  key?: number;
  kicker?: string;
  /** contraste: 'negacao' risca o primeiro lado ("não é X, é Y"). */
  variant?: string;
  refId?: string;
  refName?: string;
  style: MotionStyle;
  seed: number;
  /** false = motion mudo (sem SFX). */
  sfx?: boolean;
}

export const DEFAULT_MOTION_STYLE: MotionStyle = { bg: '#0b0d12', ink: '#f4f1ea', accent: '#E8B44A', paper: '#efe6d2', paperInk: '#1b1712', font: 'grotesk', material: 'grao' };

// ---------------------------------------------------------------------------
// Estilo a partir de uma referência (paleta + famílias do Mapa Estético)
// ---------------------------------------------------------------------------

const hexRgb = (h: string): [number, number, number] => {
  const m = h.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.padEnd(6, '0').slice(0, 6);
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
const lum = (h: string) => {
  const [r, g, b] = hexRgb(h).map((c) => c / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const relLum = (h: string) => {
  const [R, G, B] = hexRgb(h).map((c) => lin(c / 255)) as [number, number, number];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};
/** Razão de contraste WCAG entre duas cores. */
export const contrastRatio = (a: string, b: string) => {
  const x = relLum(a);
  const y = relLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const sat = (h: string) => {
  const c = hexRgb(h).map((x) => x / 255);
  const mx = Math.max(...c);
  const mn = Math.min(...c);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

export function styleFromReference(palette: string[], familias: string[]): MotionStyle {
  const pal = palette.filter((h) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)).map((h) => (h.startsWith('#') ? h : `#${h}`));
  const fam = familias.join(' ').toLowerCase();
  const font: MotionStyle['font'] = /document|ilustra/.test(fam) ? 'serif' : /papel|colagem/.test(fam) ? 'maquina' : 'grotesk';
  const material: MotionStyle['material'] = /papel|colagem/.test(fam) ? 'papel' : /grão|grao|ilustra|document/.test(fam) ? 'grao' : 'liso';
  if (pal.length < 2) return { ...DEFAULT_MOTION_STYLE, font, material };
  const byLum = [...pal].sort((a, b) => lum(a) - lum(b));
  const darkest = byLum[0]!;
  const lightest = byLum[byLum.length - 1]!;
  const bg = lum(darkest) < 0.22 ? darkest : '#0d0c0b';
  const ink = lum(lightest) > 0.6 ? lightest : '#f4f1ea';
  // Acento: a cor mais viva que não é nem o fundo nem a tinta (o "um vermelho" da obra).
  // Obra sem cor viva (P&B, capa cinza): o acento da casa, nunca um cinza.
  const vivid = [...pal].filter((h) => h !== bg && h !== ink && lum(h) > 0.12 && sat(h) > 0.3).sort((a, b) => sat(b) * (0.4 + lum(b)) - sat(a) * (0.4 + lum(a)))[0];
  const accent = vivid ?? DEFAULT_MOTION_STYLE.accent;
  const paper = pal.filter((h) => lum(h) > 0.62 && sat(h) < 0.35).sort((a, b) => lum(b) - lum(a))[0] ?? DEFAULT_MOTION_STYLE.paper;
  return { bg, ink, accent, paper, paperInk: lum(bg) < 0.15 ? bg : '#1b1712', font, material };
}

// ---------------------------------------------------------------------------
// Utilidades determinísticas
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Arredonda para a camada de texto reaproveitar quadros idênticos (holds). */
const r = (x: number, k = 2) => Math.round(x * 10 ** k) / 10 ** k;
const outCubic = (x: number) => 1 - Math.pow(1 - c01(x), 3);
const inOutCubic = (x: number) => {
  const v = c01(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
const outBack = (x: number) => {
  const v = c01(x);
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const u = (x: number) => `calc(var(--u)*${r(x)})`;
const rgba = (hex: string, a: number) => {
  const [R, G, B] = hexRgb(hex);
  return `rgba(${R},${G},${B},${r(c01(a), 3)})`;
};

// Fontes empacotadas primeiro (core/fonts.ts). A de máquina de escrever ainda é do sistema (sem OFL no pacote).
const FONTS: Record<MotionStyle['font'], string> = {
  serif: "'Playfair Display',Didot,Georgia,serif",
  grotesk: "Anton,'Bebas Neue','Avenir Next Condensed',sans-serif",
  maquina: '"American Typewriter","Courier New",Courier,monospace',
};
const WEIGHT: Record<MotionStyle['font'], number> = { serif: 700, grotesk: 400, maquina: 600 };
/** Largura média de um caractere em em, para caber a palavra na largura (sem medir o DOM). */
const CHAR_W: Record<MotionStyle['font'], number> = { serif: 0.54, grotesk: 0.58, maquina: 0.6 };
const UI_FONT = 'Menlo,"SF Mono",Monaco,monospace';

const displayCase = (s: string, f: MotionStyle['font']) => (f === 'grotesk' ? s.toLocaleUpperCase('pt-BR') : s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1));
const fit = (text: string, widthU: number, maxU: number, f: MotionStyle['font']) => Math.min(maxU, widthU / Math.max(1, text.length * CHAR_W[f]));
/** Tamanho que faz `chars` caberem em até `lines` linhas. */
const fitBlock = (chars: number, widthU: number, lines: number, maxU: number, f: MotionStyle['font']) => Math.min(maxU, (0.92 * lines * widthU) / Math.max(1, chars * CHAR_W[f]));

const GRAIN_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='luminanceToAlpha'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
);

/** Grão que "ferve" a 12 qps — mesma semente, mesmo quadro. Sem blend mode: preview e export iguais. */
function grain(s: MotionSpec, t: number, opacity: number): string {
  if (s.style.material === 'liso' || opacity <= 0.001) return '';
  const rnd = mulberry32(s.seed * 977 + Math.floor(t * 12));
  return `<div style="position:absolute;inset:0;background-image:url(&quot;data:image/svg+xml,${GRAIN_SVG}&quot;);background-size:${u(14)} ${u(14)};background-position:${Math.floor(rnd() * 220)}px ${Math.floor(rnd() * 220)}px;opacity:${r(opacity * 0.22, 3)}"></div>`;
}

/** Cor de texto legível sobre `on`: o acento quando ele tem contraste; senão a tinta mais forte. */
const legible = (st: MotionStyle, on: string) => (contrastRatio(st.accent, on) >= 2.4 ? st.accent : contrastRatio(st.paperInk, on) >= contrastRatio(st.ink, on) ? st.paperInk : st.ink);
/** Texto em acento; sem contraste (amarelo no papel), o acento vira marca-texto atrás da palavra. */
const accentText = (st: MotionStyle, on: string) =>
  contrastRatio(st.accent, on) >= 2.4 ? `color:${st.accent};` : `color:${legible(st, on)};background:linear-gradient(180deg,transparent 56%,${st.accent} 56%,${st.accent} 88%,transparent 88%);`;

const OUT = 0.35;
const exitOf = (t: number, dur: number) => inOutCubic((t - (dur - OUT)) / OUT);

/** Palavra que sobe de dentro de uma máscara (letra a letra). */
function riseLetters(text: string, t: number, at: number, stagger = 0.028): string {
  return [...text]
    .map((ch, i) => {
      const p = outCubic((t - at - i * stagger) / 0.42);
      return `<span style="display:inline-block;transform:translateY(${r((1 - p) * 108, 1)}%)">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`;
    })
    .join('');
}

function root(s: MotionSpec, body: string, clip = ''): string {
  const st = s.style;
  return `<div class="ne-motion" style="--m-bg:${st.bg};--m-ink:${st.ink};--m-accent:${st.accent};--m-fd:${FONTS[st.font].replace(/"/g, '&quot;')};--m-fw:${WEIGHT[st.font]};${clip ? `clip-path:${clip};` : ''}">${body}</div>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function palavra(s: MotionSpec, t: number, dur: number, wu: number): string {
  const st = s.style;
  const [word = '', sub = ''] = s.texts;
  const b0 = s.beats[0] ?? 0.2;
  const b1 = s.beats[1] ?? b0 + 0.7;
  const ex = exitOf(t, dur);
  const dim = inOutCubic(t / 0.3) * (1 - ex);
  const disp = displayCase(word, st.font);
  const size = fit(disp, wu * 0.84, wu > 100 ? 18 : 12.5, st.font);
  const kick = outCubic((t - b0 + 0.25) / 0.4);
  const rule = outCubic((t - b0 - 0.3) / 0.5);
  const subP = outCubic((t - b1) / 0.45);
  const glow = st.font === 'serif' ? `text-shadow:0 0 ${u(1.6)} ${rgba(st.accent, 0.45)};` : '';
  return root(
    s,
    `<div style="position:absolute;inset:0;background:linear-gradient(180deg,${rgba(st.bg, 0.94)} 0%,${rgba(st.bg, 0.72)} 26%,${rgba(st.bg, 0.25)} 50%,${rgba(st.bg, 0)} 72%);opacity:${r(dim, 3)}"></div>
    ${grain(s, t, dim)}
    <div style="position:absolute;left:8%;right:8%;top:${wu > 100 ? 14 : 8.5}%;transform:translateY(${u(-ex * 3)});clip-path:inset(0 0 ${r(ex * 100, 1)}% 0)">
      ${s.kicker ? `<div class="m-kicker" style="clip-path:inset(0 ${r((1 - kick) * 100, 1)}% 0 0)">${esc(s.kicker)}</div>` : ''}
      <div class="m-mask m-display" style="font-size:${u(size)};color:${st.accent};${glow}">${riseLetters(disp, t, b0)}</div>
      <div style="height:${u(0.32)};width:30%;background:${st.accent};transform-origin:left;transform:scaleX(${r(rule, 3)});margin-top:${u(1.2)}"></div>
      ${sub ? `<div class="m-sub" style="font-size:${u(2.5)};margin-top:${u(1.6)};clip-path:inset(0 0 ${r((1 - subP) * 100, 1)}% 0);transform:translateY(${u((1 - subP) * 1.2)})">${esc(sub)}</div>` : ''}
    </div>`,
  );
}

function pergunta(s: MotionSpec, t: number, dur: number, wu: number): string {
  const st = s.style;
  const ex = exitOf(t, dur);
  const dim = inOutCubic(t / 0.3) * (1 - ex);
  const words = s.texts.map((w) => (st.font === 'grotesk' ? w.toLocaleUpperCase('pt-BR') : w));
  const chars = words.join(' ').length;
  const width = wu * 0.84;
  const size = fitBlock(chars, width, wu > 100 ? 2 : 4, wu > 100 ? 9 : 7, st.font);
  const q = outBack(t / 0.55);
  const rot = -14 + 8 * c01(t / dur);
  const html = words
    .map((w, i) => {
      const p = outCubic((t - (s.beats[i] ?? 0) + 0.06) / 0.32);
      const isKey = i === s.key;
      return `<span class="m-mask" style="${isKey ? `color:${st.accent};font-size:1.14em;` : ''}"><span style="display:inline-block;transform:translateY(${r((1 - p) * 108, 1)}%)">${esc(w)}</span></span>`;
    })
    .join(' ');
  return root(
    s,
    `<div style="position:absolute;inset:0;background:${rgba(st.bg, 0.66)};opacity:${r(dim, 3)}"></div>
    ${grain(s, t, dim)}
    <div class="m-display" style="position:absolute;right:-8%;top:${wu > 100 ? 2 : 26}%;font-size:${u(wu > 100 ? 92 : 64)};line-height:1;color:transparent;-webkit-text-stroke:${u(0.35)} ${rgba(st.accent, 0.7)};transform:rotate(${r(rot, 2)}deg) scale(${r(q * (1 - ex * 0.15), 3)});opacity:${r(c01(q) * (1 - ex), 3)}">?</div>
    <div class="m-display" style="position:absolute;left:8%;width:${r(width / wu * 100, 2)}%;top:${wu > 100 ? 22 : 12}%;font-size:${u(size)};line-height:1.06;transform:translateY(${u(-ex * 3)});clip-path:inset(0 0 ${r(ex * 100, 1)}% 0)">${html}</div>`,
  );
}

function contraste(s: MotionSpec, t: number, dur: number, wu: number): string {
  const st = s.style;
  const [A = '', B = ''] = s.texts.map((x) => displayCase(x, st.font));
  const tA = s.beats[0] ?? 0.2;
  const tB = s.beats[1] ?? tA + 1;
  const ex = exitOf(t, dur);
  const dim = inOutCubic(t / 0.3) * (1 - ex);
  const land = wu > 100;
  const sizeA = fit(A, land ? wu * 0.36 : wu * 0.82, land ? 14 : 11.5, st.font);
  const sizeB = fit(B, land ? wu * 0.36 : wu * 0.82, land ? 14 : 11.5, st.font);
  const neg = s.variant === 'negacao';
  const strike = neg ? outCubic((t - tB + 0.1) / 0.32) : 0;
  const pB = outCubic((t - tB) / 0.4);
  const kA = outCubic((t - tA + 0.2) / 0.35);
  const posA = land ? 'left:6%;top:36%;width:38%' : 'left:8%;right:8%;top:9%';
  const posB = land ? 'right:6%;top:36%;width:38%;text-align:right' : 'left:8%;right:8%;top:63%;text-align:right';
  const bgGrad = land
    ? `linear-gradient(90deg,${rgba(st.bg, 0.9)} 0%,${rgba(st.bg, 0.3)} 34%,${rgba(st.bg, 0.12)} 50%,${rgba(st.bg, 0.3)} 66%,${rgba(st.bg, 0.9)} 100%)`
    : `linear-gradient(180deg,${rgba(st.bg, 0.92)} 0%,${rgba(st.bg, 0.4)} 26%,${rgba(st.bg, 0.12)} 44%,${rgba(st.bg, 0.4)} 58%,${rgba(st.bg, 0.92)} 100%)`;
  return root(
    s,
    `<div style="position:absolute;inset:0;background:${bgGrad};opacity:${r(dim, 3)}"></div>
    ${grain(s, t, dim)}
    <div style="position:absolute;${posA};transform:translateY(${u(-ex * 3)});clip-path:inset(0 0 ${r(ex * 100, 1)}% 0);opacity:${r(1 - strike * 0.5, 3)}">
      ${s.kicker ? `<div class="m-kicker" style="clip-path:inset(0 ${r((1 - kA) * 100, 1)}% 0 0)">${esc(s.kicker)}</div>` : ''}
      <div style="position:relative;display:inline-block">
        <div class="m-mask m-display" style="font-size:${u(sizeA)}">${riseLetters(A, t, tA)}</div>
        ${neg ? `<div style="position:absolute;left:-2%;top:52%;height:${u(Math.max(0.5, sizeA * 0.09))};width:104%;background:${st.accent};transform-origin:left;transform:scaleX(${r(strike, 3)}) rotate(-3deg)"></div>` : ''}
      </div>
    </div>
    <div style="position:absolute;${posB};transform:translateY(${u(ex * 3)});clip-path:inset(${r(ex * 100, 1)}% 0 0 0)">
      ${neg ? '' : `<div class="m-kicker" style="color:${rgba(st.ink, 0.75)};clip-path:inset(0 0 0 ${r((1 - pB) * 100, 1)}%)">×</div>`}
      <div class="m-mask m-display" style="font-size:${u(sizeB)};color:${st.accent}">${riseLetters(B, t, tB)}</div>
    </div>`,
  );
}

function numero(s: MotionSpec, t: number, dur: number, wu: number): string {
  const st = s.style;
  const [value = '0', unit = ''] = s.texts;
  const tN = s.beats[0] ?? 0.3;
  const wipeIn = inOutCubic(t / 0.34);
  const ex = exitOf(t, dur);
  const m = value.match(/^(\D*?)([\d.,]+)(\D*)$/);
  const prefix = m?.[1] ?? '';
  const num = m ? parseFloat(m[2]!.replace(/\./g, '').replace(',', '.')) : 0;
  const dec = m && m[2]!.includes(',') ? m[2]!.split(',')[1]!.length : 0;
  const suffix = m?.[3] ?? '';
  const p = outCubic((t - tN + 0.25) / 0.9);
  const shown = (num * p).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const full = `${prefix}${num.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${suffix}`;
  const land = wu > 100;
  const size = fit(full, land ? wu * 0.5 : wu * 0.84, land ? 40 : 30, st.font);
  const unitP = outCubic((t - tN - 0.35) / 0.45);
  const kick = outCubic((t - 0.2) / 0.45);
  const bg = st.material === 'papel' ? st.paper : st.bg;
  const fg = st.material === 'papel' ? st.paperInk : st.ink;
  const ticks = 24;
  const lit = Math.round(ticks * p);
  const bar = Array.from({ length: ticks }, (_, i) => `<span style="flex:1;height:100%;background:${i < lit ? st.accent : rgba(fg, 0.16)}"></span>`).join('');
  return root(
    s,
    `<div style="position:absolute;inset:0;background:${bg}"></div>
    ${grain(s, t, 1)}
    <div style="position:absolute;left:8%;right:8%;top:${land ? 22 : 27}%;color:${fg};transform:translateY(${u(-ex * 4)})">
      ${s.kicker ? `<div class="m-kicker" style="color:${legible(st, bg)};clip-path:inset(0 ${r((1 - kick) * 100, 1)}% 0 0)">${esc(s.kicker)}</div>` : ''}
      <div class="m-display" style="font-size:${u(size)};line-height:.95;${accentText(st, bg)}display:inline-block;font-variant-numeric:lining-nums tabular-nums;white-space:nowrap">${esc(prefix + shown + suffix)}</div>
      ${unit ? `<div class="m-mask m-display" style="display:block;width:fit-content;font-size:${u(Math.min(6, size * 0.3))};margin-top:${u(0.6)}"><span style="display:inline-block;transform:translateY(${r((1 - unitP) * 108, 1)}%)">${esc(displayCase(unit, st.font))}</span></span></div>` : ''}
      <div style="display:flex;gap:${u(0.35)};height:${u(2.2)};margin-top:${u(3.2)}">${bar}</div>
    </div>`,
    `inset(${r((1 - wipeIn) * 100, 1)}% 0 ${r(ex * 100, 1)}% 0)`,
  );
}

function lista(s: MotionSpec, t: number, dur: number, wu: number): string {
  const st = s.style;
  const wipeIn = inOutCubic(t / 0.34);
  const ex = exitOf(t, dur);
  const n = s.texts.length;
  const land = wu > 100;
  const cardW = land ? wu * 0.5 : wu * 0.84;
  const cardH = Math.min(11, 56 / Math.max(3, n));
  const gap = cardH * 0.24;
  const top = land ? 24 : 24;
  const paperCards = st.material !== 'liso';
  const rnd = mulberry32(s.seed);
  const cards = s.texts
    .map((item, i) => {
      const rot = (rnd() - 0.5) * 4.4;
      const dx = (rnd() - 0.5) * 3;
      const p = (t - (s.beats[i] ?? i * 0.6)) / 0.3;
      if (p <= 0) return '';
      const e = outBack(p);
      const txt = displayCase(item, st.font);
      const fs = fit(txt, cardW * 0.74, cardH * 0.46, st.font);
      return `<div style="position:absolute;left:calc(${land ? 25 : 8}% + ${u(dx)});top:${u(top + i * (cardH + gap))};width:${u(cardW)};height:${u(cardH)};transform:translateY(${u((1 - e) * -4)}) scale(${r(1.16 - 0.16 * e, 3)}) rotate(${r(rot, 2)}deg);background:${paperCards ? st.paper : rgba(st.ink, 0.08)};color:${paperCards ? st.paperInk : st.ink};box-shadow:0 ${u(0.5 + e)} ${u(1.8)} rgba(0,0,0,${r(0.25 + 0.2 * e, 3)});display:flex;align-items:center;gap:${u(2)};padding:0 ${u(2.4)};box-sizing:border-box">
        <span style="font-family:${UI_FONT};font-size:${u(cardH * 0.26)};color:${legible(st, paperCards ? st.paper : st.bg)};font-weight:700">${String(i + 1).padStart(2, '0')}</span>
        <span class="m-display" style="font-size:${u(fs)};line-height:1">${esc(txt)}</span>
        ${paperCards ? `<span style="position:absolute;left:44%;top:${u(-1.1)};width:${u(7)};height:${u(2.2)};background:rgba(255,250,235,.58);transform:rotate(${r((rnd() - 0.5) * 8, 2)}deg);box-shadow:0 ${u(0.15)} ${u(0.4)} rgba(0,0,0,.18)"></span>` : ''}
      </div>`;
    })
    .join('');
  const kick = outCubic((t - 0.2) / 0.45);
  return root(
    s,
    `<div style="position:absolute;inset:0;background:${st.bg}"></div>
    ${grain(s, t, 1)}
    ${s.kicker ? `<div class="m-kicker" style="position:absolute;left:${land ? 25 : 8}%;top:${u(top - 7)};clip-path:inset(0 ${r((1 - kick) * 100, 1)}% 0 0)">${esc(s.kicker)}</div>` : ''}
    <div style="position:absolute;inset:0;transform:translateY(${u(-ex * 4)})">${cards}</div>`,
    `inset(${r((1 - wipeIn) * 100, 1)}% 0 ${r(ex * 100, 1)}% 0)`,
  );
}

function citacao(s: MotionSpec, t: number, dur: number, wu: number): string {
  const st = s.style;
  const ex = exitOf(t, dur);
  const p = outCubic(t / 0.5);
  const dim = inOutCubic(t / 0.3) * (1 - ex);
  const land = wu > 100;
  const cardW = land ? wu * 0.56 : wu * 0.86;
  const chars = s.texts.join(' ').length;
  const size = fitBlock(chars, cardW * 0.84, land ? 3 : 5, land ? 5.4 : 4.1, st.font);
  const words = s.texts
    .map((w, i) => {
      const on = t >= (s.beats[i] ?? 0) - 0.02;
      if (i !== s.key) return `<span style="opacity:${on ? 1 : 0}">${esc(w)}</span>`;
      const lp = outCubic((t - (s.beats[i] ?? 0) - 0.15) / 0.4);
      return `<span style="position:relative;opacity:${on ? 1 : 0};color:${legible(st, st.paper)}">${esc(w)}<svg viewBox="0 0 100 20" preserveAspectRatio="none" style="position:absolute;left:-4%;bottom:-.32em;width:108%;height:.42em;overflow:visible"><path d="M2,13 C28,5 62,18 98,7" fill="none" stroke="${st.accent}" stroke-width="5" stroke-linecap="round" stroke-dasharray="110" stroke-dashoffset="${r(110 * (1 - lp), 1)}"/></svg></span>`;
    })
    .join(' ');
  const rot = -1.4 + (1 - p) * 4 + ex * 3;
  const y = (1 - p) * 46 + ex * 52;
  return root(
    s,
    `<div style="position:absolute;inset:0;background:${rgba(st.bg, 0.38)};opacity:${r(dim, 3)}"></div>
    <div style="position:absolute;left:${land ? 22 : 7}%;width:${u(cardW)};top:${land ? 50 : 52}%;transform:translateY(${u(y)}) rotate(${r(rot, 2)}deg);background:${st.paper};color:${st.paperInk};padding:${u(3.2)} ${u(3.4)} ${u(3.6)};box-sizing:border-box;box-shadow:0 ${u(1.2)} ${u(3)} rgba(0,0,0,.45)">
      ${grain({ ...s, style: { ...st, material: 'grao' } }, t, 0.9)}
      <span style="position:absolute;left:${u(-1.6)};top:${u(-0.6)};width:${u(8)};height:${u(2.3)};background:rgba(255,250,235,.6);transform:rotate(-32deg)"></span>
      <span style="position:absolute;right:${u(-1.6)};top:${u(-0.6)};width:${u(8)};height:${u(2.3)};background:rgba(255,250,235,.6);transform:rotate(30deg)"></span>
      ${s.kicker ? `<div class="m-kicker" style="font-size:${u(1.3)};margin-bottom:${u(1.4)};color:${legible(st, st.paper)}">${esc(s.kicker)}</div>` : ''}
      <div class="m-display" style="position:relative;font-size:${u(size)};line-height:1.22;font-weight:${st.font === 'grotesk' ? 700 : 'var(--m-fw)'}">${words}</div>
    </div>`,
  );
}

const RENDER: Record<MotionTemplateId, (s: MotionSpec, t: number, dur: number, wu: number) => string> = { palavra, pergunta, contraste, numero, lista, citacao };

/**
 * O quadro `t` (segundos desde o início do motion) de uma composição com duração `dur`.
 * `wu` = largura do quadro em unidades de `--u` (vertical 1080×1920 → 56.25; horizontal 16:9 → 177.8).
 */
export function motionHtml(spec: MotionSpec, t: number, dur: number, wu: number): string {
  if (t < 0 || t >= dur) return '';
  return RENDER[spec.template]?.(spec, t, dur, wu) ?? '';
}

export const MOTION_CSS = `
.ne-motion { position:absolute; inset:0; overflow:hidden; color:var(--m-ink); font-family:${UI_FONT}; }
.ne-motion .m-display { font-family:var(--m-fd); font-weight:var(--m-fw); letter-spacing:-.01em; font-variant-numeric:lining-nums; }
.ne-motion div.m-mask { white-space:nowrap; }
.ne-motion .m-mask { display:inline-block; overflow:hidden; vertical-align:bottom; line-height:1.08; padding:0 .04em .1em; margin:0 -.04em -.1em; }
.ne-motion .m-kicker { font-family:${UI_FONT}; font-size:calc(var(--u)*1.55); font-weight:700; letter-spacing:.26em; text-transform:uppercase; color:var(--m-accent); margin-bottom:calc(var(--u)*1.2); white-space:nowrap; }
.ne-motion .m-sub { font-family:var(--m-fd); font-style:italic; font-weight:400; line-height:1.2; opacity:.92; }
`;
