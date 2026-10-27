/**
 * Entrega (ADR-007 F-4): o render com preset, nome padronizado, legenda .srt e capa, copiado para a pasta de
 * entregas do cliente — e o projeto vai para "Entregue" (só com o QC sem bloqueio). Cada entrega vira uma
 * versão (o ciclo de alteração compara v1 × v2).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCues, resolveOverlay, timelineDuration, toSrt, type ProjectVersion, type TextWord } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { saveGabarito } from './benchmark.ts';
import { stepEnd, stepStart } from './estimate.ts';
import { run } from './media.ts';
import { notify } from './notify.ts';
import { runQc, runRenderQc } from './qc.ts';
import { render } from './render.ts';
import { store } from './store.ts';

export const ENTREGAS_DIR = process.env.NEWEDITOR_ENTREGAS ?? path.join(os.homedir(), 'Movies', 'NewEditor Entregas');

export type Preset = 'reels' | 'shorts' | 'tiktok' | 'youtube' | 'original';
export const PRESETS: Record<Preset, { label: string; sufixo: string }> = {
  reels: { label: 'Instagram Reels', sufixo: 'reels' },
  shorts: { label: 'YouTube Shorts', sufixo: 'shorts' },
  tiktok: { label: 'TikTok', sufixo: 'tiktok' },
  youtube: { label: 'YouTube', sufixo: 'yt' },
  original: { label: 'Original', sufixo: '' },
};

export interface EntregaOpts {
  preset: Preset;
  srt: boolean;
  capa: boolean;
  /** Instante (s) da capa; ausente = primeiro lettering ou 1/3 da peça. */
  capaEm?: number;
  /** Marca como entregue no Kanban (só com QC sem bloqueio). */
  entregar: boolean;
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'video';

export async function entregar(projectId: string, opts: EntregaOpts, onProgress?: (pct: number) => void): Promise<{ pasta: string; arquivos: string[]; versao: number; qcBloqueios: string[] }> {
  let p = store.get(projectId);
  // QC da edição antes de gastar tempo com render.
  const qcEd = await runQc(projectId);
  const bloqueios = qcEd.issues.filter((i) => i.severidade === 'bloqueia').map((i) => i.texto);
  if (opts.entregar && bloqueios.length) throw Object.assign(new Error(`QC com bloqueio: ${bloqueios.join(' · ')}`), { statusCode: 409 });

  stepStart(projectId, 'render');
  const res = await render(p, store.dir(projectId), (pct) => onProgress?.(pct * 0.9));
  stepEnd(projectId, 'render');
  p = store.get(projectId);
  const qcR = await runRenderQc(projectId, path.join(store.dir(projectId), res.file)).catch(() => null);
  const renderBlock = qcR?.issues.filter((i) => i.severidade === 'bloqueia' && i.id.startsWith('qcr_')).map((i) => i.texto) ?? [];
  // Render que reprova no gate técnico não sai como entrega (FB-0180): nada vai para a pasta do cliente.
  const tecnico = qcR?.issues.filter((i) => i.severidade === 'bloqueia' && i.regra.startsWith('tecnico:')).map((i) => i.texto) ?? [];
  if (!qcR || tecnico.length) {
    const motivo = qcR ? tecnico.join(' · ') : 'o QC do render não rodou';
    store.log(projectId, 'agent', `Entrega NÃO saiu: reprovada no gate técnico (${motivo}). Render para conferência em ${res.file}; laudo em ${res.file.replace(/\.mp4$/i, '')}.qc-tecnico.txt`);
    if (opts.entregar) throw Object.assign(new Error(`Gate técnico reprovou: ${motivo}`), { statusCode: 409 });
    onProgress?.(1);
    return { pasta: '', arquivos: [], versao: p.versions?.at(-1)?.n ?? 0, qcBloqueios: [...bloqueios, ...renderBlock] };
  }

  const versao = (p.versions?.at(-1)?.n ?? 0) + 1;
  const pasta = path.join(ENTREGAS_DIR, slug(p.client ?? 'sem-cliente'), slug(p.name));
  await fs.mkdir(pasta, { recursive: true });
  const base = [slug(p.client ?? ''), slug(p.name), PRESETS[opts.preset].sufixo, `v${versao}`].filter(Boolean).join('_');
  const arquivos: string[] = [];
  const mp4 = path.join(pasta, `${base}.mp4`);
  await fs.copyFile(path.join(store.dir(projectId), res.file), mp4);
  arquivos.push(mp4);

  if (opts.srt && p.timeline.captions?.enabled) {
    const transcripts: Record<string, TextWord[]> = {};
    for (const a of p.assets) if (a.transcript) transcripts[a.id] = (await readTranscript(path.join(store.dir(projectId), a.transcript))).words;
    const cues = buildCues(p.timeline, transcripts, p.timeline.captions).filter((c) => !c.hidden);
    const srt = path.join(pasta, `${base}.srt`);
    await fs.writeFile(srt, toSrt(cues));
    arquivos.push(srt);
  }
  if (opts.capa) {
    const firstLettering = p.timeline.overlays.find((o) => o.role === 'lettering');
    const pos = firstLettering ? resolveOverlay(p.timeline, firstLettering) : null;
    const t = opts.capaEm ?? (pos ? pos.start + Math.min(0.8, (pos.end - pos.start) * 0.6) : Math.max(0.5, timelineDuration(p.timeline) / 3));
    const capa = path.join(pasta, `${base}_capa.jpg`);
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '2', capa]).catch(() => undefined);
    arquivos.push(capa);
  }
  onProgress?.(0.97);

  const version: ProjectVersion = { n: versao, at: new Date().toISOString(), label: `${PRESETS[opts.preset].label} v${versao}`, timeline: p.timeline, render: res.file };
  store.update(projectId, { versions: [...(p.versions ?? []), version] });
  store.log(projectId, 'agent', `Entrega v${versao} pronta em ${pasta}: ${arquivos.map((f) => path.basename(f)).join(', ')}${renderBlock.length ? ` — ATENÇÃO: ${renderBlock.join(' · ')}` : ''}`);
  if (opts.entregar && !renderBlock.length) {
    await saveGabarito(store.get(projectId), 'entregue');
    store.update(projectId, { status: 'entregue' });
    stepEnd(projectId, 'final');
    await notify(store.get(projectId), 'editado', `Entregue: ${p.name} — v${versao} em ${pasta}`);
  }
  onProgress?.(1);
  return { pasta, arquivos, versao, qcBloqueios: [...bloqueios, ...renderBlock] };
}
