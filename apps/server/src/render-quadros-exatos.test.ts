import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { countFrames, encodeExactFrames } from './render.ts';

const HW = ['-hwaccel', 'videotoolbox', '-i', 'x'];
const SW = ['-i', 'x'];

test('hardware sai com 0 mas com quadros a menos: refaz em software (CH-0027)', async () => {
  const calls: string[][] = [];
  await encodeExactFrames([HW, SW], 'out.mp4', 256, async (_c, a) => void calls.push(a), async () => (calls.length === 1 ? 249 : 256));
  assert.deepEqual(calls, [HW, SW]);
});

test('hardware com todos os quadros: não refaz', async () => {
  const calls: string[][] = [];
  await encodeExactFrames([HW, SW], 'out.mp4', 256, async (_c, a) => void calls.push(a), async () => 256);
  assert.deepEqual(calls, [HW]);
});

test('hardware falha: software; erro só se a última tentativa falhar', async () => {
  const calls: string[][] = [];
  await encodeExactFrames([HW, SW], 'out.mp4', 10, async (_c, a) => {
    calls.push(a);
    if (a === HW) throw new Error('hw');
  }, async () => 10);
  assert.deepEqual(calls, [HW, SW]);
  await assert.rejects(encodeExactFrames([HW, SW], 'out.mp4', 10, async () => { throw new Error('ffmpeg'); }, async () => 10), /ffmpeg/);
});

test('countFrames lê o número de quadros do arquivo', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ch0027-'));
  const f = path.join(dir, 'v.mp4');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:r=30000/1001', '-frames:v', '17', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(await countFrames(f), 17);
  await fs.rm(dir, { recursive: true, force: true });
});
