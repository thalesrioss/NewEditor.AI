import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, snapCut, PISCA, clipDuration, clipStarts, editorialWarnings, flashShutterCues, locate, normalizeTimeline, overlayActive, resolveOverlay, sourceToTimeline, timelineDuration, trackFlag, zoomAt, OpError } from './timeline.ts';
import { DEFAULT_TRACKS, TRACK_HEIGHT_MAX, TRACK_HEIGHT_MIN, type Timeline } from './types.ts';
import { buildCues, DEFAULT_CAPTIONS } from './text.ts';
import { gradePixel, NEUTRAL_GRADE } from './color.ts';

const base = (): Timeline => ({
  fps: 30,
  width: 1080,
  height: 1920,
  main: [{ id: 'c1', assetId: 'a', in: 0, out: 100, by: 'system' }],
  removals: [],
  pins: [],
  tracks: DEFAULT_TRACKS,
  overlays: [],
});

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('cut_source divide o clipe e registra a remoção', () => {
  const t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'retake', reason: 'tomada 1' }, 'agent');
  assert.equal(t.main.length, 2);
  assert.deepEqual([t.main[0]!.in, t.main[0]!.out, t.main[1]!.in, t.main[1]!.out], [0, 10, 20, 100]);
  close(timelineDuration(t), 90);
  assert.equal(t.removals.length, 1);
  assert.equal(t.removals[0]!.kind, 'retake');
});

test('cortes sucessivos na fonte não dependem da ordem', () => {
  let a = base();
  let b = base();
  a = applyOp(a, { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'silence', reason: '' }, 'agent');
  a = applyOp(a, { type: 'cut_source', assetId: 'a', in: 50, out: 60, kind: 'silence', reason: '' }, 'agent');
  b = applyOp(b, { type: 'cut_source', assetId: 'a', in: 50, out: 60, kind: 'silence', reason: '' }, 'agent');
  b = applyOp(b, { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'silence', reason: '' }, 'agent');
  assert.deepEqual(a.main.map((c) => [c.in, c.out]), b.main.map((c) => [c.in, c.out]));
});

test('restore devolve o trecho na posição cronológica e junta com os vizinhos', () => {
  let t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'retake', reason: '' }, 'agent');
  t = applyOp(t, { type: 'restore', removalId: t.removals[0]!.id }, 'human');
  assert.equal(t.main.length, 1);
  assert.deepEqual([t.main[0]!.in, t.main[0]!.out], [0, 100]);
  assert.equal(t.removals.length, 0);
});

test('cut_timeline usa tempo de saída, atravessando clipes', () => {
  let t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'silence', reason: '' }, 'agent');
  // timeline: [0-10][20-100]; cortar 5–15 da timeline = fonte 5–10 e 20–25
  t = applyOp(t, { type: 'cut_timeline', start: 5, end: 15, reason: 'pedido' }, 'human');
  assert.deepEqual(t.main.map((c) => [c.in, c.out]), [[0, 5], [25, 100]]);
  close(timelineDuration(t), 80);
});

test('locate e sourceToTimeline são inversos dentro da timeline', () => {
  let t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'silence', reason: '' }, 'agent');
  t = applyOp(t, { type: 'cut_source', assetId: 'a', in: 40, out: 45, kind: 'silence', reason: '' }, 'agent');
  for (const tl of [0, 3.3, 9.99, 10, 27, 60, 84.9]) {
    const loc = locate(t, tl)!;
    close(sourceToTimeline(t, 'a', loc.sourceTime)!, tl);
  }
  assert.equal(sourceToTimeline(t, 'a', 15), null, 'trecho cortado não está na timeline');
  assert.deepEqual(clipStarts(t), [0, 10, 30]);
});

test('split no meio do clipe e set_zoom só no pedaço', () => {
  let t = applyOp(base(), { type: 'split', time: 30 }, 'human');
  assert.equal(t.main.length, 2);
  t = applyOp(t, { type: 'set_zoom', clipId: t.main[1]!.id, zoom: 1.1 }, 'agent');
  assert.equal(t.main[0]!.zoom, undefined);
  assert.equal(t.main[1]!.zoom, 1.1);
});

test('set_zoom aceita enquadramento fechado acima de 2× (CH-0013) até 4×', () => {
  let t = applyOp(base(), { type: 'set_zoom', clipId: 'c1', zoom: 2.6 }, 'agent');
  assert.equal(t.main[0]!.zoom, 2.6);
  t = applyOp(t, { type: 'set_zoom', clipId: 'c1', zoom: 2.6, zoomTo: 3 }, 'agent');
  assert.equal(t.main[0]!.zoomTo, 3);
  assert.throws(() => applyOp(t, { type: 'set_zoom', clipId: 'c1', zoom: 4.01 }, 'agent'), OpError);
  assert.throws(() => applyOp(t, { type: 'set_zoom', clipId: 'c1', zoom: 2, zoomTo: 4.5 }, 'agent'), OpError);
  assert.throws(() => applyOp(t, { type: 'set_zoom', clipId: 'c1', zoom: Number.NaN }, 'agent'), OpError);
});

test('operação inválida lança OpError e não altera nada', () => {
  const t = base();
  assert.throws(() => applyOp(t, { type: 'restore', removalId: 'nao-existe' }, 'human'), OpError);
  assert.throws(() => applyOp(t, { type: 'set_zoom', clipId: 'c1', zoom: 5 }, 'agent'), OpError);
  assert.equal(t.main.length, 1);
});

// --- Multitrilha, pins e regras editoriais ---------------------------------

const broll = (at: number, assetId = 'b1', duration = 4) => ({
  type: 'add_overlay' as const,
  item: { trackId: 'V2', role: 'broll' as const, anchor: { assetId: 'a', at }, duration, source: { type: 'media' as const, assetId, in: 0 } },
});

test('overlay ancorado na fala anda junto quando cortam antes dele', () => {
  let t = applyOp(base(), broll(50), 'agent');
  const id = t.overlays[0]!.id;
  assert.deepEqual(resolveOverlay(t, t.overlays[0]!), { start: 50, end: 54 });
  t = applyOp(t, { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'retake', reason: '' }, 'agent');
  assert.deepEqual(resolveOverlay(t, t.overlays.find((o) => o.id === id)!), { start: 40, end: 44 });
  t = applyOp(t, { type: 'split', time: 30 }, 'human');
  assert.deepEqual(resolveOverlay(t, t.overlays[0]!), { start: 40, end: 44 }, 'dividir não mexe no overlay');
});

test('overlay vira órfão se a fala onde estava foi cortada, e volta ao restaurar', () => {
  let t = applyOp(base(), broll(15), 'agent');
  t = applyOp(t, { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'retake', reason: '' }, 'agent');
  assert.equal(resolveOverlay(t, t.overlays[0]!), null);
  assert.ok(editorialWarnings(t).some((w) => w.message.includes('órfão')));
  t = applyOp(t, { type: 'restore', removalId: t.removals[0]!.id }, 'human');
  assert.deepEqual(resolveOverlay(t, t.overlays[0]!), { start: 15, end: 19 });
});

test('regra dos 2×: o mesmo B-roll pela terceira vez vira erro editorial', () => {
  let t = applyOp(base(), broll(5), 'agent');
  t = applyOp(t, broll(30), 'agent');
  assert.equal(editorialWarnings(t).filter((w) => w.level === 'erro').length, 0);
  t = applyOp(t, broll(60), 'agent');
  const errs = editorialWarnings(t).filter((w) => w.level === 'erro');
  assert.equal(errs.length, 1);
  assert.equal(errs[0]!.overlayIds.length, 3);
});

test('B-roll curto demais gera aviso de "pisca"', () => {
  const t = applyOp(base(), broll(5, 'b2', 1.5), 'agent');
  assert.ok(editorialWarnings(t).some((w) => w.message.includes('pisca')));
});

test('trilha só aceita o papel dela', () => {
  assert.throws(() => applyOp(base(), { ...broll(5), item: { ...broll(5).item, trackId: 'A2' } }, 'agent'), OpError);
});

test('restaurar pelo humano cria pin; cortar de novo pelo humano desfaz o pin', () => {
  let t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'retake', reason: '' }, 'agent');
  t = applyOp(t, { type: 'restore', removalId: t.removals[0]!.id }, 'human');
  assert.deepEqual(t.pins.map((p) => [p.in, p.out]), [[10, 20]]);
  t = applyOp(t, { type: 'cut_source', assetId: 'a', in: 12, out: 14, kind: 'manual', reason: '' }, 'human');
  assert.deepEqual(t.pins.map((p) => [p.in, p.out]), [[10, 12], [14, 20]]);
});

test('trim que encolhe registra o trecho aparado; trim que estende tira dos removidos', () => {
  let t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 10, out: 20, kind: 'silence', reason: '' }, 'agent');
  const first = t.main[0]!; // 0–10
  t = applyOp(t, { type: 'trim', clipId: first.id, out: 8 }, 'human');
  assert.ok(t.removals.some((r) => r.in === 8 && r.out === 10 && r.reason.includes('aparado')));
  t = applyOp(t, { type: 'trim', clipId: first.id, out: 12 }, 'human');
  assert.ok(!t.removals.some((r) => r.in < 12 && r.out > 8), 'o que voltou não pode continuar como removido');
  assert.deepEqual(t.removals.map((r) => [r.in, r.out]), [[12, 20]]);
});

test('projeto antigo sem multitrilha é migrado sem perder nada', () => {
  const old = { fps: 30, width: 1080, height: 1920, main: base().main, removals: [] } as never;
  const t = normalizeTimeline(old);
  assert.equal(t.tracks.length, 4);
  assert.deepEqual(t.overlays, []);
  assert.deepEqual(t.pins, []);
});

// --- Legenda automática ----------------------------------------------------------------

const fala = [
  { w: 'Você', start: 1.0, end: 1.3 },
  { w: 'já', start: 1.3, end: 1.5 },
  { w: 'parou', start: 1.5, end: 1.9 },
  { w: 'hum...', start: 2.0, end: 2.6 },
  { w: 'para', start: 12.0, end: 12.2 },
  { w: 'pensar?', start: 12.2, end: 12.8 },
];

test('legenda segue os cortes, no tempo da timeline, sem hesitação', () => {
  let t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 3, out: 11.9, kind: 'retake', reason: '' }, 'agent');
  const cues = buildCues(t, { a: fala }, { ...DEFAULT_CAPTIONS, enabled: true });
  const text = cues.map((c) => c.words.map((w) => w.text).join(' '));
  assert.ok(!text.join(' ').includes('hum'), 'hesitação não vira legenda');
  assert.deepEqual(text, ['Você já', 'parou', 'para pensar?']);
  const last = cues[cues.length - 1]!;
  close(last.words[0]!.start, 12.0 - 8.9); // 12.0 na fonte − 8.9 s cortados antes
  t = applyOp(t, { type: 'cut_source', assetId: 'a', in: 1.2, out: 2.0, kind: 'manual', reason: '' }, 'human');
  assert.ok(!buildCues(t, { a: fala }, DEFAULT_CAPTIONS).some((c) => c.words.some((w) => w.text === 'parou')), 'palavra cortada some da legenda');
});

test('trilha presa à timeline cobre o vídeo inteiro mesmo depois de cortes', () => {
  let t = applyOp(base(), { type: 'add_overlay', item: { trackId: 'A3', role: 'music', anchor: { assetId: '@timeline', at: 0 }, duration: 1, toEnd: true, source: { type: 'media', assetId: 'm', in: 0 } } }, 'human');
  assert.deepEqual(resolveOverlay(t, t.overlays[0]!), { start: 0, end: 100 });
  t = applyOp(t, { type: 'cut_source', assetId: 'a', in: 0, out: 30, kind: 'retake', reason: '' }, 'agent');
  assert.deepEqual(resolveOverlay(t, t.overlays[0]!), { start: 0, end: 70 }, 'não fica órfã e acompanha a nova duração');
});

// --- Cor -----------------------------------------------------------------------------------

test('S-Log3 → Rec.709: preto do LOG vira preto, cinza 18% cai perto de 42%, cinza fica neutro', () => {
  const g = { ...NEUTRAL_GRADE, input: 'slog3' as const };
  // Valores de código de 10 bits do S-Log3 → RGB 0..1 com a faixa legal expandida (como o FFmpeg entrega).
  const rgb = (code: number) => (code - 64) / 876;
  const black = gradePixel([rgb(95), rgb(95), rgb(95)], g);
  const gray = gradePixel([rgb(420), rgb(420), rgb(420)], g);
  // LC-709 Type A (BL-0159) guarda o pé baixo-contraste da oficial: preto do S-Log3 (95) ≈ 0,040, igual à LUT da Sony.
  assert.ok(black[0] < 0.05, `preto: ${black[0]}`);
  assert.ok(gray[0] > 0.36 && gray[0] < 0.48, `cinza 18%: ${gray[0]}`);
  assert.ok(Math.abs(gray[0] - gray[2]) < 0.01, 'cinza não ganha cor');
});

test('Rec.709 neutro não altera a imagem', () => {
  for (const v of [0.05, 0.3, 0.7, 0.95]) {
    const o = gradePixel([v, v * 0.9, v * 0.8], NEUTRAL_GRADE);
    assert.ok(Math.abs(o[0] - v) < 0.01 && Math.abs(o[2] - v * 0.8) < 0.01, `${v} → ${o}`);
  }
});

test('revisão: correção de grafia vale para a legenda e some com texto vazio', async () => {
  const { placeWords } = await import('./text.ts');
  let t = normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 10, by: 'agent' }] });
  const words = { a: [{ w: 'serotonina,', start: 1, end: 1.5 }, { w: 'eustosina.', start: 2, end: 2.6 }] };
  t = applyOp(t, { type: 'fix_words', fixes: [{ assetId: 'a', at: 2, text: 'ocitocina.' }] }, 'human');
  assert.deepEqual(placeWords(t, words).map((w) => w.text), ['serotonina,', 'ocitocina.']);
  t = applyOp(t, { type: 'fix_words', fixes: [{ assetId: 'a', at: 2, text: '' }] }, 'human');
  assert.deepEqual(placeWords(t, words).map((w) => w.text), ['serotonina,', 'eustosina.']);
});

test('legenda: editar texto, dividir, juntar e apagar ficam presos à fala e sobrevivem a cortes', () => {
  const words = { a: ['Você', 'já', 'parou', 'pra', 'pensar?', 'Isso', 'muda', 'tudo.'].map((w, i) => ({ w, start: 1 + i * 0.5, end: 1.4 + i * 0.5 })) };
  let t = normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 10, by: 'agent' }] });
  const s = { ...DEFAULT_CAPTIONS, enabled: true, style: 'frase' as const };
  const texts = () => buildCues(t, words, s).map((c) => c.words.map((w) => w.text).join(' '));
  assert.deepEqual(texts(), ['Você já parou pra pensar?', 'Isso muda tudo.']);
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 2.5, patch: { split: true } }] }, 'human'); // divide antes de "pra"
  assert.deepEqual(texts(), ['Você já parou', 'pra pensar?', 'Isso muda tudo.']);
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 3.5, patch: { join: true } }] }, 'human'); // "Isso" junta com a de cima
  assert.deepEqual(texts(), ['Você já parou', 'pra pensar? Isso muda tudo.']);
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 1, patch: { text: 'Você já parou mesmo' } }] }, 'human');
  assert.equal(texts()[0], 'Você já parou mesmo');
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 2.5, patch: { hidden: true } }] }, 'human');
  assert.deepEqual(texts(), ['Você já parou mesmo']);
  // Um corte antes não muda nada: os ajustes estão presos às palavras do bruto.
  t = applyOp(t, { type: 'cut_source', assetId: 'a', in: 0, out: 0.9, kind: 'silence', reason: 'pausa' }, 'agent');
  assert.deepEqual(texts(), ['Você já parou mesmo']);
  // Volta ao automático nos dois pontos; o "juntar" em "Isso" continua valendo.
  t = applyOp(t, { type: 'edit_captions', edits: [{ assetId: 'a', at: 2.5, patch: null }, { assetId: 'a', at: 1, patch: null }] }, 'human');
  assert.deepEqual(texts(), ['Você já parou pra pensar? Isso', 'muda tudo.']);
});

test('legenda: voltar ao texto automático funciona mesmo passando pelo JSON do WebSocket', () => {
  const words = { a: ['mais', 'honesta'].map((w, i) => ({ w, start: 1 + i * 0.5, end: 1.4 + i * 0.5 })) };
  let t = normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 5, by: 'agent' }] });
  const viaJson = (op: unknown) => JSON.parse(JSON.stringify(op));
  t = applyOp(t, viaJson({ type: 'edit_captions', edits: [{ assetId: 'a', at: 1, patch: { text: 'mais honesto' } }] }), 'human');
  assert.equal(buildCues(t, words, { ...DEFAULT_CAPTIONS, enabled: true })[0]!.words.map((w) => w.text).join(' '), 'mais honesto');
  t = applyOp(t, viaJson({ type: 'edit_captions', edits: [{ assetId: 'a', at: 1, patch: { text: null } }] }), 'human');
  assert.equal(buildCues(t, words, { ...DEFAULT_CAPTIONS, enabled: true })[0]!.words.map((w) => w.text).join(' '), 'mais honesta');
  assert.equal(t.captionEdits?.length, 0);
});

test('srt: exportar, editar o arquivo e importar de volta reproduz o arquivo, preso à fala', async () => {
  const { parseSrt, srtToEdits, toSrt } = await import('./srt.ts');
  const words = { a: ['Você', 'já', 'parou', 'pra', 'pensar?', 'Isso', 'muda', 'tudo.'].map((w, i) => ({ w, start: 1 + i * 0.5, end: 1.4 + i * 0.5 })) };
  let t = normalizeTimeline({ fps: 30, width: 1080, height: 1920, main: [{ id: 'c1', assetId: 'a', in: 0, out: 10, by: 'agent' }] });
  const s = { ...DEFAULT_CAPTIONS, enabled: true, style: 'reels' as const };
  const srt = toSrt(buildCues(t, words, s));
  assert.match(srt, /^1\n00:00:01,000 --> /);
  // O cliente devolve o .srt com 2 blocos: um texto reescrito cobrindo 5 palavras, e o fim.
  const edited = `1\n00:00:00,900 --> 00:00:03,450\nVocê já parou para pensar?\n\n2\n00:00:03,450 --> 00:00:05,000\n<i>Isso muda tudo.</i>\n`;
  const blocks = parseSrt(edited);
  assert.equal(blocks.length, 2);
  const { edits, matched, skipped } = srtToEdits(t, words, blocks);
  assert.deepEqual([matched, skipped], [2, 0]);
  t = applyOp(t, { type: 'edit_captions', edits }, 'human');
  assert.deepEqual(
    buildCues(t, words, s).map((c) => c.words.map((w) => w.text).join(' ')),
    ['Você já parou para pensar?', 'Isso muda tudo.'],
  );
});

test('limpeza da voz: liga com a intensidade, limita a 0–1 e 0 desliga (sai do JSON)', () => {
  const on = applyOp(base(), { type: 'set_voice_denoise', amount: 0.8 }, 'human');
  assert.equal(on.voiceDenoise, 0.8);
  assert.equal(applyOp(on, { type: 'set_voice_denoise', amount: 3 }, 'human').voiceDenoise, 1);
  const off = applyOp(on, { type: 'set_voice_denoise', amount: 0 }, 'human');
  assert.equal('voiceDenoise' in off, false);
});

test('estado da trilha: ocultar/mudo valem para o overlay certo; false limpa e some do JSON', () => {
  let t = applyOp(base(), { type: 'add_overlay', item: { trackId: 'V2', role: 'broll', anchor: { assetId: 'a', at: 5 }, duration: 2, source: { type: 'media', assetId: 'b', in: 0 } } }, 'human');
  t = applyOp(t, { type: 'add_overlay', item: { trackId: 'A3', role: 'music', anchor: { assetId: 'a', at: 0 }, duration: 10, source: { type: 'media', assetId: 'm', in: 0 } } }, 'human');
  const [broll, music] = t.overlays;
  t = applyOp(t, { type: 'set_track_state', trackId: 'V2', patch: { hidden: true } }, 'human');
  t = applyOp(t, { type: 'set_track_state', trackId: 'A3', patch: { muted: true, locked: true } }, 'human');
  assert.equal(overlayActive(t, broll!), false);
  assert.equal(overlayActive(t, music!), false);
  assert.equal(trackFlag(t, 'A3', 'locked'), true);
  t = applyOp(t, { type: 'set_track_state', trackId: 'V2', patch: { hidden: false } }, 'human');
  assert.equal(overlayActive(t, broll!), true);
  assert.equal('V2' in (t.trackState ?? {}), false);
  t = applyOp(t, { type: 'set_track_state', trackId: 'A3', patch: { muted: false, locked: false } }, 'human');
  assert.equal('trackState' in t, false);
});

test('solo (BL-0160): trilha de som em solo emudece as outras de som no mudo efetivo; vídeo não muda', () => {
  let t = applyOp(base(), { type: 'add_overlay', item: { trackId: 'A3', role: 'music', anchor: { assetId: 'a', at: 0 }, duration: 10, source: { type: 'media', assetId: 'm', in: 0 } } }, 'human');
  t = applyOp(t, { type: 'add_overlay', item: { trackId: 'A2', role: 'sfx', anchor: { assetId: 'a', at: 1 }, duration: 1, source: { type: 'media', assetId: 's', in: 0 } } }, 'human');
  t = applyOp(t, { type: 'add_overlay', item: { trackId: 'V2', role: 'broll', anchor: { assetId: 'a', at: 5 }, duration: 2, source: { type: 'media', assetId: 'b', in: 0 } } }, 'human');
  const [music, sfx, broll] = t.overlays;
  t = applyOp(t, { type: 'set_track_state', trackId: 'A3', patch: { solo: true } }, 'human');
  assert.equal(overlayActive(t, music!), true);
  assert.equal(overlayActive(t, sfx!), false);
  assert.equal(trackFlag(t, 'A1', 'muted'), true, 'a fala (A1) sai no solo da trilha');
  assert.equal(trackFlag(t, 'A3', 'muted'), false);
  assert.equal(trackFlag(t, 'V2', 'muted'), false);
  assert.equal(overlayActive(t, broll!), true);
  // O mudo guardado não muda: tirar o solo devolve tudo como estava.
  assert.equal(t.trackState?.A1?.muted, undefined);
  t = applyOp(t, { type: 'set_track_state', trackId: 'A1', patch: { solo: true } }, 'human');
  assert.equal(trackFlag(t, 'A1', 'muted'), false, 'duas trilhas em solo tocam as duas');
  t = applyOp(t, { type: 'set_track_state', trackId: 'A1', patch: { solo: false } }, 'human');
  t = applyOp(t, { type: 'set_track_state', trackId: 'A3', patch: { solo: false } }, 'human');
  assert.equal('trackState' in t, false);
  assert.equal(overlayActive(t, sfx!), true);
});

test('altura da trilha (BL-0160): guardada em px inteiros, presa aos limites; 0 volta ao padrão', () => {
  let t = applyOp(base(), { type: 'set_track_state', trackId: 'V1', patch: { height: 91.6 } }, 'human');
  assert.equal(t.trackState?.V1?.height, 92);
  t = applyOp(t, { type: 'set_track_state', trackId: 'V1', patch: { height: 5000 } }, 'human');
  assert.equal(t.trackState?.V1?.height, TRACK_HEIGHT_MAX);
  t = applyOp(t, { type: 'set_track_state', trackId: 'V1', patch: { height: 3 } }, 'human');
  assert.equal(t.trackState?.V1?.height, TRACK_HEIGHT_MIN);
  t = applyOp(t, { type: 'set_track_state', trackId: 'V1', patch: { locked: true } }, 'human');
  assert.deepEqual(t.trackState?.V1, { height: TRACK_HEIGHT_MIN, locked: true }, 'outro campo não apaga a altura');
  t = applyOp(t, { type: 'set_track_state', trackId: 'V1', patch: { height: Number.NaN } }, 'human');
  assert.deepEqual(t.trackState?.V1, { locked: true });
  t = applyOp(t, { type: 'set_track_state', trackId: 'V1', patch: { height: 0, locked: false } }, 'human');
  assert.equal('trackState' in t, false);
});

test('velocidade e freeze: duração, locate e sourceToTimeline acompanham; legendas também', () => {
  let t = base();
  t = applyOp(t, { type: 'set_speed', clipId: 'c1', speed: 2 }, 'human');
  assert.equal(timelineDuration(t), 50);
  assert.equal(sourceToTimeline(t, 'a', 40), 20);
  assert.equal(locate(t, 20)!.sourceTime, 40);
  t = applyOp(t, { type: 'set_speed', clipId: 'c1', freeze: 1.5 }, 'human');
  assert.equal(timelineDuration(t), 51.5);
  // Durante o congelamento a fonte para no último quadro.
  assert.equal(locate(t, 51)!.sourceTime, 100);
  // Velocidade 1 e freeze 0 somem do JSON.
  t = applyOp(t, { type: 'set_speed', clipId: 'c1', speed: 1, freeze: 0 }, 'human');
  assert.equal('speed' in t.main[0]!, false);
  assert.equal('freeze' in t.main[0]!, false);
  // Legenda acompanha a velocidade.
  const fast = applyOp(base(), { type: 'set_speed', clipId: 'c1', speed: 2 }, 'human');
  const cues = buildCues(fast, { a: [{ w: 'Oi', start: 10, end: 10.5 }, { w: 'tudo', start: 10.6, end: 11 }] }, { ...DEFAULT_CAPTIONS, enabled: true });
  assert.ok(cues.length >= 1);
  close(cues[0]!.start, 5);
});

test('zoom animado, flash, câmera e enquadramento', () => {
  let t = applyOp(base(), { type: 'set_zoom', clipId: 'c1', zoom: 1.05, zoomTo: 1.25 }, 'human');
  assert.equal(zoomAt(t.main[0]!, 0), 1.05);
  close(zoomAt(t.main[0]!, 1000), 1.25);
  assert.ok(zoomAt(t.main[0]!, 10) > 1.05 && zoomAt(t.main[0]!, 10) < 1.25);
  t = applyOp(t, { type: 'set_zoom', clipId: 'c1', zoom: 1.05, zoomTo: null }, 'human');
  assert.equal('zoomTo' in t.main[0]!, false);
  t = applyOp(t, { type: 'set_flash', clipId: 'c1', on: true }, 'human');
  assert.equal(t.main[0]!.flash, true);
  assert.equal(flashShutterCues(t).length, 1);
  // CH-0010: flash só visual (sem obturador sintetizado), para a amostra do editor no A2.
  t = applyOp(t, { type: 'set_flash', clipId: 'c1', on: true, sfx: false }, 'human');
  assert.equal(t.main[0]!.flash, true);
  assert.equal(t.main[0]!.flashSfx, false);
  assert.equal(flashShutterCues(t).length, 0);
  t = applyOp(t, { type: 'set_flash', clipId: 'c1', on: true }, 'human');
  assert.equal(t.main[0]!.flashSfx, false, 'sem sfx no pedido mantém o que estava');
  t = applyOp(t, { type: 'set_flash', clipId: 'c1', on: true, sfx: true }, 'human');
  assert.equal('flashSfx' in t.main[0]!, false);
  assert.equal(flashShutterCues(t)[0]!.cue.kind, 'shutter');
  t = applyOp(t, { type: 'set_flash', clipId: 'c1', on: true, sfx: false }, 'human');
  // Dividir: o flash fica só no pedaço de cima, o freeze só no de baixo.
  t = applyOp({ ...t, main: [{ ...t.main[0]!, freeze: 1 }] }, { type: 'split', time: 30 }, 'human');
  assert.equal(t.main[0]!.flash, true);
  assert.equal(t.main[1]!.flash, undefined);
  assert.equal(t.main[1]!.flashSfx, undefined);
  assert.equal(t.main[0]!.freeze, undefined);
  assert.equal(t.main[1]!.freeze, 1);
  t = applyOp(t, { type: 'set_cam', clipId: t.main[1]!.id, assetId: 'cam2' }, 'human');
  assert.equal(t.main[1]!.cam, 'cam2');
  t = applyOp(t, { type: 'set_reframe', on: true }, 'human');
  t = applyOp(t, { type: 'set_framing', clipId: t.main[1]!.id, x: 1.4 }, 'human');
  assert.equal(t.reframe, true);
  assert.equal(t.main[1]!.framing!.x, 1);
  assert.throws(() => applyOp(t, { type: 'set_speed', clipId: t.main[1]!.id, speed: 9 }, 'human'), OpError);
});

test('snapCut: resto curto entre o corte por frase e uma remoção vizinha entra no corte (FB-0022)', () => {
  let t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 51.18, out: 51.34, kind: 'silence', reason: 'pausa' }, 'agent');
  const cut = snapCut(t, 'a', 51.45, 53.11);
  close(cut.in, 51.34);
  close(cut.out, 53.11);
  t = applyOp(t, { type: 'cut_source', assetId: 'a', ...cut, kind: 'manual', reason: 'pedido' }, 'agent');
  assert.deepEqual(t.main.map((c) => [c.in, c.out]), [[0, 51.18], [53.11, 100]]);
  assert.ok(t.main.every((c) => clipDuration(c) >= PISCA));
});

test('snapCut: estende também para a direita, e não mexe quando o resto é longo ou o vizinho não é remoção', () => {
  let t = applyOp(base(), { type: 'cut_source', assetId: 'a', in: 20.2, out: 21, kind: 'silence', reason: 'pausa' }, 'agent');
  assert.deepEqual(snapCut(t, 'a', 18, 20), { in: 18, out: 20.2 });
  assert.deepEqual(snapCut(t, 'a', 18, 19.5), { in: 18, out: 19.5 });
  // Corte de clipe (split) em 30 não é remoção: o resto 30–30,1 fica.
  t = applyOp(t, { type: 'split', time: 29.2 }, 'human');
  assert.deepEqual(snapCut(t, 'a', 30.1, 32), { in: 30.1, out: 32 });
  // Começo do material também não conta como vizinho.
  assert.deepEqual(snapCut(t, 'a', 0.1, 2), { in: 0.1, out: 2 });
  // Outro asset não é afetado.
  assert.deepEqual(snapCut(t, 'b', 21.1, 22), { in: 21.1, out: 22 });
});

test('set_framing com y: âncora vertical do zoom, x e y independentes (CH-0006)', () => {
  let t = applyOp(base(), { type: 'set_framing', clipId: 'c1', y: 0.36 }, 'human');
  assert.deepEqual(t.main[0]!.framing, { y: 0.36 });
  t = applyOp(t, { type: 'set_framing', clipId: 'c1', x: 0.4 }, 'agent');
  assert.deepEqual(t.main[0]!.framing, { x: 0.4, y: 0.36 });
  t = applyOp(t, { type: 'set_framing', clipId: 'c1', y: -2 }, 'human');
  assert.equal(t.main[0]!.framing!.y, 0);
  t = applyOp(t, { type: 'set_framing', clipId: 'c1', x: null }, 'human');
  assert.deepEqual(t.main[0]!.framing, { y: 0 });
  t = applyOp(t, { type: 'set_framing', clipId: 'c1', y: null }, 'human');
  assert.equal(t.main[0]!.framing, undefined);
  assert.throws(() => applyOp(t, { type: 'set_framing', clipId: 'c1', y: Number.NaN }, 'human'), OpError);
  // Clipes com âncoras diferentes não se juntam ao desfazer um corte.
  let u = applyOp(base(), { type: 'split', time: 50 }, 'human');
  u = applyOp(u, { type: 'set_framing', clipId: u.main[1]!.id, y: 0.36 }, 'human');
  assert.equal(u.main.length, 2);
});

test('frameCenter: o quadro decide pelo meio dele, no grid round(t·fps) do export (BL-0101)', async () => {
  const { frameCenter } = await import('./timeline.ts');
  // Camada em 2,74 s a 30 fps (82,2) entra no quadro 82; em 2,76 s (82,8) no 83.
  assert.ok(frameCenter(82 / 30, 30) >= 2.74);
  assert.ok(frameCenter(81 / 30, 30) < 2.74);
  assert.ok(frameCenter(82 / 30, 30) < 2.76 && frameCenter(83 / 30, 30) >= 2.76);
  // Qualquer instante dentro do quadro dá o mesmo meio; fps 0 cai em 30.
  assert.equal(frameCenter(2.7334, 30), frameCenter(2.7666, 30));
  assert.equal(frameCenter(1, 0), 1.5 / 30 + 29 / 30);
});
