/**
 * Tabela versionada do perfil de captura (BL-0175 F1): câmera + curva → conversão para Rec.709.
 *
 * O detector (`apps/server/src/capture-profile.ts`) acha a CURVA pelo metadado do arquivo e só aceita o que está aqui;
 * o resto sai `desconhecida` (nunca Rec.709 presumido). Linha nova = câmera nova suportada: suba `CAPTURE_TABLE_VERSION`.
 *
 * As conversões são as do core (`gradePixel`/`buildLut`), a mesma conta no preview (WebGL) e no export (FFmpeg), em
 * 16 bits: S-Log3 tem a conversão embutida LC-709 Type A (BL-0159, nenhuma LUT lida da pasta do Resolve); as outras
 * usam a curva publicada pelo fabricante + matriz do gamut → Rec.709 + tone map da casa (ponto de partida, ajustável).
 */
import { BUILTIN_INPUT, type InputTransform, type SourceColor } from './color.ts';

export const CAPTURE_TABLE_VERSION = '2026-11-03.1';

export type CurvaId = 'sony-slog3-sgamut3cine' | 'sony-rec709' | 'hlg' | 'applelog' | 'bmd-film-gen5' | 'rec709';

export interface CaptureRow {
  curva: CurvaId;
  /** Nome da curva para o editor. */
  nome: string;
  /** Câmeras conhecidas que gravam assim (texto). */
  cameras: string;
  /** Qual metadado identifica (documentação da regra). */
  sinal: string;
  input: InputTransform;
}

export const CAPTURE_TABLE: readonly CaptureRow[] = [
  { curva: 'sony-slog3-sgamut3cine', nome: 'S-Log3/S-Gamut3.Cine', cameras: 'Sony (ZV-E10, FX3, FX30, A7S III, A7 IV…)', sinal: 'XML NonRealTimeMeta: CaptureGammaEquation s-log3*', input: 'slog3' },
  { curva: 'sony-rec709', nome: 'Rec.709 (Sony, S-Cinetone/709)', cameras: 'Sony', sinal: 'XML NonRealTimeMeta: CaptureGammaEquation rec709/s-cinetone', input: 'rec709' },
  { curva: 'hlg', nome: 'HLG (BT.2100)', cameras: 'iPhone (vídeo HDR padrão), Android HDR, Sony HLG', sinal: 'stream: color_transfer=arib-std-b67; XML Sony com CaptureGammaEquation *hlg*', input: 'hlg' },
  { curva: 'applelog', nome: 'Apple Log/Rec.2020', cameras: 'iPhone 15/16/17 Pro', sinal: 'tag com "Apple Log"; ou make Apple + primaries bt2020 sem transfer (provável, confirmar em amostra real)', input: 'applelog' },
  { curva: 'bmd-film-gen5', nome: 'Blackmagic Film Gen5/Wide Gamut Gen5', cameras: 'Blackmagic (Pocket 4K/6K, Pyxis, Cinema Camera 6K)', sinal: '.sidecar ou com.blackmagic-design.camera.gamma "Blackmagic Design Film"', input: 'bmdfilm5' },
  { curva: 'rec709', nome: 'Rec.709 (SDR)', cameras: 'celular SDR (iPhone, Android), câmera em perfil padrão', sinal: 'stream: color_transfer bt709/smpte170m explícito (exceto Sony: o XAVC marca bt709 também em S-Log)', input: 'rec709' },
];

export const captureRow = (curva: string | undefined): CaptureRow | undefined => CAPTURE_TABLE.find((r) => r.curva === curva);

/** Como a curva vira Rec.709, para a nota do ingest, do render e da análise inicial. */
export function conversionOf(input: InputTransform, inputLut?: SourceColor['inputLut']): string {
  if (input === 'rec709') return 'nenhuma (já é Rec.709)';
  if (BUILTIN_INPUT[input]) return `embutida (${BUILTIN_INPUT[input]}, 16 bits)`;
  if (inputLut) return `LUT de entrada (${inputLut.nome})`;
  return 'da casa (curva publicada → linear, gamut → Rec.709, tone map da casa, 16 bits)';
}

const ORIGEM: Record<SourceColor['fonte'], string> = {
  xml: 'XML da câmera',
  sidecar: '.sidecar da câmera',
  tag: 'metadado do arquivo',
  container: 'marca/modelo do arquivo',
  codec: 'codec do arquivo',
  herdado: 'herdado do bruto',
  desconhecida: 'sem metadado',
};

/** "Câmera X, curva Y, conversão Z (origem, confiança)": uma linha por arquivo, para o editor e o revisor. */
export function captureLine(c: SourceColor): string {
  const camera = c.camera ?? (c.modelo ? c.modelo : 'não identificada');
  const desconhecida = c.fonte === 'desconhecida' || c.confianca === 'desconhecida';
  const row = captureRow(c.curva);
  const curva = desconhecida ? 'desconhecida' : (row?.nome ?? c.gamma ?? c.input);
  const conv = desconhecida ? 'nenhuma aplicada (curva desconhecida, não presumida Rec.709)' : conversionOf(c.input, c.inputLut);
  const origem = c.fonte === 'herdado' && c.de ? `herdado de ${c.de}` : ORIGEM[c.fonte];
  const conf = c.confianca && c.confianca !== 'certa' && !desconhecida ? `, ${c.confianca === 'provavel' ? 'provável' : c.confianca}` : '';
  return `Câmera ${camera}, curva ${curva}, conversão ${conv} (${origem}${conf})${c.aviso ? `. Aviso: ${c.aviso}` : ''}`;
}
