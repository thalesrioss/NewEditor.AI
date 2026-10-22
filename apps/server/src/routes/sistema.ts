/** Sistema: saúde, Cérebro (grafo e notas, só leitura), fila global, Gestor de Projetos, LLM local e benchmark. */
import type { FastifyInstance } from 'fastify';
import { listGabaritos } from '../benchmark.ts';
import { cerebroGraph, cerebroNote } from '../cerebro.ts';
import { assumir, cardDoProjeto, devolver, lerTrava } from '../assumir.ts';
import { BRAIN } from '../config.ts';
import { createFromTask, parseTask } from '../gestor.ts';
import { cancelJob, queueState } from '../jobs.ts';
import { hasCredentials } from '../llm.ts';
import { llmSettings, modelDownloaded, setLlmSettings, type LlmSettings } from '../llm-local.ts';
import { store } from '../store.ts';
import { listVideos, PRODUTORA_DIR } from '../videos.ts';
import { erro } from './_comum.ts';

export async function rotasSistema(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ ok: true, brain: BRAIN, ready: BRAIN === 'local' || hasCredentials() }));

  // --- Cérebro do Editor como grafo (aba #/cerebro; só leitura do vault) ----------------------------
  app.get<{ Querystring: { refresh?: string } }>('/api/cerebro/grafo', async (req) => cerebroGraph(req.query.refresh === '1'));
  app.get<{ Querystring: { vault?: string; path?: string } }>('/api/cerebro/nota', async (req) => {
    if (!req.query.path) throw erro('path obrigatório');
    return cerebroNote(req.query.vault ?? 'editor', req.query.path);
  });

  // --- Galeria: todos os vídeos editados da produtora (FB-0169) -----------------------------------------
  app.get('/api/videos', async () => ({ produtora: PRODUTORA_DIR, videos: await listVideos(PRODUTORA_DIR, store.list()) }));

  // --- Assumir edição (BL-0122): o humano trava o card e o editor agente não é redisparado -------------
  app.get<{ Params: { id: string } }>('/api/projects/:id/trava', async (req) => {
    const alvo = cardDoProjeto(PRODUTORA_DIR, store.get(req.params.id));
    return { card: alvo?.card ?? null, trava: alvo ? await lerTrava(PRODUTORA_DIR, alvo.card) : null };
  });
  app.post<{ Params: { id: string }; Body: { quem?: string } | undefined }>('/api/projects/:id/assumir', async (req) => {
    const p = store.get(req.params.id);
    const quem = req.body?.quem?.trim() || 'Thales';
    const trava = await assumir(PRODUTORA_DIR, p, quem, store.undoLabels(p.id).length);
    store.log(p.id, 'human', `${quem} assumiu a edição do card ${trava.card}: o editor agente não é redisparado até devolver.`);
    return { card: trava.card, trava };
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/devolver', async (req) => {
    const p = store.get(req.params.id);
    const alvo = cardDoProjeto(PRODUTORA_DIR, p);
    const t = alvo && (await lerTrava(PRODUTORA_DIR, alvo.card));
    // Passos feitos depois de assumir (o histórico guarda até 60; os desfeitos saem da lista).
    const labels = store.undoLabels(p.id);
    const passos = t ? labels.slice(Math.min(t.passosAntes, labels.length)) : [];
    const r = await devolver(PRODUTORA_DIR, p, passos);
    store.log(p.id, 'human', `${r.trava.quem} devolveu a edição ao agente (${passos.length} alteração(ões) anotadas no PROJETO.md; card de volta a "${r.estado}").`);
    return { card: r.trava.card, trava: null, estado: r.estado, passos };
  });

  // --- Fila global ---------------------------------------------------------------------------------
  app.get('/api/fila', async () => queueState());
  app.delete<{ Params: { id: string } }>('/api/fila/:id', async (req) => ({ ok: cancelJob(req.params.id) }));

  // --- Gestor de Projetos: tarefa → briefing → Drive → fila -------------------------------------------
  app.post<{ Body: { texto: string } }>('/api/gestor/briefing', async (req) => parseTask(req.body.texto ?? ''));
  app.post<{ Body: { texto: string; nome?: string; links?: string[]; profileId?: string; formato?: { width: number; height: number; fps?: number } } }>('/api/gestor', async (req) => {
    if (!req.body.texto?.trim()) throw erro('cole o texto da tarefa');
    return createFromTask(req.body.texto, { nome: req.body.nome, links: req.body.links, profileId: req.body.profileId, formato: req.body.formato });
  });

  // --- LLM local (camada 3, com portão) -------------------------------------------------------------------
  app.get('/api/llm', async () => {
    const s = await llmSettings();
    return { ...s, baixado: await modelDownloaded(s.model) };
  });
  app.patch<{ Body: Partial<LlmSettings> }>('/api/llm', async (req) => setLlmSettings(req.body));

  // --- Benchmark (gabaritos acumulados) -------------------------------------------------------------------
  app.get('/api/benchmark', async () => ({ gabaritos: (await listGabaritos()).map((g) => ({ projectId: g.projectId, name: g.name, label: g.label, savedAt: g.savedAt, profileId: g.profileId })) }));
}
