import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { CENTRAL_PADRAO, centralNoAr, centralUrl, escolherOrigem } from './central';

test('centralUrl: padrão é a tela da NewStudios; vazio, off ou 0 desliga; tira a barra do fim', () => {
  assert.equal(centralUrl({}), CENTRAL_PADRAO);
  assert.equal(centralUrl({ NEWEDITOR_CENTRAL_URL: 'http://10.0.0.5:5410/' }), 'http://10.0.0.5:5410');
  for (const v of ['', ' ', 'off', '0']) assert.equal(centralUrl({ NEWEDITOR_CENTRAL_URL: v }), null);
});

test('escolherOrigem: dev vence; central no ar abre direto nela; fora do ar cai no servidor próprio sem perguntar', async () => {
  const sempre = (v: boolean) => async () => v;
  assert.deepEqual(await escolherOrigem({ NEWEDITOR_DEV_URL: 'http://localhost:5173' }, { noAr: sempre(true) }), { tipo: 'dev', url: 'http://localhost:5173' });
  assert.deepEqual(await escolherOrigem({}, { noAr: sempre(true) }), { tipo: 'central', url: CENTRAL_PADRAO });
  const fora = await escolherOrigem({}, { noAr: sempre(false), tentativas: 2, esperaMs: 1 });
  assert.equal(fora.tipo, 'local');
  assert.equal((await escolherOrigem({ NEWEDITOR_CENTRAL_URL: 'off' }, { noAr: sempre(true) })).tipo, 'local');
});

test('escolherOrigem: espera a central que ainda está subindo', async () => {
  let chamadas = 0;
  const o = await escolherOrigem({}, { noAr: async () => ++chamadas >= 3, tentativas: 3, esperaMs: 1 });
  assert.equal(o.tipo, 'central');
  assert.equal(chamadas, 3);
});

test('centralNoAr: só 200 com ok:true conta; porta fechada e resposta errada não', async () => {
  const resposta = { status: 200, body: '{"ok":true,"brain":"local","ready":true}' };
  const srv = http.createServer((req, res) => {
    res.statusCode = req.url === '/api/health' ? resposta.status : 404;
    res.end(resposta.body);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    assert.equal(await centralNoAr(url), true);
    resposta.body = '{"message":"Route GET:/api/health not found"}';
    assert.equal(await centralNoAr(url), false);
    resposta.status = 502;
    resposta.body = '{"ok":true}';
    assert.equal(await centralNoAr(url), false);
  } finally {
    await new Promise((r) => srv.close(r));
  }
  assert.equal(await centralNoAr(url, 300), false);
});
