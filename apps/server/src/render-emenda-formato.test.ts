/**
 * CH-0029 e CH-0030: faixa principal com bruto de câmera (yuvj420p, faixa cheia) e intermediário ProRes (yuv420p,
 * faixa limitada). Os trechos saíam cada um no formato da fonte; o main.mp4 trocava de formato na emenda e o ffmpeg 9
 * refazia o grafo da passada final ali: o B-roll que atravessa a emenda sumia ou o render travava, e o loudnorm perdia
 * segundos da fala (fim da peça mudo). Render de verdade com fontes sintéticas nos dois formatos.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-emenda-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const camera = path.join(tmp, 'camera.mp4');
const prores = path.join(tmp, 'intermediario.mov');
const broll = path.join(tmp, 'broll.mp4');
let projectId = '';

before(async () => {
  // Bruto de câmera: faixa cheia (como o XAVC da Sony), tom contínuo de 300 Hz.
  ff(['-f', 'lavfi', '-i', 'color=red:s=90x160:r=30000/1001:d=6', '-f', 'lavfi', '-i', 'sine=f=300:r=48000:d=6', '-vf', 'format=yuvj420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-color_range', 'pc', '-c:a', 'pcm_s16le', '-shortest', camera]);
  // Intermediário ProRes: faixa limitada, bt709, tom de 500 Hz.
  ff(['-f', 'lavfi', '-i', 'color=green:s=90x160:r=30000/1001:d=3', '-f', 'lavfi', '-i', 'sine=f=500:r=48000:d=3', '-c:v', 'prores_ks', '-profile:v', '3', '-color_range', 'tv', '-colorspace', 'bt709', '-c:a', 'pcm_s16le', '-shortest', prores]);
  ff(['-f', 'lavfi', '-i', 'color=blue:s=90x160:r=30000/1001:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', broll]);
  const { store } = await import('./store.ts');
  await store.load();
  projectId = (await store.create('CH-0030', 'emenda de formatos')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('emenda entre bruto de câmera e intermediário ProRes (CH-0029, CH-0030)', () => {
  test('todo trecho sai em faixa legal, 4:2:2 10 bits, com as mesmas etiquetas bt709 (FB-0180)', async () => {
    const { segmentFormat, sourceRange, SEGMENT_CODEC } = await import('./render.ts');
    assert.equal(await sourceRange(camera), 'pc');
    assert.equal(await sourceRange(prores), 'tv');
    assert.match(segmentFormat().filter, /out_range=tv:out_color_matrix=bt709,format=yuv422p10le,setparams=/);
    assert.deepEqual(segmentFormat().tags, ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']);
    assert.ok(SEGMENT_CODEC.includes('prores_ks'));
  });

  test('B-roll atravessando a emenda aparece inteiro e a fala não perde nada', { timeout: 120_000 }, async () => {
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const cam = await ingest(projectId, camera, 'broll');
    const pr = await ingest(projectId, prores, 'broll');
    const b = await ingest(projectId, broll, 'broll');
    // Câmera 0–2, ProRes 0–3, câmera 2–6: emendas em 2 s e 5 s; peça de 9 s.
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: cam.id, in: 0, out: 2, by: 'human' }, { id: 'c2', assetId: pr.id, in: 0, out: 3, by: 'human' }, { id: 'c3', assetId: cam.id, in: 2, out: 6, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: 29.97 } });
    const trackId = store.get(projectId).timeline.tracks.find((t) => t.roles.includes('broll'))!.id;
    // B-roll de 3 s a partir de 3,5 s da peça (1,5 s do ProRes): atravessa a emenda dos 5 s.
    store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId, role: 'broll', anchor: { assetId: pr.id, at: 1.5 }, duration: 3, source: { type: 'media', assetId: b.id, in: 0 } } } });
    const res = await render(store.get(projectId), store.dir(projectId));
    const out = path.join(store.dir(projectId), res.file);

    // Fala: tom do começo ao fim, sem trecho mudo (o defeito deixava o fim em silêncio digital).
    const log = spawnSync('ffmpeg', ['-nostats', '-i', out, '-vn', '-af', 'silencedetect=n=-50dB:d=0.3', '-f', 'null', '-']).stderr.toString();
    assert.deepEqual(log.match(/silence_(start|end): [\d.]+/g) ?? [], [], 'trecho mudo na fala');

    // B-roll: azul do quadro 106 (3,55 s) ao 193 (6,45 s), inclusive depois da emenda dos 5 s.
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'crop=2:2:44:79,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const px = (i: number) => ({ r: raw[i * 12]!, g: raw[i * 12 + 1]!, b: raw[i * 12 + 2]! });
    for (const i of [106, 140, 160, 175, 190]) assert.ok(px(i).b > 150 && px(i).r < 100 && px(i).g < 100, `quadro ${i} deveria ser o B-roll: ${JSON.stringify(px(i))}`);
    // Depois do B-roll, a câmera de volta (vermelho).
    assert.ok(px(200).r > 150 && px(200).b < 100, `quadro 200 deveria ser a câmera: ${JSON.stringify(px(200))}`);
  });
});

describe('cor da 2ª câmera e fps da entrega (revisão FT 27/10)', () => {
  test('câmera Rec.709 sob fala S-Log3 não recebe a conversão da fala; projeto antigo sem cor lida segue a grade da fala', async () => {
    const { camLut } = await import('./render.ts');
    const luts = new Map([['fala', 'g0.cube']]);
    assert.equal(camLut('fala', 'cam', luts, new Map([['fala', {}]])), 'cam');
    assert.equal(camLut('fala', 'cam', luts, new Map()), 'fala');
    assert.equal(camLut('fala', undefined, luts, new Map()), 'fala');
  });

  test('fps de celular (30,011) sai no nominal; 29,97 sai 30000/1001; o gate espera o mesmo', async () => {
    const { fpsRational } = await import('./render.ts');
    const { fpsAlvo } = await import('./qc-tecnico.ts');
    assert.equal(fpsRational(30.011), '30');
    assert.equal(fpsRational(29.97), '30000/1001');
    assert.equal(fpsRational(29.981), '30');
    assert.equal(fpsAlvo(30.011), '30/1');
    assert.equal(fpsAlvo(29.97), '30000/1001');
    assert.equal(fpsAlvo(23.976), '24000/1001');
  });
});
