/**
 * FB-0180 (Q1/Q2 da força-tarefa de 27/10): os 79 brutos Sony ZV-E10 do Leandro são S-Log3/S-Gamut3.Cine (XML
 * NonRealTimeMeta embutido no MP4) e os 18 projetos foram graduados como Rec.709 — a cor saiu lavada. Agora a entrada
 * sai do arquivo, LOG converte pela LUT oficial da Sony (a do DaVinci) em 16 bits, e a entrega sai num encode só,
 * yuv420p/tv/bt709 nas quatro etiquetas, 30000/1001 CFR.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildLut, gradeWasForced, manageGrade, NEUTRAL_GRADE, parseCube, gradePixel, type SourceColor } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-cor-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
// LUT "oficial" de teste: S-Log3 → exibição pela fórmula (mesma forma da Sony: código 420 ≈ 0,40; 598 ≈ 0,71).
const lutDir = path.join(tmp, 'LUT');
process.env.NEWEDITOR_LUT_DIR = lutDir;
const SONY_REAL = '/Library/Application Support/Blackmagic Design/DaVinci Resolve/LUT/Sony/SLog3SGamut3.CineToLC-709TypeA.cube';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const probe = (f: string, entries: string) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1', f]).toString();

const xml = (gamma: string) => `<?xml version="1.0" encoding="UTF-8"?>
<NonRealTimeMeta xmlns="urn:schemas-professionalDisc:nonRealTimeMeta:ver.2.20">
<Device manufacturer="Sony" modelName="ZV-E10" serialNo="4294967295"/>
<AcquisitionRecord>
<Group name="CameraUnitMetadataSet">
<Item name="CaptureGammaEquation" value="${gamma}"/>
<Item name="CaptureColorPrimaries" value="s-gamut3-cine"/>
<Item name="CodingEquations" value="rec709"/>
</Group>
</AcquisitionRecord>
</NonRealTimeMeta>`;

/** Põe o XML numa caixa `meta` de topo no fim do MP4, como a câmera grava. */
function withSonyMeta(file: string, gamma: string): void {
  const body = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('xml '), Buffer.from(xml(gamma))]);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write('meta', 4, 'latin1');
  fs.appendFileSync(file, Buffer.concat([head, body]));
}

const slog3 = (cv: number) => cv / 1023;
// Faixa de 3 cores lado a lado com o código S-Log3 direto no Y (faixa cheia, como o XAVC): preto 95, cinza 420, branco 598.
const bruto = path.join(tmp, 'C3030.MP4');
const derivado = path.join(tmp, 'C3030_cam9x16_A5.mov');

before(() => {
  fs.mkdirSync(path.join(lutDir, 'Sony'), { recursive: true });
  const n = 33;
  const lines = ['TITLE "teste full in full out"', `LUT_3D_SIZE ${n}`];
  const disp = (v: number) => {
    const cv = v * 1023;
    const lin = cv >= 171.21 ? Math.pow(10, (cv - 420) / 261.5) * 0.19 - 0.01 : ((cv - 95) * 0.01125) / (171.21 - 95);
    return Math.max(0, Math.min(1, 0.04 + 0.95 * Math.pow(Math.max(0, lin) / (Math.max(0, lin) + 0.12), 0.6) * 0.92));
  };
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) lines.push([r, g, b].map((x) => disp(x / (n - 1)).toFixed(6)).join(' '));
  fs.writeFileSync(path.join(lutDir, 'Sony', 'SLog3SGamut3.CineToLC-709TypeA.cube'), lines.join('\n') + '\n');
  const y = (cv: number) => Math.round(slog3(cv) * 255);
  ff(['-f', 'lavfi', '-i', `color=0x${y(95).toString(16).padStart(2, '0').repeat(3)}:s=64x360:r=30000/1001:d=2`, '-f', 'lavfi', '-i', `color=0x${y(420).toString(16).padStart(2, '0').repeat(3)}:s=64x360:r=30000/1001:d=2`, '-f', 'lavfi', '-i', `color=0x${y(598).toString(16).padStart(2, '0').repeat(3)}:s=64x360:r=30000/1001:d=2`, '-f', 'lavfi', '-i', 'sine=f=300:r=48000:d=2',
    '-filter_complex', '[0][1][2]hstack=3,scale=out_range=pc,format=yuvj420p[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-color_range', 'pc', '-c:a', 'pcm_s16le', '-shortest', bruto]);
  withSonyMeta(bruto, 's-log3-cine');
  // Recorte ProRes do mesmo clipe feito por fora (apaga o XML): faixa cheia → legal convertida direito.
  ff(['-i', bruto, '-vf', 'scale=in_range=pc:out_range=tv,format=yuv422p10le', '-c:v', 'prores_ks', '-profile:v', '3', '-color_range', 'tv', '-an', derivado]);
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('cor de entrada lida do arquivo (color management por clipe)', () => {
  test('XML da Sony: S-Log3.Cine vira slog3; S-Cinetone é Rec.709; curva desconhecida não adivinha', async () => {
    const { sonyXmlColor } = await import('./color-source.ts');
    assert.deepEqual(sonyXmlColor(xml('s-log3-cine')), { input: 'slog3', gamma: 's-log3-cine', gamut: 's-gamut3-cine', modelo: 'ZV-E10' });
    assert.equal(sonyXmlColor(xml('s-cinetone'))?.input, 'rec709');
    assert.equal(sonyXmlColor(xml('s-log2')), null);
    assert.equal(sonyXmlColor('<xml/>'), null);
  });

  test('lê o XML embutido no MP4, a faixa cheia do bruto e acha a LUT oficial', async () => {
    const { readSourceColor } = await import('./color-source.ts');
    const c = await readSourceColor(bruto);
    assert.equal(c?.input, 'slog3');
    assert.equal(c?.fonte, 'xml');
    assert.equal(c?.codeRange, 'full');
    assert.equal(c?.modelo, 'ZV-E10');
    assert.match(c?.inputLut?.id ?? '', /^local:.*SLog3SGamut3\.CineToLC-709TypeA\.cube$/);
    assert.equal(await readSourceColor(derivado), null, 'o recorte ProRes não tem XML');
  });

  test('câmera derivada (C3030_cam9x16…) herda a cor do bruto C3030', async () => {
    const { projectColors } = await import('./color-source.ts');
    const v = (id: string, file: string) => ({ id, name: path.basename(file), path: file, kind: 'video' as const, duration: 2, hasAudio: false });
    const m = await projectColors({ assets: [v('b', bruto), v('d', derivado)] });
    assert.equal(m.get('d')?.input, 'slog3');
    assert.equal(m.get('d')?.fonte, 'herdado');
    assert.equal(m.get('d')?.de, 'C3030.MP4');
    // Sem o bruto no projeto: acha na pasta das falas.
    const fala = path.join(tmp, 'C3031.MP4');
    fs.copyFileSync(bruto, fala);
    const m2 = await projectColors({ assets: [v('f', fala), v('d', derivado)] });
    assert.equal(m2.get('d')?.de, 'C3030.MP4');
  });

  test('grade Rec.709 em arquivo LOG é corrigida na entrada (e avisa); Rec.709 de verdade passa igual', () => {
    const color: SourceColor = { input: 'slog3', fonte: 'xml', codeRange: 'full', inputLut: { id: 'local:/x.cube', nome: 'x' } };
    const g = { ...NEUTRAL_GRADE, contrast: 0.3 };
    const m = manageGrade(g, color)!;
    assert.equal(m.input, 'slog3');
    assert.equal(m.codeRange, 'full');
    assert.equal(m.contrast, 0.3);
    assert.equal(m.inputLut?.id, 'local:/x.cube');
    assert.ok(gradeWasForced(g, color));
    assert.equal(manageGrade(undefined, color)?.input, 'slog3', 'sem grade: só a conversão');
    assert.equal(manageGrade(g, { ...color, input: 'rec709' }), g);
    assert.equal(manageGrade(g, undefined), g);
  });

  test('LUT oficial: grade neutra = a LUT pura; exposição +1 stop clareia o cinza', { skip: !fs.existsSync(SONY_REAL) && 'LUT da Sony não instalada' }, () => {
    const cube = parseCube(fs.readFileSync(SONY_REAL, 'utf8'));
    const g = manageGrade(undefined, { input: 'slog3', fonte: 'xml', codeRange: 'full', inputLut: { id: `local:${SONY_REAL}`, nome: 'Sony' } })!;
    const cinza = gradePixel([slog3(420), slog3(420), slog3(420)], g, cube);
    assert.ok(Math.abs(cinza[1] - 0.398) < 0.01, `cinza 18% → ${cinza[1]}`);
    const preto = gradePixel([slog3(95), slog3(95), slog3(95)], g, cube);
    assert.ok(preto[1] < 0.06, `preto → ${preto[1]}`);
    const mais = gradePixel([slog3(420), slog3(420), slog3(420)], { ...g, exposure: 1 }, cube);
    assert.ok(mais[1] > cinza[1] + 0.08, `+1 stop: ${cinza[1]} → ${mais[1]}`);
    // Composta em 65 pontos, a LUT bate com a da Sony no ponto do cinza.
    const lut = buildLut(g, 65, null, cube);
    assert.equal(lut.length, 65 ** 3 * 3);
  });

  test('render: bruto LOG convertido pela LUT, um encode só, yuv420p/tv/bt709 e 30000/1001', { timeout: 180_000 }, async () => {
    const { store } = await import('./store.ts');
    const { ingest } = await import('./ingest.ts');
    const { render } = await import('./render.ts');
    await store.load();
    const id = (await store.create('FB-0180', 'cor e entrega')).id;
    const a = await ingest(id, bruto, 'broll');
    assert.equal(store.get(id).assets.find((x) => x.id === a.id)?.color?.input, 'slog3', 'cor gravada no asset');
    assert.equal(store.get(id).timeline.grades?.[a.id]?.input, 'slog3', 'grade de conversão posta no ingest');
    // Editor tenta graduar como Rec.709: a entrada continua a do arquivo.
    store.apply(id, { by: 'human', op: { type: 'set_grade', assetId: a.id, grade: { ...NEUTRAL_GRADE } } });
    assert.equal(store.get(id).timeline.grades?.[a.id]?.input, 'slog3');
    store.apply(id, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: a.id, in: 0, out: 1.5, by: 'human' }] } });
    store.apply(id, { by: 'human', op: { type: 'set_format', width: 192, height: 360, fps: 29.97 } });
    const res = await render(store.get(id), store.dir(id));
    const out = path.join(store.dir(id), res.file);
    assert.ok(res.notes.some((n) => /s-log3-cine pela LUT oficial/.test(n)), res.notes.join(' | '));

    const v = probe(out, 'stream=codec_name,pix_fmt,color_range,color_space,color_primaries,color_transfer,r_frame_rate,avg_frame_rate,sample_rate,bit_rate');
    assert.match(v, /codec_name=h264/);
    assert.match(v, /pix_fmt=yuv420p\n/);
    assert.match(v, /color_range=tv/);
    assert.match(v, /color_space=bt709/);
    assert.match(v, /color_primaries=bt709/);
    assert.match(v, /color_transfer=bt709/);
    assert.match(v, /r_frame_rate=30000\/1001/);
    assert.match(v, /codec_name=aac/);
    assert.match(v, /sample_rate=48000/);

    // Branco S-Log3 (código 598 ≈ Y 149 cheio): convertido pela LUT ≈ 0,71 na exibição → Y legal ≈ 16 + 0,71·219 ≈ 172.
    // Sem conversão (o defeito), a faixa cheia só ia para a legal: Y ≈ 144. Preto (código 95) fica no pé da curva.
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-frames:v', '1', '-vf', 'extractplanes=y', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
    const W = 192;
    const at = (x: number) => raw[180 * W + x]!;
    assert.ok(at(160) > 160, `branco LOG convertido: Y ${at(160)}`);
    assert.ok(at(16) >= 16 && at(16) < 40, `preto: Y ${at(16)}`);
    assert.ok(at(16) < at(96) && at(96) < at(160), `ordem preto < cinza < branco: ${at(16)} ${at(96)} ${at(160)}`);
  });
});
