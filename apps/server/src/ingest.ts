import fs from 'node:fs/promises';
import path from 'node:path';
import { type Timeline, uid, type MediaAsset } from '@neweditor/core';
import { transcribe, writeCenters } from './asr.ts';
import { analyze, speechChunks } from './decupagem/analyze.ts';
import { makeEnvelope, makeProxy, makeThumbs, makeWav16k, probe, readEnvelope } from './media.ts';
import { enqueue } from './jobs.ts';
import { profileOf } from './profiles.ts';
import { store } from './store.ts';

/**
 * Importa um arquivo para o projeto: registra o asset e prepara (proxy, miniaturas, áudio de análise,
 * envelope, transcrição). Cada etapa já aparece no Editor Brain (o avatar "assiste" o material).
 *
 * O primeiro material com áudio é a FALA (A-roll): é transcrito e vira a trilha principal.
 * O que entrar depois vai para a biblioteca como B-roll (sem transcrição — não precisa).
 */
export async function ingest(projectId: string, filePath: string, role?: MediaAsset['role']): Promise<MediaAsset> {
  await fs.access(filePath);
  const meta = await probe(filePath);
  const p0 = store.get(projectId);
  const hasFala = p0.assets.some((a) => a.role === 'fala' || a.transcript);
  // Segunda bruta: vídeo longo com áudio, chegando antes de qualquer decupagem, é fala também (não B-roll).
  const segundaBruta = hasFala && meta.kind === 'video' && meta.hasAudio && meta.duration >= 60 && isRaw(p0.timeline);
  const asset: MediaAsset = { id: uid('ast'), name: path.basename(filePath), path: filePath, ...meta, role: role ?? ((!hasFala && meta.hasAudio) || segundaBruta ? 'fala' : 'broll') };
  await fs.mkdir(path.join(store.dir(projectId), asset.id), { recursive: true });
  saveAsset(projectId, asset);
  store.log(projectId, 'agent', `Recebi ${asset.name} (${fmtDur(asset.duration)}${asset.width ? `, ${asset.width}×${asset.height}` : ''}) como ${asset.role === 'fala' ? (segundaBruta ? 'fala (2ª bruta — entra na decupagem junto)' : 'fala principal') : 'B-roll'}`);
  return prepare(projectId, asset);
}

/** Montagem ainda crua: nenhum corte, só os brutos inteiros postos pelo sistema. */
const isRaw = (tl: Timeline): boolean => !tl.removals.length && tl.main.every((c) => c.by === 'system');

/**
 * Troca o papel de um arquivo (fala ↔ B-roll). Virando fala, é transcrito e entra na montagem crua;
 * virando B-roll, sai da montagem crua (se ainda não houve decupagem).
 */
export async function setRole(projectId: string, assetId: string, role: 'fala' | 'broll'): Promise<MediaAsset> {
  const p = store.get(projectId);
  const a = p.assets.find((x) => x.id === assetId);
  if (!a) throw Object.assign(new Error('arquivo não existe'), { statusCode: 404 });
  if (a.role === role) return a;
  store.upsertAsset(projectId, { ...a, role, syncOffset: undefined });
  if (role === 'broll') {
    if (isRaw(p.timeline) && p.timeline.main.some((c) => c.assetId === assetId)) store.apply(projectId, { by: 'system', op: { type: 'set_main', clips: p.timeline.main.filter((c) => c.assetId !== assetId), removals: [] } });
    store.log(projectId, 'agent', `${a.name} agora é B-roll.`);
  } else {
    store.log(projectId, 'agent', `${a.name} agora é fala — ${a.transcript ? 'entra na decupagem.' : 'vou transcrever e entra na decupagem.'}`);
    const cur = store.get(projectId).assets.find((x) => x.id === assetId)!;
    await enqueue(projectId, 'transcrevendo', () => prepare(projectId, cur));
  }
  return store.get(projectId).assets.find((x) => x.id === assetId)!;
}

/** Grava o asset preparado sem apagar o que mudou enquanto isso (2ª câmera, limpeza de voz, papel). */
function saveAsset(projectId: string, asset: MediaAsset): void {
  const cur = store.get(projectId).assets.find((a) => a.id === asset.id);
  store.upsertAsset(projectId, cur ? { ...asset, role: cur.role ?? asset.role, syncOffset: cur.syncOffset ?? asset.syncOffset, clean: cur.clean ?? asset.clean } : asset);
}

/** O que ainda falta preparar neste asset (vazio = pronto). */
function missing(a: MediaAsset): string[] {
  const m: string[] = [];
  if (!a.proxy) m.push('proxy');
  if (a.kind === 'video' && !a.thumbs) m.push('miniaturas');
  if (a.hasAudio && !a.envelope) m.push('áudio');
  if (a.role === 'fala' && a.hasAudio && !a.transcript) m.push('transcrição');
  return m;
}

/**
 * Prepara um asset — IDEMPOTENTE: só faz as etapas que faltam. Por isso serve tanto para a importação
 * nova quanto para retomar uma que foi interrompida (servidor reiniciou no meio de um bruto de 13 min).
 */
export async function prepare(projectId: string, asset: MediaAsset): Promise<MediaAsset> {
  const dir = path.join(store.dir(projectId), asset.id);
  await fs.mkdir(dir, { recursive: true });
  const rel = (f: string) => `${asset.id}/${f}`;
  // Duas frentes em paralelo (o proxy usa a GPU; o ASR, a CPU/Neural Engine): o avatar mostra a mais lenta.
  const progress = { video: asset.proxy && (asset.thumbs || asset.kind !== 'video') ? 1 : 0, audio: !asset.hasAudio || (asset.envelope && (asset.transcript || asset.role !== 'fala')) ? 1 : 0 };
  const act = (message: string) => store.setActivity(projectId, { state: 'analyzing', message, progress: Math.min(progress.video, progress.audio) });

  const video = (async () => {
    if (!asset.proxy) {
      act('Preparando o vídeo');
      asset.proxy = rel(await makeProxy(asset, dir, (pr) => ((progress.video = pr * 0.9), act('Preparando o vídeo'))));
    }
    if (asset.kind === 'video' && !asset.thumbs) {
      const th = await makeThumbs(asset, dir);
      asset.thumbs = { ...th, file: rel(th.file) };
    }
    progress.video = 1;
    saveAsset(projectId, asset);
  })();

  const audio = (async () => {
    if (!asset.hasAudio) return;
    if (!asset.envelope) {
      const wav = await makeWav16k(asset, dir);
      asset.wav16k = rel(wav);
      asset.envelope = rel(await makeEnvelope(path.join(dir, wav), dir));
      saveAsset(projectId, asset);
    }
    progress.audio = 0.2;
    if (asset.role !== 'fala' || asset.transcript) return void (progress.audio = 1);
    act('Transcrevendo palavra por palavra');
    const t0 = Date.now();
    const trFile = path.join(dir, 'transcript.json');
    // Trecho a trecho (ver speechChunks): o texto de cada trecho é o que foi dito nele — retake aparece como retake.
    const env = await readEnvelope(path.join(dir, 'envelope.f32'));
    // Nomes e marcas do glossário do cliente (BL-0081) entram no prompt da transcrição.
    const glossario = (await profileOf(store.get(projectId)).catch(() => undefined))?.glossario;
    const tr = await transcribe(path.join(dir, 'audio16k.wav'), trFile, 'pt', speechChunks(env), glossario);
    await writeCenters(trFile, tr, analyze(tr.words, env).centers);
    asset.transcript = rel('transcript.json');
    progress.audio = 1;
    saveAsset(projectId, asset);
    store.log(projectId, 'agent', `Transcrevi ${tr.words.length} palavras em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  })();

  const t0 = Date.now();
  await Promise.all([video, audio]);
  store.log(projectId, 'agent', `${asset.name} pronto em ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Primeira montagem = a fala inteira, para o humano já poder assistir; a 2ª bruta entra em seguida.
  const p = store.get(projectId);
  const cur = p.assets.find((x) => x.id === asset.id) ?? asset;
  if (cur.role === 'fala' && !p.timeline.main.some((c) => c.assetId === asset.id) && (p.timeline.main.length === 0 || isRaw(p.timeline))) {
    // O primeiro vídeo define o formato, a não ser que o formato tenha sido escolhido (à mão ou pela tarefa).
    if (p.timeline.main.length === 0 && !p.timeline.formatoManual && asset.width && asset.height) store.setFormat(projectId, { width: asset.width, height: asset.height, fps: asset.fps ?? 30 });
    else if (p.timeline.main.length === 0 && p.timeline.formatoManual && asset.fps) store.setFormat(projectId, { fps: asset.fps });
    store.apply(projectId, {
      by: 'system',
      op: { type: 'set_main', clips: [...p.timeline.main, { id: uid('clip'), assetId: asset.id, in: 0, out: asset.duration, by: 'system', reason: 'material bruto' }], removals: [] },
    });
  }
  store.setActivity(projectId, { state: 'idle', message: 'Material pronto' });
  return asset;
}

/** Ao subir o servidor: completa papéis antigos e RETOMA toda importação que ficou pela metade. */
export function backfill(): void {
  for (const p of store.list()) {
    for (const a of p.assets) {
      if (!a.role) {
        a.role = a.transcript ? 'fala' : 'broll';
        store.upsertAsset(p.id, a);
      }
      const todo = missing(a);
      if (!todo.length) continue;
      store.log(p.id, 'system', `Retomando a preparação de ${a.name} (faltava: ${todo.join(', ')})`);
      void enqueue(p.id, 'retomando importação', () => prepare(p.id, a)).catch((e) => {
        console.error(`[retomar] ${a.name}:`, e);
        store.log(p.id, 'system', `Falha ao retomar ${a.name}: ${(e as Error).message}`);
      });
    }
  }
}

/** Reprocessa um asset do zero (proxy, miniaturas, áudio, transcrição) — para material que veio corrompido. */
export async function rebuild(projectId: string, assetId: string): Promise<MediaAsset> {
  const a = store.get(projectId).assets.find((x) => x.id === assetId);
  if (!a) throw Object.assign(new Error('asset não existe'), { statusCode: 404 });
  const keepTranscript = a.transcript;
  for (const k of ['proxy', 'thumbs', 'wav16k', 'envelope'] as const) delete a[k];
  if (!keepTranscript) delete a.transcript;
  store.upsertAsset(projectId, a);
  store.log(projectId, 'system', `Reprocessando ${a.name}`);
  return prepare(projectId, a);
}

export function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return m ? `${m}min${r ? ` ${r}s` : ''}` : `${r}s`;
}
