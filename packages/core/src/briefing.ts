/**
 * Duração-alvo escrita no briefing (BL-0024): "até 60s", "no máximo 45 segundos", "até 2 min", "de 30 a 45 s".
 * Só o que está no texto: formato sem número ("Reels") não vira alvo. Usada no QC (regra `duracao-briefing`)
 * e na revisão da decupagem, que deixa de dizer "Nada pendente" quando a peça passa do alvo.
 */
import { timelineDuration } from './timeline.ts';
import type { Project } from './types.ts';

const SEG = String.raw`(?:s\b|seg\b|segs?\b|segundos?\b)`;
const MIN = String.raw`(?:min\b|mins\b|minutos?\b)`;
const N = String.raw`(\d{1,3}(?:[.,]\d)?)`;
const num = (s: string) => Number(s.replace(',', '.'));

const emSeg = (n: string, unidade: string) => num(n) * (new RegExp(MIN, 'i').test(unidade) ? 60 : 1);
const TETO = String.raw`(?:até|m[áa]x(?:imo)?\.?|no m[áa]ximo)\s*(?:de\s*)?`;
const FORMAS: { re: RegExp; dur: (m: RegExpMatchArray) => { min?: number; max: number } }[] = [
  // "de 30 a 45 s", "1 a 2 min"
  { re: new RegExp(String.raw`\b${N}\s*(?:a|até|–|-)\s*${N}\s*(${SEG}|${MIN})`, 'gi'), dur: (m) => ({ min: emSeg(m[1]!, m[3]!), max: emSeg(m[2]!, m[3]!) }) },
  // "até 1:30"
  { re: new RegExp(String.raw`${TETO}(\d{1,2}):([0-5]\d)\b`, 'gi'), dur: (m) => ({ max: +m[1]! * 60 + +m[2]! }) },
  // "até 1min30", "no máximo 1 min e 30 s"
  { re: new RegExp(String.raw`${TETO}(\d{1,2})\s*m(?:in(?:utos?)?)?\s*(?:e\s*)?([0-5]?\d)\s*(?:${SEG})?(?![\d:])`, 'gi'), dur: (m) => ({ max: +m[1]! * 60 + +m[2]! }) },
  // "até 60s", "no máximo 2 min"
  { re: new RegExp(String.raw`${TETO}${N}\s*(${SEG}|${MIN})`, 'gi'), dur: (m) => ({ max: emSeg(m[1]!, m[2]!) }) },
];

/**
 * Duração pedida no texto, em segundos (`min` só quando o texto dá a faixa); `undefined` quando não pede.
 * Um briefing fala de várias durações ("Reels até 60s, gancho de 3 a 5 segundos"): o alvo da peça é o MAIOR
 * teto entre todas, porque as partes (gancho, pausa) cabem dentro da peça. Faixa depois de "mais de" é um
 * mínimo ("pausas de mais de 2 a 3 seg"), não teto. Minutos soltos sem "até" ("o bruto tem 20 min") não viram alvo.
 * Fonte única: o QC (`duracao-briefing`) e o briefing do Gestor (`duracaoAlvoS`) leem daqui.
 */
export function duracaoDoTexto(texto: string): { min?: number; max: number } | undefined {
  const t = texto ?? '';
  let melhor: { min?: number; max: number } | undefined;
  for (const { re, dur } of FORMAS) {
    for (const m of t.matchAll(re)) {
      if (/mais de\s*$/i.test(t.slice(Math.max(0, m.index! - 12), m.index))) continue;
      const d = dur(m);
      if (d.max > 0 && (!melhor || d.max > melhor.max)) melhor = d;
    }
  }
  return melhor;
}

/** Duração máxima pedida no texto, em segundos; `undefined` quando o texto não pede uma. */
export function duracaoMaxDoTexto(texto: string): number | undefined {
  return duracaoDoTexto(texto)?.max;
}

/** Duração-alvo do projeto: o texto da tarefa (Gestor) ou, sem tarefa, o briefing escrito à mão. */
export function duracaoAlvoDoProjeto(p: Pick<Project, 'brief' | 'task'>): number | undefined {
  return duracaoMaxDoTexto(p.task?.texto ?? p.brief ?? '');
}

/** A peça passa do alvo do briefing? Folga de meio segundo (um respiro não é motivo de aviso). */
export function passaDoAlvo(p: Pick<Project, 'brief' | 'task' | 'timeline'>): { total: number; alvo: number } | undefined {
  const alvo = duracaoAlvoDoProjeto(p);
  if (!alvo) return undefined;
  const total = timelineDuration(p.timeline);
  return total > alvo + 0.5 ? { total, alvo } : undefined;
}

const mss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Texto do aviso, igual no QC e na revisão: as duas durações e quanto passa. */
export function textoPassaDoAlvo({ total, alvo }: { total: number; alvo: number }): string {
  return `Peça com ${mss(total)}; o briefing pede até ${mss(alvo)} (passa ${Math.max(1, Math.round(total - alvo))} s)`;
}
