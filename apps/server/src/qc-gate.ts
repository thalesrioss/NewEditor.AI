/**
 * O `qc-tecnico` como gate do render (FB-0180 A4): mede o arquivo com o projeto e a assinatura de cor do cliente, grava
 * o laudo ao lado do render (`<render>.qc-tecnico.txt`) e diz se a entrega pode sair. A assinatura é a medida dos
 * aprovados do cliente: `<dados>/assinaturas/<cliente>.json`, ou a que vem com o produto em `data/assinaturas/`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@neweditor/core';
import { DATA_ROOT, ROOT } from './config.ts';
import { qcTecnico, tabelaQc, type Assinatura, type QcTecnico } from './qc-tecnico.ts';
import { clienteDoProjeto } from './registro-thales.ts';

export async function assinaturaDoCliente(p: Pick<Project, 'name' | 'client' | 'task' | 'assets'>): Promise<Assinatura | undefined> {
  const cliente = await clienteDoProjeto(p).catch(() => undefined);
  if (!cliente) return undefined;
  for (const dir of [path.join(DATA_ROOT, 'assinaturas'), path.join(ROOT, 'data', 'assinaturas')]) {
    const j = await fs.readFile(path.join(dir, `${cliente}.json`), 'utf8').catch(() => null);
    if (j) return JSON.parse(j) as Assinatura;
  }
  return undefined;
}

/** Roda o gate e grava o laudo; falha de medida vira reprovação com o motivo (nunca aprova sem medir). */
export async function gateTecnico(p: Project, file: string): Promise<QcTecnico> {
  let r: QcTecnico;
  try {
    r = await qcTecnico(file, { project: p, assinatura: await assinaturaDoCliente(p) });
  } catch (e) {
    r = { aprovado: false, arquivo: file, achados: [{ regra: 'medida', ok: false, medido: (e as Error).message.slice(0, 200), limite: 'gate precisa medir o arquivo' }], avisos: [] };
  }
  await fs.writeFile(`${file.replace(/\.mp4$/i, '')}.qc-tecnico.txt`, tabelaQc(r) + '\n').catch(() => undefined);
  return r;
}
