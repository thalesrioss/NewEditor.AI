import assert from 'node:assert/strict';
import { test } from 'node:test';
import { letteringCues, letteringFrameHtml, letteringFromText, LETTERING_STYLES, TEMPLATE_EXEMPLO, templateCliente, type LetteringStyleId } from './lettering.ts';

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
    // antes de "reais" ser dito ele existe (ocupa o lugar) mas está invisível (menos no template do cliente: troca seca)
    if (estilo !== 'cliente') assert.match(letteringFrameHtml(s, 0.25, 2.4, 56.25, 0.72), /opacity:0">(REAIS|reais)</, estilo);
  }
});

test('lettering: SFX sutis — um por palavra-chave no estilo pop, batidas na máquina de escrever', () => {
  const pop = { ...letteringFromText('e me custou *23 reais*', 'pop-box') };
  assert.equal(letteringCues(pop, 2.4).filter((c) => c.kind === 'pop').length, 1);
  const tw = letteringFromText('o sentido é a *busca*', 'typewriter');
  assert.ok(letteringCues(tw, 3).filter((c) => c.kind === 'type').length >= 5);
  assert.deepEqual(letteringCues({ ...pop, sfx: false }, 2.4), []);
});

test('lettering cliente (CH-0012): template com fonte, cor, tracking e caixa alta, troca seca sem animação', () => {
  const base = letteringFromText('você *não precisa* disso', 'cliente');
  const spec = { ...base, words: base.words.map((w, i) => ({ ...w, at: 0.2 + i * 0.3 })), template: TEMPLATE_EXEMPLO };
  const first = letteringFrameHtml(spec, 0, 2, 56.25, 0.72);
  // Tudo visível já no 1º quadro, nada animado; o mesmo HTML em qualquer quadro (vira um PNG só no export).
  assert.equal(letteringFrameHtml(spec, 1.9, 2, 56.25, 0.72), first);
  assert.doesNotMatch(first, /opacity|blur|scale\(/);
  assert.match(first, /font-family:'Helvetica Neue'/);
  assert.match(first, /font-weight:700/);
  assert.match(first, /color:#D51800/);
  assert.match(first, /letter-spacing:-0.06em/);
  assert.match(first, /NÃO PRECISA/);
  assert.match(first, /text-shadow:none/);
  assert.equal(letteringFrameHtml(spec, 2, 2, 56.25, 0.72), '');
  // Sem SFX: troca seca.
  assert.deepEqual(letteringCues(spec, 2), []);
});

test('lettering cliente: valores fora do padrão não entram crus no HTML', () => {
  const tp = templateCliente({ font: "Evil'</div><script>", color: 'red;background:url(x)', weight: 2000, tracking: -5, size: 99 });
  assert.equal(tp.family, "'Evildivscript','Helvetica Neue',Helvetica,Arial,sans-serif");
  assert.equal(tp.color, '#FFFFFF');
  assert.equal(tp.weight, 900);
  assert.equal(tp.tracking, -0.3);
  assert.equal(tp.size, 30);
  const d = templateCliente(undefined);
  assert.deepEqual([d.weight, d.color, d.tracking, d.upper, d.shadow], [700, '#FFFFFF', 0, false, 0]);
  const html = letteringFrameHtml({ ...letteringFrameSpec('<b>oi</b>'), template: { font: 'Inter', color: '#abc' } }, 0, 1, 56.25, 0.5);
  assert.match(html, /&lt;b&gt;oi&lt;\/b&gt;/);
  assert.match(html, /color:#abc/);
});

test('lettering cliente (CH-0034): intensidade e desfoque da sombra e contorno fino, conferidos', () => {
  const spec = (template: object) => letteringFrameHtml({ ...letteringFrameSpec('do público errado'), template: { color: '#E4B249', ...template } }, 0, 1, 56.25, 0.19);
  // true continua igual ao de antes (uma camada, 0,62).
  assert.match(spec({ shadow: true }), /text-shadow:0 0\.05em 0\.3em rgba\(0,0,0,0\.62\);/);
  // intensidade 2 = a 2ª camada idêntica do editor: opacidade satura e entra uma camada mais justa.
  const forte = spec({ shadow: 2, shadowBlur: 0.5 });
  assert.match(forte, /text-shadow:0 0\.05em 0\.5em rgba\(0,0,0,1\),0 0\.02em 0\.2em rgba\(0,0,0,0\.62\);/);
  assert.match(spec({ shadow: 3 }).match(/text-shadow:[^;]*/)![0], /,.*,/);
  // Contorno: por trás do preenchimento, sem engordar a letra por dentro.
  assert.match(spec({ stroke: 0.03, strokeColor: '#111' }), /-webkit-text-stroke:0\.06em #111;paint-order:stroke fill;/);
  assert.match(spec({ shadow: 0 }), /text-shadow:none;/);
  assert.doesNotMatch(spec({ shadow: 0 }), /text-stroke/);
  // Fora da faixa ou cru não entra.
  const tp = templateCliente({ shadow: 9, shadowBlur: -1, stroke: 5, strokeColor: 'red;x:y', shadowColor: '#abc' });
  assert.deepEqual([tp.shadow, tp.shadowBlur, tp.stroke, tp.strokeColor], [3, 0, 0.2, '#000000']);
  assert.match(spec({ shadow: 1, shadowColor: '#abc' }), /rgba\(170,187,204,0\.62\)/);
});

const letteringFrameSpec = (t: string) => letteringFromText(t, 'cliente');
