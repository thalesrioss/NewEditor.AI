/**
 * Ciclo de Alteração (canvas / ADR-007 F-3): comentários com tempo na timeline (do editor, ou repassados do
 * cliente) viram pedidos para o agente. Ele executa o que entende pelo cérebro local, marca o que não
 * entendeu como "manual", e o projeto volta para "Editado" com uma versão nova para comparar.
 */
import { timelineDuration, type Project, type ProjectComment, type ProjectVersion, type Timeline } from '@neweditor/core';
import { runCommand, SUGESTAO } from './agent.ts';
import { stepEnd, stepStart } from './estimate.ts';
import { notify } from './notify.ts';
import { runQc } from './qc.ts';
import { store } from './store.ts';

export function addComment(projectId: string, c: { at: number; text: string; by?: ProjectComment['by'] }): ProjectComment {
  const p = store.get(projectId);
  const comment: ProjectComment = { id: `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, at: Math.max(0, c.at), text: c.text.trim(), by: c.by ?? 'editor', createdAt: new Date().toISOString(), status: 'aberto' };
  store.update(projectId, { comments: [...(p.comments ?? []), comment] });
  // Um pedido de alteração num projeto já editado puxa o card para "Alteração".
  if (p.status === 'editado' || p.status === 'entregue') store.update(projectId, { status: 'alteracao' });
  return comment;
}

export function patchComment(projectId: string, id: string, patch: Partial<Pick<ProjectComment, 'text' | 'at' | 'status' | 'by'>>): ProjectComment | undefined {
  const p = store.get(projectId);
  const list = (p.comments ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c));
  store.update(projectId, { comments: list });
  return list.find((c) => c.id === id);
}

export function removeComment(projectId: string, id: string): void {
  const p = store.get(projectId);
  store.update(projectId, { comments: (p.comments ?? []).filter((c) => c.id !== id) });
}

/** O agente passa pelos comentários abertos, em ordem de tempo, e executa cada um como um pedido em texto. */
export async function runAlteracoes(projectId: string): Promise<{ feitos: number; manuais: number }> {
  const p0 = store.get(projectId);
  const open = (p0.comments ?? []).filter((c) => c.status === 'aberto').sort((a, b) => a.at - b.at);
  if (!open.length) return { feitos: 0, manuais: 0 };
  stepStart(projectId, 'alteracao');
  store.update(projectId, { status: 'alteracao' });
  const before = snapshot(store.get(projectId), 'antes das alterações');
  let feitos = 0;
  let manuais = 0;
  for (const c of open) {
    store.setActivity(projectId, { state: 'thinking', message: `Alteração: "${c.text.slice(0, 60)}"`, at: c.at });
    let resposta = '';
    try {
      resposta = await runCommand(projectId, c.text, c.at);
    } catch (e) {
      resposta = (e as Error).message;
    }
    const understood = !/^Ainda não entendi/i.test(resposta) && !/não entendi/i.test(resposta.slice(0, 40)) && !resposta.startsWith(SUGESTAO);
    patchComment(projectId, c.id, { status: understood ? 'feito' : 'manual' });
    const list = (store.get(projectId).comments ?? []).map((x) => (x.id === c.id ? { ...x, resposta } : x));
    store.update(projectId, { comments: list });
    if (understood) feitos++;
    else manuais++;
  }
  await runQc(projectId);
  const p = store.get(projectId);
  const versao: ProjectVersion = { n: (p.versions?.at(-1)?.n ?? 0) + 1, at: new Date().toISOString(), label: `Alterações (${feitos} feitas${manuais ? `, ${manuais} manuais` : ''})`, timeline: p.timeline };
  store.update(projectId, { versions: [...(p.versions ?? []).filter((v) => v.label !== before.label), before, versao], status: 'editado' });
  stepEnd(projectId, 'alteracao');
  await notify(store.get(projectId), 'editado', `Alterações feitas em ${p.name}: ${feitos} pedido(s) atendido(s)${manuais ? `, ${manuais} para fazer à mão` : ''}.`);
  store.setActivity(projectId, { state: 'celebrating', message: `Alterações: ${feitos} feita(s)${manuais ? `, ${manuais} precisam de você` : ''}` });
  setTimeout(() => store.setActivity(projectId, { state: 'idle', message: 'Pronto' }), 2400);
  return { feitos, manuais };
}

function snapshot(p: Project, label: string): ProjectVersion {
  return { n: p.versions?.at(-1)?.n ?? 0, at: new Date().toISOString(), label, timeline: p.timeline };
}

/** O que mudou entre duas timelines (para "ver a diferença" entre versões). */
export function diffTimelines(a: Timeline, b: Timeline): { duracao: [number, number]; cortesNovos: number; cortesDesfeitos: number; overlaysNovos: string[]; overlaysRemovidos: string[]; zooms: number } {
  const ra = new Set(a.removals.map((r) => `${r.assetId}:${r.in.toFixed(2)}`));
  const rb = new Set(b.removals.map((r) => `${r.assetId}:${r.in.toFixed(2)}`));
  const oa = new Map(a.overlays.map((o) => [o.id, o]));
  const ob = new Map(b.overlays.map((o) => [o.id, o]));
  const za = a.main.filter((c) => c.zoom && c.zoom > 1).length;
  const zb = b.main.filter((c) => c.zoom && c.zoom > 1).length;
  return {
    duracao: [timelineDuration(a), timelineDuration(b)],
    cortesNovos: [...rb].filter((k) => !ra.has(k)).length,
    cortesDesfeitos: [...ra].filter((k) => !rb.has(k)).length,
    overlaysNovos: [...ob.keys()].filter((k) => !oa.has(k)).map((k) => ob.get(k)!.role),
    overlaysRemovidos: [...oa.keys()].filter((k) => !ob.has(k)).map((k) => oa.get(k)!.role),
    zooms: zb - za,
  };
}
