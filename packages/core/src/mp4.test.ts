import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleIndexAt, videoSampleAt, type Mp4Sample } from './mp4.ts';

// Proxy real (prj_leodz2010): o 1º quadro de vídeo tem pts 0,021354 s, um a cada 1/30 s.
const samples: Mp4Sample[] = Array.from({ length: 10 }, (_, i) => {
  const pts = 0.021354166666666667 + i / 30;
  return { offset: i * 100, size: 100, dts: pts, pts, dur: 1 / 30, key: i % 8 === 0 };
});

test('sampleIndexAt: -1 antes da primeira amostra, último pts ≤ t depois', () => {
  assert.equal(sampleIndexAt(samples, 0), -1);
  assert.equal(sampleIndexAt(samples, 0.021354166666666667), 0);
  assert.equal(sampleIndexAt(samples, 0.05), 0);
  assert.equal(sampleIndexAt(samples, 0.0546875), 1);
  assert.equal(sampleIndexAt(samples, 99), 9);
  assert.equal(sampleIndexAt([], 1), -1);
});

test('videoSampleAt: em 0:00 (antes do 1º quadro do proxy) mostra o primeiro quadro (BL-0022)', () => {
  assert.deepEqual(videoSampleAt(samples, 0), { index: 0, t: 0.021354166666666667 });
  assert.deepEqual(videoSampleAt(samples, 0.01), { index: 0, t: 0.021354166666666667 });
});

test('videoSampleAt: depois do 1º quadro não muda nada', () => {
  assert.deepEqual(videoSampleAt(samples, 0.1), { index: 2, t: 0.1 });
  assert.deepEqual(videoSampleAt(samples, 5), { index: 9, t: 5 });
  assert.deepEqual(videoSampleAt([], 0), { index: -1, t: 0 });
});
