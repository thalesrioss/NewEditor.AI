/**
 * Quadro de conferência (CH-0018): 1 quadro da timeline pelo MESMO caminho do render — tamanho de entrega, reframe,
 * zoom, cor (color management por clipe + grade) e o trecho (ProRes 10 bits, faixa legal) — sem render completo.
 * Devolve o PNG e a medida do signalstats na escala da entrega (4:2:0 8 bits, faixa legal: preto = 16). Aceita grade
 * de teste por arquivo, sem salvar no projeto.
 * Por padrão só a faixa principal (V1). Com `camadas` (CH-0028), o B-roll e o motion de arquivo (V2/V3) ativos no
 * quadro entram por cima, com o mesmo enquadramento, grade e ordem de trilha do render; lettering, motion desenhado
 * e legenda continuam fora.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { clipDuration, clipStarts, normalizeGradeLut, overlayActive, overlaySourceTime, overlaysInDrawOrder, resolveOverlay, resolveRegionFx, TIMELINE_ANCHOR, type ColorGrade, type MediaAsset, type OverlayItem, type Project } from '@neweditor/core';
import { run } from './media.ts';
import { regionFxGraph } from './region-fx.ts';
import { camLut, DELIVERY_VIDEO_FILTER, deliverySize, gradeFilters, overlayFit, overlayFrames, segmentVideo } from './render.ts';
import { managedGrades } from './color-source.ts';

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
  /** Camadas desenhadas por cima da V1 (só com `camadas`), na ordem de desenho: id, papel e o instante da fonte. */
  camadas?: { id: string; role: string; trackId: string; assetId: string; fonte: number }[];
}

/**
 * B-roll e motion de arquivo visíveis no quadro `f` da timeline, na ordem de desenho do render (V2 embaixo, V3 em
 * cima), com o instante da fonte que o render mostra nesse quadro (velocidade e congelamento incluídos).
 */
export function camadasNoQuadro(tl: Project['timeline'], assets: Map<string, MediaAsset>, f: number): { o: OverlayItem; a: MediaAsset; fonte: number }[] {
  const fps = tl.fps || 30;
  return overlaysInDrawOrder(tl.overlays).flatMap((o) => {
    if (!overlayActive(tl, o) || o.source.type !== 'media' || (o.role !== 'broll' && o.role !== 'motion')) return [];
    const a = assets.get(o.source.assetId);
    if (!a || (a.kind !== 'video' && a.kind !== 'image')) return [];
    const pos = resolveOverlay(tl, o);
    if (!pos || pos.end - pos.start <= 0.02) return [];
    const w = overlayFrames(pos.start, pos.end, fps);
    if (f < w.f0 || f >= w.f1) return [];
    return [{ o, a, fonte: a.kind === 'image' ? 0 : overlaySourceTime(o, f / fps - w.at) }];
  });
}

/**
 * Efeitos por região ativos no instante `t`, reescritos para um quadro só com tempo 0 (o quadro de conferência
 * sai com setpts=0). A rampa de entrada/saída não entra: o quadro mostra o efeito inteiro.
 */
export function regioesNoQuadro(tl: Project['timeline'], t: number): Project['timeline'] {
  const ativos = (tl.regionFx ?? []).filter((fx) => {
    const pos = resolveRegionFx(tl, fx);
    return pos && t >= pos.start && t < pos.end;
  });
  return { ...tl, regionFx: ativos.map(({ fade: _f, ...fx }) => ({ ...fx, anchor: { assetId: TIMELINE_ANCHOR, at: 0 }, duration: 1 })) };
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

/** Trabalho com mais de 10 min é sobra de pedido que caiu; o de outro pedido em curso fica. */
const WORK_TTL_MS = 10 * 60_000;

/**
 * Guarda só os últimos 20 quadros (são de conferência, não de entrega) e apaga as pastas `.work-*` abandonadas.
 * Pedidos simultâneos no mesmo projeto não apagam o trabalho um do outro.
 */
export async function limparQuadros(outDir: string, agora = Date.now()): Promise<void> {
  const nomes = await fs.readdir(outDir);
  const pngs = nomes.filter((f) => f.startsWith('q_')).sort((x, y) => x.slice(x.lastIndexOf('_')).localeCompare(y.slice(y.lastIndexOf('_'))));
  for (const f of pngs.slice(0, -20)) await fs.rm(path.join(outDir, f), { force: true });
  for (const f of nomes.filter((f) => f.startsWith('.work-'))) {
    const st = await fs.stat(path.join(outDir, f)).catch(() => null);
    if (st && agora - st.mtimeMs > WORK_TTL_MS) await fs.rm(path.join(outDir, f), { recursive: true, force: true });
  }
}

export async function renderQuadro(p: Project, dir: string, t: number, grades?: Record<string, Partial<ColorGrade>>, camadas = false): Promise<QuadroResult> {
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

  // Grade de teste por cima da salva (só neste quadro). Só vale para arquivo do projeto: chave desconhecida é 400.
  if (grades != null && (typeof grades !== 'object' || Array.isArray(grades))) throw Object.assign(new Error('grades precisa ser um objeto { <assetId>: grade }'), { statusCode: 400 });
  const merged: NonNullable<Project['timeline']['grades']> = { ...(tl.grades ?? {}) };
  for (const [id, g] of Object.entries(grades ?? {})) {
    if (!assets.has(id)) throw Object.assign(new Error(`grades: "${id}" não é um arquivo do projeto`), { statusCode: 400 });
    if (!g || typeof g !== 'object' || Array.isArray(g)) throw Object.assign(new Error(`grades.${id} precisa ser um objeto de grade`), { statusCode: 400 });
    merged[id] = normalizeGradeLut({ ...(merged[id] ?? {}), ...g } as ColorGrade);
  }

  const outDir = path.join(dir, 'quadros');
  await fs.mkdir(outDir, { recursive: true });
  await limparQuadros(outDir);
  const work = await fs.mkdtemp(path.join(outDir, '.work-'));
  try {
    // A mesma cor do render: color management por clipe (entrada lida do arquivo) por cima da grade de teste.
    const managedC = await managedGrades(p, merged);
    const { luts, lutFilter, clipFilter } = await gradeFilters(managedC.grades, work);
    const seg = path.join(work, 'seg.mov');
    // Do início do clipe até o quadro pedido: zoom animado e congelamento saem iguais ao render.
    await segmentVideo(a, c, hit.frame + 1, fps, W, H, seg, await clipFilter(camLut(a.id, cam?.id, luts, managedC.colors), c.grade), !!tl.reframe, cam);
    const name = `q_${Math.round(t * 1000)}_${Date.now().toString(36)}.png`;
    const png = path.join(outDir, name);
    const probe = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_range', '-of', 'default=nw=1:nk=1', seg])).toString().trim();
    const base = `select='eq(n\\,${hit.frame})'`;
    // Medido como sai na entrega (4:2:0 8 bits, faixa legal): o trecho é ProRes 10 bits e o signalstats leria em 0..1023.
    const medir = `${DELIVERY_VIDEO_FILTER},signalstats,metadata=print:file=-`;
    const sobre = camadas ? camadasNoQuadro(tl, assets, Math.round(clipStarts(tl)[hit.i]! * fps) + hit.frame) : [];
    // Efeito por região ativo neste instante (CH-0033): entra na V1, antes das camadas, como no render.
    const rfx = regionFxGraph(regioesNoQuadro(tl, t), W, H, fps, 'b0');
    let out: Buffer;
    if (!sobre.length && !rfx.parts.length) {
      // Último quadro do trecho: medido em YUV como está no arquivo (escala do render) e salvo em PNG.
      out = await run('ffmpeg', ['-v', 'error', '-i', seg, '-vf', `${base},${medir}`, '-frames:v', '1', '-update', '1', '-y', png]);
    } else {
      // Camadas por cima: o quadro de cada fonte no instante que o render mostra, com o encaixe do render (CH-0028).
      const args = ['-v', 'error', '-i', seg];
      const parts = [`[0:v]${base},setpts=0[b0]`, ...rfx.parts];
      let cur = rfx.out;
      sobre.forEach(({ o, a: oa, fonte }, k) => {
        args.push(...(oa.kind === 'image' ? [] : ['-ss', fonte.toFixed(4)]), '-i', oa.path);
        parts.push(`[${k + 1}:v:0]trim=end_frame=1,setpts=0,${overlayFit(oa, W, H, o.framing, lutFilter)},setsar=1[o${k}]`);
        parts.push(`[${cur}][o${k}]overlay=eof_action=repeat[c${k}]`);
        cur = `c${k}`;
      });
      parts.push(`[${cur}]${medir}[q]`);
      out = await run('ffmpeg', [...args, '-filter_complex', parts.join(';'), '-map', '[q]', '-frames:v', '1', '-update', '1', '-y', png]);
    }
    const sinal = lerSinal(out.toString());
    return {
      file: `quadros/${name}`, t, clipId: c.id, assetId: a.id, range: probe === 'pc' ? 'pc' : 'tv', sinal,
      ...(camadas ? { camadas: sobre.map(({ o, a: oa, fonte }) => ({ id: o.id, role: o.role, trackId: o.trackId, assetId: oa.id, fonte: Math.round(fonte * 1000) / 1000 })) } : {}),
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
