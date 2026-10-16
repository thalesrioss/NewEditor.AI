/**
 * Trilha: biblioteca de músicas do editor (uma pasta no disco) + "usar como trilha" no projeto.
 * A trilha entra na A3 presa à TIMELINE (cobre o vídeo inteiro mesmo se a decupagem mudar o começo),
 * com volume, fades e ducking sob a fala.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MUSIC_MIX, TIMELINE_ANCHOR, timelineDuration } from '@neweditor/core';
import { ingest } from './ingest.ts';
import { analyzeTrack, cachedAnalysis, targetBpm, type TrackAnalysis } from './music-analysis.ts';
import { profileOf } from './profiles.ts';
import { clipDuration } from '@neweditor/core';
import { probe } from './media.ts';
import { store } from './store.ts';

export const MUSIC_DIRS = (process.env.NEWEDITOR_MUSIC_DIRS ?? '/Volumes/Thales SSD/Clientes/Thales/Trilhas').split(':').filter(Boolean);
const AUDIO = /\.(mp3|m4a|wav|aac|aif|aiff|flac|ogg)$/i;

export interface MusicTrack {
  name: string;
  path: string;
  duration: number;
  folder: string;
  /** BPM, clima e onde começar (medido uma vez; ausente = ainda não analisada). */
  analise?: TrackAnalysis;
}

const cache = new Map<string, MusicTrack>();

export async function listMusic(): Promise<MusicTrack[]> {
  const out: MusicTrack[] = [];
  for (const dir of MUSIC_DIRS) {
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue; // pasta (ou disco externo) não disponível
    }
    for (const f of entries.filter((x) => AUDIO.test(x) && !x.startsWith('.'))) {
      const p = path.join(dir, f);
      let t = cache.get(p);
      if (!t) {
        try {
          t = { name: f.replace(AUDIO, ''), path: p, duration: (await probe(p)).duration, folder: path.basename(dir) };
          cache.set(p, t);
        } catch {
          continue;
        }
      }
      out.push({ ...t, analise: (await cachedAnalysis(p)) ?? undefined });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

let analyzing = false;
/** Analisa em segundo plano as faixas ainda sem BPM (uma de cada vez, sem travar a listagem). */
export function analyzeLibraryInBackground(): void {
  if (analyzing) return;
  analyzing = true;
  void (async () => {
    try {
      for (const t of await listMusic()) if (!t.analise) await analyzeTrack(t.path).catch(() => undefined);
    } finally {
      analyzing = false;
    }
  })();
}

/**
 * Escolhe a trilha pelo ritmo do corte (BPM-alvo = um tempo forte por corte mediano) e pelo clima do perfil,
 * começa num tempo forte logo depois da introdução calma e usa o nível do perfil.
 */
export async function musicAuto(projectId: string): Promise<{ track: MusicTrack; bpmAlvo: number } | null> {
  const p = store.get(projectId);
  const prof = await profileOf(p);
  const durs = p.timeline.main.map(clipDuration).sort((a, b) => a - b);
  const median = durs.length ? durs[durs.length >> 1]! : 3;
  const bpmAlvo = targetBpm(median);
  const tracks = (await listMusic()).filter((t) => t.analise);
  if (!tracks.length) return null;
  const dist = (t: MusicTrack) => {
    const a = t.analise!;
    // Diferença de BPM aceitando o dobro/metade (mesmo pulso), mais leve preferência por confiança e clima médio.
    const d = Math.min(Math.abs(a.bpm - bpmAlvo), Math.abs(a.bpm * 2 - bpmAlvo), Math.abs(a.bpm / 2 - bpmAlvo));
    return d + (1 - a.beatConf) * 10 + (a.clima === 'agitada' && median > 3 ? 8 : 0);
  };
  const track = [...tracks].sort((a, b) => dist(a) - dist(b))[0]!;
  const a = track.analise!;
  // Nível: o perfil diz quantos LUFS a trilha fica sob a voz; a voz normalizada fica em ≈ −16 LUFS.
  const gainDb = Math.max(-30, Math.min(-8, prof.trilha.lufsSobVoz + 11));
  await useAsTrilha(projectId, track.path, { in: Math.min(a.startAt, Math.max(0, track.duration - 30)), gainDb, fadeIn: prof.trilha.fadeIn, fadeOut: prof.trilha.fadeOut, duck: prof.trilha.ducking });
  store.log(projectId, 'agent', `Trilha: "${track.name}" (${a.bpm} BPM, ${a.clima}) para um corte de ${median.toFixed(1)} s (alvo ${bpmAlvo} BPM), começando em ${a.startAt.toFixed(1)} s num tempo forte.`);
  return { track, bpmAlvo };
}

/** Só toca arquivo de dentro das pastas da biblioteca (nada de caminho arbitrário vindo do navegador). */
export function musicFileAllowed(p: string): boolean {
  const abs = path.resolve(p);
  return AUDIO.test(abs) && MUSIC_DIRS.some((d) => abs.startsWith(path.resolve(d) + path.sep)) && fs.existsSync(abs);
}

/** Importa a música (se ainda não está no projeto) e põe como trilha, substituindo a anterior. */
export async function useAsTrilha(projectId: string, file: string, opts: { in?: number; gainDb?: number; fadeIn?: number; fadeOut?: number; duck?: boolean } = {}): Promise<void> {
  let asset = store.get(projectId).assets.find((a) => a.path === file);
  if (!asset) asset = await ingest(projectId, file, 'broll');
  const p = store.get(projectId);
  const old = p.timeline.overlays.filter((o) => o.role === 'music');
  await store.transaction(projectId, `Trilha: ${asset.name}`, async () => {
    for (const o of old) store.apply(projectId, { by: 'human', op: { type: 'remove_overlay', id: o.id } });
    store.apply(projectId, {
      by: 'human',
      op: {
        type: 'add_overlay',
        item: { trackId: 'A3', role: 'music', anchor: { assetId: TIMELINE_ANCHOR, at: 0 }, duration: timelineDuration(p.timeline), toEnd: true, source: { type: 'media', assetId: asset!.id, in: opts.in ?? 0 }, mix: { ...DEFAULT_MUSIC_MIX, ...(opts.gainDb !== undefined ? { gainDb: opts.gainDb } : {}), ...(opts.fadeIn !== undefined ? { fadeIn: opts.fadeIn } : {}), ...(opts.fadeOut !== undefined ? { fadeOut: opts.fadeOut } : {}), ...(opts.duck !== undefined ? { duck: opts.duck } : {}) } },
      },
      note: `Trilha: ${asset!.name}`,
    });
  });
}
