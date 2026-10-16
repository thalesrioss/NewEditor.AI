/**
 * Ritmo e retenção (ADR-007 I-8 / canvas "quebra de padrão"): nada de trecho parado. Mede os eventos da
 * peça (cortes, zooms, letterings, motions, B-roll) e, onde fica monótono, coloca cut zooms nas ênfases —
 * dentro da faixa do perfil, na quantidade do perfil, nunca dois valores iguais seguidos (regra do Thales).
 */
import { clipDuration, clipStarts, resolveOverlay, type ClientProfile, type Project } from '@neweditor/core';
import { loadTranscripts } from './actions.ts';
import { profileOf } from './profiles.ts';
import { store } from './store.ts';

/** Instantes em que algo muda na tela. */
export function events(p: Project): number[] {
  const tl = p.timeline;
  const starts = clipStarts(tl);
  const out = new Set<number>();
  tl.main.forEach((c, i) => {
    if (i > 0) out.add(starts[i]!);
    if (c.zoom && c.zoom > 1) out.add(starts[i]!);
  });
  for (const o of tl.overlays) {
    const pos = resolveOverlay(tl, o);
    if (pos) out.add(pos.start);
  }
  return [...out].sort((a, b) => a - b);
}

/** Trechos sem evento por mais de `max` s. */
export function monotonous(p: Project, max: number): { start: number; end: number }[] {
  const ev = events(p);
  const total = p.timeline.main.reduce((s, c) => s + clipDuration(c), 0);
  const pts = [0, ...ev, total];
  const out: { start: number; end: number }[] = [];
  for (let i = 1; i < pts.length; i++) if (pts[i]! - pts[i - 1]! > max) out.push({ start: pts[i - 1]!, end: pts[i]! });
  return out;
}

/** Palavras de ênfase (soco, número, emoção) no tempo da timeline. */
const PUNCH = /^(nunca|nada|tudo|sempre|jamais|ninguém|verdade|verdadeira|realmente|exatamente|pior|melhor|único|única|impossível|segredo|resposta|problema|diferença|não|sim|mas|porque|é)$/i;

/**
 * Regra do Thales (2026-10-11): onde não há lettering, motion nem B-roll, o corte leva cut zoom — alternando
 * zoom in e zoom out (volta a 1,0), ciclando os valores do perfil sem repetir; clipes longos ganham um zoom lento.
 * O que o humano já ajustou (zoom dele) fica.
 */
export async function autoZooms(projectId: string, opts: { max?: number } = {}): Promise<number> {
  const p = store.get(projectId);
  const prof: ClientProfile = await profileOf(p);
  const tl = p.timeline;
  const starts = clipStarts(tl);
  const covered = tl.overlays
    .filter((o) => o.role === 'lettering' || o.role === 'motion' || o.role === 'broll')
    .map((o) => resolveOverlay(tl, o))
    .filter((x): x is { start: number; end: number } => !!x);
  const values = [prof.zoom.min, (prof.zoom.min + prof.zoom.max) / 2, prof.zoom.max].map((z) => Math.round(z * 1000) / 1000);
  let last = 0;
  let prevIn = false; // o clipe livre anterior levou zoom in? então este leva zoom out (1,0)
  let n = 0;
  // Um clipe está "sem nada" quando nenhuma camada cobre mais de 1/3 dele.
  const free = tl.main.map((c, i) => {
    const s = starts[i]!;
    const e = s + clipDuration(c);
    const cov = covered.reduce((a, x) => a + Math.max(0, Math.min(e, x.end) - Math.max(s, x.start)), 0);
    return cov < (e - s) / 3;
  });
  await store.transaction(projectId, 'Cut zooms nos trechos sem camada', async () => {
    tl.main.forEach((c, i) => {
      if (!free[i] || clipDuration(c) < 1.0) return;
      // alterna: zoom in (valor do perfil, nunca o mesmo do anterior) / zoom out (volta a 1,0)
      let z = 1;
      if (!prevIn) { const choices = values.filter((v) => v !== last); z = choices[n % choices.length]!; }
      const dur = clipDuration(c);
      const op = z > 1 && dur >= 4 ? { type: 'set_zoom' as const, clipId: c.id, zoom: z, zoomTo: Math.min(prof.zoom.max, z + 0.04) } : { type: 'set_zoom' as const, clipId: c.id, zoom: z };
      store.apply(projectId, { by: 'agent', op, note: z > 1 ? `Cut zoom in ${z}× em ${fmt(starts[i]!)}${dur >= 4 ? ' (lento)' : ''}` : `Cut zoom out em ${fmt(starts[i]!)}` });
      last = z > 1 ? z : last;
      prevIn = z > 1;
      n++;
    });
  });
  if (n) return n;
  // Sem trecho livre: a regra antiga (ênfases onde a peça ficou parada).
  const total = tl.main.reduce((s, c) => s + clipDuration(c), 0);
  const trs = await loadTranscripts(p);
  const gapMax = Math.max(4, Math.min(9, (prof.corte.clipeMedianaS ?? 3) * 2.2));
  const gaps = monotonous(p, gapMax);
  const budget = Math.max(0, Math.round((prof.zoom.porMinuto * total) / 60) - tl.main.filter((c) => c.zoom && c.zoom > 1).length);
  const want = Math.min(budget, opts.max ?? 99, gaps.length);
  if (want <= 0) return 0;
  // Valores da faixa do perfil, ciclando sem repetir o anterior.
  let last2 = tl.main.map((c) => c.zoom).filter(Boolean).pop() ?? 0;
  let n2 = 0;
  for (const g of gaps.slice(0, want)) {
    // Dentro do trecho monótono, o clipe que tem a palavra mais forte.
    let best: { idx: number; score: number; word: string } | null = null;
    tl.main.forEach((c, i) => {
      const s = starts[i]!;
      const e = s + clipDuration(c);
      if (e <= g.start || s >= g.end || (c.zoom && c.zoom > 1)) return;
      const words = trs.get(c.assetId)?.words.filter((w) => w.start >= c.in && w.start < c.out) ?? [];
      let score = 0;
      let word = '';
      for (const w of words) {
        const t = w.w.replace(/[^\p{L}\p{N}]/gu, '');
        const sc = (PUNCH.test(t) ? 2 : 0) + (/\d/.test(t) ? 2 : 0) + (/[!?]$/.test(w.w) ? 1 : 0) + (t.length >= 8 ? 0.5 : 0);
        if (sc > score) ((score = sc), (word = w.w));
      }
      // Clipe no meio do trecho vale mais que nas bordas (a quebra cai onde a monotonia pesa).
      const mid = 1 - Math.abs((s + e) / 2 - (g.start + g.end) / 2) / ((g.end - g.start) / 2 + 0.01);
      score += mid;
      if (!best || score > best.score) best = { idx: i, score, word };
    });
    if (!best) continue;
    const choices = values.filter((z) => z !== last2);
    const z = choices[n2 % choices.length]!;
    last2 = z;
    const clip = tl.main[(best as { idx: number }).idx]!;
    store.apply(projectId, { by: 'agent', op: { type: 'set_zoom', clipId: clip.id, zoom: z }, note: `Cut zoom ${z}× em ${fmt(starts[(best as { idx: number }).idx]!)} — quebra de padrão${(best as { word: string }).word ? ` na ênfase "${(best as { word: string }).word}"` : ''}` });
    n2++;
  }
  return n2;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Flash onde o padrão do Thales põe flash: em cima de um corte, quando a emenda apareceria — troca de arquivo
 * numa fronteira de bloco (sempre) e salto longo na mesma fonte (os maiores). Não acompanha o zoom.
 * Fica em ~15% dos cortes, como na peça medida; o resto é escolha dele.
 */
export async function autoFlashes(projectId: string): Promise<number> {
  const p = store.get(projectId);
  const prof = await profileOf(p);
  if (!prof.flash.usar) return 0;
  const tl = p.timeline;
  const clips = tl.main;
  if (clips.length < 3) return 0;
  const wantFile = prof.flash.onde.includes('troca-de-arquivo');
  const wantJump = prof.flash.onde.includes('salto-longo');
  const wantZoom = prof.flash.onde.includes('entrada-zoom');
  const jumps = clips.slice(1).map((c, i) => (clips[i]!.assetId === c.assetId ? c.in - clips[i]!.out : 0)).filter((j) => j > 0.05).sort((a, b) => a - b);
  const median = jumps[jumps.length >> 1] ?? 0;
  const budget = Math.max(1, Math.round(clips.length * 0.15));
  const picks: { i: number; score: number }[] = [];
  clips.forEach((c, i) => {
    if (i === 0 || c.flash) return;
    const prev = clips[i - 1]!;
    if (wantFile && prev.assetId !== c.assetId) return picks.push({ i, score: 100 });
    if (wantZoom && c.zoom && c.zoom > 1 && !(prev.zoom && prev.zoom > 1)) return picks.push({ i, score: 50 });
    const jump = prev.assetId === c.assetId ? c.in - prev.out : 0;
    if (wantJump && median > 0 && jump > median * 1.6) picks.push({ i, score: jump / median });
  });
  const chosen = picks.sort((a, b) => b.score - a.score).slice(0, budget).sort((a, b) => a.i - b.i);
  // Nunca dois flashes colados (< 2 s).
  const starts = clipStarts(tl);
  let last = -9;
  let n = 0;
  for (const { i } of chosen) {
    if (starts[i]! - last < 2) continue;
    last = starts[i]!;
    store.apply(projectId, { by: 'agent', op: { type: 'set_flash', clipId: clips[i]!.id, on: true }, note: `Flash em ${fmt(starts[i]!)} — ${clips[i - 1]!.assetId !== clips[i]!.assetId ? 'troca de arquivo' : 'salto longo na fonte'}` });
    n++;
  }
  return n;
}
