import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { Clip } from '@neweditor/core';
import { segmentVideoFilter } from './render.ts';

const clip = (extra: Partial<Clip> = {}): Clip => ({ id: 'c', assetId: 'a', in: 0, out: 2, by: 'agent', ...extra });
const src = { width: 1080, height: 1920 };

test('zoom sem âncora continua pelo centro (CH-0006)', () => {
  assert.match(segmentVideoFilter(src, clip({ zoom: 1.2 }), 30, 1080, 1920), /crop=iw\/1\.2:ih\/1\.2:x=\(iw-ow\)\*0\.5000:y=\(ih-oh\)\*0\.5000,/);
  assert.match(segmentVideoFilter(src, clip({ zoom: 1, zoomTo: 1.2 }), 30, 1080, 1920), /:y='\(ih-ih\/zoom\)\*0\.5000':/);
});

test('zoom fixo e animado ancorados na altura dos olhos (CH-0006)', () => {
  const f = { y: 0.36 };
  assert.match(segmentVideoFilter(src, clip({ zoom: 1.2, framing: f }), 30, 1080, 1920), /crop=iw\/1\.2:ih\/1\.2:x=\(iw-ow\)\*0\.5000:y=\(ih-oh\)\*0\.3600,/);
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
  assert.match(segmentVideoFilter(src4k, clip({ zoom: 2.6, framing: { y: 0.4 } }), 29.97, 1080, 1920), /crop=iw\/2\.6:ih\/2\.6:x=\(iw-ow\)\*0\.5000:y=\(ih-oh\)\*0\.4000,scale=1080:1920/);
  assert.match(segmentVideoFilter(src4k, clip({ zoom: 2.6, zoomTo: 3 }), 29.97, 1080, 1920), /zoompan=z='2\.6\+\(0\.4000\)/);
});

test('zoom animado reamostra a fonte ao fps da timeline antes do zoompan (CH-0017)', () => {
  assert.match(segmentVideoFilter(src, clip({ zoom: 1.18, zoomTo: 1.3 }), 29.97, 1080, 1920), /fps=29\.97,zoompan=/);
});

/** Brilho médio (0–255) do último quadro de um trecho de `frames` quadros com a fonte em `srcFps`. */
function lastFrameLuma(vf: string, srcFps: string, frames: number): number {
  // Fonte que clareia com o tempo: luma = 40 + 40·t (t em segundos), então o brilho diz o instante mostrado.
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=black:s=270x480:d=4:r=${srcFps},format=yuv420p,geq=lum='40+40*T':cb=128:cr=128`, '-vf', `${vf},scale=8:8,format=gray`, '-frames:v', String(frames), '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, String(r.stderr));
  const px = (r.stdout as Buffer).subarray(-64);
  return px.reduce((a, b) => a + b, 0) / px.length;
}

test('no ffmpeg, zoom animado em bruto 23,976 fica no tempo do áudio numa timeline 29,97 (CH-0017)', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  // 2 s de clipe = 60 quadros a 29,97: o último quadro tem de mostrar a fonte em ~2 s (luma ~120), não em 2,5 s (~140).
  const c = clip({ in: 0, out: 2, zoom: 1.18, zoomTo: 1.3 });
  const animado = lastFrameLuma(segmentVideoFilter({ width: 270, height: 480 }, c, 29.97, 270, 480), '24000/1001', 60);
  const fixo = lastFrameLuma(segmentVideoFilter({ width: 270, height: 480 }, clip({ in: 0, out: 2, zoom: 1.18 }), 29.97, 270, 480), '24000/1001', 60);
  assert.ok(Math.abs(animado - fixo) <= 3, `animado ${animado} x fixo ${fixo}`);
  assert.ok(Math.abs(animado - 119) <= 4, `último quadro do animado: luma ${animado}`);
});

test('zoom ancorado na largura com framing.x, fonte do mesmo aspecto da timeline (CH-0023)', () => {
  const src4k = { width: 2160, height: 3840 };
  // C3100: Leandro em x≈0,2, zoom 2× no plano aberto.
  assert.match(segmentVideoFilter(src4k, clip({ zoom: 2, framing: { x: 0.2 } }), 29.97, 1080, 1920), /crop=iw\/2:ih\/2:x=\(iw-ow\)\*0\.2000:y=\(ih-oh\)\*0\.5000,/);
  assert.match(segmentVideoFilter(src4k, clip({ zoom: 1, zoomTo: 2, framing: { x: 0.2, y: 0.4 } }), 29.97, 1080, 1920), /:x='\(iw-iw\/zoom\)\*0\.2000':y='\(ih-ih\/zoom\)\*0\.4000':/);
  // Sem x continua pelo centro; no reframe o x é do recorte, não do zoom.
  assert.match(segmentVideoFilter(src4k, clip({ zoom: 2 }), 29.97, 1080, 1920), /x=\(iw-ow\)\*0\.5000:/);
  assert.match(segmentVideoFilter({ width: 1920, height: 1080 }, clip({ zoom: 1.2, framing: { x: 0.2 } }), 30, 1080, 1920, '', true), /x='\(iw-ow\)\*0\.2000':y=0,crop=iw\/1\.2:ih\/1\.2:x=\(iw-ow\)\*0\.5000:/);
});

/** Coluna mais clara (0–1) de uma linha do 1º quadro que o filtro entrega. */
function brightestCol(vf: string): number {
  // Fonte 2160×3840 preta com uma faixa branca vertical de 8 px em x = 0,2 (432 px): o "Leandro".
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=2160x3840:d=1:r=30,drawbox=x=428:y=0:w=8:h=3840:color=white:t=fill', '-vf', `${vf},crop=iw:1:0:960,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, String(r.stderr));
  const px = r.stdout as Buffer;
  let best = 0;
  for (let i = 1; i < px.length; i++) if (px[i]! > px[best]!) best = i;
  return px[best]! > 128 ? best / px.length : -1;
}

test('no ffmpeg, zoom 2× com framing.x 0,2 mantém o Leandro parado em x 0,2; sem âncora ele sai do quadro (CH-0023)', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const src4k = { width: 2160, height: 3840 };
  const sem = brightestCol(segmentVideoFilter(src4k, clip({ zoom: 2 }), 30, 1080, 1920));
  const com = brightestCol(segmentVideoFilter(src4k, clip({ zoom: 2, framing: { x: 0.2 } }), 30, 1080, 1920));
  const animado = brightestCol(segmentVideoFilter(src4k, clip({ zoom: 2, zoomTo: 2.0001, framing: { x: 0.2 } }), 30, 1080, 1920));
  assert.equal(sem, -1, `sem âncora o Leandro devia sair do quadro: ${sem}`);
  assert.ok(Math.abs(com - 0.2) <= 0.01, `com âncora: ${com}`);
  assert.ok(Math.abs(animado - 0.2) <= 0.01, `zoompan com âncora: ${animado}`);
});
