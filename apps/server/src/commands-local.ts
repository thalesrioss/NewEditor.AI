/**
 * Cérebro LOCAL dos pedidos em texto — sem API. Entende os pedidos mais comuns de revisão:
 *
 *   "corta de 0:10 até 0:15"            "tira o trecho onde ele fala 'ozempic'"
 *   "tira as pausas longas"             "dá um zoom de 1.1 aqui" / "tira o zoom"
 *   "restaura o último corte"           "restaura 'aquela volta'"
 *   "divide aqui"                       "apaga esse clipe"            "desfaz"
 *
 * "aqui" = onde está o cursor do editor. O que ele não entende, ele diz — e lista o que sabe fazer.
 */
import path from 'node:path';
import { clipStarts, formatTime, locate, snapCut, sourceToTimeline, type Project } from '@neweditor/core';
import type { Transcript } from './asr.ts';
import { act, finish, loadTranscripts, textOf } from './actions.ts';
import { analyze, normalizeToken } from './decupagem/analyze.ts';
import { sleep } from './jobs.ts';
import { readEnvelope } from './media.ts';
import { store } from './store.ts';

const HELP = `Ainda não entendi esse pedido (estou no modo local, sem IA). Sei fazer:
• "corta de 0:10 até 0:15"
• "tira o trecho onde ele fala 'tal coisa'"
• "tira as pausas longas"
• "dá um zoom de 1.1 aqui" / "tira o zoom"
• "restaura o último corte" / "restaura 'tal frase'"
• "divide aqui", "apaga esse clipe", "desfaz"`;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** O pedido é "desfaz" (roda fora da transação do pedido: dentro dela o store não desfaz). */
export const pedeDesfazer = (raw: string) => /\b(desfaz|desfazer|desfaca)\b/.test(norm(raw));

/** Tempos escritos como 1:02, 1:02.5, 62s, 62,5 segundos. */
function parseTimes(s: string): number[] {
  const out: number[] = [];
  const re = /(\d+):(\d{1,2}(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:s\b|seg\b|segundos?\b)/g;
  for (const m of s.matchAll(re)) {
    if (m[1] !== undefined) out.push(Number(m[1]) * 60 + Number(m[2]!.replace(',', '.')));
    else out.push(Number(m[3]!.replace(',', '.')));
  }
  return out;
}

const QUOTE_RE = /["“”'‘’]([^"“”'‘’]{2,})["“”'‘’]/;

/** Texto citado: entre aspas, ou depois de "fala/diz/falando". */
function quoted(raw: string): string | null {
  const q = QUOTE_RE.exec(raw);
  if (q) return q[1]!.trim();
  const f = /(?:fala|falando|diz|dizendo|disse|falou)\s+(?:d[oa]s?\s+|que\s+|sobre\s+)?(.{2,})$/i.exec(raw);
  return f ? f[1]!.replace(/[.!?]+$/, '').trim() : null;
}

/** Acha o texto na parte do bruto que ESTÁ na timeline. Devolve intervalo da fonte e `at`, o tempo da 1ª palavra na timeline. */
function findInTimeline(p: Project, transcripts: Map<string, Transcript>, text: string) {
  const q = text.split(/\s+/).map(normalizeToken).filter(Boolean);
  if (!q.length) return null;
  for (const [assetId, tr] of transcripts) {
    const toks = tr.words.map((w) => normalizeToken(w.w));
    for (let i = 0; i + q.length <= toks.length; i++) {
      let hit = 0;
      for (let k = 0; k < q.length; k++) if (toks[i + k] === q[k]) hit++;
      if (hit / q.length < 0.8) continue;
      const a = tr.words[i]!;
      const b = tr.words[i + q.length - 1]!;
      const at = sourceToTimeline(p.timeline, assetId, (a.start + a.end) / 2);
      if (at === null) continue;
      return { assetId, start: a.start, end: b.end, at };
    }
  }
  return null;
}

export async function runLocalCommand(projectId: string, raw: string, playhead = 0): Promise<string> {
  const p = store.get(projectId);
  const s = norm(raw);
  store.log(projectId, 'human', raw);
  store.setActivity(projectId, { state: 'thinking', message: 'Entendendo o pedido', at: playhead });
  await sleep(500);

  const here = locate(p.timeline, playhead);
  const verbCut = /\b(corta|cortar|corte|tira|tirar|remove|remover|apaga|apagar|deleta|exclui)\b/.test(s);

  // Desfazer.
  if (pedeDesfazer(raw)) {
    const ok = store.undo(projectId);
    return finish(projectId, ok ? 'Desfiz a última alteração.' : 'Não tem nada para desfazer.');
  }

  // Restaurar.
  if (/\b(restaura|restaurar|devolve|devolver|recupera|recuperar|traz de volta|volta com)\b/.test(s)) {
    const transcripts = await loadTranscripts(p);
    const q = quoted(raw);
    let target = [...p.timeline.removals].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
    if (q) {
      const qt = q.split(/\s+/).map(normalizeToken).filter(Boolean).join(' ');
      target = p.timeline.removals.find((r) => textOf(transcripts.get(r.assetId), r.in, r.out).split(/\s+/).map(normalizeToken).join(' ').includes(qt));
      if (!target) return finish(projectId, `Não achei nenhum trecho cortado com "${q}".`);
    }
    if (!target) return finish(projectId, 'Não tem nenhum trecho cortado para restaurar.');
    const said = textOf(transcripts.get(target.assetId), target.in, target.out);
    await act(projectId, { by: 'agent', op: { type: 'restore', removalId: target.id }, note: `Restaurei: ${target.reason}` }, 'cutting', playhead, 'Restaurando');
    return finish(projectId, `Restaurei o trecho "${said || target.reason}".`);
  }

  // Zoom. Com texto entre aspas, vai no clipe dessa fala; sem aspas, no clipe sob o cursor.
  if (/\bzoom\b/.test(s)) {
    const cited = QUOTE_RE.exec(raw)?.[1]?.trim();
    let target = here;
    if (cited) {
      const hit = findInTimeline(p, await loadTranscripts(p), cited);
      target = hit ? locate(p.timeline, hit.at) : null;
      if (!target) return finish(projectId, `Não achei "${cited}" na fala.`);
    }
    if (!target) return finish(projectId, 'A timeline está vazia.');
    // O número do zoom vem de fora das aspas ("zoom de 1.2 em 'tenho 30 anos'").
    const rest = cited ? norm(raw.replace(QUOTE_RE, ' ')) : s;
    const off = /\b(tira|tirar|remove|sem)\b/.test(rest);
    const num = /(\d+[.,]\d+)|(\d+)\s*%/.exec(rest);
    let zoom = 1.1;
    if (num?.[1]) zoom = Number(num[1].replace(',', '.'));
    else if (num?.[2]) zoom = 1 + Number(num[2]) / 100;
    if (off) zoom = 1;
    zoom = Math.max(1, Math.min(1.5, zoom));
    // Zoom pedido é fixo: `zoomTo: null` apaga o punch-in animado do ritmo (BL-0076).
    const n = target.index + 1;
    const r = await act(projectId, { by: 'agent', op: { type: 'set_zoom', clipId: target.clip.id, zoom, zoomTo: null }, note: off ? `Tirei o zoom do clipe ${n}` : `Zoom ${zoom}× no clipe ${n}` }, 'motion', target.clipStart, off ? 'Tirando o zoom' : `Zoom ${zoom}×`);
    const onde = cited ? `, onde fala "${cited}"` : '';
    return finish(projectId, r === 'ok' ? (off ? `Tirei o zoom do clipe ${n}${onde}.` : `Apliquei zoom ${zoom}× no clipe ${n} (${formatTime(target.clipStart)}${onde}).`) : r);
  }

  // Pausas.
  if (/\b(pausa|pausas|silencio|silencios|respiro|respiros|buraco|buracos)\b/.test(s)) {
    return finish(projectId, await tightenPauses(projectId, /\btodas?\b/.test(s) ? 0.25 : 0.4));
  }

  // Dividir.
  if (/\b(divide|dividir|separa|separar|quebra|quebrar)\b/.test(s)) {
    const r = await act(projectId, { by: 'agent', op: { type: 'split', time: playhead } }, 'cutting', playhead, 'Dividindo');
    return finish(projectId, r === 'ok' ? `Dividi o clipe em ${formatTime(playhead, true)}.` : r);
  }

  // Apagar o clipe atual.
  if (verbCut && /\b(clipe|clip|bloco|pedaco)\b/.test(s) && /\b(esse|este|esse ai|atual|aqui)\b/.test(s)) {
    if (!here) return finish(projectId, 'A timeline está vazia.');
    await act(projectId, { by: 'agent', op: { type: 'delete_clip', clipId: here.clip.id, reason: raw }, note: `Apaguei o clipe ${here.index + 1}` }, 'cutting', clipStarts(p.timeline)[here.index] ?? 0, 'Apagando o clipe');
    return finish(projectId, `Apaguei o clipe ${here.index + 1}.`);
  }

  if (verbCut) {
    // Intervalo de tempo explícito.
    const times = parseTimes(s);
    if (times.length >= 2) {
      const [a, b] = [Math.min(times[0]!, times[1]!), Math.max(times[0]!, times[1]!)];
      const r = await act(projectId, { by: 'agent', op: { type: 'cut_timeline', start: a, end: b, reason: raw }, note: `Cortei ${formatTime(a)}–${formatTime(b)}` }, 'cutting', a, `Cortando ${formatTime(a)}–${formatTime(b)}`);
      return finish(projectId, r === 'ok' ? `Cortei de ${formatTime(a, true)} até ${formatTime(b, true)}.` : r);
    }
    // Trecho de fala.
    const q = quoted(raw);
    if (q) {
      const transcripts = await loadTranscripts(p);
      const hit = findInTimeline(p, transcripts, q);
      if (!hit) return finish(projectId, `Não achei "${q}" no que está na timeline.`);
      const at = sourceToTimeline(p.timeline, hit.assetId, hit.start) ?? 0;
      const cut = snapCut(p.timeline, hit.assetId, Math.max(0, hit.start - 0.03), hit.end + 0.05);
      await act(projectId, { by: 'agent', op: { type: 'cut_source', assetId: hit.assetId, in: cut.in, out: cut.out, kind: 'manual', reason: `pedido: "${q}"` }, note: `Cortei "${q}"` }, 'cutting', at, `Cortando "${q}"`);
      return finish(projectId, `Cortei "${q}" (em ${formatTime(at, true)}). Se ficou seco, me pede pra restaurar.`);
    }
  }

  return finish(projectId, HELP);
}

/** Encurta pausas longas DENTRO do que está na timeline, deixando um respiro de 0,15 s. */
async function tightenPauses(projectId: string, minPause: number): Promise<string> {
  const p = store.get(projectId);
  const transcripts = await loadTranscripts(p);
  const ops: { assetId: string; in: number; out: number }[] = [];
  for (const a of p.assets) {
    const tr = transcripts.get(a.id);
    if (!tr || !a.envelope) continue;
    const env = await readEnvelope(path.join(store.dir(p.id), a.envelope));
    const an = analyze(tr.words, env);
    for (const ps of an.pauses) {
      if (ps.end - ps.start < minPause) continue;
      const a0 = ps.start + 0.075;
      const b0 = ps.end - 0.075;
      // Só se a pausa inteira está dentro de UM clipe da timeline (não mexe em emendas).
      const inside = p.timeline.main.some((c) => c.assetId === a.id && c.in < a0 && c.out > b0);
      if (inside) ops.push({ assetId: a.id, in: a0, out: b0 });
    }
  }
  if (!ops.length) return `Não encontrei pausas acima de ${minPause.toFixed(2)}s no que está na timeline.`;
  let saved = 0;
  for (const o of ops) {
    const at = sourceToTimeline(store.get(projectId).timeline, o.assetId, o.in) ?? 0;
    store.setActivity(projectId, { state: 'cutting', message: 'Encurtando pausa', at });
    await sleep(Math.max(60, Math.min(250, 6000 / ops.length)));
    store.apply(projectId, { by: 'agent', op: { type: 'cut_source', assetId: o.assetId, in: o.in, out: o.out, kind: 'silence', reason: 'pausa longa encurtada' } });
    saved += o.out - o.in;
  }
  return `Encurtei ${ops.length} pausas acima de ${minPause.toFixed(2)}s (−${saved.toFixed(1)}s).`;
}
