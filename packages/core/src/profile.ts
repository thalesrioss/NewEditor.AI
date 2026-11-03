/**
 * Perfil de edição por cliente (ADR-007, I-1): o que o Cérebro do Editor sabe sobre como cada cliente é
 * editado, em forma de DADO que todas as etapas leem — decupagem, cor, legenda, lettering, motion, SFX,
 * trilha e QC. Compilado dos `PADRAO - *.md` do vault e revisado pelo Thales na tela de perfis.
 *
 * Cada campo guarda o nível de evidência de onde veio (como nos arquivos do vault): MEDIDO vale como regra;
 * HIPÓTESE não vira regra sem medir.
 */

import type { CaptionSettings } from './text.ts';
import type { ColorGrade } from './color.ts';
import type { MediaAsset, Timeline } from './types.ts';
import { clipDuration, FLASH_FRAMES, resolveOverlay, timelineDuration } from './timeline.ts';

export type Evidence = 'MEDIDO' | 'DERIVADO' | 'PREFERENCIA' | 'OFICIO' | 'HIPOTESE' | 'PADRAO';

/** Formato da peça a que um padrão editorial se aplica (um cliente pode ter um padrão por formato). */
export type FormatoPeca = 'reels' | 'shorts' | 'tiktok' | 'youtube' | 'stories' | 'outro';
export const FORMATOS_PECA: { id: FormatoPeca; label: string; width: number; height: number }[] = [
  { id: 'reels', label: 'Reels', width: 1080, height: 1920 },
  { id: 'shorts', label: 'Shorts', width: 1080, height: 1920 },
  { id: 'tiktok', label: 'TikTok', width: 1080, height: 1920 },
  { id: 'stories', label: 'Stories', width: 1080, height: 1920 },
  { id: 'youtube', label: 'YouTube', width: 1920, height: 1080 },
  { id: 'outro', label: 'Outro', width: 1080, height: 1920 },
];
export const formatoLabel = (f?: FormatoPeca): string => FORMATOS_PECA.find((x) => x.id === f)?.label ?? '';
/** Presets de formato em pixels (CapCut: proporção + tamanho livre). `ratio` é só rótulo. */
export const FORMAT_PRESETS: { id: string; label: string; ratio: string; width: number; height: number; formato: FormatoPeca }[] = [
  { id: 'reels', label: 'Reels / Shorts / TikTok', ratio: '9:16', width: 1080, height: 1920, formato: 'reels' },
  { id: 'retrato', label: 'Feed retrato', ratio: '4:5', width: 1080, height: 1350, formato: 'outro' },
  { id: 'quadrado', label: 'Quadrado', ratio: '1:1', width: 1080, height: 1080, formato: 'outro' },
  { id: 'youtube', label: 'YouTube HD', ratio: '16:9', width: 1920, height: 1080, formato: 'youtube' },
  { id: 'youtube4k', label: 'YouTube 4K', ratio: '16:9', width: 3840, height: 2160, formato: 'youtube' },
  { id: 'cinema', label: 'Cinema', ratio: '21:9', width: 2560, height: 1080, formato: 'youtube' },
];
/** O preset que bate com o tamanho (ou undefined = personalizado). */
export const formatPresetOf = (width: number, height: number) => FORMAT_PRESETS.find((p) => p.width === width && p.height === height);
/** Tamanho em pixels para um formato da tarefa. */
export const formatSize = (f: FormatoPeca): { width: number; height: number } => FORMATOS_PECA.find((x) => x.id === f) ?? { width: 1080, height: 1920 };
/** Rótulo de proporção (16:9, 9:16…) para qualquer tamanho. */
export function ratioLabel(w: number, h: number): string {
  const r = w / h;
  const known: [number, string][] = [[16 / 9, '16:9'], [9 / 16, '9:16'], [1, '1:1'], [4 / 5, '4:5'], [5 / 4, '5:4'], [4 / 3, '4:3'], [3 / 4, '3:4'], [21 / 9, '21:9'], [2 / 3, '2:3'], [3 / 2, '3:2']];
  const hit = known.find(([k]) => Math.abs(k - r) < 0.02);
  if (hit) return hit[1];
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}
/** Chute do formato pela proporção da timeline. */
export const guessFormato = (width: number, height: number): FormatoPeca => (width > height ? 'youtube' : 'reels');

/** Id reservado: "Personalizado" = o padrão é a própria edição deste projeto (lida da timeline, ao vivo). */
export const PERSONALIZADO_ID = 'personalizado';

export interface ClientProfile {
  id: string;
  nome: string;
  /** De onde foi compilado (caminho do .md) e quando. */
  fonte?: string;
  atualizadoEm: string;
  /** Padrão APROVADO pelo Thales como referência (só o estilo dele, por enquanto). Os outros são testes. */
  validado?: boolean;
  /** Este perfil é o padrão da casa: vale para todo projeto sem perfil escolhido. */
  padraoCasa?: boolean;
  /** Para perfis de teste: por que não é referência. */
  nota?: string;
  /** Cliente a que o padrão pertence (um cliente pode ter um padrão editorial por formato). */
  cliente?: string;
  formatoPeca?: FormatoPeca;
  /** Padrão editorial lido de uma edição feita no Editor Brain ("tornar esta edição o padrão"). */
  origem?: { projectId: string; projectName: string; at: string };
  formato: { width: number; height: number; fps: number };
  /** Duração-alvo da peça, em segundos. */
  peca: { duracaoMin: number; duracaoMax: number };
  corte: {
    /** Folga antes/depois de cada trecho mantido (s) e pausa máxima que fica entre frases (s). */
    headPad: number;
    tailPad: number;
    maxPause: number;
    /** Mediana de duração dos clipes de fala (s) — referência de ritmo. */
    clipeMedianaS?: number;
    transicao: 'seca' | 'smooth-cut';
  };
  zoom: { min: number; max: number; porMinuto: number };
  lettering: {
    maxLinhas: number;
    /** Onde: no lugar da legenda ou logo abaixo do queixo (precisa do rosto). */
    posicao: 'legenda' | 'abaixo-do-queixo';
    estiloId?: string;
    caixa: 'baixa' | 'alta' | 'livre';
    /** Texto sempre literal da fala (não inventa frase). */
    literal: boolean;
    porMinuto: number;
    /** O último lettering da peça é uma citação entre aspas, centralizada e maior. */
    ultimoCitacao: boolean;
    /** Teto de SFX de lettering por 3 s. */
    sfxTetoPor3s: number;
    /** Altura e alinhamento medidos numa edição (0–1; sem valor, usa a altura da legenda). */
    y?: number;
    align?: 'left' | 'center' | 'right';
  };
  motion: {
    /** Nada entra seco: deslocamento + ease-out + um pouco de escala, com SFX. */
    nuncaSeco: boolean;
    maxPorModelo: number;
    /** Identidade (tipo, cores, campo) em texto livre, lida do padrão. */
    identidade?: string;
    /** De onde vêm os motions de cena: 'studio' (ordens para o Motion Studio Brain — padrão) ou 'cartoes' (templates do produto). */
    fonte?: 'studio' | 'cartoes';
  };
  flash: { usar: boolean; frames: number; onde: string[]; sfx?: string };
  sfx: { picoNoEvento: boolean; biblioteca?: import('./sfx.ts').SfxBank };
  legenda: {
    palavrasMin: number;
    palavrasMax: number;
    /** Altura do centro (0 topo – 1 base). */
    y: number;
    conferirNumeros: boolean;
    estilo?: string;
    /** A legenda completa (fonte, cor, tarja, palavras por bloco…) como ficou numa edição: o agente aplica igual. */
    ajustes?: CaptionSettings;
  };
  trilha: { lufsSobVoz: number; fadeIn: number; fadeOut: number; ducking: boolean; gainDb?: number };
  cor: { input?: string; lut?: string; grade?: ColorGrade; padrao?: PadraoCor };
  broll: {
    maxRepeticao: number;
    /** Cobertura cobre a frase inteira, do corte ao fim dela. */
    coberturaFraseInteira: boolean;
    /** Tira esse tanto (s) do começo da fala que volta depois de um insert. */
    voltaSemAr: number;
    minCoberturaS: number;
  };
  /** Regras em texto que o compilador não estruturou (continuam valendo para quem lê). */
  notas: string[];
  /**
   * Glossário do cliente (BL-0081): nomes e marcas com a grafia certa. Entram no prompt da transcrição e não viram
   * dúvida de grafia na revisão. O mais recente primeiro, no máximo GLOSSARIO_MAX, sem repetir (ignorando caixa).
   */
  glossario?: string[];
  evidencia: Partial<Record<string, Evidence>>;
}

/**
 * Padrão de cor do cliente (BL-0161): a grade que todo projeto novo do cliente recebe nos clipes da fala, como grade de
 * clipe (por cima da conversão LOG do arquivo), e até PADRAO_COR_STILLS_MAX stills de referência, guardados na pasta do
 * perfil (`stills` são os nomes dos arquivos lá).
 */
export interface PadraoCor {
  grade: ColorGrade;
  stills: string[];
  salvoEm: string;
  /** Projeto de onde a grade foi salva. */
  origem?: { projectId: string; projectName: string };
}
export const PADRAO_COR_STILLS_MAX = 3;

/**
 * Clipes da faixa principal que recebem o padrão de cor: os de arquivo de fala ainda sem grade de clipe e, com
 * `perfilId`, os que herdaram o padrão de OUTRO perfil (o projeto trocou de cliente). Grade posta à mão não entra.
 */
export function clipesParaPadraoCor(tl: Timeline, assets: Pick<MediaAsset, 'id' | 'role'>[], perfilId?: string): string[] {
  const fala = new Set(assets.filter((a) => a.role === 'fala').map((a) => a.id));
  return tl.main.filter((c) => fala.has(c.assetId) && (!c.grade || (perfilId !== undefined && !!c.gradeHerdada && c.gradeHerdada !== perfilId))).map((c) => c.id);
}

/** Clipes com grade herdada de um perfil que não é `perfilId` (para tirar quando o perfil novo não tem padrão). */
export function clipesHerdadosDeOutro(tl: Timeline, perfilId: string | undefined): string[] {
  return tl.main.filter((c) => c.gradeHerdada && c.gradeHerdada !== perfilId).map((c) => c.id);
}

export const DEFAULT_PROFILE: Omit<ClientProfile, 'id' | 'nome' | 'atualizadoEm'> = {
  formato: { width: 1080, height: 1920, fps: 30 },
  peca: { duracaoMin: 30, duracaoMax: 90 },
  corte: { headPad: 0.06, tailPad: 0.1, maxPause: 0.3, transicao: 'seca' },
  zoom: { min: 1.06, max: 1.14, porMinuto: 3 },
  lettering: { maxLinhas: 2, posicao: 'legenda', caixa: 'livre', literal: true, porMinuto: 5, ultimoCitacao: false, sfxTetoPor3s: 2 },
  motion: { nuncaSeco: true, maxPorModelo: 2 },
  flash: { usar: false, frames: 2, onde: ['entrada-zoom'] },
  sfx: { picoNoEvento: true, biblioteca: 'cinepro' },
  legenda: { palavrasMin: 1, palavrasMax: 3, y: 0.72, conferirNumeros: true },
  trilha: { lufsSobVoz: -27, fadeIn: 0, fadeOut: 2.5, ducking: true },
  cor: {},
  broll: { maxRepeticao: 2, coberturaFraseInteira: true, voltaSemAr: 0.4, minCoberturaS: 2 },
  notas: [],
  evidencia: {},
};

/** Perfil completo a partir de um parcial (campos ausentes vêm do padrão da casa). */
export function fillProfile(p: Partial<ClientProfile> & Pick<ClientProfile, 'id' | 'nome'>): ClientProfile {
  const d = DEFAULT_PROFILE;
  return {
    ...d,
    ...p,
    atualizadoEm: p.atualizadoEm ?? new Date().toISOString(),
    formato: { ...d.formato, ...p.formato },
    peca: { ...d.peca, ...p.peca },
    corte: { ...d.corte, ...p.corte },
    zoom: { ...d.zoom, ...p.zoom },
    lettering: { ...d.lettering, ...p.lettering },
    motion: { ...d.motion, ...p.motion },
    flash: { ...d.flash, ...p.flash },
    sfx: { ...d.sfx, ...p.sfx },
    legenda: { ...d.legenda, ...p.legenda },
    trilha: { ...d.trilha, ...p.trilha },
    cor: { ...d.cor, ...p.cor },
    broll: { ...d.broll, ...p.broll },
    notas: p.notas ?? [],
    ...(p.glossario ? { glossario: normGlossario(p.glossario) } : {}),
    evidencia: { ...(p.evidencia ?? {}) },
  };
}

export const GLOSSARIO_MAX = 30;

/** Chave de comparação do glossário: sem caixa e sem acento. */
export const glossarioKey = (t: string): string => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Glossário limpo: termos aparados, sem vazio, sem repetir (ignorando caixa e acento; fica a 1ª), no máximo 30. */
export function normGlossario(termos: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of termos ?? []) {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
    const k = glossarioKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= GLOSSARIO_MAX) break;
  }
  return out;
}

/** Acrescenta um termo no topo (o mais recente primeiro); se já existe, sobe para o topo com a grafia nova. */
export const addGlossario = (termos: readonly string[] | undefined, termo: string): string[] => normGlossario([termo, ...(termos ?? []).filter((t) => glossarioKey(t) !== glossarioKey(termo))]);

/**
 * Palavras do glossário (termos de várias palavras contam palavra a palavra), na chave de comparação. Pedaços com
 * menos de 3 letras ("do" de "Banco do Brasil") ficam de fora para não calar dúvida em qualquer contexto.
 */
export function glossarioWords(termos: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of termos ?? []) for (const w of t.split(/[\s\-–—/]+/)) {
    const k = glossarioKey(w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
    if (k.length >= 3) out.add(k);
  }
  return out;
}

/**
 * Argumentos extras do ASR (`services/asr/transcribe.py --glossario`): os termos do glossário, que o script junta ao
 * `initial_prompt`. Glossário vazio = nenhum argumento (a transcrição sai igual à de antes).
 */
export function asrGlossarioArgs(termos: readonly string[] | undefined): string[] {
  const g = normGlossario(termos);
  return g.length ? ['--glossario', g.join(', ')] : [];
}

export const HOUSE_PROFILE: ClientProfile = fillProfile({ id: 'casa', nome: 'Padrão da casa (NewContent)', atualizadoEm: '2026-10-10T00:00:00.000Z' });

/**
 * Nome do perfil como o editor vê em todo lugar (BL-0023): seletores do "Novo projeto", do editor e da gaveta,
 * "Valendo agora" e o QC. O perfil que é o padrão da casa diz que é o da casa.
 */
export function profileLabel(p: ClientProfile): string {
  if (p.id === PERSONALIZADO_ID) return p.nome;
  const base = `${p.nome}${p.formatoPeca && !p.nome.includes(formatoLabel(p.formatoPeca)) ? ` · ${formatoLabel(p.formatoPeca)}` : ''}${p.validado === false ? ' (teste)' : ''}`;
  return (p.padraoCasa || p.id === HOUSE_PROFILE.id) && !p.nome.startsWith('Padrão da casa') ? `Padrão da casa · ${base}` : base;
}

/** O padrão da casa numa lista vinda de `/api/perfis` (o marcado `padraoCasa`, senão o genérico). */
export const houseOf = (perfis: ClientProfile[]): ClientProfile | undefined => perfis.find((p) => p.padraoCasa) ?? perfis.find((p) => p.id === HOUSE_PROFILE.id);

/**
 * Opções do seletor de perfil, iguais no "Novo projeto", no editor e na gaveta: o padrão da casa uma vez só e
 * primeiro, os outros perfis, e "Personalizado" no fim (com `personalizado`).
 */
export function profileOptions(perfis: ClientProfile[], opts: { personalizado?: boolean } = {}): { value: string; label: string }[] {
  const house = houseOf(perfis) ?? HOUSE_PROFILE;
  const outros = perfis.filter((p) => p.id !== house.id && p.id !== HOUSE_PROFILE.id && p.id !== PERSONALIZADO_ID);
  return [house, ...outros].map((p) => ({ value: p.id, label: profileLabel(p) })).concat(opts.personalizado ? [{ value: PERSONALIZADO_ID, label: 'Personalizado (esta edição)' }] : []);
}

/** Valor do seletor para o perfil gravado no projeto: sem perfil (projeto antigo) ou perfil que sumiu = o padrão da casa. */
export function profileValue(perfis: ClientProfile[], profileId: string | undefined): string {
  if (profileId === PERSONALIZADO_ID || (profileId && perfis.some((p) => p.id === profileId && p.id !== HOUSE_PROFILE.id))) return profileId;
  return (houseOf(perfis) ?? HOUSE_PROFILE).id;
}

const num = (s: string) => Number(s.replace(',', '.'));

/**
 * Lê um `PADRAO - *.md` do Cérebro do Editor e extrai o que dá para medir por padrão de texto. O que não
 * dá, vai para `notas` (cada bullet marcado MEDIDO/DERIVADO/PREFERÊNCIA). O Thales revisa o resultado.
 */
export function compileProfileMarkdown(id: string, nome: string, md: string, fonte?: string): ClientProfile {
  const p: Partial<ClientProfile> = { id, nome, fonte, evidencia: {} };
  const ev = (k: string, e: Evidence) => ((p.evidencia ??= {})[k] = e);
  const text = md.replace(/ /g, ' ');
  const lower = text.toLowerCase();

  // Formato: "1080×1920 · 29,97" / "1920×1080 · 29,97" / "3840×2160 @ 24,000"
  const fmt = /(\d{3,4})\s*[×x]\s*(\d{3,4})\s*(?:·|@|,)?\s*(\d{2}(?:[.,]\d+)?)/.exec(text);
  if (fmt) {
    p.formato = { width: +fmt[1]!, height: +fmt[2]!, fps: num(fmt[3]!) };
    ev('formato', 'MEDIDO');
  }
  // Duração da peça: "Peça de 58 a 67 s", "Duração alvo: 25–45 s por peça", "5m16"
  const dur = /(?:pe[çc]a (?:de|entre)|dura[çc][ãa]o(?:-| )alvo:?)\s*(\d{2,3})\s*(?:a|–|-|até)\s*(\d{2,3})\s*s/i.exec(text);
  if (dur) {
    p.peca = { duracaoMin: +dur[1]!, duracaoMax: +dur[2]! };
    ev('peca', 'MEDIDO');
  }
  // Zoom: "Cut zoom entre 1,09 e 1,20", "2–3 clipes por peça a 1,12–1,46"
  const zoom = /(?:cut zoom|zoom)[\s\S]{0,120}?(1[.,]\d{2})\s*(?:e|–|-|a)\s*(1[.,]\d{2})/i.exec(text);
  if (zoom) {
    const zmin = num(zoom[1]!);
    const zmax = num(zoom[2]!);
    const per = /(\d)\s*(?:a|–|-)\s*(\d)\s*(?:clipes )?por pe[çc]a/i.exec(text);
    const dMid = p.peca ? (p.peca.duracaoMin + p.peca.duracaoMax) / 2 : 45;
    p.zoom = { min: Math.min(zmin, zmax), max: Math.max(zmin, zmax), porMinuto: per ? Math.round((((+per[1]! + +per[2]!) / 2) * 60) / dMid * 10) / 10 : DEFAULT_PROFILE.zoom.porMinuto };
    ev('zoom', 'MEDIDO');
  }
  // Mediana do clipe de fala: "mediana ~3 s", "Mediana 61 f (2,54 s)"
  const med = /mediana[^\n]{0,30}?(\d+(?:[.,]\d+)?)\s*s/i.exec(text);
  if (med) {
    p.corte = { ...DEFAULT_PROFILE.corte, clipeMedianaS: num(med[1]!) };
    ev('corte.clipeMedianaS', 'MEDIDO');
  }
  if (/smooth cut/i.test(text)) p.corte = { ...(p.corte ?? DEFAULT_PROFILE.corte), transicao: 'smooth-cut' };
  // Lettering
  const lt: Partial<ClientProfile['lettering']> = {};
  const lines = /no m[áa]ximo (\d) linhas/i.exec(text);
  if (lines) (lt.maxLinhas = +lines[1]!), ev('lettering.maxLinhas', 'MEDIDO');
  if (/abaixo do queixo/i.test(text)) (lt.posicao = 'abaixo-do-queixo'), ev('lettering.posicao', 'MEDIDO');
  if (/caixa baixa/i.test(text)) lt.caixa = 'baixa';
  else if (/caixa alta/i.test(text)) lt.caixa = 'alta';
  if (/trecho literal da fala/i.test(text)) (lt.literal = true), ev('lettering.literal', 'MEDIDO');
  if (/[úu]ltimo lettering[^\n]*cita[çc][ãa]o/i.test(text)) (lt.ultimoCitacao = true), ev('lettering.ultimoCitacao', 'MEDIDO');
  const teto = /teto de ~?(\d) sfx por 3 s/i.exec(text);
  if (teto) (lt.sfxTetoPor3s = +teto[1]!), ev('lettering.sfxTetoPor3s', 'HIPOTESE');
  if (Object.keys(lt).length) p.lettering = { ...DEFAULT_PROFILE.lettering, ...lt };
  // Motion
  const mo: Partial<ClientProfile['motion']> = {};
  if (/nada entra seco/i.test(text)) (mo.nuncaSeco = true), ev('motion.nuncaSeco', 'DERIVADO');
  const ident = /##\s*\d+\.\s*IDENTIDADE[^\n]*\n([\s\S]*?)(?=\n## )/i.exec(text);
  if (ident) mo.identidade = ident[1]!.trim().slice(0, 1500);
  if (Object.keys(mo).length) p.motion = { ...DEFAULT_PROFILE.motion, ...mo };
  // Flash
  const flash = /(?:adjustment clip|flash)[^\n]{0,60}?\bde (\d) f(?:rames)?\b/i.exec(text);
  if (flash || /## \d+\. Flash/i.test(text)) {
    const onde: string[] = [];
    if (/entrada de clipe com zoom|entradas de clipe com zoom|entrada de clipe com zoom/i.test(text)) onde.push('entrada-zoom');
    if (/volta do insert/i.test(text)) onde.push('volta-insert');
    if (/tela dividida/i.test(text)) onde.push('split');
    if (/lettering/i.test(text) && /flash[^\n]*lettering|lettering[^\n]*flash/i.test(text)) onde.push('bloco-lettering');
    const sfx = /(Camera Shutter[^`\n,*(]*|Canon EOS[^`\n,*(]*)/i.exec(text);
    p.flash = { usar: true, frames: flash ? +flash[1]! : 2, onde: onde.length ? onde : ['entrada-zoom'], sfx: sfx?.[1]?.trim() };
    ev('flash', 'MEDIDO');
  }
  if (/pico (cai|no) (no )?(flash|frame do evento)/i.test(text) || /come[çc]ando 4 f antes/i.test(text)) p.sfx = { picoNoEvento: true };
  // Legenda: "1–3 palavras, 4–39 f, y ≈ 0,47"
  const leg = /(\d)\s*[–-]\s*(\d)\s*palavras[^\n]*?y\s*≈?\s*(0[.,]\d+)/i.exec(text);
  if (leg) {
    p.legenda = { ...DEFAULT_PROFILE.legenda, palavrasMin: +leg[1]!, palavrasMax: +leg[2]!, y: num(leg[3]!) };
    ev('legenda', 'MEDIDO');
  }
  if (/legenda autom[áa]tica pode inventar dado/i.test(text)) p.legenda = { ...(p.legenda ?? DEFAULT_PROFILE.legenda), conferirNumeros: true };
  // Trilha: "≈ −27 LUFS sob voz", "sem fade de entrada"
  const lufs = /[−-]\s?(\d{2})\s*LUFS\s*sob voz/i.exec(text);
  if (lufs) {
    p.trilha = { ...DEFAULT_PROFILE.trilha, lufsSobVoz: -+lufs[1]!, fadeIn: /sem fade de entrada/i.test(text) ? 0 : DEFAULT_PROFILE.trilha.fadeIn };
    ev('trilha.lufsSobVoz', 'MEDIDO');
  }
  // Cor: LUT
  const lut = /([A-Z_]+(?:_[A-Z]+)*\.cube)/.exec(text);
  if (lut) {
    p.cor = { lut: lut[1]!.replace(/\.cube$/, '') };
    ev('cor.lut', 'MEDIDO');
  }
  // B-roll
  const br: Partial<ClientProfile['broll']> = {};
  const rep = /(?:mesmo b-roll[^\n]*?|repeti[çc][ãa]o[^\n]*?)(\d)\s*[×x]/i.exec(lower);
  if (rep) br.maxRepeticao = +rep[1]!;
  if (/cobertura b = a frase|cobertura[^\n]*frase inteira/i.test(text)) (br.coberturaFraseInteira = true), ev('broll.coberturaFraseInteira', 'DERIVADO');
  const ar = /tirou (\d+)[–-](\d+) f \((0[.,]\d)[–-](0[.,]\d) s\)/i.exec(text);
  if (ar) (br.voltaSemAr = (num(ar[3]!) + num(ar[4]!)) / 2), ev('broll.voltaSemAr', 'DERIVADO');
  if (Object.keys(br).length) p.broll = { ...DEFAULT_PROFILE.broll, ...br };

  // Notas: bullets com nível de evidência explícito (ou negrito de regra), sem as tabelas.
  const notas: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!/^[-•]\s/.test(line) || line.startsWith('|')) continue;
    if (/MEDIDO|DERIVADO|PREFER[ÊE]NCIA|\*\*[^*]{6,}\*\*/.test(line)) notas.push(line.replace(/^[-•]\s*/, '').slice(0, 400));
    if (notas.length >= 80) break;
  }
  p.notas = notas;
  return fillProfile(p as Partial<ClientProfile> & Pick<ClientProfile, 'id' | 'nome'>);
}

// ---------------------------------------------------------------------------
// Padrão editorial lido de uma edição (Editor Brain → perfil)
// ---------------------------------------------------------------------------

const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
function mode<T extends string | number>(xs: (T | undefined)[]): T | undefined {
  const n = new Map<T, number>();
  for (const x of xs) if (x !== undefined) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Mede a edição de um projeto e devolve um perfil: zoom, ritmo, lettering, motion, flash, legenda (com os
 * ajustes inteiros), trilha, cor e B-roll — tudo marcado MEDIDO. É o que "Personalizado" usa ao vivo e o que
 * "tornar esta edição o padrão editorial do cliente" grava.
 */
export function profileFromTimeline(tl: Timeline, base: ClientProfile, info: { id: string; nome: string; cliente?: string; formatoPeca?: FormatoPeca; origem?: ClientProfile['origem'] }): ClientProfile {
  const total = timelineDuration(tl);
  const minutes = Math.max(total, 1) / 60;
  const ev: Partial<Record<string, Evidence>> = {};
  const M = (k: string) => (ev[k] = 'MEDIDO');

  const durs = tl.main.map(clipDuration).sort((a, b) => a - b);
  const median = durs.length ? durs[Math.floor(durs.length / 2)]! : undefined;
  const zooms = tl.main.flatMap((c) => (c.zoom && c.zoom > 1 ? [c.zoom] : []));
  const placed = tl.overlays.flatMap((o) => {
    const pos = resolveOverlay(tl, o);
    return pos ? [{ o, ...pos }] : [];
  });
  const letterings = placed.filter((x) => x.o.role === 'lettering');
  const motions = placed.filter((x) => x.o.role === 'motion');
  const brolls = placed.filter((x) => x.o.role === 'broll');
  const music = placed.find((x) => x.o.role === 'music');
  const caps = tl.captions;
  const grade = tl.main[0] ? tl.grades?.[tl.main[0].assetId] : undefined;

  // O padrão de cor da base (BL-0161) é do cliente da base: não passa para outro perfil (os stills estão na pasta dela).
  const { padrao: _padraoDaBase, ...corBase } = base.cor;
  const p: Partial<ClientProfile> = { ...base, cor: corBase, id: info.id, nome: info.nome, cliente: info.cliente, formatoPeca: info.formatoPeca, origem: info.origem, fonte: undefined, padraoCasa: false, validado: true, nota: undefined };
  p.formato = { width: tl.width, height: tl.height, fps: tl.fps };
  M('formato');
  if (total > 5) {
    p.peca = { duracaoMin: Math.round(total * 0.85), duracaoMax: Math.round(total * 1.15) };
    M('peca');
  }
  if (median !== undefined) {
    p.corte = { ...base.corte, clipeMedianaS: r2(median) };
    M('corte.clipeMedianaS');
  }
  p.zoom = zooms.length ? { min: r2(Math.min(...zooms)), max: r2(Math.max(...zooms)), porMinuto: r1(zooms.length / minutes) } : { ...base.zoom, porMinuto: 0 };
  M('zoom');
  const specs = letterings.flatMap((x) => (x.o.source.type === 'lettering' ? [x.o.source.lettering] : []));
  const ly = mode(specs.map((s) => (s.y === undefined ? undefined : r2(s.y))));
  p.lettering = {
    ...base.lettering,
    porMinuto: r1(letterings.length / minutes),
    estiloId: mode(specs.map((s) => s.estilo)) ?? base.lettering.estiloId,
    y: ly,
    align: mode(specs.map((s) => s.align)),
    posicao: ly !== undefined && caps && ly < caps.position - 0.08 ? 'abaixo-do-queixo' : 'legenda',
    maxLinhas: specs.length ? Math.max(1, ...specs.map((s) => new Set(s.words.map((w) => w.line)).size)) : base.lettering.maxLinhas,
  };
  M('lettering.porMinuto');
  if (specs.length) M('lettering.posicao');
  p.motion = { ...base.motion, fonte: motions.some((x) => x.o.source.type === 'media') ? 'studio' : motions.some((x) => x.o.source.type === 'motion') ? 'cartoes' : base.motion.fonte };
  if (motions.length) M('motion.fonte');
  p.flash = { ...base.flash, usar: tl.main.some((c) => c.flash), frames: FLASH_FRAMES, onde: ['entrada-zoom'] };
  M('flash');
  if (caps) {
    p.legenda = { ...base.legenda, palavrasMin: 1, palavrasMax: caps.maxWords ?? (caps.style === 'frase' ? 6 : 2), y: r2(caps.position), estilo: caps.style, ajustes: { ...caps } };
    M('legenda');
  }
  if (music?.o.mix) {
    const m = music.o.mix;
    p.trilha = { ...base.trilha, gainDb: m.gainDb, fadeIn: r1(m.fadeIn), fadeOut: r1(m.fadeOut), ducking: m.duck, lufsSobVoz: Math.round(m.gainDb - 11) };
    M('trilha.lufsSobVoz');
  }
  if (grade) {
    p.cor = { ...corBase, input: grade.input, grade: { ...grade } };
    M('cor.input');
  }
  if (brolls.length) {
    const uses = new Map<string, number>();
    for (const x of brolls) if (x.o.source.type === 'media') uses.set(x.o.source.assetId, (uses.get(x.o.source.assetId) ?? 0) + 1);
    p.broll = { ...base.broll, maxRepeticao: Math.max(base.broll.maxRepeticao, ...uses.values()), minCoberturaS: r1(Math.min(...brolls.map((x) => x.end - x.start))) };
    M('broll.minCoberturaS');
  }
  const quando = new Date(info.origem?.at ?? Date.now()).toLocaleDateString('pt-BR');
  p.notas = [
    `Padrão editorial lido da edição "${info.origem?.projectName ?? 'este projeto'}" em ${quando}: ${tl.main.length} clipes, ${zooms.length} zooms, ${letterings.length} letterings, ${motions.length} motions, ${brolls.length} B-rolls, ${caps ? `legenda ${caps.style}` : 'sem legenda'}, ${music ? 'com trilha' : 'sem trilha'}.`,
    ...base.notas.filter((n) => !n.startsWith('Padrão editorial lido da edição')),
  ];
  p.evidencia = ev;
  return fillProfile(p as Partial<ClientProfile> & Pick<ClientProfile, 'id' | 'nome'>);
}
