/**
 * Testes do Gestor de Projetos (BL-0046): a tarefa colada com o caminho do bruto no disco importa o arquivo
 * como o Manual faz, e o que não dá para importar vira aviso no painel do agente (log), não só na resposta da API.
 * Roda numa pasta de dados temporária, com um vídeo sem áudio gerado pelo FFmpeg (entra como B-roll: sem ASR).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-gestor-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const pasta = path.join(tmp, 'Material do cliente — edição');
const clip = path.join(pasta, 'Seu cérebro AINDA.mp4');
const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  fs.mkdirSync(pasta, { recursive: true });
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-t', '2', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip]);
  const { store } = await import('./store.ts');
  await store.load();
});
after(async () => {
  await sleep(600); // o store grava o project.json 400 ms depois do último update
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** O que o painel do agente recebe: as mensagens `log` do WebSocket do projeto. */
async function painel(id: string): Promise<string[]> {
  const { store } = await import('./store.ts');
  const out: string[] = [];
  const ws = { readyState: 1, send: (d: string) => { const m = JSON.parse(d); if (m.type === 'log') out.push(m.entry.text); } };
  store.attach(id, ws as never);
  store.detach(id, ws as never);
  return out;
}

async function esperarAssets(id: string, n: number, ms = 20_000): Promise<number> {
  const { store } = await import('./store.ts');
  const fim = Date.now() + ms;
  while (Date.now() < fim && store.get(id).assets.length < n) await sleep(100);
  return store.get(id).assets.length;
}

describe('caminhosDoTexto', () => {
  test('linha Material:, solto na frase, ~/, entre aspas; URL não conta', async () => {
    const { caminhosDoTexto } = await import('./gestor.ts');
    const texto = [
      'Cliente: Thales Rios',
      'Material: /Users/thalesrioss/Downloads/Seu cérebro AINDA procura ameaças.mp4',
      'O áudio extra está em ~/Downloads/trilha nova.wav, use no fim.',
      'Logo: "/Volumes/HD Externo/logo final.png"',
      'Drive: https://drive.google.com/file/d/abcdefghijk1234/view e o resto.',
    ].join('\n');
    assert.deepEqual(caminhosDoTexto(texto), [
      '/Users/thalesrioss/Downloads/Seu cérebro AINDA procura ameaças.mp4',
      path.join(os.homedir(), 'Downloads/trilha nova.wav'),
      '/Volumes/HD Externo/logo final.png',
    ]);
  });
  test('Material: com pasta ou arquivo sem extensão de mídia também é caminho (vira aviso depois)', async () => {
    const { caminhosDoTexto } = await import('./gestor.ts');
    assert.deepEqual(caminhosDoTexto('material: /Users/x/Brutos do Davi/'), ['/Users/x/Brutos do Davi/']);
    assert.deepEqual(caminhosDoTexto('Tirar gaguejadas e/ou repetições.'), []);
  });
});

describe('createFromTask com caminho local', () => {
  test('arquivo que existe (espaço e acento no nome) → 1 asset, sem aviso de "Nenhum link"', async () => {
    const { createFromTask } = await import('./gestor.ts');
    const r = await createFromTask(`Cliente: Thales Rios\nReels até 60 s\nMaterial: ${clip}\nTirar gaguejadas.`);
    assert.deepEqual(r.avisos, []);
    assert.equal(await esperarAssets(r.projectId, 1), 1);
    const { store } = await import('./store.ts');
    const a = store.get(r.projectId).assets[0]!;
    assert.equal(a.name, 'Seu cérebro AINDA.mp4');
    assert.equal(a.path, clip, 'importa do lugar, sem copiar');
    const log = await painel(r.projectId);
    assert.ok(log.some((t) => t.startsWith('Recebi Seu cérebro AINDA.mp4')), log.join(' | '));
    assert.ok(!log.some((t) => t.includes('Nenhum link')), log.join(' | '));
  });
  test('caminho que não existe → aviso no log do agente e 0 asset', async () => {
    const { createFromTask } = await import('./gestor.ts');
    const falta = path.join(pasta, 'não existe.mp4');
    const r = await createFromTask(`Cliente: Davi Lo\nMaterial: ${falta}`);
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0]!, /Não achei .*não existe\.mp4 no disco/);
    await sleep(300);
    const { store } = await import('./store.ts');
    assert.equal(store.get(r.projectId).assets.length, 0);
    assert.ok((await painel(r.projectId)).includes(r.avisos[0]!), 'o aviso aparece no painel do agente');
  });
  test('pasta no lugar de arquivo → aviso, 0 asset', async () => {
    const { createFromTask } = await import('./gestor.ts');
    const r = await createFromTask(`Material: ${pasta}`);
    assert.match(r.avisos.join(' '), /não é um arquivo/);
    await sleep(300);
    const { store } = await import('./store.ts');
    assert.equal(store.get(r.projectId).assets.length, 0);
  });
  test('sem link e sem caminho → "Nenhum link do Drive" vai para o painel', async () => {
    const { createFromTask } = await import('./gestor.ts');
    const r = await createFromTask('Reels do Davi sobre treino, tom leve.');
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0]!, /Nenhum link do Drive/);
    assert.ok((await painel(r.projectId)).includes(r.avisos[0]!));
  });
});
