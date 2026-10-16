/**
 * Agente de comandos com o cérebro Claude (OPCIONAL, NEWEDITOR_BRAIN=claude). Carregado sob demanda por agent.ts.
 */
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { clipDuration, clipStarts, formatTime, sourceToTimeline, type OpEnvelope, type Project } from '@neweditor/core';
import type { Transcript } from '../asr.ts';
import { act as actOn, finish, loadTranscripts, textOf } from '../actions.ts';
import { RefusalError } from '../llm.ts';
import { normalizeToken } from '../decupagem/analyze.ts';
import { store } from '../store.ts';
import { baseParams, claude } from './client.ts';

const recent = new Map<string, { q: string; a: string }[]>();

const SYSTEM = `Você é o NewEditor.AI, editor de vídeo da NewContent, trabalhando dentro do Editor Brain.
Um editor humano está revisando o seu corte e pede alterações em texto. Você executa com as ferramentas.

Como trabalhar:
- Antes de cortar, localize o trecho: use ver_timeline ou buscar_fala. Nunca chute tempos.
- Tempos são em segundos da TIMELINE (o vídeo montado), salvo quando a ferramenta diz "fonte".
- Nunca corte fala no meio de uma frase que vai ficar. Corte em fronteira de palavra; prefira fronteira de frase.
- Um trecho removido pode voltar: use listar_removidos + restaurar.
- Quebra de padrão: não repita o mesmo zoom em clipes seguidos. Cut zoom fica entre 1.06 e 1.14.
- Se o pedido for ambíguo e um corte errado custaria caro, faça a leitura mais conservadora e diga qual foi.
- Ao terminar, responda em 1 a 3 frases, em português, dizendo exatamente o que mudou (com tempos).`;

interface Ctx {
  projectId: string;
  transcripts: Map<string, Transcript>;
}

function project(ctx: Ctx): Project {
  return store.get(ctx.projectId);
}

function act(ctx: Ctx, env: OpEnvelope, state: 'cutting' | 'motion', at: number, message: string): Promise<string> {
  return actOn(ctx.projectId, env, state, at, message);
}

function tools(ctx: Ctx) {
  return [
    betaZodTool({
      name: 'ver_timeline',
      description: 'Lista os clipes da timeline montada, com início/fim na timeline, trecho da fonte, zoom e o texto falado em cada clipe.',
      inputSchema: z.object({}),
      run: async () => {
        const p = project(ctx);
        const starts = clipStarts(p.timeline);
        const total = p.timeline.main.reduce((a, c) => a + clipDuration(c), 0);
        const lines = p.timeline.main.map((c, i) => {
          const s = starts[i]!;
          return `${c.id} | TL ${s.toFixed(2)}–${(s + clipDuration(c)).toFixed(2)} | fonte ${c.assetId} ${c.in.toFixed(2)}–${c.out.toFixed(2)}${c.zoom ? ` | zoom ${c.zoom}` : ''} | "${textOf(ctx.transcripts.get(c.assetId), c.in, c.out)}"`;
        });
        return `Duração ${total.toFixed(2)}s, ${lines.length} clipes:\n${lines.join('\n')}`;
      },
    }),
    betaZodTool({
      name: 'buscar_fala',
      description: 'Procura um trecho de fala no material bruto (busca aproximada, sem acento). Devolve onde aparece na fonte e, se estiver na timeline, onde aparece nela.',
      inputSchema: z.object({ texto: z.string() }),
      run: async ({ texto }) => {
        const q = texto.split(/\s+/).map(normalizeToken).filter(Boolean);
        if (!q.length) return 'texto vazio';
        const p = project(ctx);
        const hits: string[] = [];
        for (const [assetId, tr] of ctx.transcripts) {
          const toks = tr.words.map((w) => normalizeToken(w.w));
          for (let i = 0; i + q.length <= toks.length; i++) {
            let match = 0;
            for (let k = 0; k < q.length; k++) if (toks[i + k] === q[k]) match++;
            if (match / q.length < 0.75) continue;
            const a = tr.words[i]!;
            const b = tr.words[i + q.length - 1]!;
            const tl = sourceToTimeline(p.timeline, assetId, (a.start + a.end) / 2);
            hits.push(`fonte ${assetId} ${a.start.toFixed(2)}–${b.end.toFixed(2)} | ${tl === null ? 'FORA da timeline (cortado)' : `timeline ≈ ${tl.toFixed(2)}`} | "${textOf(tr, a.start - 1.5, b.end + 1.5)}"`);
            if (hits.length >= 8) break;
          }
        }
        return hits.length ? hits.join('\n') : 'não encontrado';
      },
    }),
    betaZodTool({
      name: 'cortar_timeline',
      description: 'Remove o intervalo [inicio, fim) da TIMELINE montada (segundos). Use fronteiras de palavra.',
      inputSchema: z.object({ inicio: z.number(), fim: z.number(), motivo: z.string() }),
      run: async ({ inicio, fim, motivo }) =>
        act(ctx, { by: 'agent', op: { type: 'cut_timeline', start: inicio, end: fim, reason: motivo }, note: `Cortei ${formatTime(inicio)}–${formatTime(fim)}: ${motivo}` }, 'cutting', inicio, motivo),
    }),
    betaZodTool({
      name: 'cortar_fonte',
      description: 'Remove um intervalo do material BRUTO (tempos da fonte) de onde quer que ele apareça na timeline.',
      inputSchema: z.object({ asset_id: z.string(), inicio: z.number(), fim: z.number(), motivo: z.string() }),
      run: async ({ asset_id, inicio, fim, motivo }) => {
        const at = sourceToTimeline(project(ctx).timeline, asset_id, inicio) ?? 0;
        return act(ctx, { by: 'agent', op: { type: 'cut_source', assetId: asset_id, in: inicio, out: fim, kind: 'manual', reason: motivo }, note: `Cortei do bruto ${formatTime(inicio)}–${formatTime(fim)}: ${motivo}` }, 'cutting', at, motivo);
      },
    }),
    betaZodTool({
      name: 'listar_removidos',
      description: 'Lista os trechos que foram cortados (com id, tipo, motivo e o texto falado), para poder restaurar.',
      inputSchema: z.object({}),
      run: async () => {
        const rs = project(ctx).timeline.removals;
        return rs.length
          ? rs.map((r) => `${r.id} | fonte ${r.assetId} ${r.in.toFixed(2)}–${r.out.toFixed(2)} | ${r.kind} | ${r.reason} | "${textOf(ctx.transcripts.get(r.assetId), r.in, r.out)}"`).join('\n')
          : 'nenhum trecho removido';
      },
    }),
    betaZodTool({
      name: 'restaurar',
      description: 'Devolve um trecho removido para a timeline, na posição cronológica.',
      inputSchema: z.object({ removal_id: z.string() }),
      run: async ({ removal_id }) => {
        const r = project(ctx).timeline.removals.find((x) => x.id === removal_id);
        return act(ctx, { by: 'agent', op: { type: 'restore', removalId: removal_id }, note: `Restaurei: ${r?.reason ?? removal_id}` }, 'cutting', 0, 'Restaurando trecho');
      },
    }),
    betaZodTool({
      name: 'aparar_clipe',
      description: 'Ajusta a entrada e/ou saída (tempos da FONTE) de um clipe.',
      inputSchema: z.object({ clip_id: z.string(), entrada: z.number().optional(), saida: z.number().optional() }),
      run: async ({ clip_id, entrada, saida }) => {
        const p = project(ctx);
        const i = p.timeline.main.findIndex((c) => c.id === clip_id);
        return act(ctx, { by: 'agent', op: { type: 'trim', clipId: clip_id, in: entrada, out: saida }, note: `Aparei o clipe ${i + 1}` }, 'cutting', clipStarts(p.timeline)[i] ?? 0, 'Aparando');
      },
    }),
    betaZodTool({
      name: 'dividir',
      description: 'Divide o clipe no tempo da timeline indicado (útil antes de dar zoom só numa parte).',
      inputSchema: z.object({ tempo: z.number() }),
      run: async ({ tempo }) => act(ctx, { by: 'agent', op: { type: 'split', time: tempo } }, 'cutting', tempo, 'Dividindo o clipe'),
    }),
    betaZodTool({
      name: 'zoom',
      description: 'Aplica cut zoom estático num clipe (1 = sem zoom; use 1.06–1.14).',
      inputSchema: z.object({ clip_id: z.string(), zoom: z.number() }),
      run: async ({ clip_id, zoom }) => {
        const p = project(ctx);
        const i = p.timeline.main.findIndex((c) => c.id === clip_id);
        return act(ctx, { by: 'agent', op: { type: 'set_zoom', clipId: clip_id, zoom }, note: `Zoom ${zoom}× no clipe ${i + 1}` }, 'motion', clipStarts(p.timeline)[i] ?? 0, `Zoom ${zoom}×`);
      },
    }),
    betaZodTool({
      name: 'mover_clipe',
      description: 'Move um clipe para outra posição (índice, 0 = primeiro).',
      inputSchema: z.object({ clip_id: z.string(), para_indice: z.number().int() }),
      run: async ({ clip_id, para_indice }) => act(ctx, { by: 'agent', op: { type: 'move_clip', clipId: clip_id, toIndex: para_indice }, note: `Movi um clipe para a posição ${para_indice + 1}` }, 'cutting', 0, 'Reorganizando'),
    }),
  ];
}

export async function runClaudeCommand(projectId: string, text: string, playhead?: number): Promise<string> {
  const p = store.get(projectId);
  const ctx: Ctx = { projectId, transcripts: await loadTranscripts(p) };
  store.log(projectId, 'human', text);
  store.setActivity(projectId, { state: 'thinking', message: 'Entendendo o pedido', at: playhead });

  const history = (recent.get(projectId) ?? []).map((h) => `Pedido anterior: ${h.q}\nVocê respondeu: ${h.a}`).join('\n\n');
  const user = `Projeto: ${p.name}
Briefing: ${p.brief || '(sem briefing)'}
Materiais: ${p.assets.map((a) => `${a.id} = ${a.name} (${a.duration.toFixed(1)}s)`).join('; ')}
${playhead !== undefined ? `O cursor do editor está em ${playhead.toFixed(2)}s da timeline ("aqui" = esse ponto).` : ''}
${history ? `\n${history}\n` : ''}
PEDIDO: ${text}`;

  const runner = claude().beta.messages.toolRunner({
    ...baseParams(),
    max_tokens: 16000,
    max_iterations: 20,
    output_config: { effort: 'medium' },
    system: SYSTEM,
    tools: tools(ctx),
    messages: [{ role: 'user', content: user }],
  });
  const final = await runner.done();
  if (final.stop_reason === 'refusal') throw new RefusalError('o modelo recusou o pedido');
  const answer = final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim() || 'Feito.';

  const h = recent.get(projectId) ?? [];
  h.push({ q: text, a: answer });
  recent.set(projectId, h.slice(-4));
  return finish(projectId, answer);
}
