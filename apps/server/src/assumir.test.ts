/**
 * "Assumir edição" (BL-0122): a trava do humano põe o card em `aguardando Thales` na FILA.md (o `encadear` da
 * produtora só redispara `em edição`), grava `memoria/locks/card-<card>.humano.json` e, ao devolver, volta o estado
 * e deixa no PROJETO.md as alterações feitas desde o Assumir. Produtora inteira num /tmp, sem FFmpeg nem ASR.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-assumir-'));
const root = path.join(tmp, 'newstudios');
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_PRODUTORA = root;
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_BRAIN = 'local';

const FILA = `# FILA.md

## Em andamento e fila

| Card | Cliente | Título | Prazo | Estado | Editor | Gestor | Pasta | Atualizado | Observação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6ad8c0b9 | BRANE | Reels Dina - Semana das Eleições | sem prazo | em edição | studio-editor-3 (Tomás) | studio-gestor-1 (Júlia) | producao/brane/6ad8c0b9-reels-dina/ | 2026-10-21 | v8 no Drive |
| 6ad8c2a1 | Davi Lo | Reels - Oque aprendi com meu pai? | sem prazo | em ajuste | studio-editor-3 (Tomás) | studio-gestor-2 (Otávio) | producao/davi-lo/6ad8c2a1-pai/ | 2026-10-21 | v3 |

## Entregues

| Card | Cliente | Título | Entregue em | Versão | Editor | Gestor | Pasta | Atualizado | Observação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6ad7faa6 | Teste Claude (NewStudios) | [Reels] Daniel Sun | 2026-10-21 | v4 | studio-editor-2 (Lia) | studio-gestor-2 (Otávio) | producao/teste/6ad7faa6-daniel/ | 2026-10-21 | aprovado |
`;
const cardDir = path.join(root, 'producao', 'brane', '6ad8c0b9-reels-dina');
const fila = () => fs.readFileSync(path.join(root, 'FILA.md'), 'utf8');
const estadoDe = (card: string) => fila().split('\n').find((l) => l.startsWith(`| ${card} |`))!.split('|')[5]!.trim();

fs.mkdirSync(path.join(cardDir, 'bruto'), { recursive: true });
fs.mkdirSync(path.join(cardDir, 'entrega'), { recursive: true });
fs.writeFileSync(path.join(cardDir, 'entrega', 'brane_6ad8c0b9_v8.mp4'), 'v8');
fs.writeFileSync(path.join(cardDir, 'PROJETO.md'), '# Projeto Dina\n\n| Data | Quem | O quê |\n| --- | --- | --- |\n| 2026-10-21 | Tomás | v8 |');
fs.writeFileSync(path.join(root, 'FILA.md'), FILA);

after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('trocarEstado mexe só no card da tabela em andamento (Entregues intocada)', async () => {
  const { trocarEstado } = await import('./assumir.ts');
  const r = trocarEstado(FILA, '6ad8c2a1', 'aguardando Thales', '2026-10-22')!;
  assert.equal(r.antes, 'em ajuste');
  const linha = r.md.split('\n').find((l) => l.startsWith('| 6ad8c2a1 |'))!;
  assert.equal(linha, '| 6ad8c2a1 | Davi Lo | Reels - Oque aprendi com meu pai? | sem prazo | aguardando Thales | studio-editor-3 (Tomás) | studio-gestor-2 (Otávio) | producao/davi-lo/6ad8c2a1-pai/ | 2026-10-22 | v3 |');
  assert.equal(r.md.split('\n').filter((l, i) => l !== FILA.split('\n')[i]).length, 1);
  assert.equal(trocarEstado(FILA, '6ad7faa6', 'aguardando Thales', '2026-10-22'), null, 'card entregue não é travado');
  assert.equal(trocarEstado(FILA, 'ffffffff', 'aguardando Thales', '2026-10-22'), null);
});

test('Assumir trava o card, Devolver volta o estado e anota no PROJETO.md o que o humano mudou', async () => {
  const { default: Fastify } = await import('fastify');
  const { rotasSistema } = await import('./routes/sistema.ts');
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Dina', '');
  store.upsertAsset(p.id, { id: 'a1', name: 'C3822.MP4', path: path.join(cardDir, 'bruto', 'C3822.MP4'), kind: 'video', duration: 20, hasAudio: true, role: 'fala' });
  // Edição do agente antes de assumir: não entra na nota.
  store.apply(p.id, { by: 'agent', op: { type: 'set_main', clips: [{ id: 'c1', assetId: 'a1', in: 0, out: 10, by: 'agent' }], removals: [] } });
  const app = Fastify();
  await app.register(rotasSistema);
  try {
    const post = (url: string, payload?: object) => app.inject({ method: 'POST', url, ...(payload && { payload }) });
    const trava = await post(`/api/projects/${p.id}/assumir`, {});
    assert.equal(trava.statusCode, 200, trava.body);
    assert.equal(trava.json().trava.quem, 'Thales');
    assert.equal(estadoDe('6ad8c0b9'), 'aguardando Thales');
    assert.equal(estadoDe('6ad8c2a1'), 'em ajuste', 'outro card intocado');
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'memoria', 'locks', 'card-6ad8c0b9.humano.json'), 'utf8'));
    assert.equal(lock.estadoAntes, 'em edição');
    assert.equal(lock.projectId, p.id);
    assert.equal((await post(`/api/projects/${p.id}/assumir`, {})).statusCode, 409, 'assumir de novo = 409');
    assert.equal((await app.inject({ method: 'GET', url: `/api/projects/${p.id}/trava` })).json().trava.quem, 'Thales');
    const galeria = (await app.inject({ method: 'GET', url: '/api/videos' })).json().videos;
    assert.equal(galeria[0].emEdicaoPor, 'Thales');

    // O humano edita: dois passos.
    store.apply(p.id, { by: 'human', op: { type: 'set_zoom', clipId: 'c1', zoom: 1.2 } });
    store.apply(p.id, { by: 'human', op: { type: 'trim', clipId: 'c1', in: 1, out: 10 } });

    const dev = await post(`/api/projects/${p.id}/devolver`);
    assert.equal(dev.statusCode, 200, dev.body);
    assert.deepEqual(dev.json().passos, ['Zoom', 'Aparar clipe']);
    assert.equal(dev.json().estado, 'em edição');
    assert.equal(estadoDe('6ad8c0b9'), 'em edição');
    assert.equal(fs.existsSync(path.join(root, 'memoria', 'locks', 'card-6ad8c0b9.humano.json')), false);
    const projeto = fs.readFileSync(path.join(cardDir, 'PROJETO.md'), 'utf8');
    assert.match(projeto, /^# Projeto Dina/, 'o PROJETO.md só ganha uma seção no fim');
    assert.match(projeto, /## .* · Thales devolveu a edição ao agente \(Editor Brain\)/);
    assert.match(projeto, /- Zoom\n- Aparar clipe\n/);
    assert.doesNotMatch(projeto, /Nova montagem/, 'edição do agente antes de assumir fica fora');
    assert.equal((await post(`/api/projects/${p.id}/devolver`)).statusCode, 409, 'devolver sem trava = 409');
    assert.equal((await app.inject({ method: 'GET', url: '/api/videos' })).json().videos[0].emEdicaoPor, undefined);
  } finally {
    await app.close();
  }
});

test('Devolver não desfaz estado que o gestor mudou enquanto o humano editava', async () => {
  const { assumir, devolver } = await import('./assumir.ts');
  const p = { id: 'prj_x', assets: [{ path: path.join(cardDir, 'bruto', 'C3822.MP4') }] } as never;
  await assumir(root, p, 'Felipe', 0);
  assert.equal(estadoDe('6ad8c0b9'), 'aguardando Thales');
  fs.writeFileSync(path.join(root, 'FILA.md'), fila().replace('| aguardando Thales |', '| em aprovação |'));
  const r = await devolver(root, p, []);
  assert.equal(r.estado, 'em aprovação');
  assert.equal(estadoDe('6ad8c0b9'), 'em aprovação');
  assert.match(fs.readFileSync(path.join(cardDir, 'PROJETO.md'), 'utf8'), /Felipe devolveu[\s\S]*- nenhuma alteração na timeline/);
});

test('projeto fora da produtora não trava nada', async () => {
  const { assumir } = await import('./assumir.ts');
  await assert.rejects(assumir(root, { id: 'prj_y', assets: [{ path: '/tmp/outro/bruto.mp4' }] } as never, 'Thales', 0), /não é de um card/);
  const antes = fila();
  assert.equal(fila(), antes);
});
