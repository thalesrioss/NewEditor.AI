/**
 * Sincronia por trecho (FB-0180 A4): a imagem da entrega no instante da voz. Fonte com movimento (testsrc2); entrega
 * certa passa; entrega com a imagem 6 quadros adiantada (cobertura de outro momento, quadro perdido) reprova.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-sync-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const { melhorLag, melhorLagMov, movimento, syncPorTrecho } = await import('./qc-sync.ts');

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
const fonte = path.join(tmp, 'fonte.mp4');
ff(['-f', 'lavfi', '-i', 'testsrc2=s=108x192:r=30000/1001:d=8', '-c:v', 'libx264', '-qp', '10', '-pix_fmt', 'yuv420p', fonte]);
const entrega = (from: number, out: string) => ff(['-ss', String(from), '-i', fonte, '-t', '3', '-c:v', 'libx264', '-qp', '18', '-pix_fmt', 'yuv420p', out]);
const projeto = {
  assets: [{ id: 'f', name: 'fonte.mp4', path: fonte, kind: 'video', duration: 8, width: 108, height: 192, hasAudio: false }],
  timeline: { fps: 29.97, width: 108, height: 192, main: [{ id: 'c1', assetId: 'f', in: 2, out: 5, by: 'human' }], overlays: [], removals: [], tracks: [] },
} as never;

test('melhorLag acha o deslocamento e recusa sequência curta', () => {
  const f = (v: number) => Float32Array.from([v, -v, v, -v]);
  const b = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => f(Math.sin(i * 1.3)));
  assert.equal(melhorLag(b.slice(2, 7), b)?.lag, 2);
  assert.equal(melhorLag(b.slice(0, 3), b), null);
});

test('entrega no instante da voz passa; imagem 6 quadros adiantada reprova', { timeout: 60_000 }, async () => {
  const certa = path.join(tmp, 'certa.mp4');
  entrega(2, certa);
  const r1 = await syncPorTrecho(certa, projeto);
  assert.equal(r1.achados[0]?.ok, true, JSON.stringify(r1));
  const torta = path.join(tmp, 'torta.mp4');
  entrega(2 + 6 * 1001 / 30000, torta);
  const r2 = await syncPorTrecho(torta, projeto);
  assert.equal(r2.achados[0]?.ok, false, JSON.stringify(r2));
  assert.match(r2.achados[0]!.medido, /\+6 quadros/);
});

test('CH-0040: curva plana com máximo na borda não é prova; o sinal de movimento acha o lag certo', () => {
  // Curva subindo devagar até a borda (plano quase parado): máximo na borda, 2º pico colado nele.
  const f = (v: number) => Float32Array.from([v, -v]);
  const b = Array.from({ length: 20 }, (_, i) => f(1 + i * 0.001));
  const r = melhorLag(b.slice(0, 6), b)!;
  assert.equal(r.borda, true);
  assert.ok(r.corr - r.segundo < 0.05);
  // Movimento: um gesto (pico de mudança) no quadro 14 da fonte e no quadro 4 da entrega = lag 10.
  const gesto = (n: number, at: number) => Array.from({ length: n }, (_, i) => Math.exp(-((i - at) ** 2) / 4) + 0.01 * Math.sin(i * 7.1));
  const m = melhorLagMov(gesto(12, 4), gesto(30, 14))!;
  assert.equal(m.lag, 10);
  assert.equal(m.borda, false);
  assert.ok(m.corr - m.segundo > 0.15, JSON.stringify(m));
  assert.equal(movimento([f(1), f(1), f(3)]).length, 2);
});

test('CH-0040: imagem 15 quadros atrasada (borda da busca de ±0,5 s) continua reprovando', { timeout: 60_000 }, async () => {
  const torta = path.join(tmp, 'torta15.mp4');
  entrega(2 - 15 * 1001 / 30000, torta);
  const r = await syncPorTrecho(torta, projeto);
  assert.equal(r.achados[0]?.ok, false, JSON.stringify(r));
  assert.match(r.achados[0]!.medido, /-15 quadros/);
});

test('fonte fora do disco (SSD desligado): não reprova, avisa', async () => {
  const p = JSON.parse(JSON.stringify(projeto));
  p.assets[0].path = path.join(tmp, 'nao-existe.mp4');
  const r = await syncPorTrecho(path.join(tmp, 'certa.mp4'), p);
  assert.deepEqual(r.achados, []);
  assert.ok(r.avisos.some((a) => /nenhum trecho/.test(a)));
});
