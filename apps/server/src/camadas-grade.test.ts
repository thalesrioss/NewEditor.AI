/**
 * BL-0101 (FB-0152): lettering e legenda trocam no mesmo quadro, no grid round(t·fps) do resto do render (cortes da
 * faixa principal e `overlayFrames` do CH-0008). Antes a camada de texto trocava em ceil(t·fps) e o overlay de
 * arquivo em round(t·fps): lettering em ProRes ou B-roll em 2,74 s (quadro 82,2) entrava no 82 com a legenda ainda
 * na tela. Desenho de verdade pelo Chrome do export (renderTextLayer), com as legendas do buildCues como no render.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { buildCues, DEFAULT_CAPTIONS, letteringFromText, TEMPLATE_EXEMPLO, type LetteringSpec, type Timeline, type TextWord } from '@neweditor/core';
import { renderTextLayer } from './textlayer.ts';
import { overlayFrames } from './render.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-camadas-grade-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const W = 270;
const H = 480;
const FPS = 30;

/** Quadro `n` da camada de texto: máscara de pixels visíveis. */
function mask(mov: string, n: number): Uint8Array {
  const px = execFileSync('ffmpeg', ['-v', 'error', '-i', mov, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: W * H * 8 });
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = px[i * 4 + 3]! > 128 ? 1 : 0;
  return m;
}
/** Pixels diferentes entre duas máscaras. */
function diff(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < W * H; i++) if (a[i] !== b[i]) n++;
  return n;
}
const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);

describe('lettering e legenda no mesmo grid de quadros (BL-0101)', () => {
  const words: TextWord[] = [
    { w: 'um', start: 1.0, end: 1.4 },
    { w: 'dois', start: 1.5, end: 1.9 },
    { w: 'tres', start: 2.0, end: 2.6 },
    { w: 'quatro', start: 2.74, end: 3.2 },
    { w: 'cinco', start: 3.3, end: 3.8 },
  ];
  // Template do cliente (troca seca): o lettering aparece inteiro no 1º quadro, sem animação de entrada.
  const base = letteringFromText('titulo grande', 'cliente');
  const lettering: LetteringSpec = { ...base, words: base.words.map((w) => ({ ...w, destaque: false, line: 0 })), template: { ...TEMPLATE_EXEMPLO, size: 4 } };

  async function camada(at: number, name: string): Promise<string> {
    const ws = words.map((w) => (w.w === 'quatro' ? { ...w, start: at } : w));
    const tl = {
      fps: FPS,
      width: W,
      height: H,
      main: [{ id: 'c1', assetId: 'a1', in: 0, out: 5, by: 'human' }],
      overlays: [{ id: 'l1', trackId: 'V3', role: 'lettering', anchor: { assetId: 'a1', at }, duration: 1, source: { type: 'lettering', lettering }, by: 'human' }],
      removals: [],
      pins: [],
      captions: { ...DEFAULT_CAPTIONS, enabled: true },
    } as unknown as Timeline;
    const cues = buildCues(tl, { a1: ws }, tl.captions!);
    const work = path.join(tmp, name);
    fs.mkdirSync(work);
    const mov = await renderTextLayer({ W, H, fps: FPS, total: 5, cues, captions: tl.captions, letterings: [{ start: at, end: at + 1, spec: lettering }] }, work);
    assert.ok(mov);
    return mov;
  }

  for (const [at, f0] of [
    [2.74, 82],
    [2.76, 83],
  ] as const) {
    test(`lettering em ${at} s entra no quadro ${f0} (round), o mesmo do overlay de arquivo, e a legenda sai nele`, async () => {
      assert.equal(overlayFrames(at, at + 1, FPS).f0, f0, 'overlay de arquivo (ProRes, B-roll) no mesmo quadro');
      const mov = await camada(at, `l${f0}`);
      const legenda = mask(mov, 70); // 2,33 s: só a legenda "tres"
      const titulo = mask(mov, f0 + 10); // só o lettering
      assert.ok(count(legenda) > 100 && count(titulo) > 100 && diff(legenda, titulo) > 100, 'referências distintas');
      // Tolerância de 20 px: o destaque da palavra "tres" termina em 2,6 s e muda poucos pixels da legenda.
      const antes = mask(mov, f0 - 1);
      const no = mask(mov, f0);
      assert.ok(diff(antes, legenda) < 20 && diff(antes, titulo) > 500, `quadro ${f0 - 1} deveria ter só a legenda`);
      assert.ok(diff(no, titulo) < 20 && diff(no, legenda) > 500, `quadro ${f0} deveria ter só o lettering`);
    });
  }
});
