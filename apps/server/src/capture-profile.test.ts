/**
 * BL-0175 F1 (FB-0185): perfil de captura automático no ingest. Fixtures sintéticas geradas pelo ffmpeg, com as tags de
 * cada origem, numa pasta temporária: ZV-E10 S-Log3 (XML), iPhone HLG, iPhone Apple Log, Blackmagic (tag e .sidecar),
 * Android SDR. As 5 são detectadas e convertidas sem pergunta; arquivo sem metadado sai `desconhecida` (nunca Rec.709
 * presumido); a Sony S-Log3 sai exatamente como antes (não regressão).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildLut, CAPTURE_TABLE, CAPTURE_TABLE_VERSION, captureLine, captureRow, gradePixel, manageGrade, NEUTRAL_GRADE, type MediaAsset, type SourceColor } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-captura-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_LUT_DIR = '';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const f = (name: string) => path.join(tmp, name);
const cinza = 'color=0x606060:s=64x64:r=30000/1001:d=0.5';
const tags = (kv: Record<string, string>) => ['-movflags', 'use_metadata_tags', ...Object.entries(kv).flatMap(([k, v]) => ['-metadata', `${k}=${v}`])];

const sonyXml = (gamma: string) => `<?xml version="1.0" encoding="UTF-8"?>
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

/** XML numa caixa `meta` de topo no fim do MP4, como a câmera grava. */
function withSonyMeta(file: string, gamma: string): void {
  const body = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('xml '), Buffer.from(sonyXml(gamma))]);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write('meta', 4, 'latin1');
  fs.appendFileSync(file, Buffer.concat([head, body]));
}

const F = {
  sony: f('C4001.MP4'),
  iphoneHlg: f('IMG_0001.MOV'),
  iphoneLog: f('IMG_0002.MOV'),
  iphoneLogTag: f('IMG_0003.MOV'),
  bmdTag: f('A001_11031200_C001.mov'),
  bmdSidecar: f('A002_11031210_C002.mov'),
  android: f('VID_20261103_120000.mp4'),
  nada: f('sem_metadado.mp4'),
};

before(() => {
  // Sony ZV-E10 S-Log3: XAVC marca bt709 no stream mesmo em S-Log; o XML é que diz a curva. Faixa cheia (yuvj), como a câmera.
  ff(['-f', 'lavfi', '-i', cinza, '-vf', 'scale=out_range=pc,format=yuvj420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-c:v', 'libx264', '-preset', 'ultrafast', '-color_range', 'pc', F.sony]);
  withSonyMeta(F.sony, 's-log3-cine');
  // iPhone vídeo HDR padrão: HEVC 10 bits, HLG/BT.2020.
  ff(['-f', 'lavfi', '-i', cinza, '-vf', 'setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv,format=yuv420p10le', '-c:v', 'libx265', '-x265-params', 'log-level=none', '-tag:v', 'hvc1', ...tags({ 'com.apple.quicktime.make': 'Apple', 'com.apple.quicktime.model': 'iPhone 15 Pro' }), F.iphoneHlg]);
  // iPhone Apple Log: ProRes 422 HQ, Rec.2020 sem curva marcada (a chave exata do Apple Log ainda não foi vista em amostra real).
  ff(['-f', 'lavfi', '-i', cinza, '-vf', 'setparams=color_primaries=bt2020:colorspace=bt2020nc:range=tv,format=yuv422p10le', '-c:v', 'prores_ks', '-profile:v', '3', ...tags({ 'com.apple.quicktime.make': 'Apple', 'com.apple.quicktime.model': 'iPhone 15 Pro' }), F.iphoneLog]);
  // Variante com a curva escrita numa tag (forma que a regra explícita aceita).
  ff(['-f', 'lavfi', '-i', cinza, '-vf', 'setparams=color_primaries=bt2020:colorspace=bt2020nc:range=tv,format=yuv422p10le', '-c:v', 'prores_ks', '-profile:v', '3', ...tags({ 'com.apple.quicktime.make': 'Apple', 'com.apple.quicktime.model': 'iPhone 16 Pro', 'com.apple.quicktime.camera.color-profile': 'Apple Log' }), F.iphoneLogTag]);
  // Blackmagic ProRes da câmera com as chaves do fabricante.
  ff(['-f', 'lavfi', '-i', cinza, '-vf', 'format=yuv422p10le', '-c:v', 'prores_ks', '-profile:v', '3', ...tags({ 'com.blackmagic-design.camera.manufacturer': 'Blackmagic Design', 'com.blackmagic-design.camera.model': 'Pocket Cinema Camera 6K', 'com.blackmagic-design.camera.gamma': 'Blackmagic Design Film', 'com.blackmagic-design.camera.colorScience': 'Gen 5' }), F.bmdTag]);
  // Blackmagic com o .sidecar ao lado (ProRes sem chave nenhuma).
  ff(['-f', 'lavfi', '-i', cinza, '-vf', 'format=yuv422p10le', '-c:v', 'prores_ks', '-profile:v', '3', F.bmdSidecar]);
  fs.writeFileSync(F.bmdSidecar.replace(/\.mov$/, '.sidecar'), JSON.stringify({ camera_type: 'Blackmagic Pocket Cinema Camera 4K', gamma: 'Blackmagic Design Film', color_science_gen: 5 }));
  // Android SDR: H.264 bt709 explícito.
  ff(['-f', 'lavfi', '-i', cinza, '-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-c:v', 'libx264', '-preset', 'ultrafast', ...tags({ 'com.android.manufacturer': 'samsung', 'com.android.model': 'SM-S911B' }), F.android]);
  // Sem metadado nenhum.
  ff(['-f', 'lavfi', '-i', cinza, '-c:v', 'libx264', '-preset', 'ultrafast', '-map_metadata', '-1', F.nada]);
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Cinza de exibição (0..1) que a conversão dá para um valor de código da curva. */
const display = (c: SourceColor, code: number) => {
  const g = manageGrade(undefined, c)!;
  const v = c.codeRange === 'full' ? code : (code * 1023 - 64) / 876;
  return gradePixel([v, v, v], g)[1];
};

describe('perfil de captura (BL-0175 F1)', () => {
  test('5 origens detectadas pelo metadado e convertidas sem pergunta', async () => {
    const { detectCapture } = await import('./capture-profile.ts');
    const esperado: [string, string, string, SourceColor['fonte'], RegExp][] = [
      [F.sony, 'sony-slog3-sgamut3cine', 'slog3', 'xml', /Sony ZV-E10/],
      [F.iphoneHlg, 'hlg', 'hlg', 'tag', /iPhone 15 Pro/],
      [F.iphoneLog, 'applelog', 'applelog', 'container', /iPhone 15 Pro/],
      [F.bmdTag, 'bmd-film-gen5', 'bmdfilm5', 'tag', /Pocket Cinema Camera 6K/],
      [F.android, 'rec709', 'rec709', 'tag', /samsung SM-S911B/],
    ];
    let ok = 0;
    for (const [file, curva, input, fonte, camera] of esperado) {
      const c = await detectCapture(file);
      assert.equal(c.curva, curva, `${path.basename(file)}: ${captureLine(c)}`);
      assert.equal(c.input, input);
      assert.equal(c.fonte, fonte);
      assert.match(c.camera ?? '', camera);
      assert.notEqual(c.confianca, 'desconhecida');
      assert.equal(c.tabela, CAPTURE_TABLE_VERSION);
      assert.ok(captureRow(c.curva), 'curva está na tabela versionada');
      ok++;
    }
    assert.equal(ok, 5, '5 de 5');
    // Variantes: Apple Log escrito em tag (certa) e Blackmagic pelo .sidecar.
    const log = await detectCapture(F.iphoneLogTag);
    assert.deepEqual([log.curva, log.fonte, log.confianca], ['applelog', 'tag', 'certa']);
    const side = await detectCapture(F.bmdSidecar);
    assert.deepEqual([side.curva, side.fonte, side.confianca, side.camera], ['bmd-film-gen5', 'sidecar', 'certa', 'Blackmagic Pocket Cinema Camera 4K']);
  });

  test('conversão: o cinza 18% de cada curva cai no cinza de exibição (sem LUT de disco), e no export do projeto', async () => {
    const { detectCapture } = await import('./capture-profile.ts');
    const { managedGrades } = await import('./color-source.ts');
    // Código do cinza 18% em cada curva (fórmulas publicadas): S-Log3 420/1023; HLG 0,38 (BT.2408); Apple Log; BMD Film Gen5.
    const appleLogGrey = 0.69336945 + 0.08550479 * Math.log2(0.18 + 0.00964052);
    const bmdGrey = 0.5300133392291939 + 0.08692876065491224 * Math.log(0.18 + 0.005494072432257808);
    const casos: [string, number][] = [[F.sony, 420 / 1023], [F.iphoneHlg, 0.38], [F.iphoneLog, appleLogGrey], [F.bmdTag, bmdGrey], [F.bmdSidecar, bmdGrey]];
    for (const [file, code] of casos) {
      const c = await detectCapture(file);
      const y = display(c, code);
      assert.ok(y > 0.36 && y < 0.5, `${path.basename(file)} (${c.curva}): cinza 18% → ${y.toFixed(3)}`);
    }
    // Android SDR: identidade (grade passa igual).
    const sdr = await detectCapture(F.android);
    assert.equal(manageGrade(NEUTRAL_GRADE, sdr), NEUTRAL_GRADE);
    // No export: todo LOG/HLG ganha a entrada na grade, e a nota traz câmera, curva e conversão.
    const v = (id: string, file: string): MediaAsset => ({ id, name: path.basename(file), path: file, kind: 'video', duration: 0.5, hasAudio: false });
    const p = { assets: [v('s', F.sony), v('h', F.iphoneHlg), v('l', F.iphoneLog), v('b', F.bmdTag), v('a', F.android), v('n', F.nada)], timeline: { grades: {} } } as unknown as Parameters<typeof managedGrades>[0];
    const m = await managedGrades(p);
    assert.deepEqual([m.grades.s?.input, m.grades.h?.input, m.grades.l?.input, m.grades.b?.input, m.grades.a, m.grades.n], ['slog3', 'hlg', 'applelog', 'bmdfilm5', undefined, undefined]);
    const nota = m.notes.find((n) => n.startsWith('perfil de captura:')) ?? '';
    const { captureReport } = await import('./color-source.ts');
    const rel = await captureReport(p);
    assert.equal(rel.arquivos.length, 6);
    assert.equal(rel.desconhecidas, 1, 'só o arquivo sem metadado');
    assert.equal(rel.tabela, CAPTURE_TABLE_VERSION);
    for (const re of [/Câmera Sony ZV-E10, curva S-Log3\/S-Gamut3.Cine, conversão embutida/, /Câmera Apple iPhone 15 Pro, curva HLG/, /curva Apple Log/, /curva Blackmagic Film Gen5/, /Câmera samsung SM-S911B, curva Rec.709 \(SDR\), conversão nenhuma/, /curva desconhecida/])
      assert.match(nota, re);
  });

  test('sem metadado = desconhecida (nunca Rec.709 presumido); fora da tabela também', async () => {
    const { detectCapture, classifyCapture, knownCapture } = await import('./capture-profile.ts');
    const { readSourceColor } = await import('./color-source.ts');
    const c = await detectCapture(F.nada);
    assert.equal(c.fonte, 'desconhecida');
    assert.equal(c.confianca, 'desconhecida');
    assert.equal(c.curva, 'desconhecida');
    assert.ok(!knownCapture(c));
    assert.equal(await readSourceColor(F.nada), null, 'readSourceColor só devolve curva decidida');
    assert.match(captureLine(c), /curva desconhecida, conversão nenhuma aplicada \(curva desconhecida, não presumida Rec.709\)/);
    const probe = (o: Partial<NonNullable<Parameters<typeof classifyCapture>[0]['probe']>>) => ({ tags: {}, ...o });
    // Sony sem XML: o bt709 do XAVC não separa S-Log de Rec.709.
    assert.equal(classifyCapture({ ext: '.mp4', probe: probe({ color_transfer: 'bt709', tags: { major_brand: 'XAVC' } }) }).fonte, 'desconhecida');
    // XML Sony com curva fora da tabela (antes: null → Rec.709 em silêncio).
    const s2 = classifyCapture({ ext: '.mp4', probe: probe({}), xml: sonyXml('s-log2') });
    assert.deepEqual([s2.fonte, s2.camera], ['desconhecida', 'Sony ZV-E10']);
    assert.match(s2.aviso ?? '', /s-log2/);
    // Sony em HLG pelo XML: tabela (HLG); título com "Apple Log" não decide a curva.
    assert.equal(classifyCapture({ ext: '.mp4', probe: probe({}), xml: sonyXml('rec2100-hlg') }).curva, 'hlg');
    assert.equal(classifyCapture({ ext: '.mov', probe: probe({ tags: { title: 'teste do Apple Log' } }) }).fonte, 'desconhecida');
    // PQ e BRAW: detectados e marcados com aviso, sem curva inventada.
    assert.match(classifyCapture({ ext: '.mov', probe: probe({ color_transfer: 'smpte2084' }) }).aviso ?? '', /PQ/);
    const braw = classifyCapture({ ext: '.braw', probe: null });
    assert.deepEqual([braw.fonte, braw.confianca], ['codec', 'desconhecida']);
    assert.match(braw.aviso ?? '', /exporte em ProRes/);
    // Blackmagic Film Gen4: fora da tabela.
    assert.equal(classifyCapture({ ext: '.mov', probe: probe({ tags: { 'com.blackmagic-design.camera.gamma': 'Blackmagic Design Film', 'com.blackmagic-design.camera.colorscience': 'Gen 4' } }) }).fonte, 'desconhecida');
    // Tabela: toda linha aponta para uma entrada que o core converte.
    for (const r of CAPTURE_TABLE) assert.ok(buildLut({ ...NEUTRAL_GRADE, input: r.input }, 3).every(Number.isFinite), r.curva);
  });

  test('ingest: grava o perfil no asset, converte sem pergunta e o projeto mostra a linha; BRAW recusado com mensagem clara', { timeout: 120_000 }, async () => {
    const { store } = await import('./store.ts');
    await store.load();
    const { ingest } = await import('./ingest.ts');
    const linhas: string[] = [];
    const orig = store.log.bind(store);
    store.log = (id, by, text, sug) => (linhas.push(text), orig(id, by, text, sug));
    try {
      const pid = (await store.create('BL-0175 perfil de captura', '')).id;
      const h = await ingest(pid, F.iphoneHlg, 'broll');
      const n = await ingest(pid, F.nada, 'broll');
      const p = store.get(pid);
      assert.deepEqual([p.assets.find((x) => x.id === h.id)?.color?.curva, p.timeline.grades?.[h.id]?.input], ['hlg', 'hlg']);
      assert.deepEqual([p.assets.find((x) => x.id === n.id)?.color?.fonte, p.timeline.grades?.[n.id]], ['desconhecida', undefined]);
      assert.ok(linhas.some((l) => /^Perfil de captura de IMG_0001\.MOV: Câmera Apple iPhone 15 Pro, curva HLG \(BT\.2100\), conversão da casa/.test(l)), linhas.join('\n'));
      assert.ok(linhas.some((l) => /^Perfil de captura de sem_metadado\.mp4: Câmera não identificada, curva desconhecida/.test(l)), linhas.join('\n'));
      const braw = f('A003_C003.braw');
      fs.writeFileSync(braw, 'não é vídeo');
      await assert.rejects(ingest(pid, braw), /exporte em ProRes da câmera/);
    } finally {
      store.log = orig;
    }
  });

  test('não regressão: Sony S-Log3 sai igual ao de antes (mesmos campos, mesma grade, mesma LUT)', async () => {
    const { readSourceColor, projectColors } = await import('./color-source.ts');
    const c = (await readSourceColor(F.sony))!;
    const antes: SourceColor = { input: 'slog3', gamma: 's-log3-cine', gamut: 's-gamut3-cine', modelo: 'ZV-E10', fonte: 'xml', codeRange: 'full' };
    for (const k of ['input', 'gamma', 'gamut', 'modelo', 'fonte', 'codeRange', 'inputLut'] as const) assert.equal(c[k], antes[k], k);
    assert.deepEqual(manageGrade(undefined, c), manageGrade(undefined, antes));
    assert.deepEqual(buildLut(manageGrade(undefined, c)!, 17), buildLut(manageGrade(undefined, antes)!, 17));
    // Projeto antigo (cor gravada sem `confianca`/`curva`) vale como decidida e não é relida.
    const v = (id: string, file: string, color?: SourceColor): MediaAsset => ({ id, name: path.basename(file), path: file, kind: 'video', duration: 0.5, hasAudio: false, ...(color ? { color } : {}) });
    const m = await projectColors({ assets: [v('velho', F.nada, antes)] });
    assert.equal(m.get('velho'), antes);
    assert.match(captureLine(antes), /Câmera ZV-E10, curva s-log3-cine, conversão embutida/);
    // Recorte ProRes de bruto Sony com bt709 no stream (sem XML): herda do bruto, não vira Rec.709 pela tag.
    const recorte = f('C4001_cam9x16_A1.mov');
    ff(['-i', F.sony, '-vf', 'scale=in_range=pc:out_range=tv,format=yuv422p10le,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-c:v', 'prores_ks', '-profile:v', '3', recorte]);
    const m2 = await projectColors({ assets: [v('b', F.sony), v('d', recorte)] });
    assert.deepEqual([m2.get('d')?.input, m2.get('d')?.fonte, m2.get('d')?.de], ['slog3', 'herdado', 'C4001.MP4']);
  });
});
