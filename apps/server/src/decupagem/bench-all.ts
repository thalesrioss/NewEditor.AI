/**
 * Roda o cérebro local em TODOS os gabaritos (data/benchmark) e imprime a tabela — IoU de tempo, palavras iguais,
 * segundos cortados a mais e deixados passar — com a diferença para a rodada anterior.
 *
 *   npm run bench:all -w @neweditor/server
 *   npm run bench:all -w @neweditor/server -- --tune [--apply]   # calibra as folgas de corte por perfil
 */
import { readTranscript } from '../asr.ts';
import { appendResult, listGabaritos, previousResult, rangeIou, type BenchResult, type Gabarito } from '../benchmark.ts';
import { readEnvelope } from '../media.ts';
import { getProfile, patchProfile } from '../profiles.ts';
import { analyze, keptRanges, type BorderOptions } from './analyze.ts';
import { keepMask } from './decide.ts';
import { decideLocal } from './local.ts';

const args = process.argv.slice(2);
const tune = args.includes('--tune');
const apply = args.includes('--apply');

interface Loaded {
  g: Gabarito;
  assets: { id: string; words: Awaited<ReturnType<typeof readTranscript>>['words']; env: Float32Array; duration: number; approved: { in: number; out: number }[] }[];
}

async function load(g: Gabarito): Promise<Loaded> {
  const assets = [];
  for (const a of g.assets) {
    try {
      const tr = await readTranscript(a.transcript);
      const env = await readEnvelope(a.envelope);
      assets.push({ id: a.id, words: tr.words, env, duration: a.duration, approved: g.kept[a.id] ?? [] });
    } catch (e) {
      console.warn(`  (pulei ${a.name}: ${(e as Error).message})`);
    }
  }
  return { g, assets };
}

function evaluate(l: Loaded, border: Partial<BorderOptions>): Omit<BenchResult, 'at' | 'projectId' | 'name' | 'label' | 'profileId'> & { diffs: { kind: 'cortouDemais' | 'deixouPassar'; in: number; out: number; text: string }[] } {
  let inter = 0;
  let union = 0;
  let agree = 0;
  let n = 0;
  let onlyAgent = 0;
  let onlyHuman = 0;
  const diffs: { kind: 'cortouDemais' | 'deixouPassar'; in: number; out: number; text: string }[] = [];
  for (const a of l.assets) {
    const an = analyze(a.words, a.env);
    const decision = decideLocal(a.words, an);
    const { keep } = keepMask(a.words, decision);
    const ranges = keptRanges(a.words, keep, an, border).map((r) => ({ in: r.start, out: r.end }));
    const r = rangeIou(ranges, a.approved);
    const la = ranges.reduce((s, x) => s + x.out - x.in, 0);
    const lb = a.approved.reduce((s, x) => s + x.out - x.in, 0);
    const i = (r.iou * (la + lb)) / (1 + r.iou);
    inter += i;
    union += la + lb - i;
    onlyAgent += r.onlyA;
    onlyHuman += r.onlyB;
    const inR = (t: number, rs: { in: number; out: number }[]) => rs.some((x) => t >= x.in && t <= x.out);
    // Palavra a palavra: concorda?
    let run: { kind: 'cortouDemais' | 'deixouPassar'; in: number; out: number; words: string[] } | null = null;
    a.words.forEach((w, k) => {
      const c = an.centers[k] ?? (w.start + w.end) / 2;
      const ag = inR(c, ranges);
      const hu = inR(c, a.approved);
      n++;
      if (ag === hu) {
        if (run) (diffs.push({ ...run, text: run.words.join(' ') }), (run = null));
        agree++;
        return;
      }
      const kind = hu && !ag ? 'cortouDemais' : 'deixouPassar';
      if (run && run.kind === kind && w.start - run.out < 1.5) (run.out = w.end), run.words.push(w.w);
      else {
        if (run) diffs.push({ ...run, text: run.words.join(' ') });
        run = { kind, in: w.start, out: w.end, words: [w.w] };
      }
    });
    if (run) diffs.push({ ...(run as object), text: (run as { words: string[] }).words.join(' ') } as (typeof diffs)[number]);
  }
  return { iou: union > 0 ? inter / union : 1, words: n ? agree / n : 1, cortouDemais: onlyHuman, deixouPassar: onlyAgent, diffs };
}

const gabaritos = await listGabaritos();
if (!gabaritos.length) {
  console.log('Nenhum gabarito ainda. Aprove uma decupagem na revisão (ou entregue um projeto) e ele aparece em data/benchmark.');
  process.exit(0);
}
const loaded: Loaded[] = [];
for (const g of gabaritos) loaded.push(await load(g));

if (tune) {
  // Grade de folgas por perfil: maximiza a média de IoU dos gabaritos daquele perfil.
  const byProfile = new Map<string, Loaded[]>();
  for (const l of loaded) byProfile.set(l.g.profileId ?? 'casa', [...(byProfile.get(l.g.profileId ?? 'casa') ?? []), l]);
  for (const [pid, ls] of byProfile) {
    const prof = await getProfile(pid);
    const base = { headPad: prof.corte.headPad, tailPad: prof.corte.tailPad, maxPause: prof.corte.maxPause };
    const score = (b: Partial<BorderOptions>) => ls.reduce((s, l) => s + evaluate(l, b).iou, 0) / ls.length;
    let best = { b: base, s: score(base) };
    const s0 = best.s;
    for (const headPad of [0.02, 0.04, 0.06, 0.08, 0.1, 0.12])
      for (const tailPad of [0.04, 0.08, 0.1, 0.14, 0.18, 0.24])
        for (const maxPause of [0.15, 0.2, 0.3, 0.4, 0.5, 0.7]) {
          const b = { headPad, tailPad, maxPause };
          const s = score(b);
          if (s > best.s + 1e-6) best = { b, s };
        }
    console.log(`perfil ${pid} (${ls.length} gabarito(s)): IoU ${(s0 * 100).toFixed(2)}% → ${(best.s * 100).toFixed(2)}% com headPad ${best.b.headPad} · tailPad ${best.b.tailPad} · maxPause ${best.b.maxPause}`);
    if (apply && best.s > s0 + 0.001) {
      await patchProfile(pid === 'casa' ? 'casa' : pid, { corte: { ...prof.corte, ...best.b }, evidencia: { 'corte.folgas': 'MEDIDO' } });
      console.log(`  → gravado no perfil ${pid}`);
    }
  }
  process.exit(0);
}

console.log('\n=== BENCHMARK DA DECUPAGEM (cérebro local) ===');
console.log('projeto                                  | gab.     | IoU     | palavras | cortou+ | passou  | Δ IoU');
for (const l of loaded) {
  const prof = await getProfile(l.g.profileId);
  const r = evaluate(l, { headPad: prof.corte.headPad, tailPad: prof.corte.tailPad, maxPause: prof.corte.maxPause });
  const prev = await previousResult(l.g.projectId, l.g.label);
  const delta = prev ? `${r.iou - prev.iou >= 0 ? '+' : ''}${((r.iou - prev.iou) * 100).toFixed(2)}` : 'novo';
  console.log(`${l.g.name.slice(0, 40).padEnd(40)} | ${l.g.label.padEnd(8)} | ${(r.iou * 100).toFixed(2).padStart(6)}% | ${(r.words * 100).toFixed(1).padStart(7)}% | ${r.cortouDemais.toFixed(1).padStart(6)}s | ${r.deixouPassar.toFixed(1).padStart(6)}s | ${delta}`);
  const top = r.diffs.sort((a, b) => b.out - b.in - (a.out - a.in)).slice(0, 4);
  for (const d of top) console.log(`    ${d.kind === 'cortouDemais' ? '✂ cortou demais' : '… deixou passar'} ${(d.out - d.in).toFixed(1)}s @${Math.floor(d.in / 60)}:${String(Math.floor(d.in % 60)).padStart(2, '0')}: "${d.text.slice(0, 90)}"`);
  await appendResult({ projectId: l.g.projectId, name: l.g.name, label: l.g.label, profileId: l.g.profileId, iou: r.iou, words: r.words, cortouDemais: r.cortouDemais, deixouPassar: r.deixouPassar, at: new Date().toISOString() });
}
