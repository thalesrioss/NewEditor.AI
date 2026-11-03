/**
 * Padrão de cor do cliente (BL-0161): o perfil guarda uma grade (formato `ColorGrade`) e até 3 stills de referência
 * (na pasta do perfil, `perfis/<id>/stills/`). Projeto do cliente recebe a grade nos clipes da fala quando eles entram
 * na montagem, como grade de clipe (por cima da conversão LOG do arquivo), marcada como herdada (`gradeHerdada`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { clipesHerdadosDeOutro, clipesParaPadraoCor, clipGradeOf, isNeutral, PADRAO_COR_STILLS_MAX, PERSONALIZADO_ID, type ClientProfile, type ColorGrade, type PadraoCor, type Project } from '@neweditor/core';
import { getProfile, gravarPadraoCor, perfilGravadoDoProjeto, profileOf, PROFILES_DIR } from './profiles.ts';
import { store } from './store.ts';

const erro = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const STILL_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const stillsDir = (profileId: string): string => path.join(PROFILES_DIR, profileId, 'stills');

/** Nome de still que o servidor grava (`salvarPadraoCor`); qualquer outro (`..`, barra) nunca vira caminho. */
export const nomeDeStill = (nome: string): boolean => /^still-\d+-\d+\.(jpg|png|webp)$/.test(nome);

/** O perfil gravado com esse id (sem cair no padrão da casa). */
async function perfil(id: string): Promise<ClientProfile> {
  const prof = await getProfile(id);
  if (prof.id !== id) throw erro('perfil não existe', 404);
  return prof;
}

export async function lerPadraoCor(profileId: string): Promise<PadraoCor | null> {
  return (await perfil(profileId)).cor.padrao ?? null;
}

/**
 * "Salvar como padrão do cliente": a grade substitui a anterior (sem conversão de entrada: ela vai por cima da do
 * arquivo); os stills (data URL jpeg/png/webp) somam aos que já estão, no máximo PADRAO_COR_STILLS_MAX. Passou: 409, nada grava.
 */
export async function salvarPadraoCor(profileId: string, body: { grade?: unknown; stills?: unknown }, origem?: Pick<Project, 'id' | 'name'>): Promise<PadraoCor> {
  const prof = await perfil(profileId);
  const g = body.grade as ColorGrade | undefined;
  if (!g || typeof g !== 'object' || typeof g.exposure !== 'number' || typeof g.saturation !== 'number') throw erro('grade precisa ser uma ColorGrade', 400);
  const novos = body.stills === undefined ? [] : body.stills;
  if (!Array.isArray(novos)) throw erro('stills precisa ser uma lista de imagens (data URL)', 400);
  const imgs = novos.map((s, i) => {
    const m = typeof s === 'string' ? /^data:(image\/[a-z]+);base64,(.+)$/s.exec(s) : null;
    const ext = m && STILL_MIME[m[1]!];
    if (!m || !ext) throw erro(`still ${i + 1}: precisa ser uma imagem JPEG, PNG ou WebP em data URL`, 400);
    return { ext, bytes: Buffer.from(m[2]!, 'base64') };
  });
  const atuais = prof.cor.padrao?.stills ?? [];
  if (atuais.length + imgs.length > PADRAO_COR_STILLS_MAX) {
    throw erro(`O padrão de cor guarda no máximo ${PADRAO_COR_STILLS_MAX} stills de referência: ${prof.nome} já tem ${atuais.length}${imgs.length > 1 ? ` e vieram ${imgs.length}` : ''}. Apague um still antes de salvar outro.`, 409);
  }
  const dir = stillsDir(prof.id);
  const gravados: string[] = [];
  if (imgs.length) await fs.mkdir(dir, { recursive: true });
  for (const [i, img] of imgs.entries()) {
    const nome = `still-${Date.now()}-${i + 1}.${img.ext}`;
    await fs.writeFile(path.join(dir, nome), img.bytes);
    gravados.push(nome);
  }
  const padrao: PadraoCor = { grade: clipGradeOf(g), stills: [...atuais, ...gravados], salvoEm: new Date().toISOString(), ...(origem ? { origem: { projectId: origem.id, projectName: origem.name } } : {}) };
  await gravarPadraoCor(prof.id, padrao);
  return padrao;
}

/** Tira um still do padrão (e apaga o arquivo). */
export async function apagarStill(profileId: string, nome: string): Promise<PadraoCor> {
  const prof = await perfil(profileId);
  const padrao = prof.cor.padrao;
  if (!nomeDeStill(nome) || !padrao?.stills.includes(nome)) throw erro('still não existe', 404);
  await fs.rm(path.join(stillsDir(prof.id), nome), { force: true });
  const next = { ...padrao, stills: padrao.stills.filter((s) => s !== nome) };
  await gravarPadraoCor(prof.id, next);
  return next;
}

/** Caminho de um still do padrão (só os listados no perfil). */
export async function stillFile(profileId: string, nome: string): Promise<string> {
  const padrao = await lerPadraoCor(profileId);
  if (!nomeDeStill(nome) || !padrao?.stills.includes(nome)) throw erro('still não existe', 404);
  return path.join(stillsDir(profileId), nome);
}

/** Perfil gravado do projeto, para salvar o padrão de cor pela aba Cor. */
export const perfilDoProjetoParaCor = (p: Project): Promise<ClientProfile> => perfilGravadoDoProjeto(p, 'padrão de cor');

/**
 * Herança (BL-0161): os clipes da fala ainda sem grade de clipe recebem a grade do padrão de cor do perfil do projeto,
 * numa op só (um passo de desfazer), marcados com o id do perfil. Perfil sem padrão (ou "Personalizado"): nada muda.
 * Devolve quantos clipes receberam.
 */
export async function herdarPadraoCor(projectId: string): Promise<number> {
  const p = store.get(projectId);
  const prof = p.profileId === PERSONALIZADO_ID ? null : await profileOf(p).catch(() => null);
  const padrao = prof?.cor.padrao;
  if (!prof || !padrao || isNeutral(clipGradeOf(padrao.grade))) {
    // O projeto trocou para um perfil sem padrão: a grade herdada do cliente anterior sai (a posta à mão fica).
    const outros = clipesHerdadosDeOutro(p.timeline, prof?.id);
    if (outros.length) store.apply(projectId, { by: 'system', op: { type: 'set_clip_grade', clipIds: outros, grade: null }, note: `Tirei a cor herdada do padrão de outro cliente de ${outros.length} clipe(s): ${prof ? `${prof.nome} não tem padrão de cor` : 'o perfil do projeto não guarda padrão de cor'}` });
    return 0;
  }
  // Sem grade de clipe, ou herdada de outro perfil (o projeto trocou de cliente): recebe a deste.
  const ids = clipesParaPadraoCor(p.timeline, p.assets, prof.id);
  if (!ids.length) return 0;
  store.apply(projectId, { by: 'system', op: { type: 'set_clip_grade', clipIds: ids, grade: padrao.grade, herdadaDe: prof.id }, note: `Cor do padrão de ${prof.nome} em ${ids.length} clipe(s) da fala, por cima da conversão da câmera` });
  return ids.length;
}
