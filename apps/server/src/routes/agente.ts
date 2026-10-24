/**
 * O agente por área: decupagem, pedido em texto, e as passadas automáticas (até o corte, B-roll, trilha,
 * multicâmera, reframe, cor, ritmo) e a leitura de rosto. Tudo entra na fila do projeto e relata no log.
 */
import type { FastifyInstance } from 'fastify';
import { cutEndAfter, resolveOverlay } from '@neweditor/core';
import { runCommand } from '../agent.ts';
import { autoBroll } from '../broll.ts';
import { autoGrade } from '../color.ts';
import { enqueue, enqueueJob, isBusy, queuePosition } from '../jobs.ts';
import { autoMulticam, syncCamera } from '../multicam.ts';
import { musicAuto } from '../music.ts';
import { autoReframe } from '../reframe.ts';
import { autoFlashes, autoZooms, monotonous } from '../ritmo.ts';
import { store } from '../store.ts';
import { facesOf, faceSummary, safeTextY, visionAvailable } from '../vision.ts';
import { erro, report, requireBrain } from './_comum.ts';

export async function rotasAgente(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: { assetId?: string } }>('/api/projects/:id/decupagem', async (req) => {
    requireBrain();
    const { id } = req.params;
    const p = store.get(id);
    const assetId = req.body?.assetId;
    if (!p.assets.some((a) => a.transcript && (!assetId || a.id === assetId))) throw erro('nenhum material transcrito ainda', 409);
    // Sem assetId: decupa todas as brutas (falas transcritas), na ordem em que chegaram.
    void enqueueJob(id, 'decupagem', assetId ? { assetId } : {}).catch((e) => report(id, 'decupagem', e));
    return { queued: true, posicao: queuePosition(id) };
  });

  app.post<{ Params: { id: string }; Body: { text: string; playhead?: number } }>('/api/projects/:id/command', async (req) => {
    requireBrain();
    const { id } = req.params;
    const text = req.body.text?.trim();
    if (!text) throw erro('comando vazio');
    void enqueue(id, 'executando pedido', () => runCommand(id, text, req.body.playhead)).catch((e) => report(id, 'pedido', e));
    return { queued: true, busy: isBusy(id) ?? null };
  });

  // --- Esticar motion e B-roll até o fim do corte (regra do Thales) ---------------------------------
  app.post<{ Params: { id: string } }>('/api/projects/:id/ate-o-corte', async (req) => {
    const { id } = req.params;
    const p = store.get(id);
    const tl = p.timeline;
    const assets = new Map(p.assets.map((a) => [a.id, a]));
    let ajustados = 0;
    const curtos: string[] = [];
    await store.transaction(id, 'Motion e B-roll até o corte', async () => {
      for (const o of tl.overlays) {
        if (o.role !== 'motion' && o.role !== 'broll') continue;
        const pos = resolveOverlay(tl, o);
        if (!pos) continue;
        const cutEnd = cutEndAfter(tl, pos.end - 0.05);
        const want = cutEnd - pos.start;
        if (Math.abs(want - o.duration) <= 1.5 / (tl.fps || 30)) continue;
        let dur = want;
        if (o.source.type === 'media') {
          const a = assets.get(o.source.assetId);
          const max = (a?.duration ?? want) - (o.source.in ?? 0);
          if (max < want - 0.05) {
            curtos.push(`${o.role} em ${pos.start.toFixed(1)} s (render de ${max.toFixed(1)} s, corte pede ${want.toFixed(1)} s)`);
            dur = max;
          }
        }
        store.apply(id, { by: 'agent', op: { type: 'trim_overlay', id: o.id, duration: dur }, note: `${o.role === 'motion' ? 'Motion' : 'B-roll'} até o fim do corte (${dur.toFixed(2)} s)` });
        ajustados++;
      }
    });
    store.log(id, 'agent', `${ajustados} camada(s) esticada(s) até o corte${curtos.length ? ` · precisa re-render: ${curtos.join('; ')}` : ''}.`);
    return { ajustados, curtos };
  });

  // --- B-roll automático (Cinéfilo) ------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: { cobertura?: number } }>('/api/projects/:id/broll-auto', async (req) => {
    const { id } = req.params;
    const r = await enqueue(id, 'procurando B-roll (Cinéfilo)', () => autoBroll(id, { cobertura: req.body?.cobertura }));
    store.log(id, 'agent', r.colocados ? `B-roll: ${r.colocados} cena(s) de filme cobrindo ${Math.round(r.cobertura * 100)}% da peça (${r.filmes.join(', ')}).` : `B-roll: ${r.motivo ?? 'nenhuma cena encontrada para as falas.'}`);
    return r;
  });

  // --- Trilha, multicâmera e reframe -----------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/projects/:id/music-auto', async (req) => {
    const { id } = req.params;
    const r = await enqueue(id, 'escolhendo a trilha', () => musicAuto(id));
    return r ? { track: r.track.name, bpmAlvo: r.bpmAlvo } : { track: null, bpmAlvo: 0 };
  });
  // Body opcional: { fala: <assetId da fala de referência> } e/ou { offset: <s> } manual (CH-0035).
  app.post<{ Params: { id: string; assetId: string }; Body: { fala?: string; offset?: number } }>('/api/projects/:id/assets/:assetId/sync-cam', async (req) => syncCamera(req.params.id, req.params.assetId, { fala: req.body?.fala, offset: req.body?.offset }));
  app.post<{ Params: { id: string } }>('/api/projects/:id/multicam-auto', async (req) => ({ trocas: await autoMulticam(req.params.id) }));
  app.post<{ Params: { id: string } }>('/api/projects/:id/reframe-auto', async (req) => autoReframe(req.params.id));

  /** Cor automática: detecta o LOG da câmera e acerta exposição/balanço de branco medindo o original. */
  app.post<{ Params: { id: string; assetId: string } }>('/api/projects/:id/assets/:assetId/color-auto', async (req) => {
    const { id, assetId } = req.params;
    const a = store.get(id).assets.find((x) => x.id === assetId);
    if (!a || a.kind !== 'video') throw erro('escolha um vídeo');
    store.setActivity(id, { state: 'analyzing', message: `Medindo a cor de ${a.name}` });
    const { grade, why } = await autoGrade(a);
    store.apply(id, { by: 'agent', op: { type: 'set_grade', assetId, grade }, note: `Cor automática: ${why}` });
    store.setActivity(id, { state: 'celebrating', message: 'Cor corrigida para Rec.709' });
    setTimeout(() => store.setActivity(id, { state: 'idle', message: 'Pronto' }), 2000);
    return { grade, why };
  });

  // --- Ritmo (quebra de padrão) e rosto (Vision local) --------------------------------------------------
  app.post<{ Params: { id: string }; Body: { max?: number } }>('/api/projects/:id/zooms-auto', async (req) => {
    const { id } = req.params;
    const n = await enqueue(id, 'colocando cut zooms', () => autoZooms(id, { max: req.body?.max }));
    store.log(id, 'agent', n ? `Quebras de padrão: ${n} cut zoom(s) nas ênfases dos trechos parados.` : 'Quebras de padrão: a peça já não tem trecho parado (ou o perfil não pede mais zooms).');
    return { zooms: n, monotonos: monotonous(store.get(id), 6).length };
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/flashes-auto', async (req) => {
    const { id } = req.params;
    const n = await enqueue(id, 'colocando flashes', () => autoFlashes(id));
    store.log(id, 'agent', n ? `${n} flash(es) em cima de cortes que a emenda denunciaria.` : 'Flashes: nada a acrescentar (o perfil não usa flash, ou os cortes não pedem).');
    return { flashes: n };
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/faces', async (req) => {
    const p = store.get(req.params.id);
    const fala = p.assets.find((a) => a.role === 'fala' && a.kind === 'video');
    if (!fala) return { disponivel: await visionAvailable(), rosto: null };
    const f = await facesOf(p, fala);
    return { disponivel: await visionAvailable(), rosto: f ? faceSummary(f) : null, legendaSegura: await safeTextY(p, p.timeline.captions?.position ?? 0.72) };
  });
}
