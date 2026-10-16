/**
 * B-roll automático (Cinéfilo): para as frases de imagem forte, busca cenas de filme no clip.cafe, baixa e cobre
 * a frase inteira na V2 — até a cobertura do perfil (padrão da casa: perto de 40%, nunca abaixo de 20%), nunca a
 * mesma cena mais de `maxRepeticao` vezes, e sem cobrir onde já há B-roll ou motion.
 */
import { anchorAt, cutEndAfter, resolveOverlay, sourceToTimeline, timelineDuration, type OverlayItem } from '@neweditor/core';
import { beatsForBroll, searchCafe, useCafeClip, type CafeClip } from './cinefilo.ts';
import { profileOf } from './profiles.ts';
import { store } from './store.ts';

export async function autoBroll(projectId: string, opts: { cobertura?: number } = {}): Promise<{ colocados: number; cobertura: number; filmes: string[]; motivo?: string }> {
  const p = store.get(projectId);
  const prof = await profileOf(p);
  const total = timelineDuration(p.timeline);
  const alvo = Math.max(0.2, Math.min(0.6, opts.cobertura ?? 0.4));
  // O que já cobre a tela (B-roll e motion existentes) conta para a cobertura e bloqueia o espaço.
  const taken = p.timeline.overlays
    .filter((o) => o.role === 'broll' || o.role === 'motion')
    .map((o) => resolveOverlay(p.timeline, o))
    .filter((x): x is { start: number; end: number } => !!x);
  const brollOnly = () => p.timeline.overlays.filter((o) => o.role === 'broll').map((o) => resolveOverlay(p.timeline, o)).filter((x): x is { start: number; end: number } => !!x);
  const placedNow: { start: number; end: number }[] = [];
  const covered = () => [...brollOnly(), ...placedNow].reduce((s, x) => s + Math.max(0, x.end - x.start), 0) / Math.max(1, total);
  if (covered() >= alvo) return { colocados: 0, cobertura: covered(), filmes: [], motivo: 'a peça já tem cobertura suficiente.' };

  const beats = await beatsForBroll(projectId, 12);
  if (!beats.length) return { colocados: 0, cobertura: covered(), filmes: [], motivo: 'nenhuma frase pediu imagem.' };
  const uses = new Map<string, number>();
  for (const o of p.timeline.overlays) if (o.role === 'broll' && o.source.type === 'media') uses.set(o.source.assetId, (uses.get(o.source.assetId) ?? 0) + 1);
  const filmes = new Set<string>();
  let colocados = 0;
  for (const b of beats) {
    if (covered() >= alvo) break;
    const tStart = sourceToTimeline(p.timeline, b.assetId, b.start);
    const tEnd = sourceToTimeline(p.timeline, b.assetId, Math.max(b.start + 0.5, b.end - 0.05));
    if (tStart === null || tEnd === null || tEnd - tStart < prof.broll.minCoberturaS) continue;
    if (taken.some((x) => tStart < x.end && tEnd > x.start)) continue;
    store.setActivity(projectId, { state: 'analyzing', message: `Cinéfilo: "${b.fala.slice(0, 48)}…"`, at: tStart });
    // Regra do Thales: o B-roll vai até o fim do corte em que está (parar no meio fica mal acabado).
    const cutEnd = cutEndAfter(p.timeline, tStart + 0.05);
    const need = cutEnd - tStart;
    if (need < prof.broll.minCoberturaS || need > 14) continue;
    let clip: CafeClip | undefined;
    for (const q of b.queries) {
      const found = await searchCafe(q, 10).catch(() => []);
      clip = found.find((c) => (c.duracao ?? 4) >= need && !filmes.has(c.filme)) ?? found.find((c) => (c.duracao ?? 4) >= need);
      if (clip) break;
    }
    if (!clip) continue;
    let assetId: string;
    try {
      assetId = (await useCafeClip(projectId, clip)).assetId;
    } catch {
      continue;
    }
    if ((uses.get(assetId) ?? 0) >= prof.broll.maxRepeticao) continue;
    const asset = store.get(projectId).assets.find((a) => a.id === assetId);
    // Até o fim do corte, limitado pelo clipe baixado (se não chega, pula: melhor sem do que mal acabado).
    if ((asset?.duration ?? 0) < need - 0.05) continue;
    const duration = need;
    const anchor = anchorAt(store.get(projectId).timeline, tStart);
    if (!anchor) continue;
    const item: Omit<OverlayItem, 'id' | 'by'> = { trackId: 'V2', role: 'broll', anchor, duration, source: { type: 'media', assetId, in: 0 }, reason: `${b.motivo} — ${clip.filme}` };
    store.apply(projectId, { by: 'agent', op: { type: 'add_overlay', item }, note: `B-roll "${clip.filme}" cobrindo "${b.fala.slice(0, 40)}…"` });
    taken.push({ start: tStart, end: tStart + duration });
    placedNow.push({ start: tStart, end: tStart + duration });
    uses.set(assetId, (uses.get(assetId) ?? 0) + 1);
    filmes.add(clip.filme);
    colocados++;
  }
  return { colocados, cobertura: covered(), filmes: [...filmes] };
}
