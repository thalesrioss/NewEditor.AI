/**
 * Testes do caminho inteiro de um projeto (ADR-013): ingest → timeline por operações → QC → render.
 * Roda numa pasta de dados temporária (NEWEDITOR_DATA), com um vídeo de teste gerado pelo FFmpeg.
 * Não transcreve (o arquivo entra como B-roll) e não usa Chrome (sem texto na timeline): o que se testa
 * é o que mais quebrou — preparo, formato, QC e o render com cortes.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-pipe-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const clip = path.join(tmp, 'clip.mp4');
const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const probeDur = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

let projectId = '';
let rendered = '';

before(async () => {
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Teste de pipeline', 'projeto de teste');
  projectId = p.id;
});
// O store grava o projeto 400 ms depois da última mudança: espera essa gravação antes de apagar a pasta.
after(async () => {
  await new Promise((r) => setTimeout(r, 600));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('ingest e timeline', () => {
  test('ingest como B-roll gera proxy, thumbs e envelope, e não mexe no formato (só a fala define)', async () => {
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const a = await ingest(projectId, clip, 'broll');
    assert.equal(a.role, 'broll');
    assert.ok(a.proxy, 'proxy');
    assert.ok(a.thumbs, 'thumbs');
    assert.ok(a.envelope, 'envelope');
    const tl = store.get(projectId).timeline;
    assert.equal(tl.width, 1080);
    assert.equal(tl.height, 1920);
    assert.equal(tl.main.length, 0, 'B-roll não entra na principal');
  });
  test('dois clipes na principal, formato manual e banco de SFX por operação', async () => {
    const { store } = await import('./store.ts');
    const a = store.get(projectId).assets[0]!;
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: a.id, in: 0, out: 1, by: 'human' }, { id: 'c2', assetId: a.id, in: 1.5, out: 2.5, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 180, height: 320 } });
    store.apply(projectId, { by: 'agent', op: { type: 'set_sfx_bank', bank: 'cinepro' } });
    const tl = store.get(projectId).timeline;
    assert.equal(tl.main.length, 2);
    assert.equal(tl.width, 180);
    assert.equal(tl.formatoManual, true);
    assert.equal(tl.sfxBank, 'cinepro');
  });
});

describe('perfil e QC', () => {
  test('Personalizado lê o perfil da própria edição', async () => {
    const { store } = await import('./store.ts');
    const { profileOf } = await import('./profiles.ts');
    store.update(projectId, { profileId: 'personalizado' });
    const prof = await profileOf(store.get(projectId));
    assert.equal(prof.id, 'personalizado');
    assert.equal(prof.formato.width, 180);
    assert.equal(prof.formato.height, 320);
    assert.equal(prof.validado, true);
  });
  test('QC avisa tarja (material 16:9 numa peça 9:16 sem reframe) e não reclama do formato do perfil', async () => {
    const { runQc } = await import('./qc.ts');
    const qc = await runQc(projectId);
    const regras = qc.issues.map((i) => i.regra);
    assert.ok(regras.includes('tarja'), `esperava tarja em ${regras.join(',')}`);
    assert.ok(!regras.includes('formato'), 'o perfil Personalizado tem o formato da própria peça');
  });
});

describe('render', () => {
  test('renderiza a timeline com dois cortes na duração certa', async () => {
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const p = store.get(projectId);
    const res = await render(p, store.dir(projectId));
    const file = path.join(store.dir(projectId), res.file); // `file` é relativo à pasta do projeto (é o que o player pede)
    assert.ok(fs.existsSync(file), `arquivo renderizado: ${JSON.stringify(res)}`);
    assert.ok(Math.abs(probeDur(file) - 2) < 0.25, `duração ${probeDur(file)}`);
    assert.deepEqual(res.skipped, []);
    rendered = file;
  });
  test('QC do render lê o loudness do resumo do ebur128 e confere a duração (BL-0014)', async () => {
    const { runRenderQc } = await import('./qc.ts');
    const qc = await runRenderQc(projectId, rendered);
    const regras = qc.issues.map((i) => i.regra);
    assert.ok(!regras.includes('loudness'), `não esperava loudness: ${JSON.stringify(qc.issues)}`);
    assert.ok(!regras.includes('duracao-render'), `não esperava duracao-render: ${JSON.stringify(qc.issues)}`);
    const lufs = qc.render?.lufs;
    assert.ok(lufs !== undefined && lufs >= -15.5 && lufs <= -12.5, `lufs ${lufs}`);
    assert.ok(Math.abs((qc.render?.duration ?? 0) - 2) < 2 / 30, `duração ${qc.render?.duration}`);
  });
  test('QC do render bloqueia arquivo com duração diferente da esperada (duracao-render)', async () => {
    const { runRenderQc } = await import('./qc.ts');
    const qc = await runRenderQc(projectId, rendered, { expectedDuration: 2.5 });
    const d = qc.issues.find((i) => i.regra === 'duracao-render');
    assert.ok(d, `esperava duracao-render em ${qc.issues.map((i) => i.regra).join(',')}`);
    assert.equal(d.severidade, 'bloqueia');
    const ok = await runRenderQc(projectId, rendered, { expectedDuration: 2 + 1.5 / 30 });
    assert.ok(!ok.issues.some((i) => i.regra === 'duracao-render'), 'até 2 quadros de diferença passa');
  });
});

describe('parseEbur128Summary', () => {
  test('ignora o I: das linhas por quadro e lê só o resumo', async () => {
    const { parseEbur128Summary } = await import('./qc.ts');
    const text = [
      '[Parsed_ebur128_0 @ 0x1] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -10.0 dBFS  TPK: -10.0 dBFS',
      '[Parsed_ebur128_0 @ 0x1] t: 0.399979   TARGET:-23 LUFS    M: -14.0 S:-120.7     I: -14.0 LUFS       LRA:   0.0 LU  FTPK: -10.3 dBFS  TPK: -10.0 dBFS',
      '[Parsed_ebur128_0 @ 0x2] Summary:',
      '',
      '  Integrated loudness:',
      '    I:         -13.8 LUFS',
      '    Threshold: -24.0 LUFS',
      '',
      '  Loudness range:',
      '    LRA:         0.0 LU',
      '',
      '  True peak:',
      '    Peak:       -1.2 dBFS',
    ].join('\n');
    assert.deepEqual(parseEbur128Summary(text), { lufs: -13.8, truePeak: -1.2 });
    assert.deepEqual(parseEbur128Summary(text.split('\n').slice(0, 2).join('\n')), {}, 'sem resumo, sem medição');
  });
});
