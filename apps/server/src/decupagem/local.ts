/**
 * Cérebro LOCAL da decupagem — sem API, sem custo, determinístico.
 *
 * Calibrado em dois materiais reais: VO do Davi Lo (gabarito: corte base aprovado) e o talk head
 * "Felicidade" do Thales (gabarito: as frases da peça publicada). A unidade de decisão é a FRASE
 * (separada por pausa medida ou por pontuação do ASR, inclusive o "…" de quem parou no meio).
 *
 * Regras, em ordem:
 *  1. Pré/pós-roll: marcador de bastidor perto do começo/fim → tudo antes/depois sai.
 *  2. Frase inteira de bastidor ("Já foi os ganchos, tá?", "Top."), teste de voz ou hesitação.
 *  3. Hesitação dentro da frase: "hum…", "ahn", "aaah".
 *  4. Gagueira = repetição COLADA: "a conversa a conversa", "disponibilizar disponibilizar",
 *     "não de um jeito acadêmico, mas não de um jeito acadêmico". Repetição com conteúdo novo no meio
 *     ("de um jeito acadêmico, de um jeito pessoal") é estrutura da frase — fica.
 *  5. Retake entre frases: a frase é uma tomada anterior de uma frase posterior se começa igual e ≥60%
 *     dela reaparece na mesma ordem, ou se ≥80% reaparece. Fica a MELHOR tomada: por padrão a última (quem
 *     grava repete até acertar), mas a anterior fica se for claramente melhor — completa, sem gaguejar, sem
 *     hesitar, ouvida com confiança pelo ASR — e a decisão vira dúvida para o humano (ADR-007 I-5).
 *  6. Reinício longo por sequência idêntica — só quando a repetição ABRE uma frase nova (senão é só
 *     o tema voltando: "o sentido da vida… o real sentido da vida").
 *
 * O que ele NÃO faz (e o humano revisa): escolhas de roteiro — cortar frase boa que não serve à peça.
 */
import type { Word } from '../asr.ts';
import { normalizeToken, type Analysis } from './analyze.ts';
import type { DecisionResult, DecisionSegment } from './decide.ts';

type Kind = DecisionSegment['kind'];

interface Mark {
  keep: boolean;
  kind: Kind;
  reason: string;
}

/** Palavras que sozinhas não carregam conteúdo. */
const STOP = new Set(
  'a o as os e é ou de da do das dos em na no nas nos um uma uns umas que se pra para por com sem mas eu tu ele ela nós vc voce você me te lhe isso isto esse essa este esta aí ai lá la então entao tipo né ne tá ta já ja não nao sim só so mais muito bem porque pois quando como'.split(' '),
);
/** Conectivos que podem abrir uma tomada sem mudar o que ela é ("E eu vou…" = "Eu vou…"). */
const LEAD = new Set('e é eh mas entao então tipo ai aí bom olha ah'.split(' '));
const FILLERS = new Set('e é eh ah ahn hã han hum hm humm uh tá ta ok né ne então entao tipo assim'.split(' '));
/** Hesitação pura: sai mesmo no meio da frase. */
const HESITATION = /^(hum+|hm+|ahn+|han+|uh+|eh+|a{2,}h*|e{2,}h*|ã+)$/;

/** Marcadores de bastidor (normalizados, sem acento). */
const OFFSCRIPT = ['perai', 'pera ai', 'pera', 'do comeco', 'de novo', 'como e que era', 'como que era', 'ta gravando', 'esta gravando', 'gravando', 'vou de novo', 'vou repetir', 'deixa eu', 'esquece', 'errei', 'corta', 'calma', 'nossa', 'pode ir', 'ja ta', 'valendo', 'gravou', 'ganchos', 'gancho'];
/** Interjeição de quem errou ("eita", "putz"): sozinha é bastidor. */
const OOPS = new Set(['eita', 'oita', 'opa', 'ops', 'putz', 'droga', 'caramba', 'vixe', 'xi']);
/** Palavra solta entre pausas, dita para quem está gravando. */
const CREW_SOLO = new Set(['top', 'beleza', 'pronto', 'valeu', 'perfeito', 'isso', 'boa', 'foi', 'ok']);
const CREW_TAG = new Set(['ta', 'ne', 'ok', 'beleza', 'certo']);
const VOICE_TEST = new Set(['oi', 'alo', 'teste', 'testando', 'som', 'um', 'dois', 'tres']);

const ROLL_SECS = 25;
const RETAKE_WINDOW_PHRASES = 14;
const RETAKE_WINDOW_SECS = 150;
const RESTART_MAX_WORDS = 45;
const RESTART_MAX_SECS = 40;

interface Phrase {
  id: number;
  from: number;
  to: number;
  start: number;
  end: number;
  /** índices das palavras significativas (sem hesitação) */
  idx: number[];
  trailing: boolean;
}

/** Formas que variam entre tomadas sem mudar a fala: "para"/"pra", "3"/"três". */
const CANON: Record<string, string> = { para: 'pra', pro: 'pra', esta: 'ta', estou: 'to', 0: 'zero', 1: 'um', 2: 'dois', 3: 'tres', 4: 'quatro', 5: 'cinco', 6: 'seis', 7: 'sete', 8: 'oito', 9: 'nove', 10: 'dez', 15: 'quinze', 20: 'vinte', 23: 'vinteetres' };
const canon = (t: string) => CANON[t] ?? t;
/** Mesma palavra, mesmo se uma tomada parou no meio dela ("neurostransmit…" × "neurotransmissores"). */
function sameWord(x: string, y: string): boolean {
  if (x === y) return true;
  if (x.length < 5 || y.length < 5) return false;
  let k = 0;
  while (k < x.length && k < y.length && x[k] === y[k]) k++;
  return k >= 5;
}

function lcsLen(a: string[], b: string[]): number {
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = sameWord(a[i - 1]!, b[j - 1]!) ? prev + 1 : Math.max(dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function decideLocal(words: Word[], an: Analysis): DecisionResult {
  const tok = words.map((w) => canon(normalizeToken(w.w)));
  // Para gagueira compara COM acento: "E é até bom" não é "e e" repetido.
  const exact = words.map((w) => w.w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  const marks: Mark[] = words.map(() => ({ keep: true, kind: 'conteudo', reason: 'conteúdo' }));
  const doubts: DecisionResult['doubts'] = [];
  const cut = (a: number, b: number, kind: Kind, reason: string) => {
    for (let i = Math.max(0, a); i <= Math.min(words.length - 1, b); i++) if (marks[i]!.keep) marks[i] = { keep: false, kind, reason };
  };
  const textOf = (a: number, b: number) => words.slice(a, b + 1).map((w) => w.w).join(' ');
  const isContent = (t: string) => !!t && !STOP.has(t) && !FILLERS.has(t);
  const hasMarker = (a: number, b: number) => {
    const s = ` ${tok.slice(a, b + 1).join(' ')} `;
    return OFFSCRIPT.some((m) => s.includes(` ${m} `));
  };

  // --- Frases: pausa medida OU pontuação final / reticências do ASR -------------------------
  const uttStart = new Set(an.utterances.map((u) => u.from));
  const phrases: Phrase[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.w;
    const endsSentence = /[.?!…]$/.test(w) || /\.\.\.$/.test(w);
    // Fronteira: fim de frase, pausa medida, ou troca de TRECHO transcrito (cada trecho foi ouvido separado).
    const newChunk = i + 1 < words.length && words[i + 1]!.k !== undefined && words[i + 1]!.k !== words[i]!.k;
    if (i === words.length - 1 || endsSentence || uttStart.has(i + 1) || newChunk) {
      const idx: number[] = [];
      for (let k = from; k <= i; k++) if (tok[k] && !HESITATION.test(tok[k]!)) idx.push(k);
      phrases.push({ id: phrases.length, from, to: i, start: words[from]!.start, end: words[i]!.end, idx, trailing: /(\.\.\.|…)$/.test(w) });
      from = i + 1;
    }
  }
  const phraseOf = new Int32Array(words.length);
  phrases.forEach((p) => phraseOf.fill(p.id, p.from, p.to + 1));
  const toksOf = (p: Phrase) => p.idx.map((k) => tok[k]!);
  const sig = (p: Phrase) => {
    const t = toksOf(p);
    let s = 0;
    while (s < t.length - 1 && LEAD.has(t[s]!)) s++;
    return t.slice(s);
  };

  // --- 1. Pré-roll e pós-roll ----------------------------------------------------------------
  const duration = words.length ? words[words.length - 1]!.end : 0;
  const head = an.utterances.filter((u) => u.start < ROLL_SECS && hasMarker(u.from, u.to)).pop();
  if (head && head.to < words.length - 1) cut(0, head.to, 'offscript', 'pré-roll: conversa antes de começar');
  const tail = an.utterances.find((u) => u.end > duration - ROLL_SECS * 0.6 && hasMarker(u.from, u.to) && u.to - u.from <= 6);
  if (tail) cut(tail.from, words.length - 1, 'offscript', 'pós-roll: conversa depois de terminar');

  // --- 2. Frase inteira de bastidor / teste de voz / hesitação ---------------------------------
  for (const p of phrases) {
    const ts = toksOf(p);
    const all = tok.slice(p.from, p.to + 1).filter(Boolean);
    if (!all.length) continue;
    const prev = phrases[p.id - 1];
    const next = phrases[p.id + 1];
    const isolated = (!prev || p.start - prev.end > 0.8) && (!next || next.start - p.end > 0.8);
    const lastRaw = words[p.to]!.w;
    if (ts.length <= 6 && hasMarker(p.from, p.to)) cut(p.from, p.to, 'offscript', `bastidor: "${textOf(p.from, p.to)}"`);
    else if (ts.length <= 6 && /\?$/.test(lastRaw) && CREW_TAG.has(ts[ts.length - 1] ?? '')) cut(p.from, p.to, 'offscript', `bastidor: "${textOf(p.from, p.to)}"`);
    else if (ts.length === 1 && CREW_SOLO.has(ts[0]!) && isolated) cut(p.from, p.to, 'offscript', `bastidor: "${textOf(p.from, p.to)}"`);
    else if (all.every((t) => VOICE_TEST.has(t))) cut(p.from, p.to, 'offscript', 'teste de voz');
    else if (all.length <= 2 && all.some((t) => OOPS.has(t))) cut(p.from, p.to, 'offscript', `errou: "${textOf(p.from, p.to)}"`);
    // Trecho curto que nem o ASR entendeu ("Eu nãoQuem."): murmúrio de bastidor, não fala.
    else if (all.length <= 3 && words.slice(p.from, p.to + 1).reduce((acc, w) => acc + w.p, 0) / (p.to - p.from + 1) < 0.45)
      cut(p.from, p.to, 'offscript', `murmúrio: "${textOf(p.from, p.to)}"`);
    // "Bom…" sozinho num trecho é muleta (dentro de frase, "é até bom que…", é conteúdo e fica).
    else if (all.every((t) => FILLERS.has(t) || HESITATION.test(t) || t === 'bom')) cut(p.from, p.to, 'filler', `hesitação: "${textOf(p.from, p.to)}"`);
    // "Do… da empresa": palavra de função solta que PAROU no meio ("…" do ASR ao pé da letra) e a fala
    // recomeça logo em seguida. Sem as reticências é só uma pausa ("A … conversa mais honesta") — fica.
    else if (all.length <= 2 && all.every((t) => STOP.has(t)) && (p.trailing || tok[next?.from ?? -1] === all[0]) && next && next.start - p.end < 1.5)
      cut(p.from, p.to, 'false_start', `começo abandonado: "${textOf(p.from, p.to)}" e recomeçou`);
  }

  // --- 3. Hesitação dentro da frase ------------------------------------------------------------
  for (let i = 0; i < words.length; i++) if (tok[i] && HESITATION.test(tok[i]!)) cut(i, i, 'filler', `hesitação: "${words[i]!.w}"`);
  // Muleta de abertura com reticências ("Bom… a conversa mais honesta"): sai, o resto da frase fica.
  for (const p of phrases) {
    const k = p.from;
    if (k < p.to && /^(bom|é|eh|tá|ta|ok|beleza|então|entao)(\.\.\.|…)$/i.test(words[k]!.w)) cut(k, k, 'filler', `muleta: "${words[k]!.w}"`);
  }

  // --- 4. Gagueira: repetição colada -----------------------------------------------------------
  // Mais longa primeiro, para "a conversa a conversa" não virar dois cortes de uma palavra.
  for (let n = 12; n >= 1; n--) {
    for (let i = 0; i + 2 * n <= words.length; i++) {
      if (!marks[i]!.keep) continue;
      const a = exact.slice(i, i + n);
      if (a.some((t) => !t) || (n === 1 && !isContent(tok[i]!) && !['eu', 'que', 'a', 'o', 'e'].includes(a[0]!))) continue;
      for (const gap of [0, 1]) {
        const j = i + n + gap;
        if (j + n > words.length) continue;
        if (gap === 1 && !(LEAD.has(tok[i + n]!) || FILLERS.has(tok[i + n]!) || HESITATION.test(tok[i + n]!))) continue;
        if (exact.slice(j, j + n).join(' ') !== a.join(' ')) continue;
        if (words[j]!.start - words[i + n - 1]!.end > 2) continue; // longe demais: não é gagueira
        // Se a repetição começa num trecho NOVO, o conectivo ("Mas não de um jeito…") é da tomada nova: fica.
        const end = phraseOf[j] !== phraseOf[i + n - 1] ? i + n - 1 : j - 1;
        cut(i, end, n >= 3 ? 'false_start' : 'filler', `gaguejou: "${textOf(i, i + n - 1)}" repetido`);
        break;
      }
    }
  }

  // --- 5. Retake entre frases (fica a última tomada) ------------------------------------------
  const kept = (p: Phrase) => p.idx.some((k) => marks[k]!.keep);
  const startsLike = (a: string[], b: string[]) => {
    const firstContent = a.find(isContent);
    return (a.length >= 2 && b.slice(0, 5).join(' ').includes(`${a[0]} ${a[1]}`)) || (!!firstContent && b.filter(isContent).slice(0, 3).some((t) => sameWord(t, firstContent)));
  };
  /** `a` (uma tentativa) é uma versão anterior de `b`? */
  const isRetakeOf = (a: string[], b: string[], bTrailing: boolean) => {
    if (!b.length) return false;
    // Uma tentativa abandonada e bem mais curta não "cobre" uma frase completa.
    if (bTrailing && b.length < a.length * 0.7) return false;
    const cov = lcsLen(a, b) / a.length;
    const head = b.slice(0, 5).join(' ');
    // Começa igual: as duas primeiras palavras aparecem logo no início, OU a primeira palavra de
    // conteúdo está entre as 3 primeiras de conteúdo da outra (o ASR às vezes separa o artigo).
    const firstContent = a.find(isContent);
    const startsSame = (a.length === 1 ? b[0] === a[0] : head.includes(`${a[0]} ${a[1]}`)) || (!!firstContent && b.filter(isContent).slice(0, 3).includes(firstContent));
    const contentHits = lcsLen(a.filter(isContent), b.filter(isContent));
    return contentHits >= 1 && ((startsSame && cov >= 0.6) || (a.length >= 3 && cov >= 0.8));
  };
  /** Qualidade de uma tomada (índices de palavras): completa, fluente, confiante, no ritmo. */
  const takeScore = (from: number, to: number, trailing: boolean) => {
    const ws = words.slice(from, to + 1);
    if (!ws.length) return -9;
    const last = ws[ws.length - 1]!.w;
    let s = 0;
    if (/[.?!]$/.test(last) && !trailing) s += 2; // fecha a frase
    if (trailing) s -= 2;
    for (let k = from; k <= to; k++) {
      if (tok[k] && HESITATION.test(tok[k]!)) s -= 1;
      if (k > from && exact[k] && exact[k] === exact[k - 1]) s -= 1.5; // gaguejou
    }
    s += (ws.reduce((a, w) => a + w.p, 0) / ws.length - 0.7) * 3; // confiança do ASR
    const dur = ws[ws.length - 1]!.end - ws[0]!.start;
    const wps = ws.length / Math.max(0.3, dur);
    if (wps < 1.6 || wps > 4.2) s -= 0.7; // arrastado ou atropelado
    return s;
  };
  for (const p of phrases) {
    if (!kept(p)) continue;
    let done = false;
    // A tentativa pode ter ficado quebrada em até 3 trechos ("Tem um tipo de cansaço que…" + "dormir."):
    // compara o grupo inteiro com a tomada posterior.
    for (let m = 0; m <= 2 && !done; m++) {
      const group = phrases.slice(p.id, p.id + m + 1);
      if (group.length < m + 1 || group.some((g) => !kept(g)) || group[group.length - 1]!.end - p.start > 12) break;
      const a = group.flatMap((g, gi) => (gi === 0 ? sig(g) : toksOf(g)));
      // Frase de uma palavra ("Tudo.") não se compara por aproximação: qualquer frase depois que tenha
      // essa palavra pareceria "a mesma". Esses casos ficam com as regras de gagueira e fragmento.
      if (a.length < 2 || !a.some(isContent)) continue;
      for (let q = p.id + m + 1; q < phrases.length && q <= p.id + RETAKE_WINDOW_PHRASES; q++) {
        const pq = phrases[q]!;
        if (pq.start - p.start > RETAKE_WINDOW_SECS) break;
        if (!kept(pq)) continue;
        if (!isRetakeOf(a, sig(pq), pq.trailing)) continue;
        // Num grupo, o primeiro trecho também precisa começar como a tomada final ("Pragmática." é o fim
        // da frase anterior, não o começo de uma tentativa).
        if (m > 0 && !startsLike(sig(p), sig(pq))) continue;
        const last = group[group.length - 1]!;
        const complete = !last.trailing && a.length >= 6;
        // Qual tomada fica? A última, salvo quando a anterior é claramente melhor.
        const sEarly = takeScore(p.from, last.to, last.trailing);
        const sLate = takeScore(pq.from, pq.to, pq.trailing);
        if (complete && sEarly > sLate + 1.5 && sig(pq).length <= a.length * 1.3) {
          cut(pq.from, pq.to, 'retake', `tomada posterior de "${textOf(p.from, Math.min(p.to, p.from + 6))}…" saiu pior (gaguejou/hesitou/incompleta) — ficou a anterior`);
          doubts.push({ from: pq.from, to: pq.to, question: `Fiquei com a tomada ANTERIOR de "${textOf(p.from, Math.min(p.to, p.from + 5))}…" porque a última saiu pior. Confere qual é melhor.` });
        } else {
          cut(p.from, last.to, complete ? 'retake' : 'false_start', `tomada anterior de "${textOf(pq.from, Math.min(pq.to, pq.from + 6))}…" — ficou a última`);
          if (complete && Math.abs(sEarly - sLate) < 0.6) doubts.push({ from: p.from, to: last.to, question: `As duas tomadas de "${textOf(pq.from, Math.min(pq.to, pq.from + 5))}…" ficaram parecidas; deixei a última. Confere.` });
        }
        done = true;
        break;
      }
    }
  }

  // Fragmento curto que parou no meio ("A conversa com…", "Acum dessa…") logo antes da próxima fala:
  // é começo abandonado, mesmo sem a próxima fala repetir as mesmas palavras.
  for (const p of phrases) {
    if (!kept(p) || !p.trailing) continue;
    const ts = toksOf(p);
    if (ts.length > 4) continue;
    const next = phrases.slice(p.id + 1).find(kept);
    // Reticências no fim de um trecho podem ser só pausa ("Agora… o que ainda me incomoda?"). É abandono quando:
    // a fala é retomada com a mesma palavra ("fazendo…" → "Fazendo com que…"), ou o fragmento é murmúrio
    // (o ASR mal entendeu) ou só palavra de função ("A…", "E para…").
    if (!next) continue;
    const resumed = next.start - p.end < 20 && startsLike(ts, sig(next));
    const meanP = words.slice(p.from, p.to + 1).reduce((acc, w) => acc + w.p, 0) / (p.to - p.from + 1);
    const hollow = ts.every((t) => STOP.has(t) || FILLERS.has(t));
    if (resumed || (next.start - p.end < 6 && (meanP < 0.6 || hollow))) cut(p.from, p.to, 'false_start', `começo abandonado: "${textOf(p.from, p.to)}"`);
  }

  // --- 6. Reinício longo por sequência idêntica (abrindo frase nova) ---------------------------
  // Início de frase: começo de frase medida, OU maiúscula no meio do texto (o Whisper abre cada
  // segmento com maiúscula — "…uma promessa Nesse momento Então se faça…").
  // Depois de preposição/artigo, maiúscula é NOME ("para Sócrates", "de Hipona"), não começo de segmento.
  const capitalized = (j: number) =>
    j > 0 && /^[A-ZÁÉÍÓÚÂÊÔÃÕÀÇ]/.test(words[j]!.w) && words[j]!.w !== 'Eu' && !/[.?!…]$/.test(words[j - 1]!.w) && !STOP.has(tok[j - 1]!);
  const opensPhrase = (j: number) => {
    if (capitalized(j)) return true;
    const ph = phrases[phraseOf[j]!]!;
    let k = ph.from;
    while (k < j && (LEAD.has(tok[k]!) || !tok[k] || HESITATION.test(tok[k]!))) k++;
    return k === j;
  };
  let i = 0;
  while (i < words.length) {
    let best = -1;
    let bestN = 0;
    for (let j = i + 1; j < words.length && j - i <= RESTART_MAX_WORDS && words[j]!.start - words[i]!.start <= RESTART_MAX_SECS; j++) {
      if (!tok[i] || tok[j] !== tok[i] || !opensPhrase(j)) continue;
      let n = 0;
      while (j + n < words.length && i + n < j && tok[i + n] === tok[j + n]) n++;
      const contents = tok.slice(i, i + n).filter(isContent).length;
      if ((n >= 4 && contents >= 1) || (n === 3 && contents >= 1 && uttStart.has(j))) {
        best = j;
        bestN = n;
      }
    }
    if (best < 0) {
      i++;
      continue;
    }
    // A tomada nova começa no início da frase dela ("Para Sócrates…" — o "Para" é dela, não da anterior).
    const ph = phrases[phraseOf[best]!]!;
    const cutEnd = best - ph.from <= 2 && ph.from > i ? ph.from - 1 : best - 1;
    if (marks.slice(i, cutEnd + 1).some((m) => m.keep)) {
      cut(i, cutEnd, 'retake', `tomada anterior de "${textOf(best, best + Math.min(bestN, 6) - 1)}…" — ficou a última`);
      if (bestN === 3) doubts.push({ from: i, to: best - 1, question: `Reinício detectado por só 3 palavras ("${textOf(best, best + 2)}"). Confere se não era repetição intencional.` });
    }
    i = best;
  }

  // --- Repetição escondida pelo ASR (sílabas a mais): vira dúvida, o humano ouve ----------------
  for (const s of an.suspects ?? []) {
    if (!marks[s.i]!.keep) continue;
    doubts.push({ from: s.i, to: s.i, question: `"${words[s.i]!.w}" soa como se tivesse sido dito ${s.nuclei >= s.expected * 2 ? 'duas vezes' : 'com tropeço'} (${s.nuclei} sílabas ouvidas para ${s.expected}). Confere se não ficou gaguejado.` });
  }

  // --- Partição em trechos contíguos ----------------------------------------------------------
  const segments: DecisionSegment[] = [];
  marks.forEach((m, k) => {
    const last = segments[segments.length - 1];
    if (last && last.keep === m.keep && last.kind === m.kind && last.reason === m.reason) last.to = k;
    else segments.push({ from: k, to: k, keep: m.keep, kind: m.kind, reason: m.reason });
  });

  const count = (k: Kind) => segments.filter((s) => !s.keep && s.kind === k).length;
  const keptN = marks.filter((m) => m.keep).length;
  const summary = [
    `Decupagem local: ${keptN} de ${words.length} palavras mantidas.`,
    `${count('retake')} tomadas repetidas, ${count('false_start')} começos abandonados, ${count('offscript')} trechos de bastidor e ${count('filler')} hesitações/gaguejadas removidos.`,
    'Escolhas de roteiro (cortar frase boa que não serve à peça) ficam para a revisão humana.',
  ].join(' ');

  return { segments, summary, doubts };
}
