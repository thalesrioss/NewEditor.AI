/**
 * O `qc-tecnico` como gate do render (FB-0180 A4): mede o arquivo com o projeto e a assinatura de cor do cliente, grava
 * o laudo ao lado do render (`<render>.qc-tecnico.txt`) e diz se a entrega pode sair. A assinatura é a medida dos
 * aprovados do cliente: `<dados>/assinaturas/<cliente>.json`, ou a que vem com o produto em `data/assinaturas/`. Com
 * padrão de cor no perfil do cliente (BL-0161), a saturação e a luma de cada clipe são medidas contra os stills dele,
 * no lugar da assinatura.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@neweditor/core';
import { DATA_ROOT, ROOT } from './config.ts';
import { nomeDeStill, stillsDir } from './padrao-cor.ts';
import { profileOf } from './profiles.ts';
import { qcTecnico, referenciaDosStills, tabelaQc, type Assinatura, type QcTecnico, type ReferenciaCor } from './qc-tecnico.ts';
import { clienteDoProjeto } from './registro-thales.ts';

/**
 * Padrão de cor do cliente para o gate (BL-0161): a referência medida nos stills do padrão do perfil do projeto. Sem
 * padrão, ou padrão sem still, `undefined` (o gate fica como era: assinatura do cliente ou a fixa) com o motivo em `aviso`.
 */
export async function padraoCorDoProjeto(p: Pick<Project, 'profileId' | 'timeline' | 'client' | 'id' | 'name'>): Promise<{ ref?: ReferenciaCor; aviso?: string }> {
  const prof = await profileOf(p as Project).catch(() => undefined);
  const padrao = prof?.cor.padrao;
  if (!prof || !padrao) return {};
  // Só julga pelo padrão o projeto que o seguiu (≥1 clipe da fala herdou dele). Projeto feito antes do padrão, ou com a
  // cor à mão, fica no gate de antes: salvar o padrão hoje não reprova o lote que já estava em andamento.
  if (!p.timeline.main.some((c) => c.gradeHerdada === prof.id)) return { aviso: `padrão de cor de ${prof.nome} salvo depois deste projeto (nenhum clipe herdou): não conferido, saturação contra a assinatura` };
  if (!padrao.stills.length) return { aviso: `o padrão de cor de ${prof.nome} não tem still de referência: saturação contra a assinatura, luma não conferida` };
  const files = padrao.stills.filter(nomeDeStill).map((s) => path.join(stillsDir(prof.id), s));
  try {
    return { ref: await referenciaDosStills(files, `padrão de cor de ${prof.nome} (${files.length} still${files.length > 1 ? 's' : ''})`) };
  } catch (e) {
    return { aviso: `não consegui medir os stills do padrão de cor de ${prof.nome} (${(e as Error).message.slice(0, 120)}): saturação contra a assinatura` };
  }
}

export async function assinaturaDoCliente(p: Pick<Project, 'name' | 'client' | 'task' | 'assets'>): Promise<Assinatura | undefined> {
  const cliente = await clienteDoProjeto(p).catch(() => undefined);
  if (!cliente) return undefined;
  for (const dir of [path.join(DATA_ROOT, 'assinaturas'), path.join(ROOT, 'data', 'assinaturas')]) {
    const j = await fs.readFile(path.join(dir, `${cliente}.json`), 'utf8').catch(() => null);
    if (j) return JSON.parse(j) as Assinatura;
  }
  return undefined;
}

/**
 * Render reprovado ganha `_REPROVADO` no nome (e o laudo junto), para não sair como entrega por engano. Devolve o
 * caminho relativo novo; o QC do projeto passa a apontar para ele.
 */
export async function marcarReprovado(dir: string, rel: string): Promise<string> {
  const novo = rel.replace(/\.mp4$/i, '_REPROVADO.mp4');
  const abs = (f: string) => path.join(dir, f);
  await fs.rename(abs(rel), abs(novo));
  await fs.rename(abs(rel.replace(/\.mp4$/i, '.qc-tecnico.txt')), abs(novo.replace(/\.mp4$/i, '.qc-tecnico.txt'))).catch(() => undefined);
  return novo;
}

/** Roda o gate e grava o laudo; falha de medida vira reprovação com o motivo (nunca aprova sem medir). */
export async function gateTecnico(p: Project, file: string): Promise<QcTecnico> {
  let r: QcTecnico;
  try {
    const cor = await padraoCorDoProjeto(p);
    r = await qcTecnico(file, { project: p, assinatura: await assinaturaDoCliente(p), padraoCor: cor.ref });
    if (cor.aviso) r.avisos.push(cor.aviso);
  } catch (e) {
    r = { aprovado: false, arquivo: file, achados: [{ regra: 'medida', ok: false, medido: (e as Error).message.slice(0, 200), limite: 'gate precisa medir o arquivo' }], avisos: [] };
  }
  await fs.writeFile(`${file.replace(/\.mp4$/i, '')}.qc-tecnico.txt`, tabelaQc(r) + '\n').catch(() => undefined);
  return r;
}
