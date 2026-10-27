/**
 * CH-0033: efeito por região (desfoque / limpeza com máscara de borda suave e tempo) no export, rodado no FFmpeg.
 * Fonte 120×200: parede cinza com grade branca fina (o texto claro do slide) e um quadrado preto grande (a pessoa).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { applyOp, TIMELINE_ANCHOR, type RegionFxPatch, type Timeline } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-rfx-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
const src = path.join(tmp, 'src.mp4');
const { regionFxGraph } = await import('./region-fx.ts');
const W = 120;
const H = 200;

before(() => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=gray:size=${W}x${H}:rate=30:d=2,drawgrid=w=8:h=8:t=2:c=white,drawbox=x=40:y=80:w=32:h=32:color=black:t=fill`, '-pix_fmt', 'yuv420p', src]);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const base: Timeline = { fps: 30, width: W, height: H, main: [{ id: 'c', assetId: 'a', in: 0, out: 2, by: 'agent' }], removals: [], pins: [], tracks: [], overlays: [] };

function comFx(...fx: RegionFxPatch[]): Timeline {
  return fx.reduce((t, f) => applyOp(t, { type: 'set_region_fx', fx: f }, 'human'), base);
}

/** Luma de cada quadro (W×H, gray) depois do filtro. */
function quadros(tl: Timeline): Buffer[] {
  const g = regionFxGraph(tl, W, H, 30, '0:v');
  const graph = [...g.parts, `[${g.out}]format=gray[out]`].join(';');
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-filter_complex', graph, '-map', '[out]', '-f', 'rawvideo', '-'], { maxBuffer: 64 << 20 });
  const out: Buffer[] = [];
  for (let i = 0; i + W * H <= buf.length; i += W * H) out.push(buf.subarray(i, i + W * H));
  return out;
}
const px = (f: Buffer, x: number, y: number) => f[y * W + x]!;
// (16,40) é linha branca da grade; (56,96) é o centro do quadrado preto.
const LINHA = { x: 16, y: 40 };
const QUADRADO = { x: 56, y: 96 };
const FORA = { x: 104, y: 160 };

test('limpeza só no retângulo e só no trecho; o resto do quadro fica igual', () => {
  const q = quadros(comFx({ start: 0.5, end: 1.5, rect: { x: 0, y: 0.1, w: 0.7, h: 0.5 }, mode: 'clean', strength: 1, feather: 0 }));
  assert.equal(q.length, 60);
  assert.ok(px(q[30]!, LINHA.x, LINHA.y) < 150, `linha do slide limpa: ${px(q[30]!, LINHA.x, LINHA.y)}`);
  assert.ok(px(q[5]!, LINHA.x, LINHA.y) > 200, 'antes do trecho continua a linha');
  assert.ok(px(q[55]!, LINHA.x, LINHA.y) > 200, 'depois do trecho continua a linha');
  assert.ok(px(q[30]!, FORA.x, FORA.y) > 200, 'fora do retângulo continua a linha');
});

test('proteger escuros: o quadrado preto (pessoa) fica, a grade fina (texto) some', () => {
  const sem = quadros(comFx({ start: 0.5, end: 1.5, rect: { x: 0, y: 0.1, w: 0.7, h: 0.5 }, mode: 'blur', strength: 1, feather: 0 }));
  const com = quadros(comFx({ start: 0.5, end: 1.5, rect: { x: 0, y: 0.1, w: 0.7, h: 0.5 }, mode: 'blur', strength: 1, feather: 0, protectDark: 0.3 }));
  assert.ok(px(sem[30]!, QUADRADO.x - 16, QUADRADO.y) > 40, 'sem proteção, a borda do quadrado borra');
  // A chave cresce uns pixels para dentro do escuro (leva a borda suave das letras); 6 px para dentro já é intacto.
  assert.ok(px(com[30]!, QUADRADO.x - 10, QUADRADO.y) < 30, `com proteção, o quadrado fica: ${px(com[30]!, QUADRADO.x - 10, QUADRADO.y)}`);
  assert.ok(px(sem[30]!, QUADRADO.x - 10, QUADRADO.y) > px(com[30]!, QUADRADO.x - 10, QUADRADO.y) + 15, 'e sem proteção o mesmo ponto borra');
  assert.ok(px(com[30]!, LINHA.x, LINHA.y) < 215, `com proteção, a linha fina ainda desfoca: ${px(com[30]!, LINHA.x, LINHA.y)}`);
});

test('borda suave: na linha do retângulo o efeito entra pela metade', () => {
  const tl = comFx({ start: 0, end: 2, rect: { x: 0.5, y: 0, w: 0.5, h: 1 }, mode: 'clean', strength: 1, feather: 0.05 });
  const f = quadros(tl)[30]!;
  // Linha vertical da grade em x=56 (borda do retângulo em x=60) e em x=104 (dentro, longe da borda).
  assert.ok(px(f, 104, 41) < 150, `dentro: limpo (${px(f, 104, 41)})`);
  assert.ok(px(f, 8, 41) > 200, 'fora, longe: intacto');
});

test('sem efeito: o grafo não muda', () => {
  assert.deepEqual(regionFxGraph(base, W, H, 30, '0:v'), { parts: [], out: '0:v' });
});

test('op: cria, altera só o enviado, recusa retângulo vazio e apaga', () => {
  let t = comFx({ start: 0.5, end: 1.5, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } });
  const fx = t.regionFx![0]!;
  assert.deepEqual(fx.anchor, { assetId: 'a', at: 0.5 });
  assert.equal(fx.duration, 1);
  assert.equal(fx.mode, 'blur');
  t = applyOp(t, { type: 'set_region_fx', id: fx.id, fx: { mode: 'clean', protectDark: 0.25 } }, 'human');
  assert.deepEqual(t.regionFx![0]!.rect, fx.rect);
  assert.equal(t.regionFx![0]!.mode, 'clean');
  assert.equal(t.regionFx![0]!.protectDark, 0.25);
  assert.throws(() => applyOp(t, { type: 'set_region_fx', fx: { start: 0, end: 1, rect: { x: 0, y: 0, w: 0, h: 0.2 } } }, 'human'), /retângulo vazio/);
  assert.throws(() => applyOp(t, { type: 'set_region_fx', fx: { rect: { x: 0, y: 0, w: 0.2, h: 0.2 } } }, 'human'), /falta o início/);
  t = applyOp(t, { type: 'set_region_fx', id: fx.id, fx: null }, 'human');
  assert.equal(t.regionFx, undefined);
  // Âncora de timeline também vale (efeito que não segue a fala).
  const t2 = applyOp(base, { type: 'set_region_fx', fx: { anchor: { assetId: TIMELINE_ANCHOR, at: 1 }, duration: 0.5, rect: { x: 0, y: 0, w: 1, h: 1 } } }, 'agent');
  assert.equal(t2.regionFx![0]!.duration, 0.5);
});

test('quadro de conferência: só o efeito ativo no instante, sem rampa, no tempo 0', async () => {
  const { regioesNoQuadro } = await import('./quadro.ts');
  const tl = comFx({ start: 0.5, end: 1.5, rect: { x: 0, y: 0.1, w: 0.7, h: 0.5 }, fade: 0.2 }, { start: 1.6, end: 1.9, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } });
  const q = regioesNoQuadro(tl, 1);
  assert.equal(q.regionFx!.length, 1);
  assert.deepEqual(q.regionFx![0]!.anchor, { assetId: TIMELINE_ANCHOR, at: 0 });
  assert.equal(q.regionFx![0]!.fade, undefined);
  assert.equal(regioesNoQuadro(tl, 0.2).regionFx!.length, 0);
  const g = regionFxGraph(q, W, H, 30, 'b0');
  assert.match(g.parts.join(';'), /trim=start=0\.000000/);
});
