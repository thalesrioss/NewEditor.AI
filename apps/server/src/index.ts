import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { cutEndAfter, OpError, resolveOverlay, type ClientMessage, type ProjectStatus } from '@neweditor/core';
import { runCommand } from './agent.ts';
import { autoLettering, useLetteringRef } from './agent-text.ts';
import { approveDecupagem, finalize } from './finalize.ts';
import { listNotifications, markRead } from './notify.ts';
import { reviewDoubts } from './review.ts';
import type { LetteringAmount } from './lettering.ts';
import { autoMotions, readStory, useReference } from './agent-motion.ts';
import { addFrame, CATEGORIAS, createRef, FAMILIAS, fetchLinkMeta, importFromBrain, importLetteringModels, LETTERING_SOURCE, listRefs, patchRef, REFS_DIR, trashRef, type NewRef, type RefPatch } from './motion/refs.ts';
import { listMusic, musicFileAllowed, useAsTrilha } from './music.ts';
import { autoGrade } from './color.ts';
import { BRAIN, DATA_DIR, PORT, ROOT } from './config.ts';
import { runDecupagem } from './decupagem/run.ts';
import { backfill, ingest, rebuild, setRole } from './ingest.ts';
import { cutWords, restoreWords } from './transcript-edit.ts';
import { cancelJob, cancelJobsFor, enqueue, enqueueJob, isBusy, queuePosition, queueState, registerJob, resumeJobs } from './jobs.ts';
import { createFromTask, parseTask } from './gestor.ts';
import { beatsForBroll, searchCafe, useCafeClip, type CafeClip } from './cinefilo.ts';
import { llmSettings, modelDownloaded, setLlmSettings, type LlmSettings } from './llm-local.ts';
import { listGabaritos } from './benchmark.ts';
import { addComment, diffTimelines, patchComment, removeComment, runAlteracoes } from './alteracoes.ts';
import { entregar, ENTREGAS_DIR, PRESETS, type EntregaOpts } from './entrega.ts';
import { autoFlashes, autoZooms, monotonous } from './ritmo.ts';
import { cerebroGraph, cerebroNote } from './cerebro.ts';
import { exportOrdens, importRenders, studioStatus } from './motion-studio.ts';
import { autoBroll } from './broll.ts';
import { autoMulticam, syncCamera } from './multicam.ts';
import { autoReframe } from './reframe.ts';
import { analyzeLibraryInBackground, musicAuto } from './music.ts';
import { facesOf, faceSummary, safeTextY, visionAvailable } from './vision.ts';
import { apiErrorMessage, hasCredentials, RefusalError } from './llm.ts';
import { render } from './render.ts';
import { syncVoiceClean } from './denoise.ts';
import { saveGabarito } from './benchmark.ts';
import { estimateRemaining, stepEnd, stepStart } from './estimate.ts';
import { createProfile, importPadroes, listProfiles, patchProfile, profileFromProject, saveProfileFromProject, setHouse } from './profiles.ts';
import { runQc, runRenderQc } from './qc.ts';
import { cineproCatalogo, cineproFile, cineproItens, cineproPick, cineproResumo, cineproThumb, cineproUsar, mime as cineproMime, type CineproModo } from './cinepro.ts';
import { SFX_CONCEPTS, type ClientProfile, type FormatoPeca, type SfxKind } from '@neweditor/core';
import { store } from './store.ts';

await store.load();

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 10 * 1024 * 1024 });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 * 1024 } });
await app.register(websocket);
// Mídia do projeto (proxies, envelopes, renders) com suporte a Range — o player faz seek direto.
await app.register(fastifyStatic, { root: DATA_DIR, prefix: '/media/', decorateReply: false, cacheControl: false });
// Biblioteca de referências de motion (capas e quadros).
await fsp.mkdir(REFS_DIR, { recursive: true });
await app.register(fastifyStatic, { root: REFS_DIR, prefix: '/refs/', decorateReply: false });
const webDist = process.env.NEWEDITOR_WEB_DIST ?? path.join(ROOT, 'apps', 'web', 'dist');
if (fs.existsSync(webDist)) await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: false });

/** Erros do agente viram mensagem legível no log em vez de sumir. */
function report(projectId: string, what: string, e: unknown): void {
  let msg = e instanceof Error ? e.message : String(e);
  if (e instanceof RefusalError) msg = 'o modelo recusou este pedido';
  else msg = apiErrorMessage(e) ?? msg;
  console.error(`[${projectId}] ${what}:`, e);
  store.log(projectId, 'system', `Falha em ${what}: ${msg}`);
  store.setActivity(projectId, { state: 'idle', message: `Falhou: ${what}` });
}

/** Só o cérebro Claude precisa de chave; o local roda sempre. */
function requireBrain(): void {
  if (BRAIN === 'claude' && !hasCredentials()) throw Object.assign(new Error('NEWEDITOR_BRAIN=claude, mas falta ANTHROPIC_API_KEY no .env'), { statusCode: 412 });
}

app.get('/api/health', async () => ({ ok: true, brain: BRAIN, ready: BRAIN === 'local' || hasCredentials() }));

/** Lista para o Kanban: na coluna de revisão, cada card leva quantos pontos faltam conferir. */
const pendingCache = new Map<string, { version: number; n: number }>();
app.get('/api/projects', async () =>
  Promise.all(
    store.list().map(async (p) => {
      const estimativa = estimateRemaining(p).totalSeconds;
      if (p.status !== 'revisao') return { ...p, estimativa };
      let c = pendingCache.get(p.id);
      if (!c || c.version !== p.version) {
        c = { version: p.version, n: (await reviewDoubts(p).catch(() => [])).filter((d) => d.prioridade === 'alta').length };
        pendingCache.set(p.id, c);
      }
      return { ...p, pendentes: c.n, estimativa };
    }),
  ),
);

// --- Perfis de edição por cliente (Cérebro do Editor → dado) -------------------------------------
app.get('/api/perfis', async () => listProfiles());
app.post('/api/perfis/import', async () => importPadroes());
app.post<{ Body: { nome: string; baseId?: string } }>('/api/perfis', async (req) => createProfile(req.body.nome?.trim() || 'Cliente', req.body.baseId));
app.patch<{ Params: { id: string }; Body: Partial<ClientProfile> }>('/api/perfis/:id', async (req) => patchProfile(req.params.id, req.body));
app.post<{ Params: { id: string } }>('/api/perfis/:id/padrao-casa', async (req) => setHouse(req.params.id));
// Padrão editorial a partir da edição de um projeto: prévia (GET) e gravar como perfil do cliente para um formato (POST).
app.get<{ Params: { id: string }; Querystring: { cliente?: string; formato?: FormatoPeca; nome?: string } }>('/api/projects/:id/perfil-da-edicao', async (req) => profileFromProject(store.get(req.params.id), req.query));
app.post<{ Params: { id: string }; Body: { cliente?: string; formato?: FormatoPeca; nome?: string; aplicar?: boolean } }>('/api/projects/:id/perfil-da-edicao', async (req) => {
  const p = store.get(req.params.id);
  const perfil = await saveProfileFromProject(p, req.body);
  if (req.body.aplicar !== false) store.update(p.id, { profileId: perfil.id });
  store.log(p.id, 'human', `Esta edição virou o padrão editorial "${perfil.nome}"${req.body.aplicar !== false ? ' (aplicado ao projeto)' : ''}.`);
  return perfil;
});

// --- Cérebro do Editor como grafo (aba #/cerebro; só leitura do vault) ----------------------------
app.get<{ Querystring: { refresh?: string } }>('/api/cerebro/grafo', async (req) => cerebroGraph(req.query.refresh === '1'));
app.get<{ Querystring: { vault?: string; path?: string } }>('/api/cerebro/nota', async (req) => {
  if (!req.query.path) throw Object.assign(new Error('path obrigatório'), { statusCode: 400 });
  return cerebroNote(req.query.vault ?? 'editor', req.query.path);
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
  if (!nome || !req.body.legenda) throw Object.assign(new Error('nome e legenda obrigatórios'), { statusCode: 400 });
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

// --- Operação avulsa na timeline por HTTP (o mesmo `apply` do WebSocket; útil para scripts e para o ⌘K) ---
app.post<{ Params: { id: string }; Body: { op: Parameters<typeof store.apply>[1]['op']; note?: string; by?: 'human' | 'agent' } }>('/api/projects/:id/op', async (req) => {
  if (!req.body?.op?.type) throw Object.assign(new Error('op obrigatória'), { statusCode: 400 });
  store.apply(req.params.id, { by: req.body.by ?? 'human', op: req.body.op, note: req.body.note });
  return { ok: true };
});

// --- Motion Studio Brain (ordens de cena → render com alfa → importar) ----------------------------
app.get<{ Params: { id: string } }>('/api/projects/:id/motion-studio', async (req) => studioStatus(req.params.id));
app.post<{ Params: { id: string } }>('/api/projects/:id/motion-studio/ordens', async (req) => enqueue(req.params.id, 'escrevendo ordens de motion', () => exportOrdens(req.params.id)));
app.post<{ Params: { id: string } }>('/api/projects/:id/motion-studio/importar', async (req) => enqueue(req.params.id, 'importando motions do Studio', () => importRenders(req.params.id)));

// --- QC e estimativa -------------------------------------------------------------------------------
app.post<{ Params: { id: string } }>('/api/projects/:id/qc', async (req) => runQc(req.params.id));
app.get<{ Params: { id: string } }>('/api/projects/:id/estimativa', async (req) => estimateRemaining(store.get(req.params.id)));

// --- Revisão da decupagem (portão humano) + notificações ----------------------------------------
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
/** Trocar a tomada: volta a descartada e corta a que o agente tinha deixado — um passo de desfazer. */
app.post<{ Params: { id: string }; Body: { doubtId: string } }>('/api/projects/:id/review/swap', async (req) => {
  const p = store.get(req.params.id);
  const d = (await reviewDoubts(p)).find((x) => x.id === req.body.doubtId);
  if (!d?.removalId || !d.swap) throw Object.assign(new Error('não achei a tomada para trocar'), { statusCode: 404 });
  await store.transaction(p.id, 'Trocou a tomada', async () => {
    store.apply(p.id, { by: 'human', op: { type: 'restore', removalId: d.removalId! } });
    store.apply(p.id, { by: 'human', op: { type: 'cut_source', assetId: d.assetId, in: d.swap!.in, out: d.swap!.out, kind: 'retake', reason: 'tomada trocada na revisão' }, note: `Trocou a tomada: ficou "${d.text.slice(0, 50)}…"` });
  });
  return { ok: true };
});
app.post<{ Params: { id: string } }>('/api/projects/:id/approve', async (req) => {
  const { id } = req.params;
  const r = await approveDecupagem(id);
  stepEnd(id, 'revisao');
  await saveGabarito(store.get(id), 'aprovado');
  void enqueueJob(id, 'finalizar').catch((e) => report(id, 'finalização', e));
  return { queued: true, ...r };
});
app.get('/api/notifications', async () => listNotifications());
app.post<{ Body: { ids?: string[] } }>('/api/notifications/read', async (req) => {
  await markRead(req.body?.ids);
  return { ok: true };
});

app.post<{ Body: { name: string; brief?: string } }>('/api/projects', async (req) => store.create(req.body.name?.trim() || 'Sem nome', req.body.brief ?? ''));
/** Apagar projeto (Kanban): cancela o que estiver na fila e move a pasta para data/_lixeira (reversível à mão). */
app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
  const { id } = req.params;
  // Guarda: só apaga com a confirmação explícita que a tela manda (e registra quem pediu).
  console.log(`[apagar] ${id} ← ${req.headers['user-agent'] ?? '?'} · referer=${req.headers.referer ?? '-'} · confirmacao=${req.headers['x-apagar'] ?? '-'}`);
  if (req.headers['x-apagar'] !== 'sim') throw Object.assign(new Error('apagar exige confirmação (x-apagar: sim)'), { statusCode: 403 });
  const cancelados = cancelJobsFor(id);
  const lixeira = await store.remove(id);
  return { ok: true, cancelados, lixeira };
});
/** Papel de um arquivo: fala (entra na decupagem) ou B-roll. */
app.patch<{ Params: { id: string; assetId: string }; Body: { role: 'fala' | 'broll' } }>('/api/projects/:id/assets/:assetId', async (req) => {
  if (req.body?.role !== 'fala' && req.body?.role !== 'broll') throw Object.assign(new Error('papel inválido'), { statusCode: 400 });
  return setRole(req.params.id, req.params.assetId, req.body.role);
});

app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => store.get(req.params.id));

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

app.patch<{ Params: { id: string }; Body: { name?: string; brief?: string; status?: ProjectStatus; client?: string; dueAt?: string; profileId?: string | null } }>('/api/projects/:id', async (req) => {
  const { name, brief, status, client, dueAt, profileId } = req.body;
  const cur = store.get(req.params.id);
  // Portão de entrega: só vai para "Entregue" com o QC sem bloqueio (e o corte vira gabarito do benchmark).
  if (status === 'entregue' && cur.status !== 'entregue') {
    const qc = cur.qc?.fase ? cur.qc : await runQc(cur.id);
    const block = qc.issues.filter((i) => i.severidade === 'bloqueia');
    if (block.length) throw Object.assign(new Error(`QC com ${block.length} bloqueio(s): ${block.map((i) => i.texto).join(' · ')}`), { statusCode: 409 });
    await saveGabarito(cur, 'entregue');
  }
  const patch = Object.fromEntries(Object.entries({ name, brief, status, client, dueAt, profileId: profileId === null ? undefined : profileId }).filter(([, v]) => v !== undefined));
  if (profileId === null) store.get(req.params.id).profileId = undefined;
  return store.update(req.params.id, patch);
});

/** Importa por caminho local (validação local: o arquivo fica onde está). */
app.post<{ Params: { id: string }; Body: { path: string } }>('/api/projects/:id/assets', async (req) => {
  const { id } = req.params;
  const file = req.body.path?.trim();
  if (!file || !path.isAbsolute(file)) throw Object.assign(new Error('informe o caminho absoluto do arquivo'), { statusCode: 400 });
  await fsp.access(file);
  void enqueue(id, 'importando', () => ingest(id, file)).catch((e) => report(id, 'importação', e));
  return { queued: true };
});

app.delete<{ Params: { id: string; assetId: string } }>('/api/projects/:id/assets/:assetId', async (req) => {
  store.removeAsset(req.params.id, req.params.assetId);
  return { ok: true };
});

app.post<{ Params: { id: string; assetId: string } }>('/api/projects/:id/assets/:assetId/rebuild', async (req) => {
  const { id, assetId } = req.params;
  void enqueue(id, 'reprocessando', () => rebuild(id, assetId)).catch((e) => report(id, 'reprocessamento', e));
  return { queued: true };
});

/** Importa por upload (arrastar arquivo para o Editor Brain). */
app.post<{ Params: { id: string } }>('/api/projects/:id/upload', async (req) => {
  const { id } = req.params;
  const part = await req.file();
  if (!part) throw Object.assign(new Error('nenhum arquivo'), { statusCode: 400 });
  const dir = path.join(store.dir(id), 'uploads');
  await fsp.mkdir(dir, { recursive: true });
  // O busboy lê o nome do arquivo como latin1; o navegador manda UTF-8 ("AUDIÊNCIA É…" chegava "AUDIÃ\u0088NCIA").
  const utf8 = Buffer.from(part.filename, 'latin1').toString('utf8');
  const dest = path.join(dir, path.basename(utf8.includes('\uFFFD') ? part.filename : utf8));
  await pipeline(part.file, fs.createWriteStream(dest));
  void enqueue(id, 'importando', () => ingest(id, dest)).catch((e) => report(id, 'importação', e));
  return { queued: true };
});

app.post<{ Params: { id: string }; Body: { assetId?: string } }>('/api/projects/:id/decupagem', async (req) => {
  requireBrain();
  const { id } = req.params;
  const p = store.get(id);
  const assetId = req.body?.assetId;
  if (!p.assets.some((a) => a.transcript && (!assetId || a.id === assetId))) throw Object.assign(new Error('nenhum material transcrito ainda'), { statusCode: 409 });
  // Sem assetId: decupa todas as brutas (falas transcritas), na ordem em que chegaram.
  void enqueueJob(id, 'decupagem', assetId ? { assetId } : {}).catch((e) => report(id, 'decupagem', e));
  return { queued: true, posicao: queuePosition(id) };
});

app.post<{ Params: { id: string }; Body: { text: string; playhead?: number } }>('/api/projects/:id/command', async (req) => {
  requireBrain();
  const { id } = req.params;
  const text = req.body.text?.trim();
  if (!text) throw Object.assign(new Error('comando vazio'), { statusCode: 400 });
  void enqueue(id, 'executando pedido', () => runCommand(id, text, req.body.playhead)).catch((e) => report(id, 'pedido', e));
  return { queued: true, busy: isBusy(id) ?? null };
});

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

app.get('/api/library/music', async () => {
  analyzeLibraryInBackground();
  return listMusic();
});
app.post<{ Params: { id: string } }>('/api/projects/:id/music-auto', async (req) => {
  const { id } = req.params;
  const r = await enqueue(id, 'escolhendo a trilha', () => musicAuto(id));
  return r ? { track: r.track.name, bpmAlvo: r.bpmAlvo } : { track: null, bpmAlvo: 0 };
});
app.post<{ Params: { id: string; assetId: string } }>('/api/projects/:id/assets/:assetId/sync-cam', async (req) => syncCamera(req.params.id, req.params.assetId));
app.post<{ Params: { id: string } }>('/api/projects/:id/multicam-auto', async (req) => ({ trocas: await autoMulticam(req.params.id) }));
app.post<{ Params: { id: string } }>('/api/projects/:id/reframe-auto', async (req) => autoReframe(req.params.id));

// --- Motions narrativos ------------------------------------------------------------------------
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
app.get<{ Params: { id: string } }>('/api/projects/:id/story', async (req) => readStory(req.params.id));
app.post<{ Params: { id: string }; Body: { refId: string } }>('/api/projects/:id/motion-ref', async (req) => ({ restyled: await useReference(req.params.id, req.body.refId) }));
app.post<{ Params: { id: string }; Body: { refId?: string } }>('/api/projects/:id/motions-auto', async (req) => {
  const { id } = req.params;
  const refId = req.body?.refId;
  void enqueue(id, 'motions', () => autoMotions(id, { refId })).catch((e) => report(id, 'motions narrativos', e));
  return { queued: true };
});

/** Cor automática: detecta o LOG da câmera e acerta exposição/balanço de branco medindo o original. */
app.post<{ Params: { id: string; assetId: string } }>('/api/projects/:id/assets/:assetId/color-auto', async (req) => {
  const { id, assetId } = req.params;
  const a = store.get(id).assets.find((x) => x.id === assetId);
  if (!a || a.kind !== 'video') throw Object.assign(new Error('escolha um vídeo'), { statusCode: 400 });
  store.setActivity(id, { state: 'analyzing', message: `Medindo a cor de ${a.name}` });
  const { grade, why } = await autoGrade(a);
  store.apply(id, { by: 'agent', op: { type: 'set_grade', assetId, grade }, note: `Cor automática: ${why}` });
  store.setActivity(id, { state: 'celebrating', message: 'Cor corrigida para Rec.709' });
  setTimeout(() => store.setActivity(id, { state: 'idle', message: 'Pronto' }), 2000);
  return { grade, why };
});

/** Ouvir uma faixa da biblioteca antes de usar (só arquivos de dentro das pastas da biblioteca). */
app.get<{ Querystring: { path: string } }>('/api/library/music/audio', async (req, reply) => {
  const file = req.query.path;
  if (!file || !musicFileAllowed(file)) throw Object.assign(new Error('arquivo fora da biblioteca de trilhas'), { statusCode: 403 });
  const type = /\.m4a$|\.aac$/i.test(file) ? 'audio/mp4' : /\.wav$/i.test(file) ? 'audio/wav' : 'audio/mpeg';
  return reply.type(type).send(fs.createReadStream(file));
});

app.post<{ Params: { id: string }; Body: { path: string } }>('/api/projects/:id/music', async (req) => {
  const { id } = req.params;
  const file = req.body.path;
  if (!file || !musicFileAllowed(file)) throw Object.assign(new Error('arquivo fora da biblioteca de trilhas'), { statusCode: 403 });
  void enqueue(id, 'trilha', () => useAsTrilha(id, file)).catch((e) => report(id, 'trilha', e));
  return { queued: true };
});

app.post<{ Params: { id: string } }>('/api/projects/:id/undo', async (req) => ({ ok: store.undo(req.params.id) }));
app.post<{ Params: { id: string } }>('/api/projects/:id/redo', async (req) => ({ ok: store.redo(req.params.id) }));

/** Edição pela transcrição: apagar palavras = cortar, com bordas medidas na forma de onda. */
app.post<{ Params: { id: string }; Body: { assetId: string; from: number; to: number } }>('/api/projects/:id/cut-words', async (req) => {
  const { assetId, from, to } = req.body;
  return cutWords(req.params.id, assetId, Math.min(from, to), Math.max(from, to));
});
app.post<{ Params: { id: string }; Body: { assetId: string; from: number; to: number } }>('/api/projects/:id/restore-words', async (req) => {
  const { assetId, from, to } = req.body;
  return restoreWords(req.params.id, assetId, Math.min(from, to), Math.max(from, to));
});

/** O render como trabalho nomeado da fila (sobrevive a reinício). */
async function renderJob(id: string): Promise<void> {
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

app.post<{ Params: { id: string } }>('/api/projects/:id/render', async (req) => {
  const { id } = req.params;
  void enqueueJob(id, 'render').catch((e) => report(id, 'render', e));
  return { queued: true, posicao: queuePosition(id) };
});

// --- Ciclo de alteração: comentários com tempo → o agente faz → versão nova -----------------------
app.post<{ Params: { id: string }; Body: { at: number; text: string; by?: 'editor' | 'cliente' } }>('/api/projects/:id/comments', async (req) => {
  if (!req.body.text?.trim()) throw Object.assign(new Error('comentário vazio'), { statusCode: 400 });
  return addComment(req.params.id, req.body);
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
  if (!a) throw Object.assign(new Error('sem versão anterior para comparar'), { statusCode: 404 });
  return { a: a.n, b: b?.n ?? 'atual', diff: diffTimelines(a.timeline, b?.timeline ?? p.timeline) };
});

// --- Entrega -------------------------------------------------------------------------------------------
app.get('/api/entrega/presets', async () => ({ presets: Object.entries(PRESETS).map(([id, p]) => ({ id, ...p })), pasta: ENTREGAS_DIR }));
app.post<{ Params: { id: string }; Body: EntregaOpts }>('/api/projects/:id/entregar', async (req) => {
  const { id } = req.params;
  const opts: EntregaOpts = { preset: req.body.preset ?? 'original', srt: req.body.srt ?? true, capa: req.body.capa ?? true, capaEm: req.body.capaEm, entregar: req.body.entregar ?? false };
  void enqueueJob(id, 'render', { entrega: opts }).catch((e) => report(id, 'entrega', e));
  return { queued: true, posicao: queuePosition(id) };
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

// --- Fila global ---------------------------------------------------------------------------------
app.get('/api/fila', async () => queueState());
app.delete<{ Params: { id: string } }>('/api/fila/:id', async (req) => ({ ok: cancelJob(req.params.id) }));

// --- Gestor de Projetos: tarefa → briefing → Drive → fila -------------------------------------------
app.post<{ Body: { texto: string } }>('/api/gestor/briefing', async (req) => parseTask(req.body.texto ?? ''));
app.post<{ Body: { texto: string; nome?: string; links?: string[]; profileId?: string; formato?: { width: number; height: number; fps?: number } } }>('/api/gestor', async (req) => {
  if (!req.body.texto?.trim()) throw Object.assign(new Error('cole o texto da tarefa'), { statusCode: 400 });
  return createFromTask(req.body.texto, { nome: req.body.nome, links: req.body.links, profileId: req.body.profileId, formato: req.body.formato });
});

// --- Cinéfilo.AI: B-roll de filme (clip.cafe) ---------------------------------------------------------
app.get<{ Querystring: { q: string } }>('/api/cinefilo/search', async (req) => ({ clips: await searchCafe(req.query.q ?? '') }));
app.get<{ Params: { id: string } }>('/api/projects/:id/cinefilo/beats', async (req) => ({ beats: await beatsForBroll(req.params.id) }));
app.post<{ Params: { id: string }; Body: { clip: CafeClip } }>('/api/projects/:id/cinefilo/use', async (req) => useCafeClip(req.params.id, req.body.clip));

// --- LLM local (camada 3, com portão) -------------------------------------------------------------------
app.get('/api/llm', async () => {
  const s = await llmSettings();
  return { ...s, baixado: await modelDownloaded(s.model) };
});
app.patch<{ Body: Partial<LlmSettings> }>('/api/llm', async (req) => setLlmSettings(req.body));

// --- Benchmark (gabaritos acumulados) -------------------------------------------------------------------
app.get('/api/benchmark', async () => ({ gabaritos: (await listGabaritos()).map((g) => ({ projectId: g.projectId, name: g.name, label: g.label, savedAt: g.savedAt, profileId: g.profileId })) }));

app.register(async (scope) => {
  scope.get<{ Params: { id: string } }>('/ws/:id', { websocket: true }, (socket, req) => {
    const { id } = req.params;
    try {
      store.attach(id, socket);
    } catch {
      socket.close();
      return;
    }
    socket.on('message', (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      try {
        if (msg.type === 'op') {
          // Operação por TEMPO calculada numa versão velha cai no lugar errado se o agente mexeu no meio.
          const timeBased = msg.envelope.op.type === 'cut_timeline' || msg.envelope.op.type === 'split';
          if (timeBased && msg.baseVersion !== store.get(id).version) {
            store.log(id, 'system', 'A timeline mudou enquanto você editava, então sua ação não foi aplicada — tente de novo.');
            return;
          }
          store.apply(id, { ...msg.envelope, by: 'human' });
        } else if (msg.type === 'undo') store.undo(id);
        else if (msg.type === 'redo') store.redo(id);
      } catch (e) {
        if (e instanceof OpError) store.log(id, 'system', `Operação recusada: ${e.message}`);
        else throw e;
      }
    });
    socket.on('close', () => store.detach(id, socket));
  });
});

// Limpeza da voz ligada/mudada (ou um arquivo novo na trilha): prepara o áudio limpo em segundo plano.
store.onTimeline((id) => void syncVoiceClean(id).catch((e) => report(id, 'limpeza da voz', e)));

// Trabalhos nomeados da fila global (retomados se o servidor reiniciar).
registerJob('decupagem', (id, payload) => runDecupagem(id, payload.assetId ? String(payload.assetId) : undefined));
registerJob('finalizar', (id) => finalize(id));
registerJob('render', async (id, payload) => {
  if (payload.entrega) {
    store.setActivity(id, { state: 'analyzing', message: 'Entregando', progress: 0 });
    const r = await entregar(id, payload.entrega as EntregaOpts, (pct) => store.setActivity(id, { state: 'analyzing', message: 'Entregando', progress: pct }));
    store.broadcast(id, { type: 'log', entry: { id: `render_${Date.now()}`, at: new Date().toISOString(), by: 'system', text: `/media/${id}/${store.get(id).versions?.at(-1)?.render ?? ''}` } });
    store.setActivity(id, { state: 'celebrating', message: r.qcBloqueios.length ? `Entrega pronta, com ${r.qcBloqueios.length} ponto(s) do QC` : 'Entrega pronta!' });
    return;
  }
  await renderJob(id);
});
registerJob('alteracoes', (id) => runAlteracoes(id));

await app.listen({ port: PORT, host: '127.0.0.1' });
void resumeJobs((id, kind, e) => report(id, kind, e)).then((n) => n && console.log(`  fila: ${n} trabalho(s) retomado(s)`));
void backfill();
console.log(`\n  NewEditor.AI · servidor em http://127.0.0.1:${PORT} · cérebro: ${BRAIN === 'local' ? 'local (sem API)' : 'Claude'}\n`);
