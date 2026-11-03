/**
 * BL-0177 (2) pela API: cor com aspas/HTML em set_captions, motion ou lettering é 400 com o motivo (a timeline
 * fica como estava); projeto gravado antes com cor inválida carrega e a cor cai no padrão.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { DEFAULT_CAPTIONS, DEFAULT_MOTION_STYLE } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-op-cor-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_BRAIN = 'local';

const RUIM = 'red"><script>alert(1)</script>';
const NUM_RUIM = '800"><img src=x onerror=alert(1)>';
// Projeto gravado antes da regra, com cor inválida na legenda e no motion.
const antigo = path.join(tmp, 'data', 'projects', 'prj_antigo');
fs.mkdirSync(antigo, { recursive: true });
fs.writeFileSync(
  path.join(antigo, 'project.json'),
  JSON.stringify({
    id: 'prj_antigo', name: 'Antigo', brief: '', status: 'fila', createdAt: new Date().toISOString(), assets: [], version: 1,
    timeline: {
      fps: 30, width: 1080, height: 1920, main: [],
      captions: { ...DEFAULT_CAPTIONS, accent: RUIM, weight: NUM_RUIM, size: NUM_RUIM, position: NUM_RUIM, scale: 1.2 },
      overlays: [{ id: 'm1', trackId: 'V3', role: 'motion', anchor: { assetId: '@timeline', at: 0 }, duration: 2, by: 'agent', source: { type: 'motion', motion: { template: 'palavra', funcao: 'explain', fala: '', ideia: '', texts: ['a', ''], beats: [0], seed: 1, style: { ...DEFAULT_MOTION_STYLE, bg: RUIM } } } }],
    },
  }),
);

const { store } = await import('./store.ts');
const { rotasProjetos } = await import('./routes/projetos.ts');

describe('cor inválida pela API (BL-0177)', () => {
  let app: FastifyInstance;
  let id = '';
  before(async () => {
    await store.load();
    id = (await store.create('Cor', 'teste')).id;
    app = Fastify();
    await rotasProjetos(app);
    await app.ready();
  });
  after(async () => {
    await app.close();
    await store.flush();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('set_captions com accent com aspas/HTML: 400 com o motivo, timeline intacta', async () => {
    const antes = JSON.stringify(store.get(id).timeline);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: { op: { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, accent: RUIM } } } });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().message, /set_captions: accent/);
    assert.equal(JSON.stringify(store.get(id).timeline), antes);
    const ok = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: { op: { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, accent: '#FF3B30' } } } });
    assert.equal(ok.statusCode, 200);
  });

  test('set_captions com weight ou size em string com aspas: 400 com o motivo, timeline intacta', async () => {
    const antes = JSON.stringify(store.get(id).timeline);
    for (const campo of ['weight', 'size'] as const) {
      const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: { op: { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, [campo]: NUM_RUIM } } } });
      assert.equal(r.statusCode, 400, campo);
      assert.match(r.json().message, new RegExp(`set_captions: ${campo}: número`));
    }
    const nan = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: { op: { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, letterSpacing: '1;color:red' } } } });
    assert.equal(nan.statusCode, 400);
    assert.equal(JSON.stringify(store.get(id).timeline), antes);
    const ok = await app.inject({ method: 'POST', url: `/api/projects/${id}/op`, payload: { op: { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, weight: 800, size: 5.2 } } } });
    assert.equal(ok.statusCode, 200);
  });

  test('projeto antigo com número inválido na legenda carrega: campo cai no padrão, número bom fica', () => {
    const c = store.get('prj_antigo').timeline.captions!;
    assert.equal(c.weight, undefined);
    assert.equal(c.size, undefined);
    assert.equal(c.position, DEFAULT_CAPTIONS.position);
    assert.equal(c.scale, 1.2);
  });

  test('projeto antigo com cor inválida carrega com a cor no padrão', () => {
    const t = store.get('prj_antigo').timeline;
    assert.equal(t.captions?.accent, undefined);
    assert.equal(t.captions?.enabled, DEFAULT_CAPTIONS.enabled);
    const src = t.overlays[0]!.source as { motion: { style: { bg: string } } };
    assert.equal(src.motion.style.bg, DEFAULT_MOTION_STYLE.bg);
  });
});
