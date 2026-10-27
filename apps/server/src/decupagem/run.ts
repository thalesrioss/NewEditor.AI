import fs from 'node:fs/promises';
import path from 'node:path';
import { sourceToTimeline, timelineDuration, uid, type MediaAsset, type Pin, type Timeline } from '@neweditor/core';
import { readTranscript, writeCenters } from '../asr.ts';
import { sleep } from '../jobs.ts';
import { readEnvelope } from '../media.ts';
import { store } from '../store.ts';
import { fmtDur } from '../ingest.ts';
import { notify } from '../notify.ts';
import { reviewDoubts } from '../review.ts';
import { planDecupagem, type PlannedRemoval } from './plan.ts';
import { stepEnd, stepStart } from '../estimate.ts';
import { profileOf } from '../profiles.ts';
import { contextoThales } from '../registro-thales.ts';

const KIND_LABEL: Record<string, string> = {
  retake: 'tomada repetida',
  false_start: 'começo abandonado',
  offscript: 'bastidor',
  filler: 'hesitação',
  silence: 'pausa',
  manual: 'corte',
};

/**
 * Decupa as brutas (todas as falas transcritas, ou uma só quando pedida) e aplica o resultado na
 * timeline AO VIVO: parte dos brutos inteiros, na ordem em que chegaram, e aplica corte por corte,
 * com o avatar andando até cada ponto. O humano assiste a decupagem acontecer.
 */
export async function runDecupagem(projectId: string, assetId?: string): Promise<void> {
  const p = store.get(projectId);
  const falas = p.assets.filter((a) => a.role === 'fala' && a.transcript && a.envelope);
  const targets = assetId ? falas.filter((a) => a.id === assetId) : falas;
  if (!targets.length) throw new Error('o material ainda não foi transcrito');
  const semTranscricao = p.assets.filter((a) => a.role === 'fala' && !(a.transcript && a.envelope));
  if (!assetId && semTranscricao.length) store.log(projectId, 'agent', `${semTranscricao.map((a) => a.name).join(', ')} ainda não foi transcrito — decupo o que está pronto; depois é só pedir de novo.`);

  const dir = store.dir(projectId);
  store.update(projectId, { status: 'decupando' });
  stepStart(projectId, 'decupar');
  // O perfil do cliente dá as folgas de corte (calibradas pelo benchmark).
  const prof = await profileOf(p);
  // Briefing + as últimas correções do Thales para o cliente (o cérebro Claude lê; o local ignora o texto).
  const thales = await contextoThales(p).catch(() => '');
  const brief = thales ? `${p.brief}\n\n${thales}` : p.brief;
  const before = store.get(projectId).timeline;
  const many = targets.length > 1;

  // Planeja cada bruta (a análise é por arquivo); aplica tudo numa transação só.
  const plans: { asset: MediaAsset; tr: Awaited<ReturnType<typeof readTranscript>>; plan: Awaited<ReturnType<typeof planDecupagem>>; pins: Pin[]; humanCuts: Timeline['removals']; zooms: { in: number; out: number; zoom: number }[]; removals: PlannedRemoval[] }[] = [];
  for (const asset of targets) {
    const tr = await readTranscript(path.join(dir, asset.transcript!));
    const env = await readEnvelope(path.join(dir, asset.envelope!));
    const plan = await planDecupagem(
      tr.words,
      env,
      asset.duration,
      brief,
      { onStage: (state, message) => store.setActivity(projectId, { state, message: many ? `${asset.name}: ${message}` : message }) },
      { headPad: prof.corte.headPad, tailPad: prof.corte.tailPad, maxPause: prof.corte.maxPause },
    );
    await writeCenters(path.join(dir, asset.transcript!), tr, plan.analysis.centers);
    await fs.writeFile(path.join(dir, asset.id, 'decupagem.json'), JSON.stringify({ decision: plan.decision, keeps: plan.keeps, removals: plan.removals, stats: plan.stats }, null, 2));
    // O que o HUMANO já decidiu sobre esta fala sobrevive à nova decupagem.
    const pins = before.pins.filter((x) => x.assetId === asset.id);
    const humanCuts = before.removals.filter((r) => r.assetId === asset.id && r.by === 'human');
    const zooms = before.main.filter((c) => c.assetId === asset.id && c.zoom).map((c) => ({ in: c.in, out: c.out, zoom: c.zoom! }));
    plans.push({ asset, tr, plan, pins, humanCuts, zooms, removals: subtractPins(plan.removals, pins) });
  }

  const ids = new Set(targets.map((a) => a.id));
  const n = plans.reduce((s, x) => s + x.removals.length, 0);
  await store.transaction(projectId, 'Decupagem automática', async () => {
    // Ponto de partida: cada bruta inteira, na ordem em que chegaram; a fala que não está sendo decupada fica como está.
    const order = p.assets.filter((a) => a.role === 'fala').map((a) => a.id);
    const clips = [
      ...order.flatMap((aid) => (ids.has(aid) ? [{ id: uid('clip'), assetId: aid, in: 0, out: targets.find((a) => a.id === aid)!.duration, by: 'agent' as const, reason: 'bruto' }] : before.main.filter((c) => c.assetId === aid))),
      ...before.main.filter((c) => !order.includes(c.assetId)),
    ];
    store.apply(projectId, {
      by: 'agent',
      op: { type: 'set_main', clips, removals: before.removals.filter((r) => !ids.has(r.assetId)) },
      note: `Comecei a decupagem de ${targets.map((a) => a.name).join(' + ')}`,
    });
    for (const x of plans) store.log(projectId, 'agent', many ? `${x.asset.name}: ${x.plan.decision.summary}` : x.plan.decision.summary);

    // Do começo para o fim, para o avatar andar pra frente. O tempo de timeline de cada corte é
    // calculado no estado atual (já encolhido pelos cortes anteriores).
    const delay = Math.max(60, Math.min(320, 14000 / Math.max(1, n)));
    let i = 0;
    for (const x of plans) {
      for (const r of x.removals) {
        i++;
        const at = sourceToTimeline(store.get(projectId).timeline, x.asset.id, r.start) ?? 0;
        store.setActivity(projectId, { state: 'cutting', message: `${KIND_LABEL[r.kind] ?? 'corte'}: ${r.reason}`, at, progress: i / n });
        await sleep(delay);
        store.apply(projectId, {
          by: 'agent',
          op: { type: 'cut_source', assetId: x.asset.id, in: r.start, out: r.end, kind: r.kind, reason: r.reason },
          note: r.kind === 'silence' ? undefined : `Cortei ${KIND_LABEL[r.kind]} em ${fmtDur(at)} — ${r.reason}`,
        });
      }
    }

    // Reaplica os ajustes manuais.
    for (const x of plans) {
      for (const r of x.humanCuts) store.apply(projectId, { by: 'human', op: { type: 'cut_source', assetId: x.asset.id, in: r.in, out: r.out, kind: r.kind, reason: r.reason } });
      for (const c of store.get(projectId).timeline.main) {
        if (c.assetId !== x.asset.id) continue;
        const mid = (c.in + c.out) / 2;
        const z = x.zooms.find((zz) => mid >= zz.in && mid < zz.out);
        if (z) store.apply(projectId, { by: 'human', op: { type: 'set_zoom', clipId: c.id, zoom: z.zoom } });
      }
    }
  });
  const kept = plans.reduce((s, x) => s + x.pins.length + x.humanCuts.length + x.zooms.length, 0);
  if (kept) store.log(projectId, 'agent', `Mantive ${kept} ajuste(s) seu(s): ${plans.reduce((s, x) => s + x.pins.length, 0)} trecho(s) restaurado(s), ${plans.reduce((s, x) => s + x.humanCuts.length, 0)} corte(s) manual(is), ${plans.reduce((s, x) => s + x.zooms.length, 0)} zoom(s).`);

  for (const x of plans) {
    for (const d of x.plan.decision.doubts) {
      const w = x.tr.words[d.from];
      store.log(projectId, 'agent', `Dúvida${w ? ` em ${fmtDur(w.start)}${many ? ` de ${x.asset.name}` : ' do bruto'}` : ''}: ${d.question}`);
    }
    if (x.plan.uncovered) store.log(projectId, 'agent', `${x.plan.uncovered} palavras${many ? ` de ${x.asset.name}` : ''} ficaram sem decisão do modelo — mantive por segurança.`);
  }

  const sourceDuration = plans.reduce((s, x) => s + x.plan.stats.sourceDuration, 0);
  const resultDuration = timelineDuration(store.get(projectId).timeline);
  // Portão humano: a decupagem vai para a coluna de revisão; a finalização só começa depois da aprovação.
  const prev = store.get(projectId).review;
  stepEnd(projectId, 'decupar');
  store.update(projectId, { status: 'revisao', review: { decupadaEm: new Date().toISOString(), resolvidas: prev?.resolvidas } });
  stepStart(projectId, 'revisao');
  store.setActivity(projectId, { state: 'celebrating', message: `Decupagem pronta: ${fmtDur(sourceDuration)} → ${fmtDur(resultDuration)}, ${n} cortes${many ? `, ${targets.length} brutas` : ''}` });
  store.log(projectId, 'agent', `Decupagem pronta: ${fmtDur(sourceDuration)} → ${fmtDur(resultDuration)} em ${n} cortes${many ? ` (${targets.length} brutas)` : ''}.`);
  const doubts = await reviewDoubts(store.get(projectId)).catch(() => []);
  const decisoes = doubts.filter((d) => d.prioridade === 'alta').length;
  await notify(store.get(projectId), 'revisao', `Decupagem pronta para revisão: ${store.get(projectId).name} — ${fmtDur(resultDuration)}, ${decisoes} decisão(ões) para conferir.`);
  await sleep(2600);
  store.setActivity(projectId, { state: 'idle', message: 'Esperando a sua revisão da decupagem' });
}

/** Tira dos cortes planejados os trechos que o humano mandou manter. */
function subtractPins(removals: PlannedRemoval[], pins: Pin[]): PlannedRemoval[] {
  let out = removals;
  for (const p of pins) {
    out = out.flatMap((r) => {
      if (p.out <= r.start || p.in >= r.end) return [r];
      const parts: PlannedRemoval[] = [];
      if (p.in - r.start > 0.04) parts.push({ ...r, end: p.in });
      if (r.end - p.out > 0.04) parts.push({ ...r, start: p.out });
      return parts;
    });
  }
  return out;
}
