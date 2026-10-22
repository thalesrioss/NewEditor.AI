/**
 * Central da NewStudios (FB-0169): o app de desktop abre direto na mesma fonte de projetos e vídeos que os editores
 * agentes usam (`~/newstudios/bin/editor-brain`: tela 5410, API 4410, dados em ~/newstudios/editor-brain/data),
 * sem botão de escolher origem. Só quando a central não responde o app sobe o servidor próprio (reserva),
 * e a janela diz isso no título.
 *
 *  · NEWEDITOR_CENTRAL_URL: outra central (ex.: http://127.0.0.1:5410); vazio, `off` ou `0` desliga.
 *  · NEWEDITOR_DEV_URL continua vencendo tudo (desenvolvimento).
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const CENTRAL_PADRAO = 'http://127.0.0.1:5410';
/** Pasta de dados da central (só para o menu "Pasta de dados"; quem lê e grava é o servidor da central). */
export const CENTRAL_DADOS_PADRAO = path.join(os.homedir(), 'newstudios', 'editor-brain', 'data');

type Env = Record<string, string | undefined>;

/** URL da central pelo ambiente, sem barra no fim; null quando desligada. */
export function centralUrl(env: Env): string | null {
  const v = env.NEWEDITOR_CENTRAL_URL;
  if (v === undefined) return CENTRAL_PADRAO;
  const t = v.trim();
  if (!t || t === 'off' || t === '0') return null;
  return t.replace(/\/+$/, '');
}

/** A central está no ar quando `/api/health` devolve 200 com `ok: true` (o mesmo teste do bin/editor-brain). */
export function centralNoAr(url: string, ms = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, { timeout: ms }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => (body += d));
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 && (JSON.parse(body) as { ok?: unknown }).ok === true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

export type Origem = { tipo: 'dev'; url: string } | { tipo: 'central'; url: string } | { tipo: 'local'; motivo: string };

/**
 * De onde a janela abre: desenvolvimento, central da NewStudios ou servidor próprio (reserva).
 * Tenta a central algumas vezes (ela pode estar subindo junto com o Mac) antes de cair na reserva.
 */
export async function escolherOrigem(
  env: Env,
  opts: { noAr?: (url: string) => Promise<boolean>; tentativas?: number; esperaMs?: number } = {},
): Promise<Origem> {
  if (env.NEWEDITOR_DEV_URL) return { tipo: 'dev', url: env.NEWEDITOR_DEV_URL };
  const url = centralUrl(env);
  if (!url) return { tipo: 'local', motivo: 'central desligada (NEWEDITOR_CENTRAL_URL)' };
  const noAr = opts.noAr ?? ((u: string) => centralNoAr(u));
  const tentativas = Math.max(1, opts.tentativas ?? 3);
  for (let i = 0; i < tentativas; i++) {
    if (await noAr(url)) return { tipo: 'central', url };
    if (i < tentativas - 1) await new Promise((r) => setTimeout(r, opts.esperaMs ?? 1000));
  }
  return { tipo: 'local', motivo: `a central da NewStudios não respondeu em ${url}` };
}
