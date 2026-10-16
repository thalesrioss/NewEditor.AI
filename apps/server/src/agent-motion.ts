/**
 * Ação do agente: motions narrativos (sem API). Lê a história, escolhe a obra-alvo na biblioteca de
 * referências e coloca os motions na V3 — um passo de desfazer só. Replanejar refaz só o que o agente fez:
 * motion ajustado à mão fica.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { anchorAt, formatTime, MOTION_TEMPLATES, placeWords, resolveOverlay, styleFromReference, timelineDuration, type CueWord, type Project, type TextWord } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { sleep } from './jobs.ts';
import { planMarkdown, planMotions, pickReference, storyReading, type StoryReading } from './motion/plan.ts';
import { getRef, listRefs, type MotionRef } from './motion/refs.ts';
import { store } from './store.ts';

async function timelineWords(p: Project): Promise<CueWord[]> {
  const transcripts: Record<string, TextWord[]> = {};
  for (const a of p.assets) if (a.transcript) transcripts[a.id] = (await readTranscript(path.join(store.dir(p.id), a.transcript))).words;
  return placeWords(p.timeline, transcripts);
}

/** Obra-alvo: a escolhida pelo editor (timeline.motionRef) ou a que melhor serve à história. */
async function targetRef(p: Project, reading: StoryReading, override?: string): Promise<{ ref?: MotionRef; why: string; auto: boolean }> {
  const id = override ?? p.timeline.motionRef;
  if (id) {
    const ref = await getRef(id);
    if (ref) return { ref, why: override ? 'escolhida por você' : 'obra-alvo definida para este vídeo', auto: false };
  }
  return { ...pickReference((await listRefs()).filter((r) => r.uso !== 'lettering'), reading), auto: true };
}

export async function readStory(projectId: string): Promise<{ reading: StoryReading; ref?: { id: string; obra: string; why: string; auto: boolean } }> {
  const p = store.get(projectId);
  const words = await timelineWords(p);
  if (!words.length) throw Object.assign(new Error('não há fala transcrita na timeline'), { statusCode: 409 });
  const reading = storyReading(words, timelineDuration(p.timeline));
  const t = await targetRef(p, reading);
  return { reading, ref: t.ref ? { id: t.ref.id, obra: t.ref.obra, why: t.why, auto: t.auto } : undefined };
}

export async function autoMotions(projectId: string, opts: { refId?: string } = {}): Promise<number> {
  const p = store.get(projectId);
  const words = await timelineWords(p);
  if (!words.length) throw new Error('não há fala transcrita na timeline');
  const total = timelineDuration(p.timeline);

  store.setActivity(projectId, { state: 'thinking', message: 'Lendo a história inteira (gancho, virada, tese)' });
  await sleep(700);
  const reading = storyReading(words, total);
  const target = await targetRef(p, reading, opts.refId);
  store.setActivity(projectId, { state: 'thinking', message: target.ref ? `Obra-alvo: ${target.ref.obra}` : 'Sem referências — estilo da casa' });
  await sleep(600);

  const tl = p.timeline;
  const placed = tl.overlays.map((o) => ({ o, pos: resolveOverlay(tl, o) })).filter((x) => x.pos);
  const mine = placed.filter(({ o }) => o.role === 'motion' && o.by === 'agent' && o.source.type === 'motion');
  const blocked = placed.filter(({ o }) => o.role === 'broll' || (o.role === 'motion' && o.by !== 'agent') || (o.role === 'lettering' && o.by === 'human')).map(({ pos }) => pos!);
  const replaceable = placed.filter(({ o }) => o.role === 'lettering' && o.by !== 'human').map(({ o, pos }) => ({ id: o.id, ...pos! }));
  const plan = planMotions({ words, total, ref: target.ref, blocked, replaceable });

  await store.transaction(projectId, `Motions narrativos (${plan.motions.length})`, async () => {
    if (target.ref && store.get(projectId).timeline.motionRef !== target.ref.id) store.apply(projectId, { by: 'agent', op: { type: 'set_motion_ref', refId: target.ref.id } });
    for (const { o } of mine) store.apply(projectId, { by: 'agent', op: { type: 'remove_overlay', id: o.id } });
    for (const m of plan.motions) {
      for (const id of m.replaces) {
        if (!store.get(projectId).timeline.overlays.some((o) => o.id === id)) continue;
        store.apply(projectId, { by: 'agent', op: { type: 'remove_overlay', id }, note: `Lettering virou motion em ${formatTime(m.start)}` });
      }
      const anchor = anchorAt(store.get(projectId).timeline, m.start);
      if (!anchor) continue;
      const label = MOTION_TEMPLATES[m.spec.template].label;
      store.setActivity(projectId, { state: 'motion', message: `${label}: "${m.spec.texts.slice(0, 6).join(' ')}"`, at: m.start });
      await sleep(650);
      store.apply(projectId, {
        by: 'agent',
        op: { type: 'add_overlay', item: { trackId: 'V3', role: 'motion', anchor, duration: Math.max(1, m.end - m.start), source: { type: 'motion', motion: m.spec }, reason: m.spec.ideia } },
        note: `Motion ${label} em ${formatTime(m.start)}${m.papel ? ` (${m.papel})` : ''} — ${m.spec.ideia}`,
      });
    }
  });
  // MOTION_SPEC do vídeo em .md: o mesmo contrato do Motion Studio, para produzir a versão final lá se quiser.
  await fs.writeFile(path.join(store.dir(projectId), 'motions.md'), planMarkdown(p.name, plan, target.ref, target.why, (t) => formatTime(t)));
  store.setActivity(projectId, { state: 'celebrating', message: `${plan.motions.length} motions contando a história` });
  setTimeout(() => store.setActivity(projectId, { state: 'idle', message: 'Pronto' }), 2200);
  return plan.motions.length;
}

/** Troca a obra-alvo do vídeo e veste todos os motions com a paleta/matéria dela (um passo de desfazer). */
export async function useReference(projectId: string, refId: string): Promise<number> {
  const ref = await getRef(refId);
  if (!ref) throw Object.assign(new Error('referência não existe'), { statusCode: 404 });
  const style = styleFromReference(ref.paleta, ref.familias);
  const motions = store.get(projectId).timeline.overlays.filter((o) => o.source.type === 'motion');
  await store.transaction(projectId, `Obra-alvo: ${ref.obra}`, async () => {
    store.apply(projectId, { by: 'human', op: { type: 'set_motion_ref', refId: ref.id }, note: `Obra-alvo dos motions: ${ref.obra}` });
    for (const o of motions) {
      if (o.source.type !== 'motion') continue;
      // 'system' não muda o dono: motion do agente continua replanejável.
      store.apply(projectId, { by: 'system', op: { type: 'set_overlay_motion', id: o.id, motion: { ...o.source.motion, style, refId: ref.id, refName: ref.obra } } });
    }
  });
  return motions.length;
}
