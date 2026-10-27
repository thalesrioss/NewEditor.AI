import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileDuration, normalizeMix } from './render.ts';

/** Nível RMS (dB) de um trecho do WAV. */
function rmsDb(file: string, start: number, dur: number): number {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(start), '-t', String(dur), '-i', file, '-af', 'astats=measure_perchannel=none', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /RMS level dB: (-?[\d.]+|-inf)/.exec(r.stderr);
  return !m || m[1] === '-inf' ? -Infinity : Number.parseFloat(m[1]!);
}

// CH-0037: no último bloco o loudnorm do ffmpeg 9 solta um quadro curto (10 ms) mas avança o relógio como se fosse
// um bloco inteiro (100 ms). O `-t` da peça corta pelo relógio e jogava fora os últimos ~90 ms de som real (o ar da
// sala do fecho); a entrega completava com silêncio digital. Peça de 29,51 s = a v017 do eq2210-19.
test('mix normalizada vai até o último quadro, sem cortar o fim real (CH-0037)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ch0037-'));
  try {
    const total = 29.51;
    const premix = path.join(dir, 'premix.wav');
    const out = path.join(dir, 'mix.wav');
    // Fala (tom) e, nos últimos 0,3 s, só o ar da sala (ruído baixo) até a última amostra.
    const gen = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=f=220:r=48000:d=${total}`, '-f', 'lavfi', '-i', `anoisesrc=r=48000:a=0.01:d=${total}`, '-filter_complex', `[0:a]volume=enable='gte(t,${total - 0.3})':volume=0[s];[s][1:a]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo`, '-c:a', 'pcm_f32le', premix]);
    assert.equal(gen.status, 0, gen.stderr?.toString());
    await normalizeMix(premix, out, total);
    assert.ok(Math.abs((await fileDuration(out)) - total) < 0.002, `duração ${await fileDuration(out)}`);
    // Os últimos 60 ms ainda têm o ar da sala (antes da correção: -inf, silêncio).
    assert.ok(rmsDb(out, total - 0.06, 0.05) > -70, `fim em ${rmsDb(out, total - 0.06, 0.05)} dB`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
