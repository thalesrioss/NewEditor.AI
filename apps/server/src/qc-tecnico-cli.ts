/**
 * Gate técnico na linha de comando: imprime a tabela e sai com 1 se reprova.
 *
 *   node --import tsx apps/server/src/qc-tecnico-cli.ts <mp4> [--project project.json]
 *        [--assinatura a.mp4,b.mp4 | --assinatura-json f.json] [--salvar-assinatura f.json] [--json]
 */
import fs from 'node:fs/promises';
import type { Project } from '@neweditor/core';
import { assinaturaDe, qcTecnico, tabelaQc, type Assinatura } from './qc-tecnico.ts';

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const COM_VALOR = new Set(['--project', '--assinatura', '--assinatura-json', '--salvar-assinatura']);
const file = args.find((a, i) => !a.startsWith('--') && !COM_VALOR.has(args[i - 1] ?? ''));
if (!file) {
  console.error('uso: qc-tecnico-cli.ts <mp4> [--project project.json] [--assinatura a.mp4,b.mp4 | --assinatura-json f.json] [--salvar-assinatura f.json] [--json]');
  process.exit(2);
}

let assinatura: Assinatura | undefined;
const lista = opt('--assinatura');
if (lista) assinatura = await assinaturaDe(lista.split(',').map((s) => s.trim()).filter(Boolean));
const aj = opt('--assinatura-json');
if (aj) assinatura = JSON.parse(await fs.readFile(aj, 'utf8')) as Assinatura;
const salvar = opt('--salvar-assinatura');
if (salvar && assinatura) await fs.writeFile(salvar, `${JSON.stringify(assinatura, null, 2)}\n`);
const pj = opt('--project');
const project = pj ? (JSON.parse(await fs.readFile(pj, 'utf8')) as Project) : undefined;

const r = await qcTecnico(file, { project, assinatura });
console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : tabelaQc(r));
process.exit(r.aprovado ? 0 : 1);
