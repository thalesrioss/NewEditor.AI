/**
 * Lettering automático (sem API): palavras-chave viram lettering animado no lugar da legenda, no estilo da
 * referência de lettering escolhida para o vídeo. Replanejar refaz só o que o agente fez.
 */
import path from 'node:path';
import { anchorAt, LETTERING_STYLES, letteringFromText, placeWords, resolveOverlay, timelineDuration, type LetteringStyleId, type TextWord } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { sleep } from './jobs.ts';
import { planLetterings, type LetteringAmount } from './lettering.ts';
import { getRef } from './motion/refs.ts';
import { store } from './store.ts';

export const DEFAULT_LETTERING_STYLE: LetteringStyleId = 'auto-serifa';

/** Estilo + cor do vídeo: os da referência de lettering escolhida (ou o padrão Auto · Serifa itálica). */
async function videoStyle(projectId: string): Promise<{ estilo: LetteringStyleId; accent?: string; refId?: string; refName?: string }> {
  const id = store.get(projectId).timeline.letteringRef;
  const ref = id ? await getRef(id) : undefined;
  const estilo = ref?.estilo && ref.estilo in LETTERING_STYLES ? (ref.estilo as LetteringStyleId) : DEFAULT_LETTERING_STYLE;
  return { estilo, accent: ref?.accent, refId: ref?.id, refName: ref?.obra };
}

export async function autoLettering(projectId: string, amount: LetteringAmount = 'medio'): Promise<number> {
  const p = store.get(projectId);
  const transcripts: Record<string, TextWord[]> = {};
  for (const a of p.assets) if (a.transcript) transcripts[a.id] = (await readTranscript(path.join(store.dir(projectId), a.transcript))).words;
  const words = placeWords(p.timeline, transcripts);
  if (!words.length) throw new Error('não há fala transcrita na timeline');

  store.setActivity(projectId, { state: 'thinking', message: 'Procurando as palavras-chave de cada frase' });
  await sleep(600);
  const style = await videoStyle(projectId);
  const tl = p.timeline;
  const placed = tl.overlays.map((o) => ({ o, pos: resolveOverlay(tl, o) })).filter((x) => x.pos);
  const mine = placed.filter(({ o }) => o.role === 'lettering' && o.by !== 'human');
  const human = placed.filter(({ o }) => o.role === 'lettering' && o.by === 'human');
  const plan = planLetterings({
    words,
    total: timelineDuration(tl),
    ...style,
    amount,
    blocked: [...placed.filter(({ o }) => o.role === 'motion'), ...human].map(({ pos }) => pos!),
    existing: human.map(({ o }) => (o.source.type === 'lettering' ? o.source.lettering.words.filter((w) => w.destaque).map((w) => w.text).join(' ') : o.source.type === 'text' ? o.source.text.replace(/\*/g, '') : '')),
  });

  await store.transaction(projectId, `Lettering automático (${plan.length})`, async () => {
    for (const { o } of mine) store.apply(projectId, { by: 'agent', op: { type: 'remove_overlay', id: o.id } });
    for (const l of plan) {
      const anchor = anchorAt(store.get(projectId).timeline, l.start);
      if (!anchor) continue;
      store.setActivity(projectId, { state: 'motion', message: `Lettering: ${l.key}`, at: l.start });
      await sleep(320);
      store.apply(projectId, {
        by: 'agent',
        op: { type: 'add_overlay', item: { trackId: 'V3', role: 'lettering', anchor, duration: l.end - l.start, source: { type: 'lettering', lettering: l.spec }, reason: l.spec.motivo } },
        note: `Lettering "${l.key}" — ${l.spec.motivo}`,
      });
    }
  });
  store.setActivity(projectId, { state: 'celebrating', message: `${plan.length} letterings no lugar da legenda` });
  setTimeout(() => store.setActivity(projectId, { state: 'idle', message: 'Pronto' }), 2200);
  return plan.length;
}

/** Troca a referência de lettering do vídeo e veste todos os letterings com o estilo dela (um passo de desfazer). */
export async function useLetteringRef(projectId: string, refId: string): Promise<number> {
  const ref = await getRef(refId);
  if (!ref) throw Object.assign(new Error('referência não existe'), { statusCode: 404 });
  const estilo = ref.estilo && ref.estilo in LETTERING_STYLES ? (ref.estilo as LetteringStyleId) : DEFAULT_LETTERING_STYLE;
  const all = store.get(projectId).timeline.overlays.filter((o) => o.role === 'lettering');
  await store.transaction(projectId, `Lettering: ${ref.obra}`, async () => {
    store.apply(projectId, { by: 'human', op: { type: 'set_lettering_ref', refId: ref.id }, note: `Estilo de lettering: ${ref.obra}` });
    for (const o of all) {
      const spec = o.source.type === 'lettering' ? o.source.lettering : o.source.type === 'text' ? letteringFromText(o.source.text) : undefined;
      if (!spec) continue;
      store.apply(projectId, { by: 'system', op: { type: 'set_overlay_lettering', id: o.id, lettering: { ...spec, estilo, accent: ref.accent, refId: ref.id, refName: ref.obra } } });
    }
  });
  return all.length;
}
