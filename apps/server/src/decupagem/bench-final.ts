/**
 * Benchmark contra a PEÇA PUBLICADA (quando não há corte base aprovado, só o vídeo final).
 *
 *   npm run bench:final -w @neweditor/server -- <wav16k> <transcript.json> <segments.json da peça final>
 *
 * A peça final passou por corte editorial, então não é gabarito exato do corte base. Mede o que a
 * decupagem PRECISA garantir:
 *   · repetição que sobrou   — trigramas que aparecem 2+ vezes no corte (retake/gagueira que passou)
 *   · cobertura da peça      — quanto do texto final está no corte (frase boa que foi cortada some daqui)
 *   · fora da peça           — frases mantidas que a peça não usa (escolha editorial OU lixo que passou)
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readTranscript } from '../asr.ts';
import { makeEnvelope, readEnvelope } from '../media.ts';
import { analyze, keptRanges, normalizeToken } from './analyze.ts';
import { decide, keepMask } from './decide.ts';

const [wav, trPath, finalPath] = process.argv.slice(2) as [string, string, string];
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nebench-'));
await makeEnvelope(wav, tmp);
const env = await readEnvelope(path.join(tmp, 'envelope.f32'));
const tr = await readTranscript(trPath);
const an = analyze(tr.words, env);
const decision = await decide(tr.words, an, '', 'local');
const { keep } = keepMask(tr.words, decision);
const ranges = keptRanges(tr.words, keep, an);
const inKept = (t: number) => ranges.some((r) => t >= r.start && t <= r.end);

const keptWords = tr.words.filter((_, i) => inKept(an.centers[i]!));
const toks = (s: string) => s.split(/\s+/).map(normalizeToken).filter(Boolean);
const kt = keptWords.map((w) => normalizeToken(w.w)).filter(Boolean);
const finalText = (JSON.parse(await fs.readFile(finalPath, 'utf8')) as { t: string }[]).map((s) => s.t).join(' ');
const ft = toks(finalText);
const grams = (t: string[], n: number) => t.slice(0, Math.max(0, t.length - n + 1)).map((_, i) => t.slice(i, i + n).join(' '));

const kg = grams(kt, 3);
const fg = new Set(grams(ft, 3));
const counts = new Map<string, number>();
for (const g of kg) counts.set(g, (counts.get(g) ?? 0) + 1);
const finalCounts = new Map<string, number>();
for (const g of grams(ft, 3)) finalCounts.set(g, (finalCounts.get(g) ?? 0) + 1);
// Repetição = aparece mais vezes no corte do que na peça final (repetição intencional não conta).
const dup = [...counts].filter(([g, c]) => c > Math.max(1, finalCounts.get(g) ?? 1) && g.split(' ').some((x) => x.length > 3));
const covered = [...fg].filter((g) => counts.has(g)).length;

// Frases mantidas fora da peça final.
const sentences: string[] = [];
let cur: string[] = [];
keptWords.forEach((w, i) => {
  cur.push(w.w);
  const nx = keptWords[i + 1];
  if (/[.?!…]$/.test(w.w) || !nx || nx.start - w.end > 0.8) {
    sentences.push(cur.join(' '));
    cur = [];
  }
});
const outside = sentences.filter((s) => {
  const g = grams(toks(s), 3);
  return g.length && g.filter((x) => fg.has(x)).length / g.length < 0.34;
});
const dur = ranges.reduce((a, r) => a + r.end - r.start, 0);

console.log(`\n=== DECUPAGEM × PEÇA PUBLICADA ===`);
console.log(`corte: ${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')} em ${ranges.length} trechos`);
console.log(`cobertura da peça final: ${((covered / fg.size) * 100).toFixed(1)}% dos trigramas`);
console.log(`repetição que sobrou: ${dup.length} trigramas repetidos`);
for (const [g, c] of dup.slice(0, 25)) console.log(`   ${c}× "${g}"`);
console.log(`frases mantidas fora da peça (${outside.length}):`);
for (const s of outside) console.log(`   · ${s}`);
