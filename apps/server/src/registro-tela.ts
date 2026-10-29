/**
 * Captura do que o Thales faz pela tela do Editor Brain (central 5410 ou a tela do Vite) para o registro no Cérebro.
 * Quem é o humano: pedido com `Origin` aceito (só a tela manda; agentes e curl chegam sem, BL-0123) e as ops do
 * WebSocket, que só a tela abre. Agente da NewStudios aplicando op por HTTP não é o Thales e não é gravado.
 *
 * Aprovação da decupagem, card para Entregue (aprovação) ou de volta para Alteração (reprovação), comentário de
 * alteração e pedido no chat = 1 linha cada. Edição à mão (arrastos, cor, cortes) não grava op por op: junta numa
 * sessão e grava um resumo (antes/depois) quando ele para de mexer por `NEWEDITOR_SESSAO_HUMANA_MS` (10 min), ou
 * antes de aprovar/mudar o status, ou quando `fecharSessaoHumana` é chamado (o "Devolver ao agente" do BL-0122).
 */
import type { Project, Timeline, TimelineOp } from '@neweditor/core';
import { diffTimelines } from './alteracoes.ts';
import { clienteDoProjeto, projetoCurto, registrarThales, type CanalThales, type RegistroThales } from './registro-thales.ts';
import { store } from './store.ts';

/** Canal do pedido: a tela (5410 = central da NewStudios) ou null quando não veio da tela. */
export function canalDaTela(headers: { origin?: string | string[] }): CanalThales | null {
  const o = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;
  if (!o) return null;
  try {
    return new URL(o).port === '5410' ? 'tela-5410' : 'editor-brain';
  } catch {
    return null;
  }
}

/** Grava sem derrubar a rota: falha do registro vai para o log do projeto. */
export async function registrarDaTela(p: Project, canal: CanalThales, r: Omit<RegistroThales, 'canal' | 'cliente' | 'projeto'>): Promise<void> {
  try {
    const res = await registrarThales({ ...r, canal, cliente: await clienteDoProjeto(p), projeto: projetoCurto(p), quem: r.quem ?? `editor-brain (${canal})` });
    if (res.avisos.length) console.warn(`[registro ${p.id}] ${res.avisos.join('; ')}`);
  } catch (e) {
    store.log(p.id, 'system', `Registro no Cérebro falhou: ${(e as Error).message}`);
  }
}

// --- Sessão de edição à mão --------------------------------------------------------------------------------

interface Sessao {
  canal: CanalThales;
  desde: string;
  antes: Timeline;
  ops: Map<string, number>;
  notas: string[];
  timer?: ReturnType<typeof setTimeout>;
}

const sessoes = new Map<string, Sessao>();
const ociosoMs = () => Number(process.env.NEWEDITOR_SESSAO_HUMANA_MS ?? 10 * 60_000);

/** Chame ANTES de aplicar a op do humano (guarda a timeline de antes na 1ª op da sessão). */
export function anotarOpHumana(projectId: string, op: TimelineOp, canal: CanalThales, note?: string): void {
  let s = sessoes.get(projectId);
  if (!s) {
    s = { canal, desde: new Date().toISOString(), antes: structuredClone(store.get(projectId).timeline), ops: new Map(), notas: [] };
    sessoes.set(projectId, s);
  }
  s.ops.set(op.type, (s.ops.get(op.type) ?? 0) + 1);
  if (note && !s.notas.includes(note) && s.notas.length < 8) s.notas.push(note);
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => void fecharSessaoHumana(projectId), ociosoMs());
  s.timer.unref?.();
}

export const temSessaoHumana = (projectId: string) => sessoes.has(projectId);

/** Fecha a sessão e grava 1 linha com o resumo; nada se ele desfez tudo ou o projeto sumiu. */
export async function fecharSessaoHumana(projectId: string): Promise<boolean> {
  const s = sessoes.get(projectId);
  if (!s) return false;
  sessoes.delete(projectId);
  if (s.timer) clearTimeout(s.timer);
  let p: Project;
  try {
    p = store.get(projectId);
  } catch {
    return false;
  }
  if (JSON.stringify(p.timeline) === JSON.stringify(s.antes)) return false;
  const r = resumoSessao(s.antes, p.timeline, s.ops, s.notas);
  await registrarDaTela(p, s.canal, { tipo: 'alteracao', ...r, ref: `tela:${projectId}:sessao:${s.desde}`, quando: s.desde, titulo: `${p.name.slice(0, 50)} - editado à mão na tela` });
  return true;
}

/** Resumo por tipo de op e o antes/depois da timeline (o que `diffTimelines` já mede, mais a cor por arquivo). */
export function resumoSessao(a: Timeline, b: Timeline, ops: Map<string, number>, notas: string[]): { pedido: string; antes: string; depois: string } {
  const d = diffTimelines(a, b);
  const lista = [...ops].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t} ×${n}`).join(', ');
  const cor = (t: Timeline) => Object.entries(t.grades ?? {}).map(([id, g]) => `${id}: ${JSON.stringify(g)}`).join('; ');
  const corA = cor(a);
  const corB = cor(b);
  const geral = (t: Timeline, dur: number) => `${dur.toFixed(2)} s, ${t.main.length} clipe(s), ${t.removals.length} corte(s), ${t.overlays.length} camada(s)`;
  const mudou = [
    d.cortesNovos && `${d.cortesNovos} corte(s) novo(s)`,
    d.cortesDesfeitos && `${d.cortesDesfeitos} corte(s) desfeito(s)`,
    d.overlaysNovos.length && `camadas novas: ${d.overlaysNovos.join(', ')}`,
    d.overlaysRemovidos.length && `camadas removidas: ${d.overlaysRemovidos.join(', ')}`,
    d.zooms && `zooms ${d.zooms > 0 ? '+' : ''}${d.zooms}`,
    corA !== corB && 'cor mudou',
  ].filter(Boolean);
  return {
    pedido: `Editou à mão na tela (${lista})${notas.length ? `: ${notas.join(' · ')}` : ''}`,
    antes: `${geral(a, d.duracao[0])}${corA !== corB && corA ? `; cor: ${corA.slice(0, 600)}` : ''}`,
    depois: `${geral(b, d.duracao[1])}${mudou.length ? ` (${mudou.join('; ')})` : ''}${corA !== corB && corB ? `; cor: ${corB.slice(0, 600)}` : ''}`,
  };
}
