import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rulerStep } from '../editor/timeline/ruler.ts';
import { timecode } from '../editor/shared.ts';

// BL-0160: as marcas maiores da régua caem em segundo cheio de timecode também em fps não inteiro.
for (const fps of [29.97, 23.976, 59.94, 25, 30]) {
  test(`régua em ${fps} fps: marcas maiores terminam em :00`, () => {
    for (const pps of [0.05, 0.5, 2, 10, 40, 100, 200]) {
      const { major, frames } = rulerStep(pps, fps);
      if (frames) continue;
      for (let i = 1; i <= 40; i++) {
        const tc = timecode(i * major, fps);
        // passo de 0,5 s de timecode cai em :00 ou na metade da base
        const ff = Number(tc.slice(-2));
        assert.ok(ff === 0 || Math.abs(ff - Math.round(fps) / 2) <= 0.5,`${fps} fps, pps ${pps}, marca ${i}: ${tc}`);
      }
    }
  });
}

test('régua em 29,97: marca de 1 min mostra 00:01:00:00 e a de 1 h 01:00:00:00', () => {
  const { major } = rulerStep(1.5, 29.97); // passo de 60 s de timecode
  assert.equal(timecode(major, 29.97), '00:01:00:00');
  assert.equal(timecode(60 * major, 29.97), '01:00:00:00');
});

test('régua em 23,976: marca de 1 min mostra 00:01:00:00', () => {
  const { major } = rulerStep(1.5, 23.976);
  assert.equal(timecode(major, 23.976), '00:01:00:00');
});

test('zoom alto continua marcando por quadro', () => {
  const r = rulerStep(3000, 29.97);
  assert.equal(r.frames, true);
  assert.equal(r.major, 1 / 29.97);
});
