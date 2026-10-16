/** Motion e texto: referências de motion, Motion Studio Brain (ordens → render com alfa → importar), motions narrativos e lettering. */
import type { FastifyInstance } from 'fastify';
import { autoMotions, readStory, useReference } from '../agent-motion.ts';
import { autoLettering, useLetteringRef } from '../agent-text.ts';
import { enqueue } from '../jobs.ts';
import type { LetteringAmount } from '../lettering.ts';
import { addFrame, CATEGORIAS, createRef, FAMILIAS, fetchLinkMeta, importFromBrain, importLetteringModels, LETTERING_SOURCE, listRefs, patchRef, trashRef, type NewRef, type RefPatch } from '../motion/refs.ts';
import { exportOrdens, importRenders, studioStatus } from '../motion-studio.ts';
import { report } from './_comum.ts';

export async function rotasMotion(app: FastifyInstance): Promise<void> {
  // --- Referências de motion (biblioteca) ----------------------------------------------------------
  app.get('/api/motion/refs', async () => ({ refs: await listRefs(), categorias: CATEGORIAS, familias: FAMILIAS }));
  app.post<{ Body: { link: string } }>('/api/motion/refs/preview', async (req) => fetchLinkMeta(req.body.link ?? ''));
  app.post<{ Body: NewRef }>('/api/motion/refs', async (req) => createRef(req.body));
  app.post('/api/motion/refs/import', async () => importFromBrain());
  app.patch<{ Params: { ref: string }; Body: RefPatch }>('/api/motion/refs/:ref', async (req) => patchRef(req.params.ref, req.body));
  app.post<{ Params: { ref: string }; Body: { image: string; legenda?: string } }>('/api/motion/refs/:ref/frames', async (req) => addFrame(req.params.ref, req.body.image, req.body.legenda));
  app.delete<{ Params: { ref: string } }>('/api/motion/refs/:ref', async (req) => {
    await trashRef(req.params.ref);
    return { ok: true };
  });

  // --- Motions narrativos no projeto --------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/projects/:id/story', async (req) => readStory(req.params.id));
  app.post<{ Params: { id: string }; Body: { refId: string } }>('/api/projects/:id/motion-ref', async (req) => ({ restyled: await useReference(req.params.id, req.body.refId) }));
  app.post<{ Params: { id: string }; Body: { refId?: string } }>('/api/projects/:id/motions-auto', async (req) => {
    const { id } = req.params;
    const refId = req.body?.refId;
    void enqueue(id, 'motions', () => autoMotions(id, { refId })).catch((e) => report(id, 'motions narrativos', e));
    return { queued: true };
  });

  // --- Motion Studio Brain (ordens de cena → render com alfa → importar) ----------------------------
  app.get<{ Params: { id: string } }>('/api/projects/:id/motion-studio', async (req) => studioStatus(req.params.id));
  app.post<{ Params: { id: string } }>('/api/projects/:id/motion-studio/ordens', async (req) => enqueue(req.params.id, 'escrevendo ordens de motion', () => exportOrdens(req.params.id)));
  app.post<{ Params: { id: string } }>('/api/projects/:id/motion-studio/importar', async (req) => enqueue(req.params.id, 'importando motions do Studio', () => importRenders(req.params.id)));

  // --- Lettering ------------------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: { quantidade?: LetteringAmount } }>('/api/projects/:id/lettering-auto', async (req) => {
    const { id } = req.params;
    const amount = req.body?.quantidade;
    void enqueue(id, 'lettering', () => autoLettering(id, amount)).catch((e) => report(id, 'lettering automático', e));
    return { queued: true };
  });
  app.post<{ Params: { id: string }; Body: { refId: string } }>('/api/projects/:id/lettering-ref', async (req) => ({ restyled: await useLetteringRef(req.params.id, req.body.refId) }));
  // Importação dos modelos de lettering (Legendas Master): roda em segundo plano, o painel acompanha.
  let ltImport: { running: boolean; done: number; total: number; result?: unknown; error?: string } = { running: false, done: 0, total: 0 };
  app.get('/api/lettering/refs/import', async () => ({ ...ltImport, origem: LETTERING_SOURCE }));
  app.post<{ Body: { path?: string } }>('/api/lettering/refs/import', async (req) => {
    if (ltImport.running) return ltImport;
    ltImport = { running: true, done: 0, total: 0 };
    void importLetteringModels(req.body?.path?.trim() || LETTERING_SOURCE, (done, total) => Object.assign(ltImport, { done, total }))
      .then((result) => Object.assign(ltImport, { running: false, result }))
      .catch((e: Error) => Object.assign(ltImport, { running: false, error: e.message }));
    return ltImport;
  });
}
