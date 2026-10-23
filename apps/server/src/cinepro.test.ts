/**
 * CH-0001 (NewStudios): GET /api/cinepro/itens?modo=cor devolvia 500 ("reading 'includes'") porque o servidor
 * só conhecia som / visual / lut. Agora "cor" (nome da aba dos looks) é apelido de lut e modo desconhecido é 400.
 * Sem rede: o manifesto vem da cópia local em NEWEDITOR_DATA e a URL da nuvem aponta para uma porta fechada.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-cinepro-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_CINEPRO_MANIFEST = 'http://127.0.0.1:9/manifest.json';
fs.mkdirSync(process.env.NEWEDITOR_DATA, { recursive: true });
fs.writeFileSync(
  path.join(process.env.NEWEDITOR_DATA, 'cinepro-manifest.json'),
  JSON.stringify({
    version: 1,
    builtAt: '2026-10-20T00:00:00Z',
    files: [
      { id: 'lut-fuji-1', name: 'Fujifilm Flog to Rec 709 V1', ext: 'cube', kind: 'lut', category: 'CinePRO Looks', subcategory: 'Conversão', tags: ['fuji'] },
      { id: 'lut-sony', name: 'Sony Slog3 to Rec 709', ext: 'cube', kind: 'lut', category: 'CinePRO Looks', subcategory: 'Conversão' },
      { id: 'sfx-whoosh', name: 'Whoosh Fuji', ext: 'wav', kind: 'audio', category: 'CinePRO Sound Design', subcategory: 'Whoosh' },
    ],
  }),
);

const { cineproItens, cineproModo } = await import('./cinepro.ts');
const { rotasCinepro } = await import('./routes/cinepro.ts');

describe('CinePRO: modo da busca (CH-0001)', () => {
  let app: FastifyInstance;
  before(async () => {
    app = Fastify();
    await rotasCinepro(app);
    await app.ready();
  });
  after(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('cor, looks e luts são apelidos de lut; vazio é som', () => {
    for (const m of ['cor', 'Cor', 'looks', 'look', 'luts', 'lut']) assert.equal(cineproModo(m), 'lut');
    assert.equal(cineproModo(undefined), 'som');
    assert.equal(cineproModo(''), 'som');
    assert.equal(cineproModo('efeitos'), 'visual');
  });

  test('modo=cor&busca=fuji lista só os looks da Fuji', async () => {
    const r = await cineproItens({ modo: 'cor', busca: 'fuji' });
    assert.deepEqual(r.itens.map((i) => i.id), ['lut-fuji-1']);
  });

  test('pela rota: modo=cor é 200 e modo desconhecido é 400 com os valores aceitos', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/cinepro/itens?modo=cor&busca=fuji' });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual((ok.json() as { itens: { id: string }[] }).itens.map((i) => i.id), ['lut-fuji-1']);
    const resumo = await app.inject({ method: 'GET', url: '/api/cinepro?modo=cor' });
    assert.equal(resumo.statusCode, 200);
    assert.equal((resumo.json() as { modo: string; total: number }).modo, 'lut');
    const ruim = await app.inject({ method: 'GET', url: '/api/cinepro/itens?modo=xyz' });
    assert.equal(ruim.statusCode, 400);
    assert.match((ruim.json() as { message: string }).message, /som, visual ou lut/);
  });
});
