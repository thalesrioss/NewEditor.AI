/**
 * Lettering automático — sem API.
 *
 * Em cada frase, acha a PALAVRA-CHAVE (número com unidade, nome próprio, palavra do tema do vídeo, palavra de
 * emoção, o soco no fim da frase) e monta o lettering como nas referências Auto: o trecho falado em volta vira
 * apoio pequeno e a chave vira o destaque grande — no lugar da legenda, palavra por palavra no tempo da fala.
 *
 * Ritmo (Motion Studio, "Animação ≠ Lettering"): leve, frequente, nunca parado; nunca dois colados, nunca o
 * mesmo texto duas vezes, nada em cima de motion nem do CTA.
 */
import type { CueWord, LetteringSpec, LetteringStyleId, LetteringWord } from '@neweditor/core';
import { clean, EMOTION, isContent, norm, NUM_WORDS, readStory, root, sentences, STOP, UNITS, type Sentence } from './motion/plan.ts';

export type LetteringAmount = 'pouco' | 'medio' | 'muito';
const PER_MINUTE: Record<LetteringAmount, number> = { pouco: 3, medio: 5, muito: 8 };

export interface LetteringPlan {
  start: number;
  end: number;
  spec: LetteringSpec;
  score: number;
  key: string;
}

/** Palavras que dão soco quando fecham a frase ("…não resolve", "…deixa pior"). */
const PUNCH = /^(nunca|nada|tudo|sempre|jamais|ninguém|verdade|verdadeira|realmente|exatamente|pior|melhor|único|única|impossível|honesta|sentido|segredo|resposta|problema|diferença)$/i;
/** Palavra funcional (a lista tem acento; compara com e sem). */
const isStop = (w: string) => STOP.has(clean(w).toLowerCase()) || STOP.has(norm(w));
const NAME_STOP = /^(Eu|Você|Ele|Ela|Nós|Mas|E|O|A|Os|As|Um|Uma|É|Então|Para|Pra|Porque|Que|Se|Não|Sim|Tem|Isso|Esse|Essa)$/;

interface Key {
  i: number;
  j: number;
  score: number;
  why: string;
}

/** Adjetivos que andam colados no substantivo da chave ("verdadeira alegria", "única saída"). */
const ADJ_BEFORE = /^(verdadeir[ao]s?|grandes?|únic[ao]s?|melhor(es)?|pior(es)?|maior(es)?|própri[ao]s?|mesm[ao]s?|nov[ao]s?|velh[ao]s?)$/i;

function keywordsOf(s: Sentence, weights: Map<string, number>, freq: Map<string, number>): Key[] {
  const ws = s.words;
  const cands: Key[] = [];
  for (let i = 0; i < ws.length; i++) {
    const raw = clean(ws[i]!.text);
    const n = norm(ws[i]!.text);
    const next = ws[i + 1] ? clean(ws[i + 1]!.text) : '';
    // Número com unidade: "15 minutos", "23 reais", "três neurotransmissores".
    const isNum = /^\d+([.,]\d+)?$/.test(raw) || NUM_WORDS[n] !== undefined;
    if (isNum && next && UNITS.test(next)) {
      cands.push({ i, j: i + 1, score: 5.5 + (/^(reais|real|%)$/i.test(next) ? 0.5 : 0), why: `número: "${raw} ${next}"` });
      continue;
    }
    // Nome próprio no meio da frase (com "de"): "Agostinho de Hipona", "Sócrates".
    // No começo da frase só conta se vier com sobrenome ("Agostinho de Hipona") ou aposto ("Sócrates, o filósofo").
    const opensWithName = i === 0 && !!ws[2] && /^(de|da|do)$/i.test(clean(ws[1]!.text)) && /^[A-ZÁÉÍÓÚ]/.test(clean(ws[2]!.text));
    if ((i > 0 || opensWithName) && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(raw) && raw.length > 2 && !NAME_STOP.test(raw) && (i === 0 || !/[.?!…]$/.test(ws[i - 1]!.text))) {
      let j = i;
      while (ws[j + 2] && /^(de|da|do)$/i.test(clean(ws[j + 1]!.text)) && /^[A-ZÁÉÍÓÚ]/.test(clean(ws[j + 2]!.text))) j += 2;
      // "…de Hipona": o nome começa antes do "de".
      while (i >= 2 && /^(de|da|do)$/i.test(clean(ws[i - 1]!.text)) && /^[A-ZÁÉÍÓÚ]/.test(clean(ws[i - 2]!.text))) i -= 2;
      cands.push({ i, j, score: 6, why: `nome: "${ws.slice(i, j + 1).map((w) => clean(w.text)).join(' ')}"` });
      i = Math.max(i, j); // segue depois do nome (o recuo do "de" não pode voltar o laço)
      continue;
    }
    if (!isContent(ws[i]!.text)) continue;
    const theme = Math.min(4, weights.get(root(ws[i]!.text)) ?? 0);
    const emo = EMOTION.test(raw) ? 1.6 : 0;
    const punch = PUNCH.test(raw) ? (/[.?!…,]$/.test(ws[i]!.text) || i === ws.length - 1 ? 1.4 : 0.8) : 0;
    const end = i === ws.length - 1 || /[.?!…,]$/.test(ws[i]!.text) ? 0.8 : 0;
    const long = raw.length >= 8 ? 0.5 : 0;
    // "mais honesta", "muito menos": o adjetivo depois do intensificador.
    const intens = i > 0 && /^(mais|menos|tão|muito)$/i.test(clean(ws[i - 1]!.text)) ? 0.8 : 0;
    // O tema conta, mas pouco: a chave é o que pesa NESTA frase (a palavra rara, o soco no fim).
    const rare = (freq.get(root(ws[i]!.text)) ?? 0) <= 2 ? 0.7 : 0;
    const sc = 1 + theme * 0.35 + emo + punch + end + long + intens + rare;
    // "verdadeira alegria": o adjetivo de antes entra junto na chave.
    const i0 = i > 0 && ADJ_BEFORE.test(clean(ws[i - 1]!.text)) ? i - 1 : i;
    if (ADJ_BEFORE.test(raw) && ws[i + 1] && isContent(ws[i + 1]!.text)) continue; // o substantivo seguinte leva os dois
    if (sc >= 2.6) cands.push({ i: i0, j: i, score: sc + (i0 < i ? 0.6 : 0), why: theme >= 2 ? `palavra do tema: "${raw}"` : emo ? `emoção: "${raw}"` : `palavra forte: "${raw}"` });
  }
  // Lista curta ("Serotonina, dopamina e eustosina"): os itens inteiros são a chave.
  const items = ws.filter((w, q) => /,$/.test(w.text) || (q > 0 && clean(ws[q - 1]!.text).toLowerCase() === 'e')).length;
  if (items >= 2 && ws.length <= 8) {
    const first = ws.findIndex((w) => /,$/.test(w.text));
    if (first >= 0 && first <= 2) cands.push({ i: first, j: ws.length - 1, score: 5.4, why: `lista: "${ws.slice(first).map((w) => clean(w.text)).join(', ')}"` });
  }
  // As duas melhores chaves (se a primeira cair em cima de um motion, a segunda ainda vale).
  const out: Key[] = [];
  for (const c of cands.sort((a, b) => b.score - a.score)) if (!out.some((o) => c.i <= o.j && o.i <= c.j)) out.push(c);
  return out.slice(0, 2);
}

/** Monta as linhas: até 4 palavras de apoio antes (desde a última pausa/vírgula), a chave, até 4 depois. */
function compose(s: Sentence, k: Key, estilo: LetteringStyleId): { words: CueWord[]; lines: number[]; destaque: boolean[] } {
  const ws = s.words;
  let a = Math.max(0, k.i - 4);
  for (let x = k.i - 1; x >= a; x--) {
    const gap = ws[x + 1]!.start - ws[x]!.end;
    if (/[.?!…,;:]$/.test(ws[x]!.text) || gap > 0.45) {
      a = x + 1;
      break;
    }
  }
  let b = Math.min(ws.length - 1, k.j + 3);
  for (let x = k.j; x < b; x++) {
    const gap = ws[x + 1]!.start - ws[x]!.end;
    // Para na pontuação, na pausa, ou antes de uma oração nova ("…15 minutos | e me custou…").
    if (/[.?!…,;:]$/.test(ws[x]!.text) || gap > 0.45 || /^(e|mas|que|porque|então)$/i.test(clean(ws[x + 1]!.text))) {
      b = x;
      break;
    }
  }
  // Apoio de uma palavra só que é artigo/preposição solta não vale uma linha.
  // Apoio que seria só uma palavrinha ("o", "de…") não vira linha; e não termina pendurado ("…apenas no").
  if (a === k.i - 1 && isStop(ws[a]!.text)) a = k.i;
  while (b > k.j && isStop(ws[b]!.text) && clean(ws[b]!.text).length <= 3) b--;
  const words = ws.slice(a, b + 1);
  const destaque = words.map((_, q) => a + q >= k.i && a + q <= k.j);
  // Estilos de "fluxo" (marca-texto, máquina, apple de uma linha) mantêm a frase corrida.
  const flow = estilo === 'marca-texto' || estilo === 'typewriter';
  const lines: number[] = words.map((_, q) => (flow ? (q < words.length / 2 || words.length <= 4 ? 0 : 1) : a + q < k.i ? 0 : a + q <= k.j ? 1 : 2));
  if (!flow && lines[0] !== 0) for (let q = 0; q < lines.length; q++) lines[q] = lines[q]! - 1;
  return { words, lines, destaque };
}

export interface LetteringInput {
  words: CueWord[];
  total: number;
  estilo: LetteringStyleId;
  accent?: string;
  refId?: string;
  refName?: string;
  amount?: LetteringAmount;
  /** Onde não pode (motions, B-roll de tela cheia não importa: o lettering fica por cima da legenda). */
  blocked: { start: number; end: number }[];
  /** Textos que já existem (não repetir). */
  existing: string[];
}

export function planLetterings(inp: LetteringInput): LetteringPlan[] {
  const ss = sentences(inp.words);
  const { weights, ctaAt } = readStory(ss, inp.total);
  const freq = new Map<string, number>();
  for (const w of inp.words) if (isContent(w.text)) freq.set(root(w.text), (freq.get(root(w.text)) ?? 0) + 1);
  const cands: (LetteringPlan & { sentence: number })[] = [];
  for (const s of ss) {
    if (s.start >= ctaAt) break;
    for (const k of keywordsOf(s, weights, freq)) {
    const { words, lines, destaque } = compose(s, k, inp.estilo);
    const start = Math.max(0, words[0]!.start - 0.08);
    const end = Math.min(inp.total, Math.max(words[words.length - 1]!.end + 0.4, start + 1.3));
    const key = words.filter((_, q) => destaque[q]).map((w) => clean(w.text)).join(' ');
    // Na tela, ponto final e reticências saem (vírgula, ? e ! ficam — dão o ritmo da fala).
    const lw: LetteringWord[] = words.map((w, q) => ({ text: w.text.replace(/(\.\.\.|…|\.)$/, ''), at: Math.max(0.02, +(w.start - start).toFixed(3)), line: lines[q]!, destaque: destaque[q] || undefined }));
    cands.push({ sentence: s.index, start, end, key, score: k.score, spec: { estilo: inp.estilo, words: lw, accent: inp.accent, refId: inp.refId, refName: inp.refName, motivo: k.why, seed: 500 + Math.round(start * 13) } });
    }
  }
  const limit = Math.max(2, Math.round((inp.total / 60) * PER_MINUTE[inp.amount ?? 'medio']));
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }, pad: number) => a.start < b.end + pad && b.start < a.end + pad;
  const seen = new Set(inp.existing.map((x) => x.toLowerCase()));
  const chosen: (LetteringPlan & { sentence: number })[] = [];
  for (const c of cands.sort((a, b) => b.score - a.score)) {
    if (chosen.length >= limit) break;
    if (seen.has(c.key.toLowerCase()) || chosen.some((x) => x.sentence === c.sentence)) continue;
    // Só a sobra final encostando num motion: encurta em vez de descartar (desde que todas as palavras caibam).
    for (const b of inp.blocked) {
      const lastWord = c.start + Math.max(...c.spec.words.map((w) => w.at)) + 0.35;
      if (b.start > c.start && c.end > b.start - 0.05 && lastWord < b.start - 0.05) c.end = b.start - 0.05;
    }
    if (c.end - c.start < 1 || inp.blocked.some((b) => overlaps(c, b, 0))) continue;
    if (chosen.some((x) => overlaps(c, x, 2.5))) continue;
    chosen.push(c);
    seen.add(c.key.toLowerCase());
  }
  return chosen.sort((a, b) => a.start - b.start).map(({ sentence: _s, ...p }) => p);
}
