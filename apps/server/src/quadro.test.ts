/**
 * CH-0018: simular a grade num quadro do bruto (buildLut + lut3d num PNG) media o preto 15–19 pontos acima do render,
 * porque o PNG medido pelo signalstats vira YUV limitado e o render de um bruto full range sai em full range.
 * O quadro de conferência passa pelo mesmo caminho do render e mede no arquivo codificado: confere que (1) o range
 * do bruto pc chega ao quadro, (2) a medida bate com o trecho do render medido direto, (3) a grade de teste muda a
 * medida sem salvar no projeto, (4) o tempo da timeline cai no clipe e no quadro certos.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { NEUTRAL_GRADE, type Project } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-quadro-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { run } = await import('./media.ts');
const { clipNoTempo, lerSinal, renderQuadro } = await import('./quadro.ts');
const { deliverySize, gradeFilters, segmentVideo } = await import('./render.ts');

// Bruto full range (yuvj420p, color_range=pc), 2 s, 30 fps, gradiente com preto de verdade.
const bruto = path.join(tmp, 'bruto.mp4');
await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'gradients=s=640x360:d=2:r=30:c0=black:c1=white:x0=0:y0=0:x1=640:y1=0:speed=0', '-pix_fmt', 'yuvj420p', '-color_range', 'pc', '-c:v', 'libx264', '-crf', '12', '-y', bruto]);

const grade = { ...NEUTRAL_GRADE, blacks: 0.45, contrast: 0.2 };
const projeto = (): Project =>
  ({
    id: 'prj_q',
    name: 'q',
    version: 1,
    assets: [{ id: 'a1', kind: 'video', path: bruto, width: 640, height: 360, duration: 2, hasAudio: false }],
    timeline: {
      fps: 30,
      width: 640,
      height: 360,
      main: [
        { id: 'c1', assetId: 'a1', in: 0, out: 1 },
        { id: 'c2', assetId: 'a1', in: 1, out: 2 },
      ],
      overlays: [],
      removals: [],
      pins: [],
      grades: { a1: grade },
    },
  }) as unknown as Project;

describe('quadro de conferência da grade (CH-0018)', () => {
  test('tempo da timeline vira clipe e quadro no grid do render', () => {
    const tl = projeto().timeline;
    assert.deepEqual(clipNoTempo(tl, 0), { i: 0, frame: 0 });
    assert.deepEqual(clipNoTempo(tl, 0.5), { i: 0, frame: 15 });
    assert.deepEqual(clipNoTempo(tl, 1.0), { i: 1, frame: 0 });
    assert.deepEqual(clipNoTempo(tl, 1.99), { i: 1, frame: 29 });
    assert.equal(clipNoTempo(tl, 2.5), null);
  });

  test('mede na escala do render: range pc do bruto e mesmo YLOW/YAVG/YHIGH do trecho renderizado', async () => {
    const p = projeto();
    const dir = path.join(tmp, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    const q = await renderQuadro(p, dir, 1.5);
    assert.equal(q.clipId, 'c2');
    assert.equal(q.range, 'pc');
    assert.ok(fs.statSync(path.join(dir, q.file)).size > 0, 'PNG gravado');

    // Referência: o trecho inteiro do clipe como o render faz, medido no quadro 15.
    const work = fs.mkdtempSync(path.join(tmp, 'ref-'));
    const { W, H } = deliverySize(p.timeline);
    const { lutFilter } = await gradeFilters(p.timeline.grades, work);
    const seg = path.join(work, 'seg.mp4');
    await segmentVideo(p.assets[0]!, p.timeline.main[1]!, 30, 30, W, H, seg, lutFilter('a1'));
    const ref = lerSinal((await run('ffmpeg', ['-v', 'error', '-i', seg, '-vf', "select='eq(n\\,15)',signalstats,metadata=print:file=-", '-f', 'null', '-'])).toString());
    assert.ok(Math.abs(q.sinal.ylow - ref.ylow) <= 1, `YLOW quadro ${q.sinal.ylow} x render ${ref.ylow}`);
    assert.ok(Math.abs(q.sinal.yavg - ref.yavg) <= 1, `YAVG quadro ${q.sinal.yavg} x render ${ref.yavg}`);
    assert.ok(Math.abs(q.sinal.yhigh - ref.yhigh) <= 1, `YHIGH quadro ${q.sinal.yhigh} x render ${ref.yhigh}`);
    // Full range: o preto fica perto de 0, não em 16 (o erro da simulação em PNG).
    assert.ok(q.sinal.ymin < 10, `YMIN ${q.sinal.ymin}`);
  });

  test('grade de teste muda a medida e não salva no projeto', async () => {
    const p = projeto();
    const dir = path.join(tmp, 'proj2');
    fs.mkdirSync(dir, { recursive: true });
    const base = await renderQuadro(p, dir, 0.5);
    const claro = await renderQuadro(p, dir, 0.5, { a1: { blacks: -0.6, exposure: 0.8 } });
    assert.ok(claro.sinal.yavg > base.sinal.yavg + 5, `YAVG ${base.sinal.yavg} -> ${claro.sinal.yavg}`);
    assert.equal(p.timeline.grades!.a1!.blacks, 0.45);
  });

  test('t fora da timeline devolve 400', async () => {
    await assert.rejects(renderQuadro(projeto(), path.join(tmp, 'proj3'), 9), (e: Error & { statusCode?: number }) => e.statusCode === 400);
  });
});
