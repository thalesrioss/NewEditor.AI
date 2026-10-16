/**
 * Motions narrativos — cérebro local (sem API).
 *
 * 1. Lê a HISTÓRIA GERAL: tema (palavras que voltam), tópicos, gancho, virada, tese e fechamento.
 * 2. Acha os MOMENTOS em que uma imagem conta melhor que a fala: número que prova, lista que explica,
 *    oposição que contrasta, pergunta que vira a história, citação/insight que emociona, conceito que nomeia.
 * 3. Escolhe a OBRA-ALVO do vídeo (uma referência da biblioteca que serve a esse tema) e desenha cada motion
 *    com a paleta e a matéria dela — um fio estético só, como no Motion Studio.
 *
 * Regras: ≤ 1 motion a cada ~24 s, ≥ 7 s de respiro entre eles, o mesmo mecanismo no máximo 2× (regra do
 * canvas), nada sobre o CTA, nada por cima de B-roll ou de lettering feito à mão.
 */
import { motionCues, MOTION_TEMPLATES, NARRATIVE_FUNCTIONS, SFX_LABEL, styleFromReference, type CueWord, type MotionSpec, type MotionTemplateId, type NarrativeFunction } from '@neweditor/core';
import type { MotionRef } from './refs.ts';

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

export const STOP = new Set(
  'a o as os e é de da do das dos em na no nas nos num numa um uma uns umas que se pra para por com sem mas eu ele ela eles elas isso esse essa este esta isto aquilo já não só mais muito muita porque quando como me te lhe seu sua seus suas meu minha meus minhas nosso nossa você vocês ao aos à às tá ta tô to foi ser ter tem tinha era são está estar estou vai vou vão sobre até também então assim aqui lá bem tudo nada coisa coisas gente cara tipo sim né ou qual quem onde ainda sempre nunca pelo pela pelos pelas mesmo mesma fato de fato dele dela nesse nessa desse dessa algo alguém outro outra outros outras vez vezes uns todo toda todos todas cada quer faz fazer fala falar dizer disse vão deixa realmente acho pensar parou tenho tive pessoas momento'.split(
    ' ',
  ),
);
export const clean = (w: string) => w.replace(/[.,!?…;:"“”()]/g, '').replace(/\.\.\.$/, '');
export const norm = (w: string) => clean(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const isContent = (w: string) => {
  const n = norm(w);
  return n.length >= 4 && !STOP.has(n) && !STOP.has(clean(w).toLowerCase());
};
/** Agrupa variações (feliz/felicidade, virtude/virtudes) pela raiz. */
export const root = (w: string) => {
  const n = norm(w).replace(/(s|es)$/, '');
  if (/^feli[cz]/.test(n)) return 'felic';
  return n.length >= 6 ? n.slice(0, 5) : n;
};
const capFirst = (s: string) => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);

export interface Sentence {
  words: CueWord[];
  start: number;
  end: number;
  text: string;
  index: number;
}

export const NUM_WORDS: Record<string, number> = { dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100, mil: 1000 };
export const UNITS = /^(segundos?|minutos?|horas?|dias?|semanas?|meses|mês|anos?|reais|real|dólares?|vezes|pessoas|passos?|etapas?|neurotransmissores|%|porcento|mil|milhões?|bilhões?|quilos?|km|metros?)$/i;
const CTA = /\b(comenta|comente|comentar|link|inscreve|inscrev|segue|siga|compartilha|curte|curtir|descrição|bio|arrasta)\b/i;
export const EMOTION = /\b(amor|ama|amar|sentir|sente|sentimento|alegria|tristeza|rejeição|medo|dor|saudade|sofrimento|feliz|felicidade|vazio|solidão|cansaço|esperança)\b/i;
const ANTONYMS: [RegExp, RegExp][] = [
  [/^bem$/, /^(mal|pior)$/],
  [/^melhor$/, /^pior$/],
  [/^tudo$/, /^nada$/],
  [/^feliz$/, /^triste$/],
  [/^dif[ií]ceis?$/, /^(alegria|f[aá]ceis?|bons?)$/],
  [/^ganha/, /^perd/],
  [/^amor$/, /^(ódio|rejeição)$/],
  [/^corpo$/, /^alma$/],
  [/^f[eé]$/, /^raz[aã]o$/],
  [/^material$/, /^imaterial$/],
  [/^passado$/, /^futuro$/],
  [/^curto$/, /^longo$/],
  [/^ter$/, /^ser$/],
  [/^prazer$/, /^felicidade$/],
];

/** Frases da timeline: pontuação final ou pausa > 0,8 s; "…" emenda na seguinte (é a mesma ideia). */
export function sentences(words: CueWord[]): Sentence[] {
  const raw: CueWord[][] = [];
  let cur: CueWord[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const gap = words[i + 1] ? words[i + 1]!.start - w.end : 9;
    if (/[.?!…]$/.test(w.text) || gap > 0.8) {
      raw.push(cur);
      cur = [];
    }
  });
  if (cur.length) raw.push(cur);
  const merged: CueWord[][] = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    const prevLast = prev?.[prev.length - 1];
    const trailing = prevLast && /(\.\.\.|…)$/.test(prevLast.text) && s[0]!.start - prevLast.end < 1.6 && prev!.length + s.length <= 30;
    if (prev && trailing) prev.push(...s);
    else merged.push([...s]);
  }
  return merged.map((ws, index) => ({ words: ws, start: ws[0]!.start, end: ws[ws.length - 1]!.end, text: ws.map((w) => w.text).join(' '), index }));
}

// ---------------------------------------------------------------------------
// Leitura da história
// ---------------------------------------------------------------------------

export interface StoryBeat {
  text: string;
  start: number;
}

export interface StoryReading {
  tema: string[];
  topicos: string[];
  gancho?: StoryBeat;
  virada?: StoryBeat;
  tese?: StoryBeat;
  fechamento?: StoryBeat;
  ctaDesde?: number;
  frases: number;
}

const TOPICS: { id: string; words: RegExp; serve: RegExp }[] = [
  { id: 'filosofia', words: /^(filosof|socrat|platao|aristot|agostin|nietzsch|alma|virtud|sentido|verdad|existen|etica|razao|felicid|feliz)/, serve: /filosof|ideias? abstrat|existenc|citaç|conceit|reflex/ },
  { id: 'ciência', words: /^(cienc|cerebr|neurotr|seroton|dopamin|ocitoc|eustos|hormon|quimic|estud|pesquis|biolog|estimul)/, serve: /ciênc|cienc|dado|explica|biolog|corpo|mecanism|processo/ },
  { id: 'emoção', words: /^(amor|sentim|sentir|sente|alegr|tristez|rejeic|medo|dor|saudad|sofrim|felicid|feliz|cansac)/, serve: /emoç|emoc|sentiment|afeto|nostalg|dram|íntim|intim|pessoal/ },
  { id: 'religião', words: /^(deus|igrej|fe|bibli|santo|sagrad|oraca)/, serve: /religi|sagrad|\bfé\b|espiritu/ },
  { id: 'história', words: /^(histor|secul|imperi|guerra|roma|rei|antig|epoca)/, serve: /histór|histor|époc|epoc|biograf/ },
  { id: 'dinheiro', words: /^(dinheir|reais|empres|negoc|vend|client|lucr|marketi|renda|invest)/, serve: /dinheiro|negóc|negoc|finan|marca|produt|venda/ },
  { id: 'tecnologia', words: /^(tecnol|intelig|aplicat|softwar|digital|internet|chatgpt)/, serve: /tecnolog|digital|produto|software/ },
];

export function readStory(ss: Sentence[], total: number): StoryReading & { weights: Map<string, number>; ctaAt: number; roles: Map<number, string> } {
  // CTA: do primeiro pedido de comentário/link em diante (nos últimos 35%), nada de motion narrativo.
  const ctaS = ss.find((s) => s.start > total * 0.65 && CTA.test(s.text));
  // A frase colada antes do pedido costuma ser a promessa do CTA ("vou disponibilizar… É só comentar").
  const before = ctaS ? ss[ctaS.index - 1] : undefined;
  const ctaAt = !ctaS ? total : before && ctaS.start - before.end < 1.2 && before.start > total * 0.65 ? before.start : ctaS.start;
  const story = ss.filter((s) => s.start < ctaAt);

  const freq = new Map<string, { n: number; forms: Map<string, number> }>();
  for (const s of story)
    for (const w of s.words) {
      if (!isContent(w.text)) continue;
      const k = root(w.text);
      const e = freq.get(k) ?? { n: 0, forms: new Map() };
      e.n++;
      const f = clean(w.text).toLowerCase();
      e.forms.set(f, (e.forms.get(f) ?? 0) + 1);
      freq.set(k, e);
    }
  const ranked = [...freq.entries()].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].n - a[1].n);
  const weights = new Map(ranked.slice(0, 12).map(([k, e]) => [k, e.n]));
  const tema = ranked.slice(0, 6).map(([, e]) => [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0]![0]);

  const topicScore = TOPICS.map((t) => ({ id: t.id, n: story.reduce((a, s) => a + s.words.filter((w) => t.words.test(norm(w.text))).length, 0) }));
  const topicos = topicScore.filter((t) => t.n >= 3).sort((a, b) => b.n - a.n).map((t) => t.id);

  // Peso por palavra limitado: "felicidade" repetida não pode decidir sozinha qual é a tese.
  const kw = (s: Sentence) => s.words.reduce((a, w) => a + (isContent(w.text) ? Math.min(3, weights.get(root(w.text)) ?? 0) : 0), 0);
  const gancho = story[0];
  const virada = story.find((s) => s.start > total * 0.2 && /^(mas|só que|porém|e se|agora)\b/i.test(s.text) && (/\?$/.test(s.text) || kw(s) >= 3));
  const conclusive = /\b(verdadeir[ao]|a realidade é|na verdade|conclusão|o segredo|entendi que|aprendi que)\b/i;
  // "…cheguei na minha própria conclusão." anuncia a tese: ela é a frase seguinte.
  const announced = new Set(story.filter((s) => s.words.length <= 12 && /\b(conclusão|cheguei|entendi|percebi|aprendi)\b/i.test(s.text) && !/\?$/.test(s.text)).map((s) => s.index + 1));
  const tese = [...story]
    .filter((s) => !/\?$/.test(s.text) && s.words.length >= 5)
    .map((s) => ({ s, sc: kw(s) / Math.sqrt(s.words.length) + (conclusive.test(s.text) ? 2 : 0) + (s.start > total * 0.55 ? 1.2 : 0) + (announced.has(s.index) ? 3 : 0) }))
    .sort((a, b) => b.sc - a.sc)[0]?.s;
  const fechamento = story[story.length - 1];
  const roles = new Map<number, string>();
  if (gancho) roles.set(gancho.index, 'gancho');
  if (virada) roles.set(virada.index, 'virada');
  if (tese) roles.set(tese.index, 'tese');
  if (fechamento && !roles.has(fechamento.index)) roles.set(fechamento.index, 'fechamento');
  const beat = (s?: Sentence) => (s ? { text: s.text, start: s.start } : undefined);
  return { tema, topicos, gancho: beat(gancho), virada: beat(virada), tese: beat(tese), fechamento: beat(fechamento), ctaDesde: ctaS ? ctaAt : undefined, frases: ss.length, weights, ctaAt, roles };
}

export function storyReading(words: CueWord[], total: number): StoryReading {
  const { weights: _w, ctaAt: _c, roles: _r, ...reading } = readStory(sentences(words), total);
  return reading;
}

// ---------------------------------------------------------------------------
// Obra-alvo
// ---------------------------------------------------------------------------

export function pickReference(refs: MotionRef[], reading: StoryReading): { ref?: MotionRef; why: string } {
  if (!refs.length) return { why: 'biblioteca vazia — usando o estilo da casa' };
  const scored = refs.map((r) => {
    const serve = r.serve.toLowerCase();
    const evitar = r.evitar.toLowerCase();
    let sc = 0;
    const hits: string[] = [];
    reading.topicos.forEach((id, i) => {
      const t = TOPICS.find((x) => x.id === id)!;
      const w = i === 0 ? 3 : i === 1 ? 2 : 1;
      if (t.serve.test(serve)) {
        sc += 3 * w;
        hits.push(id);
      }
      if (t.serve.test(evitar)) sc -= 4 * w;
    });
    if (r.categoria === 'Motion de YouTube') sc += 2; // feito para motion sobre apresentador
    else if (r.categoria === 'Tipografia cinética' || r.categoria === 'Motion graphics') sc += 1;
    else if (r.categoria === '3D') sc -= 2; // nossos templates são 2D
    if (r.familias.some((f) => /tipografia como imagem/i.test(f))) sc += 1;
    if (r.paleta.length < 3) sc -= 1;
    return { r, sc, hits };
  });
  scored.sort((a, b) => b.sc - a.sc || (b.r.usadoNaSerie ?? 0) - (a.r.usadoNaSerie ?? 0));
  const best = scored[0]!;
  const why = best.hits.length ? `serve para ${best.r.serve.replace(/\.$/, '')} — o vídeo fala de ${best.hits.join(' e ')}` : `${best.r.categoria}, a mais próxima do formato (apresentador + motion)`;
  return { ref: best.r, why };
}

// ---------------------------------------------------------------------------
// Momentos
// ---------------------------------------------------------------------------

export interface MotionPlan {
  start: number;
  end: number;
  spec: MotionSpec;
  score: number;
  /** Papel da frase na história (gancho, virada, tese, fechamento) quando tiver. */
  papel?: string;
}

interface Cand {
  template: MotionTemplateId;
  funcao: NarrativeFunction;
  s: Sentence;
  start: number;
  end: number;
  texts: string[];
  beatsAbs: number[];
  key?: number;
  kicker?: string;
  variant?: string;
  ideia: string;
  base: number;
}

const FUNCTION_WORD = /^(é|e|que|de|da|do|das|dos|com|pra|para|em|no|na|nos|nas|um|uma|o|a|os|as|ao|à|seu|sua|seus|suas|meu|minha|nosso|nossa|apenas|só|mais|muito|tá|está|era|ser|vem|cuidar|dizer|vão)$/i;
/** Onde um sintagma nominal começa (de/da/do ficam DENTRO: "combo de estímulos"). */
const PHRASE_BREAK = /^(é|e|que|com|pra|para|em|no|na|nos|nas|num|numa|um|uma|o|a|os|as|ao|à|seu|sua|seus|suas|meu|minha|nosso|nossa|apenas|só|mais|muito|menos|nem|tá|está|era|ser|vem|cuidar|dizer|vão|pelo|pela)$/i;
const POSSESSIVE = /^(seu|sua|seus|suas|meu|minha|meus|minhas|nosso|nossa|o|a|os|as|um|uma)$/i;
/** Núcleo de um trecho: o sintagma no fim ("de suas virtudes" → "virtudes", "em um combo de estímulos" → "combo de estímulos"). */
function tail(ws: CueWord[], max = 3): CueWord[] {
  let i = ws.length;
  while (i > 0 && !PHRASE_BREAK.test(clean(ws[i - 1]!.text))) i--;
  let out = ws.slice(i);
  while (out.length && (POSSESSIVE.test(clean(out[0]!.text)) || /^(de|da|do|das|dos)$/i.test(clean(out[0]!.text)))) out = out.slice(1);
  return out.length && out.length <= max ? out : [];
}
const phrase = (ws: CueWord[]) => ws.map((w) => clean(w.text)).join(' ');

function numberCand(s: Sentence, ss: Sentence[]): Cand[] {
  const out: Cand[] = [];
  const ws = s.words;
  for (let i = ws.length - 2; i >= 0; i--) {
    const raw = clean(ws[i]!.text);
    const n = norm(ws[i]!.text);
    const next = clean(ws[i + 1]!.text);
    const isDigit = /^\d+([.,]\d+)?$/.test(raw);
    const val = isDigit ? raw : NUM_WORDS[n] !== undefined ? String(NUM_WORDS[n]) : null;
    if (!val || !UNITS.test(next)) continue;
    const money = /^(reais|real)$/i.test(next);
    const before = ws.slice(Math.max(0, i - 5), i).map((w) => clean(w.text));
    // Kicker: o que vem antes do número, a partir do último número/verbo de contexto (máx. 5 palavras).
    const kicker = before.slice(-5).join(' ');
    const start = ws[i]!.start - 0.6;
    out.push({
      template: 'numero',
      funcao: 'prove',
      s,
      start,
      end: Math.min(start + 3.4, Math.max(ws[i + 1]!.end + 1.3, start + 2.4)),
      texts: money ? [`R$ ${val}`, ''] : [val, next.toLowerCase()],
      beatsAbs: [ws[i]!.start],
      kicker: kicker || undefined,
      ideia: `O ${money ? `valor R$ ${val}` : `número ${val} ${next}`} cresce até chegar no valor no instante em que é dito — corte seco para o dado e volta para o rosto.`,
      // Dinheiro, % e números grandes provam; "três meses" só situa.
      base: money || /%|porcento|mil|milh|bilh/.test(next) || Number(val) >= 10 ? 4.4 : 3.2,
    });
    break; // o último número da frase é o que fecha a ideia
  }
  void ss;
  return out;
}

function listCand(s: Sentence, ss: Sentence[]): Cand[] {
  // Segmentos por vírgula / "e" / "…"; cada segmento contribui o seu núcleo (≤ 3 palavras).
  const segs: CueWord[][] = [];
  let cur: CueWord[] = [];
  for (const w of s.words) {
    // Conjunção "e" (sem acento: "é" é verbo e não separa item).
    if (clean(w.text).toLowerCase() === 'e' && cur.length) {
      segs.push(cur);
      cur = [];
      continue;
    }
    cur.push(w);
    if (/[,…]$|\.\.\.$/.test(w.text)) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  const items: CueWord[][] = [];
  for (const seg of segs) {
    const t = seg.length <= 3 && seg.every((w) => !FUNCTION_WORD.test(clean(w.text)) || POSSESSIVE.test(clean(w.text))) ? seg.filter((w) => !POSSESSIVE.test(clean(w.text))) : tail(seg);
    if (t.length) items.push(t);
    else if (items.length) break;
  }
  if (items.length < 3 || items.length > 5) return [];
  if (items[items.length - 1]![0]!.start - items[0]![0]!.start > 6) return [];
  // Kicker: "três neurotransmissores" na frase anterior, ou o nome de quem defende a ideia.
  const prev = ss[s.index - 1];
  let kicker: string | undefined;
  if (prev && s.start - prev.end < 2.5) {
    const pw = prev.words;
    for (let i = 0; i < pw.length - 1; i++) {
      const n = norm(pw[i]!.text);
      if ((NUM_WORDS[n] !== undefined || /^\d+$/.test(n)) && isContent(pw[i + 1]!.text)) kicker = `${clean(pw[i]!.text)} ${clean(pw[i + 1]!.text)}`;
    }
    const name = pw.find((w) => /^[A-ZÁÉÍÓÚ]/.test(clean(w.text)) && clean(w.text).length > 3 && !STOP.has(clean(w.text).toLowerCase()));
    if (!kicker && name) kicker = `para ${clean(name.text)}`;
  }
  if (!kicker) {
    const lead = segs[0]!.slice(0, segs[0]!.length - items[0]!.length).map((w) => clean(w.text));
    if (lead.length && lead.length <= 5) kicker = lead.join(' ');
  }
  const start = items[0]![0]!.start - 0.7;
  const last = items[items.length - 1]!;
  return [
    {
      template: 'lista',
      funcao: 'explain',
      s,
      start,
      end: Math.min(start + 6, last[last.length - 1]!.end + 1.1),
      texts: items.map((it) => phrase(it)),
      beatsAbs: items.map((it) => it[0]!.start),
      kicker,
      ideia: `Os itens caem como cartões, cada um no instante em que é falado: ${items.map((it) => phrase(it)).join(', ')}.`,
      base: 4,
    },
  ];
}

function questionCand(s: Sentence, weights: Map<string, number>): Cand[] {
  if (!/\?$/.test(s.text) || s.words.length < 4 || s.words.length > 13) return [];
  const ws = s.words;
  let key = -1;
  const after = ws.findIndex((w) => /^(só|apenas|realmente|mesmo)$/i.test(clean(w.text)));
  if (after >= 0) key = ws.findIndex((w, i) => i > after && isContent(w.text) || (i > after && /^(isso|isto)\?*$/i.test(clean(w.text))));
  const themed = ws.map((w, i) => ({ i, w: weights.get(root(w.text)) ?? 0 })).filter((x) => isContent(ws[x.i]!.text) && x.w > 0).sort((a, b) => b.w - a.w)[0];
  // "só isso?" é a pergunta inteira; fora isso, a palavra do tema (feliz, felicidade) leva o acento.
  const isso = key >= 0 && /^(isso|isto)$/i.test(clean(ws[key]!.text));
  if (themed && !isso && (key < 0 || themed.w >= 4)) key = themed.i;
  if (key < 0) key = ws.map((w, i) => ({ i, l: isContent(w.text) ? clean(w.text).length : 0 })).sort((a, b) => b.l - a.l)[0]!.i;
  const start = s.start - 0.15;
  return [
    {
      template: 'pergunta',
      funcao: 'reveal',
      s,
      start,
      end: Math.min(start + 5, Math.max(s.end + 0.9, start + 2.8)), // tempo de ler a pergunta inteira
      texts: ws.map((w) => w.text.replace(/\.\.\.$|…$/, '')),
      beatsAbs: ws.map((w) => w.start),
      key,
      ideia: `A pergunta se monta palavra por palavra no tempo da fala; "${clean(ws[key]!.text)}" ganha o acento e um "?" gigante segura a tensão.`,
      base: 3.4 + (/^(mas|e|então)\b/i.test(s.text) ? 0.8 : 0),
    },
  ];
}

function contrastCand(s: Sentence, ss: Sentence[]): Cand[] {
  const ws = s.words;
  const out: Cand[] = [];
  const mk = (A: CueWord[], B: CueWord[], variant: 'negacao' | 'par', kicker: string | undefined, base: number, sent = s): Cand => {
    const start = A[0]!.start - 0.55;
    return {
      template: 'contraste',
      funcao: 'contrast',
      s: sent,
      start,
      end: Math.min(start + 6, B[B.length - 1]!.end + 1.1),
      texts: [phrase(A), phrase(B)],
      beatsAbs: [A[0]!.start, B[0]!.start],
      variant,
      kicker,
      ideia: variant === 'negacao' ? `"${phrase(A)}" aparece e é riscado no instante em que "${phrase(B)}" é dito — a correção vira imagem.` : `"${phrase(A)}" em cima × "${phrase(B)}" embaixo, emoldurando o rosto: os dois lados da ideia ao mesmo tempo.`,
      base,
    };
  };
  // "entre os X e os Y"
  const ei = ws.findIndex((w) => norm(w.text) === 'entre');
  if (ei >= 0) {
    const rest = ws.slice(ei + 1);
    const ej = rest.findIndex((w) => norm(w.text) === 'e');
    if (ej > 0) {
      const A = rest.slice(0, ej).filter((w) => !POSSESSIVE.test(clean(w.text)));
      let B = rest.slice(ej + 1).filter((w) => !POSSESSIVE.test(clean(w.text)));
      const stop = B.findIndex((w) => /[.,…]$|\.\.\.$/.test(w.text));
      if (stop >= 0) B = B.slice(0, stop + 1);
      if (A.length && A.length <= 3 && B.length && B.length <= 4) out.push(mk(A, B, 'par', undefined, 4.6));
    }
  }
  // "não X, (mas) Y" na mesma frase, ou "não … X." + "Mas Y." na seguinte
  const ni = ws.findIndex((w) => norm(w.text) === 'nao');
  if (ni >= 0) {
    const segs: CueWord[][] = [];
    let cur: CueWord[] = [];
    for (const w of ws.slice(ni + 1)) {
      if (/^(mas|porém|e sim)$/i.test(clean(w.text)) && cur.length) {
        segs.push(cur);
        cur = [];
        continue;
      }
      cur.push(w);
      if (/,$/.test(w.text)) {
        segs.push(cur);
        cur = [];
      }
    }
    if (cur.length) segs.push(cur);
    const next = ss[s.index + 1];
    let tailSeg: CueWord[] | undefined;
    let sent = s;
    if (segs.length >= 2) tailSeg = segs[segs.length - 1];
    else if (next && /^mas\b/i.test(next.text) && next.start - s.end < 1.8) {
      tailSeg = next.words.slice(1);
      sent = next;
    }
    if (tailSeg) {
      // Lado negado: o último núcleo depois de "muito menos"/"nem", senão o primeiro.
      const neg = segs.length >= 2 ? segs.slice(0, -1) : segs;
      const menos = neg.flat().findIndex((w, i, a) => norm(w.text) === 'menos' || norm(w.text) === 'nem' || (i > 0 && norm(a[i - 1]!.text) === 'muito' && norm(w.text) === 'menos'));
      const negWords = menos >= 0 ? neg.flat().slice(menos + 1) : neg[0]!;
      const cutAt = negWords.findIndex((w) => /[.,]$/.test(w.text) || norm(w.text) === 'e');
      const negPart = cutAt >= 0 ? negWords.slice(0, cutAt + 1) : negWords;
      const posWords = tailSeg.filter((w) => !/^(na|no|em|de|um|uma|a|o)$/i.test(clean(w.text)));
      // Paralelismo ("de um jeito acadêmico, de um jeito pessoal"): fica só o que muda.
      const same = new Set(negPart.map((w) => norm(w.text)));
      const sameB = new Set(tailSeg.map((w) => norm(w.text)));
      const A0 = (tail(negPart, 3).length ? tail(negPart, 3) : negPart.filter(isContentW)).slice(-3);
      const A = A0.filter((w) => !sameB.has(norm(w.text))).length ? A0.filter((w) => !sameB.has(norm(w.text))) : A0;
      const firstB = posWords.filter((w) => !same.has(norm(w.text))).find((w) => isContent(w.text));
      const B = firstB ? [firstB] : [];
      if (A.length && B.length) out.push(mk(A, B, 'negacao', 'não é', 4.8 + (sent !== s ? 0.4 : 0), sent === s ? s : { ...s, end: sent.end }));
    }
  }
  // Par de antônimos na mesma frase ("tenho tudo pra estar bem, mas … pior")
  for (const [ra, rb] of ANTONYMS) {
    const ia = ws.findIndex((w) => ra.test(norm(w.text)));
    const ib = ws.findIndex((w, i) => i > ia && rb.test(norm(w.text)));
    if (ia >= 0 && ib > ia && ws[ib]!.start - ws[ia]!.start < 4.5) {
      out.push(mk([ws[ia]!], [ws[ib]!], 'par', undefined, 4.2));
      break;
    }
  }
  return out;
}
const isContentW = (w: CueWord) => isContent(w.text);

function quoteCand(s: Sentence, ss: Sentence[], weights: Map<string, number>): Cand[] {
  if (/\?$/.test(s.text)) return [];
  let ws = s.words;
  // Citação atribuída: "Defendia que… O sentido da vida…" — o nome vem de uma frase próxima.
  const qi = ws.findIndex((w, i) => i < 4 && /^(defendia|dizia|disse|afirmava|escreveu|ensinava)$/i.test(clean(w.text)));
  let kicker: string | undefined;
  let base = 2.6;
  if (qi >= 0) {
    const que = ws.findIndex((w, i) => i > qi && /^que/i.test(clean(w.text)));
    ws = ws.slice(que >= 0 ? que + 1 : qi + 1);
    for (let k = s.index - 1; k >= Math.max(0, s.index - 3); k--) {
      const pw = ss[k]!.words;
      const i = pw.findIndex((w, j) => /^[A-ZÁÉÍÓÚ]/.test(clean(w.text)) && clean(w.text).length > 3 && !STOP.has(clean(w.text).toLowerCase()) && (j > 0 || pw.length <= 8));
      if (i >= 0) {
        let j = i;
        while (pw[j + 2] && /^(de|da|do)$/i.test(clean(pw[j + 1]!.text)) && /^[A-ZÁÉÍÓÚ]/.test(clean(pw[j + 2]!.text))) j += 2;
        kicker = pw.slice(i, j + 1).map((w) => clean(w.text)).join(' ');
        break;
      }
    }
    base = 4.4;
  } else {
    const kw = ws.reduce((a, w) => a + (isContent(w.text) ? (weights.get(root(w.text)) ?? 0) : 0), 0);
    const insight = /^(não se|ninguém|a realidade é|a verdade é|o segredo|a felicidade|a vida|quem|todo mundo)\b/i.test(s.text);
    if (!insight && !(EMOTION.test(s.text) && kw >= 4)) return [];
    base = 2.8 + (insight ? 0.8 : 0) + Math.min(1.2, kw / 8);
    if (/^eu\b/i.test(s.text)) base -= 0.8;
  }
  if (ws.length < 4 || ws.length > 18) return [];
  const key = ws.map((w, i) => ({ i, w: (weights.get(root(w.text)) ?? 0) + (EMOTION.test(clean(w.text)) ? 2 : 0) + clean(w.text).length / 20 })).filter((x) => isContent(ws[x.i]!.text)).sort((a, b) => b.w - a.w)[0]?.i ?? ws.length - 1;
  const start = ws[0]!.start - 0.45;
  return [
    {
      template: 'citacao',
      funcao: 'emotion',
      s,
      start,
      end: Math.min(start + 7, ws[ws.length - 1]!.end + 1.1),
      texts: ws.map((w, i) => (i === 0 ? capFirst(w.text) : w.text).replace(/\.\.\.$|…$/, '')),
      beatsAbs: ws.map((w) => w.start),
      key,
      kicker,
      ideia: `A frase vira um bilhete de papel que sobe sobre o corpo e é datilografado no ritmo da fala; "${clean(ws[key]!.text)}" é sublinhado à mão${kicker ? `, assinado por ${kicker}` : ''}.`,
      base,
    },
  ];
}

function conceptCand(s: Sentence, ss: Sentence[]): Cand[] {
  const ws = s.words;
  const out: Cand[] = [];
  // Apresentação de um nome: "Agostinho de Hipona, um dos pais da igreja."
  if (/^[A-ZÁÉÍÓÚ]/.test(clean(ws[0]!.text)) && clean(ws[0]!.text).length > 3) {
    let j = 0;
    while (ws[j + 2] && /^(de|da|do)$/i.test(clean(ws[j + 1]!.text)) && /^[A-ZÁÉÍÓÚ]/.test(clean(ws[j + 2]!.text))) j += 2;
    if (/,$/.test(ws[j]!.text) && ws.length - j - 1 >= 2 && ws.length - j - 1 <= 7) {
      const name = ws.slice(0, j + 1);
      const sub = ws.slice(j + 1);
      const start = ws[0]!.start - 0.5;
      out.push({ template: 'palavra', funcao: 'explain', s, start, end: Math.min(start + 4.2, s.end + 1), texts: [phrase(name), phrase(sub)], beatsAbs: [ws[0]!.start, sub[0]!.start], ideia: `"${phrase(name)}" ocupa o vazio acima da cabeça, com "${phrase(sub)}" embaixo — apresenta quem entra na história.`, base: 3.6 });
    }
  }
  // Palavra-soco depois de reticências: "…tornaria a própria felicidade… Pragmática."
  const last = ws[ws.length - 1]!;
  const prevW = ws[ws.length - 2];
  if (prevW && /(\.\.\.|…)$/.test(prevW.text) && /\.$/.test(last.text) && clean(last.text).length >= 6) {
    const lead = ws.slice(Math.max(0, ws.length - 5), ws.length - 1).map((w) => clean(w.text));
    const start = last.start - 0.9;
    out.push({ template: 'palavra', funcao: 'reveal', s, start, end: start + 3.2, texts: [clean(last.text), ''], beatsAbs: [last.start], kicker: lead.join(' '), ideia: `A frase fica suspensa e "${clean(last.text)}" cai como um golpe no vazio acima da cabeça.`, base: 3.4 });
  }
  // Mudança de capítulo: "Então, eu fui para a ciência."
  if (ws.length <= 7 && /^(então|agora|aí)\b/i.test(s.text)) {
    const w = [...ws].reverse().find((x) => isContent(x.text));
    if (w) {
      const start = w.start - 0.7;
      out.push({ template: 'palavra', funcao: 'reset', s, start, end: start + 3, texts: [clean(w.text), ''], beatsAbs: [w.start], kicker: ws.slice(0, ws.indexOf(w)).map((x) => clean(x.text)).join(' ').slice(0, 40), ideia: `Virada de capítulo: "${clean(w.text)}" entra grande e reacende a atenção.`, base: 2.6 });
    }
  }
  void ss;
  return out;
}

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------

export interface PlanInput {
  words: CueWord[];
  total: number;
  ref?: MotionRef;
  /** Intervalos onde não pode entrar motion (B-roll, lettering feito à mão, motions do humano). */
  blocked: { start: number; end: number }[];
  /** Letterings do agente: o motion pode substituir (ele diz mais do que o lettering). */
  replaceable: { id: string; start: number; end: number }[];
  /** Quantos motions por minuto (padrão 2.5 ≈ um a cada 24 s). */
  perMinute?: number;
}

export interface PlanResult {
  reading: StoryReading;
  motions: (MotionPlan & { replaces: string[] })[];
}

export function planMotions(inp: PlanInput): PlanResult {
  const ss = sentences(inp.words);
  const story = readStory(ss, inp.total);
  const { weights, ctaAt, roles } = story;
  const cands: Cand[] = [];
  for (const s of ss) {
    if (s.start >= ctaAt) break;
    cands.push(...numberCand(s, ss), ...listCand(s, ss), ...questionCand(s, weights), ...contrastCand(s, ss), ...quoteCand(s, ss, weights), ...conceptCand(s, ss));
  }
  const ARC: Record<string, number> = { gancho: 2, virada: 2, tese: 2.4, fechamento: 1 };
  const scored = cands
    .filter((c) => c.start >= 0 && c.end <= Math.min(ctaAt, inp.total) + 0.5 && c.end - c.start >= 2)
    .map((c) => {
      const theme = c.s.words.reduce((a, w) => a + (isContent(w.text) ? Math.min(3, weights.get(root(w.text)) ?? 0) : 0), 0);
      const papel = roles.get(c.s.index);
      return { c, papel, score: c.base + Math.min(2, theme / 6) + (papel ? ARC[papel]! : 0) + (c.start < 12 ? 0.6 : 0) };
    })
    .sort((a, b) => b.score - a.score);

  const limit = Math.max(2, Math.round((inp.total / 60) * (inp.perMinute ?? 2.5)));
  const chosen: typeof scored = [];
  const perTemplate = new Map<MotionTemplateId, number>();
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }, pad = 0) => a.start < b.end + pad && b.start < a.end + pad;
  // Escolha gulosa com variedade: cada mecanismo já usado custa pontos (o vídeo não vira "só perguntas").
  const pool = scored.filter((x) => !inp.blocked.some((b) => overlaps(x.c, b, 0.3)));
  while (chosen.length < limit) {
    let best: (typeof scored)[number] | undefined;
    let bestScore = -Infinity;
    for (const x of pool) {
      const used = perTemplate.get(x.c.template) ?? 0;
      if (used >= 2) continue; // "nunca o mesmo motion mais de 2×"
      if (chosen.some((y) => overlaps(x.c, y.c, 7) || y.c.s.index === x.c.s.index)) continue;
      const adj = x.score - 1.1 * used;
      if (adj > bestScore) {
        bestScore = adj;
        best = x;
      }
    }
    if (!best || bestScore < 3.2) break;
    chosen.push(best);
    perTemplate.set(best.c.template, (perTemplate.get(best.c.template) ?? 0) + 1);
  }

  const st = inp.ref ? styleFromReference(inp.ref.paleta, inp.ref.familias) : undefined;
  const motions = chosen
    .sort((a, b) => a.c.start - b.c.start)
    .map(({ c, score, papel }, n) => {
      const start = Math.max(0, c.start);
      const end = Math.min(c.end, inp.total);
      const spec: MotionSpec = {
        template: c.template,
        funcao: c.funcao,
        fala: c.s.text,
        ideia: c.ideia,
        texts: c.texts,
        beats: c.beatsAbs.map((b) => Math.max(0.12, +(b - start).toFixed(3))),
        key: c.key,
        kicker: c.kicker,
        variant: c.variant,
        refId: inp.ref?.id,
        refName: inp.ref?.obra,
        style: st ?? styleFromReference([], []),
        seed: 1000 + n * 37 + Math.round(start * 10),
      };
      return { start, end, spec, score: +score.toFixed(2), papel, replaces: inp.replaceable.filter((l) => overlaps({ start, end }, l, 0.2)).map((l) => l.id) };
    });
  const { weights: _w, ctaAt: _c, roles: _r, ...reading } = story;
  return { reading, motions };
}

/** MOTION_SPEC do vídeo em .md — a passagem de bastão para o Motion Studio produzir a versão final. */
export function planMarkdown(projectName: string, plan: PlanResult, ref: MotionRef | undefined, refWhy: string, fmt: (t: number) => string): string {
  const r = plan.reading;
  const lines = [
    `# Motions narrativos — ${projectName}`,
    '',
    `Gerado pelo NewEditor.AI em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Cada motion conta o que está sendo dito naquele instante, dentro da história do vídeo inteiro.`,
    '',
    '## Leitura da história',
    `- **Tema:** ${r.tema.join(', ') || '—'}`,
    `- **Tópicos:** ${r.topicos.join(', ') || '—'}`,
    r.gancho ? `- **Gancho** (${fmt(r.gancho.start)}): "${r.gancho.text}"` : '',
    r.virada ? `- **Virada** (${fmt(r.virada.start)}): "${r.virada.text}"` : '',
    r.tese ? `- **Tese** (${fmt(r.tese.start)}): "${r.tese.text}"` : '',
    r.fechamento ? `- **Fechamento** (${fmt(r.fechamento.start)}): "${r.fechamento.text}"` : '',
    r.ctaDesde !== undefined ? `- **CTA** a partir de ${fmt(r.ctaDesde)} — sem motion narrativo.` : '',
    '',
    '## Obra-alvo',
    ref ? `**${ref.obra}** (${ref.categoria}${ref.familias.length ? ` · ${ref.familias.join(', ')}` : ''}) — ${refWhy}. Paleta: ${ref.paleta.map((h) => `\`${h}\``).join(' ')}` : refWhy,
    '',
    '## Motions',
  ];
  plan.motions.forEach((m, i) => {
    const f = NARRATIVE_FUNCTIONS[m.spec.funcao];
    lines.push(
      '',
      `### ${String(i + 1).padStart(2, '0')} · ${fmt(m.start)}–${fmt(m.end)} · ${MOTION_TEMPLATES[m.spec.template].label}`,
      '```yaml',
      'motion:',
      `  modo: "cena"`,
      `  contexto:`,
      `    fala_literal: ${JSON.stringify(m.spec.fala)}`,
      `    funcao_narrativa: "${m.spec.funcao}"  # ${f.label}: ${f.desc}`,
      m.papel ? `    papel_na_historia: "${m.papel}"` : '',
      `  roteiro_visual: ${JSON.stringify(m.spec.ideia)}`,
      `  elementos: ${JSON.stringify(m.spec.texts)}`,
      m.spec.kicker ? `  kicker: ${JSON.stringify(m.spec.kicker)}` : '',
      `  repertorio: { obra_alvo: ${JSON.stringify(ref?.id ?? 'casa')} }`,
      `  som: { trilha: "nenhuma", efeitos: ${JSON.stringify([...new Set(motionCues(m.spec, m.end - m.start).map((c) => SFX_LABEL[c.kind]))])} }`,
      `  duracao: ${(m.end - m.start).toFixed(2)}`,
      '```',
    );
  });
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
}
