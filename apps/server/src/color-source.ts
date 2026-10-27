/**
 * Color management por clipe, como o DaVinci (Input Color Space): o espaço de cor de entrada sai do PRÓPRIO arquivo
 * (XML NonRealTimeMeta da Sony, embutido no MP4 ou ao lado no cartão), nunca de palpite pelo quadro nem da grade do
 * reel vizinho. Arquivo LOG converte sempre pela LUT oficial do fabricante quando ela está no disco (as da Sony vêm
 * com o DaVinci Resolve). Câmera derivada (recorte ProRes de um bruto, que apaga o XML) herda do bruto de origem.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { localLutId, manageGrade, gradeWasForced, type ColorGrade, type InputTransform, type MediaAsset, type Project, type SourceColor } from '@neweditor/core';
import { run } from './media.ts';

/** Onde procurar as LUTs oficiais (a pasta do DaVinci; `NEWEDITOR_LUT_DIR` troca, para teste ou outra máquina). */
const LUT_DIRS = () => [process.env.NEWEDITOR_LUT_DIR, '/Library/Application Support/Blackmagic Design/DaVinci Resolve/LUT'].filter(Boolean) as string[];
/** LUT oficial por entrada: S-Log3/S-Gamut3.Cine → Rec.709 (LC-709 Type A, "full in full out", a da Sony no Resolve). */
const OFFICIAL: Partial<Record<InputTransform, { file: string; gamut: RegExp; nome: string }>> = {
  slog3: { file: 'Sony/SLog3SGamut3.CineToLC-709TypeA.cube', gamut: /cine/i, nome: 'Sony S-Log3/S-Gamut3.Cine → LC-709 Type A (oficial)' },
};

/** Lê o XML da Sony (NonRealTimeMeta): curva, gamut e modelo. Curva desconhecida = null (não adivinha). */
export function sonyXmlColor(xml: string): Pick<SourceColor, 'input' | 'gamma' | 'gamut' | 'modelo'> | null {
  if (!/<NonRealTimeMeta/i.test(xml)) return null;
  const item = (name: string) => new RegExp(`<Item\\s+name="${name}"\\s+value="([^"]*)"`, 'i').exec(xml)?.[1];
  const gamma = item('CaptureGammaEquation');
  const gamut = item('CaptureColorPrimaries');
  const modelo = /<Device[^>]*modelName="([^"]*)"/i.exec(xml)?.[1];
  if (!gamma) return null;
  let input: InputTransform | null = null;
  if (/^s-log3/i.test(gamma)) input = 'slog3';
  else if (/^(rec709|s-cinetone|itu709|bt709)/i.test(gamma)) input = 'rec709';
  if (!input) return null;
  return { input, gamma, ...(gamut ? { gamut } : {}), ...(modelo ? { modelo } : {}) };
}

/** XML da câmera: caixa `meta`/`uuid`/`udta` de topo do MP4 (a Sony grava depois do moov) ou o `<nome>M01.XML` ao lado. */
export async function cameraXml(file: string): Promise<string | null> {
  const fh = await fs.open(file, 'r').catch(() => null);
  if (fh) {
    try {
      const size = (await fh.stat()).size;
      const head = Buffer.alloc(16);
      let off = 0;
      for (let n = 0; off + 8 <= size && n < 64; n++) {
        await fh.read(head, 0, 16, off);
        let box = head.readUInt32BE(0);
        const type = head.toString('latin1', 4, 8);
        if (box === 1) box = Number(head.readBigUInt64BE(8));
        else if (box === 0) box = size - off;
        if (box < 8 || !/^[\x20-\x7e]{4}$/.test(type)) break;
        if ((type === 'meta' || type === 'uuid' || type === 'udta') && box < 4 * 1024 * 1024) {
          const buf = Buffer.alloc(box);
          await fh.read(buf, 0, box, off);
          const s = buf.toString('utf8');
          const i = s.indexOf('<?xml');
          if (i >= 0 && s.includes('NonRealTimeMeta')) return s.slice(i);
        }
        off += box;
      }
    } finally {
      await fh.close();
    }
  }
  const dir = path.dirname(file);
  const stem = path.basename(file, path.extname(file));
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const side = names.find((n) => n.toLowerCase() === `${stem.toLowerCase()}m01.xml`);
  return side ? fs.readFile(path.join(dir, side), 'utf8').catch(() => null) : null;
}

/** LUT oficial de entrada no disco (ou nada: a conversão da casa assume). */
export async function officialInputLut(input: InputTransform, gamut?: string): Promise<SourceColor['inputLut']> {
  const o = OFFICIAL[input];
  if (!o || (gamut && !o.gamut.test(gamut))) return undefined;
  for (const dir of LUT_DIRS()) {
    const f = path.join(dir, o.file);
    if ((await fs.stat(f).catch(() => null))?.isFile()) return { id: localLutId(f), nome: o.nome };
  }
  return undefined;
}

/** Faixa do arquivo: bruto de câmera yuvj (pc) guarda o código direto. */
async function codeRangeOf(file: string): Promise<SourceColor['codeRange']> {
  const raw = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,color_range', '-of', 'csv=p=0', file]).catch(() => Buffer.from(''))).toString();
  return /yuvj|\bpc\b/.test(raw) ? 'full' : 'legal';
}

const cache = new Map<string, Promise<SourceColor | null>>();
/** Espaço de cor de entrada de um arquivo, pelo XML da câmera (em cache por caminho, tamanho e data). */
export async function readSourceColor(file: string): Promise<SourceColor | null> {
  const st = await fs.stat(file).catch(() => null);
  if (!st) return null;
  const key = `${file}@${st.size}@${st.mtimeMs}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const xml = await cameraXml(file);
      const c = xml ? sonyXmlColor(xml) : null;
      if (!c) return null;
      const inputLut = c.input === 'rec709' ? undefined : await officialInputLut(c.input, c.gamut);
      return { ...c, fonte: 'xml' as const, codeRange: await codeRangeOf(file), ...(inputLut ? { inputLut } : {}) };
    })();
    cache.set(key, hit);
  }
  return hit;
}

/** Id do clipe da câmera no nome (Sony: C3039.MP4 → "C3039"; recorte C3039_cam9x16_A5.mov → "C3039"). */
export const clipStem = (name: string | undefined): string | null => (name ? (/^([A-Z]\d{4})(?=[^\d]|$)/i.exec(path.basename(name))?.[1]?.toUpperCase() ?? null) : null);

/**
 * Cor de cada vídeo do projeto: a gravada no asset, a do XML do arquivo, ou herdada do bruto com o mesmo clipe (outro
 * asset do projeto, ou o bruto na pasta das falas). A câmera derivada converte como o bruto e com a faixa do bruto
 * (o recorte em ProRes leva a faixa cheia do bruto para a legal, que a decodificação expande de volta ao código).
 */
export async function projectColors(p: Pick<Project, 'assets'>): Promise<Map<string, SourceColor>> {
  const out = new Map<string, SourceColor>();
  const videos = p.assets.filter((a) => a.kind === 'video' && !a.alpha);
  for (const a of videos) {
    const c = a.color ?? (await readSourceColor(a.path));
    if (c) out.set(a.id, c);
  }
  const rawDirs = [...new Set(videos.filter((a) => out.get(a.id)?.fonte === 'xml').map((a) => path.dirname(a.path)))];
  for (const a of videos) {
    if (out.has(a.id)) continue;
    const stem = clipStem(a.name || a.path);
    if (!stem) continue;
    // Só com UM candidato: dois corpos Sony recomeçam a numeração e o C0012 de uma câmera não é o da outra.
    const pais = videos.filter((b) => b.id !== a.id && out.get(b.id)?.fonte === 'xml' && clipStem(b.name || b.path) === stem);
    const pai = pais.length === 1 ? pais[0] : undefined;
    if (pais.length > 1) continue;
    let c: SourceColor | null = pai ? out.get(pai.id)! : null;
    let de = pai ? pai.name || path.basename(pai.path) : undefined;
    if (!c) {
      for (const dir of rawDirs) {
        const names = await fs.readdir(dir).catch(() => [] as string[]);
        const raws = names.filter((n) => /\.(mp4|mxf|mov)$/i.test(n) && path.basename(n, path.extname(n)).toUpperCase() === stem);
        const raw = raws.length === 1 ? raws[0] : undefined;
        if (raw && (c = await readSourceColor(path.join(dir, raw)))) {
          de = raw;
          break;
        }
      }
    }
    // A faixa é a do bruto: o recorte feito direito (pc→tv) volta ao código na decodificação; bruto tv segue tv.
    if (c && c.input !== 'rec709') out.set(a.id, { ...c, fonte: 'herdado', de });
  }
  return out;
}

/**
 * Grades do export com o color management aplicado: todo vídeo LOG converte (com ou sem grade salva), e a grade feita
 * em Rec.709 sobre LOG é corrigida na entrada, com aviso. `notes` vai para o resultado do render.
 */
export async function managedGrades(p: Pick<Project, 'assets' | 'timeline'>, grades = p.timeline.grades): Promise<{ grades: Record<string, ColorGrade>; colors: Map<string, SourceColor>; notes: string[] }> {
  const colors = await projectColors(p);
  const out: Record<string, ColorGrade> = { ...(grades ?? {}) };
  const notes: string[] = [];
  const forced: string[] = [];
  const conv = new Set<string>();
  const names = new Map(p.assets.map((a) => [a.id, a.name || path.basename(a.path ?? '')]));
  for (const [id, c] of colors) {
    if (c.input === 'rec709') continue;
    const g = manageGrade(out[id], c)!;
    if (gradeWasForced(out[id], c)) forced.push(names.get(id) ?? id);
    out[id] = g;
    conv.add(`${c.gamma ?? c.input}${c.inputLut ? ' pela LUT oficial' : ' pela conversão da casa (LUT oficial não achada)'}`);
  }
  if (conv.size) notes.push(`cor: entrada lida do arquivo, ${[...conv].join('; ')}`);
  if (forced.length) notes.push(`ATENÇÃO: grade feita como Rec.709 em arquivo LOG (${forced.slice(0, 4).join(', ')}${forced.length > 4 ? '…' : ''}): convertida pela entrada do arquivo; contraste, saturação e curvas daquela grade foram zerados (eram compensação do LOG lavado), ficou o balanço de branco: revise a cor sobre a imagem convertida`);
  return { grades: out, colors, notes };
}

/** O asset com a cor do arquivo gravada (ingest): o preview e o export leem a mesma. */
export async function withSourceColor(a: MediaAsset): Promise<MediaAsset> {
  if (a.kind !== 'video' || a.alpha) return a;
  const c = await readSourceColor(a.path).catch(() => null);
  return c ? { ...a, color: c } : a;
}
