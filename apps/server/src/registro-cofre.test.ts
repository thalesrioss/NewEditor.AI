/**
 * R4 (Thales 27/10 01:22): depois da linha no cofre, o registro.py do cofre roda sozinho (nota A-NN) e a reprovação de
 * peça inteira ganha a nota R-NN em Recusados/, ligada à A-NN, tudo na pasta NewStudios do cofre (Thales 01:24).
 * Cofre de mentira em pasta temporária; o registro.py é a cópia da NewStudios versionada no repo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-cofre-'));
const VAULT = path.join(tmp, 'Cérebro do Editor');
const RAIZ = path.join(VAULT, 'NewStudios');
process.env.NEWSTUDIOS_MEMORIA = path.join(tmp, 'mem');
process.env.CEREBRO_COFRE = path.join(RAIZ, '_SISTEMA');
process.env.CEREBRO_COFRE_RAIZ = path.join(VAULT, '_SISTEMA');
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
for (const d of ['mem', 'data', 'Cérebro do Editor/_SISTEMA', 'Cérebro do Editor/Clientes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
fs.writeFileSync(path.join(VAULT, '_SISTEMA', 'correcoes.jsonl'), '{"origem": "Thales", "projeto": "leandro-x", "USER_CORRECTION": "linha da raiz", "data": "2026-10-20"}\n');
fs.writeFileSync(path.join(VAULT, 'Clientes', 'Leandro Arruda.md'), '# Leandro\n');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('pasta NewStudios nasce no cofre; reprovação: linha com título, A-01 gerada lá pelo registro.py e R-01 ligada a ela; ref repetido não duplica; a raiz não muda', async () => {
  const { registrarThales, linhasThales } = await import('./registro-thales.ts');
  const raizAntes = fs.readFileSync(path.join(VAULT, '_SISTEMA', 'correcoes.jsonl'), 'utf8');
  const r = await registrarThales({ tipo: 'reprovacao', canal: 'trello', pedido: 'boca de outro momento no gancho', antes: 'cobertura do 52 s sob a voz do 27 s', projeto: 'eq2210-03', cliente: 'equity-sales', ref: 'card-1', quem: 'teste' });
  assert.deepEqual(r.avisos, []);
  assert.match(r.cofreNotas?.registro ?? '', /alterações: 1/);
  const linha = JSON.parse(fs.readFileSync(path.join(RAIZ, '_SISTEMA', 'correcoes.jsonl'), 'utf8').trim()) as Record<string, string>;
  assert.equal(linha.titulo, 'Reprovou: boca de outro momento no gancho');
  const alts = fs.readdirSync(path.join(RAIZ, 'Registro de Decisões', 'Alterações'));
  assert.deepEqual(alts, ['A-01 Reprovou- boca de outro momento no gancho.md']);
  const rec = r.cofreNotas?.recusado ?? '';
  assert.equal(path.basename(rec), 'R-01 Leandro Arruda - boca de outro momento no gancho.md');
  assert.equal(path.dirname(rec), path.join(RAIZ, 'Registro de Decisões', 'Recusados'));
  assert.ok(fs.existsSync(path.join(RAIZ, 'README.md')));
  assert.equal(fs.readFileSync(path.join(VAULT, '_SISTEMA', 'correcoes.jsonl'), 'utf8'), raizAntes, 'a raiz do cofre não muda');
  assert.match(fs.readFileSync(path.join(RAIZ, 'Registro de Decisões', 'Registro de Decisões.md'), 'utf8'), /\[\[Leandro Arruda\]\][\s\S]*A-01/);
  // Leitura junta NewStudios e raiz.
  const ls = await linhasThales('leandro');
  assert.ok(ls.some((l) => /linha da raiz/.test(l.pedido)));
  const md = fs.readFileSync(rec, 'utf8');
  assert.match(md, /^tipo: recusado$/m);
  assert.match(md, /\[\[Leandro Arruda\]\]/);
  assert.match(md, /\[\[A-01 Reprovou- boca de outro momento no gancho\|A-01\]\]/);
  const r2 = await registrarThales({ tipo: 'reprovacao', canal: 'trello', pedido: 'boca de outro momento no gancho', projeto: 'eq2210-03', cliente: 'equity-sales', ref: 'card-1' });
  assert.equal(r2.cofre?.duplicado, true);
  assert.equal(fs.readdirSync(path.join(RAIZ, 'Registro de Decisões', 'Recusados')).length, 1);
});

test('aprovação também leva título no cofre', async () => {
  const { linhaCofre } = await import('./registro-thales.ts');
  const l = JSON.parse(linhaCofre({ tipo: 'aprovacao', canal: 'slack', pedido: 'pode entregar o 15' })) as Record<string, string>;
  assert.equal(l.titulo, 'Aprovou: pode entregar o 15');
});

test('reprovação do revisor (--origem revisor): R-NN por revisor (Igor), origem igual nos dois jsonl, sem A-NN e nunca conta como Thales', async () => {
  const { registrarThales, linhasThales } = await import('./registro-thales.ts');
  const alts = () => fs.readdirSync(path.join(RAIZ, 'Registro de Decisões', 'Alterações'));
  const antes = alts();
  const thalesAntes = (await linhasThales('equity-sales', 200)).length;
  const r = await registrarThales({ tipo: 'reprovacao', origem: 'revisor', revisor: 'Igor', canal: 'slack', pedido: 'legenda cobre o rosto do Thales no 07', projeto: 'eq2210-07', cliente: 'equity-sales', ref: 'rev-1', quem: 'studio-revisor' });
  assert.deepEqual(r.avisos, []);
  const ultima = (arq: string) => JSON.parse(fs.readFileSync(arq, 'utf8').trim().split('\n').at(-1)!) as Record<string, string>;
  assert.equal(ultima(path.join(RAIZ, '_SISTEMA', 'correcoes.jsonl')).origem, 'revisor (Igor)');
  assert.equal(ultima(path.join(tmp, 'mem', 'correcoes.jsonl')).origem, 'revisor (Igor)');
  assert.match(ultima(path.join(RAIZ, '_SISTEMA', 'correcoes.jsonl')).evidence ?? '', /^revisor \(Igor\) \(slack/);
  const md = fs.readFileSync(r.cofreNotas?.recusado ?? '', 'utf8');
  assert.match(path.basename(r.cofreNotas!.recusado!), /^R-02 Leandro Arruda - legenda cobre/);
  assert.match(md, /^por: revisor \(Igor\)$/m);
  assert.match(md, /\*\*Descartado por:\*\* revisor \(Igor\)/);
  assert.doesNotMatch(md, /por: Thales|Descartado por:\*\* Thales/);
  assert.deepEqual(alts(), antes, 'linha do revisor não vira A-NN "do Thales"');
  assert.doesNotMatch(fs.readFileSync(path.join(RAIZ, 'Registro de Decisões', 'Lições Técnicas.md'), 'utf8'), /legenda cobre/);
  assert.equal((await linhasThales('equity-sales', 200)).length, thalesAntes, 'leitura do Thales não traz a do revisor');
});

test('origem: padrão segue Thales; revisor sem nome ou origem desconhecida é 400', async () => {
  const { registrarThales, linhaCofre, linhaNewstudios } = await import('./registro-thales.ts');
  assert.equal((JSON.parse(linhaCofre({ tipo: 'reprovacao', canal: 'slack', pedido: 'x' })) as Record<string, string>).origem, 'Thales');
  assert.equal((JSON.parse(linhaNewstudios({ tipo: 'alteracao', canal: 'slack', pedido: 'x' })) as Record<string, string>).origem, 'Thales');
  const ap = JSON.parse(linhaCofre({ tipo: 'aprovacao', canal: 'slack', pedido: 'ok', origem: 'revisor', revisor: 'Vera' })) as Record<string, string>;
  assert.equal(ap.origem, 'revisor (Vera)');
  assert.doesNotMatch(JSON.stringify(ap), /Thales/);
  await assert.rejects(registrarThales({ tipo: 'reprovacao', origem: 'revisor', canal: 'slack', pedido: 'x' }), /nome/);
  await assert.rejects(registrarThales({ tipo: 'reprovacao', origem: 'chefe' as never, canal: 'slack', pedido: 'x' }), /origem inválida/);
});
