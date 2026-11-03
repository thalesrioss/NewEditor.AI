/**
 * BL-0177 (2): cor e enum de legenda, motion e lettering vão crus para o CSS/HTML da camada de texto. Na op, fora
 * da regra = OpError (400 na API); no projeto já gravado com valor ruim, o normalize põe o padrão e o projeto carrega.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { letteringFromText, type LetteringSpec } from './lettering.ts';
import { DEFAULT_MOTION_STYLE, motionHtml, type MotionSpec } from './motion.ts';
import { captionDefaults, DEFAULT_CAPTIONS, type CaptionSettings } from './text.ts';
import { applyOp, normalizeTimeline, OpError } from './timeline.ts';
import { DEFAULT_TRACKS, TIMELINE_ANCHOR, type OverlayItem, type Timeline } from './types.ts';

const XSS = ['red"><script>alert(1)</script>', "#fff;background:url('x')", '#ff00zz', 'var(--x)', '#ffff', 12];

const motion = (over: Partial<MotionSpec> = {}): MotionSpec => ({ template: 'numero', funcao: 'prove', fala: 'custou 23', ideia: '', texts: ['R$ 23', ''], beats: [0.6], style: DEFAULT_MOTION_STYLE, seed: 7, ...over });
const lettering = (over: Partial<LetteringSpec> = {}): LetteringSpec => ({ ...letteringFromText('e me custou *23 reais*', 'glow'), ...over });
const ov = (id: string, source: OverlayItem['source']): OverlayItem => ({ id, trackId: 'V3', role: source.type === 'motion' ? 'motion' : 'lettering', anchor: { assetId: TIMELINE_ANCHOR, at: 0 }, duration: 2, source, by: 'agent' } as OverlayItem);
const base = (overlays: OverlayItem[] = []): Timeline => ({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 10, by: 'system' }], removals: [], pins: [], tracks: DEFAULT_TRACKS, overlays });
const recusa = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof OpError && re.test(e.message));

test('set_captions: accent com aspas/HTML (e qualquer cor fora de #hex) é OpError; a timeline fica intacta', () => {
  const t = base();
  for (const v of XSS) for (const k of ['accent', 'color', 'strokeColor', 'shadowColor', 'boxColor'] as const) {
    recusa(() => applyOp(t, { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, [k]: v } as CaptionSettings }, 'agent'), new RegExp(`set_captions: ${k}`));
  }
  assert.equal(t.captions, undefined);
});

test('set_captions: #rgb, #rrggbb e #rrggbbaa passam', () => {
  for (const v of ['#fff', '#E8B44A', '#00000080']) assert.equal(applyOp(base(), { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, accent: v } }, 'agent').captions?.accent, v);
});

test('set_captions: enum fora da lista é OpError; ausente vem do padrão como antes', () => {
  for (const [k, v] of [['font', 'comic"sans'], ['style', 'karaoke'], ['animIn', 'x'], ['animOut', 'pop'], ['wordAnim', '<b>']] as const) {
    recusa(() => applyOp(base(), { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, [k]: v } as unknown as CaptionSettings }, 'agent'), new RegExp(`set_captions: ${k}`));
  }
  assert.equal(applyOp(base(), { type: 'set_captions', captions: { font: 'anton' } as CaptionSettings }, 'agent').captions?.style, DEFAULT_CAPTIONS.style);
});

test('motion: cor do estilo e enum fora da regra são OpError em add_overlay e set_overlay_motion', () => {
  const t = base([ov('m1', { type: 'motion', motion: motion() })]);
  for (const v of XSS) {
    recusa(() => applyOp(t, { type: 'set_overlay_motion', id: 'm1', motion: motion({ style: { ...DEFAULT_MOTION_STYLE, accent: v as string } }) }, 'agent'), /style\.accent/);
    recusa(() => applyOp(base(), { type: 'add_overlay', item: ov('m2', { type: 'motion', motion: motion({ style: { ...DEFAULT_MOTION_STYLE, bg: v as string } }) }) }, 'agent'), /add_overlay: style\.bg/);
  }
  recusa(() => applyOp(t, { type: 'set_overlay_motion', id: 'm1', motion: motion({ style: { ...DEFAULT_MOTION_STYLE, font: 'x' as never } }) }, 'agent'), /style\.font/);
  recusa(() => applyOp(t, { type: 'set_overlay_motion', id: 'm1', motion: motion({ style: { ...DEFAULT_MOTION_STYLE, material: 'vidro' as never } }) }, 'agent'), /style\.material/);
  recusa(() => applyOp(t, { type: 'set_overlay_motion', id: 'm1', motion: motion({ template: 'banner' as never }) }, 'agent'), /template/);
  recusa(() => applyOp(t, { type: 'set_overlay_motion', id: 'm1', motion: motion({ funcao: 'vender' as never }) }, 'agent'), /funcao/);
  const ok = applyOp(t, { type: 'set_overlay_motion', id: 'm1', motion: motion({ style: { ...DEFAULT_MOTION_STYLE, accent: '#ff3b30cc' } }) }, 'agent');
  assert.equal((ok.overlays[0]!.source as { motion: MotionSpec }).motion.style.accent, '#ff3b30cc');
});

test('lettering: accent com aspas/HTML, estilo, align e cor do template fora da regra são OpError', () => {
  const t = base([ov('l1', { type: 'lettering', lettering: lettering() })]);
  for (const v of XSS) {
    recusa(() => applyOp(t, { type: 'set_overlay_lettering', id: 'l1', lettering: lettering({ accent: v as string }) }, 'agent'), /set_overlay_lettering: accent/);
    recusa(() => applyOp(base(), { type: 'add_overlay', item: ov('l2', { type: 'lettering', lettering: lettering({ accent: v as string }) }) }, 'agent'), /add_overlay: accent/);
    recusa(() => applyOp(t, { type: 'set_overlay_lettering', id: 'l1', lettering: lettering({ estilo: 'cliente', template: { color: v as string } }) }, 'agent'), /template\.color/);
  }
  recusa(() => applyOp(t, { type: 'set_overlay_lettering', id: 'l1', lettering: lettering({ estilo: 'neon' as never }) }, 'agent'), /estilo/);
  recusa(() => applyOp(t, { type: 'set_overlay_lettering', id: 'l1', lettering: lettering({ align: 'justify' as never }) }, 'agent'), /align/);
  assert.equal((applyOp(t, { type: 'set_overlay_lettering', id: 'l1', lettering: lettering({ accent: '#0f0' }) }, 'agent').overlays[0]!.source as { lettering: LetteringSpec }).lettering.accent, '#0f0');
});

test('projeto antigo com cor/enum inválido carrega: normalize põe o padrão e nada cru chega ao HTML', () => {
  const ruim = 'red"><script>alert(1)</script>';
  const t = normalizeTimeline({
    ...base([
      ov('m1', { type: 'motion', motion: motion({ style: { ...DEFAULT_MOTION_STYLE, accent: ruim, font: 'x' as never } }) }),
      ov('l1', { type: 'lettering', lettering: lettering({ accent: ruim, align: 'x' as never, template: { color: ruim, shadowColor: '#000' } }) }),
    ]),
    captions: { ...DEFAULT_CAPTIONS, accent: ruim, color: '#123456', font: 'comic' as never },
  });
  assert.equal(t.captions?.color, '#123456', 'cor válida fica');
  assert.equal(captionDefaults(t.captions!).accent, '#E8B44A', 'accent cai no padrão');
  assert.equal(captionDefaults(t.captions!).font, 'inter', 'fonte cai no padrão');
  const m = (t.overlays[0]!.source as { motion: MotionSpec }).motion;
  assert.equal(m.style.accent, DEFAULT_MOTION_STYLE.accent);
  assert.equal(m.style.font, DEFAULT_MOTION_STYLE.font);
  assert.ok(!motionHtml(m, 1, 3, 56.25).includes('<script>'));
  const l = (t.overlays[1]!.source as { lettering: LetteringSpec }).lettering;
  assert.equal(l.accent, undefined, 'sem accent, vale o do estilo');
  assert.equal(l.align, undefined);
  assert.deepEqual(l.template, { shadowColor: '#000' });
  // Timeline normalizada aceita op nova normalmente.
  assert.ok(applyOp(t, { type: 'set_zoom', clipId: 'c1', zoom: 1.2 }, 'human'));
});
