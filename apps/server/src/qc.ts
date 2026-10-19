/**
 * QC automático (ADR-007, I-3 e N-6): o papel 09 do Cérebro do Editor como checklist executável, lido do DNA
 * editorial e do perfil do cliente. Roda antes de "Editado" (sobre a timeline) e depois do render (sobre o MP4).
 *
 *  - legenda e lettering não inventam dado: todo número/nome que aparece tem que ter sido dito;
 *  - lettering no máximo N linhas (perfil); nada de lettering em cima de motion;
 *  - motion nunca entra seco (SFX ligado, duração mínima);
 *  - SFX com teto por 3 s;
 *  - B-roll e motion no máximo 2× (regra da casa); clipe "pisca"; duração da peça fora do alvo;
 *  - grafias e nomes que o humano não conferiu;
 *  - render: loudness −14 LUFS / −1 dBTP e quadros pretos.
 */
import path from 'node:path';
import { buildCues, clipDuration, clipStarts, editorialWarnings, fixedText, letteringCues, motionCues, resolveOverlay, timelineDuration, type ClientProfile, type Project, type QcIssue, type QcReport, type TextWord, cutEndAfter, ratioLabel, captionSafe } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { run } from './media.ts';
import { profileOf } from './profiles.ts';
import { reviewDoubts } from './review.ts';
import { store } from './store.ts';
import { monotonous } from './ritmo.ts';
import { facesOf, faceSummary } from './vision.ts';

const NUM = /\d+(?:[.,]\d+)?%?/g;
/** SFX que contam como "evento" no teto por 3 s (o tique de cada letra do tipógrafo não conta). */
const EVENT_SFX = new Set(['whoosh', 'swoosh', 'stamp', 'thud', 'impact', 'boom', 'ding', 'marker', 'paper', 'riser', 'shutter']);
const normNum = (s: string) => s.replace(/[.,]/g, '').replace('%', '');
const NUM_WORDS: Record<string, string> = { um: '1', uma: '1', dois: '2', duas: '2', tres: '3', três: '3', quatro: '4', cinco: '5', seis: '6', sete: '7', oito: '8', nove: '9', dez: '10', quinze: '15', vinte: '20', trinta: '30', quarenta: '40', cinquenta: '50', cem: '100', mil: '1000' };

/** Números ditos num trecho da fala (algarismos e por extenso). */
function spokenNumbers(words: TextWord[], tl: Project['timeline'], assetId: string): Set<string> {
  const out = new Set<string>();
  for (const w of words) {
    const t = fixedText(tl, assetId, w).toLowerCase();
    for (const m of t.match(NUM) ?? []) out.add(normNum(m));
    const bare = t.replace(/[^\p{L}]/gu, '');
    if (NUM_WORDS[bare]) out.add(NUM_WORDS[bare]!);
  }
  return out;
}

/** Linhas que um lettering ocupa, pela largura média de caractere em 9:16 (estimativa). */
function letteringLines(words: { text: string; destaque?: boolean }[]): number {
  const apoio = words.filter((w) => !w.destaque).map((w) => w.text).join(' ').length;
  const destaque = words.filter((w) => w.destaque).map((w) => w.text).join(' ').length;
  return (apoio ? Math.ceil(apoio / 34) : 0) + (destaque ? Math.ceil(destaque / 18) : 0);
}

export async function runQc(projectId: string): Promise<QcReport> {
  const p = store.get(projectId);
  const tl = p.timeline;
  const prof = await profileOf(p);
  const issues: QcIssue[] = [];
  const push = (i: Omit<QcIssue, 'id'>) => issues.push({ id: `qc_${issues.length + 1}`, ...i });
  // Formato (ADR-011, fase 1): a peça no formato do padrão, e sem tarja (material mais largo que o quadro sem reframe).
  if (Math.abs(tl.width / tl.height - prof.formato.width / prof.formato.height) > 0.02) push({ severidade: 'avisa', regra: 'formato', texto: `Peça em ${tl.width}×${tl.height} (${ratioLabel(tl.width, tl.height)}); o padrão "${prof.nome}" é ${prof.formato.width}×${prof.formato.height}. Mude em Ajustes → Projeto → Formato, ou grave um padrão editorial para este formato.` });
  const arTl = tl.width / tl.height;
  // Legenda dentro da área segura (ADR-011, fase 2: posição livre no player).
  if (tl.captions?.enabled) {
    const safe = captionSafe(tl.captions);
    if (!safe.ok) push({ severidade: 'avisa', regra: 'legenda-fora-do-quadro', texto: `Legenda ${safe.motivo}. Arraste no player ou ajuste em Legenda → Posição.` });
  }
  const tarja = p.assets.filter((a) => a.kind === 'video' && !!a.width && !!a.height && a.width / a.height > arTl + 0.05 && tl.main.some((c) => c.assetId === a.id));
  if (tarja.length && !tl.reframe) push({ severidade: 'avisa', regra: 'tarja', texto: `${tarja.map((a) => a.name).join(', ')}: mais largo que o quadro ${tl.width}×${tl.height} e sem reframe — sai com tarja. Ajustes → Projeto → "Reenquadrar no rosto".` });
  // Regra do Thales (2026-10-11): motion e B-roll vão até o fim do corte — parar no meio do clipe fica mal acabado.
  for (const o of tl.overlays) {
    if (o.role !== 'motion' && o.role !== 'broll') continue;
    const pos = resolveOverlay(tl, o);
    if (!pos) continue;
    const cutEnd = cutEndAfter(tl, pos.end - 0.05);
    const gap = cutEnd - pos.end;
    if (gap > 2.5 / (tl.fps || 30)) push({ severidade: 'bloqueia', regra: 'fim-no-corte', texto: `${o.role === 'motion' ? 'Motion' : 'B-roll'} em ${fmt(pos.start)} para ${gap.toFixed(2)} s antes do corte — tem que ir até o fim do corte`, at: pos.start, overlayId: o.id });
  }
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  const starts = clipStarts(tl);
  const total = timelineDuration(tl);

  // --- Repetição, órfãos, B-roll curto (regras da casa já codificadas) -------------------------
  for (const w of editorialWarnings(tl, (id) => assets.get(id)?.name ?? id)) {
    push({ severidade: w.level === 'erro' ? 'bloqueia' : 'avisa', regra: 'repeticao', texto: w.message, overlayId: w.overlayIds[0], at: w.overlayIds[0] ? resolveOverlay(tl, tl.overlays.find((o) => o.id === w.overlayIds[0])!)?.start : undefined });
  }
  // --- Clipe que pisca ----------------------------------------------------------------------------
  tl.main.forEach((c, i) => {
    const d = clipDuration(c);
    if (d < 0.35) push({ severidade: 'avisa', regra: 'pisca', texto: `Clipe de ${d.toFixed(2)} s em ${fmt(starts[i]!)} — curto demais, vira "pisca"`, at: starts[i] });
  });
  // --- Duração da peça ------------------------------------------------------------------------------
  if (total && (total < prof.peca.duracaoMin * 0.8 || total > prof.peca.duracaoMax * 1.25)) {
    push({ severidade: 'avisa', regra: 'duracao', texto: `Peça com ${fmt(total)}; o perfil "${prof.nome}" espera ${prof.peca.duracaoMin}–${prof.peca.duracaoMax} s` });
  }

  // --- Overlays: motion seco, lettering linhas, sobreposição, SFX por 3 s -----------------------------
  const placed = tl.overlays.flatMap((o) => {
    const pos = resolveOverlay(tl, o);
    return pos ? [{ o, ...pos }] : [];
  });
  const cues: number[] = [];
  for (const { o, start, end } of placed) {
    if (o.source.type === 'motion') {
      const m = o.source.motion;
      if (prof.motion.nuncaSeco && m.sfx === false) push({ severidade: 'avisa', regra: 'motion-seco', texto: `Motion "${m.texts[0] ?? ''}" sem SFX — "nada entra seco"`, at: start, overlayId: o.id });
      if (end - start < 1.2) push({ severidade: 'avisa', regra: 'motion-curto', texto: `Motion de ${(end - start).toFixed(1)} s em ${fmt(start)} — curto demais para entrar e sair`, at: start, overlayId: o.id });
      cues.push(...motionCues(m, end - start).filter((c) => EVENT_SFX.has(c.kind)).map((c) => start + c.t));
    }
    if (o.source.type === 'lettering') {
      const l = o.source.lettering;
      const lines = letteringLines(l.words);
      if (lines > prof.lettering.maxLinhas) push({ severidade: 'avisa', regra: 'lettering-linhas', texto: `Lettering "${l.words.map((w) => w.text).join(' ').slice(0, 40)}" deve passar de ${prof.lettering.maxLinhas} linhas (≈${lines})`, at: start, overlayId: o.id });
      if (l.sfx !== false) cues.push(...letteringCues(l, end - start).filter((c) => EVENT_SFX.has(c.kind)).map((c) => start + c.t));
      // Lettering em cima de motion.
      const over = placed.find((x) => x.o.id !== o.id && x.o.source.type === 'motion' && x.start < end && x.end > start);
      if (over) push({ severidade: 'avisa', regra: 'lettering-sobre-motion', texto: `Lettering em ${fmt(start)} em cima de um motion — um dos dois some`, at: start, overlayId: o.id });
    }
  }
  cues.sort((a, b) => a - b);
  for (let i = 0; i < cues.length; i++) {
    const n = cues.filter((t) => t >= cues[i]! && t < cues[i]! + 3).length;
    if (n > prof.lettering.sfxTetoPor3s + 1) {
      push({ severidade: 'avisa', regra: 'sfx-teto', texto: `${n} SFX em 3 s a partir de ${fmt(cues[i]!)} — o teto do perfil é ${prof.lettering.sfxTetoPor3s}`, at: cues[i] });
      i += n - 1;
    }
  }

  // --- Legenda e lettering não inventam dado (N-6) ------------------------------------------------------
  const transcripts: Record<string, TextWord[]> = {};
  for (const a of p.assets) if (a.transcript) transcripts[a.id] = (await readTranscript(path.join(store.dir(p.id), a.transcript))).words;
  if (prof.legenda.conferirNumeros) {
    const caps = tl.captions?.enabled ? buildCues(tl, transcripts, tl.captions) : [];
    for (const c of caps) {
      if (!c.edited || !c.key) continue;
      const w0 = c.words[0]?.src;
      if (!w0) continue;
      const said = spokenNumbers(transcripts[w0.assetId]?.filter((w) => w.start >= w0.at - 1 && w.start <= w0.at + 8) ?? [], tl, w0.assetId);
      const typed = (c.words.map((w) => w.text).join(' ').match(NUM) ?? []).map(normNum);
      const invented = typed.filter((n) => !said.has(n));
      if (invented.length) push({ severidade: 'bloqueia', regra: 'legenda-inventa-dado', texto: `Legenda em ${fmt(c.start)} tem "${invented.join(', ')}" que não foi dito`, at: c.start });
    }
    for (const { o, start, end } of placed) {
      const text = o.source.type === 'lettering' ? o.source.lettering.words.map((w) => w.text).join(' ') : o.source.type === 'motion' ? o.source.motion.texts.join(' ') : o.source.type === 'text' ? o.source.text : '';
      const nums = (text.match(NUM) ?? []).map(normNum);
      if (!nums.length) continue;
      const said = new Set<string>();
      for (const [assetId, words] of Object.entries(transcripts)) {
        const inRange = words.filter((w) => {
          const t = tl.main.findIndex((c) => c.assetId === assetId && w.start >= c.in && w.start < c.out);
          if (t < 0) return false;
          const at = starts[t]! + (w.start - tl.main[t]!.in);
          return at >= start - 4 && at <= end + 2;
        });
        for (const n of spokenNumbers(inRange, tl, assetId)) said.add(n);
      }
      const invented = nums.filter((n) => !said.has(n));
      if (invented.length) push({ severidade: 'bloqueia', regra: 'lettering-inventa-dado', texto: `"${text.slice(0, 40)}" em ${fmt(start)} tem "${invented.join(', ')}" que não foi dito perto dali`, at: start, overlayId: o.id });
    }
  }

  // --- Texto em cima do rosto (Vision local) e trechos parados ------------------------------------------------
  const fala = p.assets.find((a) => a.role === 'fala' && a.kind === 'video');
  const faces = fala ? await facesOf(p, fala) : null;
  const face = faces ? faceSummary(faces) : null;
  if (face && face.coverage > 0.3) {
    const y = tl.captions?.enabled ? tl.captions.position : null;
    const topo = face.box.y - 0.02;
    const queixo = face.box.y + face.box.h + 0.02;
    if (y !== null && y > topo && y < queixo) push({ severidade: 'bloqueia', regra: 'texto-sobre-rosto', texto: `Legenda/lettering em ${Math.round(y * 100)}% do quadro cai em cima do rosto (${Math.round(topo * 100)}–${Math.round(queixo * 100)}%)` });
  }
  for (const m of monotonous(p, 8)) push({ severidade: 'avisa', regra: 'monotono', texto: `${(m.end - m.start).toFixed(0)} s sem nada mudar na tela a partir de ${fmt(m.start)} — quebra de padrão (zoom, lettering, B-roll)`, at: m.start });

  // --- Grafias e nomes que ninguém conferiu -----------------------------------------------------------------
  const doubts = await reviewDoubts(p).catch(() => []);
  const spelling = doubts.filter((d) => d.kind === 'nome' || d.kind === 'palavra');
  if (spelling.length) push({ severidade: 'avisa', regra: 'grafia', texto: `${spelling.length} grafia(s)/nome(s) sem conferir (legenda e lettering usam esse texto): ${spelling.slice(0, 4).map((d) => `"${d.text}"`).join(', ')}${spelling.length > 4 ? '…' : ''}`, at: spelling[0]!.at ?? undefined });

  const report: QcReport = { at: new Date().toISOString(), fase: 'edicao', issues };
  store.update(projectId, { qc: report });
  return report;
}

/**
 * Loudness integrado e pico real do relatório do `ebur128`, lidos só do bloco `Summary:` do fim. As linhas
 * por quadro também têm `I: … LUFS` (o integrado parcial, −70 no começo em silêncio): ler a primeira delas
 * acusava loudness errado em todo render que começa sem som (FB-0015).
 */
export function parseEbur128Summary(text: string): { lufs?: number; truePeak?: number } {
  const at = text.lastIndexOf('Summary:');
  if (at < 0) return {};
  const summary = text.slice(at);
  const lufs = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const tp = Number(/True peak:\s*Peak:\s*(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  return { lufs: Number.isFinite(lufs) ? lufs : undefined, truePeak: Number.isFinite(tp) ? tp : undefined };
}

/**
 * QC do MP4 exportado: loudness integrado, pico real, quadros pretos e duração do arquivo contra a da timeline
 * (mais de 2 quadros de diferença bloqueia). `expectedDuration` troca a duração esperada (teste).
 */
export async function runRenderQc(projectId: string, file: string, opts: { expectedDuration?: number } = {}): Promise<QcReport> {
  const p = store.get(projectId);
  // O FFmpeg escreve o relatório no stderr; `run` só devolve o stdout, então junta o stderr.
  let text = '';
  try {
    await run('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'blackdetect=d=0.2:pic_th=0.98', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { onStderr: (s) => (text += s) });
  } catch (e) {
    text += (e as Error).message;
  }
  const { lufs, truePeak: tp } = parseEbur128Summary(text);
  const black = (text.match(/black_start:/g) ?? []).length;
  const duration = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).catch(() => Buffer.from(''))).toString().trim()) || undefined;
  const expected = opts.expectedDuration ?? timelineDuration(p.timeline);
  const frame = 1 / (p.timeline.fps || 30);
  const issues: QcIssue[] = [];
  const push = (i: Omit<QcIssue, 'id'>) => issues.push({ id: `qcr_${issues.length + 1}`, ...i });
  if (lufs !== undefined && Math.abs(lufs + 14) > 1.5) push({ severidade: 'bloqueia', regra: 'loudness', texto: `Loudness ${lufs.toFixed(1)} LUFS (alvo −14 ±1,5)` });
  if (tp !== undefined && tp > -0.8) push({ severidade: 'bloqueia', regra: 'pico', texto: `Pico real ${tp.toFixed(1)} dBTP (alvo ≤ −1)` });
  if (black) push({ severidade: 'avisa', regra: 'quadro-preto', texto: `${black} trecho(s) de quadro preto no vídeo` });
  if (duration !== undefined && Math.abs(duration - expected) > 2 * frame + 1e-6) push({ severidade: 'bloqueia', regra: 'duracao-render', texto: `Arquivo com ${duration.toFixed(2)} s; a timeline tem ${expected.toFixed(2)} s (${Math.round(Math.abs(duration - expected) / frame)} quadros de diferença, tolerância 2)` });
  const report: QcReport = { at: new Date().toISOString(), fase: 'render', issues: [...(p.qc?.fase === 'edicao' ? p.qc.issues : []), ...issues], render: { lufs, truePeak: tp, blackFrames: black, duration, file } };
  store.update(projectId, { qc: report });
  return report;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
