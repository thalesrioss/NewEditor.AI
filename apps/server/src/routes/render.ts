/** Render e entrega: o trabalho de render da fila (com QC do arquivo), presets de entrega e a entrega em si. */
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { entregar, ENTREGAS_DIR, PRESETS, type EntregaOpts } from '../entrega.ts';
import { stepEnd, stepStart } from '../estimate.ts';
import { enqueueJob, queuePosition } from '../jobs.ts';
import type { ColorGrade } from '@neweditor/core';
import { runRenderQc } from '../qc.ts';
import { renderQuadro } from '../quadro.ts';
import { render } from '../render.ts';
import { store } from '../store.ts';
import { report } from './_comum.ts';

/** O render como trabalho nomeado da fila (sobrevive a reinício). */
export async function renderJob(id: string): Promise<void> {
  store.setActivity(id, { state: 'analyzing', message: 'Renderizando', progress: 0 });
  stepStart(id, 'render');
  const res = await render(store.get(id), store.dir(id), (pct) => store.setActivity(id, { state: 'analyzing', message: 'Renderizando', progress: pct }));
  stepEnd(id, 'render');
  const qc = await runRenderQc(id, path.join(store.dir(id), res.file)).catch(() => null);
  if (qc?.render) store.log(id, 'agent', `QC do render: ${qc.render.lufs?.toFixed(1) ?? '?'} LUFS · pico ${qc.render.truePeak?.toFixed(1) ?? '?'} dBTP${qc.render.blackFrames ? ` · ${qc.render.blackFrames} quadro(s) preto(s)` : ''}${qc.issues.length ? ` · ${qc.issues.length} ponto(s) para conferir` : ' · ok'}`);
  store.log(id, 'agent', `Render pronto: ${res.file}${res.notes.length ? ` · ${res.notes.join(' · ')}` : ''}${res.skipped.length ? ` (fora do export por enquanto: ${res.skipped.join('; ')})` : ''}`);
  store.broadcast(id, { type: 'log', entry: { id: `render_${Date.now()}`, at: new Date().toISOString(), by: 'system', text: `/media/${id}/${res.file}` } });
  store.setActivity(id, { state: 'celebrating', message: 'Render pronto!' });
  setTimeout(() => store.setActivity(id, { state: 'idle', message: 'Pronto' }), 2400);
}

/** A entrega como trabalho da fila: render no preset + SRT + capa (+ pasta de entrega). */
export async function entregaJob(id: string, opts: EntregaOpts): Promise<void> {
  store.setActivity(id, { state: 'analyzing', message: 'Entregando', progress: 0 });
  const r = await entregar(id, opts, (pct) => store.setActivity(id, { state: 'analyzing', message: 'Entregando', progress: pct }));
  store.broadcast(id, { type: 'log', entry: { id: `render_${Date.now()}`, at: new Date().toISOString(), by: 'system', text: `/media/${id}/${store.get(id).versions?.at(-1)?.render ?? ''}` } });
  store.setActivity(id, { state: 'celebrating', message: r.qcBloqueios.length ? `Entrega pronta, com ${r.qcBloqueios.length} ponto(s) do QC` : 'Entrega pronta!' });
}

export async function rotasRender(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/api/projects/:id/render', async (req) => {
    const { id } = req.params;
    void enqueueJob(id, 'render').catch((e) => report(id, 'render', e));
    return { queued: true, posicao: queuePosition(id) };
  });
  // Quadro de conferência (CH-0018): 1 quadro pelo caminho do render, com grade de teste opcional, sem render completo.
  // camadas: true põe por cima o B-roll e o motion de arquivo daquele quadro (CH-0028).
  app.post<{ Params: { id: string }; Body: { t: number; grades?: Record<string, Partial<ColorGrade>>; camadas?: boolean } }>('/api/projects/:id/quadro', async (req) => {
    const { id } = req.params;
    const r = await renderQuadro(store.get(id), store.dir(id), Number(req.body?.t), req.body?.grades, req.body?.camadas === true);
    return { ...r, url: `/media/${id}/${r.file}` };
  });
  app.get('/api/entrega/presets', async () => ({ presets: Object.entries(PRESETS).map(([id, p]) => ({ id, ...p })), pasta: ENTREGAS_DIR }));
  app.post<{ Params: { id: string }; Body: EntregaOpts }>('/api/projects/:id/entregar', async (req) => {
    const { id } = req.params;
    const opts: EntregaOpts = { preset: req.body.preset ?? 'original', srt: req.body.srt ?? true, capa: req.body.capa ?? true, capaEm: req.body.capaEm, entregar: req.body.entregar ?? false };
    void enqueueJob(id, 'render', { entrega: opts }).catch((e) => report(id, 'entrega', e));
    return { queued: true, posicao: queuePosition(id) };
  });
}
