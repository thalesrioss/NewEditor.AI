/**
 * Servidor do Editor Brain: inicialização, arquivos estáticos, as rotas por área (em `routes/`), os trabalhos
 * nomeados da fila e o `listen`. Cada área de rota é um módulo com uma função `rotasX(app)`.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { runAlteracoes } from './alteracoes.ts';
import { BRAIN, DATA_DIR, PORT, ROOT } from './config.ts';
import { runDecupagem } from './decupagem/run.ts';
import { syncVoiceClean } from './denoise.ts';
import type { EntregaOpts } from './entrega.ts';
import { finalize } from './finalize.ts';
import { backfill } from './ingest.ts';
import { registerJob, resumeJobs } from './jobs.ts';
import { REFS_DIR } from './motion/refs.ts';
import { origemAceita, origensPermitidas, protegerOrigem } from './origens.ts';
import { report } from './routes/_comum.ts';
import { rotasAgente } from './routes/agente.ts';
import { rotasBibliotecas } from './routes/bibliotecas.ts';
import { rotasCinepro } from './routes/cinepro.ts';
import { rotasMotion } from './routes/motion.ts';
import { rotasProjetos } from './routes/projetos.ts';
import { entregaJob, renderJob, rotasRender } from './routes/render.ts';
import { rotasRevisao } from './routes/revisao.ts';
import { rotasSistema } from './routes/sistema.ts';
import { store } from './store.ts';

await store.load();

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 10 * 1024 * 1024 });
// Só a própria tela fala com o servidor pelo navegador (BL-0123); curl e agentes (sem Origin) continuam passando.
const origens = origensPermitidas(PORT, process.env.NEWEDITOR_ALLOWED_ORIGINS);
await app.register(cors, { origin: (origem, cb) => cb(null, origemAceita(origem, origens)) });
protegerOrigem(app, origens);
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 * 1024 } });
await app.register(websocket);
// Mídia do projeto (proxies, envelopes, renders) com suporte a Range — o player faz seek direto.
await app.register(fastifyStatic, { root: DATA_DIR, prefix: '/media/', decorateReply: false, cacheControl: false });
// Biblioteca de referências de motion (capas e quadros).
await fsp.mkdir(REFS_DIR, { recursive: true });
await app.register(fastifyStatic, { root: REFS_DIR, prefix: '/refs/', decorateReply: false });
const webDist = process.env.NEWEDITOR_WEB_DIST ?? path.join(ROOT, 'apps', 'web', 'dist');
if (fs.existsSync(webDist)) await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: false });

// Rotas por área.
for (const rotas of [rotasSistema, rotasProjetos, rotasRevisao, rotasAgente, rotasRender, rotasBibliotecas, rotasMotion, rotasCinepro]) await app.register(rotas);

// Limpeza da voz ligada/mudada (ou um arquivo novo na trilha): prepara o áudio limpo em segundo plano.
store.onTimeline((id) => void syncVoiceClean(id).catch((e) => report(id, 'limpeza da voz', e)));

// Trabalhos nomeados da fila global (retomados se o servidor reiniciar).
registerJob('decupagem', (id, payload) => runDecupagem(id, payload.assetId ? String(payload.assetId) : undefined));
registerJob('finalizar', (id) => finalize(id));
registerJob('render', (id, payload) => (payload.entrega ? entregaJob(id, payload.entrega as EntregaOpts) : renderJob(id)));
registerJob('alteracoes', (id) => runAlteracoes(id));

await app.listen({ port: PORT, host: '127.0.0.1' });
void resumeJobs((id, kind, e) => report(id, kind, e)).then((n) => n && console.log(`  fila: ${n} trabalho(s) retomado(s)`));
void backfill();
console.log(`\n  NewEditor.AI · servidor em http://127.0.0.1:${PORT} · cérebro: ${BRAIN === 'local' ? 'local (sem API)' : 'Claude'}\n`);
