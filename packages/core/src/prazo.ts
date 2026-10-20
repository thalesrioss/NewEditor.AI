/**
 * Prazo em dias de calendário (BL-0077): compara a data do prazo com a data de hoje, as duas à meia-noite local.
 * Prazo hoje → 0, ontem → -1, amanhã → 1, independente da hora do dia. `Math.round` absorve a hora a mais/a menos
 * da virada do horário de verão.
 */
export function diasAtePrazo(iso: string, agora: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const prazo = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const d = Math.round((prazo.getTime() - hoje.getTime()) / 86400000);
  return d === 0 ? 0 : d;
}

/** Texto e tom do selo de prazo no card do Kanban. */
export function seloPrazo(dias: number): { texto: string; tom: 'atrasado' | 'perto' | 'folga' } {
  if (dias < 0) return { texto: `atrasado ${-dias}d`, tom: 'atrasado' };
  if (dias === 0) return { texto: 'entrega hoje', tom: 'perto' };
  return { texto: `entrega em ${dias}d`, tom: dias <= 1 ? 'perto' : 'folga' };
}
