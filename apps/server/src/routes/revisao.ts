/** Revisão da decupagem (portão humano), aprovação, ciclo de alteração (comentários → versão nova) e notificações. */
import type { FastifyInstance } from 'fastify';
import { addComment, diffTimelines, patchComment, removeComment } from '../alteracoes.ts';
import { saveGabarito } from '../benchmark.ts';
import { stepEnd } from '../estimate.ts';
import { approveDecupagem } from '../finalize.ts';
import { enqueueJob, queuePosition } from '../jobs.ts';
import { listNotifications, markRead } from '../notify.ts';
import { addTermoAoPerfil } from '../profiles.ts';
import { canalDaTela, fecharSessaoHumana, registrarDaTela } from '../registro-tela.ts';
import { reviewDoubts } from '../review.ts';
import { store } from '../store.ts';
import { erro, report } from './_comum.ts';

export async function rotasRevisao(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/projects/:id/review', async (req) => {
    const p = store.get(req.params.id);
    return { status: p.status, review: p.review ?? {}, doubts: await reviewDoubts(p) };
  });
  app.post<{ Params: { id: string }; Body: { doubtId: string } }>('/api/projects/:id/review/resolve', async (req) => {
    const p = store.get(req.params.id);
    const resolvidas = [...new Set([...(p.review?.resolvidas ?? []), req.body.doubtId])];
    store.update(p.id, { review: { ...p.review, resolvidas } });
    return { ok: true };
  });
  /** "Guardar no perfil do cliente" (BL-0081): a grafia conferida entra no glossário do perfil do projeto. */
  app.post<{ Params: { id: string }; Body: { termo: unknown } }>('/api/projects/:id/glossario', async (req) => {
    const termo = req.body?.termo;
    if (typeof termo !== 'string' || !termo.trim()) throw erro('termo precisa ser um texto');
    const prof = await addTermoAoPerfil(store.get(req.params.id), termo);
    const gravado = prof.glossario?.[0] ?? termo.trim();
    store.log(req.params.id, 'human', `Guardou "${gravado}" no glossário de ${prof.nome}`);
    return { perfil: prof.id, nome: prof.nome, termo: gravado, glossario: prof.glossario ?? [] };
  });
  /** Trocar a tomada: volta a descartada e corta a que o agente tinha deixado — um passo de desfazer. */
  app.post<{ Params: { id: string }; Body: { doubtId: string } }>('/api/projects/:id/review/swap', async (req) => {
    const p = store.get(req.params.id);
    const d = (await reviewDoubts(p)).find((x) => x.id === req.body.doubtId);
    if (!d?.removalId || !d.swap) throw erro('não achei a tomada para trocar', 404);
    await store.transaction(p.id, 'Trocou a tomada', async () => {
      store.apply(p.id, { by: 'human', op: { type: 'restore', removalId: d.removalId! } });
      store.apply(p.id, { by: 'human', op: { type: 'cut_source', assetId: d.assetId, in: d.swap!.in, out: d.swap!.out, kind: 'retake', reason: 'tomada trocada na revisão' }, note: `Trocou a tomada: ficou "${d.text.slice(0, 50)}…"` });
    });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/approve', async (req) => {
    const { id } = req.params;
    const canal = canalDaTela(req.headers);
    // Pela tela = o Thales aprovou: fecha a edição à mão dele (resumo) e grava a aprovação no Cérebro.
    if (canal) await fecharSessaoHumana(id);
    const versao = store.get(id).version;
    const r = await approveDecupagem(id);
    if (canal) void registrarDaTela(store.get(id), canal, { tipo: 'aprovacao', pedido: 'Aprovou a decupagem no Editor Brain', depois: `decupagem aprovada (${store.get(id).timeline.main.length} clipe(s)); o agente finaliza`, ref: `tela:${id}:aprovou-decupagem:${versao}` });
    stepEnd(id, 'revisao');
    await saveGabarito(store.get(id), 'aprovado');
    void enqueueJob(id, 'finalizar').catch((e) => report(id, 'finalização', e));
    return { queued: true, ...r };
  });

  // --- Ciclo de alteração: comentários com tempo → o agente faz → versão nova -----------------------
  app.post<{ Params: { id: string }; Body: { at: number; text: string; by?: 'editor' | 'cliente' } }>('/api/projects/:id/comments', async (req) => {
    if (!req.body.text?.trim()) throw erro('comentário vazio');
    const c = addComment(req.params.id, req.body);
    // Comentário do editor pela tela = pedido de alteração do Thales (o do cliente, repassado, não é dele).
    const canal = canalDaTela(req.headers);
    if (canal && c.by === 'editor') void registrarDaTela(store.get(req.params.id), canal, { tipo: 'alteracao', pedido: c.text, ref: `tela:${req.params.id}:${c.id}` });
    return c;
  });
  app.patch<{ Params: { id: string; cid: string }; Body: { text?: string; at?: number; status?: 'aberto' | 'feito' | 'manual' | 'descartado' } }>('/api/projects/:id/comments/:cid', async (req) => patchComment(req.params.id, req.params.cid, req.body));
  app.delete<{ Params: { id: string; cid: string } }>('/api/projects/:id/comments/:cid', async (req) => (removeComment(req.params.id, req.params.cid), { ok: true }));
  app.post<{ Params: { id: string } }>('/api/projects/:id/alteracoes', async (req) => {
    const { id } = req.params;
    void enqueueJob(id, 'alteracoes').catch((e) => report(id, 'alterações', e));
    return { queued: true, posicao: queuePosition(id) };
  });
  app.get<{ Params: { id: string }; Querystring: { a?: string; b?: string } }>('/api/projects/:id/versoes/diff', async (req) => {
    const p = store.get(req.params.id);
    const vs = p.versions ?? [];
    const a = vs.find((v) => String(v.n) === req.query.a) ?? vs.at(-2);
    const b = req.query.b ? vs.find((v) => String(v.n) === req.query.b) : undefined;
    if (!a) throw erro('sem versão anterior para comparar', 404);
    return { a: a.n, b: b?.n ?? 'atual', diff: diffTimelines(a.timeline, b?.timeline ?? p.timeline) };
  });

  // --- Notificações (sino) ---------------------------------------------------------------------------
  app.get('/api/notifications', async () => listNotifications());
  app.post<{ Body: { ids?: string[] } }>('/api/notifications/read', async (req) => {
    await markRead(req.body?.ids);
    return { ok: true };
  });
}
