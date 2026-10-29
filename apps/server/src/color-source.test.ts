/**
 * FB-0180 (Q1/Q2 da força-tarefa de 27/10): os 79 brutos Sony ZV-E10 do Leandro são S-Log3/S-Gamut3.Cine (XML
 * NonRealTimeMeta embutido no MP4) e os 18 projetos foram graduados como Rec.709 — a cor saiu lavada. Agora a entrada
 * sai do arquivo, LOG converte em 16 bits e a entrega sai num encode só, yuv420p/tv/bt709 nas quatro etiquetas,
 * 30000/1001 CFR. BL-0159 C1: a conversão S-Log3/S-Gamut3.Cine → LC-709 Type A é embutida no app (sem a pasta do
 * DaVinci, sem `NEWEDITOR_LUT_DIR`, sem o Resolve no PATH).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { BUILTIN_INPUT, buildLut, gradeWasForced, manageGrade, NEUTRAL_GRADE, parseCube, gradePixel, sampleCube, type SourceColor } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-cor-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
// Sem LUT de disco e sem o Resolve: a conversão tem de sair do próprio app.
process.env.NEWEDITOR_LUT_DIR = '';
process.env.PATH = (process.env.PATH ?? '').split(path.delimiter).filter((d) => !/DaVinci|Blackmagic|resolve/i.test(d)).join(path.delimiter);
// Só régua (nunca no caminho de render): a LUT oficial da Sony, quando a máquina tem o Resolve.
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

  test('lê o XML embutido no MP4 e a faixa cheia do bruto; nenhuma LUT de disco', async () => {
    const { readSourceColor } = await import('./color-source.ts');
    const c = await readSourceColor(bruto);
    assert.equal(c?.input, 'slog3');
    assert.equal(c?.fonte, 'xml');
    assert.equal(c?.codeRange, 'full');
    assert.equal(c?.modelo, 'ZV-E10');
    assert.equal(c?.inputLut, undefined, 'S-Log3 não procura LUT no disco');
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
    assert.equal(m.contrast, 0, 'contraste feito sobre o LOG lavado não dobra sobre a LUT');
    assert.equal(manageGrade({ ...g, input: 'slog3', temperature: 0.2 }, color)?.contrast, 0.3, 'grade já na entrada certa passa igual');
    assert.equal(manageGrade({ ...g, temperature: 0.2 }, color)?.temperature, 0.2, 'balanço de branco fica');
    assert.equal(m.inputLut, undefined, 'S-Log3 converte pela conversão embutida: LUT de disco não entra');
    assert.equal(manageGrade(undefined, { ...color, input: 'vlog' })?.inputLut?.id, 'local:/x.cube', 'entrada sem conversão embutida segue aceitando LUT de entrada');
    assert.ok(gradeWasForced(g, color));
    assert.equal(manageGrade(undefined, color)?.input, 'slog3', 'sem grade: só a conversão');
    assert.equal(manageGrade(g, { ...color, input: 'rec709' }), g);
    assert.equal(manageGrade(g, undefined), g);
  });

  test('conversão embutida: neutra = LC-709 Type A pura; exposição +1 stop clareia o cinza; LUT velha do DaVinci sai', () => {
    assert.ok(BUILTIN_INPUT.slog3);
    const velha = { id: `local:${SONY_REAL}`, nome: 'Sony (pasta do DaVinci)' };
    const g = manageGrade(undefined, { input: 'slog3', fonte: 'xml', codeRange: 'full', inputLut: velha })!;
    assert.equal(g.inputLut, undefined, 'projeto antigo: a LUT da pasta do DaVinci não volta para a grade');
    assert.equal(manageGrade({ ...NEUTRAL_GRADE, input: 'slog3', inputLut: velha }, { input: 'slog3', fonte: 'xml', codeRange: 'full' })!.inputLut, undefined);
    const cinza = gradePixel([slog3(420), slog3(420), slog3(420)], g);
    assert.ok(Math.abs(cinza[1] - 0.397) < 0.005, `cinza 18% → ${cinza[1]}`);
    assert.ok(Math.abs(cinza[0] - cinza[2]) < 1e-6, 'cinza continua cinza');
    const preto = gradePixel([slog3(95), slog3(95), slog3(95)], g);
    assert.ok(preto[1] < 0.06, `preto → ${preto[1]}`);
    const mais = gradePixel([slog3(420), slog3(420), slog3(420)], { ...g, exposure: 1 });
    assert.ok(mais[1] > cinza[1] + 0.08, `+1 stop: ${cinza[1]} → ${mais[1]}`);
    // Um cubo qualquer passado como LUT de entrada não muda o S-Log3 (a embutida manda).
    const cubo = parseCube(['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, () => '0 0 0')].join('\n'));
    assert.deepEqual(gradePixel([slog3(420), slog3(420), slog3(420)], { ...g, inputLut: velha }, cubo), cinza);
    assert.equal(buildLut(g, 65).length, 65 ** 3 * 3);
  });

  test('régua: conversão embutida contra a LUT oficial da Sony (só medida, fora do render)', { skip: !fs.existsSync(SONY_REAL) && 'LUT da Sony não instalada' }, () => {
    const cube = parseCube(fs.readFileSync(SONY_REAL, 'utf8'));
    const g = manageGrade(undefined, { input: 'slog3', fonte: 'xml', codeRange: 'full' })!;
    // Eixo neutro (preto 95 ao branco 940) e tons de pele S-Log3 típicos: diferença por canal em código de 8 bits.
    let pior = 0;
    for (let cv = 95; cv <= 940; cv += 5) {
      const v = slog3(cv);
      const a = gradePixel([v, v, v], g), b = sampleCube(cube, [v, v, v]);
      pior = Math.max(pior, ...a.map((x, i) => Math.abs(x - b[i]!) * 255));
    }
    // A oficial não é exatamente neutra nas altas (R e B ±0,008 do G): até 3/255.
    assert.ok(pior < 3, `eixo neutro: pior diferença ${pior.toFixed(2)}/255`);
    for (const pele of [[470, 420, 390], [520, 470, 440], [430, 390, 365], [560, 505, 470]]) {
      const v = pele.map(slog3) as [number, number, number];
      const a = gradePixel(v, g), b = sampleCube(cube, v);
      const d = Math.max(...a.map((x, i) => Math.abs(x - b[i]!) * 255));
      assert.ok(d < 4, `pele ${pele.join('/')}: ${d.toFixed(2)}/255`);
    }
  });

  test('render: bruto LOG convertido sem LUT de disco, um encode só, yuv420p/tv/bt709 e 30000/1001', { timeout: 180_000 }, async () => {
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
    assert.ok(res.notes.some((n) => /s-log3-cine pela conversão embutida/.test(n)), res.notes.join(' | '));

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

    // Branco S-Log3 (código 598 ≈ Y 149 cheio): convertido (LC-709 Type A) ≈ 0,71 na exibição → Y legal ≈ 16 + 0,71·219 ≈ 172.
    // Sem conversão (o defeito), a faixa cheia só ia para a legal: Y ≈ 144. Preto (código 95) fica no pé da curva.
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-frames:v', '1', '-vf', 'extractplanes=y', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
    const W = 192;
    const at = (x: number) => raw[180 * W + x]!;
    assert.ok(at(160) > 160, `branco LOG convertido: Y ${at(160)}`);
    assert.ok(at(16) >= 16 && at(16) < 40, `preto: Y ${at(16)}`);
    assert.ok(at(16) < at(96) && at(96) < at(160), `ordem preto < cinza < branco: ${at(16)} ${at(96)} ${at(160)}`);
  });
});
