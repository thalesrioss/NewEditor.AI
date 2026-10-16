import assert from 'node:assert/strict';
import { test } from 'node:test';
import { letteringCues, letteringFrameHtml, letteringFromText, LETTERING_STYLES, type LetteringStyleId } from './lettering.ts';

test('lettering: "*" marca a palavra-chave e ela ganha linha própria', () => {
  const s = letteringFromText('e me custou *23 reais*');
  assert.deepEqual(
    s.words.map((w) => [w.text, w.line, !!w.destaque]),
    [
      ['e', 0, false],
      ['me', 0, false],
      ['custou', 0, false],
      ['23', 1, true],
      ['reais', 1, true],
    ],
  );
});

test('lettering: função pura do tempo, no lugar da legenda, palavra só aparece quando é falada', () => {
  for (const estilo of Object.keys(LETTERING_STYLES) as LetteringStyleId[]) {
    const s = { ...letteringFromText('e me custou *23 reais*', estilo), words: letteringFromText('e me custou *23 reais*').words.map((w, i) => ({ ...w, at: 0.2 + i * 0.3 })) };
    const a = letteringFrameHtml(s, 0.5, 2.4, 56.25, 0.72);
    assert.equal(a, letteringFrameHtml(s, 0.5, 2.4, 56.25, 0.72), estilo);
    assert.match(a, /top:72%/, estilo);
    assert.equal(letteringFrameHtml(s, 2.4, 2.4, 56.25, 0.72), '');
    // antes de "reais" ser dito ele existe (ocupa o lugar) mas está invisível
    assert.match(letteringFrameHtml(s, 0.25, 2.4, 56.25, 0.72), /opacity:0">(REAIS|reais)</, estilo);
  }
});

test('lettering: SFX sutis — um por palavra-chave no estilo pop, batidas na máquina de escrever', () => {
  const pop = { ...letteringFromText('e me custou *23 reais*', 'pop-box') };
  assert.equal(letteringCues(pop, 2.4).filter((c) => c.kind === 'pop').length, 1);
  const tw = letteringFromText('o sentido é a *busca*', 'typewriter');
  assert.ok(letteringCues(tw, 3).filter((c) => c.kind === 'type').length >= 5);
  assert.deepEqual(letteringCues({ ...pop, sfx: false }, 2.4), []);
});
