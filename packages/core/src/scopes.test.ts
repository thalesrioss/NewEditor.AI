import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeScopes, SCOPE_LEVELS, SKIN_LINE_DEG, vectorCell, vectorImage, VECTOR_SIZE, waveformImage } from './scopes.ts';

/** Quadro RGBA de uma cor só. */
function solid(w: number, h: number, [R, G, B]: [number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) [px[i], px[i + 1], px[i + 2], px[i + 3]] = [R, G, B, 255];
  return px;
}

test('cinza 50%: luma, R, G e B todos no nível 128 em todas as colunas; vetorscópio só no centro', () => {
  const s = computeScopes(solid(64, 36, [128, 128, 128]), 64, 36, { cols: 32 });
  assert.equal(s.n, 64 * 36);
  for (const h of [s.luma, s.r, s.g, s.b]) {
    for (let c = 0; c < 32; c++) assert.equal(h[128 * 32 + c], 2 * 36);
    assert.equal(h.reduce((a, v) => a + v, 0), s.n);
  }
  const mid = Math.round(0.5 * (VECTOR_SIZE - 1));
  assert.equal(s.vector[mid * VECTOR_SIZE + mid], s.n);
});

test('waveform separa por coluna: metade esquerda preta, direita branca (10 px por coluna × 10 linhas)', () => {
  const w = 40, h = 10;
  const px = solid(w, h, [0, 0, 0]);
  for (let y = 0; y < h; y++) for (let x = w / 2; x < w; x++) px.fill(255, (y * w + x) * 4, (y * w + x) * 4 + 3);
  const s = computeScopes(px, w, h, { cols: 4 });
  assert.deepEqual([0, 1, 2, 3].map((c) => s.luma[0 * 4 + c]), [100, 100, 0, 0]);
  assert.deepEqual([0, 1, 2, 3].map((c) => s.luma[255 * 4 + c]), [0, 0, 100, 100]);
});

test('rect tira o letterbox: só a área do quadro entra na conta', () => {
  const w = 20, h = 20;
  const px = solid(w, h, [0, 0, 0]);
  for (let y = 5; y < 15; y++) for (let x = 0; x < w; x++) px.fill(200, (y * w + x) * 4, (y * w + x) * 4 + 3);
  const s = computeScopes(px, w, h, { cols: 10, rect: { x: 0, y: 5, w: 20, h: 10 } });
  assert.equal(s.n, 200);
  assert.equal(s.luma.slice(0, 10).reduce((a, v) => a + v, 0), 0, 'nenhum preto da tarja');
});

test('parade separa os canais: vermelho puro só sobe no R', () => {
  const s = computeScopes(solid(8, 8, [255, 0, 0]), 8, 8, { cols: 8 });
  assert.equal(s.r[255 * 8], 8);
  assert.equal(s.g[0], 8);
  assert.equal(s.b[0], 8);
  // luma do vermelho puro: 0,2126 × 255 ≈ 54
  assert.equal(s.luma[54 * 8], 8);
});

test('pele típica cai a ±10° da linha de pele; vermelho e azul puros caem longe', () => {
  for (const pele of [[0.8, 0.6, 0.5], [0.62, 0.45, 0.36], [0.9, 0.72, 0.6]] as [number, number, number][]) {
    const v = vectorCell(...pele);
    assert.ok(Math.abs(v.angleDeg - SKIN_LINE_DEG) < 10, `pele ${pele} a ${v.angleDeg.toFixed(1)}°`);
  }
  assert.ok(Math.abs(vectorCell(1, 0, 0).angleDeg - SKIN_LINE_DEG) > 15);
  assert.ok(Math.abs(vectorCell(0, 0, 1).angleDeg - SKIN_LINE_DEG) > 90);
  // A célula do computeScopes bate com a do vectorCell.
  const s = computeScopes(solid(4, 4, [204, 153, 128]), 4, 4);
  const c = vectorCell(204 / 255, 153 / 255, 128 / 255);
  assert.equal(s.vector[c.y * VECTOR_SIZE + c.x], 16);
});

test('imagens: waveform cols × 256, parade 3·cols × 256, vetorscópio 256², branco no topo', () => {
  const s = computeScopes(solid(16, 16, [255, 255, 255]), 16, 16, { cols: 16 });
  const wf = waveformImage(s, 'luma');
  assert.deepEqual([wf.width, wf.height], [16, SCOPE_LEVELS]);
  assert.equal(wf.data[3], 255, 'linha 0 (topo) acesa para o branco');
  assert.equal(wf.data[(SCOPE_LEVELS - 1) * 16 * 4 + 3], 0, 'base apagada');
  const pr = waveformImage(s, 'parade');
  assert.deepEqual([pr.width, pr.height], [48, SCOPE_LEVELS]);
  const vi = vectorImage(s);
  assert.equal(vi.data.length, VECTOR_SIZE * VECTOR_SIZE * 4);
});

test('1080p cheio (2 milhões de pixels) em menos de 150 ms; o quadro reduzido do painel (480×270) em menos de 15 ms', () => {
  const big = new Uint8ClampedArray(1920 * 1080 * 4);
  for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24;
  computeScopes(big.subarray(0, 480 * 270 * 4), 480, 270); // aquece o JIT
  let t = performance.now();
  computeScopes(big, 1920, 1080);
  const full = performance.now() - t;
  const small = big.subarray(0, 480 * 270 * 4);
  t = performance.now();
  const s = computeScopes(small, 480, 270);
  waveformImage(s, 'luma');
  waveformImage(s, 'parade');
  vectorImage(s);
  const reduced = performance.now() - t;
  assert.ok(full < 150, `1080p: ${full.toFixed(1)} ms`);
  assert.ok(reduced < 15, `480×270 com imagens: ${reduced.toFixed(1)} ms`);
});
