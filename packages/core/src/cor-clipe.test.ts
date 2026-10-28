/**
 * BL-0159 C3: grade por clipe SOBRE a do arquivo. A do arquivo faz a conversão de entrada (LOG → Rec.709) e as
 * primárias; a do clipe entra depois, como Rec.709, numa LUT só (preview e render usam a mesma `buildLut`).
 * Sem grade de clipe, a LUT sai idêntica à de antes.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyOp, buildLut, clipGradeOf, gradePixel, NEUTRAL_GRADE, normalizeTimeline, textureOfClip, type ColorGrade, type Timeline } from './index.ts';

const arquivo: ColorGrade = { ...NEUTRAL_GRADE, input: 'slog3', codeRange: 'full', exposure: 0.3, contrast: 0.1 };
const doClipe: ColorGrade = { ...NEUTRAL_GRADE, exposure: -0.4, temperature: 0.3, saturation: 0.8 };

const tl = (): Timeline =>
  normalizeTimeline({
    fps: 30,
    width: 1080,
    height: 1920,
    main: [
      { id: 'c1', assetId: 'a1', in: 0, out: 2, by: 'human' },
      { id: 'c2', assetId: 'a1', in: 2, out: 4, by: 'human' },
      { id: 'c3', assetId: 'a2', in: 0, out: 2, by: 'human' },
    ],
    grades: { a1: arquivo },
  });

describe('grade por clipe sobre a do arquivo (BL-0159 C3)', () => {
  test('sem grade de clipe (ausente, null ou neutra) a LUT é a mesma de antes, byte a byte', () => {
    const antes = buildLut(arquivo, 17);
    assert.deepEqual(buildLut(arquivo, 17, null, null, null), antes);
    assert.deepEqual(buildLut(arquivo, 17, null, null, { grade: { ...NEUTRAL_GRADE } }), antes);
    // Neutra com input de LOG copiado por engano: a do clipe não converte, continua neutra.
    assert.deepEqual(buildLut(arquivo, 17, null, null, { grade: { ...NEUTRAL_GRADE, input: 'slog3' } }), antes);
  });

  test('a grade Rec.709 neutra é a identidade (a do clipe só muda o que pede)', () => {
    for (const v of [0, 0.1, 0.42, 0.8, 1]) {
      const o = gradePixel([v, v * 0.5, 1 - v], NEUTRAL_GRADE);
      assert.ok(Math.abs(o[0] - v) < 1e-6 && Math.abs(o[1] - v * 0.5) < 1e-6 && Math.abs(o[2] - (1 - v)) < 1e-6, `${v}: ${o}`);
    }
  });

  test('LUT composta = grade do arquivo e depois a do clipe, em cada nó', () => {
    const n = 9;
    const lut = buildLut(arquivo, n, null, null, { grade: doClipe });
    const cg = clipGradeOf(doClipe);
    let i = 0;
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++, i += 3) {
          const want = gradePixel(gradePixel([r / (n - 1), g / (n - 1), b / (n - 1)], arquivo), cg);
          for (let k = 0; k < 3; k++) assert.ok(Math.abs(lut[i + k]! - want[k]!) < 1e-6);
        }
    assert.notDeepEqual(lut, buildLut(arquivo, n));
  });

  test('set_clip_grade: põe sem conversão de entrada, em vários clipes; neutra ou null tira', () => {
    let t = applyOp(tl(), { type: 'set_clip_grade', clipIds: ['c1', 'c3'], grade: { ...doClipe, input: 'slog3', codeRange: 'full', inputLut: { id: 'x', nome: 'x' } } }, 'human');
    assert.equal(t.main[0]!.grade!.input, 'rec709');
    assert.equal(t.main[0]!.grade!.codeRange, undefined);
    assert.equal(t.main[0]!.grade!.inputLut, undefined);
    assert.equal(t.main[0]!.grade!.exposure, -0.4);
    assert.equal(t.main[1]!.grade, undefined);
    assert.equal(t.main[2]!.grade!.temperature, 0.3);
    // A do arquivo não muda.
    assert.deepEqual(t.grades, { a1: arquivo });
    t = applyOp(t, { type: 'set_clip_grade', clipIds: ['c1'], grade: { ...NEUTRAL_GRADE } }, 'human');
    assert.ok(!('grade' in t.main[0]!));
    t = applyOp(t, { type: 'set_clip_grade', clipIds: ['c3'], grade: null }, 'human');
    assert.ok(!('grade' in t.main[2]!));
    assert.throws(() => applyOp(t, { type: 'set_clip_grade', clipIds: ['nao'], grade: doClipe }, 'human'), /não existe/);
    assert.throws(() => applyOp(t, { type: 'set_clip_grade', clipIds: [], grade: doClipe }, 'human'), /nenhum clipe/);
  });

  test('dividir o clipe leva a grade dele para as duas metades', () => {
    let t = applyOp(tl(), { type: 'set_clip_grade', clipIds: ['c1'], grade: doClipe }, 'human');
    t = applyOp(t, { type: 'split', time: 1 }, 'human');
    assert.equal(t.main.length, 4);
    assert.equal(t.main[0]!.grade!.exposure, -0.4);
    assert.equal(t.main[1]!.grade!.exposure, -0.4);
  });

  test('textura: o que o clipe define vale no lugar do arquivo', () => {
    assert.deepEqual(textureOfClip({ ...NEUTRAL_GRADE, sharpen: 0.3, grain: 0.2 }, { ...NEUTRAL_GRADE, grain: 0 }), { sharpen: 0.3, vignette: 0, grain: 0 });
    assert.deepEqual(textureOfClip({ ...NEUTRAL_GRADE, sharpen: 0.3 }, undefined), { sharpen: 0.3, vignette: 0, grain: 0 });
  });
});
