import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duracaoAlvoDoProjeto, duracaoMaxDoTexto, passaDoAlvo, textoPassaDoAlvo } from './briefing.ts';
import { DEFAULT_TRACKS, type Timeline } from './types.ts';

test('duracaoMaxDoTexto: as frases de briefing que pedem duração máxima', () => {
  // A frase do FB-0020, e as variações de "até N s/segundos/min".
  assert.equal(duracaoMaxDoTexto('Reels 9:16 até 60s, tom direto, cortar respiros e erros.'), 60);
  assert.equal(duracaoMaxDoTexto('Corte para Shorts com até 45 segundos.'), 45);
  assert.equal(duracaoMaxDoTexto('Vídeo de até 2 min para o YouTube'), 120);
  assert.equal(duracaoMaxDoTexto('No máximo 90 seg, por favor'), 90);
  assert.equal(duracaoMaxDoTexto('Peça de 30 a 45 s, legenda amarela'), 45);
  assert.equal(duracaoMaxDoTexto('Até 1:30, sem trilha'), 90);
  assert.equal(duracaoMaxDoTexto('até 1min30 no máximo'), 90);
});

test('duracaoMaxDoTexto: sem número de duração no texto, sem alvo', () => {
  assert.equal(duracaoMaxDoTexto('Reels 9:16, tom direto, cortar respiros.'), undefined);
  assert.equal(duracaoMaxDoTexto('O bruto tem 20 min; entregar até sexta.'), undefined);
  assert.equal(duracaoMaxDoTexto(''), undefined);
});

const tl = (dur: number): Timeline => ({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: dur, by: 'system' }], removals: [], pins: [], tracks: DEFAULT_TRACKS, overlays: [] });

test('duracaoAlvoDoProjeto: tarefa do Gestor primeiro, briefing manual sem tarefa', () => {
  assert.equal(duracaoAlvoDoProjeto({ brief: 'até 60s', task: { texto: 'até 30 segundos' } }), 30);
  assert.equal(duracaoAlvoDoProjeto({ brief: 'até 60s' }), 60);
  assert.equal(duracaoAlvoDoProjeto({ brief: '' }), undefined);
});

test('passaDoAlvo: só acima do alvo (com meio segundo de folga)', () => {
  assert.deepEqual(passaDoAlvo({ brief: 'até 60s', timeline: tl(74) }), { total: 74, alvo: 60 });
  assert.equal(passaDoAlvo({ brief: 'até 60s', timeline: tl(60.4) }), undefined);
  assert.equal(passaDoAlvo({ brief: 'até 60s', timeline: tl(52) }), undefined);
  assert.equal(passaDoAlvo({ brief: 'Reels', timeline: tl(300) }), undefined);
});

test('textoPassaDoAlvo: as duas durações e o excesso', () => {
  assert.equal(textoPassaDoAlvo({ total: 74.2, alvo: 60 }), 'Peça com 1:14; o briefing pede até 1:00 (passa 15 s)');
});
