/**
 * Testes do CORS fechado (BL-0123): só a própria tela fala com o servidor pelo navegador. Monta o servidor como o
 * `index.ts` (cors + proteção de origem + websocket + rotas de projeto) numa pasta de dados temporária.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { origemAceita, origensPermitidas, protegerOrigem } from './origens.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-origens-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const origens = origensPermitidas(4410, ' https://central.newstudios.local/ , lixo, ');
const app = Fastify();
let id = '';

before(async () => {
  const { store } = await import('./store.ts');
  await store.load();
  await app.register(cors, { origin: (origem, cb) => cb(null, origemAceita(origem, origens)) });
  protegerOrigem(app, origens);
  await app.register(websocket);
  const { rotasProjetos } = await import('./routes/projetos.ts');
  await app.register(rotasProjetos);
  const r = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Origem' } });
  assert.equal(r.statusCode, 200);
  id = (r.json() as { id: string }).id;
});
after(async () => {
  await app.close();
  await new Promise((r) => setTimeout(r, 600)); // o store grava o project.json 400 ms depois do último update
  fs.rmSync(tmp, { recursive: true, force: true });
});

const op = { op: { type: 'set_captions', captions: { enabled: false } } };
const versao = async () => (await app.inject({ method: 'GET', url: `/api/projects/${id}` })).json().version as number;

describe('lista de origens', () => {
  test('tela de desenvolvimento, central, o próprio servidor e as extras; o resto não', () => {
    for (const o of ['http://localhost:5173', 'http://127.0.0.1:5410', 'http://localhost:5410', 'http://[::1]:5410', 'http://127.0.0.1:4410', 'https://central.newstudios.local']) assert.ok(origemAceita(o, origens), o);
    for (const o of ['https://example.com', 'http://localhost:8080', 'null', 'http://localhost.example.com:5410', 'lixo']) assert.equal(origemAceita(o, origens), false, o);
    assert.ok(origemAceita(undefined, origens), 'sem Origin passa');
  });
});

describe('servidor com CORS fechado', () => {
  test('GET de outro site responde sem access-control-allow-origin', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/projects', headers: { origin: 'https://example.com' } });
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  test('POST de op vindo de outro site = 403 e o projeto não muda', async () => {
    const antes = await versao();
    const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, headers: { origin: 'https://example.com' }, payload: op });
    assert.equal(r.statusCode, 403);
    assert.equal(await versao(), antes);
    const del = await app.inject({ method: 'DELETE', url: `/api/projects/${id}`, headers: { origin: 'https://example.com' } });
    assert.equal(del.statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: `/api/projects/${id}` })).statusCode, 200);
  });

  test('preflight de outro site não libera o pedido', async () => {
    const r = await app.inject({ method: 'OPTIONS', url: `/api/projects/${id}/op`, headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' } });
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  test('WebSocket aberto por outro site = 403', async () => {
    const r = await app.inject({ method: 'GET', url: `/ws/${id}`, headers: { origin: 'https://example.com', upgrade: 'websocket', connection: 'Upgrade' } });
    assert.equal(r.statusCode, 403);
  });

  test('a tela da central (5410) lê e altera, com o cabeçalho CORS', async () => {
    const get = await app.inject({ method: 'GET', url: '/api/projects', headers: { origin: 'http://localhost:5410' } });
    assert.equal(get.statusCode, 200);
    assert.equal(get.headers['access-control-allow-origin'], 'http://localhost:5410');
    const antes = await versao();
    const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, headers: { origin: 'http://localhost:5410' }, payload: op });
    assert.equal(r.statusCode, 200);
    assert.ok((await versao()) > antes);
  });

  test('sem Origin (curl, agentes) continua passando', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode, 200);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: op });
    assert.equal(r.statusCode, 200);
  });
});
