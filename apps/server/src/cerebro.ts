/**
 * Cérebros → grafo (aba #/cerebro). Só leitura dos vaults: o produto nunca escreve lá.
 *
 * Dois cérebros, cada um com seu centro, e pontes entre eles:
 *  - Cérebro do Editor (~/Documents/Cérebro do Editor): fluxo editorial, EDL, blueprint, padrão de cliente.
 *  - Motion Studio Brain (~/Documents/Motion Studio - Brain): estética, referências e decisões de motion —
 *    em motion, manda ele (regra A-08 do Thales); a memória antiga do Editor vale como receita técnica.
 *
 * Ligações dentro de um cérebro: [[wikilinks]] do Obsidian; menções (`caminho.md`, nomes de nota,
 * "Cérebro 04"), resolvidas primeiro na mesma pasta, depois por nome único; pastas (hub por pasta de
 * primeiro nível e por projeto); diário de decisões/correções (skill ↔ projeto); mapa Skill → brains;
 * cliente (caminho com o nome ↔ PADRAO do cliente); canvas; perfis do produto ← PADRAO lido.
 * Pontes: uma nota cita o outro cérebro (nome do vault ou caminho de lá), o material de motion do Editor
 * (padroes de motions, brains de motion, memória 07, pastas motions/ dos projetos) ↔ Motion Studio Brain,
 * e "Padrões do Thales" (motion) ↔ PADRAO Thales (editor).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CerebroCamada, CerebroEdge, CerebroEdgeKind, CerebroGraph, CerebroKind, CerebroNode, CerebroNote, CerebroVault, CerebroVaultId } from '@neweditor/core';
import { CEREBRO_KIND_LABEL } from '@neweditor/core';
import { BRAIN_DIR } from './motion/refs.ts';
import { listProfiles, PADROES_DIR } from './profiles.ts';

export const CEREBRO_DIR = process.env.NEWEDITOR_CEREBRO ?? path.dirname(PADROES_DIR);
export const MOTION_BRAIN_DIR = BRAIN_DIR;

const VAULTS: Omit<CerebroVault, 'notas'>[] = [
  { id: 'editor', name: path.basename(CEREBRO_DIR), label: 'Cérebro do Editor', dir: CEREBRO_DIR, papel: 'Fluxo editorial, EDL, blueprint, roteiro e padrão de cliente.' },
  { id: 'motion', name: path.basename(MOTION_BRAIN_DIR), label: 'Motion Studio Brain', dir: MOTION_BRAIN_DIR, papel: 'Estética, linguagem, referências e decisões de motion e lettering — em motion, manda este cérebro (A-08).' },
];

const SKIP_DIRS = new Set(['node_modules', 'venv', '.venv', '__pycache__', 'site-packages', '_ft', 'out']);
const MAX_READ = 400 * 1024;
const CACHE_MS = 45_000;
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|mp4|mov|wav|mp3|pdf|json|jsonl|zip)$/i;

interface Doc {
  vault: CerebroVaultId;
  id: string;
  rel: string;
  base: string; // nome sem extensão
  dir: string;
  text: string;
  words: number;
  mtime: number;
}

let cache: { at: number; graph: CerebroGraph } | null = null;

export async function cerebroGraph(refresh = false): Promise<CerebroGraph> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.graph;
  const graph = await build();
  cache = { at: Date.now(), graph };
  return graph;
}

/** Uma nota (texto limitado), com o caminho validado dentro do vault. */
export async function cerebroNote(vault: string, rel: string): Promise<CerebroNote> {
  const v = VAULTS.find((x) => x.id === vault);
  if (!v) throw Object.assign(new Error('cérebro desconhecido'), { statusCode: 400 });
  const abs = path.resolve(v.dir, rel);
  if (!abs.startsWith(v.dir + path.sep) || !/\.(md|canvas)$/i.test(abs)) throw Object.assign(new Error('nota fora do vault'), { statusCode: 400 });
  const st = await fs.stat(abs);
  const content = await readHead(abs, Math.min(st.size, 120 * 1024));
  return { vault: v.id, path: rel, title: titleOf(content, path.basename(rel)), content, words: countWords(content), mtime: st.mtimeMs, truncated: st.size > 120 * 1024 };
}

async function readHead(abs: string, bytes: number): Promise<string> {
  const fh = await fs.open(abs, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

async function walk(dir: string, rel = '', out: string[] = []): Promise<string[]> {
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(path.join(dir, e.name), r, out);
    else if (/\.(md|canvas)$/i.test(e.name)) out.push(r);
  }
  return out;
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const countWords = (t: string) => (t.match(/[\p{L}\p{N}]+/gu) ?? []).length;

function titleOf(text: string, fallback: string): string {
  const m = /^#\s+(.+)$/m.exec(text);
  return (m?.[1] ?? fallback.replace(/\.(md|canvas)$/i, '')).trim().slice(0, 90);
}

function excerptOf(text: string): string {
  const body = text
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#.*$/gm, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`>|#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return body.slice(0, 180);
}

function kindOf(vault: CerebroVaultId, rel: string): { kind: CerebroKind; group: string } {
  const parts = rel.split('/');
  const top = parts[0]!;
  const g = (s: string) => `${vault}/${s}`;
  if (parts.length === 1) return rel.endsWith('.canvas') ? { kind: 'canvas', group: g('canvas') } : { kind: 'raiz', group: g('raiz') };
  if (vault === 'editor') {
    if (top === '_SISTEMA') return parts[1] === 'memoria' ? { kind: 'memoria', group: g('memoria') } : { kind: 'sistema', group: g('sistema') };
    if (top === 'brains') return { kind: 'brain', group: g('brains') };
    if (top === 'padroes') return { kind: 'padrao', group: g('padroes') };
    if (top === 'padroes de motions') return { kind: 'motion', group: g('motion') };
    if (top === 'Claude outputs') return { kind: 'saida', group: g('saida') };
    if (top === 'montagens') return parts.length === 2 ? { kind: 'montagem', group: g('montagens') } : { kind: 'arquivo', group: g(`montagens/${parts[1]}`) };
    return { kind: 'raiz', group: g(top) };
  }
  if (strip(top).startsWith('referencias')) return /^Ref - /i.test(parts[parts.length - 1]!) ? { kind: 'referencia', group: g('referencias') } : { kind: 'mapa', group: g('mapa') };
  if (strip(top).startsWith('registro')) {
    const sub = strip(parts[1] ?? '');
    if (parts.length > 2 && sub.startsWith('aprovad')) return { kind: 'aprovado', group: g('aprovados') };
    if (parts.length > 2 && sub.startsWith('recusad')) return { kind: 'recusado', group: g('recusados') };
    if (parts.length > 2 && sub.startsWith('altera')) return { kind: 'alteracao', group: g('alteracoes') };
    return { kind: 'registro', group: g('registro') };
  }
  if (strip(top).startsWith('assets')) return { kind: 'asset', group: g('assets') };
  if (top === 'Motion Studio') return parts[1] === 'films' && parts.length > 3 ? { kind: 'filme', group: g('filmes') } : { kind: 'raiz', group: g('studio') };
  return { kind: 'raiz', group: g(top) };
}

/** Projetos que são do próprio Thales (o resto de montagens/ é de cliente). */
const OWN_PROJECT = /^(thales-|pope-in-the-pool)/;

/**
 * Camada: OFÍCIO embarca no produto; PESSOAL é do Thales; CLIENTE é o que o cliente dele aprovou.
 * Editor: brains, protocolo, README, canvas, padrões de motion (receita técnica) e o template = ofício;
 * DNA, memória das Skills, PADRAO Thales, saídas e projetos dele = pessoal; outros PADRAO e projetos = cliente.
 * Motion: a pasta Motion Studio (skills, tecnologia) = ofício; referências, mapa, registro, assets e filmes = pessoal.
 */
function camadaOf(vault: CerebroVaultId, rel: string): CerebroCamada {
  const parts = rel.split('/');
  const top = parts[0]!;
  if (vault === 'motion') {
    // A pasta Motion Studio é a tecnologia (contrato de render, skills); REFERENCIAS.md e films/ são dele.
    if (top !== 'Motion Studio' || parts[1] === 'films' || /^REFERENCIAS/i.test(parts[1] ?? '')) return 'pessoal';
    return 'oficio';
  }
  // Os packs de treino são referência dele; a biblioteca e a spec de SaaS são mecanismo (ofício).
  if (top === 'padroes de motions') return /MANUAL - reproduzir os packs/i.test(parts[1] ?? '') ? 'pessoal' : 'oficio';
  if (rel.endsWith('.canvas') || top === 'README.md' || top === 'brains') return 'oficio';
  if (top === '_SISTEMA') return parts[1] === 'memoria' || parts[1] === 'DNA_EDITORIAL.md' ? 'pessoal' : 'oficio';
  if (top === 'padroes') return /thales/i.test(parts[1] ?? '') ? 'pessoal' : 'cliente';
  if (top === 'Claude outputs') return 'pessoal';
  if (top === 'montagens') {
    const slug = parts[1] ?? '';
    if (slug === '_TEMPLATE-PROJETO') return 'oficio';
    return OWN_PROJECT.test(slug) || /thales/i.test(slug) ? 'pessoal' : 'cliente';
  }
  return 'pessoal';
}

/** Hub de pasta: pasta de primeiro nível; dentro de montagens/<slug> e films/<slug>, o projeto/filme. */
function hubOf(vault: CerebroVaultId, rel: string): { id: string; label: string; kind: CerebroKind; group: string } | null {
  const parts = rel.split('/');
  if (parts.length < 2) return null;
  const top = parts[0]!;
  if (vault === 'editor' && top === 'montagens' && parts.length > 2) return { id: `editor:dir:montagens/${parts[1]}`, label: parts[1]!, kind: 'projeto', group: `editor/montagens/${parts[1]}` };
  if (vault === 'motion' && top === 'Motion Studio' && parts[1] === 'films' && parts.length > 3) return { id: `motion:dir:Motion Studio/films/${parts[2]}`, label: parts[2]!, kind: 'filme', group: 'motion/filmes' };
  if (vault === 'motion' && strip(top).startsWith('registro') && parts.length > 2) return { id: `motion:dir:${top}/${parts[1]}`, label: parts[1]!, kind: 'pasta', group: kindOf(vault, rel).group };
  return { id: `${vault}:dir:${top}`, label: top.replace(/^_/, ''), kind: 'pasta', group: kindOf(vault, `${top}/x.md`).group };
}

/** As skills embarcadas do Motion Studio (`Motion Studio/.claude/skills/<nome>/`): um nó por skill. */
async function readSkills(dir: string): Promise<{ name: string; rel: string; docs: number; words: number; desc: string; mtime: number }[]> {
  const base = path.join(dir, 'Motion Studio', '.claude', 'skills');
  let names: string[] = [];
  try {
    names = (await fs.readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.sort()) {
    const files = await walk(path.join(base, name));
    let words = 0;
    let mtime = 0;
    let desc = '';
    for (const f of files) {
      try {
        const abs = path.join(base, name, f);
        const st = await fs.stat(abs);
        const text = await readHead(abs, Math.min(st.size, 64 * 1024));
        words += countWords(text);
        mtime = Math.max(mtime, st.mtimeMs);
        if (f === 'SKILL.md') {
          // description: "…" | '…' | > bloco dobrado
          const m = /^description:\s*(.*)$/m.exec(text);
          if (m) {
            desc = m[1]!.trim();
            if (desc === '>' || desc === '|' || desc === '>-') {
              const after = text.slice((m.index ?? 0) + m[0].length).split('\n');
              desc = after
                .slice(1)
                .filter((l) => /^\s+\S/.test(l))
                .map((l) => l.trim())
                .join(' ');
            }
            desc = desc.replace(/^["']|["']$/g, '').slice(0, 220);
          }
        }
      } catch {
        /* ignora */
      }
    }
    out.push({ name, rel: `Motion Studio/.claude/skills/${name}`, docs: files.length, words, desc, mtime });
  }
  return out;
}

async function readVault(v: Omit<CerebroVault, 'notas'>): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const rel of await walk(v.dir)) {
    const abs = path.join(v.dir, rel);
    try {
      const st = await fs.stat(abs);
      const text = await readHead(abs, Math.min(st.size, MAX_READ));
      docs.push({ vault: v.id, id: `${v.id}:${rel}`, rel, base: path.basename(rel).replace(/\.(md|canvas)$/i, ''), dir: path.dirname(rel) === '.' ? '' : path.dirname(rel), text, words: countWords(text), mtime: st.mtimeMs });
    } catch {
      /* ignora o que não dá para ler */
    }
  }
  return docs;
}

async function build(): Promise<CerebroGraph> {
  const nodes = new Map<string, CerebroNode>();
  const edges = new Map<string, CerebroEdge>();
  const link = (s: string, t: string, kind: CerebroEdgeKind, w = 1) => {
    if (s === t || !nodes.has(s) || !nodes.has(t)) return;
    const key = s < t ? `${s}|${t}|${kind}` : `${t}|${s}|${kind}`;
    const cur = edges.get(key);
    if (cur) cur.w += w;
    else edges.set(key, { s, t, kind, w });
  };

  const perVault = new Map<CerebroVaultId, Doc[]>();
  for (const v of VAULTS) perVault.set(v.id, await readVault(v));
  const all = [...perVault.values()].flat();

  // Hub de cada cérebro.
  for (const v of VAULTS) nodes.set(`${v.id}:cerebro`, { id: `${v.id}:cerebro`, vault: v.id, label: v.label, path: '', kind: 'cerebro', camada: 'oficio', group: `${v.id}/cerebro`, words: 0, mtime: 0, excerpt: v.papel });

  // Notas.
  for (const d of all) {
    const { kind, group } = kindOf(d.vault, d.rel);
    const isCanvas = d.rel.endsWith('.canvas');
    nodes.set(d.id, { id: d.id, vault: d.vault, label: isCanvas ? d.base : titleOf(d.text, d.base), path: d.rel, kind, camada: camadaOf(d.vault, d.rel), group, words: d.words, mtime: d.mtime, excerpt: isCanvas ? 'Canvas do Obsidian' : excerptOf(d.text) });
  }
  // Hubs de pasta/projeto/filme → ligados ao hub do cérebro.
  const hubs = new Map<string, { id: string; label: string; kind: CerebroKind; group: string; vault: CerebroVaultId }>();
  for (const d of all) {
    const h = hubOf(d.vault, d.rel);
    if (h) hubs.set(h.id, { ...h, vault: d.vault });
  }
  for (const h of hubs.values()) {
    // A pasta fica na camada da maioria dos arquivos dela.
    const dirRel = h.id.split(':dir:')[1]!;
    const tally: Record<CerebroCamada, number> = { oficio: 0, pessoal: 0, cliente: 0 };
    for (const d of all) if (d.vault === h.vault && d.rel.startsWith(`${dirRel}/`)) tally[camadaOf(d.vault, d.rel)]++;
    const camada = (Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'pessoal') as CerebroCamada;
    nodes.set(h.id, { id: h.id, vault: h.vault, label: h.label, path: dirRel, kind: h.kind, camada, group: h.group, words: 0, mtime: 0, excerpt: h.kind === 'projeto' ? 'Projeto em montagens/' : h.kind === 'filme' ? 'Filme do Motion Studio' : 'Pasta do vault' });
  }
  for (const h of hubs.values()) {
    const parts = h.id.split(':dir:')[1]!.split('/');
    // Subpasta (projeto, filme, Aprovados…) pendura na pasta de primeiro nível; esta, no cérebro.
    const parent = parts.length > 1 ? `${h.vault}:dir:${parts[0]}` : `${h.vault}:cerebro`;
    if (parts.length > 2 && nodes.has(`${h.vault}:dir:${parts.slice(0, 2).join('/')}`)) link(h.id, `${h.vault}:dir:${parts.slice(0, 2).join('/')}`, 'pasta', 2);
    else link(h.id, nodes.has(parent) ? parent : `${h.vault}:cerebro`, 'pasta', 2);
  }
  for (const d of all) {
    const h = hubOf(d.vault, d.rel);
    if (h) link(d.id, h.id, 'pasta', /^PROJETO\.md$/i.test(path.basename(d.rel)) ? 3 : 1);
    else link(d.id, `${d.vault}:cerebro`, 'pasta');
  }
  // Tecnologia embarcada: as skills do Motion Studio, um nó por skill, penduradas na pasta Motion Studio.
  const motionDir = VAULTS.find((v) => v.id === 'motion')?.dir;
  if (motionDir && nodes.has('motion:cerebro')) {
    const studioHub = nodes.has('motion:dir:Motion Studio') ? 'motion:dir:Motion Studio' : 'motion:cerebro';
    for (const s of await readSkills(motionDir)) {
      const id = `motion:${s.rel}`;
      nodes.set(id, { id, vault: 'motion', label: `skill · ${s.name}`, path: s.rel, kind: 'tecnologia', camada: 'oficio', group: 'motion/tecnologia', words: s.words, mtime: s.mtime, excerpt: `${s.desc || 'Skill do Motion Studio.'} (${s.docs} documento${s.docs === 1 ? '' : 's'})` });
      link(id, studioHub, 'pasta');
    }
  }

  // Índices para resolver menções e wikilinks (por vault).
  const byRel = new Map<CerebroVaultId, Map<string, string>>();
  const byBase = new Map<CerebroVaultId, Map<string, string[]>>();
  for (const v of VAULTS) {
    const docs = perVault.get(v.id)!;
    byRel.set(v.id, new Map(docs.map((d) => [strip(d.rel), d.id])));
    const bb = new Map<string, string[]>();
    for (const d of docs) {
      const k = strip(d.base);
      bb.set(k, [...(bb.get(k) ?? []), d.id]);
    }
    byBase.set(v.id, bb);
  }
  const resolveIn = (vault: CerebroVaultId, raw: string, fromDir: string): string | null => {
    const s = strip(raw.trim().replace(/^\.\//, '').replace(/^\//, ''));
    if (!s) return null;
    const direct = byRel.get(vault)!.get(s) ?? byRel.get(vault)!.get(`${s}.md`);
    if (direct) return direct;
    const base = s.replace(/\.(md|canvas)$/i, '').split('/').pop()!;
    const cands = byBase.get(vault)!.get(base);
    if (!cands?.length) return null;
    if (cands.length === 1) return cands[0]!;
    const same = cands.find((c) => {
      const rel = c.slice(vault.length + 1);
      return (path.dirname(rel) === '.' ? '' : path.dirname(rel)) === fromDir;
    });
    if (same) return same;
    const proj = fromDir.split('/').slice(0, 2).join('/');
    const inProj = cands.filter((c) => c.slice(vault.length + 1).startsWith(`${proj}/`));
    return inProj.length === 1 ? inProj[0]! : null;
  };
  /** Resolve no próprio cérebro; se vier com o nome do outro vault no caminho, resolve lá (ponte). */
  const resolve = (from: Doc, raw: string): { id: string; ponte: boolean } | null => {
    const own = resolveIn(from.vault, raw, from.dir);
    if (own) return { id: own, ponte: false };
    for (const v of VAULTS) {
      if (v.id === from.vault) continue;
      const m = raw.indexOf(`${v.name}/`);
      const other = m >= 0 ? resolveIn(v.id, raw.slice(m + v.name.length + 1), '') : null;
      if (other) return { id: other, ponte: true };
    }
    return null;
  };

  const brainByNum = new Map<string, string>();
  for (const d of all) {
    const m = /^brains\/(\d\d)_/.exec(d.rel);
    if (d.vault === 'editor' && m) brainByNum.set(m[1]!, d.id);
  }
  for (const d of all) {
    if (d.rel.endsWith('.canvas')) continue;
    const seen = new Set<string>();
    const hit = (r: { id: string; ponte: boolean } | null, kind: CerebroEdgeKind) => {
      if (!r || r.id === d.id || seen.has(r.id)) return;
      seen.add(r.id);
      link(d.id, r.id, r.ponte ? 'ponte' : kind);
    };
    // [[wikilinks]] do Obsidian (com #cabeçalho, |alias e \| dentro de tabela); mídia não é nota.
    for (const m of d.text.matchAll(/\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\\?\|[^\]]*)?\]\]/g)) {
      const target = m[1]!.replace(/\\$/, '').trim();
      if (MEDIA_EXT.test(target)) continue;
      hit(resolve(d, target), 'wikilink');
    }
    for (const m of d.text.matchAll(/`([^`\n]{3,200}?\.(?:md|canvas))`/g)) hit(resolve(d, m[1]!), 'mencao');
    for (const m of d.text.matchAll(/(?:^|[\s("'])((?:[\w .()\-À-ſ]+\/)*[\w .()\-À-ſ]{2,80}?\.md)(?=[\s)"'`,.;:]|$)/gm)) hit(resolve(d, m[1]!), 'mencao');
    for (const m of d.text.matchAll(/\b(DNA_EDITORIAL|PROTOCOLO_GLOBAL|\d\d[A-Z]?_[A-Z][A-Z0-9_]{2,}|motion-12-principios-animacao|motion-graphics-17-estilos)\b/g)) hit(resolve(d, m[1]!), 'mencao');
    if (d.vault === 'editor') for (const m of d.text.matchAll(/C[ÉE]REBRO\s+0?(\d)\b/gi)) hit(brainByNum.has(`0${m[1]}`) ? { id: brainByNum.get(`0${m[1]}`)!, ponte: false } : null, 'mencao');
    // Cita o outro cérebro pelo nome → ponte com o hub dele.
    for (const v of VAULTS) {
      if (v.id === d.vault) continue;
      const names = v.id === 'motion' ? /Motion Studio( -)? Brain|Motion Studio\b/i : /C[ée]rebro do Editor/i;
      if (names.test(d.text)) hit({ id: `${v.id}:cerebro`, ponte: true }, 'ponte');
    }
  }

  // Diário do Editor: decisões e correções (skill ↔ projeto).
  const memByNum = new Map<string, string>();
  for (const d of all) {
    const m = /^_SISTEMA\/memoria\/(\d\d)-/.exec(d.rel);
    if (d.vault === 'editor' && m) memByNum.set(m[1]!, d.id);
  }
  for (const [file, kind] of [
    ['_SISTEMA/decisoes.jsonl', 'decisao'],
    ['_SISTEMA/correcoes.jsonl', 'correcao'],
  ] as const) {
    let raw = '';
    try {
      raw = await fs.readFile(path.join(CEREBRO_DIR, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let j: { skill?: string; projeto?: string };
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      const num = /^(\d\d)/.exec(j.skill ?? '')?.[1];
      const mem = num ? memByNum.get(num) : undefined;
      const proj = j.projeto ? `editor:dir:montagens/${j.projeto}` : undefined;
      if (mem && proj) link(mem, proj, kind);
      else if (mem) link(mem, 'editor:dir:_SISTEMA', kind);
      else if (proj) link(proj, 'editor:dir:_SISTEMA', kind);
    }
  }

  // Ofício: mapa Skill → brains/ no _SISTEMA/README.md.
  const readme = all.find((d) => d.id === 'editor:_SISTEMA/README.md');
  if (readme) {
    const brains = all.filter((d) => d.vault === 'editor' && d.rel.startsWith('brains/'));
    for (const m of readme.text.matchAll(/^\|\s*(\d\d)\s[^|]*\|\s*([^|]+)\|/gm)) {
      const mem = memByNum.get(m[1]!);
      if (!mem) continue;
      for (const tok of m[2]!.split('+')) {
        const t = strip(tok.replace(/\.md/g, '').trim());
        if (!t || t === '—' || t === '-') continue;
        const b = brains.find((x) => strip(x.base) === t) ?? brains.find((x) => strip(x.base).includes(t) || t.includes(strip(x.base)));
        if (b) link(mem, b.id, 'oficio');
      }
    }
  }

  // Cliente: nome lido do PADRAO ↔ notas do Editor cujo caminho tem o nome.
  const editorDocs = perVault.get('editor')!;
  const padroes = editorDocs.filter((d) => d.rel.startsWith('padroes/') && /^PADRAO - /i.test(d.base));
  for (const p of padroes) {
    const client = p.base.replace(/^PADRAO - /i, '').split(/ Talk| \(|·/)[0]!.trim();
    const needle = strip(client).replace(/\s+/g, '-');
    if (needle.length < 4) continue;
    for (const d of editorDocs) if (d.id !== p.id && strip(d.rel).replace(/\s+/g, '-').includes(needle)) link(d.id, p.id, 'cliente');
    for (const h of hubs.values()) if (h.vault === 'editor' && strip(h.label).includes(needle)) link(h.id, p.id, 'cliente');
  }

  // Canvas: arquivos citados e setas entre eles.
  for (const d of all) {
    if (!d.rel.endsWith('.canvas')) continue;
    try {
      const c = JSON.parse(d.text) as { nodes?: { id: string; type: string; file?: string }[]; edges?: { fromNode: string; toNode: string }[] };
      const fileOf = new Map<string, string>();
      for (const n of c.nodes ?? []) {
        if (n.type !== 'file' || !n.file) continue;
        const target = byRel.get(d.vault)!.get(strip(n.file));
        if (!target) continue;
        fileOf.set(n.id, target);
        link(d.id, target, 'canvas');
      }
      for (const e of c.edges ?? []) {
        const a = fileOf.get(e.fromNode);
        const b = fileOf.get(e.toNode);
        if (a && b) link(a, b, 'canvas');
      }
    } catch {
      /* canvas inválido */
    }
  }

  // Pontes estruturais: o material de motion do Editor ↔ Motion Studio Brain.
  if (nodes.has('motion:cerebro')) {
    for (const d of editorDocs) {
      const isMotion = d.rel.startsWith('padroes de motions/') || /^brains\/motion-/.test(d.rel) || d.rel === '_SISTEMA/memoria/07-motion-designer.md' || /^montagens\/[^/]+\/motions\//.test(d.rel);
      if (isMotion) link(d.id, 'motion:cerebro', 'ponte');
    }
    if (nodes.has('editor:dir:padroes de motions')) link('editor:dir:padroes de motions', 'motion:cerebro', 'ponte', 2);
    // "Padrões do Thales" (motion) ↔ PADRAO Thales (editor): o mesmo gosto, dois ofícios.
    const pt = all.find((d) => d.vault === 'motion' && strip(d.base) === 'padroes do thales');
    const padThales = padroes.find((d) => strip(d.base).includes('thales'));
    if (pt && padThales) link(pt.id, padThales.id, 'ponte', 2);
  }

  // Perfis do produto ← PADRAO de onde foram lidos.
  for (const p of await listProfiles()) {
    const id = `editor:perfil:${p.id}`;
    nodes.set(id, {
      id,
      vault: 'editor',
      label: `Perfil · ${p.nome.split(' — ')[0]}`,
      path: '',
      kind: 'perfil',
      camada: p.padraoCasa ? 'pessoal' : 'cliente',
      group: 'editor/perfil',
      words: 0,
      mtime: p.atualizadoEm ? Date.parse(p.atualizadoEm) : 0,
      excerpt: p.padraoCasa ? 'Padrão da casa: vale para todo projeto sem perfil escolhido.' : p.validado === false ? (p.nota ?? 'Teste — não é referência.') : 'Perfil de edição compilado para o agente executar.',
      casa: !!p.padraoCasa,
      teste: p.validado === false,
    });
    const src = p.fonte ? editorDocs.find((d) => path.resolve(CEREBRO_DIR, d.rel) === path.resolve(p.fonte!)) : undefined;
    const guess = src ?? padroes.find((d) => strip(d.base).includes(strip(p.id).replace(/-/g, ' ')) || strip(d.base).includes(strip(p.id)));
    if (guess) {
      link(id, guess.id, 'perfil', 2);
      const n = nodes.get(guess.id)!;
      n.casa = !!p.padraoCasa;
      n.teste = p.validado === false;
    }
  }

  const count = new Map<string, number>();
  for (const n of nodes.values()) count.set(n.group, (count.get(n.group) ?? 0) + 1);
  const grupos = [...count.entries()]
    .map(([id, n]) => {
      const vault = id.split('/')[0] as CerebroVaultId;
      const sample = [...nodes.values()].find((x) => x.group === id && x.kind !== 'pasta' && x.kind !== 'projeto' && x.kind !== 'cerebro' && !(x.kind === 'filme' && !x.path.includes('.'))) ?? [...nodes.values()].find((x) => x.group === id)!;
      const label = id.startsWith('editor/montagens/') ? `Projeto · ${id.slice(17)}` : id === 'motion/studio' ? 'Motion Studio (pasta)' : sample.kind === 'cerebro' ? 'Centro' : CEREBRO_KIND_LABEL[sample.kind];
      return { id, vault, label, kind: sample.kind, n };
    })
    .sort((a, b) => a.vault.localeCompare(b.vault) || b.n - a.n);

  const vaults: CerebroVault[] = VAULTS.map((v) => ({ ...v, notas: perVault.get(v.id)!.length }));
  const edgeList = [...edges.values()];
  const camadas: Record<CerebroCamada, number> = { oficio: 0, pessoal: 0, cliente: 0 };
  for (const n of nodes.values()) if (/\.(md|canvas)$/i.test(n.path) || n.kind === 'tecnologia') camadas[n.camada]++;
  return { vaults, geradoEm: new Date().toISOString(), nodes: [...nodes.values()], edges: edgeList, grupos, pontes: edgeList.filter((e) => e.kind === 'ponte').length, camadas };
}
