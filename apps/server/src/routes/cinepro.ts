/** CinePRO (nuvem do CinePRO: som, visual, looks) e Cinéfilo.AI (B-roll de filme pelo clip.cafe). */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { SFX_CONCEPTS, type SfxKind } from '@neweditor/core';
import { beatsForBroll, searchCafe, useCafeClip, type CafeClip } from '../cinefilo.ts';
import { cineproCatalogo, cineproFile, cineproItens, cineproPick, cineproResumo, cineproThumb, cineproUsar, mime as cineproMime, type CineproModo } from '../cinepro.ts';

export async function rotasCinepro(app: FastifyInstance): Promise<void> {
  // CinePRO dentro do Editor Brain, pela nuvem do CinePRO: catálogo por aba (som / visual / looks), prévia, arquivo e inserção no cursor.
  app.get<{ Querystring: { modo?: CineproModo } }>('/api/cinepro', async (req) => cineproResumo(req.query.modo ?? 'som'));
  app.post('/api/cinepro/reindexar', async () => {
    const c = await cineproCatalogo(true);
    return { total: c.itens.length, builtAt: c.builtAt };
  });
  app.get<{ Querystring: { modo?: CineproModo; pasta?: string; tipo?: string; busca?: string; offset?: string; limit?: string } }>('/api/cinepro/itens', async (req) => cineproItens({ modo: req.query.modo, pasta: req.query.pasta, tipo: req.query.tipo, busca: req.query.busca, offset: Number(req.query.offset) || 0, limit: Number(req.query.limit) || 120 }));
  app.get<{ Params: { id: string } }>('/api/cinepro/thumb/:id', async (req, reply) => {
    const t = await cineproThumb(req.params.id);
    if (!t) return reply.code(404).send({ message: 'sem miniatura' });
    return reply.type(t.type).header('cache-control', 'max-age=86400').send(fs.createReadStream(t.file));
  });
  // Arquivo (baixado da nuvem para o cache permanente) com Range, para o <audio>/<video> buscar.
  app.get<{ Params: { id: string } }>('/api/cinepro/arquivo/:id', async (req, reply) => {
    const { file } = await cineproFile(req.params.id);
    const size = (await fsp.stat(file)).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      return reply.code(206).headers({ 'content-type': cineproMime(file), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1) }).send(fs.createReadStream(file, { start, end }));
    }
    return reply.headers({ 'content-type': cineproMime(file), 'accept-ranges': 'bytes', 'content-length': String(size) }).send(fs.createReadStream(file));
  });
  // Um look (.cube) do CinePRO, em texto: o preview lê e monta a mesma LUT do export.
  app.get<{ Params: { id: string } }>('/api/cinepro/lut/:id', async (req, reply) => {
    const { file } = await cineproFile(req.params.id);
    return reply.type('text/plain').header('cache-control', 'max-age=86400').send(fs.createReadStream(file));
  });
  app.get<{ Querystring: { kind: string; seed?: string } }>('/api/cinepro/pick', async (req, reply) => {
    const it = SFX_CONCEPTS[req.query.kind as SfxKind] ? await cineproPick(req.query.kind as SfxKind, Number(req.query.seed) || 0) : null;
    return it ?? reply.code(404).send({ message: 'sem amostra para esse efeito' });
  });
  app.post<{ Params: { id: string }; Body: { itemId: string; at: number } }>('/api/projects/:id/cinepro/usar', async (req) => cineproUsar(req.params.id, req.body.itemId, Number(req.body.at) || 0));

  // --- Cinéfilo.AI: B-roll de filme (clip.cafe) ---------------------------------------------------------
  app.get<{ Querystring: { q: string } }>('/api/cinefilo/search', async (req) => ({ clips: await searchCafe(req.query.q ?? '') }));
  app.get<{ Params: { id: string } }>('/api/projects/:id/cinefilo/beats', async (req) => ({ beats: await beatsForBroll(req.params.id) }));
  app.post<{ Params: { id: string }; Body: { clip: CafeClip } }>('/api/projects/:id/cinefilo/use', async (req) => useCafeClip(req.params.id, req.body.clip));
}
