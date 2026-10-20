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

/** Duração máxima pedida no texto, em segundos; `undefined` quando o texto não pede uma. */
export function duracaoMaxDoTexto(texto: string): number | undefined {
  const t = texto ?? '';
  const faixa = new RegExp(String.raw`\b${N}\s*(?:a|até|–|-)\s*${N}\s*(${SEG}|${MIN})`, 'i').exec(t);
  if (faixa) return num(faixa[2]!) * (new RegExp(MIN, 'i').test(faixa[3]!) ? 60 : 1);
  const TETO = String.raw`(?:até|m[áa]x(?:imo)?\.?|no m[áa]ximo)\s*(?:de\s*)?`;
  // "até 1:30", "até 1min30", "no máximo 1 min e 30 s"
  const mmss = new RegExp(String.raw`${TETO}(\d{1,2}):([0-5]\d)\b`, 'i').exec(t) ?? new RegExp(String.raw`${TETO}(\d{1,2})\s*m(?:in(?:utos?)?)?\s*(?:e\s*)?([0-5]?\d)\s*(?:${SEG})?(?![\d:])`, 'i').exec(t);
  if (mmss) return +mmss[1]! * 60 + +mmss[2]!;
  const teto = new RegExp(String.raw`${TETO}${N}\s*(${SEG}|${MIN})`, 'i').exec(t);
  if (teto) return num(teto[1]!) * (new RegExp(MIN, 'i').test(teto[2]!) ? 60 : 1);
  return undefined;
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
  return `Peça com ${mss(total)}; o briefing pede até ${mss(alvo)} (passa ${Math.ceil(total - alvo)} s)`;
}
