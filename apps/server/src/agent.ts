/**
 * Agente de comandos: o editor humano pede alterações em texto ("tira o trecho em que ele fala
 * do Ozempic", "dá um zoom no 'Tudo.'") e o NewEditor.AI executa — cada ação move o avatar e
 * aparece ao vivo no Editor Brain.
 *
 * Cérebro local (padrão, sem API): commands-local.ts. Quando o pedido não cabe na gramática local e o LLM
 * local está ligado para "comando" (ADR-003 camada 3), o modelo reescreve o pedido numa frase que o
 * interpretador local entende. A reescrita nunca é executada sozinha (ADR-0005): vira sugestão no chat com
 * "Aplicar", e só o clique do editor manda a frase como pedido. Cérebro Claude (opcional): claude/commands.ts,
 * só com NEWEDITOR_BRAIN=claude.
 */
import { clipDuration, clipStarts, formatTime } from '@neweditor/core';
import { loadTranscripts } from './actions.ts';
import { pedeDesfazer, runLocalCommand } from './commands-local.ts';
import { BRAIN } from './config.ts';
import { askJson, llmFor, type Ask } from './llm-local.ts';
import { store } from './store.ts';

/** Só para teste: LLM simulado no lugar do local. */
export interface CommandDeps {
  llm?: () => Promise<boolean>;
  ask?: (q: Ask) => Promise<{ comando: string | null }>;
}

export const SUGESTAO = 'Não sei fazer isso direto. Sugestão:';

export async function runCommand(projectId: string, text: string, playhead?: number, deps: CommandDeps = {}): Promise<string> {
  // Um pedido = um passo de desfazer, com o rótulo do pedido (BL-0055). "Desfaz" fica fora: dentro de uma
  // transação o store recusa desfazer.
  if (pedeDesfazer(text)) return runOne(projectId, text, playhead, deps);
  return store.transaction(projectId, `Pedido: "${text.trim().slice(0, 40)}"`, () => runOne(projectId, text, playhead, deps));
}

async function runOne(projectId: string, text: string, playhead: number | undefined, deps: CommandDeps): Promise<string> {
  if (BRAIN === 'claude') {
    const { runClaudeCommand } = await import('./claude/commands.ts');
    return runClaudeCommand(projectId, text, playhead);
  }
  const answer = await runLocalCommand(projectId, text, playhead);
  if (!/^Ainda não entendi/.test(answer) || !(await (deps.llm ?? (() => llmFor('comando')))())) return answer;
  const restated = await restateForLocal(projectId, text, playhead ?? 0, deps.ask ?? askJson).catch(() => null);
  if (!restated || restated === text || moldeLiteral(restated)) return answer;
  const sugestao = `${SUGESTAO} "${restated}"`;
  store.log(projectId, 'agent', sugestao, { text: restated, playhead });
  return sugestao;
}

/** O LLM copiou o molde em vez de preencher ("dá um zoom de <1.05 a 1.3> aqui", "corta de m:ss…") ou devolveu "null" em texto. */
const moldeLiteral = (s: string) => /[<>]|1\.05 a 1\.3|m:ss|trecho literal/i.test(s) || /^["']?(null|none|undefined|nenhum|-)?["']?$/i.test(s.trim());

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
async function restateForLocal(projectId: string, text: string, playhead: number, ask: NonNullable<CommandDeps['ask']>): Promise<string | null> {
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
  const r = await ask({
    system: 'Você traduz pedidos de um editor de vídeo para comandos curtos que um programa simples entende. Responda só com JSON.',
    user: [`O editor está em ${formatTime(playhead)} da timeline. A fala perto do cursor é:`, `<<${fala}>>`, '', `Pedido do editor: "${text}"`, '', 'Formatos que o programa entende (use EXATAMENTE um deles, trocando o que está entre <>):', ...GRAMMAR.map((g) => `- ${g}`), '', 'Se o pedido não cabe em nenhum, devolva null. JSON: {"comando": "..."}'].join('\n'),
    maxTokens: 120,
    timeoutMs: 45_000,
  });
  return typeof r.comando === 'string' && r.comando.trim() ? r.comando.trim() : null;
}
