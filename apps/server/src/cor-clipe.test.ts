/**
 * BL-0159 C3: grade por clipe sobre a do arquivo no render. (1) Sem grade de clipe, os .cube do render são os mesmos de
 * antes do C3 (hash gravado com o código de antes, mesmo projeto). (2) set_clip_grade desfaz e refaz pelo histórico do
 * store. (3) Render de verdade com 2 clipes do mesmo arquivo, um com grade de clipe e outro sem: a média de cada região
 * do quadro entregue bate com o que a `buildLut` composta (arquivo → clipe) prevê.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { clipGradeOf, gradePixel, NEUTRAL_GRADE, type ColorGrade } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-cor-clipe-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const W = 320;
const H = 180;
// Quatro faixas chapadas com cara de S-Log3 (lavado: preto alto, pouca cor): sombra, pele, cinza médio, alta.
const PATCHES = ['0x3a3634', '0x7a6458', '0x6c6c6c', '0xa8a6a0'];
const bruto = path.join(tmp, 'slog.mp4');
let projectId = '';

before(async () => {
  const inputs = PATCHES.flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${c}:s=${W / 4}x${H}:r=30:d=2`]);
  ff([...inputs, '-f', 'lavfi', '-i', 'sine=f=300:r=48000:d=2', '-filter_complex', '[0][1][2][3]hstack=4,format=yuv420p[v]', '-map', '[v]', '-map', '4:a', '-c:v', 'libx264', '-qp', '0', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'pcm_s16le', '-shortest', bruto]);
  const { store } = await import('./store.ts');
  await store.load();
  projectId = (await store.create('BL-0159 C3', 'grade por clipe')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

describe('grade por clipe no render (BL-0159 C3)', () => {
  test('sem grade de clipe, o .cube do render tem o mesmo hash de antes do C3', async () => {
    const { gradeFilters } = await import('./render.ts');
    const grades: Record<string, ColorGrade> = {
      slog: { ...NEUTRAL_GRADE, input: 'slog3', codeRange: 'full', exposure: 0.3, temperature: -0.1, contrast: 0.15, saturation: 1.1 },
      r709: { ...NEUTRAL_GRADE, blacks: 0.2, contrast: 0.2, wheels: { lift: [0, 0, 0.05], gamma: [0, 0, 0], gain: [0.02, 0, 0] }, sharpen: 0.3 },
      neutro: { ...NEUTRAL_GRADE },
    };
    const work = fs.mkdtempSync(path.join(tmp, 'hash-'));
    const { luts, lutFilter, clipFilter } = await gradeFilters(grades, work);
    // Gravados com o render de antes do C3 (2fdbacb), mesmas grades.
    assert.equal(sha(luts.get('slog')!), '1adc2b5947fba8357a51e5e0533c69224c05b4b7a0e7b0b0d5a18365d909421b');
    assert.equal(sha(luts.get('r709')!), 'ab6191c7a1fca5d790cd12eeeafbaa2d2841c71bcf7e790e5c35c33edc1b3708');
    assert.equal(lutFilter('neutro'), '');
    assert.match(lutFilter('r709'), /grade-1\.cube':interp=tetrahedral,unsharp=5:5:0\.48$/);
    // Clipe sem grade (ou neutra): o mesmo filtro do arquivo, nenhum .cube a mais.
    for (const id of ['slog', 'r709', 'neutro']) {
      assert.equal(await clipFilter(id, undefined), lutFilter(id));
      assert.equal(await clipFilter(id, { ...NEUTRAL_GRADE }), lutFilter(id));
    }
    assert.deepEqual(fs.readdirSync(work).sort(), ['grade-0.cube', 'grade-1.cube']);
    // Com grade de clipe: um .cube composto a mais, reaproveitado; os do arquivo não mudam.
    const g = { ...NEUTRAL_GRADE, exposure: -0.5 };
    const f1 = await clipFilter('slog', g);
    assert.equal(await clipFilter('slog', { ...g }), f1);
    assert.match(f1, /grade-clipe-0\.cube/);
    assert.match(await clipFilter('neutro', g), /grade-clipe-1\.cube/);
    assert.equal(sha(luts.get('slog')!), '1adc2b5947fba8357a51e5e0533c69224c05b4b7a0e7b0b0d5a18365d909421b');
  });

  test('set_clip_grade entra no histórico: desfazer tira, refazer põe de volta', async () => {
    const { store } = await import('./store.ts');
    const { ingest } = await import('./ingest.ts');
    const a = await ingest(projectId, bruto, 'broll');
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'k1', assetId: a.id, in: 0, out: 1, by: 'human' }, { id: 'k2', assetId: a.id, in: 1, out: 2, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_clip_grade', clipIds: ['k1', 'k2'], grade: { ...NEUTRAL_GRADE, exposure: -0.5 } } });
    assert.equal(store.get(projectId).timeline.main[1]!.grade?.exposure, -0.5);
    assert.equal(store.historyState(projectId).undoLabel, 'Cor do clipe');
    assert.ok(store.undo(projectId));
    assert.ok(store.get(projectId).timeline.main.every((c) => !c.grade), 'desfazer tira dos dois clipes num passo só');
    assert.ok(store.redo(projectId));
    assert.ok(store.get(projectId).timeline.main.every((c) => c.grade?.exposure === -0.5));
  });

  test('render de 2 clipes do mesmo arquivo: com e sem grade de clipe, a cor bate com a buildLut composta', { timeout: 120_000 }, async () => {
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const a = store.get(projectId).assets.find((x) => x.path === bruto)!;
    const arquivo: ColorGrade = { ...NEUTRAL_GRADE, input: 'slog3', exposure: 0.2, contrast: 0.1 };
    const doClipe: ColorGrade = { ...NEUTRAL_GRADE, exposure: -0.5, temperature: 0.4, saturation: 0.7 };
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: W, height: H, fps: 30 } });
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'k1', assetId: a.id, in: 0, out: 1, by: 'human' }, { id: 'k2', assetId: a.id, in: 1, out: 2, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_grade', assetId: a.id, grade: arquivo } });
    store.apply(projectId, { by: 'human', op: { type: 'set_clip_grade', clipIds: ['k2'], grade: doClipe } });
    const res = await render(store.get(projectId), store.dir(projectId));
    const out = path.join(store.dir(projectId), res.file);

    // O que entra na LUT: o quadro da fonte em RGB 16 bits, pelo mesmo scale do trecho do render.
    const src = execFileSync('ffmpeg', ['-v', 'error', '-i', bruto, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=lanczos:in_color_matrix=bt709,format=gbrp16le,format=rgb48le`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    // O quadro entregue (yuv420p faixa legal bt709) de volta para RGB.
    const quadro = (n: number) => execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `select='eq(n\\,${n})',scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const media = (buf: Buffer, x0: number, prever?: (rgb: [number, number, number]) => [number, number, number]) => {
      const acc = [0, 0, 0];
      let k = 0;
      for (let y = H / 2 - 10; y < H / 2 + 10; y++)
        for (let x = x0 - 10; x < x0 + 10; x++, k++) {
          const i = y * W + x;
          const px: [number, number, number] = prever ? prever([buf.readUInt16LE(i * 6) / 65535, buf.readUInt16LE(i * 6 + 2) / 65535, buf.readUInt16LE(i * 6 + 4) / 65535]) : [buf[i * 3]! / 255, buf[i * 3 + 1]! / 255, buf[i * 3 + 2]! / 255];
          px.forEach((v, c) => (acc[c]! += v * 255));
        }
      return acc.map((v) => v / k);
    };
    const soArquivo = (rgb: [number, number, number]) => gradePixel(rgb, store.get(projectId).timeline.grades![a.id]!);
    const composta = (rgb: [number, number, number]) => gradePixel(soArquivo(rgb), clipGradeOf(doClipe));
    const q1 = quadro(15);
    const q2 = quadro(45);
    PATCHES.forEach((_, p) => {
      const x0 = (W / 4) * p + W / 8;
      const [sem, com, pSem, pCom] = [media(q1, x0), media(q2, x0), media(src, x0, soArquivo), media(src, x0, composta)];
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(sem[c]! - pSem[c]!) <= 3, `faixa ${p} canal ${c}, sem grade de clipe: render ${sem[c]!.toFixed(1)} x previsto ${pSem[c]!.toFixed(1)}`);
        assert.ok(Math.abs(com[c]! - pCom[c]!) <= 3, `faixa ${p} canal ${c}, com grade de clipe: render ${com[c]!.toFixed(1)} x previsto ${pCom[c]!.toFixed(1)}`);
      }
      // A grade do clipe aparece só no 2º clipe (mais escuro e mais quente que o 1º).
      if (p > 0) assert.ok(sem[1]! - com[1]! > 8, `faixa ${p}: verde ${sem[1]!.toFixed(1)} -> ${com[1]!.toFixed(1)}`);
    });
  });
});
