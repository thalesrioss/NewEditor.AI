/**
 * Cor e enum de legenda, motion e lettering conferidos antes de entrar na timeline (BL-0177). Esses valores vão
 * crus para o CSS/HTML da camada de texto (preview e export no Chrome): `accent: '"><script>…'` vindo da API
 * virava HTML. Na op, valor fora da regra é recusado (`motivo` → OpError → 400); no projeto já gravado
 * (`normalize…`), o valor ruim cai no padrão e o projeto carrega.
 *
 * Cor: só `#rgb`, `#rrggbb` ou `#rrggbbaa` (não há lista de nomes de cor no produto). Enum: só os da lista.
 */
import { LETTERING_STYLES, type LetteringSpec } from './lettering.ts';
import { DEFAULT_MOTION_STYLE, MOTION_TEMPLATES, NARRATIVE_FUNCTIONS, type MotionSpec, type MotionStyle } from './motion.ts';
import { CAPTION_ANIMS, CAPTION_ANIMS_OUT, CAPTION_FONTS, CAPTION_WORD_ANIMS, type CaptionSettings } from './text.ts';
import type { OverlayItem } from './types.ts';

export const corValida = (v: unknown): v is string => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
const naLista = (v: unknown, lista: Record<string, unknown> | readonly string[]): boolean =>
  typeof v === 'string' && (Array.isArray(lista) ? lista.includes(v) : Object.prototype.hasOwnProperty.call(lista, v));

const CAPTION_CORES = ['color', 'accent', 'strokeColor', 'shadowColor', 'boxColor'] as const;
// Função, não constante: text.ts e timeline.ts se importam em ciclo, e as listas ainda não existem no carregamento.
const captionEnums = (): [keyof CaptionSettings, Record<string, unknown> | readonly string[]][] => [
  ['style', ['reels', 'frase']],
  ['font', CAPTION_FONTS],
  ['animIn', CAPTION_ANIMS],
  ['animOut', CAPTION_ANIMS_OUT],
  ['wordAnim', CAPTION_WORD_ANIMS],
];
const STYLE_CORES = ['bg', 'ink', 'accent', 'paper', 'paperInk'] as const;
const STYLE_ENUMS: [keyof MotionStyle, readonly string[]][] = [
  ['font', ['serif', 'grotesk', 'maquina']],
  ['material', ['liso', 'papel', 'grao']],
];
const ALIGNS = ['left', 'center', 'right'];
const TEMPLATE_CORES = ['color', 'shadowColor', 'strokeColor'] as const;

/** O que está errado na legenda (campo ausente vale; o padrão preenche). */
export function motivoCaptions(c: Partial<CaptionSettings>): string | undefined {
  for (const k of CAPTION_CORES) if (c[k] !== undefined && !corValida(c[k])) return `${k}: cor em #rgb, #rrggbb ou #rrggbbaa`;
  for (const [k, lista] of captionEnums()) if (c[k] !== undefined && !naLista(c[k], lista)) return `${k}: ${(Array.isArray(lista) ? lista : Object.keys(lista)).join(', ')}`;
  return undefined;
}

export function motivoMotion(m: MotionSpec): string | undefined {
  if (!m || typeof m !== 'object') return 'motion ausente';
  if (!naLista(m.template, MOTION_TEMPLATES)) return `template: ${Object.keys(MOTION_TEMPLATES).join(', ')}`;
  if (m.funcao !== undefined && !naLista(m.funcao, NARRATIVE_FUNCTIONS)) return `funcao: ${Object.keys(NARRATIVE_FUNCTIONS).join(', ')}`;
  if (m.style !== undefined && (typeof m.style !== 'object' || m.style === null)) return 'style: objeto { bg, ink, accent, paper, paperInk, font, material }';
  const st = (m.style ?? {}) as Partial<MotionStyle>;
  for (const k of STYLE_CORES) if (st[k] !== undefined && !corValida(st[k])) return `style.${k}: cor em #rgb, #rrggbb ou #rrggbbaa`;
  for (const [k, lista] of STYLE_ENUMS) if (st[k] !== undefined && !naLista(st[k], lista)) return `style.${k}: ${lista.join(', ')}`;
  return undefined;
}

export function motivoLettering(l: LetteringSpec): string | undefined {
  if (!l || typeof l !== 'object') return 'lettering ausente';
  if (!naLista(l.estilo, LETTERING_STYLES)) return `estilo: ${Object.keys(LETTERING_STYLES).join(', ')}`;
  if (l.accent !== undefined && !corValida(l.accent)) return 'accent: cor em #rgb, #rrggbb ou #rrggbbaa';
  if (l.align !== undefined && !naLista(l.align, ALIGNS)) return `align: ${ALIGNS.join(', ')}`;
  for (const k of TEMPLATE_CORES) if (l.template?.[k] !== undefined && !corValida(l.template[k])) return `template.${k}: cor em #rgb, #rrggbb ou #rrggbbaa`;
  return undefined;
}

// --- Projeto já gravado: o valor ruim cai no padrão ---------------------------------------------------

const sem = <T extends object>(o: T, ks: string[]): T => (ks.length ? (Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k))) as T) : o);

export function normalizeCaptions<T extends Partial<CaptionSettings>>(c: T): T {
  if (!c || typeof c !== 'object') return c;
  const ruins = [...CAPTION_CORES.filter((k) => c[k] !== undefined && !corValida(c[k])), ...captionEnums().filter(([k, l]) => c[k] !== undefined && !naLista(c[k], l)).map(([k]) => k)];
  return sem(c, ruins);
}

function normalizeMotion(m: MotionSpec): MotionSpec {
  if (!m || typeof m !== 'object' || !m.style || typeof m.style !== 'object') return m;
  const st = m.style;
  const ruins = [...STYLE_CORES.filter((k) => st[k] !== undefined && !corValida(st[k])), ...STYLE_ENUMS.filter(([k, l]) => st[k] !== undefined && !naLista(st[k], l)).map(([k]) => k)];
  if (!ruins.length) return m;
  return { ...m, style: { ...st, ...Object.fromEntries(ruins.map((k) => [k, DEFAULT_MOTION_STYLE[k]])) } };
}

function normalizeLettering(l: LetteringSpec): LetteringSpec {
  if (!l || typeof l !== 'object') return l;
  const ruins = [...(l.accent !== undefined && !corValida(l.accent) ? ['accent'] : []), ...(l.align !== undefined && !naLista(l.align, ALIGNS) ? ['align'] : [])];
  const tpl = l.template && typeof l.template === 'object' ? sem(l.template, TEMPLATE_CORES.filter((k) => l.template![k] !== undefined && !corValida(l.template![k]))) : l.template;
  if (!ruins.length && tpl === l.template) return l;
  return { ...sem(l, ruins), ...(tpl ? { template: tpl } : {}) };
}

export function normalizeOverlayStyle(o: OverlayItem): OverlayItem {
  const s = o.source;
  if (s?.type === 'motion') {
    const motion = normalizeMotion(s.motion);
    return motion === s.motion ? o : { ...o, source: { ...s, motion } };
  }
  if (s?.type === 'lettering') {
    const lettering = normalizeLettering(s.lettering);
    return lettering === s.lettering ? o : { ...o, source: { ...s, lettering } };
  }
  return o;
}
