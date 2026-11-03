/**
 * Color management por clipe, como o DaVinci (Input Color Space): o espaço de cor de entrada sai do PRÓPRIO arquivo
 * (XML NonRealTimeMeta da Sony, embutido no MP4 ou ao lado no cartão), nunca de palpite pelo quadro nem da grade do
 * reel vizinho. Arquivo S-Log3 converte pela conversão embutida no app (LC-709 Type A, `slog3Lc709TypeA` no core,
 * BL-0159): nenhuma LUT é lida da pasta do DaVinci Resolve, nem o Resolve precisa estar instalado.
 * Câmera derivada (recorte ProRes de um bruto, que apaga o XML) herda do bruto de origem.
 * BL-0175 F1: a leitura passa pelo perfil de captura (`capture-profile.ts`), em que o XML da Sony é a 1ª camada e as
 * outras câmeras (HLG, Apple Log, Blackmagic, celular SDR) saem do metadado; sem sinal, `desconhecida`, nunca Rec.709
 * presumido em silêncio.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_INPUT, captureLine, manageGrade, gradeWasForced, type ColorGrade, type InputTransform, type MediaAsset, type Project, type SourceColor } from '@neweditor/core';
import { detectCapture, knownCapture } from './capture-profile.ts';

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

/** Como a entrada LOG vira Rec.709, para a nota do render e do ingest. */
export const convertedBy = (c: Pick<SourceColor, 'input' | 'inputLut'>): string =>
  BUILTIN_INPUT[c.input] ? `pela conversão embutida (${BUILTIN_INPUT[c.input]})` : c.inputLut ? `pela LUT de entrada (${c.inputLut.nome})` : 'pela conversão da casa';

/**
 * Espaço de cor de entrada de um arquivo com a curva DECIDIDA pelo perfil de captura (XML da Sony, sidecar, tags…);
 * null quando a curva é desconhecida. Para ter também a câmera e o "desconhecida", use `detectCapture`.
 */
export async function readSourceColor(file: string): Promise<SourceColor | null> {
  const c = await detectCapture(file);
  return knownCapture(c) ? c : null;
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
    // Cor gravada no asset vale; `desconhecida` gravada é lida de novo (o bruto pode ter chegado depois).
    const c = knownCapture(a.color) ? a.color : await detectCapture(a.path).catch(() => null);
    if (c) out.set(a.id, c);
  }
  const rawDirs = [...new Set(videos.filter((a) => out.get(a.id)?.fonte === 'xml').map((a) => path.dirname(a.path)))];
  for (const a of videos) {
    // Herda do bruto Sony quando o próprio arquivo não decidiu, ou só disse Rec.709 por tag/marca/codec: o recorte
    // ProRes de um S-Log3 pode levar bt709 no stream (o XAVC já marca assim), e o XML do bruto é a verdade.
    const own = out.get(a.id);
    if (own && knownCapture(own) && !(own.input === 'rec709' && (own.fonte === 'tag' || own.fonte === 'container' || own.fonte === 'codec'))) continue;
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
    conv.add(`${c.gamma ?? c.input} ${convertedBy(c)}`);
  }
  if (conv.size) notes.push(`cor: entrada lida do arquivo, ${[...conv].join('; ')}`);
  // Perfil de captura (BL-0175): uma linha por câmera/curva, e as desconhecidas ditas assim (nunca Rec.709 em silêncio).
  const perfis = new Set<string>();
  for (const c of colors.values()) perfis.add(captureLine(c));
  if (perfis.size) notes.push(`perfil de captura: ${[...perfis].join('; ')}`);
  if (forced.length) notes.push(`ATENÇÃO: grade feita como Rec.709 em arquivo LOG (${forced.slice(0, 4).join(', ')}${forced.length > 4 ? '…' : ''}): convertida pela entrada do arquivo; contraste, saturação e curvas daquela grade foram zerados (eram compensação do LOG lavado), ficou o balanço de branco: revise a cor sobre a imagem convertida`);
  return { grades: out, colors, notes };
}

/** O asset com a cor do arquivo gravada (ingest): o preview e o export leem a mesma. */
export async function withSourceColor(a: MediaAsset): Promise<MediaAsset> {
  if (a.kind !== 'video' || a.alpha) return a;
  const c = await detectCapture(a.path).catch(() => null);
  return c ? { ...a, color: c } : a;
}
