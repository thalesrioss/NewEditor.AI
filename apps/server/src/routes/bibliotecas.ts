/** Bibliotecas do ofício: perfis de edição por cliente (e o padrão editorial lido de uma edição), presets de legenda e trilhas. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ClientProfile, FormatoPeca } from '@neweditor/core';
import { DATA_DIR } from '../config.ts';
import { enqueue } from '../jobs.ts';
import { analyzeLibraryInBackground, listMusic, musicFileAllowed, useAsTrilha } from '../music.ts';
import { apagarStill, lerPadraoCor, perfilDoProjetoParaCor, salvarPadraoCor, stillFile } from '../padrao-cor.ts';
import { createProfile, importPadroes, listProfiles, patchProfile, profileFromProject, saveProfileFromProject, setHouse } from '../profiles.ts';
import { store } from '../store.ts';
import { erro, report } from './_comum.ts';

const STILL_TYPE: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export async function rotasBibliotecas(app: FastifyInstance): Promise<void> {
  // --- Perfis de edição por cliente (Cérebro do Editor → dado) -------------------------------------
  app.get('/api/perfis', async () => listProfiles());
  app.post('/api/perfis/import', async () => importPadroes());
  app.post<{ Body: { nome: string; baseId?: string } }>('/api/perfis', async (req) => createProfile(req.body.nome?.trim() || 'Cliente', req.body.baseId));
  app.patch<{ Params: { id: string }; Body: Partial<ClientProfile> }>('/api/perfis/:id', async (req) => patchProfile(req.params.id, req.body));
  app.post<{ Params: { id: string } }>('/api/perfis/:id/padrao-casa', async (req) => setHouse(req.params.id));
  // Padrão de cor do cliente (BL-0161): grade + até 3 stills. Pelo perfil, ou pelo perfil do projeto (aba Cor).
  type PadraoCorBody = { grade?: unknown; stills?: unknown };
  app.get<{ Params: { id: string } }>('/api/perfis/:id/padrao-cor', async (req) => ({ padrao: await lerPadraoCor(req.params.id) }));
  app.post<{ Params: { id: string }; Body: PadraoCorBody }>('/api/perfis/:id/padrao-cor', async (req) => ({ padrao: await salvarPadraoCor(req.params.id, req.body ?? {}) }));
  app.get<{ Params: { id: string; nome: string } }>('/api/perfis/:id/padrao-cor/stills/:nome', async (req, reply) => {
    const file = await stillFile(req.params.id, req.params.nome);
    return reply.type(STILL_TYPE[path.extname(file)] ?? 'application/octet-stream').send(fs.createReadStream(file));
  });
  app.delete<{ Params: { id: string; nome: string } }>('/api/perfis/:id/padrao-cor/stills/:nome', async (req) => ({ padrao: await apagarStill(req.params.id, req.params.nome) }));
  app.get<{ Params: { id: string } }>('/api/projects/:id/padrao-cor', async (req) => {
    const prof = await perfilDoProjetoParaCor(store.get(req.params.id));
    return { perfil: prof.id, nome: prof.nome, padrao: prof.cor.padrao ?? null };
  });
  app.post<{ Params: { id: string }; Body: PadraoCorBody }>('/api/projects/:id/padrao-cor', async (req) => {
    const p = store.get(req.params.id);
    const prof = await perfilDoProjetoParaCor(p);
    const padrao = await salvarPadraoCor(prof.id, req.body ?? {}, p);
    store.log(p.id, 'human', `Salvou a cor como padrão de ${prof.nome}${padrao.stills.length ? ` (${padrao.stills.length} still(s) de referência)` : ''}: projeto novo do cliente nasce com ela nos clipes da fala.`);
    return { perfil: prof.id, nome: prof.nome, padrao };
  });
  // Padrão editorial a partir da edição de um projeto: prévia (GET) e gravar como perfil do cliente para um formato (POST).
  app.get<{ Params: { id: string }; Querystring: { cliente?: string; formato?: FormatoPeca; nome?: string } }>('/api/projects/:id/perfil-da-edicao', async (req) => profileFromProject(store.get(req.params.id), req.query));
  app.post<{ Params: { id: string }; Body: { cliente?: string; formato?: FormatoPeca; nome?: string; aplicar?: boolean } }>('/api/projects/:id/perfil-da-edicao', async (req) => {
    const p = store.get(req.params.id);
    const perfil = await saveProfileFromProject(p, req.body);
    if (req.body.aplicar !== false) store.update(p.id, { profileId: perfil.id });
    store.log(p.id, 'human', `Esta edição virou o padrão editorial "${perfil.nome}"${req.body.aplicar !== false ? ' (aplicado ao projeto)' : ''}.`);
    return perfil;
  });

  // --- Presets de legenda (só legenda; data/presets-legenda.json) ----------------------------------
  const PRESETS_LEGENDA = path.join(path.dirname(DATA_DIR), 'presets-legenda.json');
  async function readPresets(): Promise<{ nome: string; legenda: Record<string, unknown> }[]> {
    try {
      return JSON.parse(await fsp.readFile(PRESETS_LEGENDA, 'utf8'));
    } catch {
      return [];
    }
  }
  app.get('/api/presets/legenda', async () => readPresets());
  app.put<{ Body: { nome: string; legenda: Record<string, unknown> } }>('/api/presets/legenda', async (req) => {
    const nome = req.body?.nome?.trim();
    if (!nome || !req.body.legenda) throw erro('nome e legenda obrigatórios');
    const { enabled: _e, ...legenda } = req.body.legenda as Record<string, unknown> & { enabled?: boolean };
    const list = (await readPresets()).filter((p) => p.nome !== nome);
    list.push({ nome, legenda });
    await fsp.writeFile(PRESETS_LEGENDA, JSON.stringify(list, null, 2));
    return list;
  });
  app.delete<{ Params: { nome: string } }>('/api/presets/legenda/:nome', async (req) => {
    const list = (await readPresets()).filter((p) => p.nome !== decodeURIComponent(req.params.nome));
    await fsp.writeFile(PRESETS_LEGENDA, JSON.stringify(list, null, 2));
    return list;
  });

  // --- Trilhas (biblioteca local) ---------------------------------------------------------------------
  app.get('/api/library/music', async () => {
    analyzeLibraryInBackground();
    return listMusic();
  });
  /** Ouvir uma faixa da biblioteca antes de usar (só arquivos de dentro das pastas da biblioteca). */
  app.get<{ Querystring: { path: string } }>('/api/library/music/audio', async (req, reply) => {
    const file = req.query.path;
    if (!file || !musicFileAllowed(file)) throw erro('arquivo fora da biblioteca de trilhas', 403);
    const type = /\.m4a$|\.aac$/i.test(file) ? 'audio/mp4' : /\.wav$/i.test(file) ? 'audio/wav' : 'audio/mpeg';
    return reply.type(type).send(fs.createReadStream(file));
  });
  app.post<{ Params: { id: string }; Body: { path: string } }>('/api/projects/:id/music', async (req) => {
    const { id } = req.params;
    const file = req.body.path;
    if (!file || !musicFileAllowed(file)) throw erro('arquivo fora da biblioteca de trilhas', 403);
    void enqueue(id, 'trilha', () => useAsTrilha(id, file)).catch((e) => report(id, 'trilha', e));
    return { queued: true };
  });
}
