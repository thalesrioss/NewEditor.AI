import fs from 'node:fs/promises';
import { cineproCube } from './cinepro.ts';
import os from 'node:os';
import path from 'node:path';
import { buildCues, buildLut, clipPlayed, coverCrop, overlayPlayback, clipSpeed, FLASH_FRAMES, flashShutterCues, MOTION_SFX_TRACK, overlayActive, overlaysInDrawOrder, trackFlag, letteringFromText, clipDuration, clipStarts, isNeutral, lutToCube, resolveOverlay, textureOf, timelineDuration, type Clip, type LetteringSpec, type MediaAsset, type MotionSpec, type Project, type SfxCue, type TextWord } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { ROOT } from './config.ts';
import { cleanMaster, syncVoiceClean } from './denoise.ts';
import { DELIVERY, deliverAudio } from './loudness.ts';
import { atomic, run, filterGraphArgs } from './media.ts';
import { renderTextLayer } from './textlayer.ts';
import { projectSpeechDb, renderSfxTrack, sfxBusDb } from './sfx-track.ts';

/** Logo usada no fundo de peças só de áudio. */
const LOGO = path.join(ROOT, 'apps', 'web', 'public', 'logo-mark.png');
/** Micro-fade em cada emenda de áudio: evita o estalo de corte seco. */
const FADE = 0.005;
/**
 * Padrão de entrega para redes: −14 LUFS integrado, pico real ≤ −1 dBTP. Esta é a 1ª passada (dinâmica, na mixagem);
 * o acerto final é medido no MP4 codificado (`deliverAudio`), porque o AAC passa o pico. TP −1,5 = folga.
 */
const LOUDNORM = `loudnorm=I=${DELIVERY.I}:TP=${DELIVERY.TP}:LRA=${DELIVERY.LRA}`;
const MUSIC_GAIN = 0.18;
const DELIVERY_SHORT_SIDE = 1080;
/** Trechos renderizados ao mesmo tempo (o decode do 4K usa a GPU; o encode, a CPU). */
const PARALLEL = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 4)));

export interface RenderResult {
  file: string;
  skipped: string[];
  /** O que entrou no export além do corte (ex.: voz limpa). */
  notes: string[];
}

/**
 * Renderiza a timeline a partir dos ORIGINAIS (nunca do proxy).
 *
 * Por trechos, não num grafo único: cada clipe é lido direto do ponto de entrada e só ele é decodificado
 * (um bruto 4K de 13 min com 2:48 mantidos decodifica 2:48, não 13 min), vários em paralelo. O vídeo de
 * cada trecho tem um número EXATO de quadros (fronteiras arredondadas no tempo acumulado — sem deriva) e o
 * áudio vai em WAV (emenda exata na amostra). Depois: junta sem recodificar e uma passada final aplica
 * overlays, mixagem e loudness.
 */
export async function render(p: Project, dir: string, onProgress?: (pct: number) => void): Promise<RenderResult> {
  const tl = p.timeline;
  const clips = tl.main;
  if (!clips.length) throw new Error('timeline vazia');
  // Voz limpa (se ligada): o export lê o MESMO áudio limpo que o preview toca.
  await syncVoiceClean(p.id);
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  const fps = tl.fps || 30;
  // Entrega no padrão registrado no Cérebro do Editor (04_EDITOR: base 1080×1920).
  const { W, H } = deliverySize(tl);
  const total = timelineDuration(tl);
  const hasVideo = assets.get(clips[0]!.assetId)?.kind === 'video';
  const skipped: string[] = [];

  const rendersDir = path.join(dir, 'renders');
  // Render interrompido (servidor reiniciou) deixa a pasta de trabalho para trás: os renders deste projeto
  // rodam um de cada vez (fila), então qualquer pasta de trabalho que exista agora é sobra.
  await fs.mkdir(rendersDir, { recursive: true });
  for (const f of await fs.readdir(rendersDir)) {
    if (f.startsWith('.work-') || /\.tmp-\d+-\w+\.mp4$/.test(f)) await fs.rm(path.join(rendersDir, f), { recursive: true, force: true });
  }
  const work = path.join(rendersDir, `.work-${p.version}-${Date.now().toString(36)}`);
  await fs.mkdir(work, { recursive: true });
  const notes: string[] = [];
  if (tl.voiceDenoise && clips.some((c) => cleanMaster(p, assets.get(c.assetId)!))) notes.push(`voz limpa ${Math.round(tl.voiceDenoise * 100)}%`);
  try {
    // --- 0. Cor: um LUT por arquivo (câmera), o mesmo que o preview usa --------------------------
    const { luts, lutFilter } = await gradeFilters(tl.grades, work);

    // --- 1. Trechos ---------------------------------------------------------------------------
    const starts = clipStarts(tl);
    const frameAt = (t: number) => Math.round(t * fps);
    // Uma faixa de níveis para todos os trechos (CH-0029/CH-0030).
    const range = await mainRange(p);
    const jobs = clips.map((c, i) => ({ c, i, a: assets.get(c.assetId)!, frames: frameAt(starts[i]! + clipDuration(c)) - frameAt(starts[i]!) }));
    let done = 0;
    const tick = () => onProgress?.(Math.min(0.85, (++done / (jobs.length * (hasVideo ? 2 : 1))) * 0.85));

    await pool(jobs, PARALLEL, async ({ c, i, a, frames }) => {
      const seg = (ext: string) => path.join(work, `${String(i).padStart(4, '0')}.${ext}`);
      if (hasVideo) {
        const cam = c.cam ? assets.get(c.cam) : undefined;
        await segmentVideo(a, c, frames, fps, W, H, seg('mp4'), lutFilter(cam && luts.has(cam.id) ? cam.id : a.id), !!tl.reframe, cam, range);
        tick();
      }
      await segmentAudio(a, c, seg('wav'), cleanMaster(p, a));
      tick();
    });

    // --- 2. Junta sem recodificar ----------------------------------------------------------
    const list = async (ext: string) => {
      const f = path.join(work, `${ext}.txt`);
      await fs.writeFile(f, jobs.map(({ i }) => `file '${String(i).padStart(4, '0')}.${ext}'`).join('\n'));
      return f;
    };
    const mainA = path.join(work, 'main.wav');
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', await list('wav'), '-c', 'copy', mainA]);
    const mainV = path.join(work, 'main.mp4');
    if (hasVideo) await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', await list('mp4'), '-c', 'copy', mainV]);
    onProgress?.(0.88);

    // --- 3. Passada final: overlays, mixagem, loudness ---------------------------------------
    const letterings: { start: number; end: number; spec: LetteringSpec }[] = [];
    const motions: { start: number; end: number; spec: MotionSpec }[] = [];
    // Ordem de desenho por trilha (V2 embaixo, V3 em cima), não pela ordem de inserção (CH-0024).
    const placed = overlaysInDrawOrder(tl.overlays).flatMap((o) => {
      // Trilha oculta (imagem) ou muda (som): fora do export, como no preview.
      if (!overlayActive(tl, o)) return [];
      const pos = resolveOverlay(tl, o);
      if (!pos) return (skipped.push(`overlay órfão (${o.role})`), []);
      if (o.source.type === 'text' || o.source.type === 'lettering') {
        // Lettering: animado no lugar da legenda (o antigo, em texto, ganha o estilo padrão).
        letterings.push({ start: pos.start, end: Math.min(pos.end, total), spec: o.source.type === 'lettering' ? o.source.lettering : letteringFromText(o.source.text) });
        return [];
      }
      if (o.source.type === 'motion') {
        // Motion narrativo: desenhado pelo Chrome junto com a camada de texto (ADR-002).
        motions.push({ start: pos.start, end: Math.min(pos.end, total), spec: o.source.motion });
        return [];
      }
      if (o.source.type !== 'media') {
        skipped.push(`composição "${o.source.compositionId}" ainda não entra no export`);
        return [];
      }
      const a = assets.get(o.source.assetId);
      return a ? [{ o, a, srcIn: o.source.in, start: pos.start, end: Math.min(pos.end, total) }] : [];
    });

    const inputs: (string | { path: string; pre: string[] })[] = [hasVideo ? mainV : LOGO, mainA];
    const parts: string[] = [];
    if (!hasVideo) {
      // Fala só em áudio (VO): a peça AINDA sai em vídeo — fundo + logo + forma de onda; B-roll cobre por cima.
      const waveW = Math.round((W * 0.8) / 2) * 2;
      const waveH = Math.round((H * 0.12) / 2) * 2;
      parts.push(`color=c=0x0b0d12:s=${W}x${H}:r=${fps},trim=duration=${total}[bg]`);
      parts.push(`[0:v]scale=${Math.round(W * 0.16)}:-1,format=rgba[logo]`);
      parts.push(`[1:a]asplit=2[a1][awave]`);
      parts.push(`[awave]aformat=channel_layouts=mono,showwaves=s=${waveW}x${waveH}:mode=cline:draw=full:rate=${fps}:colors=0x4f84ff:scale=sqrt,format=rgba,colorkey=0x000000:0.02:0[wave]`);
      parts.push(`[bg][logo]overlay=(W-w)/2:H*0.34[bg1]`);
      parts.push(`[bg1][wave]overlay=(W-w)/2:H*0.48:shortest=1,format=yuv420p[v0]`);
    }
    // Com fala em vídeo, a imagem base é a própria entrada 0; overlays encadeiam a partir dela.
    let vCur = hasVideo ? '0:v' : 'v0';
    // A fala vira gatilho do ducking: uma cópia vai para a mixagem, as outras para os compressores.
    const ducked = placed.filter(({ o, a }) => (o.role === 'music' || o.role === 'sfx') && a.hasAudio && (o.mix?.duck ?? o.role === 'music'));
    const speech = hasVideo ? '[1:a]' : '[a1]';
    const audio: string[] = [];
    if (ducked.length) {
      parts.push(`${speech}asplit=${ducked.length + 1}[spmix]${ducked.map((_, k) => `[sc${k}]`).join('')}`);
      audio.push('[spmix]');
    } else audio.push(speech);
    // A1 muda: a voz sai da mixagem, mas continua comandando o ducking da trilha.
    if (trackFlag(tl, 'A1', 'muted')) {
      parts.push(`${audio[0]}volume=0[spmute]`);
      audio[0] = '[spmute]';
    }
    let duckN = 0;
    let videoTouched = !hasVideo;
    // O obturador só nos flashes com som (flashSfx false = o editor põe a amostra dele no A2).
    const flashCues: { at: number; c: SfxCue }[] = flashShutterCues(tl).map(({ at, cue }) => ({ at, c: cue }));
    // SFX dos motions do Motion Studio (cues do film.js), no tempo da timeline.
    for (const { o, start } of placed) if (o.role === 'motion' && o.source.type === 'media' && o.sfx?.length) for (const c of o.sfx) flashCues.push({ at: start + c.t, c: { ...c, kind: c.kind as 'shutter' } });
    placed.forEach(({ o, a, srcIn, start, end }, n) => {
      const d = end - start;
      if (d <= 0.02) return;
      // Imagem (frame, PNG com alfa, GIF): entra como stream em loop pela duração da camada.
      const idx = inputs.push(a.kind === 'image' ? { path: a.path, pre: ['-loop', '1', '-framerate', String(fps), '-t', (d + 0.1).toFixed(3)] } : a.path) - 1;
      if ((o.role === 'broll' || o.role === 'motion') && (a.kind === 'video' || a.kind === 'image')) {
        const fit = overlayFit(a, W, H, o.framing, lutFilter);
        const w = overlayFrames(start, end, fps);
        parts.push(`[${idx}:v:0]${overlayTiming(o, srcIn, w.at, d)},${fit},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${(2 / fps).toFixed(4)}[ov${n}]`);
        parts.push(`[${vCur}][ov${n}]overlay=enable='${w.enable}':eof_action=pass[vo${n}]`);
        vCur = `vo${n}`;
        videoTouched = true;
      } else if ((o.role === 'sfx' || o.role === 'music') && a.hasAudio) {
        const ms = Math.round(start * 1000);
        const mix = o.mix;
        const gain = mix ? `${mix.gainDb}dB` : String(o.role === 'music' ? MUSIC_GAIN : 1);
        const fi = Math.min(mix?.fadeIn ?? 0, d / 2);
        const fo = Math.min(mix?.fadeOut ?? 0, d / 2);
        const fades = `${fi > 0 ? `,afade=t=in:d=${fi}` : ''}${fo > 0 ? `,afade=t=out:st=${Math.max(0, d - fo)}:d=${fo}` : ''}`;
        parts.push(`[${idx}:a:0]atrim=start=${srcIn}:end=${srcIn + d},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${gain}${fades},adelay=${ms}|${ms}[ao${n}]`);
        if (ducked.some((x) => x.o.id === o.id)) {
          // Ducking: a trilha abaixa ~10 dB quando tem fala e volta devagar na pausa.
          parts.push(`[ao${n}][sc${duckN++}]sidechaincompress=threshold=0.012:ratio=12:attack=25:release=450:makeup=1[aod${n}]`);
          audio.push(`[aod${n}]`);
        } else audio.push(`[ao${n}]`);
      }
    });
    // Flash de entrada (2 quadros invertidos, sem cor) nos clipes marcados: depois do B-roll e do motion de
    // arquivo (V2/V3), para não sumir sob overlay de tela cheia (CH-0011); a legenda fica fora, como no preview.
    const flashes = clips.flatMap((c, i) => (c.flash ? [starts[i]!] : []));
    if (hasVideo && flashes.length) {
      const fd = FLASH_FRAMES / fps;
      const en = flashes.map((t) => `between(t\\,${t.toFixed(4)}\\,${(t + fd).toFixed(4)})`).join('+');
      parts.push(`[${vCur}]negate=enable='${en}',hue=s=0:enable='${en}'[vflash]`);
      vCur = 'vflash';
      videoTouched = true;
    }
    // Texto por cima de tudo (legenda nunca fica escondida atrás de B-roll).
    const transcripts: Record<string, TextWord[]> = {};
    for (const a of p.assets) if (a.transcript) transcripts[a.id] = (await readTranscript(path.join(dir, a.transcript))).words;
    const cues = tl.captions?.enabled ? buildCues(tl, transcripts, tl.captions) : [];
    const textMov = await renderTextLayer({ W, H, fps, total, cues, captions: tl.captions, letterings, motions }, work, (x) => onProgress?.(0.88 + 0.04 * x));
    if (textMov) {
      const t = inputs.push(textMov) - 1;
      parts.push(`[${vCur}][${t}:v]${TEXT_OVERLAY}[vtext]`);
      vCur = 'vtext';
      videoTouched = true;
    }
    // SFX dos motions: os mesmos efeitos do preview, abaixo da fala (nível calibrado pelo envelope da voz).
    const sfxWav = !trackFlag(tl, MOTION_SFX_TRACK, 'muted') && (motions.length || letterings.length || flashCues.length) ? await renderSfxTrack(motions, letterings, total, sfxBusDb(await projectSpeechDb(p, dir), tl.motionSfxDb ?? 0), work, flashCues, tl.sfxBank ?? 'sintetizado') : null;
    if (sfxWav) {
      const k = inputs.push(sfxWav) - 1;
      parts.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo[sfxbus]`);
      audio.push('[sfxbus]');
    }
    // O loudnorm vai numa passada só dele (`normalizeMix`, CH-0030): aqui, com duas saídas (vídeo e mix), o ffmpeg 9
    // encerrava o grafo sem o loudnorm devolver o que segura de lookahead, e a mix saía 6 a 9 s curta (fim mudo).
    parts.push(`${audio.join('')}amix=inputs=${audio.length}:duration=first:normalize=0,aformat=sample_rates=48000:channel_layouts=stereo[aout]`);
    const graph = path.join(work, 'final.txt');
    await fs.writeFile(graph, parts.join(';\n'));

    await fs.mkdir(rendersDir, { recursive: true });
    // Dois renders da mesma versão (ex.: fila retomada) não se sobrescrevem.
    let name = `${slug(p.name)}_v${String(p.version).padStart(3, '0')}.mp4`;
    if (await fs.stat(path.join(rendersDir, name)).catch(() => null)) name = name.replace(/\.mp4$/, `-${Date.now().toString(36)}.mp4`);
    const out = path.join(rendersDir, name);
    const args = ['-y', '-v', 'error', '-stats'];
    if (!hasVideo) args.push('-loop', '1');
    for (const f of inputs) (typeof f === 'string' ? args.push('-i', f) : args.push(...f.pre, '-i', f.path));
    args.push(...(await filterGraphArgs(graph)));
    // Sem overlay de vídeo, a imagem já está pronta: só copia (não recodifica duas vezes).
    if (videoTouched) args.push('-map', `[${vCur}]`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps));
    else args.push('-map', '0:v', '-c:v', 'copy');
    // Imagem num arquivo, mixagem em WAV no outro: o AAC só é feito depois, já no alvo de loudness (`deliverAudio`).
    const videoOnly = path.join(work, 'video.mp4');
    const premix = path.join(work, 'premix.wav');
    const mixWav = path.join(work, 'mix.wav');
    args.push('-an', '-t', String(total), videoOnly, '-map', '[aout]', '-c:a', 'pcm_f32le', '-t', String(total), premix);
    await run('ffmpeg', args, {
      onStderr: (s) => {
        const m = /time=(\d+):(\d+):([\d.]+)/.exec(s);
        if (m && onProgress) onProgress(0.88 + 0.11 * Math.min(1, (+m[1]! * 3600 + +m[2]! * 60 + +m[3]!) / total));
      },
    });
    await normalizeMix(premix, mixWav, total);
    // Loudness conferido no MP4 codificado (o que o QC mede): −14 LUFS ±0,5 e ≤ −1 dBTP.
    const loud = await atomic(out, (tmp) => deliverAudio(videoOnly, mixWav, tmp, total));
    const fmt = (x: number) => x.toFixed(1).replace('.', ',');
    notes.push(`áudio ${fmt(loud.after.i)} LUFS, ${fmt(loud.after.tp)} dBTP${loud.ok ? '' : ' (FORA do alvo de entrega −14 LUFS / −1 dBTP: conferir a mixagem)'}`);
    return { file: `renders/${name}`, skipped, notes };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/**
 * Cor do export: um LUT .cube por arquivo (câmera) em `work`, o mesmo que o preview usa, e a cadeia de filtros
 * (lut3d + textura) por assetId. Usado pelo render e pelo quadro de conferência (CH-0018), para os dois baterem.
 */
export async function gradeFilters(grades: Project['timeline']['grades'], work: string): Promise<{ luts: Map<string, string>; lutFilter: (assetId: string) => string }> {
  const luts = new Map<string, string>();
  for (const [assetId, grade] of Object.entries(grades ?? {})) {
    if (isNeutral(grade)) continue;
    // Nome do arquivo pelo índice, nunca pelo id: o id vem do pedido e não pode virar caminho nem aspas no filtro.
    const f = path.join(work, `grade-${luts.size}.cube`);
    // Look (LUT .cube do CinePRO) entra depois da conversão e das primárias — a mesma composição do preview.
    const cube = grade.lut ? await cineproCube(grade.lut.id).catch(() => null) : null;
    await fs.writeFile(f, lutToCube(buildLut(grade, 33, cube), 33));
    luts.set(assetId, f);
  }
  // Textura (nitidez, vinheta, grão) do grade: filtros espaciais, com os mesmos valores do shader do preview.
  const texFilter = (assetId: string) => {
    const t = textureOf(grades?.[assetId]);
    const f: string[] = [];
    if (t.sharpen > 0) f.push(`unsharp=5:5:${(t.sharpen * 1.6).toFixed(2)}`);
    if (t.vignette > 0) f.push(`vignette=a=${(0.2 + t.vignette * 0.9).toFixed(3)}`);
    if (t.grain > 0) f.push(`noise=alls=${Math.round(t.grain * 40)}:allf=t+u`);
    return f.length ? `,${f.join(',')}` : '';
  };
  return { luts, lutFilter: (assetId) => `${luts.has(assetId) ? `,lut3d=file='${luts.get(assetId)}':interp=tetrahedral` : ''}${texFilter(assetId)}` };
}

/** Tamanho de entrega do export (lado curto 1080), o mesmo para o render e para o quadro de conferência. */
export function deliverySize(tl: Pick<Project['timeline'], 'width' | 'height'>): { W: number; H: number } {
  const k = Math.min(1, DELIVERY_SHORT_SIDE / Math.min(tl.width, tl.height));
  return { W: Math.round((tl.width * k) / 2) * 2, H: Math.round((tl.height * k) / 2) * 2 };
}

/** Faixa de níveis do vídeo: 'pc' (cheia, preto 0, bruto de câmera yuvj) ou 'tv' (limitada, preto 16). */
export type Range = 'pc' | 'tv';

/**
 * Todo trecho da faixa principal sai no mesmo formato e com as mesmas etiquetas de cor, venha de bruto de câmera (yuvj,
 * faixa cheia, sem etiqueta) ou de intermediário ProRes (faixa limitada, bt709). Misturados, o main.mp4 trocava de
 * formato na emenda e o ffmpeg 9 refazia ali o grafo da passada final: o B-roll por cima sumia ou o render travava
 * (CH-0029) e o loudnorm perdia o que segurava, tirando segundos da fala (CH-0030).
 */
export function segmentFormat(range: Range): { filter: string; tags: string[] } {
  return { filter: `scale=out_range=${range},format=yuv420p`, tags: ['-color_range', range, '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'] };
}

/** Faixa de níveis de um arquivo de vídeo (cabeçalho). */
export async function sourceRange(file: string): Promise<Range> {
  const raw = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,color_range', '-of', 'csv=p=0', file]).catch(() => Buffer.from(''))).toString();
  return /yuvj|\bpc\b/.test(raw) ? 'pc' : 'tv';
}

/**
 * Faixa dos trechos de um projeto: a do 1º clipe de vídeo da faixa principal. Projeto só de bruto sai como antes (a
 * escala do /quadro e do QC não muda); o que vier na outra faixa é convertido.
 */
export async function mainRange(p: Pick<Project, 'assets' | 'timeline'>): Promise<Range> {
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  for (const c of p.timeline.main) {
    const a = assets.get(c.cam ?? c.assetId) ?? assets.get(c.assetId);
    if (a?.kind === 'video') return sourceRange(a.path);
  }
  return 'tv';
}

/**
 * Filtro de vídeo de um trecho (puro, testável): velocidade, reframe, zoom fixo ou animado ancorado na altura dos
 * olhos (`framing.y`), tamanho de entrega com a cor, congelamento.
 */
export function segmentVideoFilter(src: Pick<MediaAsset, 'width' | 'height'>, c: Clip, fps: number, W: number, H: number, lut = '', reframe = false): string {
  const sp = clipSpeed(c);
  const framesPlayed = Math.max(1, Math.round(clipPlayed(c) * fps));
  const z0 = c.zoom ?? 1;
  const z1 = c.zoomTo ?? z0;
  const parts: string[] = [];
  if (sp !== 1) parts.push(`setpts=(PTS-STARTPTS)/${sp}`);
  const useReframe = reframe && c.framing?.x !== undefined && !!src.width && !!src.height && src.width / src.height > W / H + 0.02;
  if (useReframe) parts.push(`crop=w='min(iw\\,ih*${(W / H).toFixed(5)})':h=ih:x='(iw-ow)*${c.framing!.x!.toFixed(4)}':y=0`);
  // Âncora vertical do zoom (altura dos olhos): o ponto nessa altura fica parado na tela; sem âncora, o centro.
  const ay = (c.framing?.y ?? 0.5).toFixed(4);
  // Âncora horizontal (CH-0023): fora do reframe, `framing.x` segura o ponto nessa largura parado na tela, como o y.
  const ax = (useReframe ? 0.5 : (c.framing?.x ?? 0.5)).toFixed(4);
  if (z1 !== z0) {
    // Tamanho "contido" da fonte no quadro (o zoompan entrega direto nesse tamanho).
    const ar = useReframe ? W / H : (src.width ?? W) / (src.height ?? H);
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    const sw = even(Math.min(W, H * ar));
    const sh = even(Math.min(H, W / ar));
    // O zoompan (d=1) entrega 1 quadro por quadro de entrada: a fonte entra já no fps da timeline, senão um bruto
    // 23,976 numa timeline 29,97 sai 1,25× mais rápido que o áudio (CH-0017).
    parts.push(`fps=${fps}`);
    parts.push(`zoompan=z='${z0}+(${(z1 - z0).toFixed(4)})*(1-pow(1-min(1\\,on/${framesPlayed})\\,3))':x='(iw-iw/zoom)*${ax}':y='(ih-ih/zoom)*${ay}':d=1:s=${sw}x${sh}:fps=${fps}`);
  } else if (z0 > 1) parts.push(`crop=iw/${z0}:ih/${z0}:x=(iw-ow)*${ax}:y=(ih-oh)*${ay}`);
  // A cor entra depois de reduzir para o tamanho de entrega (mesmo resultado, 4× menos pixels que no 4K).
  parts.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease${lut},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`);
  if (c.freeze) parts.push(`tpad=stop_mode=clone:stop_duration=${c.freeze}`);
  return parts.join(',');
}

/**
 * Camada de texto (ARGB) sobre o vídeo. Em YUV 4:4:4: com `format=auto` o overlay levava o quadro inteiro para RGBA e
 * de volta, e toda a imagem embaixo (bruto, B-roll, motion) saía com o verde +2 e o azul −1 (CH-0015).
 */
export const TEXT_OVERLAY = 'overlay=0:0:format=yuv444:eof_action=pass';

/**
 * Janela de um overlay de imagem no grid de quadros da timeline (CH-0008): do quadro round(início·fps) até o quadro
 * antes de round(fim·fps), com a fronteira no meio do quadro. Overlays encostados (fim de um = início do outro)
 * dividem os quadros sem vão nem sobreposição. `at` = início do stream no quadro exato.
 */
export function overlayFrames(start: number, end: number, fps: number): { f0: number; f1: number; at: number; enable: string } {
  const f0 = Math.round(start * fps);
  const f1 = Math.max(f0 + 1, Math.round(end * fps));
  return { f0, f1, at: f0 / fps, enable: `gte(t,${((f0 - 0.5) / fps).toFixed(6)})*lt(t,${((f1 - 0.5) / fps).toFixed(6)})` };
}

/**
 * Um trecho de vídeo com número exato de quadros, já no tamanho de entrega. Aqui entram: velocidade (setpts),
 * reframe em volta do rosto, zoom fixo (crop) ou animado (zoompan, ease-out), congelamento (tpad) e a 2ª câmera
 * (mesmo trecho, deslocado pelo `syncOffset`).
 */
export async function segmentVideo(a: MediaAsset, c: Clip, frames: number, fps: number, W: number, H: number, out: string, lut = '', reframe = false, cam?: MediaAsset, range: Range = 'tv'): Promise<void> {
  const src = cam ?? a;
  const off = cam ? (cam.syncOffset ?? 0) : 0;
  const fmt = segmentFormat(range);
  const vf = `${segmentVideoFilter(src, c, fps, W, H, lut, reframe)},${fmt.filter}`;
  const limit = c.freeze ? ['-t', String(c.out - c.in + 0.05)] : [];
  const want = Math.max(1, frames);
  const base = ['-y', '-v', 'error', '-ss', String(c.in + off), ...limit, '-i', src.path, '-frames:v', String(want), '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', ...fmt.tags, '-r', String(fps), out];
  await encodeExactFrames([['-hwaccel', 'videotoolbox', ...base], base], out, want);
}

/** Duração do arquivo (s) pelo cabeçalho. */
export async function fileDuration(file: string): Promise<number> {
  const raw = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number.parseFloat(raw.toString().trim()) || 0;
}

/**
 * Loudnorm da mixagem numa passada própria, uma entrada e uma saída (CH-0030), e a mix conferida: se sair mais curta
 * que a peça, o render falha com a medida em vez de entregar o fim mudo (o `apad` da entrega esconderia a falta).
 */
export async function normalizeMix(premix: string, out: string, total: number): Promise<void> {
  await run('ffmpeg', ['-y', '-v', 'error', '-i', premix, '-af', `${LOUDNORM},aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo`, '-c:a', 'pcm_f32le', '-t', String(total), out]);
  const got = await fileDuration(out);
  if (got < total - MIX_SLACK) throw new Error(`mixagem saiu com ${got.toFixed(2)} s, a peça tem ${total.toFixed(2)} s`);
}

/** Folga aceita entre a mix e a peça (s): o loudnorm pode devolver uns 40 ms a menos no fim; o defeito era de segundos. */
const MIX_SLACK = 0.1;

/** Quadros de vídeo gravados no cabeçalho do arquivo (sem decodificar). */
export async function countFrames(file: string): Promise<number> {
  const raw = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', file]);
  return Number.parseInt(raw.toString().trim(), 10) || 0;
}

/**
 * Tenta cada linha de argumentos do ffmpeg até uma sair sem erro E com os `frames` quadros pedidos. O decodificador de
 * hardware (videotoolbox) às vezes falha em alguns quadros de um bruto, descarta-os e mesmo assim sai com código 0: o
 * trecho ficava mais curto e a faixa de vídeo inteira terminava antes do áudio (CH-0027, 7 quadros a menos no C3030).
 * A última tentativa vale como está.
 */
export async function encodeExactFrames(attempts: string[][], out: string, frames: number, exec: (cmd: string, args: string[]) => Promise<unknown> = run, count: (file: string) => Promise<number> = countFrames): Promise<void> {
  for (let i = 0; i < attempts.length; i++) {
    const last = i === attempts.length - 1;
    try {
      await exec('ffmpeg', attempts[i]!);
    } catch (e) {
      if (last) throw e;
      continue;
    }
    if (last || (await count(out).catch(() => 0)) >= frames) return;
  }
}

/** Um trecho de áudio em WAV 48 kHz com micro-fade nas pontas (emenda sem estalo); velocidade sem mudar o tom; silêncio no congelamento. */
async function segmentAudio(a: MediaAsset, c: Clip, out: string, clean: string | null): Promise<void> {
  const d = clipDuration(c);
  const sp = clipSpeed(c);
  const played = clipPlayed(c);
  if (!a.hasAudio) {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(d), '-c:a', 'pcm_s16le', out]);
    return;
  }
  // atempo aceita 0,5–2 por estágio: encadeia para fora dessa faixa.
  const tempo: string[] = [];
  let r = sp;
  while (r > 2) ((tempo.push('atempo=2')), (r /= 2));
  while (r < 0.5) ((tempo.push('atempo=0.5')), (r *= 2));
  if (Math.abs(r - 1) > 1e-6) tempo.push(`atempo=${r}`);
  const af = ['aformat=sample_rates=48000:channel_layouts=stereo', ...tempo, 'apad', `atrim=duration=${d}`, `afade=t=in:d=${FADE}`, `afade=t=out:st=${Math.max(0, played - FADE)}:d=${FADE}`].join(',');
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(c.in), '-i', clean ?? a.path, '-t', String(c.out - c.in), '-vn', '-af', af, '-c:a', 'pcm_s16le', out]);
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'projeto';
}

/** B-roll que preenche o quadro: recorte central, ou o enquadramento (centro e zoom) do overlay (CH-0003). */
export function coverFilter(a: Pick<MediaAsset, 'width' | 'height'>, W: number, H: number, framing?: Parameters<typeof coverCrop>[4]): string {
  if (!framing || !a.width || !a.height) return `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const c = coverCrop(a.width, a.height, W, H, framing);
  const f = (n: number) => n.toFixed(5);
  return `crop=w='iw*${f(c.kx)}':h='ih*${f(c.ky)}':x='iw*${f(c.u0)}':y='ih*${f(c.v0)}',scale=${W}:${H}`;
}

/** Encaixe de um overlay de imagem no quadro: motion do Studio (alfa) sem cortar, fundo transparente; B-roll preenche e leva a cor. */
export function overlayFit(a: Pick<MediaAsset, 'id' | 'width' | 'height' | 'alpha'>, W: number, H: number, framing: Parameters<typeof coverCrop>[4], lutFilter: (assetId: string) => string): string {
  if (a.alpha) return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,format=yuva420p`;
  return `${coverFilter(a, W, H, framing)}${lutFilter(a.id)}`;
}

/**
 * Trecho da fonte de um B-roll no tempo da timeline: com velocidade (setpts) e congelamento do último quadro
 * (tpad clone) — CH-0004. Sem os dois, o mesmo filtro de antes.
 */
export function overlayTiming(o: Parameters<typeof overlayPlayback>[0], srcIn: number, start: number, d: number): string {
  const pb = overlayPlayback(o);
  if (pb.speed === 1 && pb.frozen === 0) return `trim=start=${srcIn}:end=${srcIn + d},setpts=PTS-STARTPTS+${start}/TB`;
  const moving = Math.min(pb.moving, d);
  const hold = Math.max(0, d - moving);
  const r = (n: number) => Number(n.toFixed(4));
  const pts = pb.speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${r(pb.speed)}`;
  // Clona o último quadro também sem congelamento: fonte que acaba um quadro antes não mostra a fala por baixo.
  const pad = `,tpad=stop_mode=clone:stop_duration=${r(hold + 0.1)}`;
  return `trim=start=${r(srcIn)}:end=${r(srcIn + moving * pb.speed)},${pts}${pad},setpts=PTS+${start}/TB`;
}
