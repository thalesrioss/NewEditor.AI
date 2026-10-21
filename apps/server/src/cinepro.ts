/**
 * CinePRO dentro do Editor Brain, pela NUVEM do CinePRO (pedido do Thales: os arquivos renomeados com o
 * branding, não o pack local). É o mesmo sistema do plugin: o manifesto público (categorias branded, ids,
 * tags, conceitos) e os arquivos na CDN própria (R2) em `{id}.{ext}`, com o Drive como reserva.
 *
 *  · manifesto: NEWEDITOR_CINEPRO_MANIFEST ou o publicado no jsDelivr (cópia em data/cinepro-manifest.json;
 *    reserva: manifest/dist/manifest.json do projeto CinePRO no disco);
 *  · arquivos: baixados sob demanda para data/cinepro-cache/files/{id}.{ext} (cache permanente — os projetos
 *    apontam para esse caminho) e miniaturas em data/cinepro-cache/thumbs/.
 *
 * Três lugares: CinePRO (som) e Efeitos (visual) são abas do trilho; LUTs (CinePRO Looks) ficam na aba Cor.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { anchorAt, cutEndAfter, localLutPath, parseCube, SFX_CONCEPTS, timelineDuration, type CubeLut, type SfxKind } from '@neweditor/core';
import { DATA_ROOT } from './config.ts';
import { ingest } from './ingest.ts';
import { run } from './media.ts';
import { useAsTrilha } from './music.ts';
import { store } from './store.ts';

const MANIFEST_URL = process.env.NEWEDITOR_CINEPRO_MANIFEST ?? 'https://cdn.jsdelivr.net/gh/thalesrioss/cinepro@main/manifest/dist/manifest.json';
const MANIFEST_LOCAL = path.join(os.homedir(), 'Documents', 'Claude', 'CinePRO', 'manifest', 'dist', 'manifest.json');
const CDN_BASE = (process.env.NEWEDITOR_CINEPRO_CDN ?? 'https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev').replace(/\/+$/, '');
const MANIFEST_COPY = path.join(DATA_ROOT, 'cinepro-manifest.json');
const CACHE_DIR = path.join(DATA_ROOT, 'cinepro-cache');
const FILES_DIR = path.join(CACHE_DIR, 'files');
const THUMBS_DIR = path.join(CACHE_DIR, 'thumbs');
const MANIFEST_TTL = 24 * 3600 * 1000;

export type CineproTipo = 'sfx' | 'musica' | 'overlay' | 'transicao' | 'flare' | 'frame' | 'gif' | 'lowerthird' | 'lut' | 'preset' | 'outro';
export const CINEPRO_TIPOS: Record<CineproTipo, string> = { sfx: 'SFX', musica: 'Trilha', overlay: 'Overlay', transicao: 'Transição', flare: 'Lens flare', frame: 'Frame', gif: 'GIF', lowerthird: 'Lower third', lut: 'Look (LUT)', preset: 'Preset', outro: 'Outro' };
/** Que abas mostram cada tipo: CinePRO = som; Efeitos = visual; Cor = looks. */
export type CineproModo = 'som' | 'visual' | 'lut';
const MODO_TIPOS: Record<CineproModo, CineproTipo[]> = { som: ['sfx', 'musica'], visual: ['overlay', 'transicao', 'flare', 'frame', 'gif', 'lowerthird', 'preset'], lut: ['lut'] };
/** Nomes que o editor usa para cada aba ("cor" é o nome da aba dos looks na interface; CH-0001). */
const MODO_ALIAS: Record<string, CineproModo> = { som: 'som', sons: 'som', audio: 'som', sfx: 'som', visual: 'visual', efeitos: 'visual', lut: 'lut', luts: 'lut', cor: 'lut', look: 'lut', looks: 'lut' };

/** Modo da query (com apelidos); desconhecido vira erro 400 com os valores aceitos, nunca 500. */
export function cineproModo(raw?: string): CineproModo {
  if (raw === undefined || raw === '') return 'som';
  const modo = MODO_ALIAS[norm(raw.trim())];
  if (!modo) throw Object.assign(new Error(`modo "${raw}" desconhecido: use som, visual ou lut (looks / cor)`), { statusCode: 400 });
  return modo;
}

export interface CineproItem {
  id: string;
  nome: string;
  ext: string;
  kind: string;
  tipo: CineproTipo;
  /** Categoria branded ("CinePRO Sound Design") e o caminho das subpastas dentro dela. */
  categoria: string;
  pasta: string;
  tags: string[];
  tamanho: number;
  thumb: boolean;
  insere: boolean;
}
export interface CineproNode {
  nome: string;
  rel: string;
  itens: number;
  filhos: CineproNode[];
}
interface Manifest {
  version: number;
  builtAt: string;
  files: { id: string; name: string; ext: string; kind: string; thumb?: string | null; category: string; subcategory?: string | null; path?: string[]; tags?: string[]; size?: number | string }[];
  concepts?: { name: string; keys: string[] }[];
}

let cache: { at: number; itens: CineproItem[]; arvore: Record<CineproModo, CineproNode[]>; builtAt: string; concepts: Manifest['concepts'] } | null = null;

function tipoOf(f: Manifest['files'][number]): CineproTipo {
  const ext = f.ext.toLowerCase();
  const p = `${f.category}/${f.subcategory ?? ''}/${(f.path ?? []).join('/')}`.toLowerCase();
  if (ext === 'cube' || f.kind === 'lut') return 'lut';
  if (f.kind === 'preset' || f.kind === 'mogrt' || ['prfpset', 'mogrt', 'ffx'].includes(ext)) return 'preset';
  if (f.kind === 'audio') return /music|playlist|trilha|soundtrack/.test(p) ? 'musica' : 'sfx';
  if (/transi/.test(p)) return 'transicao';
  if (/flare|light leak/.test(p)) return 'flare';
  if (/frame/.test(p)) return 'frame';
  if (/lower/.test(p)) return 'lowerthird';
  if (ext === 'gif' || /\/gif\b/.test(p)) return 'gif';
  if (f.kind === 'video' || f.kind === 'image') return 'overlay';
  return 'outro';
}

function toItem(f: Manifest['files'][number]): CineproItem {
  const tipo = tipoOf(f);
  const ext = f.ext.toLowerCase();
  const pasta = [f.subcategory ?? '', ...(f.path ?? []).filter((x, i) => !(i === 0 && x === f.subcategory))].filter(Boolean).join('/');
  return { id: f.id, nome: f.name, ext, kind: f.kind, tipo, categoria: f.category, pasta, tags: f.tags ?? [], tamanho: Number(f.size ?? 0), thumb: !!f.thumb || f.kind === 'video' || f.kind === 'image', insere: f.kind === 'audio' || f.kind === 'video' || f.kind === 'image' };
}

function buildTree(itens: CineproItem[]): CineproNode[] {
  const root: CineproNode = { nome: '', rel: '', itens: 0, filhos: [] };
  for (const it of itens) {
    const parts = [it.categoria, ...it.pasta.split('/').filter(Boolean)];
    let node = root;
    let rel = '';
    for (const p of parts) {
      rel = rel ? `${rel}/${p}` : p;
      let child = node.filhos.find((c) => c.nome === p);
      if (!child) {
        child = { nome: p, rel, itens: 0, filhos: [] };
        node.filhos.push(child);
      }
      child.itens++;
      node = child;
    }
  }
  const sort = (n: CineproNode) => (n.filhos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), n.filhos.forEach(sort));
  sort(root);
  return root.filhos;
}

async function fetchManifest(): Promise<Manifest> {
  try {
    const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`manifesto ${res.status}`);
    const m = (await res.json()) as Manifest;
    if (!Array.isArray(m.files)) throw new Error('manifesto sem files');
    await fsp.mkdir(DATA_ROOT, { recursive: true });
    await fsp.writeFile(MANIFEST_COPY, JSON.stringify(m));
    return m;
  } catch (e) {
    for (const f of [MANIFEST_COPY, MANIFEST_LOCAL]) {
      try {
        return JSON.parse(await fsp.readFile(f, 'utf8')) as Manifest;
      } catch {
        /* próxima */
      }
    }
    throw new Error(`Não consegui ler o manifesto do CinePRO (${(e as Error).message}) e não há cópia local.`);
  }
}

/** O catálogo (da nuvem, com cópia local; recarregado a cada 24 h ou a pedido). */
export async function cineproCatalogo(force = false) {
  if (!force && cache && Date.now() - cache.at < MANIFEST_TTL) return cache;
  const m = await fetchManifest();
  const itens = m.files.map(toItem).sort((a, b) => `${a.categoria}/${a.pasta}/${a.nome}`.localeCompare(`${b.categoria}/${b.pasta}/${b.nome}`, 'pt-BR'));
  const arvore = { som: buildTree(itens.filter((i) => MODO_TIPOS.som.includes(i.tipo))), visual: buildTree(itens.filter((i) => MODO_TIPOS.visual.includes(i.tipo))), lut: buildTree(itens.filter((i) => MODO_TIPOS.lut.includes(i.tipo))) };
  cache = { at: Date.now(), itens, arvore, builtAt: m.builtAt, concepts: m.concepts };
  return cache;
}

export async function cineproResumo(modoRaw?: string) {
  const modo = cineproModo(modoRaw);
  const c = await cineproCatalogo();
  const lista = c.itens.filter((i) => MODO_TIPOS[modo].includes(i.tipo));
  const porTipo: Record<string, number> = {};
  for (const it of lista) porTipo[it.tipo] = (porTipo[it.tipo] ?? 0) + 1;
  return { fonte: 'nuvem', cdn: CDN_BASE, builtAt: c.builtAt, modo, total: lista.length, porTipo, arvore: c.arvore[modo], tipos: CINEPRO_TIPOS };
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Busca com filtros: modo (aba), pasta (prefixo da árvore), tipo e texto (nome, pasta, tags); paginada. */
export async function cineproItens(q: { modo?: string; pasta?: string; tipo?: string; busca?: string; offset?: number; limit?: number }): Promise<{ total: number; itens: CineproItem[] }> {
  const modo = cineproModo(q.modo);
  const c = await cineproCatalogo();
  const terms = norm(q.busca ?? '').split(/\s+/).filter(Boolean);
  const list = c.itens.filter((it) => {
    if (!MODO_TIPOS[modo].includes(it.tipo)) return false;
    if (q.tipo && it.tipo !== q.tipo) return false;
    if (q.pasta) {
      const rel = `${it.categoria}${it.pasta ? `/${it.pasta}` : ''}`;
      if (rel !== q.pasta && !rel.startsWith(`${q.pasta}/`)) return false;
    }
    if (terms.length) {
      const hay = norm(`${it.nome} ${it.pasta} ${it.tags.join(' ')}`);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.min(400, Math.max(1, q.limit ?? 120));
  return { total: list.length, itens: list.slice(offset, offset + limit) };
}

export async function cineproItem(id: string): Promise<CineproItem> {
  const c = await cineproCatalogo();
  const it = c.itens.find((x) => x.id === id);
  if (!it) throw Object.assign(new Error('item do CinePRO não existe no manifesto (atualize a biblioteca)'), { statusCode: 404 });
  return it;
}

/** Rotas de download, na ordem do plugin: CDN própria, depois o Drive público. */
const urlsOf = (it: CineproItem) => [`${CDN_BASE}/${it.id}.${it.ext}`, `https://drive.usercontent.google.com/download?id=${it.id}&export=download&confirm=t`];

/** Garante o arquivo no cache permanente (baixa uma vez) e devolve o caminho local. */
export async function cineproFile(id: string): Promise<{ item: CineproItem; file: string }> {
  const it = await cineproItem(id);
  await fsp.mkdir(FILES_DIR, { recursive: true });
  const file = path.join(FILES_DIR, `${it.id}.${it.ext}`);
  if (fs.existsSync(file) && (await fsp.stat(file)).size > 0) return { item: it, file };
  let lastErr: Error | null = null;
  for (const url of urlsOf(it)) {
    const tmp = `${file}.part`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (/text\/html/.test(type)) throw new Error('resposta HTML (não é o arquivo)');
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fs.createWriteStream(tmp));
      const size = (await fsp.stat(tmp)).size;
      if (size < 64) throw new Error('arquivo vazio');
      await fsp.rename(tmp, file);
      return { item: it, file };
    } catch (e) {
      lastErr = e as Error;
      await fsp.rm(tmp, { force: true });
    }
  }
  throw new Error(`Não consegui baixar "${it.nome}" da nuvem do CinePRO (${lastErr?.message ?? 'sem rota'}).`);
}

/** Miniatura: o thumb público do Drive (em cache) ou, para vídeo já baixado, um quadro. */
export async function cineproThumb(id: string): Promise<{ file: string; type: string } | null> {
  const it = await cineproItem(id);
  if (it.kind !== 'video' && it.kind !== 'image') return null;
  await fsp.mkdir(THUMBS_DIR, { recursive: true });
  const out = path.join(THUMBS_DIR, `${it.id}.jpg`);
  if (fs.existsSync(out)) return { file: out, type: 'image/jpeg' };
  const local = path.join(FILES_DIR, `${it.id}.${it.ext}`);
  if (fs.existsSync(local)) {
    try {
      await run('ffmpeg', ['-y', '-v', 'error', ...(it.kind === 'video' ? ['-ss', '0.5'] : []), '-i', local, '-frames:v', '1', '-vf', 'scale=320:-2', '-pix_fmt', 'yuvj420p', '-q:v', '5', out]);
      return { file: out, type: 'image/jpeg' };
    } catch {
      /* tenta o Drive */
    }
  }
  try {
    const res = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(it.id)}&sz=w320`, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
    if (!res.ok || !res.body) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const tmp = `${out}.part`;
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fs.createWriteStream(tmp));
    await fsp.rename(tmp, out);
    return { file: out, type: 'image/jpeg' };
  } catch {
    return null;
  }
}

export function mime(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  return (
    {
      wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aif: 'audio/aiff', aiff: 'audio/aiff', flac: 'audio/flac', ogg: 'audio/ogg',
      mov: 'video/quicktime', mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/mp4',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', cube: 'text/plain',
    }[ext] ?? 'application/octet-stream'
  );
}

/**
 * Um .cube do disco (look fora do catálogo, ex. a pasta "Luts Marcelo S'antana" do pack — CH-0009): caminho
 * absoluto, extensão .cube, arquivo que existe e que o parseCube lê. Erro 400 com a mensagem para o editor.
 */
export async function localCubeFile(file: string): Promise<string> {
  const bad = (m: string) => Object.assign(new Error(m), { statusCode: 400 });
  if (!path.isAbsolute(file)) throw bad(`lut.path precisa ser caminho absoluto (veio "${file}")`);
  if (path.extname(file).toLowerCase() !== '.cube') throw bad('lut.path precisa ser um arquivo .cube');
  const st = await fsp.stat(file).catch(() => null);
  if (!st?.isFile()) throw bad(`não achei o .cube em "${file}"`);
  return file;
}

const cubes = new Map<string, CubeLut>();
/** Um look (.cube) lido e em memória — do CinePRO pelo id, ou do disco (`local:<caminho>`); o export e o preview usam o mesmo. */
export async function cineproCube(id: string): Promise<CubeLut> {
  const local = localLutPath(id);
  if (local) {
    const file = await localCubeFile(local);
    const key = `${id}@${(await fsp.stat(file)).mtimeMs}`;
    const hit = cubes.get(key);
    if (hit) return hit;
    const cube = parseCube(await fsp.readFile(file, 'utf8'));
    cubes.set(key, cube);
    return cube;
  }
  const hit = cubes.get(id);
  if (hit) return hit;
  const { item, file } = await cineproFile(id);
  if (item.tipo !== 'lut') throw Object.assign(new Error('não é uma LUT'), { statusCode: 400 });
  const cube = parseCube(await fsp.readFile(file, 'utf8'));
  cubes.set(id, cube);
  return cube;
}

/**
 * Põe um item do CinePRO na timeline no instante `at`: SFX em A2, trilha em A3 (substitui a atual),
 * vídeo com alfa em V3 (motion), vídeo/imagem/GIF em V2 (B-roll) até o fim do corte. Baixa da nuvem se preciso.
 */
export async function cineproUsar(projectId: string, itemId: string, at: number): Promise<{ assetId: string; trackId: string; role: string }> {
  const it = await cineproItem(itemId);
  if (!it.insere) throw Object.assign(new Error(it.tipo === 'lut' ? 'Looks entram pela aba Cor.' : `${CINEPRO_TIPOS[it.tipo]} do Premiere não entra na timeline do Editor Brain.`), { statusCode: 400 });
  store.setActivity(projectId, { state: 'analyzing', message: `CinePRO: baixando ${it.nome}` });
  let file: string;
  try {
    file = (await cineproFile(itemId)).file;
  } finally {
    store.setActivity(projectId, { state: 'idle', message: '' });
  }
  if (it.tipo === 'musica') {
    await useAsTrilha(projectId, file);
    const a = store.get(projectId).assets.find((x) => x.path === file)!;
    return { assetId: a.id, trackId: 'A3', role: 'music' };
  }
  let asset = store.get(projectId).assets.find((a) => a.path === file);
  if (!asset) asset = await ingest(projectId, file, it.kind === 'audio' ? 'broll' : it.ext === 'mov' || it.ext === 'webm' ? undefined : 'broll');
  const p = store.get(projectId);
  const tl = p.timeline;
  const anchor = anchorAt(tl, at);
  if (!anchor) throw Object.assign(new Error('o cursor precisa estar em cima da fala'), { statusCode: 400 });
  const remaining = Math.max(0.3, timelineDuration(tl) - at);
  const isAudio = asset.kind === 'audio';
  const alpha = !!asset.alpha;
  const trackId = isAudio ? 'A2' : alpha ? 'V3' : 'V2';
  const role = isAudio ? 'sfx' : alpha ? 'motion' : 'broll';
  const dur = asset.kind === 'image' || !asset.duration ? Math.min(3, remaining) : isAudio ? Math.min(asset.duration, remaining) : Math.min(asset.duration, Math.max(1, cutEndAfter(tl, at) - at), remaining);
  store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId, role, anchor, duration: Math.max(0.3, dur), source: { type: 'media', assetId: asset.id, in: 0 } } }, note: `CinePRO: ${it.nome} em ${trackId}` });
  return { assetId: asset.id, trackId, role };
}

// ---------------------------------------------------------------------------
// SFX reais para o agente: um efeito sintetizado → uma amostra do CinePRO
// ---------------------------------------------------------------------------

const pickCache = new Map<string, CineproItem[]>();

/** Candidatos de um conceito, ordenados: acerto no nome vale mais que na pasta/tags. Determinístico. */
export async function cineproCandidates(kind: SfxKind): Promise<CineproItem[]> {
  const hit = pickCache.get(kind);
  if (hit) return hit;
  const c = await cineproCatalogo();
  const spec = SFX_CONCEPTS[kind];
  const word = (t: string) => new RegExp(`(^|[^a-z0-9])${norm(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  const terms = spec.termos.map(word);
  const evita = (spec.evita ?? []).map(word);
  const scored = c.itens
    .filter((it) => it.tipo === 'sfx')
    .map((it) => {
      const nome = norm(it.nome);
      const resto = norm(`${it.pasta} ${it.tags.join(' ')}`);
      if (evita.some((re) => re.test(nome) || re.test(resto))) return { it, score: 0 };
      let score = 0;
      terms.forEach((re, i) => {
        if (re.test(nome)) score += 10 - i;
        else if (re.test(resto)) score += 4 - Math.min(3, i);
      });
      // Nomes curtos e pastas de essenciais descrevem o som sem contexto estranho.
      if (score && nome.length < 28) score += 1;
      if (score && /essentials|sfx|mix/.test(norm(it.pasta))) score += 1;
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.it.nome.localeCompare(b.it.nome, 'pt-BR'));
  // Só a faixa de cima (acertos no nome), para não cair em sons só vagamente parecidos.
  const top = scored.length ? scored.filter((x) => x.score >= Math.max(8, scored[0]!.score - 3)) : [];
  const list = (top.length ? top : scored.slice(0, 12)).map((x) => x.it);
  pickCache.set(kind, list);
  return list;
}

/** A amostra escolhida para um efeito, pela semente da cue (o mesmo motion sempre soa igual). */
export async function cineproPick(kind: SfxKind, seed: number): Promise<CineproItem | null> {
  const list = await cineproCandidates(kind);
  if (!list.length) return null;
  return list[Math.abs(Math.floor(seed)) % list.length]!;
}

const sampleCache = new Map<string, Float32Array>();
/** Amostras mono 48 kHz (float) de um item de áudio, pelo FFmpeg — baixa da nuvem se for a primeira vez. */
export async function cineproSample(id: string, sr = 48000): Promise<Float32Array> {
  const key = `${id}@${sr}`;
  const hit = sampleCache.get(key);
  if (hit) return hit;
  const { file } = await cineproFile(id);
  const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-t', '6', '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-']);
  const x = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength - (raw.byteLength % 4)));
  if (sampleCache.size > 200) sampleCache.delete(sampleCache.keys().next().value!);
  sampleCache.set(key, x);
  return x;
}
