/**
 * BL-0072: `store.flush()` grava na hora o que espera o debounce de 400 ms e aguarda as gravações em curso.
 * É o que os testes usam no `after()` antes de apagar a pasta de dados, no lugar de um sleep fixo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-flush-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
const { store } = await import('./store.ts');
await store.load();
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const noDisco = (id: string) => JSON.parse(fs.readFileSync(path.join(store.dir(id), 'project.json'), 'utf8')) as { name: string };

describe('store.flush', () => {
  test('update → flush → project.json já tem a mudança e não sobra .tmp', async () => {
    const p = await store.create('Antes', 'flush');
    store.update(p.id, { name: 'Depois' });
    assert.equal(noDisco(p.id).name, 'Antes', 'o debounce ainda não gravou');
    await store.flush();
    assert.equal(noDisco(p.id).name, 'Depois');
    assert.ok(!fs.existsSync(path.join(store.dir(p.id), 'project.json.tmp')));
  });

  test('vários updates seguidos em dois projetos: grava o último de cada', async () => {
    const a = await store.create('A0', 'flush');
    const b = await store.create('B0', 'flush');
    for (let i = 1; i <= 5; i++) {
      store.update(a.id, { name: `A${i}` });
      store.update(b.id, { name: `B${i}` });
    }
    await store.flush();
    assert.equal(noDisco(a.id).name, 'A5');
    assert.equal(noDisco(b.id).name, 'B5');
  });

  test('espera a gravação que o debounce já começou', async () => {
    const p = await store.create('X0', 'flush');
    store.update(p.id, { name: 'X1' });
    await new Promise((r) => setTimeout(r, 420)); // o timer de 400 ms já disparou; a escrita pode estar em curso
    await store.flush();
    assert.equal(noDisco(p.id).name, 'X1');
    assert.ok(!fs.existsSync(path.join(store.dir(p.id), 'project.json.tmp')));
  });

  test('sem nada pendente, resolve na hora', async () => {
    await store.flush();
    await store.flush();
  });
});
