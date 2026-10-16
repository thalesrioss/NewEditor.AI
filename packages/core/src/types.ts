/**
 * Modelo de dados do NewEditor.AI.
 *
 * A timeline é um documento JSON. Agente e humano editam o MESMO objeto, sempre por
 * operações (`TimelineOp`). O servidor aplica a operação, incrementa a versão e transmite
 * para todos os clientes — é isso que faz o Editor Brain mostrar o agente trabalhando ao vivo.
 *
 * Tempo é sempre em segundos (float). Frames só existem na hora de renderizar.
 */

export type Seconds = number;
export type Actor = 'agent' | 'human' | 'system';

export interface MediaAsset {
  id: string;
  name: string;
  /** Caminho absoluto do arquivo original (nunca é alterado). */
  path: string;
  kind: 'video' | 'audio' | 'image';
  duration: Seconds;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  /** 'fala' = A-roll (transcrito, vai para a trilha principal); 'broll' = biblioteca de inserts; 'cam' = 2ª câmera da fala. */
  role?: 'fala' | 'broll' | 'cam' | 'motion';
  /** Vídeo com canal alfa (render do Motion Studio, ProRes 4444): o proxy sai em WebM VP9 com alfa. */
  alpha?: boolean;
  /** 2ª câmera: tempo nesta gravação = tempo na fala + syncOffset (alinhado pelo áudio). */
  syncOffset?: Seconds;
  /** Miniaturas para a filmstrip da timeline: grade de quadros a cada `interval` segundos. */
  thumbs?: { file: string; interval: number; w: number; h: number; cols: number; count: number };
  /** Caminhos relativos à pasta do projeto, servidos pelo servidor. */
  proxy?: string;
  wav16k?: string;
  envelope?: string;
  transcript?: string;
  /**
   * Voz limpa (RNNoise) na intensidade `mix`: `master` sem perdas para o export, `proxy` (mesmo vídeo do proxy,
   * áudio limpo) para o preview — os dois saem da MESMA passada no arquivo inteiro.
   */
  clean?: { mix: number; chain?: boolean; master: string; proxy?: string };
}

/** Trecho da fonte que entra na trilha principal (magnética, estilo CapCut). */
export interface Clip {
  id: string;
  assetId: string;
  /** Ponto de entrada na FONTE. */
  in: Seconds;
  /** Ponto de saída na FONTE. */
  out: Seconds;
  /** Por que este trecho está aqui — vira a EDL legível. */
  reason?: string;
  by: Actor;
  /** Zoom estático aplicado no clipe (cut zoom). 1 = sem zoom. */
  zoom?: number;
  /** Zoom animado: vai de `zoom` até aqui ao longo do clipe (ease-out). */
  zoomTo?: number;
  /** Flash de 2 quadros (invertido, sem cor) na entrada do clipe, com o obturador no SFX. */
  flash?: boolean;
  /** Velocidade (1 = normal; 0,5–2). O áudio acompanha sem mudar o tom. */
  speed?: number;
  /** Congela o último quadro por este tanto (s), em silêncio, no fim do clipe. */
  freeze?: Seconds;
  /** 2ª câmera para este clipe (asset com `role: 'cam'` e `syncOffset`); o áudio continua o da fala. */
  cam?: string;
  /** Enquadramento no reframe (centro horizontal 0–1 em volta do rosto). */
  framing?: { x: number };
}

/** Trecho da fonte que foi descartado — fica visível para o humano poder restaurar. */
export interface Removal {
  id: string;
  assetId: string;
  in: Seconds;
  out: Seconds;
  kind: RemovalKind;
  reason: string;
  by: Actor;
  /** Quando foi cortado (ms) — "restaura o último corte". */
  at?: number;
}

export type RemovalKind =
  | 'retake' // tomada repetida, ficou a melhor
  | 'false_start' // começou e reiniciou a frase
  | 'silence' // ar morto
  | 'offscript' // bastidor, conversa fora do conteúdo
  | 'filler' // vício de linguagem / hesitação isolada
  | 'manual'; // pedido do humano

/** Trecho que o HUMANO mandou manter (restaurou ou estendeu). Refazer a decupagem não corta aqui. */
export interface Pin {
  id: string;
  assetId: string;
  in: Seconds;
  out: Seconds;
  reason: string;
}

// ---------------------------------------------------------------------------
// Multitrilha (ADR-001): a fala fica na trilha principal magnética; o resto são overlays
// ancorados num INSTANTE DA FALA no bruto — sobrevivem a corte, divisão e nova decupagem.
// ---------------------------------------------------------------------------

export type OverlayRole = 'broll' | 'lettering' | 'motion' | 'sfx' | 'music';

export interface TrackState {
  hidden?: boolean;
  muted?: boolean;
  locked?: boolean;
}

export interface Track {
  id: string;
  /** Nome curto exibido na timeline (V2, V3, A2…). */
  label: string;
  name: string;
  kind: 'video' | 'audio';
  roles: OverlayRole[];
}

/** Arquitetura de trilhas do Thales no DaVinci (memória 06 do Cérebro do Editor). */
export const DEFAULT_TRACKS: Track[] = [
  { id: 'V3', label: 'V3', name: 'Lettering / Motion', kind: 'video', roles: ['lettering', 'motion'] },
  { id: 'V2', label: 'V2', name: 'B-roll', kind: 'video', roles: ['broll'] },
  { id: 'A2', label: 'A2', name: 'SFX', kind: 'audio', roles: ['sfx'] },
  { id: 'A3', label: 'A3', name: 'Trilha', kind: 'audio', roles: ['music'] },
];

export interface Anchor {
  /** Asset da fala (A-roll) e o instante dele onde o overlay começa. */
  assetId: string;
  at: Seconds;
}

/** Âncora no tempo da TIMELINE (não numa fala): para o que cobre o vídeo inteiro, como a trilha. */
export const TIMELINE_ANCHOR = '@timeline';

/** Mixagem de um overlay de áudio (trilha, SFX). */
export interface AudioMix {
  /** Volume em dB (0 = original; trilha costuma ficar entre −20 e −12). */
  gainDb: number;
  fadeIn: Seconds;
  fadeOut: Seconds;
  /** Abaixa a trilha quando tem fala (sidechain). */
  duck: boolean;
}

export const DEFAULT_MUSIC_MIX: AudioMix = { gainDb: -16, fadeIn: 1.5, fadeOut: 2.5, duck: true };

/** Intensidades da limpeza de ruído da voz (mistura do RNNoise com o original). */
export const VOICE_DENOISE_LEVELS = [
  { id: 'leve', label: 'Leve', mix: 0.5 },
  { id: 'media', label: 'Média', mix: 0.8 },
  { id: 'forte', label: 'Forte', mix: 1 },
] as const;

export type OverlaySource =
  | { type: 'media'; assetId: string; in: Seconds }
  | { type: 'text'; text: string }
  | { type: 'composition'; compositionId: string }
  /** Motion narrativo: composição HTML função do tempo (core/motion.ts). */
  | { type: 'motion'; motion: import('./motion.ts').MotionSpec }
  /** Lettering animado no lugar da legenda (core/lettering.ts). */
  | { type: 'lettering'; lettering: import('./lettering.ts').LetteringSpec };

export interface OverlayItem {
  id: string;
  trackId: string;
  role: OverlayRole;
  anchor: Anchor;
  duration: Seconds;
  source: OverlaySource;
  reason?: string;
  by: Actor;
  /** Vai até o fim da timeline, qualquer que seja a duração dela (trilha). */
  toEnd?: boolean;
  mix?: AudioMix;
  /** SFX de um motion de mídia (render do Motion Studio): cues lidos do film.js, sintetizados aqui. */
  sfx?: import('./sfx.ts').SfxCue[];
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  /** Trilha principal (V1+A1): clipes em sequência, sem buracos. */
  main: Clip[];
  removals: Removal[];
  pins: Pin[];
  tracks: Track[];
  overlays: OverlayItem[];
  /** Correção de cor por arquivo (câmera): LOG → Rec.709 + primárias. */
  grades?: Record<string, import('./color.ts').ColorGrade>;
  /** Legenda automática (derivada da transcrição + cortes; aqui só ficam as preferências). */
  captions?: import('./text.ts').CaptionSettings;
  /** Obra-alvo dos motions deste vídeo (slug da referência na biblioteca). */
  motionRef?: string;
  /** Ajuste do volume dos SFX dos motions, em dB sobre o nível calibrado pela fala. */
  motionSfxDb?: number;
  /** Limpeza de ruído da voz (RNNoise) na trilha principal: intensidade 0–1; ausente = desligada. */
  voiceDenoise?: number;
  /** Cadeia de voz (passa-alta, compressor, de-esser, limiter) na trilha principal. */
  voiceChain?: boolean;
  /** Reframe: material mais largo que a timeline é recortado em volta do rosto (`clip.framing`), em vez de letterbox. */
  reframe?: boolean;
  /** Estado de cada trilha (V1, V2, V3, A1, A2, A3): oculta e muda valem no preview E no export; travada só protege da edição. */
  trackState?: Record<string, TrackState>;
  /** Referência de lettering deste vídeo (define o estilo e a cor dos letterings automáticos). */
  letteringRef?: string;
  /** Correções de grafia feitas na revisão (a transcrição original fica intacta). */
  wordFixes?: WordFix[];
  /** Ajustes manuais das legendas (texto, dividir, juntar, apagar). */
  captionEdits?: CaptionEdit[];
  /** Formato escolhido à mão (ou pela tarefa): o primeiro vídeo importado não o sobrescreve. */
  formatoManual?: boolean;
  /** Banco dos SFX dos motions, letterings e flashes: foley sintetizado ou amostras reais do CinePRO. */
  sfxBank?: import('./sfx.ts').SfxBank;
}

/**
 * Fluxo do Kanban: o agente decupa → o editor humano revisa a decupagem/copy → o agente finaliza (cor, legenda,
 * letterings, motions, SFX) → revisão final → alteração → entregue.
 */
export type ProjectStatus = 'fila' | 'decupando' | 'revisao' | 'finalizando' | 'editado' | 'alteracao' | 'entregue';
export const PROJECT_STATUSES: ProjectStatus[] = ['fila', 'decupando', 'revisao', 'finalizando', 'editado', 'alteracao', 'entregue'];

/** Portão de revisão humana da decupagem. */
export interface ProjectReview {
  decupadaEm?: string;
  aprovadaEm?: string;
  /** Dúvidas que o editor já resolveu ("está certo"). */
  resolvidas?: string[];
}

/**
 * Ajuste manual de uma legenda. A legenda continua derivada da fala (acompanha os cortes); o ajuste fica preso à
 * PALAVRA do bruto onde ela começa, então sobrevive a novas decupagens.
 */
export interface CaptionEdit {
  assetId: string;
  /** Início (no bruto) da palavra que identifica a legenda. */
  at: Seconds;
  /** Texto escrito à mão para esta legenda. */
  text?: string;
  /** Legenda apagada. */
  hidden?: boolean;
  /** Mostrar mesmo quando há lettering, motion ou B-roll em cima (a regra é esconder). */
  force?: boolean;
  /** Força uma legenda nova começando nesta palavra (dividir). */
  split?: boolean;
  /** Proíbe começar legenda nesta palavra: ela vai junto com a anterior (juntar). */
  join?: boolean;
}

export interface CaptionEditOp {
  assetId: string;
  at: Seconds;
  /** `text: null` volta ao texto automático (undefined some no JSON do WebSocket — por isso null). */
  patch: { text?: string | null; hidden?: boolean; force?: boolean; split?: boolean; join?: boolean } | null;
}

/** Grafia corrigida pelo editor de uma palavra da transcrição (vale para legenda, lettering e motion). */
export interface WordFix {
  assetId: string;
  /** Início da palavra no bruto (identifica a palavra). */
  at: Seconds;
  text: string;
}

export interface AppNotification {
  id: string;
  at: string;
  projectId: string;
  projectName: string;
  kind: 'revisao' | 'editado' | 'info';
  text: string;
  read?: boolean;
}

export interface Project {
  id: string;
  name: string;
  brief: string;
  status: ProjectStatus;
  createdAt: string;
  assets: MediaAsset[];
  timeline: Timeline;
  version: number;
  review?: ProjectReview;
  /** Cliente (aparece no cartão do Kanban). */
  client?: string;
  /** Prazo de entrega (AAAA-MM-DD). */
  dueAt?: string;
  /** Perfil de edição (id em data/perfis). Ausente = padrão da casa. */
  profileId?: string;
  /** Texto da tarefa como chegou (do cliente/Gestor) e o briefing estruturado tirado dele. */
  task?: ProjectTask;
  /** Tempo real de cada etapa (para calibrar a estimativa). */
  timings?: Partial<Record<StepId, { startedAt: string; endedAt?: string; seconds?: number }>>;
  /** Último QC (antes de "Editado" e depois do render). */
  qc?: QcReport;
  /** Pedidos de alteração com tempo (ciclo "Alteração"). */
  comments?: ProjectComment[];
  /** Versões entregues/exportadas (o ciclo de alteração compara v1 × v2). */
  versions?: ProjectVersion[];
}

export type StepId = 'ingest' | 'decupar' | 'revisao' | 'cor' | 'legenda' | 'broll' | 'trilha' | 'motions' | 'letterings' | 'qc' | 'final' | 'render' | 'alteracao';

export interface ProjectTask {
  texto: string;
  /** Briefing estruturado (Gestor de Projetos). */
  formato?: 'reels' | 'shorts' | 'tiktok' | 'youtube' | 'stories' | 'outro';
  duracaoAlvoS?: [number, number];
  tom?: string;
  naoPodeFaltar?: string[];
  links?: string[];
  cliente?: string;
  prazo?: string;
}

export interface QcIssue {
  id: string;
  /** bloqueia = não entrega assim; avisa = conferir. */
  severidade: 'bloqueia' | 'avisa';
  regra: string;
  texto: string;
  /** Tempo na timeline (quando houver). */
  at?: number;
  overlayId?: string;
}

export interface QcReport {
  at: string;
  /** 'edicao' = antes de Editado; 'render' = sobre o MP4. */
  fase: 'edicao' | 'render';
  issues: QcIssue[];
  /** Medições do render (quando fase = render). */
  render?: { lufs?: number; truePeak?: number; blackFrames?: number; file?: string };
}

export interface ProjectComment {
  id: string;
  at: number;
  text: string;
  by: 'editor' | 'cliente';
  createdAt: string;
  status: 'aberto' | 'feito' | 'manual' | 'descartado';
  /** Resposta do agente (o que fez, ou por que não entendeu). */
  resposta?: string;
}

export interface ProjectVersion {
  n: number;
  at: string;
  label: string;
  timeline: Timeline;
  render?: string;
}

// ---------------------------------------------------------------------------
// Operações — o vocabulário único de edição (agente e humano usam o mesmo).
// ---------------------------------------------------------------------------

export type TimelineOp =
  /** Substitui a trilha principal inteira (resultado de uma decupagem). */
  | { type: 'set_main'; clips: Clip[]; removals?: Removal[] }
  /** Remove um intervalo da FONTE de todos os clipes da trilha principal. */
  | { type: 'cut_source'; assetId: string; in: Seconds; out: Seconds; kind: RemovalKind; reason: string }
  /** Remove um intervalo da TIMELINE (tempo de saída). */
  | { type: 'cut_timeline'; start: Seconds; end: Seconds; reason: string }
  /** Devolve um trecho descartado para a timeline, na posição cronológica da fonte. */
  | { type: 'restore'; removalId: string }
  | { type: 'trim'; clipId: string; in?: Seconds; out?: Seconds }
  | { type: 'delete_clip'; clipId: string; reason?: string }
  | { type: 'move_clip'; clipId: string; toIndex: number }
  | { type: 'split'; time: Seconds }
  | { type: 'set_zoom'; clipId: string; zoom: number; zoomTo?: number | null }
  | { type: 'set_flash'; clipId: string; on: boolean }
  | { type: 'set_speed'; clipId: string; speed?: number | null; freeze?: number | null }
  | { type: 'set_cam'; clipId: string; assetId: string | null }
  | { type: 'set_framing'; clipId: string; x: number | null }
  | { type: 'set_reframe'; on: boolean }
  /** Formato da entrega em pixels (e fps): presets ou livre. Fica no histórico. */
  | { type: 'set_format'; width: number; height: number; fps?: number }
  | { type: 'set_sfx_bank'; bank: import('./sfx.ts').SfxBank }
  | { type: 'add_overlay'; item: Omit<OverlayItem, 'id' | 'by'> & { id?: string } }
  | { type: 'move_overlay'; id: string; anchor: Anchor; trackId?: string }
  | { type: 'trim_overlay'; id: string; duration: Seconds; sourceIn?: Seconds }
  | { type: 'remove_overlay'; id: string }
  | { type: 'set_captions'; captions: import('./text.ts').CaptionSettings }
  | { type: 'set_overlay_mix'; id: string; mix: AudioMix; sourceIn?: Seconds }
  | { type: 'set_grade'; assetId: string; grade: import('./color.ts').ColorGrade | null }
  | { type: 'set_overlay_text'; id: string; text: string }
  | { type: 'set_overlay_motion'; id: string; motion: import('./motion.ts').MotionSpec }
  | { type: 'set_motion_ref'; refId: string | null }
  | { type: 'set_motion_sfx'; gainDb: number }
  /** Oculta / muda / trava uma trilha (patch; false limpa). */
  | { type: 'set_track_state'; trackId: string; patch: TrackState }
  /** Limpeza de ruído da voz: 0 desliga. */
  | { type: 'set_voice_denoise'; amount: number }
  | { type: 'set_voice_chain'; on: boolean }
  | { type: 'set_overlay_lettering'; id: string; lettering: import('./lettering.ts').LetteringSpec }
  | { type: 'set_overlay_sfx'; id: string; sfx: import('./sfx.ts').SfxCue[] }
  | { type: 'set_lettering_ref'; refId: string | null }
  /** Corrige a grafia de palavras (texto vazio desfaz a correção). */
  | { type: 'fix_words'; fixes: WordFix[] }
  /** Ajusta legendas em lote (patch null volta ao automático naquela palavra). */
  | { type: 'edit_captions'; edits: CaptionEditOp[] };

export interface OpEnvelope {
  op: TimelineOp;
  by: Actor;
  /** Texto curto exibido no log de atividade ("Cortei a tomada repetida em 0:22"). */
  note?: string;
}

// ---------------------------------------------------------------------------
// Atividade do agente — dirige o avatar e o log ao vivo.
// ---------------------------------------------------------------------------

export type AgentState =
  | 'idle'
  | 'analyzing' // assistindo / transcrevendo
  | 'thinking' // sentado na timeline, olhando pros lados
  | 'cutting' // andando com a tesoura
  | 'motion' // andando com o pincel
  | 'celebrating'; // pulando

export interface AgentActivity {
  state: AgentState;
  message: string;
  /** Ponto da timeline onde o avatar deve estar. */
  at?: Seconds;
  /** Progresso 0..1 da etapa atual, quando houver. */
  progress?: number;
}

// ---------------------------------------------------------------------------
// Mensagens do WebSocket
// ---------------------------------------------------------------------------

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  /** Rótulo do próximo desfazer ("Decupagem automática", "Corte manual"…). */
  undoLabel?: string;
  redoLabel?: string;
}

export type ServerMessage =
  | { type: 'snapshot'; project: Project; history: HistoryState }
  | { type: 'op'; envelope: OpEnvelope; version: number; timeline: Timeline; history: HistoryState }
  | { type: 'activity'; activity: AgentActivity }
  | { type: 'log'; entry: LogEntry }
  | { type: 'asset'; asset: MediaAsset };

export interface LogEntry {
  id: string;
  at: string;
  by: Actor;
  text: string;
}

export type ClientMessage =
  | { type: 'op'; envelope: OpEnvelope; baseVersion: number }
  | { type: 'command'; text: string }
  | { type: 'undo' }
  | { type: 'redo' };
