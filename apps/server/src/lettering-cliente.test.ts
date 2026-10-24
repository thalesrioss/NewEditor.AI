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

/** Quanto de "escuro" a camada põe em volta da letra (soma do alfa dos pixels escuros): sombra e contorno. */
function escuro(px: Buffer) {
  let s = 0;
  for (let i = 0; i < W * H; i++) {
    const [r, g, b, a] = [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!, px[i * 4 + 3]!];
    if (r + g + b < 150) s += a;
  }
  return s;
}

describe('lettering template do cliente: sombra e contorno (CH-0034)', () => {
  test('dourado #E4B249: intensidade 2 escurece mais que 1, contorno fino desenha borda, sem mudar a cor da letra', async () => {
    const gold = { font: 'Helvetica Neue', weight: 700, color: '#E4B249', size: 4 };
    const um = frame(await layer('sombra1', { ...gold, shadow: true }), 0);
    const dois = frame(await layer('sombra2', { ...gold, shadow: 2 }), 0);
    const contorno = frame(await layer('contorno', { ...gold, shadow: 0, stroke: 0.03 }), 0);
    const nada = frame(await layer('nada', { ...gold, shadow: 0 }), 0);
    const [e1, e2, ec, e0] = [escuro(um), escuro(dois), escuro(contorno), escuro(nada)];
    assert.ok(e2 > e1 * 1.4, `sombra 2× (${e2}) bem mais forte que 1× (${e1})`);
    assert.ok(ec > e0 + 100_000, `contorno desenha borda escura (${ec} contra ${e0})`);
    const dourado = (px: Buffer) => {
      let n = 0;
      for (let i = 0; i < W * H; i++) if (px[i * 4 + 3]! > 240 && Math.abs(px[i * 4]! - 0xe4) < 10 && Math.abs(px[i * 4 + 1]! - 0xb2) < 10 && Math.abs(px[i * 4 + 2]! - 0x49) < 10) n++;
      return n;
    };
    // Contorno fica por trás do preenchimento (paint-order): o miolo dourado continua quase todo.
    assert.ok(dourado(contorno) > dourado(nada) * 0.8, `miolo dourado ${dourado(contorno)} de ${dourado(nada)}`);
  });
});
