import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrastRatio, DEFAULT_MOTION_STYLE, motionHtml, styleFromReference, type MotionSpec } from './motion.ts';
import { motionCues, synthSfx } from './sfx.ts';
import { applyOp, editorialWarnings, normalizeTimeline } from './timeline.ts';
import type { Timeline } from './types.ts';

const spec = (over: Partial<MotionSpec> = {}): MotionSpec => ({
  template: 'numero',
  funcao: 'prove',
  fala: 'me custou 23 reais',
  ideia: '',
  texts: ['R$ 23', ''],
  beats: [0.6],
  style: DEFAULT_MOTION_STYLE,
  seed: 7,
  ...over,
});

test('motion é função pura do tempo: mesmo t, mesmo quadro; fora da duração, nada', () => {
  for (const template of ['palavra', 'pergunta', 'contraste', 'numero', 'lista', 'citacao'] as const) {
    const s = spec({ template, texts: ['um', 'dois', 'três'], beats: [0.2, 0.6, 1], key: 1 });
    const a = motionHtml(s, 1.234, 3, 56.25);
    assert.ok(a.includes('ne-motion'), template);
    assert.equal(a, motionHtml(s, 1.234, 3, 56.25), template);
    assert.equal(motionHtml(s, -0.01, 3, 56.25), '');
    assert.equal(motionHtml(s, 3, 3, 56.25), '');
  }
});

test('número conta até o valor dito e para nele', () => {
  const s = spec();
  assert.match(motionHtml(s, 2.4, 2.6, 56.25), /R\$ 23</);
  assert.doesNotMatch(motionHtml(s, 0.5, 2.6, 56.25), /R\$ 23</);
});

test('estilo da referência: fundo escuro, tinta clara e um acento vivo', () => {
  const st = styleFromReference(['#E3A43A', '#FFD27A', '#3A2A1C', '#EADFCB', '#7A2E1E', '#1E3C8C'], ['Documentário histórico', 'Tipografia como imagem']);
  assert.equal(st.bg, '#3A2A1C');
  assert.equal(st.ink, '#EADFCB');
  assert.equal(st.font, 'serif');
  assert.ok(contrastRatio(st.accent, st.bg) > 3, st.accent);
});

test('acento sem contraste vira marca-texto (amarelo no papel)', () => {
  const st = styleFromReference(['#E6E6E2', '#1C1C1C', '#F5E625', '#E5484D'], ['Papel e colagem']);
  assert.equal(st.material, 'papel');
  const html = motionHtml(spec({ style: st }), 2, 2.6, 56.25);
  assert.match(html, /linear-gradient\(180deg,transparent 56%,#F5E625/);
});

const tl = (): Timeline =>
  normalizeTimeline({
    fps: 30,
    width: 1080,
    height: 1920,
    main: [{ id: 'c1', assetId: 'a', in: 0, out: 60, by: 'agent' }],
  });

test('motion na V3: editar o texto à mão passa o motion para o humano; regra dos 2×', () => {
  let t = tl();
  for (let i = 0; i < 3; i++) t = applyOp(t, { type: 'add_overlay', item: { id: `m${i}`, trackId: 'V3', role: 'motion', anchor: { assetId: 'a', at: 5 + i * 10 }, duration: 3, source: { type: 'motion', motion: spec() } } }, 'agent');
  t = applyOp(t, { type: 'set_overlay_motion', id: 'm0', motion: spec({ texts: ['R$ 30', ''] }) }, 'human');
  assert.equal(t.overlays.find((o) => o.id === 'm0')!.by, 'human');
  assert.equal(t.overlays.find((o) => o.id === 'm1')!.by, 'agent');
  const w = editorialWarnings(t);
  assert.ok(w.some((x) => x.level === 'erro' && x.message.includes('Número gigante') && x.overlayIds.length === 3));
});

test('obra-alvo do vídeo entra e sai da timeline', () => {
  let t = applyOp(tl(), { type: 'set_motion_ref', refId: 'tinocando-04-agostinho' }, 'human');
  assert.equal(t.motionRef, 'tinocando-04-agostinho');
  t = applyOp(t, { type: 'set_motion_ref', refId: null }, 'human');
  assert.equal(t.motionRef, undefined);
});

test('SFX: um efeito por ação, nos tempos da animação, sintetizado igual sempre', () => {
  const lista = spec({ template: 'lista', texts: ['a', 'b', 'c'], beats: [0.5, 1.2, 1.9] });
  const cues = motionCues(lista, 3);
  assert.equal(cues.filter((c) => c.kind === 'stamp').length, 3);
  assert.ok(cues.every((c) => c.t >= 0 && c.t <= 3));
  const a = synthSfx(cues[1]!);
  const b = synthSfx(cues[1]!);
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => Number.isFinite(v) && Math.abs(v) <= 1));
  assert.deepEqual(motionCues({ ...lista, sfx: false }, 3), []);
  const cit = motionCues(spec({ template: 'citacao', texts: ['uma', 'frase'], beats: [0.5, 0.8], key: 1 }), 3);
  assert.ok(cit.some((c) => c.kind === 'type') && cit.some((c) => c.kind === 'marker'));
});
