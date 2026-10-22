/**
 * Quadro de conferência (CH-0018): 1 quadro da timeline pelo MESMO caminho do render — tamanho de entrega, reframe,
 * zoom, LUT da grade e o encode do trecho (libx264 yuv420p, que herda o range do bruto) — sem render completo.
 * Devolve o PNG e a medida do signalstats no arquivo codificado, na mesma escala do render (full range num bruto pc:
 * preto = 0; limitado: preto = 16). Aceita grade de teste por arquivo, sem salvar no projeto.
 * Só a faixa principal (V1): B-roll, motion, lettering e legenda ficam fora.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { clipDuration, clipStarts, normalizeGradeLut, type ColorGrade, type Project } from '@neweditor/core';
import { run } from './media.ts';
import { deliverySize, gradeFilters, segmentVideo } from './render.ts';

export interface QuadroSinal {
  ylow: number;
  yavg: number;
  yhigh: number;
  ymin: number;
  ymax: number;
}

export interface QuadroResult {
  /** Caminho do PNG relativo à pasta do projeto (servido em /media/<id>/<file>). */
  file: string;
  t: number;
  clipId: string;
  assetId: string;
  /** Range do quadro codificado, como sai no render: 'pc' (full, preto 0) ou 'tv' (limitado, preto 16). */
  range: string;
  sinal: QuadroSinal;
}

/** Clipe da V1 no tempo `t` da timeline e o índice do quadro dentro dele (no grid de quadros do render). */
export function clipNoTempo(tl: Project['timeline'], t: number): { i: number; frame: number } | null {
  const fps = tl.fps || 30;
  const starts = clipStarts(tl);
  const frameAt = (x: number) => Math.round(x * fps);
  // O quadro na tela em `t` é o que começou em ou antes de t (as fronteiras dos clipes seguem o round do render).
  const f = Math.floor(t * fps + 1e-6);
  for (let i = 0; i < tl.main.length; i++) {
    const f0 = frameAt(starts[i]!);
    const f1 = frameAt(starts[i]! + clipDuration(tl.main[i]!));
    if (f >= f0 && f < f1) return { i, frame: f - f0 };
  }
  return null;
}

/** Lê YLOW/YAVG/YHIGH/YMIN/YMAX do `metadata=print` do signalstats. */
export function lerSinal(txt: string): QuadroSinal {
  const v = (k: string) => {
    const m = new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`).exec(txt);
    return m ? +m[1]! : NaN;
  };
  return { ylow: v('YLOW'), yavg: v('YAVG'), yhigh: v('YHIGH'), ymin: v('YMIN'), ymax: v('YMAX') };
}

export async function renderQuadro(p: Project, dir: string, t: number, grades?: Record<string, Partial<ColorGrade>>): Promise<QuadroResult> {
  const tl = p.timeline;
  if (!tl.main.length) throw Object.assign(new Error('timeline vazia'), { statusCode: 400 });
  if (!Number.isFinite(t) || t < 0) throw Object.assign(new Error('t (segundos da timeline) precisa ser um número >= 0'), { statusCode: 400 });
  const hit = clipNoTempo(tl, t);
  if (!hit) throw Object.assign(new Error(`t=${t} fora da timeline`), { statusCode: 400 });
  const c = tl.main[hit.i]!;
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  const a = assets.get(c.assetId);
  if (a?.kind !== 'video') throw Object.assign(new Error('o clipe nesse tempo não é vídeo'), { statusCode: 400 });
  const cam = c.cam ? assets.get(c.cam) : undefined;
  const fps = tl.fps || 30;
  const { W, H } = deliverySize(tl);

  // Grade de teste por cima da salva (só neste quadro).
  const merged: NonNullable<Project['timeline']['grades']> = { ...(tl.grades ?? {}) };
  for (const [id, g] of Object.entries(grades ?? {})) merged[id] = normalizeGradeLut({ ...(merged[id] ?? {}), ...g } as ColorGrade);

  const outDir = path.join(dir, 'quadros');
  await fs.mkdir(outDir, { recursive: true });
  // Guarda só os últimos quadros (são de conferência, não de entrega).
  const old = (await fs.readdir(outDir)).filter((f) => f.startsWith('q_') || f.startsWith('.work-')).sort((x, y) => x.slice(x.lastIndexOf('_')).localeCompare(y.slice(y.lastIndexOf('_'))));
  for (const f of old.filter((f) => f.startsWith('.work-')).concat(old.filter((f) => f.startsWith('q_')).slice(0, -20))) await fs.rm(path.join(outDir, f), { recursive: true, force: true });
  const work = await fs.mkdtemp(path.join(outDir, '.work-'));
  try {
    const { luts, lutFilter } = await gradeFilters(merged, work);
    const seg = path.join(work, 'seg.mp4');
    // Do início do clipe até o quadro pedido: zoom animado e congelamento saem iguais ao render.
    await segmentVideo(a, c, hit.frame + 1, fps, W, H, seg, lutFilter(cam && luts.has(cam.id) ? cam.id : a.id), !!tl.reframe, cam);
    const name = `q_${Math.round(t * 1000)}_${Date.now().toString(36)}.png`;
    const png = path.join(outDir, name);
    const probe = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_range', '-of', 'default=nw=1:nk=1', seg])).toString().trim();
    // Último quadro do trecho: medido em YUV como está no arquivo (escala do render) e salvo em PNG.
    const out = await run('ffmpeg', ['-v', 'error', '-i', seg, '-vf', `select='eq(n\\,${hit.frame})',signalstats,metadata=print:file=-`, '-frames:v', '1', '-update', '1', '-y', png]);
    const sinal = lerSinal(out.toString());
    return { file: `quadros/${name}`, t, clipId: c.id, assetId: a.id, range: probe === 'pc' ? 'pc' : 'tv', sinal };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
