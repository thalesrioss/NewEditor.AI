import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Clip, MediaAsset } from '@neweditor/core';
import { fileDuration, segmentAudio } from './render.ts';

// CH-0042: o `-t` do trecho vinha depois do `-i` e cortava a saída em out−in. O silêncio do congelamento (apad) e o
// fim da câmera lenta sumiam; a mix acabava no último som e a conferência do render recusava (72,25 s para 74,00 s,
// último clipe com freeze de 1,75 s no prj_mvi7ygh13e8drt).
test('trecho de áudio cobre o congelamento e a câmera lenta (CH-0042)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ch0042-'));
  try {
    const src = path.join(dir, 'fonte.wav');
    const gen = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=220:r=48000:d=12', '-c:a', 'pcm_s16le', src]);
    assert.equal(gen.status, 0, gen.stderr?.toString());
    const a = { id: 'a', kind: 'video', path: src, hasAudio: true } as unknown as MediaAsset;
    const casos: [Partial<Clip>, number][] = [
      [{ in: 2, out: 8.2, freeze: 1.75 }, 7.95],
      [{ in: 2, out: 5, speed: 0.5 }, 6],
    ];
    for (const [c, want] of casos) {
      const out = path.join(dir, 'seg.wav');
      await segmentAudio(a, { id: 'c', assetId: 'a', ...c } as Clip, out, null);
      const got = await fileDuration(out);
      assert.ok(Math.abs(got - want) < 0.002, `${JSON.stringify(c)}: ${got} s, esperado ${want} s`);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
