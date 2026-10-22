/**
 * CH-0019: o render falhou na hora (bruto num disco externo que não abriu), mas o aviso só ia pelo WebSocket e sumiu
 * quando o servidor religou; quem acompanhava por HTTP via "queued" e mais nada. Confere: (1) o último trabalho que
 * falhou fica gravado com o erro e sobrevive a reinício; (2) erro do ffmpeg em /Volumes/... vira aviso do disco externo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-fila-resultado-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
fs.mkdirSync(path.join(tmp, 'data', 'projects'), { recursive: true });

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('resultado do último trabalho da fila (CH-0019)', () => {
  test('falha do render fica gravada com o erro, e o sucesso seguinte a substitui', async () => {
    const { registerJob, enqueueJob, lastResult } = await import('./jobs.ts');
    let falhar = true;
    registerJob('render', async () => {
      if (falhar) throw new Error('ffmpeg saiu com 183: moov atom not found\nError opening input file /Volumes/Thales SSD/Brutas/C3823.MP4.');
      return 'ok';
    });
    await assert.rejects(enqueueJob('prj_a', 'render'));
    const r = await lastResult('prj_a');
    assert.equal(r?.estado, 'falhou');
    assert.equal(r?.kind, 'render');
    assert.match(r?.erro ?? '', /moov atom not found/);
    assert.match(r?.erro ?? '', /disco externo "Thales SSD"/);

    const salvo = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'fila-resultados.json'), 'utf8'));
    assert.equal(salvo.prj_a.estado, 'falhou', 'gravado em disco: sobrevive ao servidor religar');

    falhar = false;
    await enqueueJob('prj_a', 'render');
    assert.equal((await lastResult('prj_a'))?.estado, 'ok');
    assert.equal((await lastResult('prj_b')), undefined);
  });

  test('erro fora de disco externo passa sem o aviso', async () => {
    const { explicarFalha } = await import('./jobs.ts');
    assert.equal(explicarFalha('moov atom not found em /Users/x/a.mp4'), 'moov atom not found em /Users/x/a.mp4');
    assert.doesNotMatch(explicarFalha('Error opening input file /Volumes/SSD/a.mp4: deu outro erro qualquer'), /disco externo/);
  });
});
