/**
 * CH-0046 (Lia, thales-liquido/thales-bf-01): `add_overlay` na V3 com papel `lettering` e fonte de mídia (.mov ProRes
 * 4444 com alfa) era aceito e não aparecia no render (v310); com papel `motion` aparecia (v366). Render de verdade,
 * do jeito que a editora monta pela API (by agent, legenda ligada, keep_captions): fala vermelha, quadrado azul com
 * fundo transparente de 1 s no meio da V3. O centro do quadro tem que sair azul nos dois papéis.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-lettering-alpha-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const fala = path.join(tmp, 'fala.mp4');
const letreiro = path.join(tmp, 'letreiro.mov');

before(async () => {
  ff(['-f', 'lavfi', '-i', 'color=red:s=180x320:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=3', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);
  // ProRes 4444 com alfa: transparente em volta, quadrado azul opaco no centro (como o lettering do Motion Studio).
  ff(['-f', 'lavfi', '-i', 'color=black@0.0:s=180x320:r=30:d=2,format=rgba', '-f', 'lavfi', '-i', 'color=blue:s=60x60:r=30:d=2,format=rgba',
    '-filter_complex', '[0][1]overlay=60:130:format=auto,format=yuva444p10le', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', letreiro]);
  await (await import('./store.ts')).store.load();
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function renderCom(role: 'lettering' | 'motion'): Promise<{ px: (i: number) => { r: number; g: number; b: number }; skipped: string[] }> {
  const { ingest } = await import('./ingest.ts');
  const { store } = await import('./store.ts');
  const { render } = await import('./render.ts');
  const projectId = (await store.create(`CH-0046 ${role}`, 'lettering de mídia com alfa')).id;
  const f = await ingest(projectId, fala, 'fala');
  const l = await ingest(projectId, letreiro, 'broll');
  assert.ok(store.get(projectId).assets.find((a) => a.id === l.id)?.alpha, 'o .mov ProRes 4444 tem que entrar com alfa');
  const op = (o: unknown) => store.apply(projectId, { by: 'agent', op: o as never });
  op({ type: 'set_main', clips: [{ id: 'c1', assetId: f.id, in: 0, out: 3, by: 'agent' }] });
  op({ type: 'set_format', width: 180, height: 320, fps: 30 });
  op({ type: 'add_overlay', item: { trackId: 'V3', role, anchor: { assetId: f.id, at: 1 }, duration: 1, alpha: true, source: { type: 'media', assetId: l.id, in: 0 }, reason: `CH-0046 ${role}` } });
  const o = store.get(projectId).timeline.overlays.find((x) => x.reason === `CH-0046 ${role}`);
  assert.ok(o, 'o overlay tem que estar na timeline');
  op({ type: 'set_overlay_keep_captions', id: o.id, keep: true });
  const res = await render(store.get(projectId), store.dir(projectId));
  const out = path.join(store.dir(projectId), res.file);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'scale=180:320,crop=2:2:89:159,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
  return { px: (i: number) => ({ r: raw[i * 12]!, g: raw[i * 12 + 1]!, b: raw[i * 12 + 2]! }), skipped: res.skipped };
}

describe('lettering de mídia com alfa (ProRes 4444) no export (CH-0046)', () => {
  for (const role of ['motion', 'lettering'] as const) {
    test(`papel ${role}: o .mov com alfa aparece no tempo dele`, async () => {
      const { px, skipped } = await renderCom(role);
      const azul = (i: number) => px(i).b > 150 && px(i).r < 100;
      const vermelho = (i: number) => px(i).r > 150 && px(i).b < 100;
      assert.ok(vermelho(15), `quadro 15 deveria ser a fala: ${JSON.stringify(px(15))}`);
      for (const i of [31, 45, 58]) assert.ok(azul(i), `quadro ${i} deveria mostrar o ${role} (pulados: ${skipped.join('; ')}): ${JSON.stringify(px(i))}`);
      assert.ok(vermelho(75), `quadro 75 deveria voltar à fala: ${JSON.stringify(px(75))}`);
    });
  }
});
