/** FB-0169: galeria com todos os vídeos editados da produtora, lidos de producao/ e da FILA.md. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listVideos, parseFila, versaoDoArquivo } from './videos.ts';

const FILA = `# FILA.md

## Em andamento e fila

| Card | Cliente | Título | Prazo | Estado | Editor | Gestor | Pasta | Atualizado | Observação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6ad8c09f | BRANE | Reels Gabi - Ancelotti | sem prazo | em aprovação | studio-editor-1 (Pedro) | studio-gestor-1 (Júlia) | producao/brane/6ad8c09f-reels-gabi-ancelotti/ | 2026-10-21 | entregue no Drive https://drive.google.com/file/d/1xA9-lEo/view, ok. Id Trello completo 6ad8c09f75b1b08a633f9a5c |

## Entregues

| Card | Cliente | Título | Entregue em | Versão | Editor | Gestor | Pasta | Atualizado | Observação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6ad7faa6 | Teste Claude (NewStudios) | [Reels] Daniel Sun | 2026-10-21 | v4 | studio-editor-2 (Lia) | studio-gestor-2 (Otávio) | producao/teste-claude-newstudios/6ad7faa6-reels-daniel-sun/ | 2026-10-21 | aprovado |
`;

test('FILA.md: cliente, título, etapa, editor, Trello e Drive de cada card nas duas tabelas', () => {
  const f = parseFila(FILA);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { card: '6ad8c09f', cliente: 'BRANE', titulo: 'Reels Gabi - Ancelotti', etapa: 'em aprovação', editor: 'studio-editor-1 (Pedro)', pasta: 'producao/brane/6ad8c09f-reels-gabi-ancelotti/', trello: 'https://trello.com/c/6ad8c09f75b1b08a633f9a5c', drive: 'https://drive.google.com/file/d/1xA9-lEo/view' });
  assert.equal(f[1]!.etapa, 'entregue (v4)');
  assert.equal(versaoDoArquivo('brane_6ad8c09f_v12.mp4'), 12);
  assert.equal(versaoDoArquivo('final.mp4'), null);
});

test('lista as versões de producao/<cliente>/<card>/entrega com o projeto que editou o card', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'galeria-'));
  try {
    await fs.writeFile(path.join(root, 'FILA.md'), FILA);
    const card = path.join(root, 'producao', 'brane', '6ad8c09f-reels-gabi-ancelotti');
    await fs.mkdir(path.join(card, 'entrega'), { recursive: true });
    await fs.mkdir(path.join(card, 'bruto'), { recursive: true });
    await fs.writeFile(path.join(card, 'entrega', 'brane_6ad8c09f_v1.mp4'), 'v1');
    await fs.writeFile(path.join(card, 'entrega', 'brane_6ad8c09f_v2.mp4'), 'v2!');
    await fs.writeFile(path.join(card, 'entrega', 'QC.md'), 'não é vídeo');
    await fs.utimes(path.join(card, 'entrega', 'brane_6ad8c09f_v1.mp4'), new Date('2026-10-21T10:00:00Z'), new Date('2026-10-21T10:00:00Z'));
    // Card sem linha na FILA ainda aparece, com o nome da pasta.
    await fs.mkdir(path.join(root, 'producao', 'davi-lo', '6ad8c2a1-oque-aprendi', 'entrega'), { recursive: true });
    await fs.writeFile(path.join(root, 'producao', 'davi-lo', '6ad8c2a1-oque-aprendi', 'entrega', 'davi-lo_6ad8c2a1_v1.mp4'), 'x');
    // Card sem entrega não entra.
    await fs.mkdir(path.join(root, 'producao', 'brane', '6ad8c0c5-sem-entrega', 'bruto'), { recursive: true });
    const projetos = [
      { id: 'prj_velho', createdAt: '2026-10-20T00:00:00Z', assets: [{ path: path.join(card, 'bruto', 'C3820.MP4') }] },
      { id: 'prj_novo', createdAt: '2026-10-21T00:00:00Z', assets: [{ path: path.join(card, 'bruto', 'C3820.MP4') }] },
      { id: 'prj_outro', createdAt: '2026-10-22T00:00:00Z', assets: [{ path: '/tmp/outro/bruto.mp4' }] },
    ] as never[];
    const v = await listVideos(root, projetos);
    assert.deepEqual(v.map((x) => x.arquivo).sort(), ['brane_6ad8c09f_v1.mp4', 'brane_6ad8c09f_v2.mp4', 'davi-lo_6ad8c2a1_v1.mp4']);
    const v2 = v.find((x) => x.versao === 2 && x.card === '6ad8c09f')!;
    assert.equal(v2.cliente, 'BRANE');
    assert.equal(v2.titulo, 'Reels Gabi - Ancelotti');
    assert.equal(v2.editor, 'studio-editor-1 (Pedro)');
    assert.equal(v2.projectId, 'prj_novo');
    assert.equal(v2.bytes, 3);
    assert.equal(v2.url, '/producao/brane/6ad8c09f-reels-gabi-ancelotti/entrega/brane_6ad8c09f_v2.mp4');
    const davi = v.find((x) => x.card === '6ad8c2a1')!;
    assert.equal(davi.cliente, 'davi-lo');
    assert.equal(davi.titulo, 'oque aprendi');
    assert.equal(davi.projectId, undefined);
    // Mais recente primeiro: a v1 (10:00) fica depois das outras.
    assert.equal(v.at(-1)!.arquivo, 'brane_6ad8c09f_v1.mp4');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('sem pasta da produtora: lista vazia, sem erro', async () => {
  assert.deepEqual(await listVideos('/tmp/nao-existe-produtora-xyz'), []);
});
