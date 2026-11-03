/**
 * Perfil de captura automático no ingest (BL-0175 F1, FB-0185): identifica câmera e curva pelo metadado do PRÓPRIO
 * arquivo e escolhe a conversão para Rec.709 na tabela versionada (`CAPTURE_TABLE`, packages/core/src/cameras.ts),
 * sem perguntar nada ao dono. A primeira camada que responde vence:
 *
 *   1. sidecar / metadado do fabricante: XML NonRealTimeMeta da Sony (caixa do MP4 ou `<clipe>M01.XML`), `.sidecar`
 *      da Blackmagic ao lado, chaves `com.blackmagic-design.camera.*` do ProRes da câmera;
 *   2. tags do stream no ffprobe: color_transfer arib-std-b67 = HLG, tag com "Apple Log", bt709/smpte170m explícito;
 *   3. Make/Model do container (com.apple.quicktime.*, com.android.*, make/model);
 *   4. codec (ProRes de Blackmagic sem gamma; BRAW/ProRes RAW, que o FFmpeg não lê);
 *   5. nada respondeu: `desconhecida` (nunca Rec.709 presumido).
 *
 * Sem dependência nova (só ffprobe; nada de exiftool) e sem serviço externo.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { CAPTURE_TABLE_VERSION, captureRow, type CurvaId, type SourceColor } from '@neweditor/core';
import { cameraXml, sonyXmlColor } from './color-source.ts';
import { run } from './media.ts';

/** O que interessa do ffprobe (stream de vídeo + container). */
export interface CaptureProbe {
  codec_name?: string;
  codec_tag_string?: string;
  pix_fmt?: string;
  color_range?: string;
  color_transfer?: string;
  color_primaries?: string;
  /** Tags do container e do stream, juntas (chave em minúsculas). */
  tags: Record<string, string>;
}

export interface CaptureInput {
  /** Extensão do arquivo, com ponto (".mov"). */
  ext: string;
  probe: CaptureProbe | null;
  /** XML NonRealTimeMeta da Sony (embutido ou ao lado). */
  xml?: string | null;
  /** `.sidecar` da Blackmagic ao lado, já lido como JSON. */
  sidecar?: unknown;
}

type Decisao = Pick<SourceColor, 'input' | 'gamma' | 'gamut' | 'modelo' | 'fonte' | 'camera' | 'curva' | 'confianca' | 'aviso'>;

const tag = (t: Record<string, string>, ...keys: string[]) => keys.map((k) => t[k.toLowerCase()]).find((v) => v && v.trim())?.trim();

/** Marca + modelo do container, para o texto do editor. */
function cameraOf(t: Record<string, string>): { make?: string; model?: string; nome?: string } {
  const make = tag(t, 'com.apple.quicktime.make', 'com.android.manufacturer', 'com.blackmagic-design.camera.manufacturer', 'make', 'manufacturer');
  const model = tag(t, 'com.apple.quicktime.model', 'com.android.model', 'com.blackmagic-design.camera.model', 'model');
  const nome = make && model ? (model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`) : (model ?? make);
  return { make, model, nome };
}

const row = (curva: CurvaId, d: Omit<Decisao, 'input' | 'curva'>): Decisao => ({ ...d, curva, input: captureRow(curva)!.input });
const desconhecida = (camera: string | undefined, aviso: string, extra: Partial<Decisao> = {}): Decisao => ({ input: 'rec709', fonte: 'desconhecida', curva: 'desconhecida', confianca: 'desconhecida', ...(camera ? { camera } : {}), aviso, ...extra });

/** Procura uma chave (regex) em qualquer nível de um JSON (o `.sidecar` da Blackmagic muda de forma entre versões). */
function findKey(o: unknown, re: RegExp, depth = 0): string | undefined {
  if (!o || typeof o !== 'object' || depth > 4) return undefined;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (re.test(k) && (typeof v === 'string' || typeof v === 'number')) return String(v);
  }
  for (const v of Object.values(o as Record<string, unknown>)) {
    const r = findKey(v, re, depth + 1);
    if (r) return r;
  }
  return undefined;
}

/** Gamma da Blackmagic ("Blackmagic Design Film", geração da ciência de cor) → linha da tabela. */
function bmdGamma(gamma: string, gen: string | undefined, fonte: SourceColor['fonte'], camera: string | undefined): Decisao {
  const g = Number(/\d+/.exec(gen ?? '')?.[0] ?? NaN);
  const base = { gamma, fonte, ...(camera ? { camera } : {}) };
  if (/film/i.test(gamma)) {
    if (g === 5 || /gen\s*5/i.test(gamma)) return row('bmd-film-gen5', { ...base, confianca: 'certa' });
    if (!Number.isFinite(g)) return row('bmd-film-gen5', { ...base, confianca: 'provavel', aviso: 'Blackmagic Film sem a geração da ciência de cor no metadado: convertido como Gen5 (a das câmeras atuais); confira se a câmera é Gen4 ou anterior' });
    return desconhecida(camera, `Blackmagic Film Gen${g} fora da tabela (só Gen5 tem conversão em F1)`, { gamma });
  }
  if (/video|rec\.?\s*709|bt\.?709/i.test(gamma) && !/extended/i.test(gamma)) return row('rec709', { ...base, confianca: 'certa' });
  return desconhecida(camera, `curva Blackmagic "${gamma}" fora da tabela`, { gamma });
}

/** Decisão pura (sem disco): a camada mais forte que responde vence. */
export function classifyCapture(inp: CaptureInput): Decisao {
  const t = inp.probe?.tags ?? {};
  const cam = cameraOf(t);
  const p = inp.probe;

  // 1a. XML NonRealTimeMeta da Sony.
  if (inp.xml && /<NonRealTimeMeta/i.test(inp.xml)) {
    const s = sonyXmlColor(inp.xml);
    const camera = `Sony ${s?.modelo ?? /<Device[^>]*modelName="([^"]*)"/i.exec(inp.xml)?.[1] ?? ''}`.trim();
    if (s) return row(s.input === 'slog3' ? 'sony-slog3-sgamut3cine' : 'sony-rec709', { ...s, fonte: 'xml', camera, confianca: 'certa' });
    const gamma = /<Item\s+name="CaptureGammaEquation"\s+value="([^"]*)"/i.exec(inp.xml)?.[1];
    return desconhecida(camera, `XML da Sony com curva ${gamma ? `"${gamma}"` : 'em branco'}, fora da tabela`, gamma ? { gamma } : {});
  }
  // 1b. `.sidecar` da Blackmagic.
  if (inp.sidecar) {
    const gamma = findKey(inp.sidecar, /gamma/i);
    const gen = findKey(inp.sidecar, /color_?science|colou?r_?science|gen(eration)?$/i);
    const camera = findKey(inp.sidecar, /^(camera_?type|camera_?model|model)$/i);
    const nome = camera ? (/blackmagic/i.test(camera) ? camera : `Blackmagic ${camera}`) : 'Blackmagic';
    if (gamma) return bmdGamma(gamma, gen, 'sidecar', nome);
  }
  // 1c. Chaves do fabricante no ProRes da Blackmagic.
  const bmdGammaTag = tag(t, 'com.blackmagic-design.camera.gamma', 'com.blackmagic-design.camera.gammanotes');
  if (bmdGammaTag) return bmdGamma(bmdGammaTag, tag(t, 'com.blackmagic-design.camera.colorscience', 'com.blackmagic-design.camera.colorsciencegen'), 'tag', cam.nome ?? 'Blackmagic');

  // BRAW / ProRes RAW: o FFmpeg não decodifica.
  const raw = /^\.braw$/i.test(inp.ext) || /^brw|^aprn|^aprh/i.test(p?.codec_tag_string ?? '');
  if (raw) return desconhecida(cam.nome ?? (/braw/i.test(inp.ext) ? 'Blackmagic' : undefined), 'BRAW/ProRes RAW não é lido pelo FFmpeg: exporte em ProRes da câmera', { fonte: 'codec' });
  if (!p) return desconhecida(cam.nome, 'ffprobe não leu o arquivo');

  // 2. Tags do stream.
  const trc = (p.color_transfer ?? '').toLowerCase();
  const prim = (p.color_primaries ?? '').toLowerCase();
  const base = { ...(cam.nome ? { camera: cam.nome } : {}), ...(trc && trc !== 'unknown' ? { gamma: trc } : {}), ...(prim && prim !== 'unknown' ? { gamut: prim } : {}) };
  if (Object.values(t).some((v) => /apple\s*log/i.test(v))) return row('applelog', { ...base, fonte: 'tag', confianca: 'certa' });
  if (trc === 'arib-std-b67') return row('hlg', { ...base, fonte: 'tag', confianca: 'certa' });
  if (trc === 'smpte2084') return desconhecida(cam.nome, 'PQ (HDR10/Dolby Vision perfil 5) fora da F1: sem conversão', base);
  if (/^(bt709|smpte170m|bt470bg|bt470m|bt601|bt1361|bt2020-10|bt2020-12)$/.test(trc)) {
    // O XAVC da Sony marca bt709 no stream também em S-Log: sem o XML, a tag não diz a curva.
    if (/sony/i.test(cam.make ?? '') || /^xavc/i.test(tag(t, 'major_brand') ?? '')) return desconhecida(cam.nome ?? 'Sony', 'Sony sem XML NonRealTimeMeta: a tag bt709 do stream não separa S-Log de Rec.709', base);
    return row('rec709', { ...base, fonte: 'tag', confianca: 'certa' });
  }

  // 3. Make/Model do container.
  const codec = (p.codec_name ?? '').toLowerCase();
  if (/^apple$/i.test(cam.make ?? '') && prim === 'bt2020' && (!trc || trc === 'unknown'))
    return row('applelog', { ...base, fonte: 'container', confianca: 'provavel', aviso: 'Apple Log deduzido (iPhone, Rec.2020 sem curva marcada); regra a confirmar com amostra real do iPhone' });

  // 4. Codec.
  if (/blackmagic/i.test(cam.make ?? '') && codec === 'prores')
    return row('bmd-film-gen5', { ...base, fonte: 'codec', confianca: 'provavel', aviso: 'ProRes da Blackmagic sem a curva no metadado: convertido como Film Gen5; confira o .sidecar ou o menu da câmera' });

  return desconhecida(cam.nome, 'sem metadado de curva no arquivo', base);
}

async function probeCapture(file: string): Promise<CaptureProbe | null> {
  const raw = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).catch(() => null);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw.toString()) as { format?: { tags?: Record<string, string> }; streams?: (Omit<CaptureProbe, 'tags'> & { codec_type?: string; tags?: Record<string, string>; disposition?: { attached_pic?: number } })[] };
    const v = j.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const tags: Record<string, string> = {};
    for (const [k, val] of Object.entries({ ...(j.format?.tags ?? {}), ...(v?.tags ?? {}) })) tags[k.toLowerCase()] = String(val);
    return { codec_name: v?.codec_name, codec_tag_string: v?.codec_tag_string, pix_fmt: v?.pix_fmt, color_range: v?.color_range, color_transfer: v?.color_transfer, color_primaries: v?.color_primaries, tags };
  } catch {
    return null;
  }
}

/** `.sidecar` da Blackmagic com o mesmo nome do clipe, ao lado. */
async function bmdSidecar(file: string): Promise<unknown> {
  const dir = path.dirname(file);
  const stem = path.basename(file, path.extname(file)).toLowerCase();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const side = names.find((n) => n.toLowerCase() === `${stem}.sidecar`);
  if (!side) return null;
  const txt = await fs.readFile(path.join(dir, side), 'utf8').catch(() => '');
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/** Faixa do arquivo: bruto de câmera yuvj (pc) guarda o código direto. */
const codeRangeOf = (p: CaptureProbe | null): SourceColor['codeRange'] => (/yuvj/.test(p?.pix_fmt ?? '') || p?.color_range === 'pc' ? 'full' : 'legal');

const cache = new Map<string, Promise<SourceColor>>();

/**
 * Perfil de captura de um arquivo (em cache por caminho, tamanho e data): sempre devolve um `SourceColor` com câmera,
 * curva, origem e confiança; sem sinal, `fonte`/`confianca` = 'desconhecida' (sem conversão, e dito assim).
 */
export async function detectCapture(file: string): Promise<SourceColor> {
  const st = await fs.stat(file).catch(() => null);
  const key = `${file}@${st?.size}@${st?.mtimeMs}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      if (!st) return { ...desconhecida(undefined, 'arquivo não encontrado'), codeRange: 'legal' as const, tabela: CAPTURE_TABLE_VERSION };
      const [xml, sidecar, probe] = await Promise.all([cameraXml(file), bmdSidecar(file), probeCapture(file)]);
      const d = classifyCapture({ ext: path.extname(file), probe, xml, sidecar });
      return { ...d, codeRange: codeRangeOf(probe), tabela: CAPTURE_TABLE_VERSION };
    })();
    cache.set(key, hit);
  }
  return hit;
}

/** A cor tem curva decidida (não é `desconhecida`). Projeto antigo sem `confianca` conta como decidida. */
export const knownCapture = (c: SourceColor | null | undefined): c is SourceColor => !!c && c.fonte !== 'desconhecida' && c.confianca !== 'desconhecida';
