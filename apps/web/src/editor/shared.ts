/**
 * Constantes e utilitários que o editor inteiro compartilha (timeline, painéis, barra superior, Kanban).
 */
import type { OverlayRole, ProjectStatus, RemovalKind } from '@neweditor/core';

/** Tipo MIME do arrasto de um asset da biblioteca para a timeline. */
export const ASSET_MIME = 'application/x-neweditor-asset';
/** Tipo MIME do arrasto de um item do CinePRO (ainda não é asset: o servidor importa ao soltar). */
export const CINEPRO_MIME = 'application/x-neweditor-cinepro';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  fila: 'Fila',
  decupando: 'Decupando',
  revisao: 'Revisão da decupagem',
  finalizando: 'Finalizando',
  editado: 'Editado',
  alteracao: 'Alteração',
  entregue: 'Entregue',
};
/** Quem age em cada coluna: o agente ou o editor humano. */
export const STATUS_OWNER: Record<ProjectStatus, 'agente' | 'humano' | 'cliente'> = {
  fila: 'agente',
  decupando: 'agente',
  revisao: 'humano',
  finalizando: 'agente',
  editado: 'humano',
  alteracao: 'humano',
  entregue: 'cliente',
};

export const KIND_STYLE: Record<RemovalKind, { label: string; color: string }> = {
  retake: { label: 'Tomada repetida', color: 'var(--color-cut-retake)' },
  false_start: { label: 'Começo abandonado', color: 'var(--color-cut-false)' },
  offscript: { label: 'Bastidor', color: 'var(--color-cut-off)' },
  filler: { label: 'Hesitação', color: 'var(--color-cut-filler)' },
  silence: { label: 'Pausa', color: 'var(--color-cut-silence)' },
  manual: { label: 'Corte manual', color: 'var(--color-cut-manual)' },
};

/** Cor de cada tipo de camada na timeline (CapCut: texto laranja, áudio verde, vídeo azul). */
export const ROLE_STYLE: Record<OverlayRole, { label: string; bg: string; border: string; solid: string }> = {
  broll: { label: 'B-roll', bg: 'rgb(16 185 129 / 0.22)', border: 'rgb(16 185 129 / 0.8)', solid: '#10b981' },
  lettering: { label: 'Lettering', bg: 'rgb(254 202 87 / 0.22)', border: 'rgb(254 202 87 / 0.85)', solid: '#feca57' },
  motion: { label: 'Motion', bg: 'rgb(197 108 240 / 0.24)', border: 'rgb(197 108 240 / 0.85)', solid: '#c56cf0' },
  sfx: { label: 'SFX', bg: 'rgb(255 159 67 / 0.22)', border: 'rgb(255 159 67 / 0.85)', solid: '#ff9f43' },
  music: { label: 'Trilha', bg: 'rgb(0 180 255 / 0.18)', border: 'rgb(0 180 255 / 0.8)', solid: '#00b4ff' },
};

/** Abas do trilho da esquerda (recursos) e do painel da direita. */
export type RailTab = 'midia' | 'fala' | 'audio' | 'legenda' | 'texto' | 'motion' | 'cor' | 'cinepro' | 'efeitos';
export type RightTab = 'ajustes' | 'agente' | 'revisao';

/** Abre uma aba do painel direito de qualquer lugar (a casca do editor escuta). */
export const openRightTab = (tab: RightTab | 'propriedades'): void => {
  window.dispatchEvent(new CustomEvent<RightTab>('ne:tab', { detail: tab === 'propriedades' ? 'ajustes' : tab }));
};
/** Abre um painel de recursos do trilho da esquerda. */
export const openRail = (tab: RailTab): void => {
  window.dispatchEvent(new CustomEvent<RailTab>('ne:rail', { detail: tab }));
};

/** Timecode de editor (HH:MM:SS:FF), como o CapCut mostra no player e na régua. */
export function timecode(t: number, fps: number, hours = true): string {
  const r = Math.max(1, Math.round(fps || 30));
  const total = Math.max(0, Math.round(t * (fps || 30)));
  const ff = total % r;
  const secs = Math.floor(total / r);
  const s = secs % 60;
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${hours || h ? `${two(h)}:` : ''}${two(m)}:${two(s)}:${two(ff)}`;
}

/** Alturas das linhas da timeline — cabeçalho e conteúdo usam a mesma tabela para alinhar. */
export const ROW = { ruler: 26, marks: 14, LG: 28, V3: 36, V2: 46, V1: 66, A1: 40, A2: 28, A3: 28 } as const;
export type RowId = keyof typeof ROW;
