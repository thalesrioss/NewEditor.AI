/**
 * CH-0028: o quadro de conferência com `camadas` desenha por cima da V1 o B-roll daquele quadro, com o mesmo
 * enquadramento do render. A fonte do B-roll é gravada deitada com rotação 90 no metadado (como o C3100 vertical):
 * o enquadramento vale sobre a imagem já girada, igual ao render.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import type { Project } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-quadro-camadas-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { run, probe } = await import('./media.ts');
const { camadasNoQuadro, renderQuadro } = await import('./quadro.ts');

// V1: cinza liso, 2 s. B-roll: 384x216 deitado (metade esquerda vermelha, direita azul) com rotação 90 → 216x384 em pé.
const bruto = path.join(tmp, 'bruto.mp4');
await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=108x192:d=2:r=30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-y', bruto]);
const deitado = path.join(tmp, 'deitado.mp4');
await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=192x216:d=2:r=30', '-f', 'lavfi', '-i', 'color=c=blue:s=192x216:d=2:r=30', '-filter_complex', '[0][1]hstack', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-y', deitado]);
const broll = path.join(tmp, 'broll_rot90.mp4');
await run('ffmpeg', ['-v', 'error', '-display_rotation', '90', '-i', deitado, '-c', 'copy', '-y', broll]);

/** Cor média (r, g, b) de um PNG. */
async function cor(png: string): Promise<[number, number, number]> {
  const buf = await run('ffmpeg', ['-v', 'error', '-i', png, '-vf', 'scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', '-']);
  return [buf[0]!, buf[1]!, buf[2]!];
}

/** Cor de cima da fonte já girada (o que o editor vê no arquivo): o enquadramento y 0,25 com zoom 2 tem de dar ela. */
async function corDeCima(): Promise<[number, number, number]> {
  const png = path.join(tmp, 'cima.png');
  await run('ffmpeg', ['-v', 'error', '-i', broll, '-vf', 'crop=iw:ih/2:0:0', '-frames:v', '1', '-y', png]);
  return cor(png);
}

async function projeto(): Promise<Project> {
  const info = await probe(broll);
  return {
    id: 'prj_qc',
    name: 'qc',
    version: 1,
    assets: [
      { id: 'v1', kind: 'video', path: bruto, width: 108, height: 192, duration: 2, hasAudio: false },
      { id: 'br', name: 'broll_rot90.mp4', path: broll, ...info },
    ],
    timeline: {
      fps: 30,
      width: 108,
      height: 192,
      main: [{ id: 'c1', assetId: 'v1', in: 0, out: 2 }],
      overlays: [{ id: 'cob', trackId: 'V2', role: 'broll', anchor: { assetId: '@timeline', at: 1 }, duration: 0.5, source: { type: 'media', assetId: 'br', in: 0 }, framing: { x: 0.5, y: 0.25, zoom: 2 } }],
      removals: [],
      pins: [],
    },
  } as unknown as Project;
}

describe('quadro de conferência com camadas (CH-0028)', () => {
  test('a fonte com rotação 90 entra com as dimensões já giradas', async () => {
    const info = await probe(broll);
    assert.equal(info.width, 216);
    assert.equal(info.height, 384);
  });

  test('camadas: true desenha o B-roll enquadrado (metade de cima da fonte girada) e diz qual camada entrou', async () => {
    const p = await projeto();
    const dir = path.join(tmp, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    const q = await renderQuadro(p, dir, 1.2, undefined, true);
    assert.deepEqual(q.camadas?.map((c) => [c.id, c.role, c.trackId]), [['cob', 'broll', 'V2']]);
    assert.ok(Math.abs(q.camadas![0]!.fonte - 0.2) < 0.04, `fonte ${q.camadas![0]!.fonte}`);
    const [r, g, b] = await cor(path.join(dir, q.file));
    const [er, eg, eb] = await corDeCima();
    assert.ok(Math.abs(r - er) < 20 && Math.abs(g - eg) < 20 && Math.abs(b - eb) < 20, `quadro ${r},${g},${b} x fonte em cima ${er},${eg},${eb}`);
    assert.ok(Math.abs(r - b) > 150, `uma cor só, sem a outra metade: ${r},${g},${b}`);
  });

  test('sem camadas (padrão) e fora da janela do B-roll: só a V1 cinza', async () => {
    const p = await projeto();
    const dir = path.join(tmp, 'proj2');
    fs.mkdirSync(dir, { recursive: true });
    for (const q of [await renderQuadro(p, dir, 1.2), await renderQuadro(p, dir, 0.5, undefined, true)]) {
      const [r, g, b] = await cor(path.join(dir, q.file));
      assert.ok(Math.abs(r - g) < 12 && Math.abs(g - b) < 12, `cinza: ${r},${g},${b}`);
    }
  });

  test('janela no grid de quadros do render: entra no quadro 30 e sai no 45', async () => {
    const p = await projeto();
    const assets = new Map(p.assets.map((a) => [a.id, a]));
    assert.equal(camadasNoQuadro(p.timeline, assets, 29).length, 0);
    assert.equal(camadasNoQuadro(p.timeline, assets, 30).length, 1);
    assert.equal(camadasNoQuadro(p.timeline, assets, 44).length, 1);
    assert.equal(camadasNoQuadro(p.timeline, assets, 45).length, 0);
  });
});
