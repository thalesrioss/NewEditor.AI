/**
 * Camada de texto (legenda + lettering): o MESMO HTML/CSS é desenhado no preview (React) e no export
 * (Chrome headless) — o que o editor vê é o que vai para o vídeo (ADR-002).
 *
 * Padrão de lettering do Cérebro do Editor (brains/04_EDITOR.md): Helvetica Neue, caixa mista, branco,
 * âmbar #E8B44A nos acentos, sem tarja, sombra suave, em área negativa.
 */
import { clipDuration, clipStarts, clipSpeed, resolveOverlay } from './timeline.ts';
import type { Seconds, Timeline } from './types.ts';

export type CaptionStyle = 'reels' | 'frase';

export type CaptionFont = 'inter' | 'montserrat' | 'bebas' | 'anton' | 'playfair' | 'helvetica';
/** Animação de entrada do bloco (função do tempo: igual no preview e no export). */
export type CaptionAnim = 'none' | 'pop' | 'slide' | 'fade' | 'type';
export type CaptionAnimOut = 'none' | 'fade' | 'slide';
/** O que acontece com a palavra que está sendo dita. */
export type CaptionWordAnim = 'color' | 'scale' | 'box' | 'none';
export const CAPTION_ANIMS: Record<CaptionAnim, string> = { none: 'Nenhuma', pop: 'Pop', slide: 'Deslizar', fade: 'Fade', type: 'Palavra por palavra' };
export const CAPTION_ANIMS_OUT: Record<CaptionAnimOut, string> = { none: 'Nenhuma', fade: 'Fade', slide: 'Deslizar' };
export const CAPTION_WORD_ANIMS: Record<CaptionWordAnim, string> = { color: 'Muda a cor', scale: 'Cresce', box: 'Caixa na palavra', none: 'Nada' };
export const CAPTION_FONTS: Record<CaptionFont, { label: string; family: string }> = {
  inter: { label: 'Inter', family: "'Inter','Helvetica Neue',Helvetica,Arial,sans-serif" },
  montserrat: { label: 'Montserrat', family: "'Montserrat','Avenir Next',sans-serif" },
  bebas: { label: 'Bebas Neue', family: "'Bebas Neue','Oswald',Impact,sans-serif" },
  anton: { label: 'Anton', family: "'Anton',Impact,sans-serif" },
  playfair: { label: 'Playfair Display', family: "'Playfair Display',Georgia,serif" },
  // Fonte do sistema (macOS), não empacotada: a licença não permite (ADR-005). Preview e export rodam no Mac (CH-0012).
  helvetica: { label: 'Helvetica Neue', family: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
};

export interface CaptionSettings {
  enabled: boolean;
  style: CaptionStyle;
  uppercase: boolean;
  /** Destaca a palavra que está sendo dita (cor `accent`). */
  highlight: boolean;
  /** Altura do centro da legenda, de 0 (topo) a 1 (base). */
  position: number;
  /** Centro horizontal, de 0 (esquerda) a 1 (direita). Padrão 0,5. */
  x?: number;
  /** Largura máxima do bloco, em % do quadro (padrão 84). */
  width?: number;
  font?: CaptionFont;
  /** Peso 100–900 (padrão 800; 'frase' 700). */
  weight?: number;
  italic?: boolean;
  /** Tamanho em % da altura do quadro (padrão 3,6; 'frase' 2,7). */
  size?: number;
  color?: string;
  /** Cor do destaque da palavra falada (padrão âmbar #E8B44A). */
  accent?: string;
  /** Palavras por bloco (padrão: 2 no Reels, 6 na Frase). */
  maxWords?: number;
  /** Caracteres por bloco (quebra antes de passar). */
  maxChars?: number;
  /** Distância entre letras, em em (padrão −0,01). */
  letterSpacing?: number;
  /** Entrelinha (padrão 1,12). */
  lineHeight?: number;
  /** Contorno, em % da altura do quadro (0 = sem). */
  stroke?: number;
  strokeColor?: string;
  /** Sombra, 0 (sem) a 1 (forte). Padrão 0,65. */
  shadow?: number;
  /** Sombra: cor, desfoque e distância em % da altura, ângulo em graus (90 = para baixo). */
  shadowColor?: string;
  shadowBlur?: number;
  shadowDistance?: number;
  shadowAngle?: number;
  /** Tarja atrás do texto. */
  box?: boolean;
  boxColor?: string;
  /** Opacidade da tarja, 0–1 (padrão 0,7). */
  boxOpacity?: number;
  /** Tarja: raio dos cantos e margem interna, em % da altura. */
  boxRadius?: number;
  boxPadding?: number;
  /** Opacidade do texto, 0–1 (padrão 1). */
  opacity?: number;
  /** Rotação do bloco em graus (padrão 0). */
  rotation?: number;
  /** Escala do bloco (padrão 1; o tamanho da fonte continua em `size`). */
  scale?: number;
  underline?: boolean;
  /** Animação de entrada/saída do bloco e da palavra falada. */
  animIn?: CaptionAnim;
  animOut?: CaptionAnimOut;
  wordAnim?: CaptionWordAnim;
  /** Duração da entrada/saída, em s (padrão 0,18). */
  animDur?: number;
}

export const DEFAULT_CAPTIONS: CaptionSettings = { enabled: false, style: 'reels', uppercase: true, highlight: true, position: 0.72 };

/** Os valores efetivos (padrões por estilo preenchidos). */
export function captionDefaults(s: CaptionSettings): Required<Omit<CaptionSettings, 'enabled' | 'maxChars'>> & { maxChars?: number } {
  const reels = s.style === 'reels';
  return {
    style: s.style, uppercase: s.uppercase, highlight: s.highlight, position: s.position,
    x: s.x ?? 0.5, width: s.width ?? 84, font: s.font ?? 'inter', weight: s.weight ?? (reels ? 800 : 700), italic: s.italic ?? false,
    size: s.size ?? (reels ? 3.6 : 2.7), color: s.color ?? '#ffffff', accent: s.accent ?? '#E8B44A',
    maxWords: s.maxWords ?? (reels ? 2 : 6), maxChars: s.maxChars, letterSpacing: s.letterSpacing ?? -0.01, lineHeight: s.lineHeight ?? 1.12,
    stroke: s.stroke ?? 0, strokeColor: s.strokeColor ?? '#000000', shadow: s.shadow ?? 0.65, box: s.box ?? false, boxColor: s.boxColor ?? '#000000', boxOpacity: s.boxOpacity ?? 0.7,
    shadowColor: s.shadowColor ?? '#000000', shadowBlur: s.shadowBlur ?? 0.9, shadowDistance: s.shadowDistance ?? 0.18, shadowAngle: s.shadowAngle ?? 90,
    boxRadius: s.boxRadius ?? 0.5, boxPadding: s.boxPadding ?? 0.5, opacity: s.opacity ?? 1, rotation: s.rotation ?? 0, scale: s.scale ?? 1, underline: s.underline ?? false,
    animIn: s.animIn ?? 'none', animOut: s.animOut ?? 'none', wordAnim: s.wordAnim ?? 'color', animDur: s.animDur ?? 0.18,
  };
}

const hexA = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const c01 = (x: number) => Math.max(0, Math.min(1, x));
const outBack = (p: number) => 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);
const outCubic = (p: number) => 1 - Math.pow(1 - c01(p), 3);
const r2 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Estilo inline do bloco de legenda — o mesmo no preview e no export (unidades em --u = 1% da altura).
 * Inclui posição, sombra, tarja, opacidade, rotação, escala e, com `anim`, a entrada/saída no instante `t`.
 * A cor do destaque vai em --hl.
 */
export function captionInlineStyle(s: CaptionSettings, anim?: { t: Seconds; start: Seconds; end: Seconds }): string {
  const d = captionDefaults(s);
  const left = Math.max(0, d.x * 100 - d.width / 2), right = Math.max(0, 100 - d.x * 100 - d.width / 2);
  const a = (d.shadowAngle * Math.PI) / 180;
  const dx = r2(Math.cos(a) * d.shadowDistance), dy = r2(Math.sin(a) * d.shadowDistance);
  const sh = d.shadow > 0 ? `calc(var(--u)*${dx}) calc(var(--u)*${dy}) calc(var(--u)*${d.shadowBlur}) ${hexA(d.shadowColor, r2(0.65 * d.shadow))}, 0 0 calc(var(--u)*0.25) ${hexA(d.shadowColor, r2(0.55 * d.shadow))}` : 'none';
  const stroke = d.stroke > 0 ? `-webkit-text-stroke:calc(var(--u)*${d.stroke}) ${d.strokeColor};paint-order:stroke fill;` : '';
  const box = d.box ? `background:${hexA(d.boxColor, d.boxOpacity)};padding:calc(var(--u)*${d.boxPadding}) calc(var(--u)*${r2(d.boxPadding * 2.4)});border-radius:calc(var(--u)*${d.boxRadius});box-decoration-break:clone;-webkit-box-decoration-break:clone;` : '';
  // Entrada e saída: progresso 0–1 no instante t (nada de CSS animation: o export desenha quadro a quadro).
  let opacity = d.opacity;
  let scale = d.scale;
  let shift = 0; // em --u
  if (anim) {
    const pin = c01((anim.t - anim.start) / Math.max(0.03, d.animDur));
    const pout = c01((anim.end - anim.t) / Math.max(0.03, d.animDur));
    if (d.animIn === 'pop') (scale *= 0.6 + 0.4 * outBack(pin)), (opacity *= Math.min(1, pin * 3));
    else if (d.animIn === 'slide') (shift += (1 - outCubic(pin)) * 2.2), (opacity *= outCubic(pin));
    else if (d.animIn === 'fade') opacity *= outCubic(pin);
    if (d.animOut === 'fade') opacity *= outCubic(pout);
    else if (d.animOut === 'slide') (shift += (1 - outCubic(pout)) * 2.2), (opacity *= outCubic(pout));
  }
  const transform = `transform:translateY(calc(-50% + var(--u)*${r2(shift)})) rotate(${d.rotation}deg) scale(${r2(scale)});`;
  const deco = d.underline ? 'text-decoration:underline;text-underline-offset:0.12em;' : '';
  return `top:${(d.position * 100).toFixed(2)}%;left:${left.toFixed(2)}%;right:${right.toFixed(2)}%;font-family:${(CAPTION_FONTS[d.font] ?? CAPTION_FONTS.inter).family};font-weight:${d.weight};font-style:${d.italic ? 'italic' : 'normal'};font-size:calc(var(--u)*${d.size});color:${d.color};--hl:${d.accent};letter-spacing:${d.letterSpacing}em;line-height:${d.lineHeight};text-shadow:${sh};opacity:${r2(opacity)};${transform}${deco}${stroke}${box}`;
}

/** A legenda está dentro da área segura do quadro? (QC: `legenda-fora-do-quadro`.) */
export function captionSafe(s: CaptionSettings): { ok: boolean; motivo?: string } {
  const d = captionDefaults(s);
  const l = d.x * 100 - d.width / 2, rgt = d.x * 100 + d.width / 2;
  if (l < 1 || rgt > 99) return { ok: false, motivo: `sai do quadro na horizontal (centro ${Math.round(d.x * 100)}%, largura ${d.width}%)` };
  if (d.position < 0.06 || d.position > 0.94) return { ok: false, motivo: `encosta na borda (altura ${Math.round(d.position * 100)}%)` };
  if (Math.abs(d.rotation) > 30) return { ok: false, motivo: `girada ${d.rotation}° — difícil de ler` };
  return { ok: true };
}

export interface TextWord {
  w: string;
  start: number;
  end: number;
  c?: number;
}

export interface CueWord {
  text: string;
  start: Seconds;
  end: Seconds;
  /** De onde a palavra veio no bruto (identifica a legenda para os ajustes manuais). */
  src?: { assetId: string; at: Seconds };
}

export interface Cue {
  start: Seconds;
  end: Seconds;
  words: CueWord[];
  /** Identidade estável: "asset@início da 1ª palavra no bruto". */
  key?: string;
  /** Texto automático, quando o editor reescreveu esta legenda. */
  original?: string;
  edited?: boolean;
  /** Regra da casa: sempre que há lettering, motion ou B-roll, a legenda se esconde (fica apagada na timeline). */
  coveredBy?: 'lettering' | 'motion' | 'broll';
  /** O editor mandou mostrar mesmo coberta. */
  forced?: boolean;
  hidden?: boolean;
  /** Altura própria desta legenda (ajuste por bloco ou por trecho); sem ela, a posição global. */
  position?: number;
}

/** Ajustes da legenda com a altura própria de uma legenda (CH-0014); sem altura própria, os globais. */
export const cueCaptions = (s: CaptionSettings, c: Pick<Cue, 'position'> | undefined): CaptionSettings => (c?.position !== undefined ? { ...s, position: c.position } : s);

export const cueKey = (w: CueWord) => (w.src ? `${w.src.assetId}@${w.src.at.toFixed(3)}` : `t@${w.start.toFixed(3)}`);

/** Hesitação não vira legenda (mesmo quando ficou no corte). */
const HESITATION = /^(hum+|hm+|ahn+|han+|uh+|eh+|a{2,}h*|ã+)[.,!?…]*$/i;

/**
 * Legendas da timeline, já no tempo de SAÍDA. Derivadas da transcrição + cortes: mudou o corte, mudou a
 * legenda — nunca fica legenda de trecho que saiu.
 *
 * reels: ~2 palavras por vez, quebra em pontuação e pausa ≥ 0,3 s, nunca menos de 0,35 s na tela
 *        (cresce para 3 palavras antes de mostrar algo rápido demais). Regra do video-use / Reels.
 * frase: 4–7 palavras, quebra nas pausas naturais.
 */
/** Palavras que ficaram no corte, na ordem e no tempo da TIMELINE (sem hesitação). */
/** Texto de uma palavra com a correção de grafia da revisão, se houver. */
export function fixedText(tl: Pick<Timeline, 'wordFixes'>, assetId: string, w: TextWord): string {
  const f = tl.wordFixes?.find((x) => x.assetId === assetId && Math.abs(x.at - w.start) < 0.02);
  return f?.text ?? w.w;
}

/** Início e fim da palavra no bruto com a correção de tempo do editor (CH-0041); sem correção, os do ASR. */
export function fixedTimes(tl: Pick<Timeline, 'wordFixes'>, assetId: string, w: TextWord): { start: number; end: number; mid: number } {
  const f = tl.wordFixes?.find((x) => x.assetId === assetId && Math.abs(x.at - w.start) < 0.02);
  if (f?.start === undefined && f?.end === undefined) return { start: w.start, end: w.end, mid: w.c ?? (w.start + w.end) / 2 };
  const start = f.start ?? w.start;
  const end = f.end ?? w.end;
  return { start, end, mid: (start + end) / 2 };
}

/**
 * Confere as correções de tempo de palavra (op `fix_words` com start/end, CH-0041) contra a transcrição: a palavra
 * existe, start < end, não cruza a palavra de antes nem a de depois (já com as correções delas) e, se está na
 * montagem, continua dentro do mesmo trecho. Devolve o motivo da recusa ou null.
 */
export function wordTimingError(tl: Timeline, assetId: string, words: TextWord[], ats: number[], duration?: number): string | null {
  const nome = (w: TextWord) => `'${fixedText(tl, assetId, w)}' (${w.start})`;
  for (const at of ats) {
    const i = words.findIndex((w) => Math.abs(w.start - at) < 0.02);
    if (i < 0) return `fix_words: não há palavra começando em ${at} s na transcrição deste asset`;
    const w = words[i]!;
    const t = fixedTimes(tl, assetId, w);
    if (!(t.start < t.end)) return `fix_words: ${nome(w)} ficaria com start ${t.start} ≥ end ${t.end}`;
    if (duration && duration > 0 && t.end > duration + 0.05) return `fix_words: ${nome(w)} terminaria em ${t.end} s, depois do fim do arquivo (${duration} s)`;
    const prev = words[i - 1];
    if (prev) {
      const p = fixedTimes(tl, assetId, prev);
      if (t.start < p.end - 1e-3) return `fix_words: ${nome(w)} começaria em ${t.start} s, antes do fim de ${nome(prev)} em ${p.end} s; corrija o end dela na mesma op`;
    }
    const next = words[i + 1];
    if (next) {
      const n = fixedTimes(tl, assetId, next);
      if (t.end > n.start + 1e-3) return `fix_words: ${nome(w)} terminaria em ${t.end} s, depois do início de ${nome(next)} em ${n.start} s; corrija o start dela na mesma op`;
    }
    // Dentro do trecho: a palavra que estava num clipe da montagem não pode sair dele (sumiria da legenda).
    const mid0 = w.c ?? (w.start + w.end) / 2;
    const clip = tl.main.find((c) => c.assetId === assetId && mid0 >= c.in && mid0 < c.out);
    if (clip && (t.start >= clip.out || t.end <= clip.in || t.mid < clip.in || t.mid >= clip.out)) return `fix_words: ${nome(w)} sairia do trecho ${clip.in}–${clip.out} s do bruto em que está na montagem`;
  }
  return null;
}

export function placeWords(tl: Timeline, transcripts: Record<string, TextWord[] | undefined>): CueWord[] {
  const starts = clipStarts(tl);
  const placed: CueWord[] = [];
  tl.main.forEach((clip, i) => {
    const words = transcripts[clip.assetId];
    if (!words) return;
    for (const w of words) {
      // Tempo corrigido pelo editor (CH-0041) vale para a legenda; a palavra continua identificada pelo início do ASR.
      const t = tl.wordFixes?.length ? fixedTimes(tl, clip.assetId, w) : { start: w.start, end: w.end, mid: w.c ?? (w.start + w.end) / 2 };
      if (t.mid < clip.in || t.mid >= clip.out) continue;
      if (HESITATION.test(w.w)) continue;
      const sp = clipSpeed(clip);
      const s0 = starts[i]!;
      placed.push({ src: { assetId: clip.assetId, at: w.start }, text: tl.wordFixes?.length ? fixedText(tl, clip.assetId, w) : w.w, start: Math.max(s0, s0 + (t.start - clip.in) / sp), end: Math.min(s0 + clipDuration(clip), s0 + (t.end - clip.in) / sp) });
    }
  });
  return placed;
}

export function buildCues(tl: Timeline, transcripts: Record<string, TextWord[] | undefined>, s: CaptionSettings, opts: { includeHidden?: boolean } = {}): Cue[] {
  const placed = placeWords(tl, transcripts);
  const edits = tl.captionEdits ?? [];
  const editOf = (w: CueWord | undefined) => (w?.src && edits.length ? edits.find((e) => e.assetId === w.src!.assetId && Math.abs(e.at - w.src!.at) < 0.02) : undefined);

  const maxWords = s.maxWords ?? (s.style === 'reels' ? 2 : 6);
  const hardMax = s.maxWords ? s.maxWords : s.style === 'reels' ? 3 : 7;
  const maxChars = s.maxChars && s.maxChars > 0 ? s.maxChars : Infinity;
  const chars = (ws: CueWord[]) => ws.reduce((n, w) => n + w.text.length + 1, -1);
  const minDur = s.style === 'reels' ? 0.35 : 0.8;
  const breakPause = s.style === 'reels' ? 0.3 : 0.4;
  // Camadas que escondem a legenda (lettering, motion, B-roll), no tempo da timeline. Título fixo (`keepCaptions`) convive.
  const layers = tl.overlays
    .filter((o) => (o.role === 'lettering' || o.role === 'motion' || o.role === 'broll') && !o.keepCaptions)
    .map((o) => ({ role: o.role as 'lettering' | 'motion' | 'broll', pos: resolveOverlay(tl, o) }))
    .filter((x): x is { role: 'lettering' | 'motion' | 'broll'; pos: { start: number; end: number } } => !!x.pos);
  const cues: Cue[] = [];
  let cur: CueWord[] = [];
  const flush = () => {
    if (cur.length) cues.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur });
    cur = [];
  };
  placed.forEach((w, i) => {
    // Ajuste manual "dividir": uma legenda nova começa nesta palavra.
    if (cur.length && editOf(w)?.split) flush();
    // Camada entrando: a legenda não junta palavras de antes e de depois dela (CH-0014; senão some inteira sob o B-roll).
    // O "juntar" do editor na palavra vence (CH-0021: o artigo que começa junto com o lettering fica na legenda anterior).
    if (cur.length && !editOf(w)?.join && layers.some(({ pos }) => cur[0]!.start < pos.start && w.start >= pos.start - 1e-6)) flush();
    // Limite de caracteres: fecha o bloco antes de a palavra estourar.
    if (cur.length && chars([...cur, w]) > maxChars) flush();
    cur.push(w);
    const next = placed[i + 1];
    // Ajuste manual "juntar": a próxima palavra não pode abrir legenda.
    if (next && editOf(next)?.join) return;
    if (next && editOf(next)?.split) return flush();
    const dur = w.end - cur[0]!.start;
    const punct = /[.?!…,;:]$/.test(w.text);
    const pause = !next || next.start - w.end >= breakPause;
    const full = cur.length >= maxWords;
    if (cur.length >= hardMax || ((punct || pause || full) && (dur >= minDur || !next || pause))) flush();
  });
  flush();
  // Cada legenda fica até a próxima começar (sem piscar), mas sai em pausa longa.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (next && next.start - cues[i]!.end < 0.5) cues[i]!.end = next.start;
    cues[i]!.end = Math.max(cues[i]!.end, cues[i]!.start + minDur);
    if (next) cues[i]!.end = Math.min(cues[i]!.end, next.start);
  }
  // Ajustes manuais de texto / apagar, presos à primeira palavra de cada legenda.
  for (const c of cues) {
    c.key = cueKey(c.words[0]!);
    const e = editOf(c.words[0]);
    // "Forçar" numa palavra vale para o bloco que a contém (a quebra muda com o corte e com as camadas; CH-0016).
    const forced = c.words.some((w) => editOf(w)?.force);
    if (e?.text !== undefined) {
      c.original = c.words.map((w) => w.text).join(' ');
      const toks = e.text.split(/\s+/).filter(Boolean);
      if (toks.length === c.words.length) c.words = c.words.map((w, k) => ({ ...w, text: toks[k]! }));
      else {
        // Outra quantidade de palavras: o destaque anda por igual entre o começo e o fim da fala.
        const a = c.words[0]!.start;
        const b = Math.max(a + 0.1, c.words[c.words.length - 1]!.end);
        const step = (b - a) / Math.max(1, toks.length);
        const first = c.words[0]!;
        c.words = toks.map((t, k) => ({ text: t, start: a + k * step, end: a + (k + 1) * step, src: k === 0 ? first.src : undefined }));
      }
      c.edited = true;
    }
    if (e?.hidden) c.hidden = true;
    if (forced) c.forced = true;
    // Altura própria: o ajuste do bloco vence o do trecho (`until`) que o contém.
    const src = c.words[0]!.src;
    const zone = src && edits.find((z) => z.position !== undefined && z.until !== undefined && z.assetId === src.assetId && src.at >= z.at - 0.02 && src.at <= z.until + 0.02);
    const position = e?.position ?? zone?.position;
    if (position !== undefined) c.position = position;
  }
  // Coberta por camada: lettering, motion ou B-roll em cima de mais de 1/3 da legenda (ou do seu começo). Camada que
  // só passa até 2 quadros do começo da legenda não a esconde (CH-0016): a legenda começa quando a camada sai.
  const grace = 2 / (tl.fps || 30) + 1e-3;
  for (const c of cues) {
    const tail = layers.filter(({ pos }) => pos.start <= c.start + 0.05 && pos.end > c.start && pos.end - c.start <= grace && pos.end < c.end);
    const hit = layers.find((l) => {
      if (tail.includes(l)) return false;
      const { pos } = l;
      const ov = Math.min(c.end, pos.end) - Math.max(c.start, pos.start);
      return ov > 0 && (ov >= (c.end - c.start) / 3 || (pos.start <= c.start + 0.05 && pos.end > c.start));
    });
    if (!hit && tail.length) c.start = tail.reduce((m, { pos }) => Math.max(m, pos.end), c.start);
    if (hit) c.coveredBy = hit.role;
    // A legenda fica até a próxima começar, então pode atravessar o corte; camada que entra no meio dela a encerra
    // ali (CH-0014: B-roll no 1º quadro do clipe mostrava a legenda do clipe anterior por cima).
    else if (!c.forced) {
      const cut = layers.filter(({ pos }) => pos.start > c.start && pos.start < c.end).reduce((m, { pos }) => Math.min(m, pos.start), Infinity);
      if (cut < c.end) c.end = cut;
    }
  }
  return opts.includeHidden ? cues : cues.filter((c) => !c.hidden && c.words.length);
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Texto da legenda em HTML, com a palavra ativa destacada. */
export function cueHtml(cue: Cue, s: CaptionSettings, at: Seconds | null): string {
  const d = captionDefaults(s);
  return cue.words
    .map((w) => {
      const t = esc(s.uppercase ? w.text.toLocaleUpperCase('pt-BR') : w.text);
      // "Palavra por palavra": o que ainda não foi dito fica invisível (mantém o lugar, não pula).
      if (d.animIn === 'type' && at !== null && at < w.start) return `<span style="opacity:0">${t}</span>`;
      const on = s.highlight && at !== null && at >= w.start && at < w.end;
      if (!on || d.wordAnim === 'none') return t;
      if (d.wordAnim === 'scale') return `<span class="hl" style="display:inline-block;transform:scale(1.12)">${t}</span>`;
      if (d.wordAnim === 'box') return `<span class="hl" style="display:inline-block;background:${d.accent};color:${d.color};padding:0 0.18em;border-radius:0.14em">${t}</span>`;
      return `<span class="hl">${t}</span>`;
    })
    .join(' ');
}

/**
 * CSS único das camadas de texto. Unidades em `--u` (1% da ALTURA do quadro): o mesmo CSS vale para o
 * preview (quadro pequeno) e para o export (1920 px), sem diferença de proporção.
 */
export const TEXT_CSS = `
.ne-text-layer { position:absolute; inset:0; pointer-events:none; font-family:'Inter',"Helvetica Neue",Helvetica,Arial,sans-serif; color:#fff; font-synthesis:none; }
.ne-caption { position:absolute; left:8%; right:8%; transform:translateY(-50%); text-align:center; font-weight:800; font-size:calc(var(--u) * 3.6); line-height:1.12; letter-spacing:-0.01em; text-shadow:0 calc(var(--u)*0.18) calc(var(--u)*0.9) rgba(0,0,0,.65), 0 0 calc(var(--u)*0.25) rgba(0,0,0,.55); }
.ne-caption.frase { font-weight:700; font-size:calc(var(--u) * 2.7); }
.ne-caption .hl { color:var(--hl,#E8B44A); }
.ne-caption.boxed > span { display:inline; }
.ne-lettering { position:absolute; left:7%; right:7%; top:22%; text-align:center; font-weight:800; font-size:calc(var(--u) * 5.2); line-height:1.02; letter-spacing:-0.02em; text-shadow:0 calc(var(--u)*0.25) calc(var(--u)*1.4) rgba(0,0,0,.55); }
.ne-lettering .acc { color:#E8B44A; }
`;

/** Lettering em HTML: o trecho entre *asteriscos* sai em âmbar ("O *SENTIDO*?"). */
export function letteringHtml(text: string): string {
  return esc(text).replace(/\*([^*]+)\*/g, '<span class="acc">$1</span>');
}

/** A legenda aparece no vídeo? Apagada nunca; coberta por camada só se o editor forçou. */
export const cueVisible = (c: Cue): boolean => !c.hidden && (!c.coveredBy || !!c.forced);
