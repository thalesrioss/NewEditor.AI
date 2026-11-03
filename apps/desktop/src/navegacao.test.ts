import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destinoNavegacao } from './navegacao';

const BASE = 'http://localhost:5410';

test('navegação (BL-0177): mesma origem é interna, com ou sem caminho, query e barra', () => {
  for (const u of ['http://localhost:5410', 'http://localhost:5410/', 'http://localhost:5410/projeto/prj_1?x=1#a']) assert.equal(destinoNavegacao(u, BASE), 'interna', u);
  assert.equal(destinoNavegacao('http://localhost:5410/kanban', 'http://localhost:5410/'), 'interna');
});

test('navegação: prefixo de texto não basta; host, porta ou protocolo diferente é externo', () => {
  for (const u of ['http://localhost:5410.exemplo', 'http://localhost:5410.exemplo/x', 'http://localhost:54100', 'https://localhost:5410', 'http://localhost:5410@evil.com', 'https://newcontent.com.br']) {
    assert.equal(destinoNavegacao(u, BASE), 'externa', u);
  }
});

test('navegação: file:, smb: e outros protocolos são negados (nem janela, nem openExternal)', () => {
  for (const u of ['file:///etc/passwd', 'smb://servidor/compartilhado', 'javascript:alert(1)', 'vscode://x', 'mailto:a@b.c', 'data:text/html,<b>x</b>', 'nada', '']) {
    assert.equal(destinoNavegacao(u, BASE), 'negada', u);
  }
  // Base em file: não torna file: interno.
  assert.equal(destinoNavegacao('file:///x', 'file:///y'), 'negada');
});
