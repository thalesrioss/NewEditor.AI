/**
 * R4 (Thales 27/10 01:22): depois da linha no cofre, o registro.py do cofre roda sozinho (nota A-NN) e a reprovação de
 * peça inteira ganha a nota R-NN em Recusados/, ligada à A-NN. Cofre de mentira em pasta temporária, com o registro.py
 * de verdade copiado do cofre do Thales (sem ele na máquina, o teste é pulado).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const REAL = path.join(os.homedir(), 'Documents', 'Cérebro do Editor', '_SISTEMA', 'bin', 'registro.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-cofre-'));
const RAIZ = path.join(tmp, 'Cérebro do Editor');
process.env.NEWSTUDIOS_MEMORIA = path.join(tmp, 'mem');
process.env.CEREBRO_COFRE = path.join(RAIZ, '_SISTEMA');
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
for (const d of ['mem', 'data', 'Cérebro do Editor/_SISTEMA/bin', 'Cérebro do Editor/Clientes', 'Cérebro do Editor/Registro de Decisões/Recusados']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
fs.writeFileSync(path.join(RAIZ, '_SISTEMA', 'correcoes.jsonl'), '');
fs.writeFileSync(path.join(RAIZ, 'Clientes', 'Leandro Arruda.md'), '# Leandro\n<!-- alteracoes:inicio -->\n<!-- alteracoes:fim -->\n');
fs.writeFileSync(path.join(RAIZ, 'Registro de Decisões', 'Recusados', 'R-08 Brainer - antigo.md'), '---\ntipo: recusado\n---\n');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('reprovação: linha com título, A-NN gerada pelo registro.py e R-09 ligada a ela; ref repetido não duplica', { skip: !fs.existsSync(REAL) && 'registro.py do cofre não está nesta máquina' }, async () => {
  fs.copyFileSync(REAL, path.join(RAIZ, '_SISTEMA', 'bin', 'registro.py'));
  const { registrarThales } = await import('./registro-thales.ts');
  const r = await registrarThales({ tipo: 'reprovacao', canal: 'trello', pedido: 'boca de outro momento no gancho', antes: 'cobertura do 52 s sob a voz do 27 s', projeto: 'eq2210-03', cliente: 'equity-sales', ref: 'card-1', quem: 'teste' });
  assert.deepEqual(r.avisos, []);
  assert.match(r.cofreNotas?.registro ?? '', /alterações: 1/);
  const linha = JSON.parse(fs.readFileSync(path.join(RAIZ, '_SISTEMA', 'correcoes.jsonl'), 'utf8').trim()) as Record<string, string>;
  assert.equal(linha.titulo, 'Reprovou: boca de outro momento no gancho');
  const alts = fs.readdirSync(path.join(RAIZ, 'Registro de Decisões', 'Alterações'));
  assert.deepEqual(alts, ['A-01 Reprovou- boca de outro momento no gancho.md']);
  const rec = r.cofreNotas?.recusado ?? '';
  assert.equal(path.basename(rec), 'R-09 Leandro Arruda - boca de outro momento no gancho.md');
  const md = fs.readFileSync(rec, 'utf8');
  assert.match(md, /^tipo: recusado$/m);
  assert.match(md, /\[\[Leandro Arruda\]\]/);
  assert.match(md, /\[\[A-01 Reprovou- boca de outro momento no gancho\|A-01\]\]/);
  const r2 = await registrarThales({ tipo: 'reprovacao', canal: 'trello', pedido: 'boca de outro momento no gancho', projeto: 'eq2210-03', cliente: 'equity-sales', ref: 'card-1' });
  assert.equal(r2.cofre?.duplicado, true);
  assert.equal(fs.readdirSync(path.join(RAIZ, 'Registro de Decisões', 'Recusados')).length, 2);
});

test('aprovação também leva título no cofre', async () => {
  const { linhaCofre } = await import('./registro-thales.ts');
  const l = JSON.parse(linhaCofre({ tipo: 'aprovacao', canal: 'slack', pedido: 'pode entregar o 15' })) as Record<string, string>;
  assert.equal(l.titulo, 'Aprovou: pode entregar o 15');
});
