/**
 * BL-0081: glossário do cliente no perfil. Palavra que bate com termo do glossário (ignorando caixa e acento) não vira
 * dúvida de grafia na revisão (nem conta no QC "grafia"); fora dele continua. "Guardar no perfil do cliente" põe o
 * termo no topo do glossário do perfil do projeto. Sem glossário, o ASR roda com os mesmos argumentos de antes.
 * Pasta de dados temporária; palavras de confiança baixa (p < 0,1) viram dúvida sem depender do corretor do macOS.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-glossario-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const perfisDir = path.join(tmp, 'data', 'perfis');
const app = Fastify();
type Store = typeof import('./store.ts').store;
let store: Store;

before(async () => {
  fs.mkdirSync(perfisDir, { recursive: true });
  const at = '2026-10-20T00:00:00.000Z';
  fs.writeFileSync(path.join(perfisDir, 'casa.json'), JSON.stringify({ id: 'casa-thales', nome: 'Thales', padraoCasa: true, validado: true, atualizadoEm: at }));
  fs.writeFileSync(path.join(perfisDir, 'cliente.json'), JSON.stringify({ id: 'cliente', nome: 'Clínica Sol', glossario: ['Eustócina'], atualizadoEm: at }));
  ({ store } = await import('./store.ts'));
  await store.load();
  const { rotasRevisao } = await import('./routes/revisao.ts');
  await rotasRevisao(app);
});
after(async () => {
  await app.close();
  await store.flush?.();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Projeto com uma fala de 3 palavras, todas no corte e de confiança baixa: "Eustosina", "Eustocina", "Bioquimica". */
async function projeto(profileId?: string): Promise<string> {
  const p = await store.create('Teste glossário', '');
  const dir = path.join(store.dir(p.id), 'a1');
  fs.mkdirSync(dir, { recursive: true });
  const words = [
    { w: 'Eustosina', start: 0.2, end: 0.8, p: 0.05 },
    { w: 'Eustocina,', start: 1.0, end: 1.6, p: 0.05 },
    { w: 'Bioquimica.', start: 1.8, end: 2.6, p: 0.05 },
  ];
  fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify({ language: 'pt', duration: 3, model: 't', words, segments: [] }));
  const cur = store.get(p.id);
  cur.assets.push({ id: 'a1', name: 'fala.mp4', path: '/tmp/fala.mp4', kind: 'video', duration: 3, hasAudio: true, role: 'fala', transcript: 'a1/transcript.json' } as (typeof cur.assets)[number]);
  cur.timeline.main.push({ id: 'c1', assetId: 'a1', in: 0, out: 3, by: 'agent' });
  if (profileId) cur.profileId = profileId;
  return p.id;
}

const grafias = async (id: string) => {
  const { reviewDoubts } = await import('./review.ts');
  return (await reviewDoubts(store.get(id))).filter((d) => d.kind === 'palavra' || d.kind === 'nome').map((d) => d.text);
};

describe('revisão com glossário do cliente', () => {
  test('termo do glossário (sem caixa/acento) não vira dúvida; fora dele continua', async () => {
    const id = await projeto('cliente');
    assert.deepEqual(await grafias(id), ['Eustosina', 'Bioquimica']);
  });

  test('sem glossário (padrão da casa) as três continuam dúvida', async () => {
    const id = await projeto();
    assert.deepEqual(await grafias(id), ['Eustosina', 'Eustocina', 'Bioquimica']);
  });

  test('"Guardar no perfil do cliente": entra no topo do glossário e a dúvida some', async () => {
    const id = await projeto('cliente');
    const r = await app.inject({ method: 'POST', url: `/api/projects/${id}/glossario`, payload: { termo: 'Bioquimica' } });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { perfil: 'cliente', nome: 'Clínica Sol', glossario: ['Bioquimica', 'Eustócina'] });
    assert.deepEqual(await grafias(id), ['Eustosina']);
    const salvo = JSON.parse(fs.readFileSync(path.join(perfisDir, 'cliente.json'), 'utf8')) as { glossario: string[] };
    assert.deepEqual(salvo.glossario, ['Bioquimica', 'Eustócina']);
  });

  test('"Personalizado" não guarda glossário (409) e termo vazio é 400', async () => {
    const id = await projeto('personalizado');
    assert.equal((await app.inject({ method: 'POST', url: `/api/projects/${id}/glossario`, payload: { termo: 'X' } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `/api/projects/${id}/glossario`, payload: { termo: '  ' } })).statusCode, 400);
  });
});

describe('argumentos do ASR', () => {
  test('sem glossário: os mesmos de antes; com glossário: --glossario no fim', async () => {
    const { asrArgs } = await import('./asr.ts');
    const { ASR_SCRIPT } = await import('./config.ts');
    const antes = ['run', '--quiet', '--python', '3.12', '--with', 'mlx-whisper', ASR_SCRIPT, 'a.wav', 'o.json', 'pt', '--chunks', 'c.json'];
    assert.deepEqual(asrArgs('a.wav', 'o.json', 'pt', 'c.json'), antes);
    assert.deepEqual(asrArgs('a.wav', 'o.json', 'pt', 'c.json', []), antes);
    assert.deepEqual(asrArgs('a.wav', 'o.json', 'pt', 'c.json', ['Eustócina', 'Daniel Sun']), [...antes, '--glossario', 'Eustócina, Daniel Sun']);
  });
});
