/**
 * "Assumir edição" (BL-0122, FB-0169 item 3): o humano trava o card da produtora para editar ele mesmo no Editor Brain,
 * sem o editor agente daquele card ser redisparado por cima; "Devolver ao agente" solta a trava e deixa nota no
 * PROJETO.md do card com o que o humano mudou.
 *
 * Como o `bin/encadear` da produtora não lê trava por card (a única que ele lê é `memoria/locks/<agente>.pid`, por
 * agente), a trava age pelo que ele já lê: o Estado do card na FILA.md. Ele só redispara card `em edição` (e acorda
 * em `em ajuste`/`atribuído`); `aguardando Thales` é estado do FLUXO.md que ele só registra. Assumir guarda o estado
 * anterior em `memoria/locks/card-<card>.humano.json` e põe o card em `aguardando Thales`; Devolver volta o estado
 * anterior (se ninguém mexeu no estado enquanto isso) e apaga a trava.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@neweditor/core';

export const ESTADO_TRAVADO = 'aguardando Thales';

export interface Trava {
  card: string;
  projectId: string;
  quem: string;
  desde: string;
  /** Estado do card na FILA.md antes de assumir (volta nele ao devolver). */
  estadoAntes: string;
  /** Passos de desfazer do projeto no momento de assumir: os de depois são o que o humano fez. */
  passosAntes: number;
}

export interface CardDoProjeto {
  card: string;
  /** Pasta do card (`<produtora>/producao/<cliente>/<pasta>`). */
  dir: string;
}

const travaArq = (root: string, card: string) => path.join(root, 'memoria', 'locks', `card-${card}.humano.json`);

/** Card da produtora que o projeto edita: o da pasta onde está algum arquivo do projeto (`producao/<cliente>/<card>-.../`). */
export function cardDoProjeto(root: string, p: Pick<Project, 'assets'>): CardDoProjeto | null {
  const producao = path.join(root, 'producao') + path.sep;
  for (const a of p.assets) {
    if (!a.path?.startsWith(producao)) continue;
    const [cliente, pasta] = a.path.slice(producao.length).split(path.sep);
    const card = /^([0-9a-f]{8})(?:-|$)/i.exec(pasta ?? '')?.[1];
    if (cliente && pasta && card) return { card, dir: path.join(producao, cliente, pasta) };
  }
  return null;
}

/**
 * Troca o Estado (5ª coluna) do card na tabela de cards em andamento da FILA.md (a 1ª tabela com `| Card |`; a de
 * Entregues fica intocada) e a data de Atualizado. Devolve o texto novo e o estado que estava, ou null se o card não
 * está em andamento.
 */
export function trocarEstado(md: string, card: string, novo: string, hoje: string): { md: string; antes: string } | null {
  const linhas = md.split('\n');
  let tabela = 0;
  let dentro = false;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!;
    if (l.startsWith('| Card |')) {
      tabela++;
      dentro = true;
      continue;
    }
    if (!l.startsWith('|')) dentro = false;
    if (!dentro || tabela !== 1) continue;
    const c = l.split('|');
    // c[0] é o vazio antes da 1ª barra: Card = c[1], Estado = c[5], Atualizado = c[9].
    if (c.length < 11 || c[1]!.trim() !== card) continue;
    const antes = c[5]!.trim().replace(/^`|`$/g, '');
    c[5] = ` ${novo} `;
    c[9] = ` ${hoje} `;
    linhas[i] = c.join('|');
    return { md: linhas.join('\n'), antes };
  }
  return null;
}

/** Grava sem deixar arquivo pela metade (FILA.md é lida por cron a cada minuto). */
async function gravar(arq: string, texto: string): Promise<void> {
  const tmp = `${arq}.${process.pid}.tmp`;
  await fs.writeFile(tmp, texto);
  await fs.rename(tmp, arq);
}

const hoje = () => new Date().toLocaleDateString('sv-SE');
const httpErro = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export async function lerTrava(root: string, card: string): Promise<Trava | null> {
  try {
    return JSON.parse(await fs.readFile(travaArq(root, card), 'utf8')) as Trava;
  } catch {
    return null;
  }
}

/** Todas as travas de humano (para a galeria marcar os cards). */
export async function travas(root: string): Promise<Map<string, Trava>> {
  const dir = path.join(root, 'memoria', 'locks');
  const out = new Map<string, Trava>();
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
    const card = /^card-([0-9a-f]{8})\.humano\.json$/i.exec(f)?.[1];
    const t = card && (await lerTrava(root, card));
    if (t) out.set(card, t);
  }
  return out;
}

export async function assumir(root: string, p: Pick<Project, 'id' | 'assets'>, quem: string, passosAntes: number): Promise<Trava> {
  const alvo = cardDoProjeto(root, p);
  if (!alvo) throw httpErro('este projeto não é de um card da produtora (nenhum arquivo em producao/)', 409);
  const atual = await lerTrava(root, alvo.card);
  if (atual) throw httpErro(`o card ${alvo.card} já está em edição por ${atual.quem} desde ${atual.desde}`, 409);
  const filaArq = path.join(root, 'FILA.md');
  const troca = trocarEstado(await fs.readFile(filaArq, 'utf8').catch(() => ''), alvo.card, ESTADO_TRAVADO, hoje());
  if (!troca) throw httpErro(`o card ${alvo.card} não está entre os cards em andamento da FILA.md`, 409);
  const trava: Trava = { card: alvo.card, projectId: p.id, quem, desde: new Date().toISOString(), estadoAntes: troca.antes, passosAntes };
  await fs.mkdir(path.dirname(travaArq(root, alvo.card)), { recursive: true });
  await gravar(travaArq(root, alvo.card), JSON.stringify(trava, null, 1));
  if (troca.antes !== ESTADO_TRAVADO) await gravar(filaArq, troca.md);
  return trava;
}

/** Seção acrescentada ao PROJETO.md do card ao devolver. */
export function notaDevolucao(t: Trava, fim: Date, passos: string[]): string {
  const data = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 16);
  const lista = passos.length ? passos.map((s) => `- ${s}`).join('\n') : '- nenhuma alteração na timeline';
  return (
    `\n\n## ${data(fim)} · ${t.quem} devolveu a edição ao agente (Editor Brain)\n\n` +
    `${t.quem} assumiu a edição em ${data(new Date(t.desde))} (projeto ${t.projectId}) e fez, nesta ordem:\n\n${lista}\n\n` +
    `Estado do card volta para \`${t.estadoAntes}\`. Parta da timeline como ${t.quem} deixou; não desfaça essas mudanças sem pedir.\n`
  );
}

export async function devolver(root: string, p: Pick<Project, 'assets'>, passos: string[]): Promise<{ trava: Trava; estado: string; nota: string }> {
  const alvo = cardDoProjeto(root, p);
  const trava = alvo && (await lerTrava(root, alvo.card));
  if (!alvo || !trava) throw httpErro('este projeto não está em edição por humano', 409);
  const filaArq = path.join(root, 'FILA.md');
  const md = await fs.readFile(filaArq, 'utf8').catch(() => '');
  // Só volta o estado se ninguém o mudou enquanto o humano editava (o gestor pode ter movido o card).
  const atual = trocarEstado(md, alvo.card, ESTADO_TRAVADO, hoje())?.antes;
  let estado = atual ?? '';
  if (atual === ESTADO_TRAVADO) {
    const troca = trocarEstado(md, alvo.card, trava.estadoAntes, hoje())!;
    await gravar(filaArq, troca.md);
    estado = trava.estadoAntes;
  }
  const nota = notaDevolucao({ ...trava, estadoAntes: estado || trava.estadoAntes }, new Date(), passos);
  await fs.appendFile(path.join(alvo.dir, 'PROJETO.md'), nota);
  await fs.rm(travaArq(root, alvo.card), { force: true });
  return { trava, estado, nota };
}
