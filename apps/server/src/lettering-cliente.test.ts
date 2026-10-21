/**
 * CH-0012: o lettering do cliente (Guilherme: Helvetica Neue Bold, caixa alta, vermelho 213/24/0, tracking −0,06,
 * troca seca) não existia. Desenho de verdade pelo Chrome do export (renderTextLayer): o 1º e o último quadro são
 * iguais (sem animação), o vermelho do template aparece, e a fonte pedida é a que sai.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { letteringFromText, TEMPLATE_EXEMPLO, type LetteringSpec, type LetteringTemplate } from '@neweditor/core';
import { renderTextLayer } from './textlayer.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-lt-cliente-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const W = 540;
const H = 960;

/** Quadro `n` da camada de texto em RGBA cru. */
function frame(mov: string, n: number): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', mov, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: W * H * 8 });
}
function stats(px: Buffer) {
  let red = 0;
  let minX = W;
  let maxX = -1;
  for (let i = 0; i < W * H; i++) {
    const [r, g, b, a] = [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!, px[i * 4 + 3]!];
    if (a < 200) continue;
    const x = i % W;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    if (Math.abs(r - 213) < 12 && Math.abs(g - 24) < 12 && b < 14) red++;
  }
  return { red, width: maxX - minX + 1 };
}
async function layer(name: string, template: LetteringTemplate) {
  const base = letteringFromText('isso *não* funciona', 'cliente');
  const spec: LetteringSpec = { ...base, words: base.words.map((w) => ({ ...w, destaque: false, line: 0 })), template };
  const work = path.join(tmp, name);
  fs.mkdirSync(work);
  const mov = await renderTextLayer({ W, H, fps: 30, total: 1, cues: [], captions: undefined, letterings: [{ start: 0, end: 1, spec }] }, work);
  assert.ok(mov);
  return mov;
}

describe('lettering template do cliente (CH-0012)', () => {
  test('troca seca no vermelho do cliente, com a fonte pedida', { skip: !fs.existsSync('/System/Library/Fonts/HelveticaNeue.ttc') && 'sem Helvetica Neue' }, async () => {
    const mov = await layer('helvetica', { ...TEMPLATE_EXEMPLO, size: 4 });
    const a = frame(mov, 0);
    const z = frame(mov, 29);
    assert.ok(a.equals(z), '1º e último quadro iguais: sem animação');
    const s = stats(a);
    assert.ok(s.red > 800, `texto no vermelho 213/24/0 (${s.red} px)`);
    // A fonte do template vale: Impact (condensada) no mesmo texto ocupa outra largura.
    const c = stats(frame(await layer('impact', { ...TEMPLATE_EXEMPLO, size: 4, font: 'Impact' }), 0));
    assert.ok(Math.abs(c.width - s.width) > 20, `larguras ${s.width} e ${c.width}`);
    // Tracking −0,06 aperta o texto em relação a 0.
    const t0 = stats(frame(await layer('track0', { ...TEMPLATE_EXEMPLO, size: 4, tracking: 0 }), 0));
    assert.ok(t0.width > s.width + 10, `tracking: ${t0.width} > ${s.width}`);
  });
});
