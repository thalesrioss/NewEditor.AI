/**
 * BL-0177 (1): rota com `:id` que monta caminho com `store.dir(id)` confere o projeto antes. O upload com
 * `..%2F..%2Fx` gravava fora da pasta de dados (o Fastify decodifica o `%2F` no parâmetro); render, quadro e
 * entrega enfileiravam trabalho para projeto inexistente. Agora: 404 e nada gravado.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-id-caminho-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'a', 'b', 'data');
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_BRAIN = 'local';

const { store } = await import('./store.ts');
const { rotasProjetos } = await import('./routes/projetos.ts');
const { rotasRender } = await import('./routes/render.ts');
const { queueState, registerJob } = await import('./jobs.ts');
// Executor de mentira: sem a correção, render/entrega de projeto inexistente entravam na fila.
registerJob('render', async () => undefined);

/** Todos os arquivos e pastas sob `dir` (caminhos relativos). */
function arvore(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

function upload(id: string): { url: string; headers: Record<string, string>; payload: string } {
  const b = '----bl0177';
  const payload = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\nnao-e-video\r\n--${b}--\r\n`;
  return { url: `/api/projects/${id}/upload`, headers: { 'content-type': `multipart/form-data; boundary=${b}` }, payload };
}

describe('id de projeto em rota que monta caminho (BL-0177)', () => {
  let app: FastifyInstance;
  let antes: string[] = [];
  before(async () => {
    await store.load();
    await store.create('Existe', 'projeto de teste');
    await store.flush();
    app = Fastify({ logger: false });
    await app.register(multipart);
    await rotasProjetos(app);
    await rotasRender(app);
    await app.ready();
    antes = arvore(tmp);
  });
  after(async () => {
    await app.close();
    await store.flush();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  for (const id of ['..%2F..%2Fx', '..%2F..%2F..%2Fx', 'prj_nao_existe']) {
    test(`upload com id ${id}: 404 e nada gravado`, async () => {
      const r = await app.inject({ method: 'POST', ...upload(id) });
      assert.equal(r.statusCode, 404, r.body);
      assert.deepEqual(arvore(tmp), antes, 'nenhum arquivo novo, nem fora nem dentro da pasta de dados');
    });
  }

  for (const [rota, payload] of [
    ['render', undefined],
    ['quadro', { t: 0 }],
    ['entregar', {}],
  ] as const) {
    test(`${rota} com id ${'..%2F..%2Fx'} e inexistente: 404 e nada na fila`, async () => {
      for (const id of ['..%2F..%2Fx', 'prj_nao_existe']) {
        const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/${rota}`, payload });
        assert.equal(r.statusCode, 404, `${rota} ${id}: ${r.body}`);
      }
      const fila = queueState();
      assert.equal(fila.queue.length + (fila.running ? 1 : 0), 0, 'nenhum trabalho enfileirado');
      assert.deepEqual(arvore(tmp), antes);
    });
  }

  test('importar por caminho com id inexistente: 404', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/projects/..%2F..%2Fx/assets', payload: { path: path.join(tmp, 'qualquer.mp4') } });
    assert.equal(r.statusCode, 404, r.body);
  });

  test('store.dir recusa id que sai da pasta de dados', () => {
    for (const id of ['../x', '..', '.', '', 'a/b', 'a\\b']) assert.throws(() => store.dir(id), (e: unknown) => (e as { statusCode?: number }).statusCode === 404, id);
    assert.equal(path.basename(store.dir('prj_abc')), 'prj_abc');
  });
});
