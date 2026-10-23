/**
 * CH-0015 (Tomás, Brane 6ad8c0b9): motion sem alfa saía com o verde +3 a +4 no render. Causa: a camada de texto por
 * cima de tudo entrava com overlay format=auto, que leva o quadro inteiro para RGBA e de volta.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEXT_OVERLAY } from './render.ts';

const ff = (args: string[]) => {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, String(r.stderr));
  return r.stdout as Buffer;
};
/** RGB médio de uma região 80×80 do quadro 15. */
const rgb = (file: string, x: number, y: number) => [...ff(['-i', file, '-vf', `select=eq(n\\,15),crop=80:80:${x}:${y},scale=1:1:flags=area,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'])];

test('camada de texto não muda a cor do vídeo embaixo e mantém as cores do texto (CH-0015)', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch0015-'));
  try {
    // Base como o trecho do render de um bruto de celular (yuvj420p, faixa cheia), com imagem variada (a ida e
    // volta pelo RGBA não aparece numa cor chapada).
    const base = path.join(dir, 'base.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=30:d=1', '-vf', 'format=yuvj420p', '-c:v', 'libx264', '-crf', '12', base]);
    // Camada de texto como a do render (qtrle ARGB): transparente, com um bloco branco e um âmbar.
    const txt = path.join(dir, 'text.mov');
    ff(['-f', 'lavfi', '-i', 'color=black@0.0:s=540x960:r=30:d=1,format=rgba', '-f', 'lavfi', '-i', 'color=white:s=100x100:r=30:d=1,format=rgba', '-f', 'lavfi', '-i', 'color=0xE8B44A:s=100x100:r=30:d=1,format=rgba', '-filter_complex', '[0][1]overlay=50:50:format=rgb[a];[a][2]overlay=200:50:format=rgb,format=argb', '-c:v', 'qtrle', txt]);
    const out = path.join(dir, 'out.mp4');
    ff(['-i', base, '-i', txt, '-filter_complex', `[0:v][1:v]${TEXT_OVERLAY}[v]`, '-map', '[v]', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', out]);
    const antes = rgb(base, 300, 600);
    const depois = rgb(out, 300, 600);
    assert.ok(antes.every((v, k) => Math.abs(v - depois[k]!) <= 1), `vídeo embaixo do texto: ${antes} → ${depois}`);
    assert.ok(rgb(out, 60, 60).every((v) => v >= 253), 'branco do texto');
    const ambar = rgb(out, 210, 60);
    assert.ok([0xe8, 0xb4, 0x4a].every((v, k) => Math.abs(v - ambar[k]!) <= 2), `âmbar do texto: ${ambar}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
