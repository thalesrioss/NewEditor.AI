import type { AppNotification, CaptionSettings, CerebroGraph, CerebroNote, ClientProfile, FormatoPeca, MediaAsset, Project, ProjectComment, ProjectStatus, ProjectTask, QcReport, StepId, Timeline, TimelineOp } from '@neweditor/core';

async function req<T>(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(body instanceof FormData || body === undefined ? {} : { 'content-type': 'application/json' }), ...(extraHeaders ?? {}) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `erro ${res.status}`);
  return data;
}

export const api = {
  health: () => req<{ ok: boolean; brain: 'local' | 'claude'; ready: boolean }>('GET', '/api/health'),
  projects: () => req<(Project & { pendentes?: number; estimativa?: number })[]>('GET', '/api/projects'),
  // Perfis de edição por cliente
  perfis: () => req<ClientProfile[]>('GET', '/api/perfis'),
  importPerfis: () => req<{ importados: string[]; atualizados: string[]; origem: string }>('POST', '/api/perfis/import'),
  createPerfil: (nome: string, baseId?: string) => req<ClientProfile>('POST', '/api/perfis', { nome, baseId }),
  patchPerfil: (id: string, patch: Partial<ClientProfile>) => req<ClientProfile>('PATCH', `/api/perfis/${id}`, patch),
  setHousePerfil: (id: string) => req<ClientProfile>('POST', `/api/perfis/${id}/padrao-casa`),
  /** Padrão editorial lido da edição de um projeto: prévia e gravação como perfil do cliente para um formato. */
  perfilDaEdicao: (id: string, q: { cliente?: string; formato?: FormatoPeca; nome?: string }) => req<ClientProfile>('GET', `/api/projects/${id}/perfil-da-edicao?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>)}`),
  salvarPerfilDaEdicao: (id: string, body: { cliente?: string; formato?: FormatoPeca; nome?: string; aplicar?: boolean }) => req<ClientProfile>('POST', `/api/projects/${id}/perfil-da-edicao`, body),
  ateOCorte: (id: string) => req<{ ajustados: number; curtos: string[] }>('POST', `/api/projects/${id}/ate-o-corte`),
  autoBroll: (id: string) => req<{ colocados: number; cobertura: number; filmes: string[]; motivo?: string }>('POST', `/api/projects/${id}/broll-auto`, {}),
  // Presets de legenda
  captionPresets: () => req<CaptionPreset[]>('GET', '/api/presets/legenda'),
  saveCaptionPreset: (nome: string, legenda: CaptionSettings) => req<CaptionPreset[]>('PUT', '/api/presets/legenda', { nome, legenda }),
  deleteCaptionPreset: (nome: string) => req<CaptionPreset[]>('DELETE', `/api/presets/legenda/${encodeURIComponent(nome)}`),
  // Motion Studio Brain
  motionStudio: (id: string) => req<StudioStatus>('GET', `/api/projects/${id}/motion-studio`),
  motionStudioOrdens: (id: string) => req<{ dir: string; cenas: number; obraAlvo?: string }>('POST', `/api/projects/${id}/motion-studio/ordens`),
  motionStudioImport: (id: string) => req<{ importados: number; pendentes: number }>('POST', `/api/projects/${id}/motion-studio/importar`),
  // Cérebro do Editor (grafo do vault)
  cerebroGrafo: (refresh = false) => req<CerebroGraph>('GET', `/api/cerebro/grafo${refresh ? '?refresh=1' : ''}`),
  cerebroNota: (vault: string, path: string) => req<CerebroNote>('GET', `/api/cerebro/nota?vault=${vault}&path=${encodeURIComponent(path)}`),
  // QC, estimativa, fila
  qc: (id: string) => req<QcReport>('POST', `/api/projects/${id}/qc`),
  reframeAuto: (id: string) => req<{ clips: number; arquivos: string[] }>('POST', `/api/projects/${id}/reframe-auto`),
  syncCam: (id: string, assetId: string) => req<{ offset: number; confianca: number }>('POST', `/api/projects/${id}/assets/${assetId}/sync-cam`),
  multicamAuto: (id: string) => req<{ trocas: number }>('POST', `/api/projects/${id}/multicam-auto`),
  musicAuto: (id: string) => req<{ track: string | null; bpmAlvo: number }>('POST', `/api/projects/${id}/music-auto`),
  autoFlashes: (id: string) => req<{ flashes: number }>('POST', `/api/projects/${id}/flashes-auto`),
  autoZooms: (id: string, max?: number) => req<{ zooms: number; monotonos: number }>('POST', `/api/projects/${id}/zooms-auto`, { max }),
  faces: (id: string) => req<{ disponivel: boolean; rosto: { chinY: number; eyesY: number; centerX: number; coverage: number; box: { x: number; y: number; w: number; h: number } } | null; legendaSegura?: { y: number; porque: string } }>('GET', `/api/projects/${id}/faces`),
  estimativa: (id: string) => req<{ steps: { step: StepId; seconds: number; amostras: number }[]; totalSeconds: number }>('GET', `/api/projects/${id}/estimativa`),
  fila: () => req<{ running: QueueJob | null; queue: QueueJob[] }>('GET', '/api/fila'),
  cancelJob: (jobId: string) => req<{ ok: boolean }>('DELETE', `/api/fila/${jobId}`),
  // Gestor de Projetos
  briefing: (texto: string) => req<ProjectTask>('POST', '/api/gestor/briefing', { texto }),
  /** CinePRO: a biblioteca do pack dentro do editor. */
  cinepro: (modo: CineproModo = 'som') => req<CineproResumo>('GET', `/api/cinepro?modo=${modo}`),
  cineproItens: (q: { modo?: CineproModo; pasta?: string; tipo?: string; busca?: string; offset?: number; limit?: number }) => req<{ total: number; itens: CineproItem[] }>('GET', `/api/cinepro/itens?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])))}`),
  cineproReindexar: () => req<{ total: number; builtAt: string }>('POST', '/api/cinepro/reindexar'),
  cineproUsar: (id: string, itemId: string, at: number) => req<{ assetId: string; trackId: string; role: string }>('POST', `/api/projects/${id}/cinepro/usar`, { itemId, at }),
  /** Uma operação da timeline fora do editor (ex.: formato ao criar o projeto). */
  op: (id: string, op: TimelineOp, note?: string) => req<Project>('POST', `/api/projects/${id}/op`, { op, note }),
  gestor: (texto: string, opts: { nome?: string; links?: string[]; profileId?: string; formato?: { width: number; height: number; fps?: number } } = {}) => req<{ projectId: string; briefing: ProjectTask; avisos: string[] }>('POST', '/api/gestor', { texto, ...opts }),
  // Cinéfilo
  cafeSearch: (q: string) => req<{ clips: CafeClip[] }>('GET', `/api/cinefilo/search?q=${encodeURIComponent(q)}`),
  cafeBeats: (id: string) => req<{ beats: BeatQuery[] }>('GET', `/api/projects/${id}/cinefilo/beats`),
  cafeUse: (id: string, clip: CafeClip) => req<{ assetId: string; file: string }>('POST', `/api/projects/${id}/cinefilo/use`, { clip }),
  // LLM local
  llm: () => req<LlmSettings & { baixado: boolean }>('GET', '/api/llm'),
  setLlm: (patch: Partial<LlmSettings>) => req<LlmSettings>('PATCH', '/api/llm', patch),
  benchmark: () => req<{ gabaritos: { projectId: string; name: string; label: string; savedAt: string; profileId?: string }[] }>('GET', '/api/benchmark'),
  createProject: (name: string, brief: string) => req<Project>('POST', '/api/projects', { name, brief }),
  updateProject: (id: string, patch: { name?: string; brief?: string; status?: ProjectStatus; client?: string; dueAt?: string; profileId?: string | null }) => req<Project>('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => req<{ ok: boolean; cancelados: number; lixeira: string }>('DELETE', `/api/projects/${id}`, undefined, { 'x-apagar': 'sim' }),
  setAssetRole: (id: string, assetId: string, role: 'fala' | 'broll') => req<MediaAsset>('PATCH', `/api/projects/${id}/assets/${assetId}`, { role }),
  importPath: (id: string, path: string) => req<{ queued: boolean }>('POST', `/api/projects/${id}/assets`, { path }),
  upload: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ queued: boolean }>('POST', `/api/projects/${id}/upload`, fd);
  },
  decupar: (id: string, assetId?: string) => req<{ queued: boolean }>('POST', `/api/projects/${id}/decupagem`, { assetId }),
  command: (id: string, text: string, playhead?: number) => req<{ queued: boolean }>('POST', `/api/projects/${id}/command`, { text, playhead }),
  undo: (id: string) => req<{ ok: boolean }>('POST', `/api/projects/${id}/undo`),
  music: () => req<MusicTrack[]>('GET', '/api/library/music'),
  musicAudioUrl: (path: string) => `/api/library/music/audio?path=${encodeURIComponent(path)}`,
  useMusic: (id: string, path: string) => req<{ queued: boolean }>('POST', `/api/projects/${id}/music`, { path }),
  colorAuto: (id: string, assetId: string) => req<{ why: string }>('POST', `/api/projects/${id}/assets/${assetId}/color-auto`),
  letteringAuto: (id: string, quantidade?: 'pouco' | 'medio' | 'muito') => req<{ queued: boolean }>('POST', `/api/projects/${id}/lettering-auto`, { quantidade }),
  letteringRef: (id: string, refId: string) => req<{ restyled: number }>('POST', `/api/projects/${id}/lettering-ref`, { refId }),
  importLettering: (path?: string) => req<ImportStatus>('POST', '/api/lettering/refs/import', { path }),
  importLetteringStatus: () => req<ImportStatus & { origem: string }>('GET', '/api/lettering/refs/import'),
  redo: (id: string) => req<{ ok: boolean }>('POST', `/api/projects/${id}/redo`),
  cutWords: (id: string, assetId: string, from: number, to: number) => req<{ ok: boolean }>('POST', `/api/projects/${id}/cut-words`, { assetId, from, to }),
  restoreWords: (id: string, assetId: string, from: number, to: number) => req<{ ok: boolean }>('POST', `/api/projects/${id}/restore-words`, { assetId, from, to }),
  render: (id: string) => req<{ queued: boolean }>('POST', `/api/projects/${id}/render`),
  entregaPresets: () => req<{ presets: { id: string; label: string; sufixo: string }[]; pasta: string }>('GET', '/api/entrega/presets'),
  entregar: (id: string, opts: { preset: string; srt: boolean; capa: boolean; capaEm?: number; entregar: boolean }) => req<{ queued: boolean }>('POST', `/api/projects/${id}/entregar`, opts),
  addComment: (id: string, c: { at: number; text: string; by?: 'editor' | 'cliente' }) => req<ProjectComment>('POST', `/api/projects/${id}/comments`, c),
  patchComment: (id: string, cid: string, patch: { text?: string; at?: number; status?: ProjectComment['status'] }) => req<ProjectComment>('PATCH', `/api/projects/${id}/comments/${cid}`, patch),
  removeComment: (id: string, cid: string) => req<{ ok: boolean }>('DELETE', `/api/projects/${id}/comments/${cid}`),
  alteracoes: (id: string) => req<{ queued: boolean }>('POST', `/api/projects/${id}/alteracoes`),
  versoesDiff: (id: string, a?: number, b?: number) => req<{ a: number; b: number | string; diff: { duracao: [number, number]; cortesNovos: number; cortesDesfeitos: number; overlaysNovos: string[]; overlaysRemovidos: string[]; zooms: number } }>('GET', `/api/projects/${id}/versoes/diff${a ? `?a=${a}${b ? `&b=${b}` : ''}` : ''}`),
  review: (id: string) => req<{ status: ProjectStatus; review: { decupadaEm?: string; aprovadaEm?: string }; doubts: ReviewDoubt[] }>('GET', `/api/projects/${id}/review`),
  resolveDoubt: (id: string, doubtId: string) => req<{ ok: boolean }>('POST', `/api/projects/${id}/review/resolve`, { doubtId }),
  swapTake: (id: string, doubtId: string) => req<{ ok: boolean }>('POST', `/api/projects/${id}/review/swap`, { doubtId }),
  approve: (id: string) => req<{ queued: boolean; pendentes: number }>('POST', `/api/projects/${id}/approve`),
  notifications: () => req<AppNotification[]>('GET', '/api/notifications'),
  readNotifications: (ids?: string[]) => req<{ ok: boolean }>('POST', '/api/notifications/read', { ids }),
  motionRefs: () => req<{ refs: MotionRef[]; categorias: string[]; familias: string[] }>('GET', '/api/motion/refs'),
  previewRef: (link: string) => req<LinkMeta>('POST', '/api/motion/refs/preview', { link }),
  createRef: (body: NewRef) => req<MotionRef>('POST', '/api/motion/refs', body),
  patchRef: (id: string, patch: Partial<Pick<MotionRef, 'obra' | 'categoria' | 'familias' | 'resumo' | 'fio' | 'mecanismo' | 'roubar' | 'serve' | 'evitar' | 'estilo' | 'accent'>>) => req<MotionRef>('PATCH', `/api/motion/refs/${id}`, patch),
  addRefFrame: (id: string, image: string, legenda?: string) => req<MotionRef>('POST', `/api/motion/refs/${id}/frames`, { image, legenda }),
  trashRef: (id: string) => req<{ ok: boolean }>('DELETE', `/api/motion/refs/${id}`),
  importRefs: () => req<{ importadas: number; existentes: number; origem: string }>('POST', '/api/motion/refs/import'),
  story: (id: string) => req<StoryResponse>('GET', `/api/projects/${id}/story`),
  motionsAuto: (id: string, refId?: string) => req<{ queued: boolean }>('POST', `/api/projects/${id}/motions-auto`, { refId }),
  useRef: (id: string, refId: string) => req<{ restyled: number }>('POST', `/api/projects/${id}/motion-ref`, { refId }),
};

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
  usos: { projectId: string; name: string; motions: number }[];
  uso: 'motion' | 'lettering';
  estilo?: string;
  accent?: string;
  preview?: string;
  sfx?: string[];
}

export interface ImportStatus {
  running: boolean;
  done: number;
  total: number;
  result?: { importadas: number; existentes: number };
  error?: string;
}

export interface LinkMeta {
  link: string;
  titulo: string;
  descricao: string;
  imagem?: string;
  autor?: string;
  categoria: string;
  bloqueado?: boolean;
}

export interface NewRef {
  link: string;
  obra?: string;
  categoria?: string;
  familias?: string[];
  resumo?: string;
  roubar?: string[];
  serve?: string;
  evitar?: string;
  capa?: string;
}

export interface StoryBeat {
  text: string;
  start: number;
}

export interface StoryResponse {
  reading: { tema: string[]; topicos: string[]; gancho?: StoryBeat; virada?: StoryBeat; tese?: StoryBeat; fechamento?: StoryBeat; ctaDesde?: number; frases: number };
  ref?: { id: string; obra: string; why: string; auto: boolean };
}

export const refUrl = (refId: string, file: string) => `/refs/${encodeURIComponent(refId)}/${file.split('/').map(encodeURIComponent).join('/')}`;

export interface TrackAnalysis {
  bpm: number;
  beatConf: number;
  energyDb: number;
  clima: 'calma' | 'media' | 'agitada';
  introEnd: number;
  startAt: number;
}

export interface MusicTrack {
  analise?: TrackAnalysis;
  name: string;
  path: string;
  duration: number;
  folder: string;
}

export const mediaUrl = (projectId: string, rel: string) => `/media/${projectId}/${rel}`;

/** Proxy que o preview toca: o de voz limpa quando a limpeza está ligada e já foi gerada nessa intensidade. */
export function proxyOf(a: MediaAsset, tl?: Timeline): string | undefined {
  const mix = tl?.voiceDenoise ?? 0;
  const chain = !!tl?.voiceChain;
  return (mix || chain) && a.clean && a.clean.mix === mix && !!a.clean.chain === chain && a.clean.proxy ? a.clean.proxy : a.proxy;
}

export interface ReviewDoubt {
  id: string;
  kind: 'tomada' | 'corte' | 'agente' | 'palavra' | 'nome';
  assetId: string;
  in: number;
  out: number;
  at: number | null;
  text: string;
  question: string;
  removalId?: string;
  wordAt?: number;
  suggestions?: string[];
  prioridade: 'alta' | 'baixa';
  swap?: { in: number; out: number; text: string };
}

export interface QueueJob {
  id: string;
  projectId: string;
  kind: string;
  label: string;
  priority: number;
  at: string;
  state: 'fila' | 'rodando';
}

export interface CafeClip {
  slug: string;
  link: string;
  filme: string;
  ano?: string;
  duracao?: number;
  transcript: string;
  poster: string;
  mp4: string;
  vtt?: string;
}

export interface BeatQuery {
  assetId: string;
  start: number;
  end: number;
  fala: string;
  queries: string[];
  motivo: string;
}

export interface LlmSettings {
  enabled: boolean;
  model: string;
  usos: { tomada: boolean; comando: boolean; palavraChave: boolean; briefing: boolean; broll: boolean };
}

export interface StudioStatus {
  disponivel: boolean;
  dir: string;
  exportadoEm?: string;
  cenas: { id: string; pasta: string; tlStart: number; tlEnd: number; frameIn: number; frames: number; fala: string; funcao: string; ideia: string; render?: string; novo?: boolean }[];
}

export interface CaptionPreset {
  nome: string;
  legenda: Partial<CaptionSettings>;
}

export type CineproTipo = 'sfx' | 'musica' | 'overlay' | 'transicao' | 'flare' | 'frame' | 'gif' | 'lowerthird' | 'lut' | 'preset' | 'outro';
export type CineproModo = 'som' | 'visual' | 'lut';
export interface CineproItem {
  id: string;
  nome: string;
  ext: string;
  kind: string;
  tipo: CineproTipo;
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
export interface CineproResumo {
  fonte: string;
  cdn: string;
  builtAt: string;
  modo: CineproModo;
  total: number;
  porTipo: Record<string, number>;
  arvore: CineproNode[];
  tipos: Record<CineproTipo, string>;
}
export const cineproThumbUrl = (id: string) => `/api/cinepro/thumb/${id}`;
export const cineproFileUrl = (id: string) => `/api/cinepro/arquivo/${id}`;
