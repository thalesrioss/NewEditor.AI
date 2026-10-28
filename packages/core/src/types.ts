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
  /** Tamanho e mtime (ms) do arquivo quando foi lido: registrar o mesmo caminho com o arquivo mudado mede de novo (CH-0031). */
  file?: { size: number; mtime: number };
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
  /** 2ª câmera: id da fala a que o `syncOffset` se refere (com várias falas no projeto, cada câmera é de uma). */
  syncFala?: string;
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
  /** false = flash só visual, sem o obturador sintetizado (o editor põe a própria amostra no A2). */
  flashSfx?: false;
  /** Velocidade (1 = normal; 0,5–2). O áudio acompanha sem mudar o tom. */
  speed?: number;
  /** Congela o último quadro por este tanto (s), em silêncio, no fim do clipe. */
  freeze?: Seconds;
  /** 2ª câmera para este clipe (asset com `role: 'cam'` e `syncOffset`); o áudio continua o da fala. */
  cam?: string;
  /**
   * Enquadramento: `x` = centro horizontal (0–1) do recorte no reframe; `y` = âncora vertical (0–1, altura dos olhos
   * na fonte) do zoom: o ponto nessa altura fica parado na tela ao ampliar. Sem `y`, o zoom amplia pelo centro.
   */
  framing?: { x?: number; y?: number };
  /**
   * Rampa de enquadramento (CH-0036): `framing` vai até este `x`/`y` de `start` a `start + dur` (s desde o início do
   * clipe, tempo de saída; sem `dur`, até o fim do clipe), ease-out ou linear. Só a imagem; o áudio não é tocado.
   * Fora do reframe, como o `framing` (âncora do zoom: precisa de zoom > 1 para mover).
   */
  framingTo?: FramingRamp;
}

export interface FramingRamp {
  x?: number;
  y?: number;
  start?: Seconds;
  dur?: Seconds;
  ease?: 'out' | 'linear';
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
  /** Enquadramento do B-roll que preenche o quadro: centro do recorte (0–1 na fonte) e zoom (1 = só preencher). */
  framing?: OverlayFraming;
  /** Velocidade do B-roll (1 = normal; 0,25–4): 0,5 = câmera lenta, o mesmo trecho da fonte dura o dobro. */
  speed?: number;
  /** Congela o quadro nos últimos `freeze` s do overlay (a duração na timeline não muda). */
  freeze?: Seconds;
  /** Camada que convive com a legenda (CH-0022: título fixo do cliente no topo): não esconde nem quebra a legenda. */
  keepCaptions?: boolean;
}

export interface OverlayFraming {
  x: number;
  y: number;
  zoom: number;
  /**
   * Como ler x/y (CH-0032). Ausente = centro do recorte (padrão do B-roll). `clip` = âncora, como o
   * `framing` do clipe principal: 0 encosta o recorte na borda esquerda/de cima, 1 na direita/de baixo,
   * e o mesmo x/y com o mesmo zoom dá o mesmo recorte do clipe.
   */
  anchor?: 'clip';
}

/**
 * Efeito por região no V1 (CH-0033): desfoque ou limpeza num retângulo da TELA (0–1 do quadro de entrega),
 * com borda suave, num trecho ancorado na fala como os overlays. Entra na imagem da fala (já com a cor) antes
 * do B-roll, dos motions, dos letterings e da legenda: o título fixo fica por cima, nítido.
 */
export interface RegionFx {
  id: string;
  anchor: Anchor;
  duration: Seconds;
  /** Canto superior esquerdo e tamanho, em fração do quadro de entrega. */
  rect: { x: number; y: number; w: number; h: number };
  /** Borda suave, em fração da altura do quadro (0,02 = ~38 px em 1920). 0 = borda seca. */
  feather: number;
  /** blur = desfoque; clean = some com texto e detalhe fino (mediana larga + desfoque leve), mantém a cor de fundo. */
  mode: 'blur' | 'clean';
  /** Intensidade 0–1. */
  strength: number;
  /** Protege pixels escuros (luma 0–1 abaixo deste valor ficam intactos: cabelo, roupa, contorno da pessoa). */
  protectDark?: number;
  /** Entra e sai em rampa (s), além da borda no espaço. */
  fade?: Seconds;
  reason?: string;
  by: Actor;
}

/** Campos de `set_region_fx`: `start`/`end` em tempo da timeline viram âncora e duração; null tira o opcional. */
export interface RegionFxPatch {
  anchor?: Anchor;
  start?: Seconds;
  end?: Seconds;
  duration?: Seconds;
  rect?: Partial<RegionFx['rect']>;
  feather?: number;
  mode?: RegionFx['mode'];
  strength?: number;
  protectDark?: number | null;
  fade?: Seconds | null;
  reason?: string;
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
  /** Efeitos por região no V1 (CH-0033). */
  regionFx?: RegionFx[];
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
  /** Altura desta legenda no quadro (0–1, centro do bloco), no lugar da posição global (CH-0014: tela dividida). */
  position?: number;
  /** Com `position`: vale para todas as legendas que começam entre `at` e `until` (no bruto, mesmo arquivo) — um trecho. */
  until?: Seconds;
}

export interface CaptionEditOp {
  assetId: string;
  at: Seconds;
  /** `text: null` volta ao texto automático (undefined some no JSON do WebSocket — por isso null). */
  patch: { text?: string | null; hidden?: boolean; force?: boolean; split?: boolean; join?: boolean; position?: number | null; until?: Seconds | null } | null;
}

/** Grafia e/ou tempo corrigidos pelo editor numa palavra da transcrição (vale para legenda, lettering e motion). */
export interface WordFix {
  assetId: string;
  /** Início da palavra no bruto segundo o ASR (identifica a palavra; não muda quando o tempo é corrigido). */
  at: Seconds;
  text?: string;
  /** Início corrigido no bruto, medido na forma de onda (CH-0041: o ASR não é fonte de tempo). */
  start?: Seconds;
  /** Fim corrigido no bruto. */
  end?: Seconds;
}

/**
 * Correção de uma palavra pela op `fix_words`. Campo ausente fica como está; `text: ''` ou `null` volta à
 * grafia do ASR; `start`/`end` `null` voltam ao tempo do ASR (CH-0041).
 */
export interface WordFixOp {
  assetId: string;
  at: Seconds;
  text?: string | null;
  start?: Seconds | null;
  end?: Seconds | null;
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
  /** Instruções de edição do texto ("tirar gaguejadas", "legenda amarela"), tiradas por regra. */
  pedidos?: string[];
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
  render?: { lufs?: number; truePeak?: number; blackFrames?: number; /** duração do arquivo (ffprobe), s */ duration?: number; file?: string };
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
  | { type: 'set_flash'; clipId: string; on: boolean; /** false = sem o obturador; true volta o som; omitido mantém. */ sfx?: boolean }
  | { type: 'set_speed'; clipId: string; speed?: number | null; freeze?: number | null }
  | { type: 'set_cam'; clipId: string; assetId: string | null }
  /** `x`/`y` ausentes mantêm o valor; `null` tira. */
  | { type: 'set_framing'; clipId: string; x?: number | null; y?: number | null; /** Rampa (CH-0036): campos ausentes mantêm, `null` tira a rampa. */ to?: { x?: number | null; y?: number | null; start?: Seconds | null; dur?: Seconds | null; ease?: 'out' | 'linear' | null } | null }
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
  /** Posição e zoom do B-roll (CH-0003); campos ausentes ficam como estão, null volta ao recorte central. */
  | { type: 'set_overlay_framing'; id: string; framing: (Partial<Omit<OverlayFraming, 'anchor'>> & { anchor?: 'clip' | 'center' | null }) | null }
  /** Velocidade e congelamento do B-roll (CH-0004); null ou ausente = como estava (null volta ao normal). */
  | { type: 'set_overlay_speed'; id: string; speed?: number | null; freeze?: Seconds | null }
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
  /** Liga/desliga a convivência com a legenda (título fixo; CH-0022). */
  | { type: 'set_overlay_keep_captions'; id: string; keep: boolean }
  | { type: 'set_lettering_ref'; refId: string | null }
  /** Efeito por região (CH-0033): sem `id` cria; com `id` altera só os campos enviados; `fx: null` apaga. */
  | { type: 'set_region_fx'; id?: string; fx: RegionFxPatch | null }
  /** Corrige a grafia (texto vazio desfaz) e/ou o início e fim de palavras no bruto (CH-0041; null desfaz). */
  | { type: 'fix_words'; fixes: WordFixOp[] }
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
  /** Id do passo no topo do desfazer: o chat sabe se o passo de um pedido ainda é o último (BL-0055). */
  undoId?: string;
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
  /** Pedido reescrito pelo LLM local que o agente não executou: o chat mostra "Aplicar" (ADR-0005). */
  suggestion?: { text: string; playhead?: number };
  /** Passo de desfazer aberto quando a mensagem nasceu (o pedido do chat em andamento): "Desfazer este pedido" (BL-0055). */
  step?: string;
}

export type ClientMessage =
  | { type: 'op'; envelope: OpEnvelope; baseVersion: number }
  | { type: 'command'; text: string }
  | { type: 'undo' }
  | { type: 'redo' };
