/**
 * CH-0005: a timeline herda formato e fps do primeiro arquivo de fala assim que ele é lido (ffprobe),
 * não só no fim da preparação. Antes, enquanto o ASR rodava (minutos num bruto de 3 min) ou se ele
 * falhasse, o projeto mostrava 30 fps para um bruto de 29,97 e o editor precisava de set_format.
 * Aqui o ASR falha de propósito (PATH sem `uv`): o formato tem que estar herdado mesmo assim.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-fps-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
for (const b of ['ffmpeg', 'ffprobe']) fs.symlinkSync(execFileSync('which', [b]).toString().trim(), path.join(bin, b));

const fala = path.join(tmp, 'fala.mp4');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=30000/1001', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);

after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('bruto 29,97 fps: timeline já nasce 29,97 e no tamanho do bruto, mesmo com o ASR falhando', async () => {
  const { store } = await import('./store.ts');
  const { ingest } = await import('./ingest.ts');
  await store.load();
  const id = (await store.create('CH-0005', 'teste')).id;
  assert.equal(store.get(id).timeline.fps, 30);
  const path0 = process.env.PATH;
  process.env.PATH = bin; // sem uv: a transcrição falha
  try {
    await assert.rejects(ingest(id, fala));
  } finally {
    process.env.PATH = path0;
  }
  const tl = store.get(id).timeline;
  assert.equal(tl.fps, 29.97);
  assert.equal(tl.width, 360);
  assert.equal(tl.height, 640);
});

test('formato escolhido na tarefa (formatoManual): mantém o tamanho e herda só o fps do bruto', async () => {
  const { store } = await import('./store.ts');
  const { ingest } = await import('./ingest.ts');
  const id = (await store.create('CH-0005 manual', 'teste')).id;
  store.setFormat(id, { width: 1080, height: 1920, fps: 30, formatoManual: true });
  const path0 = process.env.PATH;
  process.env.PATH = bin;
  try {
    await assert.rejects(ingest(id, fala));
  } finally {
    process.env.PATH = path0;
  }
  const tl = store.get(id).timeline;
  assert.deepEqual([tl.width, tl.height, tl.fps], [1080, 1920, 29.97]);
});
