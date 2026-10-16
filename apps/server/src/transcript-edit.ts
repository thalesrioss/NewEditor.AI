/**
 * Edição pela transcrição (estilo Descript): o humano seleciona palavras e apaga.
 * As bordas do corte saem da forma de onda (mesma lógica da decupagem), não do tempo do ASR.
 */
import path from 'node:path';
import { readTranscript } from './asr.ts';
import { analyze, complement, keptRanges } from './decupagem/analyze.ts';
import { readEnvelope } from './media.ts';
import { store } from './store.ts';

async function load(projectId: string, assetId: string) {
  const p = store.get(projectId);
  const a = p.assets.find((x) => x.id === assetId);
  if (!a?.transcript || !a.envelope) throw Object.assign(new Error('material sem transcrição'), { statusCode: 409 });
  const tr = await readTranscript(path.join(store.dir(projectId), a.transcript));
  const env = await readEnvelope(path.join(store.dir(projectId), a.envelope));
  return { a, tr, an: analyze(tr.words, env) };
}

export async function cutWords(projectId: string, assetId: string, from: number, to: number) {
  const { a, tr, an } = await load(projectId, assetId);
  const words = tr.words;
  if (from < 0 || to >= words.length) throw Object.assign(new Error('palavras fora do intervalo'), { statusCode: 400 });
  // Mantém tudo menos a seleção, sem encurtar pausas — só queremos as bordas medidas em volta dela.
  const keep = words.map((_, i) => i < from || i > to);
  const keeps = keptRanges(words, keep, an, { maxPause: Infinity });
  const lo = an.centers[from]!;
  const hi = an.centers[to]!;
  const gap = complement(keeps, a.duration).find((r) => r.end > lo && r.start < hi);
  if (!gap) return { ok: false };
  const text = words.slice(from, to + 1).map((w) => w.w).join(' ');
  store.apply(projectId, {
    by: 'human',
    op: { type: 'cut_source', assetId, in: gap.start, out: gap.end, kind: 'manual', reason: `apagado na transcrição: "${text}"` },
    note: `Apagou "${text.length > 60 ? text.slice(0, 57) + '…' : text}"`,
  });
  return { ok: true, in: gap.start, out: gap.end };
}

/** Restaura todo trecho cortado que toca as palavras selecionadas. */
export async function restoreWords(projectId: string, assetId: string, from: number, to: number) {
  const { an } = await load(projectId, assetId);
  const lo = an.centers[from]!;
  const hi = an.centers[to]!;
  const targets = store.get(projectId).timeline.removals.filter((r) => r.assetId === assetId && r.out > lo - 0.01 && r.in < hi + 0.01);
  if (!targets.length) return { ok: false };
  await store.transaction(projectId, `Restaurar ${targets.length} trecho(s)`, async () => {
    for (const r of targets) store.apply(projectId, { by: 'human', op: { type: 'restore', removalId: r.id } });
  });
  store.log(projectId, 'human', `Restaurou ${targets.length} trecho(s) pela transcrição`);
  return { ok: true, restored: targets.length };
}
