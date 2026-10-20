/**
 * Perfis de edição por cliente (ADR-007, I-1): compilados dos `PADRAO - *.md` do Cérebro do Editor,
 * guardados em data/perfis/<id>.json e revisáveis na tela de perfis. Todas as etapas leem o perfil do
 * projeto por `profileOf(project)`.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addGlossario, compileProfileMarkdown, fillProfile, formatoLabel, guessFormato, HOUSE_PROFILE, PERSONALIZADO_ID, profileFromTimeline, type ClientProfile, type FormatoPeca, type Project } from '@neweditor/core';
import { DATA_DIR } from './config.ts';

export const PROFILES_DIR = path.join(path.dirname(DATA_DIR), 'perfis');
/** Pasta dos padrões no vault (o Thales escreve lá; o produto só lê). */
export const PADROES_DIR = process.env.NEWEDITOR_PADROES ?? path.join(os.homedir(), 'Documents', 'Cérebro do Editor', 'padroes');

const cache = new Map<string, ClientProfile>();
let loaded = false;

async function loadAll(): Promise<void> {
  if (loaded) return;
  await fs.mkdir(PROFILES_DIR, { recursive: true });
  for (const f of await fs.readdir(PROFILES_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(PROFILES_DIR, f), 'utf8')) as ClientProfile;
      cache.set(p.id, fillProfile(p));
    } catch {
      /* arquivo inválido: ignora */
    }
  }
  loaded = true;
}

export async function listProfiles(): Promise<ClientProfile[]> {
  await loadAll();
  const list = [...cache.values()].sort((a, b) => Number(!!b.padraoCasa) - Number(!!a.padraoCasa) || Number(!!b.validado) - Number(!!a.validado) || a.nome.localeCompare(b.nome));
  return list.some((p) => p.padraoCasa) ? list : [HOUSE_PROFILE, ...list];
}

/** O padrão da casa: o perfil marcado como `padraoCasa` (o do Thales), senão o padrão genérico. */
export async function houseProfile(): Promise<ClientProfile> {
  await loadAll();
  return [...cache.values()].find((p) => p.padraoCasa) ?? HOUSE_PROFILE;
}

export async function getProfile(id: string | undefined): Promise<ClientProfile> {
  await loadAll();
  return (id && cache.get(id)) || houseProfile();
}

/** Marca um perfil como padrão da casa (e desmarca os outros). */
export async function setHouse(id: string): Promise<ClientProfile> {
  await loadAll();
  const target = cache.get(id);
  if (!target) throw Object.assign(new Error('perfil não existe'), { statusCode: 404 });
  for (const p of cache.values()) if (p.padraoCasa && p.id !== id) await save({ ...p, padraoCasa: false });
  return save({ ...target, padraoCasa: true, validado: true });
}

/** Perfil do projeto (padrão da casa quando não tem). "Personalizado" = a própria edição deste projeto, lida ao vivo. */
export async function profileOf(p: Project): Promise<ClientProfile> {
  if (p.profileId === PERSONALIZADO_ID) return profileFromTimeline(p.timeline, await houseProfile(), { id: PERSONALIZADO_ID, nome: 'Personalizado (esta edição)', cliente: p.client, origem: { projectId: p.id, projectName: p.name, at: new Date().toISOString() } });
  return getProfile(p.profileId);
}

/** Prévia do padrão editorial que a edição deste projeto daria (sem gravar). */
export async function profileFromProject(p: Project, opts: { cliente?: string; formato?: FormatoPeca; nome?: string } = {}): Promise<ClientProfile> {
  const cliente = (opts.cliente ?? p.client ?? p.name).trim();
  const formato = opts.formato ?? p.task?.formato ?? guessFormato(p.timeline.width, p.timeline.height);
  const nome = opts.nome?.trim() || `${cliente} · ${formatoLabel(formato)}`;
  return profileFromTimeline(p.timeline, await houseProfile(), { id: slug(`${cliente}-${formato}`), nome, cliente, formatoPeca: formato, origem: { projectId: p.id, projectName: p.name, at: new Date().toISOString() } });
}

/**
 * "Tornar esta edição o padrão editorial do cliente": mede a edição e grava como perfil validado do cliente
 * para aquele formato (um por cliente+formato; gravar de novo substitui, guardando o que o Thales marcou à mão).
 */
export async function saveProfileFromProject(p: Project, opts: { cliente?: string; formato?: FormatoPeca; nome?: string } = {}): Promise<ClientProfile> {
  await loadAll();
  const next = await profileFromProject(p, opts);
  const cur = cache.get(next.id);
  return save(cur ? { ...next, padraoCasa: cur.padraoCasa, notas: [...next.notas.slice(0, 1), ...cur.notas.filter((n) => !n.startsWith('Padrão editorial lido da edição'))] } : next);
}

async function save(p: ClientProfile): Promise<ClientProfile> {
  await loadAll();
  const full = fillProfile({ ...p, atualizadoEm: new Date().toISOString() });
  cache.set(full.id, full);
  await fs.writeFile(path.join(PROFILES_DIR, `${full.id}.json`), JSON.stringify(full, null, 2));
  return full;
}

export async function patchProfile(id: string, patch: Partial<ClientProfile>): Promise<ClientProfile> {
  const cur = await getProfile(id);
  if (cur.id === 'casa' && id !== 'casa') throw Object.assign(new Error('perfil não existe'), { statusCode: 404 });
  const merged = fillProfile({ ...cur, ...patch, id: cur.id, evidencia: { ...cur.evidencia, ...(patch.evidencia ?? {}) } });
  // Campos estruturados: mescla por grupo para o PATCH não apagar o que não veio.
  for (const k of ['formato', 'peca', 'corte', 'zoom', 'lettering', 'motion', 'flash', 'sfx', 'legenda', 'trilha', 'cor', 'broll'] as const) {
    if (patch[k]) (merged as unknown as Record<string, unknown>)[k] = { ...(cur[k] as object), ...(patch[k] as object) };
  }
  return save(merged);
}

/**
 * "Guardar no perfil do cliente" (BL-0081): o termo entra no topo do glossário do perfil do projeto (o da casa se
 * o projeto não escolheu). "Personalizado" não é um perfil gravado: não tem onde guardar.
 */
export async function addTermoAoPerfil(p: Project, termo: string): Promise<ClientProfile> {
  if (!termo.trim()) throw Object.assign(new Error('termo vazio'), { statusCode: 400 });
  if (p.profileId === PERSONALIZADO_ID) throw Object.assign(new Error('O perfil "Personalizado" não guarda glossário: escolha o perfil do cliente no projeto.'), { statusCode: 409 });
  const prof = await getProfile(p.profileId);
  return patchProfile(prof.id, { glossario: addGlossario(prof.glossario, termo) });
}

export async function createProfile(nome: string, baseId?: string): Promise<ClientProfile> {
  const base = await getProfile(baseId);
  const id = slug(nome);
  return save(fillProfile({ ...base, id, nome, fonte: undefined, atualizadoEm: new Date().toISOString() }));
}

export function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'cliente';
}

/**
 * Importa os `PADRAO - *.md` do vault. Um perfil que já foi editado na tela não é sobrescrito: só os
 * campos ainda não revisados (sem `revisado`) e as notas são atualizados.
 */
export async function importPadroes(): Promise<{ importados: string[]; atualizados: string[]; origem: string }> {
  await loadAll();
  const importados: string[] = [];
  const atualizados: string[] = [];
  let files: string[] = [];
  try {
    files = (await fs.readdir(PADROES_DIR)).filter((f) => /^PADRAO - .*\.md$/i.test(f));
  } catch {
    return { importados, atualizados, origem: PADROES_DIR };
  }
  for (const f of files) {
    const md = await fs.readFile(path.join(PADROES_DIR, f), 'utf8');
    const nome = f.replace(/^PADRAO - /i, '').replace(/\.md$/, '').replace(/\s*\(.*\)\s*$/, '').trim();
    const id = slug(nome.split('·')[0]!.split(' Talk')[0]!);
    const compiled = compileProfileMarkdown(id, nome, md, path.join(PADROES_DIR, f));
    // Decisão do Thales (2026-10-10): só o estilo DELE é padrão de sucesso; os outros são testes que não ficaram bons.
    const isThales = id === 'thales';
    Object.assign(compiled, isThales ? { validado: true, padraoCasa: true } : { validado: false, nota: 'Teste que não ficou bom — não é referência (Thales, 2026-10-10).' });
    const cur = cache.get(id);
    if (!cur) {
      await save(compiled);
      importados.push(id);
    } else {
      // Mantém o que o Thales revisou; atualiza notas e evidências vindas do vault.
      await save({ ...compiled, ...cur, notas: compiled.notas, fonte: compiled.fonte, evidencia: { ...compiled.evidencia, ...cur.evidencia }, validado: cur.validado ?? compiled.validado, padraoCasa: cur.padraoCasa ?? compiled.padraoCasa, nota: cur.nota ?? compiled.nota });
      atualizados.push(id);
    }
  }
  return { importados, atualizados, origem: PADROES_DIR };
}
