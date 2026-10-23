import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOp } from './timeline.ts';
import { DEFAULT_CAPTIONS, type CaptionSettings } from './text.ts';
import { DEFAULT_TRACKS, type Timeline } from './types.ts';

const base = (): Timeline => ({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 10, by: 'system' }], removals: [], pins: [], tracks: DEFAULT_TRACKS, overlays: [] });

test('set_captions parcial (BL-0100, CH-0012): campos obrigatórios que faltam vêm do padrão, nunca ficam indefinidos', () => {
  // A API recebe JSON: mandar só a fonte deixava `position` indefinida e a legenda/lettering ia para o topo (NaN%).
  const t = applyOp(base(), { type: 'set_captions', captions: { font: 'helvetica' } as unknown as CaptionSettings }, 'agent');
  assert.equal(t.captions?.font, 'helvetica');
  for (const k of ['enabled', 'style', 'uppercase', 'highlight', 'position'] as const) assert.equal(t.captions?.[k], DEFAULT_CAPTIONS[k], k);
});

test('set_captions continua trocando o objeto inteiro: opcional omitido sai, obrigatório mandado vale', () => {
  const t1 = applyOp(base(), { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, enabled: true, position: 0.67, size: 5 } }, 'agent');
  const t2 = applyOp(t1, { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, enabled: true, position: 0.67 } }, 'agent');
  assert.equal(t2.captions?.size, undefined);
  assert.equal(t2.captions?.position, 0.67);
  assert.equal(t2.captions?.enabled, true);
});

test('set_captions com posição fora do número cai no padrão', () => {
  const t = applyOp(base(), { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, position: 'meio' as unknown as number } }, 'agent');
  assert.equal(t.captions?.position, DEFAULT_CAPTIONS.position);
});

test('overLayers (BL-0100): legenda continua visível sob B-roll; sem a opção, some como antes', async () => {
  const { buildCues, cueVisible } = await import('./text.ts');
  const words = { a: [{ w: 'olha', start: 1, end: 1.4 }, { w: 'isso', start: 1.4, end: 1.8 }] };
  const t = applyOp(base(), { type: 'add_overlay', item: { trackId: 'V2', role: 'broll', anchor: { assetId: 'a', at: 0.5 }, duration: 2, source: { type: 'media', assetId: 'b', in: 0 } } }, 'agent');
  const s = { ...DEFAULT_CAPTIONS, enabled: true };
  assert.ok(buildCues(t, words, s).every((c) => !cueVisible(c)), 'sem overLayers a legenda some sob o B-roll');
  assert.ok(buildCues(t, words, { ...s, overLayers: true }).every((c) => cueVisible(c)), 'com overLayers a legenda fica');
});
