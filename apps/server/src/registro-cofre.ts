/**
 * R4 (ordem do Thales 27/10 01:22: "as alterações pedidas e os conteúdos rejeitados PRECISAM ser registrados dentro do
 * Cérebro do Editor, ISSO É UMA REGRA"). Depois de gravar no `_SISTEMA/` do cofre:
 *  - roda o `_SISTEMA/bin/registro.py` do próprio cofre (cwd = raiz do cofre), que gera as notas A-NN em
 *    `Registro de Decisões/Alterações/` e a lista na nota do cliente;
 *  - reprovação de peça inteira vira também nota R-NN em `Registro de Decisões/Recusados/`, no modelo do README do
 *    cofre (frontmatter tipo recusado; O que foi dito / Diagnóstico / Substituído por / Alterações ligadas).
 * Só cria arquivos novos e roda o script do cofre; regras e brains do cofre continuam só leitura.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from './profiles.ts';

/** O registro.py da NewStudios (cópia do do cofre sem o mapa histórico de linhas do Thales), versionado aqui. */
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cofre', 'registro-newstudios.py');

const README = `# NewStudios · registros dentro do Cérebro do Editor

Ordem do Thales (27/10/2026 01:24): "os registros que vierem da NewStudios precisam estar na pasta NewStudios dentro
desse vault". Aqui ficam as aprovações, alterações e recusas do Thales sobre o trabalho da NewStudios, gravadas pelo
Editor Brain (tela 5410) e pelo CLI \`registro-cli\` dos agentes. A raiz do cofre (\`../_SISTEMA\`) é do Thales.

- \`_SISTEMA/correcoes.jsonl\` · \`_SISTEMA/decisoes.jsonl\`: fonte de verdade (formato do PROTOCOLO_GLOBAL, \`"fonte": "newstudios"\`).
- \`Registro de Decisões/Alterações/A-NN …\`: geradas por \`python3 _SISTEMA/bin/registro.py\` (roda sozinho a cada registro).
- \`Registro de Decisões/Recusados/R-NN …\`: peça reprovada pelo Thales.
- \`Registro de Decisões/Aprovados/\`: peças aprovadas.
`;

const INDICE = `---
tipo: índice
tags: [registro, newstudios]
---
# Registro de Decisões · NewStudios

## Alterações (pedidos do Thales), por cliente
<!-- alteracoes:inicio -->
<!-- alteracoes:fim -->
`;

/**
 * Cria a pasta NewStudios no cofre (só o que falta) e instala o registro.py dela. Precisa do cofre existir: sem a raiz
 * "Cérebro do Editor", não cria nada e devolve false.
 */
export async function prepararNewStudios(sistema: string): Promise<boolean> {
  const raiz = path.dirname(sistema);
  if (!(await fs.stat(path.dirname(raiz)).catch(() => null))?.isDirectory()) return false;
  for (const d of [path.join(sistema, 'bin'), ...['Alterações', 'Recusados', 'Aprovados'].map((x) => path.join(raiz, 'Registro de Decisões', x))]) await fs.mkdir(d, { recursive: true });
  const novo = async (f: string, txt: string) => fs.writeFile(f, txt, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
  await novo(path.join(sistema, 'correcoes.jsonl'), '');
  await novo(path.join(sistema, 'decisoes.jsonl'), '');
  await novo(path.join(raiz, 'README.md'), README);
  await novo(path.join(raiz, 'Registro de Decisões', 'Registro de Decisões.md'), INDICE);
  const script = await fs.readFile(SCRIPT, 'utf8');
  const alvo = path.join(sistema, 'bin', 'registro.py');
  if ((await fs.readFile(alvo, 'utf8').catch(() => '')) !== script) await fs.writeFile(alvo, script);
  return true;
}

/** Raiz do cofre a partir do `_SISTEMA`. */
export const raizCofre = (sistema: string) => path.dirname(sistema);

/** Roda o registro.py do cofre. Erro não derruba o registro: vira aviso. */
export function rodarRegistroPy(raiz: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join('_SISTEMA', 'bin', 'registro.py')], { cwd: raiz, timeout: 60_000 }, (e, out, err) => (e ? reject(new Error(`${e.message} ${String(err).slice(0, 300)}`)) : resolve(String(out).trim())));
  });
}

/** Nome da nota do cliente em `Clientes/` (Equity Sales é o Leandro Arruda), ou o slug como veio. */
export async function notaCliente(raiz: string, cliente: string): Promise<string | null> {
  if (!cliente) return null;
  const alias: Record<string, string> = { 'equity-sales': 'leandro-arruda' };
  const alvo = alias[slug(cliente)] ?? slug(cliente);
  const notas = (await fs.readdir(path.join(raiz, 'Clientes')).catch(() => [] as string[])).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  return notas.find((n) => slug(n) === alvo) ?? notas.find((n) => slug(n).startsWith(alvo) || alvo.startsWith(slug(n))) ?? null;
}

/** Todas as notas R-NN (soltas ou dentro de pasta de projeto). */
async function notasR(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) out.push(...(await notasR(path.join(dir, e.name))));
    else if (/^R-\d+ .*\.md$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

/** A nota A-NN que o registro.py gerou para a linha `n` do correcoes.jsonl. */
async function notaA(raiz: string, n: number): Promise<string | null> {
  const dir = path.join(raiz, 'Registro de Decisões', 'Alterações');
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!/^A-\d+ .*\.md$/.test(f)) continue;
    const head = (await fs.readFile(path.join(dir, f), 'utf8').catch(() => '')).slice(0, 600);
    if (head.includes(`fonte: _SISTEMA/correcoes.jsonl#L${n}\n`)) return f.slice(0, -3);
  }
  return null;
}

const limpa = (t: string) => t.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90);
const citacao = (t: string) => t.split('\n').map((l) => `> ${l}`).join('\n');

export interface Recusa {
  pedido: string;
  antes?: string;
  depois?: string;
  projeto: string;
  cliente?: string;
  titulo: string;
  data: string;
  ref?: string;
  /** Linha do correcoes.jsonl do cofre (para ligar a nota A-NN). */
  linha?: number;
}

/** Cria a nota R-NN da recusa (uma por `ref`). Devolve o caminho, ou null se já existia. */
export async function notaRecusado(raiz: string, r: Recusa): Promise<string | null> {
  const dir = path.join(raiz, 'Registro de Decisões', 'Recusados');
  await fs.mkdir(dir, { recursive: true });
  const existentes = await notasR(dir);
  if (r.ref) {
    for (const f of existentes) if ((await fs.readFile(f, 'utf8').catch(() => '')).slice(0, 800).includes(`\nref: ${r.ref}\n`)) return null;
  }
  const n = Math.max(0, ...existentes.map((f) => Number(/^R-(\d+)/.exec(path.basename(f))![1]))) + 1;
  const id = `R-${String(n).padStart(2, '0')}`;
  // As notas de cliente moram na raiz do cofre (a pasta NewStudios fica dentro dela).
  const cli = r.cliente ? ((await notaCliente(raiz, r.cliente)) ?? (await notaCliente(path.dirname(raiz), r.cliente))) : null;
  const a = r.linha ? await notaA(raiz, r.linha) : null;
  const nome = limpa(`${id} ${cli ?? r.cliente ?? 'Sem cliente'} - ${r.titulo}`);
  const tags = ['registro', 'recusado', ...(cli ? [`cliente/${slug(cli)}`] : [])];
  const md = [
    '---', 'tipo: recusado', `id: ${id}`, `data: ${r.data}`, `cliente: ${cli ?? r.cliente ?? '—'}`, `projeto: ${r.projeto || '—'}`, 'por: Thales',
    'fonte: newstudios (Editor Brain, registro do Thales)', ...(r.ref ? [`ref: ${r.ref}`] : []), `tags: [${tags.join(', ')}]`, '---',
    `# ${id} · ${cli ?? r.cliente ?? 'Sem cliente'} — ${r.titulo}`, '',
    `**Cliente:** ${cli ? `[[${cli}]]` : '—'} · **Projeto:** \`${r.projeto || '—'}\` · **Descartado por:** Thales`, '',
    '## O que foi dito', citacao(r.pedido), '',
    '## Diagnóstico', r.antes?.trim() || '— (a preencher por quem refizer a peça)', '',
    '## Substituído por', r.depois?.trim() || 'Em ajuste: a nova versão entra aqui quando for aprovada.', '',
    '## Alterações ligadas', a ? `[[${a}|${a.split(' ')[0]}]]` : '—', '',
  ].join('\n');
  const file = path.join(dir, `${nome}.md`);
  await fs.writeFile(file, md, { flag: 'wx' });
  return file;
}
