/**
 * Galeria de vídeos editados (FB-0169): todas as versões entregues pela produtora (`<produtora>/producao/<cliente>/
 * <card>/entrega/*.mp4`), com cliente, card, editor e etapa lidos da `FILA.md`, e o projeto do Editor Brain que
 * gerou cada uma (pelo bruto dentro da pasta do card). Só leitura: nada aqui escreve na pasta da produtora.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Project } from '@neweditor/core';

/** Raiz da produtora (FILA.md e producao/). Padrão: ~/newstudios. */
export const PRODUTORA_DIR = process.env.NEWEDITOR_PRODUTORA ?? path.join(os.homedir(), 'newstudios');
/** Prefixo HTTP dos arquivos de `producao/` (servidos com Range, como os renders). */
export const PRODUCAO_PREFIX = '/producao/';
/**
 * Só os vídeos de `entrega/` saem por `/producao/` (BL-0119, revisão do lead): bruto, PROJETO.md, brief, EDL e o
 * QC.md da entrega ficam fora. `p` é o caminho já sem o prefixo, como o @fastify/static entrega ao `allowedPath`.
 */
export const entregaPublica = (p: string): boolean => /^\/[^/]+\/[^/]+\/entrega\/[^/]+\.(mp4|mov)$/i.test(p);

export interface CardFila {
  card: string;
  cliente: string;
  titulo: string;
  etapa: string;
  editor: string;
  pasta: string;
  trello?: string;
  drive?: string;
}

export interface VideoEditado {
  /** Caminho relativo a `producao/` (estável: serve de id). */
  id: string;
  url: string;
  arquivo: string;
  versao: number | null;
  cliente: string;
  card: string;
  titulo: string;
  etapa: string;
  editor: string;
  data: string;
  bytes: number;
  trello?: string;
  drive?: string;
  projectId?: string;
}

const cell = (s: string | undefined) => (s ?? '').trim();

/** Cards das duas tabelas da FILA.md (Em andamento e Entregues). Linha fora do formato é ignorada. */
export function parseFila(md: string): CardFila[] {
  const out: CardFila[] = [];
  let entregues = false;
  for (const line of md.split('\n')) {
    if (/^##\s/.test(line)) entregues = /entregue/i.test(line);
    if (!line.startsWith('|')) continue;
    const c = line.split('|').slice(1, -1);
    if (c.length < 8 || !/^[0-9a-f]{8}$/i.test(cell(c[0]))) continue;
    const obs = cell(c[9]);
    const trello = /Id Trello(?: completo)? ([0-9a-f]{24})/i.exec(obs)?.[1] ?? /https:\/\/trello\.com\/c\/[\w-]+/.exec(obs)?.[0];
    out.push({
      card: cell(c[0]),
      cliente: cell(c[1]),
      titulo: cell(c[2]),
      etapa: entregues ? `entregue (${cell(c[4])})` : cell(c[4]),
      editor: cell(c[5]),
      pasta: cell(c[7]),
      trello: trello && !trello.startsWith('http') ? `https://trello.com/c/${trello}` : trello,
      drive: /https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view/.exec(obs)?.[0],
    });
  }
  return out;
}

/** Número da versão no nome do arquivo (`..._v3.mp4` → 3). */
export const versaoDoArquivo = (nome: string): number | null => {
  const m = /[_-]v(\d+)(?:[_-][^/]*)?\.\w+$/i.exec(nome);
  return m ? Number(m[1]) : null;
};

/** Todas as versões em `producao/<cliente>/<card>/entrega/`, mais recente primeiro. */
export async function listVideos(root: string, projects: Pick<Project, 'id' | 'assets' | 'createdAt'>[] = []): Promise<VideoEditado[]> {
  const producao = path.join(root, 'producao');
  const fila = parseFila(await fs.readFile(path.join(root, 'FILA.md'), 'utf8').catch(() => ''));
  const dirs = async (d: string) => (await fs.readdir(d, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  const out: VideoEditado[] = [];
  for (const cliente of await dirs(producao)) {
    for (const pasta of await dirs(path.join(producao, cliente))) {
      const entrega = path.join(producao, cliente, pasta, 'entrega');
      const files = (await fs.readdir(entrega).catch(() => [])).filter((f) => /\.(mp4|mov)$/i.test(f) && !f.startsWith('.'));
      if (!files.length) continue;
      const cardId = /^([0-9a-f]{8})/i.exec(pasta)?.[1] ?? '';
      const f = fila.find((x) => x.card === cardId) ?? fila.find((x) => x.pasta.replace(/\/$/, '').endsWith(`${cliente}/${pasta}`));
      const cardDir = path.join(producao, cliente, pasta) + path.sep;
      // O projeto que editou o card: o mais recente com algum arquivo dentro da pasta do card.
      const projeto = projects.filter((p) => p.assets.some((a) => a.path?.startsWith(cardDir))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      for (const arquivo of files) {
        const st = await fs.stat(path.join(entrega, arquivo)).catch(() => null);
        if (!st?.isFile()) continue;
        const rel = [cliente, pasta, 'entrega', arquivo].join('/');
        out.push({
          id: rel,
          url: PRODUCAO_PREFIX + rel.split('/').map(encodeURIComponent).join('/'),
          arquivo,
          versao: versaoDoArquivo(arquivo),
          cliente: f?.cliente || cliente,
          card: cardId || pasta,
          titulo: f?.titulo || pasta.replace(/^[0-9a-f]{8}-?/i, '').replace(/-/g, ' '),
          etapa: f?.etapa ?? '',
          editor: f?.editor ?? '',
          data: st.mtime.toISOString(),
          bytes: st.size,
          trello: f?.trello,
          drive: f?.drive,
          projectId: projeto?.id,
        });
      }
    }
  }
  return out.sort((a, b) => b.data.localeCompare(a.data));
}
