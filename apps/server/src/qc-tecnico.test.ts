/**
 * QC técnico (gate de entrega, frente Q3 de 27/10/2026): regras puras com números conhecidos e o gate inteiro em
 * vídeos sintéticos curtos (lavfi): um na linha de entrega, um fora dela (faixa cheia sem etiqueta, imagem parada e
 * câmera lenta sob tom contínuo) e um cinza.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Clip, MediaAsset, OverlayItem, Project } from '@neweditor/core';
import { clipScale, overlayScale } from '@neweditor/core';
const TL = { width: 1080, height: 1920 };
import { achadosPerfil, achadosProjeto, achadosMovimento, amostrarY, assinaturaDe, medirSatavg, camaraLenta, clipeSony, cortesDe, niveis, origemDoNome, qcTecnico, trechosDeFala } from './qc-tecnico.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-qctec-'));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const bom = path.join(tmp, 'bom.mp4');
const ruim = path.join(tmp, 'ruim.mp4');
const cinza = path.join(tmp, 'cinza.mp4');
const base = path.join(tmp, 'base.mov');
const TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const TOM = 'sine=f=300:r=48000:d=4';
// No FFmpeg 9 o `-color_primaries`/`-color_trc` da saída perde para a etiqueta do quadro (unknown): só o setparams grava.
const BT709 = 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709';

function sinteticos(): void {
  // Imagem colorida com ruído temporal (todo quadro mexe, como câmera), 4 s.
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=30000/1001:d=4', '-vf', 'noise=alls=12:allf=t+u', '-c:v', 'ffv1', base]);
  ff(['-i', base, '-f', 'lavfi', '-i', TOM, '-vf', `scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,${BT709}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', ...TAGS, '-r', '30000/1001', '-c:a', 'aac', '-ar', '48000', '-shortest', bom]);
  // Fora da linha: faixa cheia sem etiqueta, quadros 30–44 parados (0,5 s) e 1,0–2,6 s em câmera lenta 1,5× (setpts + fps).
  const fc = '[0:v]split[a][b];[a]trim=end_frame=75,setpts=PTS-STARTPTS,split[a0][ar];[a0][ar]freezeframes=first=30:last=44:replace=29[a1];[b]trim=start_frame=75:end_frame=107,setpts=(PTS-STARTPTS)*1.5,fps=30000/1001[b1];[a1][b1]concat=n=2:v=1:a=0,scale=out_range=pc,format=yuvj420p[v]';
  ff(['-i', base, '-f', 'lavfi', '-i', TOM, '-filter_complex', fc, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-r', '30', '-c:a', 'aac', '-ar', '44100', '-shortest', ruim]);
  ff(['-i', base, '-vf', 'hue=s=0.05,scale=out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', ...TAGS, cinza]);
}
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('regras puras', () => {
  test('perfil: cada etiqueta fora da linha vira um achado; 2997/100 não é 30000/1001', () => {
    const ok = achadosPerfil({ duration: 1, video: { codec_name: 'h264', pix_fmt: 'yuv420p', color_range: 'tv', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', r_frame_rate: '30000/1001', avg_frame_rate: '30000/1001' }, audio: { codec_name: 'aac', sample_rate: '48000' } });
    assert.ok(ok.every((a) => a.ok), JSON.stringify(ok.filter((a) => !a.ok)));
    const r = achadosPerfil({ duration: 1, video: { codec_name: 'h264', pix_fmt: 'yuvj420p', color_range: 'pc', r_frame_rate: '2997/100', avg_frame_rate: '2997/100' }, audio: { codec_name: 'aac', sample_rate: '44100' } });
    assert.deepEqual(r.filter((a) => !a.ok).map((a) => a.regra).sort(), ['perfil:audio_rate', 'perfil:color_primaries', 'perfil:color_range', 'perfil:color_transfer', 'perfil:colorspace', 'perfil:fps', 'perfil:pix_fmt']);
    // fps da timeline manda: 25 → 25/1.
    assert.ok(achadosPerfil({ duration: 1, video: { r_frame_rate: '25/1', avg_frame_rate: '25/1' } }, 25).find((a) => a.regra === 'perfil:fps')!.ok);
  });

  test('níveis: fração de Y fora de 16–235', () => {
    const y = new Uint8Array(1000).fill(128);
    y.fill(5, 0, 4);
    assert.equal(niveis(y).baixo, 0.004);
    y.fill(250, 4, 8);
    assert.equal(niveis(y).ymax, 250);
    assert.equal(Math.round((niveis(y).baixo + niveis(y).alto) * 1000), 8);
  });

  test('fala pela energia, cortes e cadência de quadro repetido', () => {
    const db = new Float32Array(400).fill(-80);
    db.fill(-20, 100, 200); // 1,0–2,0 s
    db.fill(-20, 210, 300); // vão de 0,1 s junta
    assert.deepEqual(trechosDeFala(db).map((t) => [t.start, t.end]), [[1, 3]]);
    const d = Array.from({ length: 120 }, () => 4);
    d[60] = 40; // corte
    for (let i = 70; i < 100; i += 3) d[i] = 0.05; // 1,5× por repetição
    assert.deepEqual(cortesDe(d, 30), [2]);
    const l = camaraLenta(d, 30);
    assert.equal(l.length, 1);
    assert.ok(l[0]!.start < 2.34 && l[0]!.end > 3.2);
    // Chicote (diferença alta dos dois lados) não é corte.
    assert.deepEqual(cortesDe(Array.from({ length: 30 }, (_, i) => (i > 10 && i < 20 ? 25 : 4)), 30), []);
    const m = achadosMovimento([{ start: 1, end: 1.3 }, { start: 3.5, end: 3.9 }], l, [{ start: 0, end: 3.2 }]);
    assert.deepEqual(m.filter((a) => !a.ok).map((a) => a.regra), ['freeze-sob-fala', 'camera-lenta']);
  });

  test('nome: clipe Sony e tempo de origem', () => {
    assert.equal(clipeSony('/x/C3050_B_86s3_cob2.mov'), 'C3050');
    assert.equal(origemDoNome('C3050_B_86s3_cob2.mov'), 86.3);
    assert.equal(origemDoNome('C3100_cob_43s60_b.mov'), 43.6);
    assert.equal(origemDoNome('C3100_66s_punchin_v2.mov'), 66);
    assert.equal(origemDoNome('v3_A.mov'), null);
    assert.equal(clipeSony('titulo.mov'), null);
  });

  test('escala efetiva: bruto vertical 2160 a zoom 3 = 1,5×; recorte 9:16 do 4K deitado = 1080/1215 × zoom', () => {
    const c = (zoom: number, extra: Partial<Clip> = {}): Clip => ({ id: 'c', assetId: 'a', in: 0, out: 1, by: 'agent', zoom, ...extra });
    assert.equal(clipScale({ width: 2160, height: 3840 }, c(3), TL), 1.5);
    assert.ok(Math.abs(clipScale({ width: 3840, height: 2160 }, c(1.5, { framing: { x: 0.5 } }), { ...TL, reframe: true })! - (1080 / 1215) * 1.5) < 0.01);
    assert.equal(clipScale({ width: 2160, height: 3840 }, c(2, { zoomTo: 2.6 }), TL), 1.3);
    assert.ok(Math.abs(overlayScale({ width: 2160, height: 3840 }, { x: 0.5, y: 0.5, zoom: 2.2 }, TL)! - 1.1) < 1e-9);
    assert.equal(overlayScale({ width: 1080, height: 1920 }, {}, TL), 1);
  });

  test('projeto: escala, velocidade, boca de outro momento, cobertura embutida e câmera sem sincronia medida', () => {
    const v = (id: string, p: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({ id, name: path.basename(p), path: p, kind: 'video', duration: 100, width: 2160, height: 3840, fps: 29.97, hasAudio: true, ...extra });
    const assets = [
      v('fala', '/b/C3039.MP4', { role: 'fala' }),
      v('camA', '/e/C3039_cam9x16_A.mov', { role: 'cam', width: 1350, height: 2400, syncOffset: 0 }),
      v('camB', '/e/C3039_cam9x16_B.mov', { role: 'cam', width: 1350, height: 2400, syncOffset: -2, syncConfianca: 0.93, syncFala: 'fala' }),
      v('cob', '/i/C3039_B_40s0_cob.mov', { role: 'broll', width: 1080, height: 1920 }),
      v('ins', '/i/insert.mp4', { role: 'broll', width: 1080, height: 1920 }),
    ];
    const main: Clip[] = [
      { id: 'c1', assetId: 'fala', in: 10, out: 14, by: 'agent', zoom: 3 }, // 0–4: 1,5×
      { id: 'c2', assetId: 'fala', in: 20, out: 22, by: 'agent', cam: 'camA' }, // 4–6
      { id: 'c3', assetId: 'fala', in: 30, out: 32, by: 'agent', cam: 'camB', speed: 0.5 }, // 6–10
      { id: 'c4', assetId: 'cob', in: 0, out: 3, by: 'agent' }, // 10–13
    ];
    const ov = (id: string, assetId: string, at: number, srcIn: number, d: number): OverlayItem => ({ id, trackId: 'V2', role: 'broll', anchor: { assetId: 'fala', at }, duration: d, source: { type: 'media', assetId, in: srcIn }, by: 'agent' });
    const overlays = [ov('mesmo', 'fala', 11, 11, 0.5), ov('outro', 'fala', 12, 50, 0.5), ov('ins', 'ins', 21, 0, 0.5)];
    const p = { assets, timeline: { fps: 29.97, width: 1080, height: 1920, main, removals: [], pins: [], tracks: [], overlays } } as unknown as Project;
    const { achados } = achadosProjeto(p, { cortes: [11.5], fala: [{ start: 0, end: 13 }] });
    const falhas = achados.filter((a) => !a.ok);
    const de = (r: string) => falhas.filter((a) => a.regra === r);
    assert.equal(de('escala').length, 1);
    assert.match(de('escala')[0]!.onde!, /clipe 1/);
    assert.equal(de('velocidade').length, 1);
    const boca = de('boca-outro-momento');
    assert.equal(boca.length, 2, JSON.stringify(boca));
    assert.ok(boca.some((a) => a.onde!.startsWith('outro') && /Δ 38,00 s/.test(a.medido)));
    assert.ok(boca.some((a) => /clipe 4/.test(a.onde!) && /11,50/.test(a.medido)));
    // camA: offset 0 sem confiança reprova; camB (medida, 0,93) passa.
    const sync = achados.filter((a) => a.regra === 'sync-camera');
    assert.deepEqual(sync.map((a) => [a.onde!.split(' ')[0], a.ok]), [['C3039_cam9x16_A.mov', false], ['C3039_cam9x16_B.mov', true]]);
    // Sem fala embaixo, a cobertura de outro momento não reprova.
    assert.equal(achadosProjeto(p, { fala: [{ start: 3, end: 13 }] }).achados.filter((a) => a.regra === 'boca-outro-momento' && !a.ok && a.onde!.startsWith('outro')).length, 0);
  });
  test('flash de entrada não é corte embutido (FB-0189): a volta do negativo, 2 a 3 quadros depois do corte, é da timeline', () => {
    const fala: MediaAsset = { id: 'fala', name: 'davi-lo.mp4', path: '/b/davi-lo.mp4', kind: 'video', duration: 90, width: 1080, height: 1920, fps: 30, hasAudio: true, role: 'fala' };
    const main: Clip[] = [
      { id: 'c1', assetId: 'fala', in: 0, out: 20, by: 'human' },
      { id: 'c2', assetId: 'fala', in: 24, out: 50, by: 'human', flash: true, flashSfx: false },
    ];
    const p = { assets: [fala], timeline: { fps: 30, width: 1080, height: 1920, main, removals: [], pins: [], tracks: [], overlays: [] } } as unknown as Project;
    const med = (cortes: number[]) => achadosProjeto(p, { cortes, fala: [{ start: 0, end: 46 }] }).achados.filter((a) => a.regra === 'corte-embutido' && !a.ok);
    // O que o detector achou no render do Leo: corte em 20,0 (timeline) e o fim do flash em 20,067 e 20,10.
    assert.deepEqual(med([20, 20 + 2 / 30, 20.1]), []);
    // Sem flash no clipe, a mesma troca de plano 0,2 s depois do corte segue reprovando.
    assert.equal(med([20.2]).length, 1);
    const semFlash = { ...p, timeline: { ...p.timeline, main: [main[0]!, { ...main[1]!, flash: undefined }] } } as unknown as Project;
    assert.equal(achadosProjeto(semFlash, { cortes: [20 + 4 / 30], fala: [{ start: 0, end: 46 }] }).achados.filter((a) => a.regra === 'corte-embutido' && !a.ok).length, 1);
  });

  test('boca-outro-momento: cauda de fala do clipe anterior no 1º quadro do ar coberto não reprova (CH-0044)', () => {
    const v = (id: string, p: string): MediaAsset => ({ id, name: path.basename(p), path: p, kind: 'video', duration: 100, width: 1080, height: 1920, fps: 29.97, hasAudio: true, role: 'fala' });
    const assets = [v('fala', '/b/C3070.MP4')];
    // c1 termina em 16,42 do bruto (8,42 na timeline); c2 é o ar da sala de 21,08, coberto pela continuação do plano (16,42).
    const main: Clip[] = [
      { id: 'c1', assetId: 'fala', in: 8, out: 16.42, by: 'agent' },
      { id: 'c2', assetId: 'fala', in: 21.08, out: 25, by: 'agent' },
    ];
    const ar: OverlayItem = { id: 'c_ar', trackId: 'V2', role: 'broll', anchor: { assetId: 'fala', at: 21.08 }, duration: 0.26, source: { type: 'media', assetId: 'fala', in: 16.42 }, by: 'agent' };
    const p = { assets, timeline: { fps: 29.97, width: 1080, height: 1920, main, removals: [], pins: [], tracks: [], overlays: [ar] } } as unknown as Project;
    const boca = (fim: number) => achadosProjeto(p, { fala: [{ start: 0, end: fim }] }).achados.filter((a) => a.regra === 'boca-outro-momento' && !a.ok);
    // Cauda de 10 ms do 'cara?' depois do corte (trechosDeFala termina em 8,43): passa.
    assert.equal(boca(8.43).length, 0, JSON.stringify(boca(8.43)));
    // Contraprova: fala que continua no clipe de baixo segue reprovando.
    assert.equal(boca(8.6).length, 1);
  });

  test('escala: bruto nativo 720×1280 sem zoom numa entrega 1080×1920 vira aviso; zoom por cima, recorte e fonte menor seguem reprovando (CH-0045)', () => {
    const v = (id: string, w: number, h: number): MediaAsset => ({ id, name: `IMG_${id}.MOV`, path: `/b/IMG_${id}.MOV`, kind: 'video', duration: 100, width: w, height: h, fps: 30, hasAudio: true, role: 'fala' });
    const proj = (a: MediaAsset, main: Clip[], reframe = false) => ({ assets: [a], timeline: { fps: 30, width: 1080, height: 1920, reframe, main, removals: [], pins: [], tracks: [], overlays: [] } }) as unknown as Project;
    const c = (extra: Partial<Clip> = {}): Clip => ({ id: 'c', assetId: 'a', in: 0, out: 4, by: 'agent', ...extra });
    const escala = (p: Project) => achadosProjeto(p, { fala: [{ start: 0, end: 4 }] });
    // thales-bf-01: só o iPhone 720×1280, zoom 1 = 1,5×.
    const ok = escala(proj(v('a', 720, 1280), [c(), c({ id: 'c2', in: 5, out: 8 })]));
    assert.deepEqual(ok.achados.filter((a) => a.regra === 'escala').map((a) => a.ok), [true]);
    assert.equal(ok.avisos.filter((a) => /escala nativa de IMG_a\.MOV: 1,50×/.test(a)).length, 1, JSON.stringify(ok.avisos));
    // Punch-in por cima do bruto pequeno reprova.
    assert.equal(escala(proj(v('a', 720, 1280), [c({ zoom: 1.1 })])).achados.filter((a) => a.regra === 'escala' && !a.ok).length, 1);
    // Fonte ainda menor (540×960 = 2×) reprova.
    assert.equal(escala(proj(v('a', 540, 960), [c()])).achados.filter((a) => a.regra === 'escala' && !a.ok).length, 1);
    // Recorte 9:16 de um 1920×1080 deitado (1,78×) é escolha de enquadramento: reprova.
    assert.equal(escala(proj(v('a', 1920, 1080), [c({ framing: { x: 0.5 } })], true)).achados.filter((a) => a.regra === 'escala' && !a.ok).length, 1);
  });

  test('escala: B-roll 1920×1080 em cover vira aviso, imagem 1080×1080 fica fora; cobertura do falante segue reprovando', () => {
    const v = (id: string, p: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({ id, name: path.basename(p), path: p, kind: 'video', duration: 100, width: 2160, height: 3840, fps: 29.97, hasAudio: true, ...extra });
    const assets = [
      v('fala', '/b/C3039.MP4', { role: 'fala' }),
      v('br', '/i/rua.mp4', { role: 'broll', width: 1920, height: 1080, hasAudio: false }),
      v('img', '/i/print.png', { kind: 'image', role: 'broll', width: 1080, height: 1080, hasAudio: false }),
    ];
    const ov = (id: string, assetId: string, at: number, framing?: OverlayItem['framing']): OverlayItem => ({ id, trackId: 'V2', role: 'broll', anchor: { assetId: 'fala', at }, duration: 1, source: { type: 'media', assetId, in: 0 }, by: 'agent', ...(framing ? { framing } : {}) });
    const main: Clip[] = [{ id: 'c1', assetId: 'fala', in: 10, out: 16, by: 'agent' }];
    const proj = (overlays: OverlayItem[]) => ({ assets, timeline: { fps: 29.97, width: 1080, height: 1920, main, removals: [], pins: [], tracks: [], overlays } }) as unknown as Project;
    const r = achadosProjeto(proj([ov('br', 'br', 11), ov('img', 'img', 13)]), { fala: [{ start: 0, end: 6 }] });
    assert.deepEqual(r.achados.filter((a) => a.regra === 'escala').map((a) => a.ok), [true]);
    assert.equal(r.avisos.filter((a) => /escala do B-roll br .*1,78×/.test(a)).length, 1, JSON.stringify(r.avisos));
    assert.ok(!r.avisos.some((a) => /img/.test(a)));
    // Cobertura do próprio falante (punch-in 2160×3840 a zoom 3 = 1,5×) continua reprovando.
    const f = achadosProjeto(proj([ov('cob', 'fala', 11, { x: 0.5, y: 0.5, zoom: 3 })]), { fala: [{ start: 0, end: 6 }] }).achados.filter((a) => a.regra === 'escala' && !a.ok);
    assert.equal(f.length, 1);
    assert.match(f[0]!.onde!, /^cob/);
  });
});

describe('gate em vídeo sintético', () => {
  before(sinteticos);
  test('Y lido é o código gravado: faixa cheia tem 0 e 255, faixa tv fica em 16–235', async () => {
    const pc = path.join(tmp, 'pc.mp4');
    const tv = path.join(tmp, 'tv.mp4');
    const bw = 'color=black:s=64x64:d=1,format=yuv420p[a];color=white:s=64x64:d=1,format=yuv420p[b];[a][b]hstack';
    ff(['-f', 'lavfi', '-i', bw, '-vf', 'scale=out_range=pc,format=yuvj420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', pc]);
    ff(['-f', 'lavfi', '-i', bw, '-vf', 'scale=out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-color_range', 'tv', tv]);
    const a = niveis(await amostrarY(pc));
    const b = niveis(await amostrarY(tv));
    assert.deepEqual([a.ymin, a.ymax], [0, 255]);
    assert.deepEqual([b.ymin, b.ymax], [16, 235]);
  });

  test('saturação na mesma escala em faixa cheia e limitada (croma pc × 224/255)', { timeout: 60_000 }, async () => {
    const pc = path.join(tmp, 'bom-pc.mp4');
    ff(['-i', base, '-vf', 'scale=out_range=pc:out_color_matrix=bt709,format=yuvj420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-color_range', 'pc', pc]);
    const [a, b] = [await medirSatavg(bom), await medirSatavg(pc)];
    assert.ok(Math.abs(a - b) / a < 0.05, `tv ${a} × pc ${b}`);
  });

  test('na linha de entrega: aprova (sem projeto, com aviso)', { timeout: 120_000 }, async () => {
    const r = await qcTecnico(bom);
    assert.ok(r.aprovado, JSON.stringify(r.achados.filter((a) => !a.ok), null, 1));
    assert.ok(r.avisos.some((a) => /sem projeto/.test(a)));
    assert.ok(r.avisos.some((a) => /padrão/.test(a)));
  });

  test('fora da linha: perfil, níveis, imagem parada e câmera lenta sob fala, com o tempo', { timeout: 120_000 }, async () => {
    const r = await qcTecnico(ruim);
    assert.equal(r.aprovado, false);
    const f = new Set(r.achados.filter((a) => !a.ok).map((a) => a.regra));
    for (const regra of ['perfil:pix_fmt', 'perfil:color_range', 'perfil:color_primaries', 'perfil:fps', 'perfil:audio_rate', 'niveis', 'freeze-sob-fala', 'camera-lenta']) assert.ok(f.has(regra), `${regra} não acusou: ${[...f].join(', ')}`);
    const fr = r.achados.find((a) => a.regra === 'freeze-sob-fala' && !a.ok)!;
    assert.ok(Math.abs(fr.at! - 29 / 29.97) < 0.1, String(fr.onde));
    const cl = r.achados.find((a) => a.regra === 'camera-lenta' && !a.ok)!;
    assert.ok(cl.at! > 2.3 && cl.at! < 2.8, String(cl.onde));
  });

  test('cinza: saturação abaixo de 0,7× a assinatura (medida dos aprovados)', { timeout: 120_000 }, async () => {
    const ass = await assinaturaDe([bom]);
    assert.ok(ass.satavg > 10, `SATAVG do colorido ${ass.satavg}`);
    const r = await qcTecnico(cinza, { assinatura: ass });
    const s = r.achados.find((a) => a.regra === 'saturacao')!;
    assert.equal(s.ok, false, s.medido);
    assert.ok(!r.avisos.some((a) => /padrão/.test(a)));
  });

  test('corte-embutido: tranco de câmera no clipe lido do bruto não reprova; troca de plano num intermediário segue reprovando (CH-0047)', { timeout: 120_000 }, async () => {
    // Mesmo plano o tempo todo, com o quadro deslocado de uma vez no quadro 75 (2,50 s): o tranco do C3033 ampliado pelo zoom 2.
    const tranco = path.join(tmp, 'tranco.mp4');
    ff(['-i', base, '-f', 'lavfi', '-i', TOM, '-vf', "crop=140:280:x='if(gte(n,75),40,10)':y='if(gte(n,75),36,10)',format=yuv420p", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-r', '30000/1001', '-c:a', 'aac', '-ar', '48000', '-shortest', tranco]);
    // Troca de plano de verdade no quadro 75: outro trecho, espelhado e com outra cor.
    const corte = path.join(tmp, 'corte.mp4');
    const fc = '[0:v]split[a][b];[a]trim=end_frame=75,setpts=PTS-STARTPTS[a1];[b]setpts=PTS-STARTPTS,hflip,hue=h=120[b1];[a1][b1]concat=n=2:v=1:a=0,trim=end_frame=120,crop=140:280:10:10,format=yuv420p[v]';
    ff(['-i', base, '-f', 'lavfi', '-i', TOM, '-filter_complex', fc, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-r', '30000/1001', '-c:a', 'aac', '-ar', '48000', '-shortest', corte]);
    const proj = (arquivo: string) =>
      ({
        assets: [{ id: 'fala', name: path.basename(arquivo), path: arquivo, kind: 'video', duration: 60, width: 140, height: 280, fps: 29.97, hasAudio: true, role: 'fala' }],
        timeline: { fps: 29.97, width: 140, height: 280, removals: [], pins: [], tracks: [], overlays: [], main: [{ id: 'c1', assetId: 'fala', in: 10, out: 12, by: 'agent' }, { id: 'c2', assetId: 'fala', in: 20, out: 22, by: 'agent' }] },
      }) as unknown as Project;
    const corteEmb = async (f: string, p: Project) => {
      const r = await qcTecnico(f, { project: p });
      return { falhas: r.achados.filter((a) => a.regra === 'corte-embutido' && !a.ok), avisos: r.avisos };
    };
    const bruto = await corteEmb(tranco, proj('/nao-existe/C3033.MP4'));
    assert.deepEqual(bruto.falhas, [], JSON.stringify(bruto.falhas));
    assert.ok(bruto.avisos.some((a) => /salto de imagem em 2,50 s dentro do clipe 2 \(C3033\.MP4\)/.test(a)), JSON.stringify(bruto.avisos));
    // Contraprova: a troca de plano dentro de um intermediário (o arquivo já traz outro trecho) continua reprovando.
    const inter = await corteEmb(corte, proj('/nao-existe/C3033_cam9x16_v7.mov'));
    assert.equal(inter.falhas.length, 1, JSON.stringify(inter.falhas));
    assert.match(inter.falhas[0]!.onde!, /^2,50 s \(clipe 2, C3033_cam9x16_v7\.mov\)/);
  });
});
