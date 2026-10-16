/**
 * Benchmark da decupagem contra um corte base aprovado por humano.
 *
 *   npm run bench -w @neweditor/server -- <wav16k> <transcript.json> <gabarito segmap.json> [--cached]
 *
 * Gabarito: lista de [idx, tlIn, tlOut, srcIn, srcOut, dur, texto] (formato do Cérebro do Editor).
 * Por padrão usa o cérebro LOCAL (sem API). --claude usa a API; --cached reaproveita a última decisão
 * do Claude salva ao lado do transcript.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readTranscript } from '../asr.ts';
import { makeEnvelope, readEnvelope } from '../media.ts';
import { analyze, complement, keptRanges, type Range } from './analyze.ts';
import { decide, keepMask, type DecisionResult } from './decide.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cached = process.argv.includes('--cached');
const brain = process.argv.includes('--claude') || cached ? 'claude' : 'local';
const [wav, trPath, gtPath] = args as [string, string, string];
if (!gtPath) {
  console.error('uso: bench <wav16k> <transcript.json> <gabarito.json> [--cached]');
  process.exit(1);
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nebench-'));
await makeEnvelope(wav, tmp);
const env = await readEnvelope(path.join(tmp, 'envelope.f32'));
const tr = await readTranscript(trPath);
const duration = env.length * 0.01;
const an = analyze(tr.words, env);

const decisionPath = trPath.replace(/\.json$/, '.decision.json');
let decision: DecisionResult;
const t0 = Date.now();
if (cached) {
  decision = JSON.parse(await fs.readFile(decisionPath, 'utf8')) as DecisionResult;
} else {
  decision = await decide(tr.words, an, '', brain);
  if (brain === 'claude') await fs.writeFile(decisionPath, JSON.stringify(decision, null, 2));
}
const llmSecs = (Date.now() - t0) / 1000;

const { keep, uncovered } = keepMask(tr.words, decision);
const ours = keptRanges(tr.words, keep, an);
const gtRaw = JSON.parse(await fs.readFile(gtPath, 'utf8')) as [number, number, number, number, number, number, string][];
const gt: Range[] = gtRaw.map((g) => ({ start: g[3], end: g[4] }));

const total = (rs: Range[]) => rs.reduce((a, r) => a + r.end - r.start, 0);
const inter = (a: Range[], b: Range[]) => {
  let s = 0;
  for (const x of a) for (const y of b) s += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
  return s;
};
const I = inter(ours, gt);
const P = I / total(ours);
const R = I / total(gt);
const IoU = I / (total(ours) + total(gt) - I);

// Concordância por palavra (pelo centro sonoro da palavra).
const inside = (rs: Range[], t: number) => rs.some((r) => t >= r.start && t <= r.end);
let agree = 0;
const diffs: string[] = [];
let run: { type: string; words: string[]; t: number } | null = null;
const flush = () => {
  if (run) diffs.push(`  ${run.type} @${run.t.toFixed(2)}s: "${run.words.join(' ')}"`);
  run = null;
};
tr.words.forEach((w, i) => {
  const c = an.centers[i]!;
  const g = inside(gt, c);
  const o = inside(ours, c);
  if (g === o) {
    agree++;
    flush();
    return;
  }
  const type = o ? 'MANTIVEMOS a mais' : 'CORTAMOS a mais';
  if (run && run.type === type) run.words.push(w.w);
  else {
    flush();
    run = { type, words: [w.w], t: w.start };
  }
});
flush();

// Precisão das bordas: para cada borda do gabarito, a borda nossa mais próxima.
const edges = (rs: Range[]) => rs.flatMap((r) => [r.start, r.end]);
const ge = edges(gt);
const oe = edges(ours);
const edgeErr = ge.map((e) => Math.min(...oe.map((x) => Math.abs(x - e)))).filter((d) => d < 0.5);
edgeErr.sort((a, b) => a - b);

console.log(`\n=== DECUPAGEM × GABARITO ===`);
console.log(`fonte ${duration.toFixed(1)}s | nosso ${total(ours).toFixed(1)}s em ${ours.length} trechos | gabarito ${total(gt).toFixed(1)}s em ${gt.length} trechos`);
console.log(`tempo: precisão ${(P * 100).toFixed(1)}% · recall ${(R * 100).toFixed(1)}% · IoU ${(IoU * 100).toFixed(1)}%`);
console.log(`palavras: ${agree}/${tr.words.length} concordam (${((agree / tr.words.length) * 100).toFixed(1)}%) | não cobertas pelo modelo: ${uncovered}`);
console.log(`bordas casadas: ${edgeErr.length}/${ge.length} · erro mediano ${((edgeErr[Math.floor(edgeErr.length / 2)] ?? 0) * 1000).toFixed(0)} ms · p90 ${((edgeErr[Math.floor(edgeErr.length * 0.9)] ?? 0) * 1000).toFixed(0)} ms`);
console.log(`cérebro: ${brain}${cached ? ' (cache)' : ''} · ${llmSecs.toFixed(2)}s · cortes: ${complement(ours, duration).length}`);
console.log(`\ndivergências:\n${diffs.join('\n') || '  nenhuma'}`);
console.log(`\nresumo:\n${decision.summary}`);
if (decision.doubts.length) console.log(`\ndúvidas:\n${decision.doubts.map((d) => `  #${d.from}-${d.to}: ${d.question}`).join('\n')}`);
