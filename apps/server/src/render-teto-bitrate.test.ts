/**
 * CH-0039: o único encode da entrega tinha crf 16 com teto fixo de 25 Mb/s; o v5 do eq2210-15 (Equity) saiu 23,5 Mb/s
 * e o revisor reprova acima da linha dos aprovados (~11-14 Mb/s). `set_bitrate` grava o teto no projeto e o render usa.
 * Encode de verdade: ruído (pior caso para o x264) com os mesmos argumentos da entrega, com e sem teto.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { applyOp, type Timeline } from '@neweditor/core';
import { deliveryVideoArgs } from './render.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-bitrate-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function encode(name: string, maxMbps?: number): number {
  const out = path.join(tmp, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30,noise=alls=40:allf=t', '-t', '10', ...deliveryVideoArgs(30, maxMbps), out], { stdio: ['ignore', 'ignore', 'inherit'] });
  return Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=bit_rate', '-of', 'csv=p=0', out]).toString()) / 1e6;
}

const tl = { maxBitrate: undefined } as unknown as Timeline;

describe('teto de bitrate da entrega (CH-0039)', () => {
  test('set_bitrate grava, valida a faixa e null volta ao padrão', () => {
    const t1 = applyOp(tl, { type: 'set_bitrate', maxMbps: 14 }, 'human');
    assert.equal(t1.maxBitrate, 14);
    assert.throws(() => applyOp(tl, { type: 'set_bitrate', maxMbps: 40 }, 'human'), /entre 2 e 25/);
    assert.throws(() => applyOp(tl, { type: 'set_bitrate', maxMbps: 1 }, 'human'), /entre 2 e 25/);
    assert.equal('maxBitrate' in applyOp(t1, { type: 'set_bitrate', maxMbps: null }, 'human'), false);
  });

  test('sem teto continua 25M; com teto o maxrate e o bufsize seguem o valor', () => {
    const a = deliveryVideoArgs(29.97);
    assert.equal(a[a.indexOf('-maxrate') + 1], '25M');
    assert.equal(a[a.indexOf('-bufsize') + 1], '50M');
    const b = deliveryVideoArgs(29.97, 14);
    assert.equal(b[b.indexOf('-maxrate') + 1], '14M');
    assert.equal(b[b.indexOf('-bufsize') + 1], '28M');
    assert.equal(b[b.indexOf('-crf') + 1], '16');
  });

  // O buffer (2x o teto) deixa a média passar um pouco do teto em arquivo curto; no v5 (31 s) teto 13 deu 13,2.
  test('encode com teto sai no teto (ruído que sem teto passa dele)', () => {
    const livre = encode('livre.mp4');
    const teto = encode('teto.mp4', 4);
    assert.ok(livre > 6, `sem teto o ruído devia passar de 6 Mb/s (saiu ${livre.toFixed(2)})`);
    assert.ok(teto <= 4 * 1.1, `com teto 4 saiu ${teto.toFixed(2)} Mb/s`);
  });
});
