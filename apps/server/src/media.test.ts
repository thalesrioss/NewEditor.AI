/**
 * Testes do preparo de mídia (ADR-013, consolidação): os três tipos de arquivo que o ingest recebe — vídeo,
 * áudio e imagem (PNG com alfa, como os frames do CinePRO) — e o proxy certo para cada um.
 * As fixtures são geradas pelo FFmpeg aqui mesmo (sem arquivo binário no repositório).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-media-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const clip = path.join(tmp, 'clip.mp4');
const tom = path.join(tmp, 'tom.wav');
const frame = path.join(tmp, 'frame.png');

before(() => {
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '1', tom]);
  ff(['-f', 'lavfi', '-i', 'color=c=red@0.5:size=64x64:rate=1', '-frames:v', '1', '-pix_fmt', 'rgba', frame]);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('probe', () => {
  test('vídeo com áudio', async () => {
    const { probe } = await import('./media.ts');
    const m = await probe(clip);
    assert.equal(m.kind, 'video');
    assert.equal(m.hasAudio, true);
    assert.equal(m.width, 320);
    assert.equal(m.height, 180);
    assert.ok(Math.abs(m.duration - 3) < 0.2, `duração ${m.duration}`);
    assert.equal(m.alpha, undefined);
  });
  test('áudio puro', async () => {
    const { probe } = await import('./media.ts');
    const m = await probe(tom);
    assert.equal(m.kind, 'audio');
    assert.equal(m.hasAudio, true);
    assert.equal(m.width, undefined);
  });
  test('imagem PNG com alfa (frame do CinePRO)', async () => {
    const { probe } = await import('./media.ts');
    const m = await probe(frame);
    assert.equal(m.kind, 'image');
    assert.equal(m.hasAudio, false);
    assert.equal(m.alpha, true);
  });
});

describe('makeProxy', () => {
  test('imagem vira proxy.png (nunca um proxy de áudio)', async () => {
    const { makeProxy, probe } = await import('./media.ts');
    const out = path.join(tmp, 'px-img');
    fs.mkdirSync(out, { recursive: true });
    const rel = await makeProxy({ id: 'a1', name: 'frame.png', path: frame, ...(await probe(frame)) }, out);
    assert.equal(rel, 'proxy.png');
    assert.ok(fs.statSync(path.join(out, rel)).size > 0);
  });
  test('áudio vira proxy.m4a', async () => {
    const { makeProxy, probe } = await import('./media.ts');
    const out = path.join(tmp, 'px-aud');
    fs.mkdirSync(out, { recursive: true });
    const rel = await makeProxy({ id: 'a2', name: 'tom.wav', path: tom, ...(await probe(tom)) }, out);
    assert.equal(rel, 'proxy.m4a');
    assert.ok(fs.statSync(path.join(out, rel)).size > 0);
  });
  test('vídeo vira proxy.mp4 com áudio', async () => {
    const { makeProxy, probe } = await import('./media.ts');
    const out = path.join(tmp, 'px-vid');
    fs.mkdirSync(out, { recursive: true });
    const rel = await makeProxy({ id: 'a3', name: 'clip.mp4', path: clip, ...(await probe(clip)) }, out);
    assert.equal(rel, 'proxy.mp4');
    const m = await probe(path.join(out, rel));
    assert.equal(m.kind, 'video');
    assert.equal(m.hasAudio, true);
    assert.equal(m.height, 540);
  });
});
