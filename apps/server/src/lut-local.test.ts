/**
 * CH-0009: look de um .cube do disco (fora do catálogo CinePRO) no set_grade, com `lut: { path }`.
 * O cube é gerado aqui (2×2×2, troca R e B) — sem arquivo binário no repositório.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyOp, buildLut, localLutId, NEUTRAL_GRADE, normalizeGradeLut, type Timeline } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ne-lut-local-Luts Marcelo S'antana-"));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
const { cineproCube } = await import('./cinepro.ts');

const cubeFile = path.join(tmp, 'FUJI_CLASSICO.cube');
const rows: string[] = [];
for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${b} ${g} ${r}`);
fs.writeFileSync(cubeFile, `TITLE "teste"\nLUT_3D_SIZE 2\n${rows.join('\n')}\n`);

test('set_grade com lut.path vira look local com id, nome e força', () => {
  const g = normalizeGradeLut({ ...NEUTRAL_GRADE, lut: { path: cubeFile } as never });
  assert.deepEqual(g.lut, { id: localLutId(cubeFile), nome: 'FUJI_CLASSICO', strength: 1, path: cubeFile });
  const t = { fps: 30, width: 1080, height: 1920, main: [], overlays: [], removals: [], pins: [] } as unknown as Timeline;
  const out = applyOp(t, { type: 'set_grade', assetId: 'a', grade: { ...NEUTRAL_GRADE, lut: { path: cubeFile, strength: 0.6 } as never } }, 'human');
  assert.equal(out.grades!.a!.lut!.id, `local:${cubeFile}`);
  assert.equal(out.grades!.a!.lut!.strength, 0.6);
  // Look do catálogo passa igual.
  const cat = normalizeGradeLut({ ...NEUTRAL_GRADE, lut: { id: '1WQkEd7', nome: 'Fuji', strength: 1 } });
  assert.deepEqual(cat.lut, { id: '1WQkEd7', nome: 'Fuji', strength: 1 });
});

test('cineproCube lê o .cube do disco e o look entra na LUT do export', async () => {
  const cube = await cineproCube(localLutId(cubeFile));
  assert.equal(cube.n, 2);
  const g = normalizeGradeLut({ ...NEUTRAL_GRADE, lut: { path: cubeFile } as never });
  const lut = buildLut(g, 2, cube);
  // Entrada vermelha pura (r=1,g=0,b=0 = índice 1) sai azul: o look foi aplicado.
  assert.ok(lut[3]! < 0.05 && lut[5]! > 0.95, `saiu ${[...lut.slice(3, 6)]}`);
});

test('caminho inválido devolve erro 400 com mensagem para o editor', async () => {
  for (const [p, re] of [
    ['relativo/FUJI.cube', /absoluto/],
    [path.join(tmp, 'nao-existe.cube'), /não achei/],
    [path.join(tmp, 'x.png'), /\.cube/],
  ] as const) {
    await assert.rejects(cineproCube(localLutId(p)), (e: Error & { statusCode?: number }) => e.statusCode === 400 && re.test(e.message));
  }
});
