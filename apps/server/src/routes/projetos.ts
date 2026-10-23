/** Projetos: Kanban, criação/edição/apagar, arquivos (importar, upload, papel, reprocessar), operações na timeline e o WebSocket. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { normalizeGradeLut, OpError, type ClientMessage, type ProjectStatus } from '@neweditor/core';
import { saveGabarito } from '../benchmark.ts';
import { cineproCube } from '../cinepro.ts';
import { estimateRemaining } from '../estimate.ts';
import { ingest, rebuild, setRole } from '../ingest.ts';
import { cancelJobsFor, enqueue } from '../jobs.ts';
import { houseProfile } from '../profiles.ts';
import { runQc } from '../qc.ts';
import { reviewDoubts } from '../review.ts';
import { store } from '../store.ts';
import { cutWords, restoreWords } from '../transcript-edit.ts';
import { importTranscript, type TranscriptInput } from '../transcript-import.ts';
import { erro, report } from './_comum.ts';

export async function rotasProjetos(app: FastifyInstance): Promise<void> {
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

  // Todo projeto nasce com o perfil gravado (BL-0023): sem escolha, o padrão da casa de agora.
  app.post<{ Body: { name: string; brief?: string } }>('/api/projects', async (req) => {
    const p = await store.create(req.body.name?.trim() || 'Sem nome', req.body.brief ?? '');
    return store.update(p.id, { profileId: (await houseProfile()).id });
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => store.get(req.params.id));
  app.patch<{ Params: { id: string }; Body: { name?: string; brief?: string; status?: ProjectStatus; client?: string; dueAt?: string; profileId?: string | null } }>('/api/projects/:id', async (req) => {
    const { name, brief, status, client, dueAt, profileId } = req.body;
    const cur = store.get(req.params.id);
    // Portão de entrega: só vai para "Entregue" com o QC sem bloqueio (e o corte vira gabarito do benchmark).
    if (status === 'entregue' && cur.status !== 'entregue') {
      const qc = cur.qc?.fase ? cur.qc : await runQc(cur.id);
      const block = qc.issues.filter((i) => i.severidade === 'bloqueia');
      if (block.length) throw erro(`QC com ${block.length} bloqueio(s): ${block.map((i) => i.texto).join(' · ')}`, 409);
      await saveGabarito(cur, 'entregue');
    }
    const patch = Object.fromEntries(Object.entries({ name, brief, status, client, dueAt, profileId: profileId === null ? undefined : profileId }).filter(([, v]) => v !== undefined));
    if (profileId === null) store.get(req.params.id).profileId = undefined;
    return store.update(req.params.id, patch);
  });
  /** Apagar projeto (Kanban): cancela o que estiver na fila e move a pasta para data/_lixeira (reversível à mão). */
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const { id } = req.params;
    // Guarda: só apaga com a confirmação explícita que a tela manda (e registra quem pediu).
    console.log(`[apagar] ${id} ← ${req.headers['user-agent'] ?? '?'} · referer=${req.headers.referer ?? '-'} · confirmacao=${req.headers['x-apagar'] ?? '-'}`);
    if (req.headers['x-apagar'] !== 'sim') throw erro('apagar exige confirmação (x-apagar: sim)', 403);
    const cancelados = cancelJobsFor(id);
    const lixeira = await store.remove(id);
    return { ok: true, cancelados, lixeira };
  });

  // --- Arquivos do projeto ---------------------------------------------------------------------------
  /** Importa por caminho local (validação local: o arquivo fica onde está). */
  app.post<{ Params: { id: string }; Body: { path: string; role?: 'fala' | 'broll' | 'motion' } }>('/api/projects/:id/assets', async (req) => {
    const { id } = req.params;
    const file = req.body.path?.trim();
    if (!file || !path.isAbsolute(file)) throw erro('informe o caminho absoluto do arquivo');
    // Papel opcional: o render do Motion Studio entra já como motion (BL-0100); sem papel, o ingest decide como antes.
    const role = req.body.role;
    if (role !== undefined && role !== 'fala' && role !== 'broll' && role !== 'motion') throw erro('role deve ser fala, broll ou motion');
    await fsp.access(file);
    void enqueue(id, 'importando', () => ingest(id, file, role)).catch((e) => report(id, 'importação', e));
    return { queued: true };
  });
  /** Importa por upload (arrastar arquivo para o Editor Brain). */
  app.post<{ Params: { id: string } }>('/api/projects/:id/upload', async (req) => {
    const { id } = req.params;
    const part = await req.file();
    if (!part) throw erro('nenhum arquivo');
    const dir = path.join(store.dir(id), 'uploads');
    await fsp.mkdir(dir, { recursive: true });
    // O busboy lê o nome do arquivo como latin1; o navegador manda UTF-8 ("AUDIÊNCIA É…" chegava "AUDIÃ\u0088NCIA").
    const utf8 = Buffer.from(part.filename, 'latin1').toString('utf8');
    const dest = path.join(dir, path.basename(utf8.includes('�') ? part.filename : utf8));
    await pipeline(part.file, fs.createWriteStream(dest));
    void enqueue(id, 'importando', () => ingest(id, dest)).catch((e) => report(id, 'importação', e));
    return { queued: true };
  });
  /** Papel de um arquivo: fala (entra na decupagem) ou B-roll. */
  app.patch<{ Params: { id: string; assetId: string }; Body: { role: 'fala' | 'broll' } }>('/api/projects/:id/assets/:assetId', async (req) => {
    if (req.body?.role !== 'fala' && req.body?.role !== 'broll') throw erro('papel inválido');
    return setRole(req.params.id, req.params.assetId, req.body.role);
  });
  app.delete<{ Params: { id: string; assetId: string } }>('/api/projects/:id/assets/:assetId', async (req) => {
    store.removeAsset(req.params.id, req.params.assetId);
    return { ok: true };
  });
  /** Transcrição conferida pelo editor no lugar da do ASR (CH-0002): words [{ w, start, end }] ou segments do Whisper. */
  app.post<{ Params: { id: string; assetId: string }; Body: TranscriptInput }>('/api/projects/:id/assets/:assetId/transcript', { bodyLimit: 20 * 1024 * 1024 }, async (req) => importTranscript(req.params.id, req.params.assetId, req.body));
  app.post<{ Params: { id: string; assetId: string } }>('/api/projects/:id/assets/:assetId/rebuild', async (req) => {
    const { id, assetId } = req.params;
    void enqueue(id, 'reprocessando', () => rebuild(id, assetId)).catch((e) => report(id, 'reprocessamento', e));
    return { queued: true };
  });

  // --- Timeline: operação avulsa, desfazer, edição pela transcrição ------------------------------------
  // Operação avulsa por HTTP (o mesmo `apply` do WebSocket; útil para scripts e para o ⌘K).
  app.post<{ Params: { id: string }; Body: { op: Parameters<typeof store.apply>[1]['op']; note?: string; by?: 'human' | 'agent' } }>('/api/projects/:id/op', async (req) => {
    if (!req.body?.op?.type) throw erro('op obrigatória');
    // Look de um .cube do disco (`lut: { path }`, CH-0009): confere o arquivo antes, para não sair render sem o look.
    const op = req.body.op;
    if (op.type === 'set_grade' && op.grade?.lut) {
      const lut = normalizeGradeLut(op.grade).lut!;
      if (lut.path) await cineproCube(lut.id);
    }
    // Op inválida ou de tipo desconhecido = 400 com o motivo; a timeline fica como estava (CH-0025).
    try {
      store.apply(req.params.id, { by: req.body.by ?? 'human', op: req.body.op, note: req.body.note });
    } catch (e) {
      if (e instanceof OpError) throw erro(e.message);
      throw e;
    }
    return { ok: true };
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

  // --- QC e estimativa -------------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/projects/:id/qc', async (req) => runQc(req.params.id));
  app.get<{ Params: { id: string } }>('/api/projects/:id/estimativa', async (req) => estimateRemaining(store.get(req.params.id)));

  // --- WebSocket: a timeline ao vivo (ops do humano, desfazer/refazer, eventos do agente) ------------------
  app.get<{ Params: { id: string } }>('/ws/:id', { websocket: true }, (socket, req) => {
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
}
