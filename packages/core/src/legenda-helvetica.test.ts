import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captionDefaults, captionInlineStyle, CAPTION_FONTS, DEFAULT_CAPTIONS, type CaptionFont } from './text.ts';

test('legenda (CH-0012): Helvetica Neue entre as fontes, e fonte desconhecida cai na Inter em vez de quebrar', () => {
  assert.equal(CAPTION_FONTS.helvetica.label, 'Helvetica Neue');
  assert.match(captionInlineStyle({ ...DEFAULT_CAPTIONS, font: 'helvetica' }, { t: 0, start: 0, end: 1 }), /font-family:'Helvetica Neue'/);
  assert.match(captionInlineStyle({ ...DEFAULT_CAPTIONS, font: 'comic' as CaptionFont }, { t: 0, start: 0, end: 1 }), /font-family:'Inter'/);
  assert.equal(captionDefaults({ ...DEFAULT_CAPTIONS, font: 'helvetica' }).font, 'helvetica');
});
