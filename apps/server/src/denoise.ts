import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MediaAsset, Project } from '@neweditor/core';
import { ROOT } from './config.ts';
import { atomic, run } from './media.ts';
import { store } from './store.ts';

/**
 * Limpeza de ruído da voz (RNNoise, filtro arnndn do FFmpeg).
 *
 * Roda no ARQUIVO INTEIRO, uma vez por intensidade: a rede é recorrente (o estado depende do que veio antes),
 * então limpar trecho a trecho daria um resultado diferente em cada corte. Da mesma passada saem o master sem
 * perdas (export) e o proxy com o áudio limpo (preview) — os dois motores de preview só trocam a URL.
 */

/** Modelo "somnolent-hogwash" (GregorR/rnnoise-models): nos testes, o que mais limpou sem mexer na voz. */
const MODEL = path.join(ROOT, 'services', 'denoise', 'sh.rnnn');
/** O arnndn devolve tudo (inclusive a parte original da mistura) 480 amostras atrasado: 10 ms a 48 kHz. */
const LATENCY = 480;

export function denoiseFilter(mix: number): string {
  return `aformat=sample_rates=48000,apad=pad_len=${LATENCY},arnndn=m='${MODEL}':mix=${mix},atrim=start_sample=${LATENCY},asetpts=PTS-STARTPTS`;
}

/** Cadeia de voz do sound designer (papel 08): passa-alta, compressão leve, de-esser e limiter — transparente. */
export const VOICE_CHAIN = 'highpass=f=80,equalizer=f=250:t=q:w=1.2:g=-1.5,equalizer=f=3200:t=q:w=1.4:g=1.5,acompressor=threshold=-20dB:ratio=2.2:attack=6:release=140:makeup=2.5dB:knee=4,deesser=i=0.25:m=0.5:f=0.5,alimiter=limit=-1dB:level=false';

/** Filtro completo da voz: limpeza (se mix > 0) + cadeia (se ligada). */
export function voiceFilter(mix: number, chain: boolean): string {
  const parts = [mix > 0 ? denoiseFilter(mix) : 'aformat=sample_rates=48000', chain ? VOICE_CHAIN : ''].filter(Boolean);
  return parts.join(',');
}

/** Arquivos da trilha principal que têm voz. */
export function voiceAssets(p: Project): MediaAsset[] {
  const ids = new Set(p.timeline.main.map((c) => c.assetId));
  return p.assets.filter((a) => ids.has(a.id) && a.hasAudio);
}

const inflight = new Map<string, Promise<void>>();
/** Último job de cada arquivo: os jobs do MESMO arquivo rodam um de cada vez (CH-0026). */
const fila = new Map<string, Promise<void>>();

/**
 * Gera a voz limpa do asset na intensidade `mix` (uma vez; chamadas repetidas esperam a mesma).
 * Jobs de intensidades diferentes do mesmo arquivo entram em fila: a limpeza do fim de um job apaga os clean-* que
 * não são dele, e em paralelo apagava o master que o job seguinte acabara de gravar (CH-0026).
 */
export function cleanVoice(projectId: string, assetId: string, mix: number, chain = false): Promise<void> {
  const key = `${projectId}/${assetId}/${mix}/${chain ? 'c' : ''}`;
  let job = inflight.get(key);
  if (!job) {
    const fk = `${projectId}/${assetId}`;
    const antes = fila.get(fk) ?? Promise.resolve();
    job = antes.catch(() => undefined).then(() => make(projectId, assetId, mix, chain)).finally(() => {
      inflight.delete(key);
      if (fila.get(fk) === job) fila.delete(fk);
    });
    inflight.set(key, job);
    fila.set(fk, job);
  }
  return job;
}

/** A voz limpa registrada no asset bate com (mix, chain) E o master está no disco. */
function cleanOk(projectId: string, a: MediaAsset, mix: number, chain: boolean): boolean {
  return !!a.clean && a.clean.mix === mix && !!a.clean.chain === chain && existsSync(path.join(store.dir(projectId), a.clean.master));
}

async function make(projectId: string, assetId: string, mix: number, chain: boolean): Promise<void> {
  const find = () => store.get(projectId).assets.find((a) => a.id === assetId);
  const asset = find();
  if (!asset || cleanOk(projectId, asset, mix, chain)) return;
  // Pedido velho (a timeline já mudou de novo enquanto esperava na fila): o job da intensidade atual vem depois.
  const tl = store.get(projectId).timeline;
  if ((tl.voiceDenoise ?? 0) !== mix || !!tl.voiceChain !== chain) return;
  const root = store.dir(projectId);
  const dir = path.join(root, asset.id);
  const tag = `${Math.round(mix * 100)}${chain ? 'c' : ''}`;
  const master = `clean-${tag}.flac`;
  await atomic(path.join(dir, master), (tmp) => run('ffmpeg', ['-y', '-v', 'error', '-i', asset.path, '-map', '0:a:0', '-vn', '-af', voiceFilter(mix, chain), '-c:a', 'flac', tmp]));
  // Proxy: o MESMO vídeo do proxy (cópia, sem recodificar) com o áudio limpo no lugar.
  let proxy: string | undefined;
  if (asset.proxy) {
    const video = asset.kind === 'video';
    proxy = video ? `proxy-clean-${tag}.mp4` : `proxy-clean-${tag}.m4a`;
    // O proxy de vídeo foi feito com "make_zero": tudo andou o mesmo tanto (a pré-rolagem do AAC). O áudio limpo
    // anda igual, senão ficaria adiantado em relação à imagem e ao proxy original.
    const shift = video ? Math.max(0, (await startTime(path.join(root, asset.proxy), 'v')) - ((await startTime(asset.path, 'v')) - (await startTime(asset.path, 'a')))) : 0;
    const ins = video ? ['-i', path.join(root, asset.proxy), '-itsoffset', shift.toFixed(6), '-i', path.join(dir, master), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy'] : ['-i', path.join(dir, master), '-map', '0:a:0', '-vn'];
    await atomic(path.join(dir, proxy), (tmp) => run('ffmpeg', ['-y', '-v', 'error', ...ins, '-c:a', 'aac', '-b:a', video ? '128k' : '160k', '-ac', '2', '-movflags', '+faststart', tmp]));
  }
  const cur = find();
  if (!cur) return;
  store.upsertAsset(projectId, { ...cur, clean: { mix, chain, master: `${asset.id}/${master}`, ...(proxy ? { proxy: `${asset.id}/${proxy}` } : {}) } });
  // Só a intensidade atual fica no disco (refazer outra leva segundos).
  for (const f of await fs.readdir(dir)) {
    if (/^(proxy-)?clean-\d+c?\.(flac|mp4|m4a)$/.test(f) && f !== master && f !== proxy) await fs.rm(path.join(dir, f), { force: true });
  }
}

async function startTime(file: string, stream: 'v' | 'a'): Promise<number> {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', `${stream}:0`, '-show_entries', 'stream=start_time', '-of', 'csv=p=0', file]);
  return Number(out.toString().trim()) || 0;
}

/** Deixa a voz limpa pronta para a intensidade atual da timeline (nada se a limpeza estiver desligada). */
export async function syncVoiceClean(projectId: string): Promise<void> {
  const p = store.get(projectId);
  const mix = p.timeline.voiceDenoise ?? 0;
  const chain = !!p.timeline.voiceChain;
  if (!mix && !chain) return;
  // Master ausente no disco (apagado, disco trocado) também refaz: só o asset.clean bater não basta (CH-0026).
  const todo = voiceAssets(p).filter((a) => !cleanOk(projectId, a, mix, chain));
  if (!todo.length) return;
  const t0 = Date.now();
  for (const a of todo) await cleanVoice(projectId, a.id, mix, chain);
  store.log(projectId, 'agent', `Voz processada (${mix ? `limpeza ${Math.round(mix * 100)}%` : ''}${mix && chain ? ' + ' : ''}${chain ? 'cadeia de voz' : ''}) em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

/** Master limpo para o export, se a limpeza estiver ligada para este asset. */
export function cleanMaster(p: Project, a: MediaAsset): string | null {
  const mix = p.timeline.voiceDenoise ?? 0;
  const chain = !!p.timeline.voiceChain;
  return (mix || chain) && a.clean && a.clean.mix === mix && !!a.clean.chain === chain ? path.join(store.dir(p.id), a.clean.master) : null;
}
