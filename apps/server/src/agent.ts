/**
 * Agente de comandos: o editor humano pede alterações em texto ("tira o trecho em que ele fala
 * do Ozempic", "dá um zoom no 'Tudo.'") e o NewEditor.AI executa — cada ação move o avatar e
 * aparece ao vivo no Editor Brain.
 *
 * Cérebro local (padrão, sem API): commands-local.ts. Quando o pedido não cabe na gramática local e o LLM
 * local está ligado para "comando" (ADR-003 camada 3), o modelo reescreve o pedido numa frase que o
 * interpretador local entende. Cérebro Claude (opcional): claude/commands.ts, só com NEWEDITOR_BRAIN=claude.
 */
import { clipDuration, clipStarts, formatTime } from '@neweditor/core';
import { loadTranscripts } from './actions.ts';
import { runLocalCommand } from './commands-local.ts';
import { BRAIN } from './config.ts';
import { askJson, llmFor } from './llm-local.ts';
import { store } from './store.ts';

export async function runCommand(projectId: string, text: string, playhead?: number): Promise<string> {
  if (BRAIN === 'claude') {
    const { runClaudeCommand } = await import('./claude/commands.ts');
    return runClaudeCommand(projectId, text, playhead);
  }
  const answer = await runLocalCommand(projectId, text, playhead);
  if (!/^Ainda não entendi/.test(answer) || !(await llmFor('comando'))) return answer;
  const restated = await restateForLocal(projectId, text, playhead ?? 0).catch(() => null);
  if (!restated || restated === text) return answer;
  store.log(projectId, 'agent', `Entendi como: "${restated}"`);
  const second = await runLocalCommand(projectId, restated, playhead);
  return /^Ainda não entendi/.test(second) ? answer : second;
}

const GRAMMAR = [
  'corta de <m:ss> até <m:ss>',
  "tira o trecho onde ele fala '<trecho literal da fala>'",
  'tira as pausas longas',
  'dá um zoom de <1.05 a 1.3> aqui',
  'tira o zoom',
  'restaura o último corte',
  "restaura '<trecho literal>'",
  'divide aqui',
  'apaga esse clipe',
  'desfaz',
];

/** O LLM local reescreve o pedido numa das frases que o interpretador local conhece, com a fala em volta do cursor. */
async function restateForLocal(projectId: string, text: string, playhead: number): Promise<string | null> {
  const p = store.get(projectId);
  const trs = await loadTranscripts(p);
  const starts = clipStarts(p.timeline);
  const near: string[] = [];
  p.timeline.main.forEach((c, i) => {
    const s = starts[i]!;
    const e = s + clipDuration(c);
    if (e < playhead - 12 || s > playhead + 12) return;
    const ws = trs.get(c.assetId)?.words.filter((w) => w.start >= c.in && w.start < c.out) ?? [];
    near.push(ws.map((w) => w.w).join(' '));
  });
  const fala = near.join(' ').slice(0, 900);
  const r = await askJson<{ comando: string | null }>({
    system: 'Você traduz pedidos de um editor de vídeo para comandos curtos que um programa simples entende. Responda só com JSON.',
    user: [`O editor está em ${formatTime(playhead)} da timeline. A fala perto do cursor é:`, `<<${fala}>>`, '', `Pedido do editor: "${text}"`, '', 'Formatos que o programa entende (use EXATAMENTE um deles, trocando o que está entre <>):', ...GRAMMAR.map((g) => `- ${g}`), '', 'Se o pedido não cabe em nenhum, devolva null. JSON: {"comando": "..."}'].join('\n'),
    maxTokens: 120,
    timeoutMs: 45_000,
  });
  return typeof r.comando === 'string' && r.comando.trim() ? r.comando.trim() : null;
}
