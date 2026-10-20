import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markKeyHandled, runEditCommand, setEditHandler, type EditCmd } from './editMenu.ts';

// Documento falso: só o que o editMenu usa (elemento em foco e execCommand).
const fakeDoc = (focus: string | null) => {
  const calls: string[] = [];
  const el = focus ? { closest: (sel: string) => (sel.split(', ').some((s) => s === focus || (s === '[contenteditable]' && focus === 'div[contenteditable]')) ? {} : null) } : null;
  return { calls, doc: { activeElement: el as unknown as Element, execCommand: (c: string) => (calls.push(c), true) } };
};

test('campo de texto em foco: o comando vai para o campo, nunca para a timeline (BL-0073)', () => {
  const app: EditCmd[] = [];
  const off = setEditHandler((c) => app.push(c));
  for (const tag of ['textarea', 'input', 'div[contenteditable]']) {
    const { calls, doc } = fakeDoc(tag);
    assert.equal(runEditCommand('undo', doc, 1e9), 'field');
    assert.equal(runEditCommand('selectAll', doc, 1e9), 'field');
    assert.deepEqual(calls, ['undo', 'selectAll']);
  }
  assert.deepEqual(app, []);
  off();
});

test('fora de campo: desfaz/refaz/seleciona na timeline, uma vez só', () => {
  const app: EditCmd[] = [];
  const off = setEditHandler((c) => app.push(c));
  const { calls, doc } = fakeDoc(null);
  assert.equal(runEditCommand('undo', doc, 2e9), 'app');
  assert.equal(runEditCommand('redo', doc, 2e9), 'app');
  assert.equal(runEditCommand('selectAll', doc, 2e9), 'app');
  assert.deepEqual(app, ['undo', 'redo', 'selectAll']);
  assert.deepEqual(calls, []);
  off();
});

test('tecla já tratada pela página: o menu do mesmo toque não repete o passo', () => {
  const app: EditCmd[] = [];
  const off = setEditHandler((c) => app.push(c));
  const { doc } = fakeDoc(null);
  markKeyHandled('undo', 3e9);
  assert.equal(runEditCommand('undo', doc, 3e9 + 20), 'none');
  assert.equal(runEditCommand('redo', doc, 3e9 + 20), 'app'); // outro comando passa
  assert.equal(runEditCommand('undo', doc, 3e9 + 500), 'app'); // novo ⌘Z depois passa
  assert.deepEqual(app, ['redo', 'undo']);
  off();
});

test('sem editor aberto: Selecionar tudo faz o padrão da página, desfazer não faz nada', () => {
  const { calls, doc } = fakeDoc(null);
  assert.equal(runEditCommand('selectAll', doc, 4e9), 'page');
  assert.equal(runEditCommand('undo', doc, 4e9), 'none');
  assert.deepEqual(calls, ['selectAll']);
});

test('desregistrar o editor antigo não apaga o handler do editor novo', () => {
  const a: EditCmd[] = [];
  const b: EditCmd[] = [];
  const offA = setEditHandler((c) => a.push(c));
  const offB = setEditHandler((c) => b.push(c));
  offA();
  runEditCommand('undo', fakeDoc(null).doc, 5e9);
  assert.deepEqual([a, b], [[], ['undo']]);
  offB();
});
