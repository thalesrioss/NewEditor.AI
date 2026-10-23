/**
 * BL-0102: lettering em escada (padrão Daniel Sun, FB-0153). `lineX` dá a borda esquerda de cada linha; o desenho é
 * o mesmo HTML na prévia e no export, então medimos no quadro do export (Chrome do renderTextLayer). Sem `lineX`, o
 * HTML de todos os estilos é byte a byte o de antes (hash gerado no código anterior à mudança).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { letteringFrameHtml, letteringFromText, letteringLineX, LETTERING_STYLES, TEMPLATE_EXEMPLO, type LetteringSpec, type LetteringStyleId } from '@neweditor/core';
import { renderTextLayer } from './textlayer.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-lt-escada-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const W = 540;
const H = 960;

/** Quadro `n` da camada de texto em RGBA cru. */
function frame(mov: string, n: number): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', mov, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: W * H * 8 });
}

/** Faixas de linhas com pixel opaco, de cima para baixo, com a borda esquerda e direita de cada uma. */
function bands(px: Buffer) {
  const out: { top: number; minX: number; maxX: number }[] = [];
  let cur: (typeof out)[number] | null = null;
  for (let y = 0; y < H; y++) {
    let minX = W;
    let maxX = -1;
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3]! < 200) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (maxX < 0) {
      cur = null;
      continue;
    }
    if (!cur) out.push((cur = { top: y, minX, maxX }));
    else {
      cur.minX = Math.min(cur.minX, minX);
      cur.maxX = Math.max(cur.maxX, maxX);
    }
  }
  return out;
}

/** Três linhas, uma palavra cada (começam em T: quase sem recuo próprio da letra). */
function escada(estilo: LetteringStyleId, lineX: LetteringSpec['lineX'], extra: Partial<LetteringSpec> = {}): LetteringSpec {
  const words = ['TUDO', 'TEM', 'TEMPO'].map((text, i) => ({ text, at: 0.05, line: i, destaque: false }));
  return { estilo, words, seed: 1, sfx: false, y: 0.5, lineX, ...extra };
}

async function quadro(name: string, spec: LetteringSpec, n = 20) {
  const work = path.join(tmp, name);
  fs.mkdirSync(work);
  const mov = await renderTextLayer({ W, H, fps: 30, total: 1, cues: [], captions: undefined, letterings: [{ start: 0, end: 1, spec }] }, work);
  assert.ok(mov);
  return bands(frame(mov, n));
}

describe('lettering em escada (BL-0102)', () => {
  test('3 linhas em x 0,1 / 0,3 / 0,5: borda esquerda de cada uma no export a ±4 px', async () => {
    for (const [estilo, extra] of [
      ['cliente', { template: { ...TEMPLATE_EXEMPLO, color: '#FFFFFF', tracking: 0, size: 5 } }],
      ['apple', {}],
    ] as const) {
      const b = await quadro(estilo, escada(estilo, [0.1, 0.3, 0.5], extra));
      assert.equal(b.length, 3, `${estilo}: 3 linhas (${JSON.stringify(b)})`);
      b.forEach((l, i) => {
        const want = [0.1, 0.3, 0.5][i]! * W;
        assert.ok(Math.abs(l.minX - want) <= 4, `${estilo} linha ${i + 1}: borda ${l.minX} px, esperado ${want} ±4`);
        assert.ok(l.maxX < W, `${estilo} linha ${i + 1} dentro do quadro`);
      });
    }
  });

  test('linha sem x segue o alinhamento; linha longa em escada é reduzida para caber', async () => {
    const tpl = { ...TEMPLATE_EXEMPLO, color: '#FFFFFF', tracking: 0, size: 6 };
    const centro = await quadro('meio', escada('cliente', [0.1, null, 0.5], { template: tpl }));
    const meio = centro[1]!;
    assert.ok(Math.abs((meio.minX + meio.maxX) / 2 - W / 2) <= 6, `linha sem x centrada (${meio.minX}–${meio.maxX})`);
    const longa = escada('cliente', [0.6], { template: tpl, words: [{ text: 'TRANSFORMACAO TOTAL', at: 0.05, line: 0 }] });
    const [l] = await quadro('longa', longa);
    assert.ok(l && Math.abs(l.minX - 0.6 * W) <= 4 && l.maxX < W, `linha longa de ${l?.minX} a ${l?.maxX}, dentro de ${W}`);
  });

  test('sem lineX, o HTML de todos os estilos é o de antes (regressão)', () => {
    // sha256 (16 hex) de 4 quadros por estilo e alinhamento, gerado no office/bancada-chamados 82a750d, antes do BL-0102.
    const antes: Record<string, string> = JSON.parse(fs.readFileSync(new URL('./fixtures/lettering-html-antes.json', import.meta.url), 'utf8'));
    for (const id of Object.keys(LETTERING_STYLES) as LetteringStyleId[]) {
      for (const al of [undefined, 'left', 'right'] as const) {
        const s = { ...letteringFromText('o seu *cérebro* ainda procura ameaças', id), align: al, x: al ? undefined : 0.4, template: id === 'cliente' ? TEMPLATE_EXEMPLO : undefined };
        const html = [0.05, 0.3, 0.9, 1.9].map((t) => letteringFrameHtml(s, t, 2, 56.25, 0.72)).join('|');
        assert.equal(createHash('sha256').update(html).digest('hex').slice(0, 16), antes[`${id}/${al ?? 'center'}`], `${id}/${al ?? 'center'}`);
        // lineX vazio ou só com nulos é o mesmo que não ter.
        assert.equal([0.05, 0.3, 0.9, 1.9].map((t) => letteringFrameHtml({ ...s, lineX: [null, null] }, t, 2, 56.25, 0.72)).join('|'), html);
      }
    }
  });

  test('lineX conferido: só números finitos, presos entre 0 e 1', () => {
    const spec = escada('cliente', [1.7, Number.NaN, -0.2, '0.3' as unknown as number]);
    assert.deepEqual(letteringLineX(spec, 5), [1, undefined, 0, undefined, undefined]);
    assert.deepEqual(letteringLineX({ ...spec, lineX: 'x' as unknown as number[] }, 2), [undefined, undefined]);
    const html = letteringFrameHtml(escada('cliente', [0.25, 0.4, 0.55]), 0.5, 1, 56.25, 0.5);
    assert.match(html, /padding-left:25%/);
    assert.match(html, /padding-left:55%/);
    assert.doesNotMatch(html, /translateX/);
  });
});
