/**
 * Biblioteca de referências de motion — mesma estrutura do vault "Motion Studio - Brain":
 * uma pasta por obra com `Ref - <Obra>.md` (frontmatter + Como conta a história / O que roubar /
 * Quando usar / Storyboard), a capa e os quadros. O editor cola um link; a referência vira .md aqui.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DATA_ROOT } from '../config.ts';
import { run } from '../media.ts';
import { store } from '../store.ts';

export const REFS_DIR = path.join(DATA_ROOT, 'referencias');
export const BRAIN_DIR = process.env.NEWEDITOR_MOTION_BRAIN ?? path.join(os.homedir(), 'Documents', 'Motion Studio - Brain');
const TRASH = path.join(REFS_DIR, '.lixeira');

export const CATEGORIAS = ['Motion de YouTube', 'Motion graphics', 'Tipografia cinética', '3D'] as const;
export const FAMILIAS = [
  'Tipografia como imagem',
  'Explainer de YouTube',
  'Documentário histórico',
  'Papel e colagem',
  'Ilustração com grão',
  'P&B + um vermelho',
  'Pop saturado',
  'Símbolo que carrega a história',
  'Linha que vira tudo',
  'Transformação de matéria',
  'Virada de cor',
  'Fotorrealismo limpo',
  'Mesa de prova',
  '3D / CGI',
];

export interface MotionRef {
  id: string;
  file: string;
  obra: string;
  categoria: string;
  familias: string[];
  link: string;
  paleta: string[];
  resumo: string;
  fio: string;
  mecanismo: string;
  roubar: string[];
  serve: string;
  evitar: string;
  capa?: string;
  quadros: { file: string; legenda: string }[];
  fonte: string;
  usadoNaSerie?: number;
  criadaEm?: string;
  /** Projetos do NewEditor que usam esta referência num motion (ou como obra-alvo). */
  usos: { projectId: string; name: string; motions: number }[];
  /** 'motion' (padrão) ou 'lettering'. */
  uso: 'motion' | 'lettering';
  /** Lettering: qual estilo do NewEditor reproduz esta referência, e a cor de acento dela. */
  estilo?: string;
  accent?: string;
  /** Vídeo curto da referência (mp4 sem áudio), quando houver. */
  preview?: string;
  /** SFX que vinham no modelo original (só o nome — referência de que som combina). */
  sfx?: string[];
}

// ---------------------------------------------------------------------------
// .md ⇄ objeto
// ---------------------------------------------------------------------------

function parseValue(v: string): unknown {
  const s = v.trim();
  if (!s) return '';
  if (s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      return s
        .slice(1, -1)
        .split(',')
        .map((x) => x.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
  }
  if (/^".*"$/.test(s)) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

export function parseFrontmatter(md: string): { fm: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: md };
  const fm: Record<string, unknown> = {};
  for (const line of m[1]!.split('\n')) {
    const k = line.match(/^([\w_]+):\s?(.*)$/);
    if (k) fm[k[1]!] = parseValue(k[2]!);
  }
  return { fm, body: md.slice(m[0].length) };
}

function section(body: string, title: string): string[] {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.trim().toLowerCase().startsWith(`## ${title.toLowerCase()}`));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && !lines[j]!.startsWith('## ') && !lines[j]!.startsWith('<!--'); j++) out.push(lines[j]!);
  return out;
}
const bullets = (lines: string[]) => lines.filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim());
const labeled = (lines: string[], label: string) =>
  bullets(lines)
    .find((b) => b.toLowerCase().startsWith(`**${label.toLowerCase()}`))
    ?.replace(/^\*\*[^*]+\*\*:?\s*/, '')
    .replace(/^:\s*/, '') ?? '';
const embeds = (s: string) => [...s.matchAll(/!\[\[([^\]|\\]+)(?:\\?\|[^\]]*)?\]\]/g)].map((m) => path.basename(m[1]!));

function toRef(id: string, file: string, md: string, usos: MotionRef['usos']): MotionRef {
  const { fm, body } = parseFrontmatter(md);
  const arr = (k: string) => (Array.isArray(fm[k]) ? (fm[k] as unknown[]).map(String) : typeof fm[k] === 'string' && fm[k] ? [String(fm[k])] : []);
  const quadros: MotionRef['quadros'] = [];
  for (const row of section(body, 'Storyboard').filter((l) => l.startsWith('|') && l.includes('![['))) {
    const cols = row.split(/(?<!\\)\|/).map((c) => c.trim());
    const legenda = (cols[3] ?? '').replace(/`/g, '');
    for (const f of embeds(cols[2] ?? '')) quadros.push({ file: `quadros/${f}`, legenda });
  }
  const capaFm = typeof fm.capa === 'string' ? fm.capa : '';
  const heroEmbed = embeds(body.split('\n').slice(0, 6).join('\n'))[0];
  const dir = path.join(REFS_DIR, id);
  const capa = capaFm && fs.existsSync(path.join(dir, capaFm)) ? capaFm : heroEmbed && fs.existsSync(path.join(dir, 'quadros', heroEmbed)) ? `quadros/${heroEmbed}` : quadros[0]?.file;
  const como = section(body, 'Como conta a história');
  const quando = section(body, 'Quando usar');
  return {
    id,
    file,
    obra: String(fm.obra ?? id),
    categoria: String(fm.categoria ?? 'Motion graphics'),
    familias: arr('familias'),
    link: String(fm.link ?? ''),
    paleta: arr('paleta'),
    resumo: (body.split('\n').find((l) => l.startsWith('> ')) ?? '').slice(2).trim(),
    fio: labeled(como, 'Fio condutor'),
    mecanismo: labeled(como, 'Mecanismo'),
    roubar: bullets(section(body, 'O que roubar')),
    serve: labeled(quando, 'Serve para'),
    evitar: labeled(quando, 'Evitar em'),
    capa,
    quadros: quadros.filter((q) => fs.existsSync(path.join(dir, q.file))),
    fonte: String(fm.fonte ?? 'NewEditor.AI'),
    usadoNaSerie: typeof fm.usado_na_serie === 'number' ? fm.usado_na_serie : undefined,
    criadaEm: fm.adicionada_em ? String(fm.adicionada_em) : undefined,
    usos,
    uso: fm.uso === 'lettering' ? 'lettering' : 'motion',
    estilo: typeof fm.estilo === 'string' ? fm.estilo : undefined,
    accent: typeof fm.acento === 'string' && /^#[0-9a-f]{6}$/i.test(fm.acento) ? fm.acento : undefined,
    preview: typeof fm.preview === 'string' && fs.existsSync(path.join(dir, fm.preview)) ? fm.preview : undefined,
    sfx: arr('sfx'),
  };
}

function usage(): Map<string, MotionRef['usos']> {
  const out = new Map<string, MotionRef['usos']>();
  for (const p of store.list()) {
    const count = new Map<string, number>();
    for (const o of p.timeline.overlays) {
      const ref = o.source.type === 'motion' ? o.source.motion.refId : o.source.type === 'lettering' ? o.source.lettering.refId : undefined;
      if (ref) count.set(ref, (count.get(ref) ?? 0) + 1);
    }
    for (const ref of [p.timeline.motionRef, p.timeline.letteringRef]) if (ref && !count.has(ref)) count.set(ref, 0);
    for (const [ref, n] of count) out.set(ref, [...(out.get(ref) ?? []), { projectId: p.id, name: p.name, motions: n }]);
  }
  return out;
}

async function mdFile(dir: string): Promise<string | undefined> {
  return (await fsp.readdir(dir).catch(() => [] as string[])).find((f) => f.endsWith('.md'));
}

export async function listRefs(): Promise<MotionRef[]> {
  await fsp.mkdir(REFS_DIR, { recursive: true });
  const uses = usage();
  const out: MotionRef[] = [];
  for (const id of await fsp.readdir(REFS_DIR)) {
    if (id.startsWith('.')) continue;
    const file = await mdFile(path.join(REFS_DIR, id));
    if (!file) continue;
    out.push(toRef(id, file, await fsp.readFile(path.join(REFS_DIR, id, file), 'utf8'), uses.get(id) ?? []));
  }
  // Já usadas primeiro (mais usadas no topo), depois as mais novas.
  const used = (r: MotionRef) => r.usos.reduce((a, u) => a + 1 + u.motions, 0);
  return out.sort((a, b) => used(b) - used(a) || (b.criadaEm ?? '').localeCompare(a.criadaEm ?? '') || a.obra.localeCompare(b.obra));
}

export async function getRef(id: string): Promise<MotionRef | undefined> {
  return (await listRefs()).find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Importar do Motion Studio - Brain
// ---------------------------------------------------------------------------

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'referencia';

/** Copia as notas `Ref - *.md` do vault (com os quadros reduzidos) para a biblioteca. Idempotente. */
export async function importFromBrain(): Promise<{ importadas: number; existentes: number; origem: string }> {
  const src = path.join(BRAIN_DIR, 'Referências');
  const files = (await fsp.readdir(src).catch(() => [] as string[])).filter((f) => /^Ref - .+\.md$/.test(f));
  if (!files.length) throw Object.assign(new Error(`não achei referências em ${src}`), { statusCode: 404 });
  let importadas = 0;
  let existentes = 0;
  for (const f of files) {
    const md = await fsp.readFile(path.join(src, f), 'utf8');
    const { fm } = parseFrontmatter(md);
    const pasta = typeof fm.pasta_quadros === 'string' ? fm.pasta_quadros : '';
    const id = pasta ? path.basename(pasta) : slugify(String(fm.obra ?? f));
    const dir = path.join(REFS_DIR, id);
    if (fs.existsSync(dir)) {
      existentes++;
      continue;
    }
    await fsp.mkdir(path.join(dir, 'quadros'), { recursive: true });
    const frames = pasta ? (await fsp.readdir(path.join(BRAIN_DIR, pasta)).catch(() => [] as string[])).filter((x) => /\.(jpe?g|png|webp)$/i.test(x)) : [];
    if (frames.length) {
      // Quadros reduzidos para 640 px: o card e o storyboard não precisam do original.
      try {
        await run('sips', ['-Z', '640', ...frames.map((x) => path.join(BRAIN_DIR, pasta, x)), '--out', path.join(dir, 'quadros')]);
      } catch {
        for (const x of frames) await fsp.copyFile(path.join(BRAIN_DIR, pasta, x), path.join(dir, 'quadros', x));
      }
    }
    const rewritten = md
      .replace(/^pasta_quadros:.*$/m, 'pasta_quadros: "quadros"')
      .replace(/^---\n/, `---\nfonte: "Motion Studio - Brain"\nadicionada_em: ${new Date().toISOString().slice(0, 10)}\n`)
      .replace(new RegExp(`!\\[\\[${pasta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g'), '![[quadros/');
    await fsp.writeFile(path.join(dir, f), rewritten);
    importadas++;
  }
  return { importadas, existentes, origem: src };
}

// ---------------------------------------------------------------------------
// Nova referência a partir de um link
// ---------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export interface LinkMeta {
  link: string;
  titulo: string;
  descricao: string;
  imagem?: string;
  autor?: string;
  categoria: string;
  /** O site não deixou ler a página (ex.: Behance responde 403 a qualquer leitura automática). */
  bloqueado?: boolean;
}

/** Nome legível a partir do link ("/gallery/255081343/COYOTE-VS-ACME-Main-Title" → "COYOTE VS ACME Main Title"). */
const titleFromUrl = (u: URL) =>
  decodeURIComponent(
    u.pathname
      .split('/')
      .filter((x) => x && !/^\d+$/.test(x) && !/^(gallery|video|watch|shots|project|projects)$/i.test(x))
      .pop() ?? '',
  )
    .replace(/[-_]+/g, ' ')
    .trim() || u.hostname.replace(/^www\./, '');

const ytId = (u: URL) => (u.hostname.includes('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v') ?? u.pathname.match(/\/(shorts|embed)\/([\w-]+)/)?.[2] ?? '');

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function checkUrl(link: string): URL {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    throw Object.assign(new Error('link inválido'), { statusCode: 400 });
  }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('use um link http(s)'), { statusCode: 400 });
  return u;
}

/** Título, descrição e imagem do link (oEmbed do YouTube/Vimeo; og:tags para o resto — Behance, Dribbble, sites). */
export async function fetchLinkMeta(link: string): Promise<LinkMeta> {
  const u = checkUrl(link);
  const host = u.hostname.replace(/^www\./, '');
  const get = (url: string) => fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(10_000), redirect: 'follow' });
  if (/youtube\.com|youtu\.be/.test(host)) {
    const id = ytId(u);
    const r = await get(`https://www.youtube.com/oembed?url=${encodeURIComponent(u.toString())}&format=json`).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string }) : {};
    return { link: u.toString(), titulo: j.title ?? 'Vídeo do YouTube', descricao: '', autor: j.author_name, imagem: id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : j.thumbnail_url, categoria: 'Motion de YouTube' };
  }
  if (/vimeo\.com/.test(host)) {
    const r = await get(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u.toString())}`).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string; description?: string }) : {};
    return { link: u.toString(), titulo: j.title ?? 'Vídeo do Vimeo', descricao: j.description ?? '', autor: j.author_name, imagem: j.thumbnail_url?.replace(/_\d+x\d+/, '_1280'), categoria: 'Motion graphics' };
  }
  const r = await get(u.toString()).catch(() => null);
  const html = r?.ok ? (await r.text()).slice(0, 2_000_000) : '';
  const bloqueado = !r || r.status === 403 || r.status === 429 || r.status === 401;
  const meta = (k: string) => decodeEntities(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1] ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i'))?.[1] ?? '');
  const title = meta('og:title') || decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '') || titleFromUrl(u);
  let img = meta('og:image') || meta('twitter:image');
  if (img && img.startsWith('/')) img = new URL(img, u).toString();
  return { link: u.toString(), titulo: title.replace(/\s+[-|–]\s+Behance$|\s+on Behance$/i, '').trim(), descricao: meta('og:description') || meta('description'), imagem: img || undefined, categoria: 'Motion graphics', bloqueado: bloqueado || undefined };
}

async function saveImage(src: string, out: string): Promise<boolean> {
  const tmp = `${out}.download`;
  try {
    if (src.startsWith('data:image/')) {
      await fsp.writeFile(tmp, Buffer.from(src.slice(src.indexOf(',') + 1), 'base64'));
    } else {
      checkUrl(src);
      const r = await fetch(src, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return false;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 15 * 1024 * 1024) return false;
      await fsp.writeFile(tmp, buf);
    }
    await run('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', out]);
    return true;
  } catch {
    return false;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

/** Paleta das imagens (capa + quadros): k-means em 48×48 cada (determinístico), as cores mais presentes primeiro. */
export async function extractPalette(imgs: string | string[], k = 9): Promise<string[]> {
  const S = 48;
  const raw = path.join(os.tmpdir(), `ne-pal-${process.pid}-${Date.now()}.rgb`);
  try {
    const bufs: Buffer[] = [];
    for (const img of (Array.isArray(imgs) ? imgs : [imgs]).slice(0, 24)) {
      await run('ffmpeg', ['-y', '-v', 'error', '-i', img, '-frames:v', '1', '-vf', `scale=${S}:${S}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
      bufs.push(await fsp.readFile(raw));
    }
    const px = Buffer.concat(bufs);
    const pts: [number, number, number][] = [];
    for (let i = 0; i + 2 < px.length; i += 3) pts.push([px[i]!, px[i + 1]!, px[i + 2]!]);
    const lumOf = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!;
    const sorted = [...pts].sort((a, b) => lumOf(a) - lumOf(b));
    let cent = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]!] as [number, number, number]);
    let assign = new Array<number>(pts.length).fill(0);
    for (let it = 0; it < 12; it++) {
      assign = pts.map((p) => {
        let best = 0;
        let bd = Infinity;
        cent.forEach((c, j) => {
          const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
          if (d < bd) {
            bd = d;
            best = j;
          }
        });
        return best;
      });
      cent = cent.map((c, j) => {
        const mine = pts.filter((_, i) => assign[i] === j);
        if (!mine.length) return c;
        return [0, 1, 2].map((ch) => Math.round(mine.reduce((a, p) => a + p[ch]!, 0) / mine.length)) as [number, number, number];
      });
    }
    const counts = cent.map((_, j) => assign.filter((a) => a === j).length);
    const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    const out: string[] = [];
    for (const j of counts.map((n, j) => [n, j] as const).sort((a, b) => b[0] - a[0]).map(([, j]) => j)) {
      if (counts[j]! / pts.length < 0.03) continue;
      // Funde cores quase iguais.
      if (out.some((h) => {
        const a = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        return Math.abs(a[0]! - cent[j]![0]) + Math.abs(a[1]! - cent[j]![1]) + Math.abs(a[2]! - cent[j]![2]) < 40;
      })) continue;
      out.push(hex(cent[j]!));
    }
    // O acento quase nunca é a cor dominante (o vermelho num fundo preto): a cor mais viva entra mesmo pequena.
    const satOf = (c: number[]) => (Math.max(...c) === 0 ? 0 : (Math.max(...c) - Math.min(...c)) / Math.max(...c));
    const vivid = cent
      .map((c, j) => ({ c, j, s: satOf(c) * (0.35 + Math.max(...c) / 255) }))
      .filter((x) => counts[x.j]! / pts.length >= 0.006 && satOf(x.c) > 0.38 && Math.max(...x.c) > 70)
      .sort((a, b) => b.s - a.s)
      .slice(0, 2)
      .map((x) => hex(x.c));
    const final = out.slice(0, 6 - vivid.filter((h) => !out.includes(h)).length);
    for (const h of vivid) if (!final.includes(h)) final.push(h);
    return final;
  } catch {
    return [];
  } finally {
    await fsp.rm(raw, { force: true });
  }
}

export interface NewRef {
  link: string;
  obra?: string;
  categoria?: string;
  familias?: string[];
  resumo?: string;
  fio?: string;
  mecanismo?: string;
  roubar?: string[];
  serve?: string;
  evitar?: string;
  /** Imagem colada pelo editor (data URL) quando o site não entrega capa. */
  capa?: string;
  /** 'lettering' guarda na biblioteca de lettering (aba Texto). */
  uso?: 'motion' | 'lettering';
  estilo?: string;
}

const yamlStr = (s: string) => JSON.stringify(s);
const yamlArr = (a: string[]) => `[${a.map((x) => JSON.stringify(x)).join(', ')}]`;

function renderMd(r: { obra: string; categoria: string; familias: string[]; link: string; paleta: string[]; capa?: string; resumo: string; fio: string; mecanismo: string; roubar: string[]; serve: string; evitar: string; autor?: string; uso?: string; estilo?: string; acento?: string }): string {
  const today = new Date().toISOString().slice(0, 10);
  const fam = r.familias.length ? r.familias.map((f) => `[[Mapa Estético#${f}|${f}]]`).join(' · ') : '—';
  return [
    '---',
    'tipo: referência',
    r.uso === 'lettering' ? 'uso: lettering' : '',
    r.estilo ? `estilo: ${r.estilo}` : '',
    r.acento ? `acento: ${yamlStr(r.acento)}` : '',
    `obra: ${yamlStr(r.obra)}`,
    `categoria: ${yamlStr(r.categoria)}`,
    `familias: ${yamlArr(r.familias)}`,
    `link: ${r.link}`,
    `paleta: ${yamlArr(r.paleta)}`,
    'quadros: 0',
    'planos: 0',
    'pasta_quadros: "quadros"',
    r.capa ? `capa: ${yamlStr(r.capa)}` : '',
    r.autor ? `autor: ${yamlStr(r.autor)}` : '',
    'fonte: "NewEditor.AI"',
    `adicionada_em: ${today}`,
    `tags: [referência${r.familias.map((f) => `, "familia/${slugify(f)}"`).join('')}]`,
    '---',
    `# ${r.obra}`,
    '',
    r.capa ? `![[${r.capa}|900]]` : '',
    '',
    `> ${r.resumo || 'Referência adicionada pelo NewEditor.AI.'}`,
    '',
    `**Categoria:** ${r.categoria} · **Famílias:** ${fam} · [Link](${r.link})`,
    '',
    '## Paleta',
    '| Cor | Hex |',
    '|---|---|',
    ...r.paleta.map((h, i) => `| cor ${i + 1} | \`${h}\` |`),
    '',
    '## Como conta a história',
    `- **Fio condutor:** ${r.fio || '—'}`,
    `- **Mecanismo:** ${r.mecanismo || '—'}`,
    '',
    '## O que roubar',
    ...(r.roubar.length ? r.roubar.map((x) => `- ${x}`) : ['- —']),
    '',
    '## Quando usar',
    `- **Serve para:** ${r.serve || '—'}`,
    `- **Evitar em:** ${r.evitar || '—'}`,
    '',
    '## Storyboard',
    '| Plano | Quadros | O que acontece | Técnica / transição |',
    '|---|---|---|---|',
    '',
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
}

export async function createRef(inp: NewRef): Promise<MotionRef> {
  const meta = await fetchLinkMeta(inp.link);
  const obra = (inp.obra?.trim() || meta.titulo).slice(0, 120);
  let id = slugify(obra);
  for (let n = 2; fs.existsSync(path.join(REFS_DIR, id)); n++) id = `${slugify(obra)}-${n}`;
  const dir = path.join(REFS_DIR, id);
  await fsp.mkdir(path.join(dir, 'quadros'), { recursive: true });
  let capa: string | undefined;
  const capaFile = path.join(dir, 'capa.jpg');
  if ((inp.capa && (await saveImage(inp.capa, capaFile))) || (meta.imagem && (await saveImage(meta.imagem, capaFile)))) capa = 'capa.jpg';
  // YouTube sem maxres: tenta a hq.
  if (!capa && meta.imagem?.includes('maxresdefault') && (await saveImage(meta.imagem.replace('maxresdefault', 'hqdefault'), capaFile))) capa = 'capa.jpg';
  const paleta = capa ? await extractPalette(capaFile) : [];
  const file = `Ref - ${obra.replace(/[\\/:*?"<>|]/g, '-')}.md`;
  const md = renderMd({
    obra,
    categoria: inp.categoria || meta.categoria,
    familias: inp.familias ?? [],
    link: meta.link,
    paleta,
    capa,
    resumo: inp.resumo?.trim() || meta.descricao.replace(/\s+/g, ' ').slice(0, 280),
    fio: inp.fio ?? '',
    mecanismo: inp.mecanismo ?? '',
    roubar: inp.roubar ?? [],
    serve: inp.serve ?? '',
    evitar: inp.evitar ?? '',
    autor: meta.autor,
    uso: inp.uso,
    estilo: inp.uso === 'lettering' ? (inp.estilo ?? 'auto-serifa') : undefined,
    acento: inp.uso === 'lettering' ? accentOf(paleta) : undefined,
  });
  await fsp.writeFile(path.join(dir, file), md);
  return toRef(id, file, md, []);
}

// ---------------------------------------------------------------------------
// Editar / remover (edita o .md no lugar: storyboard e notas do vault ficam intactos)
// ---------------------------------------------------------------------------

function setFm(md: string, key: string, value: string): string {
  const { body } = parseFrontmatter(md);
  const head = md.slice(0, md.length - body.length);
  const re = new RegExp(`^${key}:.*$`, 'm');
  const next = re.test(head) ? head.replace(re, `${key}: ${value}`) : head.replace(/\n---\n?$/, `\n${key}: ${value}\n---\n`);
  return next + body;
}

function setLabeled(md: string, title: string, label: string, text: string): string {
  const re = new RegExp(`^(\\s*-\\s+\\*\\*${label}:?\\*\\*:?).*$`, 'm');
  if (re.test(md)) return md.replace(re, `$1 ${text || '—'}`);
  return setSectionLines(md, title, [...section(parseFrontmatter(md).body, title).filter((l) => l.trim()), `- **${label}:** ${text || '—'}`]);
}

function setSectionLines(md: string, title: string, lines: string[]): string {
  const all = md.split('\n');
  const i = all.findIndex((l) => l.trim().toLowerCase().startsWith(`## ${title.toLowerCase()}`));
  if (i < 0) return `${md.trimEnd()}\n\n## ${title}\n${lines.join('\n')}\n`;
  let j = i + 1;
  while (j < all.length && !all[j]!.startsWith('## ') && !all[j]!.startsWith('<!--')) j++;
  return [...all.slice(0, i + 1), ...lines, '', ...all.slice(j)].join('\n');
}

export type RefPatch = Partial<Pick<MotionRef, 'obra' | 'categoria' | 'familias' | 'resumo' | 'fio' | 'mecanismo' | 'roubar' | 'serve' | 'evitar' | 'link' | 'estilo' | 'accent'>>;

export async function patchRef(id: string, patch: RefPatch): Promise<MotionRef> {
  const dir = path.join(REFS_DIR, path.basename(id));
  const file = await mdFile(dir);
  if (!file) throw Object.assign(new Error('referência não existe'), { statusCode: 404 });
  let md = await fsp.readFile(path.join(dir, file), 'utf8');
  if (patch.obra !== undefined) md = setFm(md, 'obra', yamlStr(patch.obra)).replace(/^# .*$/m, `# ${patch.obra}`);
  if (patch.categoria !== undefined) md = setFm(md, 'categoria', patch.categoria);
  if (patch.estilo !== undefined) md = setFm(md, 'estilo', patch.estilo);
  if (patch.accent !== undefined && /^#[0-9a-f]{6}$/i.test(patch.accent)) md = setFm(md, 'acento', yamlStr(patch.accent.toUpperCase()));
  if (patch.familias !== undefined) md = setFm(md, 'familias', yamlArr(patch.familias));
  if (patch.link !== undefined) md = setFm(md, 'link', checkUrl(patch.link).toString());
  if (patch.resumo !== undefined) md = /^> .*$/m.test(md) ? md.replace(/^> .*$/m, `> ${patch.resumo}`) : md.replace(/^(# .*)$/m, `$1\n\n> ${patch.resumo}`);
  if (patch.fio !== undefined) md = setLabeled(md, 'Como conta a história', 'Fio condutor', patch.fio);
  if (patch.mecanismo !== undefined) md = setLabeled(md, 'Como conta a história', 'Mecanismo', patch.mecanismo);
  if (patch.serve !== undefined) md = setLabeled(md, 'Quando usar', 'Serve para', patch.serve);
  if (patch.evitar !== undefined) md = setLabeled(md, 'Quando usar', 'Evitar em', patch.evitar);
  if (patch.roubar !== undefined) md = setSectionLines(md, 'O que roubar', patch.roubar.filter(Boolean).map((x) => `- ${x}`));
  await fsp.writeFile(path.join(dir, file), md);
  return (await getRef(path.basename(id)))!;
}

/** Adiciona um quadro (imagem colada/arrastada) ao storyboard da referência. */
export async function addFrame(id: string, image: string, legenda = ''): Promise<MotionRef> {
  const dir = path.join(REFS_DIR, path.basename(id));
  const file = await mdFile(dir);
  if (!file) throw Object.assign(new Error('referência não existe'), { statusCode: 404 });
  await fsp.mkdir(path.join(dir, 'quadros'), { recursive: true });
  const n = (await fsp.readdir(path.join(dir, 'quadros'))).length + 1;
  const name = `q${String(n).padStart(2, '0')}.jpg`;
  if (!(await saveImage(image, path.join(dir, 'quadros', name)))) throw Object.assign(new Error('não consegui ler essa imagem'), { statusCode: 400 });
  let md = await fsp.readFile(path.join(dir, file), 'utf8');
  if (!/^## Storyboard/m.test(md)) md = `${md.trimEnd()}\n\n## Storyboard\n| Plano | Quadros | O que acontece | Técnica / transição |\n|---|---|---|---|\n`;
  const row = `| **${String(n).padStart(2, '0')}** | ![[quadros/${name}\\|300]] | ${legenda.replace(/\|/g, '/') || '—'} | — |`;
  const lines = md.split('\n');
  const s = lines.findIndex((l) => l.startsWith('## Storyboard'));
  let end = s + 1;
  while (end < lines.length && !lines[end]!.startsWith('## ') && !lines[end]!.startsWith('<!--')) end++;
  while (end > s + 1 && !lines[end - 1]!.trim()) end--;
  lines.splice(end, 0, row);
  md = setFm(lines.join('\n'), 'quadros', String(n));
  if (!parseFrontmatter(md).fm.capa && !fs.existsSync(path.join(dir, 'capa.jpg'))) md = setFm(md, 'capa', yamlStr(`quadros/${name}`));
  // Referência criada aqui: a paleta passa a vir dos QUADROS do motion (a capa de um vídeo raramente é o motion).
  if (String(parseFrontmatter(md).fm.fonte ?? '') === 'NewEditor.AI') {
    const frames = (await fsp.readdir(path.join(dir, 'quadros'))).filter((x) => /\.(jpe?g|png|webp)$/i.test(x)).map((x) => path.join(dir, 'quadros', x));
    const paleta = await extractPalette(frames);
    if (paleta.length) {
      md = setFm(md, 'paleta', yamlArr(paleta));
      md = setSectionLines(md, 'Paleta', ['| Cor | Hex |', '|---|---|', ...paleta.map((h, i) => `| cor ${i + 1} | \`${h}\` |`)]);
    }
  }
  await fsp.writeFile(path.join(dir, file), md);
  return (await getRef(path.basename(id)))!;
}

/** Remove da biblioteca movendo para `.lixeira/` (nada é apagado de verdade). */
export async function trashRef(id: string): Promise<void> {
  const dir = path.join(REFS_DIR, path.basename(id));
  if (!fs.existsSync(dir)) throw Object.assign(new Error('referência não existe'), { statusCode: 404 });
  await fsp.mkdir(TRASH, { recursive: true });
  await fsp.rename(dir, path.join(TRASH, `${path.basename(id)}-${Date.now()}`));
}

// ---------------------------------------------------------------------------
// Referências de LETTERING — importar os modelos do Legendas Master (Premiere)
// ---------------------------------------------------------------------------

export const LETTERING_SOURCE = process.env.NEWEDITOR_LETTERING_DIR ?? path.join(os.homedir(), 'Documents', 'Legendas Master 5.1', 'Legendas Master', 'templates');

/** Qual estilo do NewEditor reproduz cada família de modelo (editável depois, na própria referência). */
const VIRAL_UMA_LINHA: Record<string, string> = {
  'template 1': 'apple', 'template 2': 'impacto', 'template 3': 'auto-serifa', 'template 4': 'glow', 'template 5': 'typewriter', 'template 6': 'typewriter',
  'template 7': 'glow', 'template 8': 'glow', 'template 9': 'impacto', 'template 10': 'impacto', 'template 11': 'auto-serifa', 'template 12': 'auto-serifa', 'template 13': 'pop-box',
};
function estiloFor(categoria: string, nome: string, linhas: string, accentVivid: boolean): string {
  const n = nome.toLowerCase();
  if (categoria === 'Auto') return n.includes('3') ? 'auto-condensada' : n.includes('2') ? 'auto-serifa-bold' : 'auto-serifa';
  if (categoria === 'Apple style') return 'apple';
  if (categoria === 'Marca Texto') return 'marca-texto';
  if (categoria === 'Difference') return 'auto-serifa-bold';
  if (categoria === 'Viral' && /uma linha/i.test(linhas)) return VIRAL_UMA_LINHA[n] ?? 'apple';
  return accentVivid ? 'glow' : 'auto-serifa-bold';
}

/** A cor de acento do modelo: a mais viva da capa, levada ao brilho de texto (o glow da miniatura escurece a cor). */
function accentOf(paleta: string[]): string | undefined {
  const hsv = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const mx = Math.max(...c);
    return { c, v: mx / 255, s: mx ? (mx - Math.min(...c)) / mx : 0 };
  };
  const best = paleta.map(hsv).filter((x) => x.s > 0.45 && x.v > 0.3).sort((a, b) => b.s * b.v - a.s * a.v)[0];
  if (!best) return undefined;
  const k = best.v < 0.9 ? 0.92 / best.v : 1;
  return `#${best.c.map((x) => Math.min(255, Math.round(x * k)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * Cada modelo (pasta com thumb.jpg) vira uma referência de lettering: capa, um preview curto em mp4 (sem áudio),
 * os nomes dos SFX que vinham com ele e o estilo do NewEditor que o reproduz. Os arquivos de template do plugin
 * (.cgt/.cga) não são abertos — são protegidos; a referência é visual. Idempotente.
 */
export async function importLetteringModels(src = LETTERING_SOURCE, onProgress?: (done: number, total: number) => void): Promise<{ importadas: number; existentes: number; origem: string }> {
  const dirs: string[] = [];
  const walk = async (d: string, depth: number) => {
    const items = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
    if (items.some((x) => x.isFile() && x.name === 'thumb.jpg')) dirs.push(d);
    if (depth < 4) for (const x of items) if (x.isDirectory() && !x.name.startsWith('.')) await walk(path.join(d, x.name), depth + 1);
  };
  await walk(src, 0);
  if (!dirs.length) throw Object.assign(new Error(`não achei modelos (pastas com thumb.jpg) em ${src}`), { statusCode: 404 });
  let importadas = 0;
  let existentes = 0;
  for (const [n, d] of dirs.entries()) {
    onProgress?.(n, dirs.length);
    const rel = path.relative(src, d).split(path.sep);
    const categoria = rel[0] ?? 'Lettering';
    const linhas = rel.length > 2 ? rel[1]! : '';
    const nome = rel[rel.length - 1]!;
    const obra = [categoria, linhas, nome].filter(Boolean).join(' · ');
    const id = `lt-${slugify(obra)}`;
    const dir = path.join(REFS_DIR, id);
    if (fs.existsSync(dir)) {
      existentes++;
      continue;
    }
    await fsp.mkdir(dir, { recursive: true });
    const files = await fsp.readdir(d);
    await run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(d, 'thumb.jpg'), '-vf', "scale='min(640,iw)':-2", '-q:v', '3', path.join(dir, 'capa.jpg')]);
    const video = files.filter((f) => /\.mp4$/i.test(f)).sort((a, b) => Number(/preview/i.test(b)) - Number(/preview/i.test(a)))[0];
    let preview: string | undefined;
    if (video) {
      try {
        await run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(d, video), '-t', '6', '-an', '-vf', 'scale=540:-2,fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'preview.mp4')]);
        preview = 'preview.mp4';
      } catch {
        /* sem preview */
      }
    }
    const sfx = files.filter((f) => /\.(wav|mp3)$/i.test(f)).map((f) => f.replace(/\.(wav|mp3)$/i, '').replace(/[_#-]\d{6,}.*$/, '').trim());
    const paleta = await extractPalette(path.join(dir, 'capa.jpg'));
    // Auto, Apple e Difference têm texto branco (a cor da capa é do fundo): sem acento.
    const accent = /^(Auto|Apple style|Difference)$/.test(categoria) ? undefined : accentOf(paleta);
    const estilo = estiloFor(categoria, nome, linhas, !!accent);
    const md = [
      '---',
      'tipo: referência',
      'uso: lettering',
      `obra: ${yamlStr(obra)}`,
      `categoria: ${yamlStr(categoria)}`,
      `familias: ${yamlArr([linhas || '1 linha'].filter(Boolean))}`,
      `estilo: ${estilo}`,
      accent ? `acento: ${yamlStr(accent)}` : '',
      `paleta: ${yamlArr(paleta)}`,
      'capa: "capa.jpg"',
      preview ? `preview: "${preview}"` : '',
      `sfx: ${yamlArr(sfx)}`,
      'origem: "Legendas Master 5.1 (Premiere Pro)"',
      'fonte: "NewEditor.AI"',
      `adicionada_em: ${new Date().toISOString().slice(0, 10)}`,
      'tags: [referência, lettering]',
      '---',
      `# ${obra}`,
      '',
      '![[capa.jpg|640]]',
      '',
      `> Modelo de lettering do Legendas Master (${categoria}${linhas ? `, ${linhas}` : ''}). No NewEditor ele é reproduzido pelo estilo **${estilo}**.`,
      '',
      '## Como conta a história',
      '- **Fio condutor:** a fala vira texto na altura da legenda; a palavra-chave ganha o destaque.',
      `- **Mecanismo:** ${estilo}`,
      '',
      '## Quando usar',
      '- **Serve para:** —',
      '- **Evitar em:** —',
      '',
      sfx.length ? `## SFX do modelo\n${sfx.map((x) => `- ${x}`).join('\n')}\n` : '',
    ]
      .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
      .join('\n');
    await fsp.writeFile(path.join(dir, `Ref - ${obra.replace(/[\\/:*?"<>|]/g, '-')}.md`), md);
    importadas++;
  }
  onProgress?.(dirs.length, dirs.length);
  return { importadas, existentes, origem: src };
}
