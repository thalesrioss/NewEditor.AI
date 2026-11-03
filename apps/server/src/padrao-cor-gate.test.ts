/**
 * BL-0161 (fatias 2 e 4) com fixture: perfil "Equity" com padrão de cor (grade + 1 still) e 2 projetos do Equity.
 * (2) Os dois nascem herdando: um pela fala que entra na montagem crua com o perfil já escolhido, outro pelo perfil
 * escolhido depois da fala entrar; grade posta à mão não é sobrescrita e trocar para um perfil sem padrão tira a herdada.
 * (4) O gate mede saturação e luma de cada clipe na entrega (FFmpeg real, 2 quadros/s) contra o still do padrão:
 * o clipe com saturação +30% é acusado, o com +8% não. Sem padrão do cliente, o gate é idêntico ao de antes.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify from 'fastify';
import { clipGradeOf, NEUTRAL_GRADE, type ColorGrade, type MediaAsset } from '@neweditor/core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-padrao-gate-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const perfisDir = path.join(tmp, 'data', 'perfis');
const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
const padraoEquity: ColorGrade = { ...NEUTRAL_GRADE, exposure: -0.1, saturation: 1.15, contrast: 0.08 };
const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const BT709 = 'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709';
const imagem = path.join(tmp, 'imagem.png');
const still = path.join(tmp, 'still.jpg');

/**
 * Entrega sintética de 6 s em 3 trechos de 2 s (os 3 clipes da timeline): a mesma imagem pouco saturada, com ruído só
 * na luma (todo quadro mexe), e o trecho do meio com a saturação multiplicada por `meio`.
 */
function entrega(nome: string, meio: number): string {
  const f = path.join(tmp, nome);
  const fc = `[0:v]noise=c0s=6:c0f=t,split=3[a][b][c];[a]trim=0:2,setpts=PTS-STARTPTS[a1];[b]trim=2:4,setpts=PTS-STARTPTS,hue=s=${meio}[b1];[c]trim=4:6,setpts=PTS-STARTPTS[c1];[a1][b1][c1]concat=n=3:v=1:a=0,${BT709}[v]`;
  ff(['-loop', '1', '-framerate', '30000/1001', '-t', '6', '-i', imagem, '-f', 'lavfi', '-i', 'sine=f=300:r=48000:d=6', '-filter_complex', fc, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-r', '30000/1001', '-c:a', 'aac', '-ar', '48000', '-shortest', f]);
  return f;
}

let entregaA = '';
let entregaB = '';

before(async () => {
  fs.mkdirSync(perfisDir, { recursive: true });
  const at = '2026-11-03T00:00:00.000Z';
  fs.writeFileSync(path.join(perfisDir, 'thales.json'), JSON.stringify({ id: 'thales', nome: 'Thales Rios', padraoCasa: true, validado: true, atualizadoEm: at }));
  fs.writeFileSync(path.join(perfisDir, 'equity.json'), JSON.stringify({ id: 'equity', nome: 'Equity', cliente: 'Equity', validado: true, atualizadoEm: at }));
  fs.writeFileSync(path.join(perfisDir, 'daniel.json'), JSON.stringify({ id: 'daniel', nome: 'Daniel Sun', atualizadoEm: at }));
  // A imagem do falante (pouco saturada, como pele) e o still do padrão: o quadro em JPEG, como o ColorPanel salva.
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=1:d=1', '-vf', 'hue=s=0.45', '-frames:v', '1', imagem]);
  ff(['-i', imagem, '-q:v', '2', '-frames:v', '1', still]);
  entregaA = entrega('equity-a.mp4', 1.3);
  entregaB = entrega('equity-b.mp4', 1.08);
  const { store } = await import('./store.ts');
  await store.load();
  await (await import('./routes/projetos.ts')).rotasProjetos(app);
  await (await import('./routes/bibliotecas.ts')).rotasBibliotecas(app);
  const { salvarPadraoCor } = await import('./padrao-cor.ts');
  await salvarPadraoCor('equity', { grade: padraoEquity, stills: [`data:image/jpeg;base64,${fs.readFileSync(still).toString('base64')}`] });
});
after(async () => {
  await app.close();
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const fala = (file: string): MediaAsset => ({ id: 'fala1', name: path.basename(file), path: file, kind: 'video', duration: 6, hasAudio: true, role: 'fala', width: 180, height: 320, fps: 29.97 });

async function novoProjeto(nome: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: nome } });
  return (r.json() as { id: string }).id;
}
const escolherPerfil = async (id: string, profileId: string) => {
  const r = await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload: { profileId } });
  assert.equal(r.statusCode, 200, r.body);
};

/** A fala entra na montagem crua (o fim da importação) e o editor corta em 2 s e 4 s: 3 clipes. */
async function falaNaMontagem(id: string, file: string): Promise<void> {
  const { store } = await import('./store.ts');
  const { entrarNaMontagemCrua } = await import('./ingest.ts');
  const a = fala(file);
  store.upsertAsset(id, a);
  await entrarNaMontagemCrua(id, a);
  store.apply(id, { by: 'human', op: { type: 'split', time: 2 } });
  store.apply(id, { by: 'human', op: { type: 'split', time: 4 } });
  assert.equal(store.get(id).timeline.main.length, 3);
}

const herdados = async (id: string) => (await import('./store.ts')).store.get(id).timeline.main.map((c) => c.gradeHerdada ?? '-');

describe('padrão de cor do Equity: herança no projeto novo e gate (BL-0161)', () => {
  let projA = '';
  let projB = '';

  test('projeto A: perfil Equity escolhido antes da fala entrar → os 3 clipes nascem com a grade do padrão, marcados', async () => {
    const { store } = await import('./store.ts');
    projA = await novoProjeto('Equity A');
    await escolherPerfil(projA, 'equity');
    await falaNaMontagem(projA, entregaA);
    assert.deepEqual(await herdados(projA), ['equity', 'equity', 'equity']);
    for (const c of store.get(projA).timeline.main) assert.deepEqual(c.grade, clipGradeOf(padraoEquity));
  });

  test('projeto B: perfil Equity escolhido depois da fala entrar → herda na hora; grade à mão fica; perfil sem padrão tira só a herdada', async () => {
    const { store } = await import('./store.ts');
    projB = await novoProjeto('Equity B');
    await escolherPerfil(projB, 'daniel');
    await falaNaMontagem(projB, entregaB);
    assert.deepEqual(await herdados(projB), ['-', '-', '-'], 'Daniel não tem padrão: nada herdado');
    // Grade à mão no 3º clipe antes de escolher o Equity.
    const mao: ColorGrade = { ...NEUTRAL_GRADE, temperature: 0.3 };
    const c3 = store.get(projB).timeline.main[2]!.id;
    store.apply(projB, { by: 'human', op: { type: 'set_clip_grade', clipIds: [c3], grade: mao } });
    await escolherPerfil(projB, 'equity');
    assert.deepEqual(await herdados(projB), ['equity', 'equity', '-']);
    assert.deepEqual(store.get(projB).timeline.main[2]!.grade, mao, 'grade posta à mão não é sobrescrita');
    // Volta ao Daniel (sem padrão): a herdada sai, a da mão fica; e de novo Equity: herda outra vez.
    await escolherPerfil(projB, 'daniel');
    assert.deepEqual(await herdados(projB), ['-', '-', '-']);
    assert.equal(store.get(projB).timeline.main[0]!.grade, undefined);
    assert.deepEqual(store.get(projB).timeline.main[2]!.grade, mao);
    await escolherPerfil(projB, 'equity');
    // Para o gate, o 3º clipe também com o padrão (o editor colou a grade do padrão).
    store.apply(projB, { by: 'human', op: { type: 'set_clip_grade', clipIds: [c3], grade: null } });
    await escolherPerfil(projB, 'daniel');
    await escolherPerfil(projB, 'equity');
    assert.deepEqual(await herdados(projB), ['equity', 'equity', 'equity']);
  });

  test('trecho restaurado ao lado de clipe herdado volta com a grade herdada', async () => {
    const { store } = await import('./store.ts');
    const id = await novoProjeto('Equity restaurar');
    await escolherPerfil(id, 'equity');
    await falaNaMontagem(id, entregaA);
    const meio = store.get(id).timeline.main[0]!; // o 1º: o restaurado volta na frente e o coalesce juntaria pelo dele
    store.apply(id, { by: 'human', op: { type: 'delete_clip', clipId: meio.id } });
    const rm = store.get(id).timeline.removals.find((r) => r.in === meio.in)!;
    store.apply(id, { by: 'human', op: { type: 'restore', removalId: rm.id } });
    const tl = store.get(id).timeline;
    assert.ok(tl.main.every((c) => c.gradeHerdada === 'equity' && c.grade), JSON.stringify(tl.main.map((c) => [c.in, c.out, c.gradeHerdada])));
  });

  test('gate: no projeto A o clipe com saturação +30% é acusado; no B (+8%) nenhum clipe; a assinatura fixa sai', { timeout: 120_000 }, async () => {
    const { store } = await import('./store.ts');
    const { gateTecnico } = await import('./qc-gate.ts');
    const a = await gateTecnico(store.get(projA), entregaA);
    const corA = a.achados.filter((x) => x.regra === 'padrao-cor');
    assert.equal(corA.length, 1, JSON.stringify(corA));
    assert.equal(corA[0]!.ok, false);
    assert.match(corA[0]!.onde!, /^clipe 2 /);
    const ds = Number(/SATAVG [\d,]+ \(\+(\d+)%\)/.exec(corA[0]!.medido)?.[1]);
    assert.ok(ds >= 25 && ds <= 35, corA[0]!.medido);
    assert.ok(!a.achados.some((x) => x.regra === 'saturacao'), 'o padrão substitui a assinatura');
    assert.ok(a.avisos.some((x) => /padrão de cor de Equity \(1 still\)/.test(x)), JSON.stringify(a.avisos));
    assert.ok(fs.readFileSync(entregaA.replace(/\.mp4$/, '.qc-tecnico.txt'), 'utf8').includes('padrao-cor'));

    const b = await gateTecnico(store.get(projB), entregaB);
    const corB = b.achados.filter((x) => x.regra === 'padrao-cor');
    assert.deepEqual(corB.map((x) => x.ok), [true], JSON.stringify(corB));
    assert.match(corB[0]!.medido, /^3 clipe\(s\) medidos/);
    assert.ok(!b.achados.some((x) => x.regra === 'saturacao'));
  });

  test('sem padrão do cliente: o gate é idêntico ao de antes (assinatura, sem regra de padrão)', { timeout: 120_000 }, async () => {
    const { store } = await import('./store.ts');
    const { assinaturaDoCliente, gateTecnico, padraoCorDoProjeto } = await import('./qc-gate.ts');
    const { qcTecnico } = await import('./qc-tecnico.ts');
    const id = await novoProjeto('Daniel');
    await escolherPerfil(id, 'daniel');
    await falaNaMontagem(id, entregaA);
    const p = store.get(id);
    assert.deepEqual(await padraoCorDoProjeto(p), {});
    const r = await gateTecnico(p, entregaA);
    const antes = await qcTecnico(entregaA, { project: p, assinatura: await assinaturaDoCliente(p) });
    assert.deepEqual(r, antes);
    assert.ok(r.achados.some((x) => x.regra === 'saturacao'));
    assert.ok(!r.achados.some((x) => x.regra === 'padrao-cor'));
  });

  test('gate: projeto do Equity que não herdou (cor à mão antes do padrão) fica no gate de antes, com aviso', { timeout: 120_000 }, async () => {
    const { store } = await import('./store.ts');
    const { assinaturaDoCliente, gateTecnico } = await import('./qc-gate.ts');
    const { qcTecnico } = await import('./qc-tecnico.ts');
    const id = await novoProjeto('Equity lote antigo');
    await escolherPerfil(id, 'daniel');
    await falaNaMontagem(id, entregaA);
    const mao: ColorGrade = { ...NEUTRAL_GRADE, contrast: 0.05 };
    store.apply(id, { by: 'human', op: { type: 'set_clip_grade', clipIds: store.get(id).timeline.main.map((c) => c.id), grade: mao } });
    await escolherPerfil(id, 'equity');
    assert.deepEqual(await herdados(id), ['-', '-', '-']);
    const p = store.get(id);
    const r = await gateTecnico(p, entregaA);
    assert.ok(!r.achados.some((x) => x.regra === 'padrao-cor'), JSON.stringify(r.achados));
    const antes = await qcTecnico(entregaA, { project: p, assinatura: await assinaturaDoCliente(p) });
    assert.deepEqual(r.achados, antes.achados, 'mesmos achados do gate de antes');
    assert.equal(r.aprovado, antes.aprovado);
    assert.ok(r.avisos.some((x) => /padrão de cor de Equity salvo depois deste projeto/.test(x)), JSON.stringify(r.avisos));
  });

  test('PATCH do perfil não mexe no padrão de cor; still com nome fora do padrão (..) dá 404', async () => {
    const { getProfile, gravarPadraoCor } = await import('./profiles.ts');
    const antes = (await getProfile('equity')).cor.padrao!;
    assert.equal(antes.stills.length, 1);
    // A tela de Perfis aberta antes manda o perfil inteiro, com um padrão velho (e um nome de still forjado).
    const velho = { grade: { ...NEUTRAL_GRADE, saturation: 0.5 }, stills: ['../../equity.json'], salvoEm: '2026-01-01T00:00:00.000Z' };
    const r = await app.inject({ method: 'PATCH', url: '/api/perfis/equity', payload: { notas: ['tela velha'], cor: { input: 'rec709', padrao: velho } } });
    assert.equal(r.statusCode, 200, r.body);
    const depois = await getProfile('equity');
    assert.deepEqual(depois.cor.padrao, antes, 'o padrão só muda pelas rotas /padrao-cor');
    assert.equal(depois.cor.input, 'rec709', 'o resto de cor do PATCH vale');
    // Mesmo que um nome forjado chegue ao perfil, ler ou apagar nunca sai da pasta dos stills.
    await gravarPadraoCor('equity', { ...antes, stills: [...antes.stills, '../../equity.json'] });
    const fora = encodeURIComponent('../../equity.json');
    assert.equal((await app.inject({ method: 'GET', url: `/api/perfis/equity/padrao-cor/stills/${fora}` })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/perfis/equity/padrao-cor/stills/${fora}` })).statusCode, 404);
    assert.ok(fs.existsSync(path.join(perfisDir, 'equity.json')));
    assert.equal((await app.inject({ method: 'GET', url: `/api/perfis/equity/padrao-cor/stills/${antes.stills[0]}` })).statusCode, 200);
    await gravarPadraoCor('equity', antes);
  });
});
