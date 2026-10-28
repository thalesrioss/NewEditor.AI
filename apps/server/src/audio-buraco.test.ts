import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Clip, MediaAsset } from '@neweditor/core';
import { fileDuration, segmentAudio } from './render.ts';

/** Primeiro instante (s) em que o WAV passa de -40 dB, em janelas de 5 ms. */
function onset(file: string): number {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'astats=metadata=1:reset=240,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-f', 'null', '-'], { encoding: 'utf8' });
  const re = /pts_time:([\d.]+)\s*\n.*RMS_level=(-?[\d.]+|-inf)/g;
  for (let m = re.exec(r.stderr); m; m = re.exec(r.stderr)) if (m[2] !== '-inf' && Number.parseFloat(m[2]!) > -40) return Number.parseFloat(m[1]!);
  return Number.NaN;
}

// BL-0156 (FB-0182): o AAC do davi-lo v245 tem 50 ms de pacotes faltando aos 80,6 s (o pts pula). O trecho de áudio
// enfileirava as amostras sem olhar o pts: a mix saía 50 ms curta (render falhava na conferência da normalizeMix) e
// o som depois do buraco ficava adiantado em relação à imagem. Aqui: bipe aos 6,0 s e 2 pacotes AAC tirados aos ~4,3 s.
test('buraco no pts do AAC vira silêncio no lugar certo: trecho com a duração da peça e som no tempo da fonte', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bl0156-'));
  try {
    const clean = path.join(dir, 'a.mp4');
    const src = path.join(dir, 'buraco.mp4');
    const gen = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,6,6.3),0.5*sin(2*PI*440*t),0)':s=48000:d=10", '-f', 'lavfi', '-i', 'testsrc2=s=160x120:r=30:d=10', '-c:a', 'aac', '-c:v', 'libx264', '-preset', 'ultrafast', clean]);
    assert.equal(gen.status, 0, gen.stderr?.toString());
    const drop = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', clean, '-c', 'copy', '-bsf:a', "noise=drop='between(n,200,201)'", src]);
    assert.equal(drop.status, 0, drop.stderr?.toString());
    const a = { id: 'a1', kind: 'video', path: src, hasAudio: true, duration: 10 } as MediaAsset;
    const c = { id: 'c1', assetId: 'a1', in: 0, out: 10, by: 'agent' } as Clip;
    const out = path.join(dir, 'seg.wav');
    const ref = path.join(dir, 'ref.wav');
    await segmentAudio(a, c, out, null);
    await segmentAudio({ ...a, path: clean }, c, ref, null);
    // Antes da correção: 9,936 s e o bipe ~64 ms adiantado em relação à fonte sem buraco.
    assert.ok(Math.abs((await fileDuration(out)) - 10) < 0.001, `duração ${await fileDuration(out)}`);
    const t = onset(out);
    const tRef = onset(ref);
    assert.ok(Math.abs(t - tRef) < 0.006, `bipe aos ${t} s, na fonte sem buraco aos ${tRef} s`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
