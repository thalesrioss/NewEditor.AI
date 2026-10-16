/**
 * Cliente do cérebro Claude (OPCIONAL, NEWEDITOR_BRAIN=claude). Só é carregado por import() dinâmico:
 * no modo local (padrão) o SDK nem entra no processo.
 */
import Anthropic from '@anthropic-ai/sdk';
import { MODEL } from '../config.ts';

let client: Anthropic | null = null;

export function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * Parâmetros comuns a toda chamada do NewEditor.AI.
 * `fallbacks: 'default'` — se o modelo principal recusar por falso positivo de segurança,
 * a API refaz a chamada num modelo de fallback dentro da mesma requisição.
 */
export function baseParams(): { model: string; betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } {
  return { model: MODEL, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

