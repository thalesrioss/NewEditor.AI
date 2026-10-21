import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { Clip } from '@neweditor/core';
import { segmentVideoFilter } from './render.ts';

const clip = (extra: Partial<Clip> = {}): Clip => ({ id: 'c', assetId: 'a', in: 0, out: 2, by: 'agent', ...extra });
const src = { width: 1080, height: 1920 };

test('zoom sem âncora continua pelo centro (CH-0006)', () => {
  assert.match(segmentVideoFilter(src, clip({ zoom: 1.2 }), 30, 1080, 1920), /crop=iw\/1\.2:ih\/1\.2:x=\(iw-ow\)\/2:y=\(ih-oh\)\*0\.5000,/);
  assert.match(segmentVideoFilter(src, clip({ zoom: 1, zoomTo: 1.2 }), 30, 1080, 1920), /:y='\(ih-ih\/zoom\)\*0\.5000':/);
});

test('zoom fixo e animado ancorados na altura dos olhos (CH-0006)', () => {
  const f = { y: 0.36 };
  assert.match(segmentVideoFilter(src, clip({ zoom: 1.2, framing: f }), 30, 1080, 1920), /crop=iw\/1\.2:ih\/1\.2:x=\(iw-ow\)\/2:y=\(ih-oh\)\*0\.3600,/);
  assert.match(segmentVideoFilter(src, clip({ zoom: 1, zoomTo: 1.2, framing: f }), 30, 1080, 1920), /:y='\(ih-ih\/zoom\)\*0\.3600':/);
  // Só y não liga o recorte horizontal do reframe.
  assert.doesNotMatch(segmentVideoFilter({ width: 1920, height: 1080 }, clip({ zoom: 1.2, framing: f }), 30, 1080, 1920, '', true), /min\(iw/);
});

/** Linha mais clara (0–1) de uma coluna do 1º quadro que o filtro entrega. */
function brightestRow(vf: string): number {
  // Fonte 1080×1920 preta com uma faixa branca de 4 px na altura dos olhos (y = 0,36 → 691 px).
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=1080x1920:d=1:r=30,drawbox=x=0:y=689:w=1080:h=4:color=white:t=fill', '-vf', `${vf},crop=1:ih:540:0,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, String(r.stderr));
  const px = r.stdout as Buffer;
  let best = 0;
  for (let i = 1; i < px.length; i++) if (px[i]! > px[best]!) best = i;
  return best / px.length;
}

test('no ffmpeg, a faixa dos olhos fica parada com a âncora e sobe ~54 px sem ela (CH-0006)', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const sem = brightestRow(segmentVideoFilter(src, clip({ zoom: 1.2 }), 30, 1080, 1920));
  const com = brightestRow(segmentVideoFilter(src, clip({ zoom: 1.2, framing: { y: 0.36 } }), 30, 1080, 1920));
  const animado = brightestRow(segmentVideoFilter(src, clip({ zoom: 1.2, zoomTo: 1.2001, framing: { y: 0.36 } }), 30, 1080, 1920));
  assert.ok(Math.abs(com * 1920 - 691) <= 3, `com âncora: ${com * 1920}`);
  assert.ok(Math.abs(animado * 1920 - 691) <= 3, `zoompan com âncora: ${animado * 1920}`);
  assert.ok(Math.abs(sem * 1920 - (691 - 54)) <= 4, `sem âncora: ${sem * 1920}`);
});

test('zoom acima de 2× (CH-0013): bruto 4K vertical a 2,6× recorta e amplia para a entrega', () => {
  const src4k = { width: 2160, height: 3840 };
  assert.match(segmentVideoFilter(src4k, clip({ zoom: 2.6, framing: { y: 0.4 } }), 29.97, 1080, 1920), /crop=iw\/2\.6:ih\/2\.6:x=\(iw-ow\)\/2:y=\(ih-oh\)\*0\.4000,scale=1080:1920/);
  assert.match(segmentVideoFilter(src4k, clip({ zoom: 2.6, zoomTo: 3 }), 29.97, 1080, 1920), /zoompan=z='2\.6\+\(0\.4000\)/);
});
