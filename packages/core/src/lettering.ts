/**
 * Lettering automático — texto animado que entra NO LUGAR DA LEGENDA nas palavras-chave (nunca sobre o rosto).
 *
 * Linguagem das referências de lettering (Legendas Master · Auto / Apple style / Viral / Marca Texto): uma frase de
 * apoio pequena em sans + a palavra-chave grande (serifa itálica, serifa pesada ou caixa alta condensada), linhas
 * encavaladas, cada palavra entrando no tempo em que é falada (do desfoque para o nítido), sombra suave.
 *
 * Contrato igual ao dos motions: `letteringFrameHtml(spec, t)` é função pura do tempo (preview = export).
 */
import type { SfxCue } from './sfx.ts';

export type LetteringStyleId = 'auto-serifa' | 'auto-serifa-bold' | 'auto-condensada' | 'apple' | 'glow' | 'marca-texto' | 'impacto' | 'typewriter' | 'pop-box' | 'cliente';

export const LETTERING_STYLES: Record<LetteringStyleId, { label: string; desc: string; accent?: string }> = {
  'auto-serifa': { label: 'Auto · Serifa itálica', desc: 'Apoio em sans e a palavra-chave grande em serifa itálica, encavaladas; cada palavra sai do desfoque.' },
  'auto-serifa-bold': { label: 'Auto · Serifa pesada', desc: 'Como o Auto, com a palavra-chave em serifa itálica pesada.' },
  'auto-condensada': { label: 'Auto · Condensada', desc: 'A palavra-chave em caixa alta condensada, enorme, entre as linhas de apoio.' },
  apple: { label: 'Apple style', desc: 'Limpo, em uma linha; a palavra-chave em negrito maior, tudo saindo do desfoque.' },
  glow: { label: 'Destaque com brilho', desc: 'A palavra-chave em cor de acento com brilho, entrando com quique.', accent: '#FF3B30' },
  'marca-texto': { label: 'Marca-texto', desc: 'Pesos misturados; o marca-texto passa atrás da palavra-chave.', accent: '#B8F34B' },
  impacto: { label: 'Impacto', desc: 'Caixa alta condensada, palavra por palavra em escala; a chave em cor.', accent: '#FFE11A' },
  typewriter: { label: 'Máquina de escrever', desc: 'Letra por letra, com cursor, no ritmo da fala.' },
  'pop-box': { label: 'Pop com caixa', desc: 'A palavra-chave salta dentro de uma caixa colorida.', accent: '#E8262C' },
  cliente: { label: 'Template do cliente', desc: 'Fonte, peso, cor e espaçamento do cliente; entra e sai seco, sem animação.' },
};

/**
 * Template do cliente (estilo `cliente`, CH-0012): o equivalente ao Text+ salvo do editor. Tudo opcional; sem valor,
 * Helvetica Neue 700, branco, sem tracking, caixa mista, sem sombra. `font` é o nome da família instalada no Mac
 * (ex. "Helvetica Neue"); só letras, números, espaço e hífen passam.
 */
export interface LetteringTemplate {
  font?: string;
  /** 100–900. */
  weight?: number;
  /** Cor do texto (#RGB ou #RRGGBB). */
  color?: string;
  /** Distância entre letras em em (ex. −0,06). */
  tracking?: number;
  upper?: boolean;
  /** Tamanho em % da altura do quadro (padrão 6). */
  size?: number;
  /** true = sombra padrão (intensidade 1); número = intensidade de 0 a 3 (CH-0034: reforçar sobre fundo claro). */
  shadow?: boolean | number;
  /** Cor da sombra (#RGB ou #RRGGBB, padrão preto). */
  shadowColor?: string;
  /** Desfoque da sombra em em (padrão 0,3; 0 = sombra dura). */
  shadowBlur?: number;
  /** Contorno fino em em (0 a 0,2; padrão 0 = sem contorno), desenhado por trás do preenchimento. */
  stroke?: number;
  /** Cor do contorno (padrão preto). */
  strokeColor?: string;
  italic?: boolean;
}

/** Template do Guilherme Alvares (CH-0012): Helvetica Neue Bold, caixa alta, vermelho 213/24/0, tracking −0,06. */
export const TEMPLATE_EXEMPLO: LetteringTemplate = { font: 'Helvetica Neue', weight: 700, color: '#D51800', tracking: -0.06, upper: true };

export interface LetteringWord {
  text: string;
  /** Segundos desde o início do lettering — o instante em que a palavra é falada. */
  at: number;
  line: number;
  destaque?: boolean;
}

export interface LetteringSpec {
  estilo: LetteringStyleId;
  words: LetteringWord[];
  accent?: string;
  refId?: string;
  refName?: string;
  /** Por que esse momento virou lettering (número, nome, palavra do tema…). */
  motivo?: string;
  seed: number;
  /** false = sem SFX. */
  sfx?: boolean;
  /** Altura do centro (0–1); sem valor, usa a altura da legenda. */
  y?: number;
  /** Alinhamento horizontal (padrão centro). */
  align?: 'left' | 'center' | 'right';
  /** Centro horizontal livre (0–1), quando o editor arrasta o lettering no player; vale com `align` centro. */
  x?: number;
  /**
   * Lettering em escada (BL-0102): borda esquerda de cada linha (0–1 da largura do quadro), na ordem das linhas na
   * tela. `null` ou sem valor = a linha segue `align`. Com alguma linha em escada, `x` não desloca o bloco.
   */
  lineX?: (number | null)[];
  /** Só no estilo `cliente`. */
  template?: LetteringTemplate;
}

// ---------------------------------------------------------------------------
// Tipografia (fontes do Mac primeiro, com reserva do sistema)
// ---------------------------------------------------------------------------

// Fontes empacotadas primeiro (core/fonts.ts): o mesmo desenho no preview e no export, em qualquer máquina.
const SANS = "'Montserrat','Avenir Next',sans-serif";
const SERIF_IT = "'Playfair Display',Didot,'Bodoni 72',serif";
const SERIF_BOLD_IT = "'Playfair Display',Baskerville,Georgia,serif";
const COND = "'Bebas Neue','DIN Condensed',Impact,sans-serif";
const IMPACT = "Anton,'Bebas Neue',Impact,sans-serif";
const APPLE = "'Inter',system-ui,-apple-system,'Helvetica Neue',sans-serif";
const TYPE = "'American Typewriter','Courier New',monospace";

interface Face {
  font: string;
  weight: number;
  italic?: boolean;
  /** Tamanho em `--u` (1% da altura do quadro). */
  size: number;
  upper?: boolean;
  track?: number;
  /** Largura média de um caractere em em (para caber sem medir o DOM). */
  cw: number;
}

/** overlap: quanto a linha da palavra-chave encavala nas vizinhas (em em) — a assinatura dos modelos Auto. */
const TYPO: Record<LetteringStyleId, { apoio: Face; destaque: Face; flow?: boolean; overlap: number }> = {
  'auto-serifa': { apoio: { font: SANS, weight: 500, size: 3.9, track: -0.035, cw: 0.56 }, destaque: { font: SERIF_IT, weight: 400, italic: true, size: 10.5, track: -0.02, cw: 0.47 }, overlap: 0.2 },
  'auto-serifa-bold': { apoio: { font: SANS, weight: 500, size: 3.9, track: -0.035, cw: 0.56 }, destaque: { font: SERIF_BOLD_IT, weight: 700, italic: true, size: 9.2, track: -0.025, cw: 0.52 }, overlap: 0.18 },
  'auto-condensada': { apoio: { font: SANS, weight: 500, size: 3.9, track: -0.035, cw: 0.56 }, destaque: { font: COND, weight: 400, size: 11.5, upper: true, track: -0.005, cw: 0.4 }, overlap: 0.12 },
  apple: { apoio: { font: APPLE, weight: 500, size: 3.9, track: -0.02, cw: 0.55 }, destaque: { font: APPLE, weight: 700, size: 6.6, track: -0.035, cw: 0.58 }, overlap: 0.02 },
  glow: { apoio: { font: SANS, weight: 500, size: 3.9, track: -0.03, cw: 0.56 }, destaque: { font: SERIF_BOLD_IT, weight: 700, italic: true, size: 9, track: -0.02, cw: 0.52 }, overlap: 0.1 },
  'marca-texto': { apoio: { font: APPLE, weight: 400, size: 4.4, track: -0.02, cw: 0.54 }, destaque: { font: APPLE, weight: 800, size: 4.4, track: -0.02, cw: 0.6 }, flow: true, overlap: 0 },
  impacto: { apoio: { font: IMPACT, weight: 400, size: 6, upper: true, track: 0, cw: 0.48 }, destaque: { font: IMPACT, weight: 400, size: 8.6, upper: true, track: 0, cw: 0.48 }, overlap: -0.02 },
  typewriter: { apoio: { font: TYPE, weight: 400, size: 4, track: 0, cw: 0.6 }, destaque: { font: TYPE, weight: 700, size: 4.6, track: 0, cw: 0.62 }, flow: true, overlap: 0 },
  cliente: { apoio: { font: "'Helvetica Neue',Helvetica,Arial,sans-serif", weight: 700, size: 6, track: 0, cw: 0.6 }, destaque: { font: "'Helvetica Neue',Helvetica,Arial,sans-serif", weight: 700, size: 6, track: 0, cw: 0.6 }, overlap: 0 },
  'pop-box': { apoio: { font: SANS, weight: 600, size: 3.9, track: -0.03, cw: 0.58 }, destaque: { font: SANS, weight: 800, size: 5.8, upper: true, track: -0.01, cw: 0.66 }, overlap: -0.04 },
};

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r = (x: number, k = 3) => Math.round(x * 10 ** k) / 10 ** k;
const outCubic = (x: number) => 1 - Math.pow(1 - c01(x), 3);
const outBack = (x: number) => {
  const v = c01(x);
  return 1 + 2.70158 * Math.pow(v - 1, 3) + 1.70158 * Math.pow(v - 1, 2);
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return `rgba(${parseInt(v.slice(0, 2), 16)},${parseInt(v.slice(2, 4), 16)},${parseInt(v.slice(4, 6), 16)},${a})`;
};
const OUT = 0.24;

const faceCss = (f: Face, k: number) =>
  `font-family:${f.font.replace(/"/g, '&quot;')};font-weight:${f.weight};${f.italic ? 'font-style:italic;' : ''}font-size:calc(var(--u)*${r(f.size * k, 2)});letter-spacing:${f.track ?? 0}em;`;

/** Texto de cada palavra como aparece na tela (caixa do estilo, sem reticências). */
const shown = (w: LetteringWord, f: Face) => {
  const t = w.text.replace(/\.\.\.$|…$/, '');
  return f.upper ? t.toLocaleUpperCase('pt-BR') : t;
};

/** Borda esquerda conferida de cada uma das `n` linhas (BL-0102); `undefined` = a linha segue o alinhamento. */
export function letteringLineX(spec: LetteringSpec, n: number): (number | undefined)[] {
  return Array.from({ length: n }, (_, i) => {
    const v = Array.isArray(spec.lineX) ? spec.lineX[i] : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? r(c01(v), 4) : undefined;
  });
}

/**
 * Posição horizontal do bloco e de cada linha. Sem escada, o de sempre (`align` + `x`). Com escada, o bloco ocupa a
 * largura do quadro (o % do recuo vale sobre ela) e cada linha leva o seu `padding-left`; as outras seguem `align`.
 */
function horizontal(spec: LetteringSpec, n: number) {
  const al = spec.align ?? 'center';
  const xs = letteringLineX(spec, n);
  if (xs.every((x) => x === undefined)) {
    const side = al === 'center' ? '' : al === 'left' ? 'left:7%;right:auto;text-align:left;' : 'right:7%;left:auto;text-align:right;';
    const shift = spec.x !== undefined && al === 'center' ? `translateX(${r((spec.x - 0.5) * 100, 2)}%) ` : '';
    return { side, shift, xs, line: (_i: number) => '' };
  }
  const rest = al === 'left' ? 'padding-left:7%;' : al === 'right' ? 'padding-right:7%;' : '';
  const line = (i: number) => (xs[i] === undefined ? rest : `text-align:left;padding-left:${r(xs[i]! * 100, 2)}%;`);
  return { side: al === 'center' ? '' : `text-align:${al};`, shift: '', xs, line };
}

/** Largura útil da linha `i` em `--u`: a linha em escada vai do recuo até perto da borda direita. */
const roomOf = (xs: (number | undefined)[], i: number, wu: number, frac: number) => (xs[i] === undefined ? wu * frac : wu * Math.max(0.1, 0.97 - xs[i]!));

export function letteringAccent(spec: LetteringSpec): string {
  return spec.accent ?? LETTERING_STYLES[spec.estilo]?.accent ?? '#FFFFFF';
}

/**
 * O quadro `t` (s desde o início) de um lettering de duração `dur`, centrado na altura `position` (0–1, a mesma da
 * legenda). `wu` = largura do quadro em `--u`.
 */
export function letteringFrameHtml(spec: LetteringSpec, t: number, dur: number, wu: number, position: number): string {
  if (t < 0 || t >= dur || !spec.words.length) return '';
  if (spec.estilo === 'cliente') return clienteHtml(spec, wu, position);
  const typo = TYPO[spec.estilo] ?? TYPO['auto-serifa'];
  const accent = letteringAccent(spec);
  const lines = [...new Set(spec.words.map((w) => w.line))].sort((a, b) => a - b).map((l) => spec.words.filter((w) => w.line === l));

  // Cabe na largura: a linha mais larga define a escala do bloco inteiro.
  const widthOf = (ws: LetteringWord[]) =>
    ws.reduce((a, w) => {
      const f = w.destaque ? typo.destaque : typo.apoio;
      return a + (shown(w, f).length + 0.6) * f.cw * f.size;
    }, 0);
  const hz = horizontal(spec, lines.length);
  const k = Math.min(1, ...lines.map((ws, i) => roomOf(hz.xs, i, wu, 0.86) / Math.max(1, widthOf(ws))));

  const ex = c01((t - (dur - OUT)) / OUT);
  const shadow = `0 0.05em 0.3em rgba(0,0,0,.62),0 0 0.9em rgba(0,0,0,.32)`;
  const haze = spec.estilo.startsWith('auto') || spec.estilo === 'apple' ? `,0 0 0.5em rgba(255,255,255,.2)` : '';

  const wordHtml = (w: LetteringWord, i: number) => {
    const f = w.destaque ? typo.destaque : typo.apoio;
    const txt = shown(w, f);
    const lead = 0.05;
    const dt = t - w.at + lead;
    if (dt < 0) return `<span style="opacity:0">${esc(txt)}</span>`;
    let style = '';
    let inner = esc(txt);
    switch (spec.estilo) {
      case 'glow':
      case 'pop-box':
      case 'impacto': {
        const pop = w.destaque || spec.estilo === 'impacto';
        if (pop) {
          const p = c01(dt / (spec.estilo === 'impacto' ? 0.2 : 0.3));
          const s = spec.estilo === 'impacto' ? 1.45 - 0.45 * outBack(p) : 0.35 + 0.65 * outBack(p);
          style = `display:inline-block;transform:scale(${r(s)});opacity:${r(Math.min(1, p * 3))};`;
        } else {
          const p = outCubic(dt / 0.26);
          style = `display:inline-block;opacity:${r(p)};filter:blur(${r((1 - p) * 0.3)}em);transform:translateY(${r((1 - p) * 0.25)}em);`;
        }
        if (w.destaque && spec.estilo === 'glow') {
          const g = 0.55 + 0.25 * Math.exp(-dt * 4);
          style += `color:${accent};text-shadow:0 0 0.35em ${hexA(accent, r(g))},0 0 0.9em ${hexA(accent, r(g * 0.55))},${shadow};`;
        }
        if (w.destaque && spec.estilo === 'impacto') style += `color:${accent};`;
        if (w.destaque && spec.estilo === 'pop-box') style += 'text-shadow:none;';
        break;
      }
      case 'typewriter': {
        const n = Math.min(txt.length, Math.floor(dt / 0.042) + 1);
        const typing = n < txt.length;
        const isLast = spec.words.filter((x) => x.at - lead <= t).slice(-1)[0] === w;
        const cursor = isLast && (typing || Math.floor(t * 3.2) % 2 === 0) ? `<span style="position:absolute;right:-0.1em;top:0.08em;width:0.07em;height:0.92em;background:currentColor"></span>` : '';
        inner = `<span style="position:relative">${esc(txt.slice(0, n))}${cursor}</span><span style="opacity:0">${esc(txt.slice(n))}</span>`;
        if (w.destaque) style = `color:${accent === '#FFFFFF' ? '#fff' : accent};`;
        break;
      }
      case 'marca-texto': {
        const p = outCubic(dt / 0.22);
        style = `display:inline-block;opacity:${r(p)};transform:translateY(${r((1 - p) * 0.2)}em);`;
        if (w.destaque && outCubic((dt - 0.1) / 0.32) > 0.45) style += 'color:#111;text-shadow:none;';
        break;
      }
      default: {
        // auto-* e apple: do desfoque para o nítido, subindo um pouco.
        const D = w.destaque ? 0.42 : 0.28;
        const p = outCubic(dt / D);
        const blur = (1 - p) * (w.destaque ? 0.45 : 0.32);
        const sc = w.destaque ? 1.1 - 0.1 * p : 1;
        style = `display:inline-block;opacity:${r(Math.min(1, p * 1.6))};filter:blur(${r(blur)}em);transform:translateY(${r((1 - p) * 0.22)}em) scale(${r(sc)});`;
      }
    }
    void i;
    return `<span style="${style}">${inner}</span>`;
  };

  const flow = !!typo.flow;
  /** Decoração do grupo da palavra-chave (caixa do pop, faixa do marca-texto), no tempo da primeira palavra. */
  const groupWrap = (ws: LetteringWord[], inner: string) => {
    const dt = t - ws[0]!.at + 0.05;
    if (spec.estilo === 'pop-box') {
      if (dt < 0) return `<span style="padding:0.02em 0.24em 0.06em">${inner}</span>`;
      const p = outBack(c01(dt / 0.28));
      return `<span style="display:inline-block;background:${accent};border-radius:0.16em;padding:0.02em 0.24em 0.06em;transform:scale(${r(0.3 + 0.7 * p)});box-shadow:0 0.08em 0.32em rgba(0,0,0,.35)">${inner}</span>`;
    }
    if (spec.estilo === 'marca-texto') {
      const m = outCubic((dt - 0.1) / 0.32);
      return `<span style="background:linear-gradient(${accent},${accent}) no-repeat 0 60%/${r(m * 100, 1)}% 80%;padding:0 0.14em;border-radius:0.08em">${inner}</span>`;
    }
    return inner;
  };
  const html = lines
    .map((ws, li) => {
      const big = ws.some((w) => w.destaque) && !flow;
      const f = big ? typo.destaque : typo.apoio;
      // Linha da palavra-chave encavala nas vizinhas (o "já entendeu" grudado em "esse problema").
      const o = typo.overlap;
      const overlap = big ? `margin:${li ? -o : 0}em 0 ${-o * 0.8}em;` : li ? 'margin-top:-0.06em;' : '';
      // Agrupa as palavras-chave consecutivas (uma caixa / uma faixa de marca-texto só).
      const parts: string[] = [];
      for (let i = 0; i < ws.length; ) {
        const w = ws[i]!;
        const cell = (x: LetteringWord, j: number) => (flow ? `<span style="${faceCss(x.destaque ? typo.destaque : typo.apoio, k)}">${wordHtml(x, j)}</span>` : wordHtml(x, j));
        if (w.destaque && (spec.estilo === 'pop-box' || spec.estilo === 'marca-texto')) {
          let j = i;
          while (j < ws.length && ws[j]!.destaque) j++;
          parts.push(groupWrap(ws.slice(i, j), ws.slice(i, j).map((x, q) => cell(x, i + q)).join(' ')));
          i = j;
        } else {
          parts.push(cell(w, i));
          i++;
        }
      }
      return `<div style="${faceCss(f, k)}line-height:${big ? 1 : 1.1};white-space:nowrap;${overlap}${hz.line(li)}">${parts.join(' ')}</div>`;
    })
    .join('');
  const { side, shift } = hz;
  return `<div class="ne-lt" style="top:${r((spec.y ?? position) * 100, 2)}%;${side}text-shadow:${shadow}${haze};opacity:${r(1 - ex)};filter:blur(${r(ex * 0.25)}em);transform:${shift}translateY(calc(-50% - ${r(ex * 0.4)}em))">${html}</div>`;
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

const hexOk = (c: unknown): c is string => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const rgbA = (hex: string, a: number) => {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1);
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${r(Math.min(1, a), 3)})`;
};

/**
 * Sombra e contorno do template do cliente (CH-0034). Intensidade 1 = a sombra de sempre (0,62 de opacidade); acima
 * de 1 a opacidade satura e entra uma 2ª camada mais justa (o que a 2ª camada idêntica do editor fazia, sem duplicar
 * o overlay). O contorno usa -webkit-text-stroke com paint-order, como a legenda.
 */
function clienteSombra(tp: ReturnType<typeof templateCliente>): string {
  const k = tp.shadow;
  const layers: string[] = [];
  if (k > 0) layers.push(`0 0.05em ${tp.shadowBlur}em ${rgbA(tp.shadowColor, 0.62 * k)}`);
  if (k > 1) layers.push(`0 0.02em ${r(tp.shadowBlur * 0.4, 3)}em ${rgbA(tp.shadowColor, 0.62 * (k - 1))}`);
  if (k > 2) layers.push(`0 0 ${r(tp.shadowBlur * 0.15, 3)}em ${rgbA(tp.shadowColor, 0.8 * (k - 2))}`);
  // Com paint-order a metade de dentro do traço fica sob o preenchimento: o traço tem o dobro para a borda visível ser `stroke`.
  const stroke = tp.stroke > 0 ? `-webkit-text-stroke:${r(tp.stroke * 2, 3)}em ${tp.strokeColor};paint-order:stroke fill;` : '';
  return `text-shadow:${layers.length ? layers.join(',') : 'none'};${stroke}`;
}

/** Template do cliente com os valores conferidos (nada do spec entra cru no HTML/CSS). */
export function templateCliente(tpl: LetteringTemplate | undefined) {
  const t = tpl ?? {};
  const name = typeof t.font === 'string' ? t.font.replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 60) : '';
  return {
    family: `${name ? `'${name}',` : ''}'Helvetica Neue',Helvetica,Arial,sans-serif`,
    weight: Math.round(num(t.weight, 100, 900, 700) / 100) * 100,
    color: typeof t.color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t.color) ? t.color : '#FFFFFF',
    tracking: num(t.tracking, -0.3, 1, 0),
    upper: t.upper === true,
    size: num(t.size, 1, 30, 6),
    shadow: t.shadow === true ? 1 : num(t.shadow, 0, 3, 0),
    shadowColor: hexOk(t.shadowColor) ? t.shadowColor! : '#000000',
    shadowBlur: num(t.shadowBlur, 0, 2, 0.3),
    stroke: num(t.stroke, 0, 0.2, 0),
    strokeColor: hexOk(t.strokeColor) ? t.strokeColor! : '#000000',
    italic: t.italic === true,
  };
}

/**
 * Estilo `cliente`: troca seca, sem animação — o texto inteiro aparece no 1º quadro e some depois do último, igual
 * ao template do editor. As linhas do spec viram linhas; a palavra-chave usa a cor de acento só se houver `accent`.
 */
function clienteHtml(spec: LetteringSpec, wu: number, position: number): string {
  const tp = templateCliente(spec.template);
  const lines = [...new Set(spec.words.map((w) => w.line))].sort((a, b) => a - b).map((l) => spec.words.filter((w) => w.line === l));
  const txt = (w: LetteringWord) => {
    const x = w.text.replace(/\.\.\.$|…$/, '');
    return tp.upper ? x.toLocaleUpperCase('pt-BR') : x;
  };
  // Cabe na largura (mesma estimativa dos outros estilos; Helvetica Bold ≈ 0,7 em por letra em caixa alta, 0,58 em mista).
  const cw = Math.max(0.2, (tp.upper ? 0.7 : 0.58) + tp.tracking);
  const hz = horizontal(spec, lines.length);
  const k = Math.min(1, ...lines.map((ws, i) => roomOf(hz.xs, i, wu, 0.9) / Math.max(1, ws.reduce((a, w) => a + (txt(w).length + 0.3) * cw * tp.size, 0))));
  const html = lines
    .map((ws, li) => `<div${hz.line(li) ? ` style="${hz.line(li)}"` : ''}>${ws.map((w) => (w.destaque && spec.accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(spec.accent) ? `<span style="color:${spec.accent}">${esc(txt(w))}</span>` : esc(txt(w)))).join(' ')}</div>`)
    .join('');
  const { side, shift } = hz;
  const face = `font-family:${tp.family};font-weight:${tp.weight};${tp.italic ? 'font-style:italic;' : ''}font-size:calc(var(--u)*${r(tp.size * k, 2)});letter-spacing:${tp.tracking}em;line-height:1.05;white-space:nowrap;color:${tp.color};`;
  const shadow = clienteSombra(tp);
  return `<div class="ne-lt" style="top:${r((spec.y ?? position) * 100, 2)}%;${side}${face}${shadow}transform:${shift}translateY(-50%)">${html}</div>`;
}

export const LETTERING_CSS = `
.ne-lt { position:absolute; left:0; right:0; text-align:center; color:#fff; font-size:calc(var(--u)*3); font-variant-numeric:lining-nums; }
.ne-lt > div { position:relative; }
`;

// ---------------------------------------------------------------------------
// SFX do lettering (sutis: o lettering é frequente)
// ---------------------------------------------------------------------------

export function letteringCues(spec: LetteringSpec, dur: number): SfxCue[] {
  if (spec.sfx === false) return [];
  const c: SfxCue[] = [];
  let k = 0;
  const add = (t: number, kind: SfxCue['kind'], gain: number, extra: Partial<SfxCue> = {}) => {
    if (t < dur) c.push({ t: Math.max(0, +t.toFixed(4)), kind, gain, seed: spec.seed * 17 + k++, ...extra });
  };
  const key = spec.words.filter((w) => w.destaque);
  const first = key[0];
  switch (spec.estilo) {
    case 'cliente':
      break;
    case 'glow':
    case 'pop-box':
      if (first) add(first.at - 0.01, 'pop', 0.42);
      break;
    case 'impacto':
      spec.words.forEach((w) => add(w.at - 0.01, w.destaque ? 'pop' : 'tick', w.destaque ? 0.4 : 0.12, { pitch: 0.8 }));
      break;
    case 'typewriter':
      spec.words.forEach((w) => {
        const n = Math.min(4, Math.max(1, Math.round(w.text.length / 2)));
        for (let j = 0; j < n; j++) add(w.at + j * 0.042 * 2, 'type', 0.26 - j * 0.03, { pitch: 0.95 + 0.05 * (j % 3) });
      });
      break;
    case 'marca-texto':
      if (first) add(first.at + 0.08, 'marker', 0.3, { len: 0.34 });
      break;
    default:
      if (first) add(first.at - 0.14, 'whoosh', 0.2, { len: 0.34 });
  }
  return c.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Compatibilidade: lettering antigo em texto ("*15* MINUTOS")
// ---------------------------------------------------------------------------

export function letteringFromText(text: string, estilo: LetteringStyleId = 'auto-serifa'): LetteringSpec {
  const words: LetteringWord[] = [];
  let destaque = false;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const opens = raw.startsWith('*');
    const closes = raw.endsWith('*') && raw.length > 1;
    if (opens) destaque = true;
    words.push({ text: raw.replace(/\*/g, ''), at: 0.08 + words.length * 0.12, line: 0, destaque });
    if (closes) destaque = false;
  }
  // Destaque numa linha própria quando há apoio dos dois lados.
  let line = 0;
  let prev: boolean | undefined;
  for (const w of words) {
    if (prev !== undefined && prev !== !!w.destaque) line++;
    w.line = line;
    prev = !!w.destaque;
  }
  if (!words.some((w) => w.destaque)) words.forEach((w) => (w.destaque = true));
  return { estilo, words, seed: text.length * 7 };
}
