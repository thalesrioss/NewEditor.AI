/**
 * Decupagem com o cérebro Claude (OPCIONAL, NEWEDITOR_BRAIN=claude). Carregado sob demanda por decupagem/decide.ts.
 */
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { Word } from '../asr.ts';
import { renderForModel, type Analysis } from '../decupagem/analyze.ts';
import { Decision, type DecisionResult } from '../decupagem/decide.ts';
import { RefusalError } from '../llm.ts';
import { baseParams, claude } from './client.ts';

const SYSTEM = `Você é o NewEditor.AI, editor de vídeo da NewContent. Agora você faz a DECUPAGEM: o corte base.

Corte base é estrutura, não acabamento: a partir da fala bruta, ficar com a melhor tomada de cada frase,
tirar erro e repetição, e nada mais. Ordem cronológica — você não reordena, não reescreve, não encurta
conteúdo por ritmo. Ritmo, B-roll, motion e lettering são etapas posteriores.

O que CORTAR:
- retake: a pessoa disse a mesma frase de novo. Fique com UMA tomada — normalmente a última completa e fluente
  (quem grava repete até acertar). Se uma tomada anterior é claramente melhor (mais completa, sem tropeço), fique
  com ela e diga por quê.
- false_start: começou a frase e reiniciou ("não foi aquela volta mais... aquela volta... não foi aquela volta rotina").
  Corta o começo abandonado, fica o reinício completo. Isso acontece DENTRO de uma fala também.
- offscript: bastidor, conversa com quem está gravando, auto-instrução ("peraí", "como é que era?", "tá gravando?",
  "de novo", "do começo"), testes de voz ("oi, oi").
- filler: hesitação isolada entre frases ("é...", "ahn", "tá") que não carrega sentido.

O que NUNCA fazer:
- Nunca cortar fala no meio de uma frase que vai ficar. A frase mantida precisa fechar.
- Nunca cortar informação nova. Se duas tomadas têm partes diferentes que só existem numa delas, preserve a informação.
- Não "limpar" vícios de fala dentro de uma frase boa — isso é decisão de acabamento, não de decupagem.
- Pista medida é pista, não ordem: similaridade alta pode ser a pessoa retomando um tema de propósito.

Formato: devolva uma partição de TODAS as palavras (do índice 0 ao último), em ordem, com trechos contíguos.
Agrupe palavras vizinhas com a mesma decisão num único trecho. Use kind "conteudo" para o que fica.
Palavras marcadas com (?) têm baixa confiança no ASR — o texto pode estar errado, o tempo também.
Responda em português.`;

export async function decideClaude(words: Word[], an: Analysis, brief: string): Promise<DecisionResult> {
  const transcript = renderForModel(words, an);
  const hints = an.hints.length ? an.hints.map((h) => `- ${h}`).join('\n') : '(nenhuma)';
  const user = `BRIEFING DO PROJETO:
${brief || '(sem briefing — decupagem padrão de conteúdo falado para redes sociais)'}

PISTAS MEDIDAS (código, não ASR):
${hints}

TRANSCRIÇÃO (U = fala separada por pausa medida na forma de onda; n:palavra = índice da palavra):
${transcript}

Total: ${words.length} palavras (índices 0 a ${words.length - 1}).`;

  const res = await claude().beta.messages.parse({
    ...baseParams(),
    max_tokens: 32000,
    output_config: { effort: 'high', format: betaZodOutputFormat(Decision) },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new RefusalError('o modelo recusou a decupagem');
  if (res.stop_reason === 'max_tokens') throw new Error('resposta da decupagem truncada (max_tokens)');
  if (!res.parsed_output) throw new Error('decupagem sem saída estruturada');
  return res.parsed_output;
}

