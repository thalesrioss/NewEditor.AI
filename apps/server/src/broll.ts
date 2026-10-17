/**
 * B-roll automático (Cinéfilo): para as frases de imagem forte, busca cenas de filme no clip.cafe, baixa e cobre
 * a frase inteira na V2 — até a cobertura do perfil (padrão da casa: perto de 40%, nunca abaixo de 20%), nunca a
 * mesma cena mais de `maxRepeticao` vezes, e sem cobrir onde já há B-roll ou motion.
 * Fora do gancho (nada antes de 3 s), no máximo 4 s cada, e só clipe com pelo menos 720 px de altura (BL-0018).
 */
import { anchorAt, cutEndAfter, resolveOverlay, sourceToTimeline, timelineDuration, type MediaAsset, type OverlayItem, type Timeline } from '@neweditor/core';
import { beatsForBroll, searchCafe, useCafeClip, type BeatQuery, type CafeClip } from './cinefilo.ts';
import { profileOf } from './profiles.ts';
import { store } from './store.ts';

/** O gancho é o rosto; B-roll curto; clipe borrado (abaixo de 720p recortado para 9:16) não entra. */
export const BROLL_REGRAS = { inicioMinS: 3.0, duracaoMaxS: 4.0, alturaMin: 720 };
/** Quantos clipes baixar por frase, no máximo, procurando um que sirva. */
const MAX_TENTATIVAS = 4;

/**
 * Onde o B-roll de uma frase [tStart, tEnd] (tempo da timeline) entra. Regra do Thales: termina no fim do corte em
 * que está (parar no meio fica mal acabado), então, com o teto de 4 s, ele começa 4 s antes do fim do corte; se
 * assim quase não cobre a frase, começa nela e para em 4 s. Nunca antes de 3 s. null = não cabe.
 */
export function janelaBroll(t: Timeline, tStart: number, tEnd: number, minS: number): { start: number; duration: number } | null {
  const { inicioMinS, duracaoMaxS } = BROLL_REGRAS;
  const ini = Math.max(tStart, inicioMinS);
  if (tEnd - ini < minS) return null;
  const cutEnd = cutEndAfter(t, ini + 0.05);
  let start = Math.max(ini, cutEnd - duracaoMaxS);
  let end = cutEnd;
  if (start > tEnd - minS) {
    start = ini;
    end = Math.min(cutEnd, ini + duracaoMaxS);
  }
  const duration = Math.round(Math.min(duracaoMaxS, end - start) * 1000) / 1000;
  return duration >= minS ? { start, duration } : null;
}

/** Altura de origem desconhecida conta como baixa: melhor sem B-roll do que borrado. */
export const alturaOk = (a: Pick<MediaAsset, 'height'> | undefined) => (a?.height ?? 0) >= BROLL_REGRAS.alturaMin;

/** Dependências de rede (clip.cafe) e da LLM, trocáveis no teste. */
export interface BrollDeps {
  beats: (projectId: string, max: number) => Promise<BeatQuery[]>;
  search: (query: string, limit: number) => Promise<CafeClip[]>;
  use: (projectId: string, clip: CafeClip) => Promise<{ assetId: string }>;
}
const DEPS: BrollDeps = { beats: beatsForBroll, search: searchCafe, use: useCafeClip };

export async function autoBroll(projectId: string, opts: { cobertura?: number; deps?: Partial<BrollDeps> } = {}): Promise<{ colocados: number; cobertura: number; filmes: string[]; motivo?: string }> {
  const deps = { ...DEPS, ...opts.deps };
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

  const beats = await deps.beats(projectId, 12);
  if (!beats.length) return { colocados: 0, cobertura: covered(), filmes: [], motivo: 'nenhuma frase pediu imagem.' };
  const uses = new Map<string, number>();
  for (const o of p.timeline.overlays) if (o.role === 'broll' && o.source.type === 'media') uses.set(o.source.assetId, (uses.get(o.source.assetId) ?? 0) + 1);
  const filmes = new Set<string>();
  let colocados = 0;
  for (const b of beats) {
    if (covered() >= alvo) break;
    const tStart = sourceToTimeline(p.timeline, b.assetId, b.start);
    const tEnd = sourceToTimeline(p.timeline, b.assetId, Math.max(b.start + 0.5, b.end - 0.05));
    if (tStart === null || tEnd === null) continue;
    const janela = janelaBroll(store.get(projectId).timeline, tStart, tEnd, prof.broll.minCoberturaS);
    if (!janela) continue;
    const { start, duration } = janela;
    if (taken.some((x) => start < x.end && start + duration > x.start)) continue;
    store.setActivity(projectId, { state: 'analyzing', message: `Cinéfilo: "${b.fala.slice(0, 48)}…"`, at: start });
    // Candidatos na ordem: filme ainda não usado primeiro; cada um é baixado e conferido (altura, repetição, duração).
    let escolhido: { clip: CafeClip; assetId: string } | undefined;
    let tentativas = 0;
    for (const q of b.queries) {
      if (escolhido || tentativas >= MAX_TENTATIVAS) break;
      const found = (await deps.search(q, 10).catch(() => [] as CafeClip[])).filter((c) => (c.duracao ?? 4) >= duration);
      const ordem = [...found.filter((c) => !filmes.has(c.filme)), ...found.filter((c) => filmes.has(c.filme))];
      for (const clip of ordem) {
        if (tentativas >= MAX_TENTATIVAS) break;
        tentativas++;
        let assetId: string;
        try {
          assetId = (await deps.use(projectId, clip)).assetId;
        } catch {
          continue;
        }
        if ((uses.get(assetId) ?? 0) >= prof.broll.maxRepeticao) continue;
        const asset = store.get(projectId).assets.find((a) => a.id === assetId);
        if (!alturaOk(asset)) {
          store.log(projectId, 'agent', `Cinéfilo: descartei "${clip.filme}" (${asset?.height ?? '?'} px de altura, mínimo ${BROLL_REGRAS.alturaMin}).`);
          continue;
        }
        // O clipe baixado precisa durar a janela inteira (se não chega, pula: melhor sem do que mal acabado).
        if ((asset?.duration ?? 0) < duration - 0.05) continue;
        escolhido = { clip, assetId };
        break;
      }
    }
    if (!escolhido) continue;
    const { clip, assetId } = escolhido;
    const anchor = anchorAt(store.get(projectId).timeline, start);
    if (!anchor) continue;
    const item: Omit<OverlayItem, 'id' | 'by'> = { trackId: 'V2', role: 'broll', anchor, duration, source: { type: 'media', assetId, in: 0 }, reason: `${b.motivo} — ${clip.filme}` };
    store.apply(projectId, { by: 'agent', op: { type: 'add_overlay', item }, note: `B-roll "${clip.filme}" cobrindo "${b.fala.slice(0, 40)}…"` });
    taken.push({ start, end: start + duration });
    placedNow.push({ start, end: start + duration });
    uses.set(assetId, (uses.get(assetId) ?? 0) + 1);
    filmes.add(clip.filme);
    colocados++;
  }
  return { colocados, cobertura: covered(), filmes: [...filmes] };
}
