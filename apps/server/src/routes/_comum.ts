/** O que todas as áreas de rotas usam: erro HTTP com código, relato de falha do agente e o portão do cérebro. */
import { BRAIN } from '../config.ts';
import { apiErrorMessage, hasCredentials, RefusalError } from '../llm.ts';
import { store } from '../store.ts';

/** Erro que o Fastify devolve com o código HTTP certo (400 por padrão). */
export function erro(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

/** Erros do agente viram mensagem legível no log em vez de sumir. */
export function report(projectId: string, what: string, e: unknown): void {
  let msg = e instanceof Error ? e.message : String(e);
  if (e instanceof RefusalError) msg = 'o modelo recusou este pedido';
  else msg = apiErrorMessage(e) ?? msg;
  console.error(`[${projectId}] ${what}:`, e);
  store.log(projectId, 'system', `Falha em ${what}: ${msg}`);
  store.setActivity(projectId, { state: 'idle', message: `Falhou: ${what}` });
}

/** Só o cérebro Claude precisa de chave; o local roda sempre. */
export function requireBrain(): void {
  if (BRAIN === 'claude' && !hasCredentials()) throw erro('NEWEDITOR_BRAIN=claude, mas falta ANTHROPIC_API_KEY no .env', 412);
}
