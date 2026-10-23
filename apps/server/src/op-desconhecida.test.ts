/**
 * CH-0025 (NewStudios, Pedro): POST /op com um tipo que o servidor rodando não conhece voltava 200 e gravava a
 * timeline como undefined (applyOp caía no fim do switch); a op seguinte dava 500. Agora é 400 com o motivo e a
 * timeline fica intacta. Vale também para op conhecida mas inválida (OpError), que antes saía como 500.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { applyOp, OpError, type Timeline } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-op-desconhecida-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_BRAIN = 'local';

const { store } = await import('./store.ts');
const { rotasProjetos } = await import('./routes/projetos.ts');

describe('op de tipo desconhecido (CH-0025)', () => {
  let app: FastifyInstance;
  let id = '';
  before(async () => {
    await store.load();
    const p = await store.create('Teste de op desconhecida', 'projeto de teste');
    id = p.id;
    store.upsertAsset(id, { id: 'a1', name: 'fala.mp4', path: path.join(tmp, 'fala.mp4'), kind: 'video', duration: 20, hasAudio: true, role: 'fala' });
    store.apply(id, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: 'a1', in: 0, out: 10, by: 'human' }], removals: [] } });
    app = Fastify();
    await rotasProjetos(app);
    await app.ready();
  });
  after(async () => {
    await app.close();
    await store.flush();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('applyOp recusa tipo desconhecido com OpError (nunca devolve undefined)', () => {
    const t = { fps: 30, width: 1080, height: 1920, main: [], overlays: [], removals: [], pins: [] } as unknown as Timeline;
    assert.throws(() => applyOp(t, { type: 'set_coisa_nova', id: 'x' } as never, 'human'), (e: unknown) => e instanceof OpError && /desconhecida: set_coisa_nova/.test(e.message));
  });

  test('pela rota: 400 com o motivo, timeline e versão intactas, op seguinte funciona', async () => {
    const antes = JSON.stringify(store.get(id).timeline);
    const versao = store.get(id).version;
    const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: { op: { type: 'set_overlay_keep_captions_v9', id: 'o1', keep: true } } });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().message, /operação desconhecida: set_overlay_keep_captions_v9/);
    assert.equal(JSON.stringify(store.get(id).timeline), antes);
    assert.equal(store.get(id).version, versao);
    // Nenhum passo de desfazer foi criado pela op recusada.
    await store.flush();
    const disco = JSON.parse(fs.readFileSync(path.join(store.dir(id), 'project.json'), 'utf8'));
    assert.ok(disco.timeline, 'project.json continua com timeline');
    const ok = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: { op: { type: 'set_zoom', clipId: 'c1', zoom: 1.2 } } });
    assert.equal(ok.statusCode, 200);
  });

  test('op conhecida mas inválida também é 400 (antes 500)', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: { op: { type: 'set_zoom', clipId: 'c1', zoom: 9 } } });
    assert.equal(r.statusCode, 400);
  });
});
