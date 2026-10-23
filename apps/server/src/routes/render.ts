/** Render e entrega: o trabalho de render da fila (com QC do arquivo), presets de entrega e a entrega em si. */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { entregar, ENTREGAS_DIR, PRESETS, type EntregaOpts } from '../entrega.ts';
import { stepEnd, stepStart } from '../estimate.ts';
import { enqueueJob, queuePosition, queueState } from '../jobs.ts';
import type { ColorGrade } from '@neweditor/core';
import { runRenderQc } from '../qc.ts';
import { renderQuadro } from '../quadro.ts';
import { render } from '../render.ts';
import { store } from '../store.ts';
import { apiErrorMessage } from '../llm.ts';
import { report } from './_comum.ts';

/**
 * Status de cada render pedido pela API (BL-0103): quem renderiza pela API (a NewStudios) acompanha pelo id do
 * trabalho em vez de olhar o MP4 parar de crescer. Em memória; um render retomado depois de reiniciar o servidor
 * aparece como `fila` (pela fila gravada) até rodar.
 */
export type RenderEstado =
  | { estado: 'fila'; posicao?: number }
  | { estado: 'rodando'; pct: number }
  | { estado: 'pronto'; file: string; caminho: string; url: string; bytes: number; lufs?: number; truePeak?: number; loudnessOk?: boolean }
  | { estado: 'erro'; mensagem: string };
type RenderStatus = RenderEstado & { projectId: string; at: string };
const statusRender = new Map<string, RenderStatus>();
const MAX_STATUS = 200;

function setStatus(job: string | undefined, projectId: string, s: RenderEstado): void {
  if (!job) return;
  statusRender.delete(job); // reinsere no fim: a ordem do Map é a idade
  statusRender.set(job, { ...s, projectId, at: new Date().toISOString() });
  for (const [k, v] of statusRender) {
    if (statusRender.size <= MAX_STATUS) break;
    if (v.estado === 'pronto' || v.estado === 'erro') statusRender.delete(k);
  }
}

/** Estado de um render pela API; `undefined` = trabalho que não existe (ou de outro projeto). */
export function renderStatus(projectId: string, job: string): (RenderEstado & { job: string; at?: string }) | undefined {
  const fila = queueState();
  const naFila = fila.queue.findIndex((j) => j.id === job && j.projectId === projectId);
  const s = statusRender.get(job);
  if (s && s.projectId === projectId) {
    const { projectId: _p, ...rest } = s;
    return rest.estado === 'fila' ? { ...rest, job, posicao: naFila >= 0 ? naFila + 1 : rest.posicao } : { ...rest, job };
  }
  if (naFila >= 0) return { job, estado: 'fila', posicao: naFila + 1 };
  if (fila.running?.id === job && fila.running.projectId === projectId) return { job, estado: 'rodando', pct: 0 };
  return undefined;
}

function mensagemDe(e: unknown): string {
  return apiErrorMessage(e) ?? (e instanceof Error ? e.message : String(e));
}

/** O render como trabalho nomeado da fila (sobrevive a reinício). */
export async function renderJob(id: string, job?: string): Promise<void> {
  try {
    await renderJobSemStatus(id, job);
  } catch (e) {
    // Também no render retomado depois de reiniciar (quem trata o erro aí é o resumeJobs).
    setStatus(job, id, { estado: 'erro', mensagem: mensagemDe(e) });
    throw e;
  }
}

async function renderJobSemStatus(id: string, job?: string): Promise<void> {
  store.setActivity(id, { state: 'analyzing', message: 'Renderizando', progress: 0 });
  setStatus(job, id, { estado: 'rodando', pct: 0 });
  stepStart(id, 'render');
  const res = await render(store.get(id), store.dir(id), (pct) => {
    store.setActivity(id, { state: 'analyzing', message: 'Renderizando', progress: pct });
    setStatus(job, id, { estado: 'rodando', pct: Math.round(pct * 100) });
  });
  stepEnd(id, 'render');
  const caminho = path.join(store.dir(id), res.file);
  const qc = await runRenderQc(id, caminho).catch(() => null);
  if (qc?.render) store.log(id, 'agent', `QC do render: ${qc.render.lufs?.toFixed(1) ?? '?'} LUFS · pico ${qc.render.truePeak?.toFixed(1) ?? '?'} dBTP${qc.render.blackFrames ? ` · ${qc.render.blackFrames} quadro(s) preto(s)` : ''}${qc.issues.length ? ` · ${qc.issues.length} ponto(s) para conferir` : ' · ok'}`);
  store.log(id, 'agent', `Render pronto: ${res.file}${res.notes.length ? ` · ${res.notes.join(' · ')}` : ''}${res.skipped.length ? ` (fora do export por enquanto: ${res.skipped.join('; ')})` : ''}`);
  store.broadcast(id, { type: 'log', entry: { id: `render_${Date.now()}`, at: new Date().toISOString(), by: 'system', text: `/media/${id}/${res.file}` } });
  const bytes = (await fs.stat(caminho)).size;
  setStatus(job, id, { estado: 'pronto', file: res.file, caminho, url: `/media/${id}/${res.file}`, bytes, lufs: res.loudness?.lufs ?? qc?.render?.lufs, truePeak: res.loudness?.truePeak ?? qc?.render?.truePeak, loudnessOk: res.loudness?.ok });
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
    const job = `rnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setStatus(job, id, { estado: 'fila' });
    void enqueueJob(id, 'render', {}, { id: job }).catch((e) => {
      setStatus(job, id, { estado: 'erro', mensagem: mensagemDe(e) });
      report(id, 'render', e);
    });
    return { job, queued: true, posicao: queuePosition(id) };
  });
  app.get<{ Params: { id: string; job: string } }>('/api/projects/:id/render/:job', async (req, reply) => {
    const s = renderStatus(req.params.id, req.params.job);
    if (!s) return reply.code(404).send({ error: 'render não encontrado neste projeto' });
    return s;
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
