/**
 * O que o servidor sabe do cérebro Claude SEM carregar o SDK (ADR-006): o padrão é o cérebro local, sem API.
 * O cliente fica em claude/client.ts e só é importado quando NEWEDITOR_BRAIN=claude.
 */
export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export class RefusalError extends Error {}

/** Mensagem legível para erro da API (pelo nome da classe, sem importar o SDK). */
export function apiErrorMessage(e: unknown): string | null {
  const name = (e as { constructor?: { name?: string } })?.constructor?.name ?? '';
  const status = (e as { status?: number })?.status;
  if (name === 'AuthenticationError') return 'chave da API inválida — confira ANTHROPIC_API_KEY no .env';
  if (name === 'RateLimitError') return 'limite de uso da API atingido, tente de novo em instantes';
  if (/APIError$|Error$/.test(name) && typeof status === 'number') return `API ${status}: ${(e as Error).message}`;
  return null;
}
