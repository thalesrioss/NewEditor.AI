import fs from 'node:fs/promises';
import { cineproCube } from './cinepro.ts';
import os from 'node:os';
import path from 'node:path';
import { buildCues, buildLut, clipPlayed, coverCrop, framingRampWindow, overlayPlayback, clipSpeed, FLASH_FRAMES, flashShutterCues, MOTION_SFX_TRACK, overlayActive, overlaysInDrawOrder, trackFlag, letteringFromText, clipDuration, clipStarts, isNeutral, lutToCube, resolveOverlay, textureOf, timelineDuration, type Clip, type LetteringSpec, type MediaAsset, type MotionSpec, type Project, type SfxCue, type TextWord } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { ROOT } from './config.ts';
import { cleanMaster, syncVoiceClean } from './denoise.ts';
import { DELIVERY, deliverAudio } from './loudness.ts';
import { atomic, run, filterGraphArgs } from './media.ts';
import { renderTextLayer } from './textlayer.ts';
import { regionFxGraph } from './region-fx.ts';
import { captionsWithoutWords } from './legenda-vazia.ts';
import { managedGrades } from './color-source.ts';
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
  // fps exato (29,97 = 30000/1001): o tempo de cada quadro no grafo bate com o dos trechos, senão o 1º quadro de um
  // B-roll chegava microssegundos depois do quadro da fala e ela aparecia nele (CH-0008).
  const fps = exactFps(tl.fps || 30);
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
    // Color management por clipe (como o DaVinci): a entrada sai do arquivo (XML da câmera), LOG converte sempre.
    const managed = await managedGrades(p);
    notes.push(...managed.notes);
    const { luts, lutFilter } = await gradeFilters(managed.grades, work);

    // --- 1. Trechos ---------------------------------------------------------------------------
    const starts = clipStarts(tl);
    const frameAt = (t: number) => Math.round(t * fps);
    const jobs = clips.map((c, i) => ({ c, i, a: assets.get(c.assetId)!, frames: frameAt(starts[i]! + clipDuration(c)) - frameAt(starts[i]!) }));
    let done = 0;
    const tick = () => onProgress?.(Math.min(0.85, (++done / (jobs.length * (hasVideo ? 2 : 1))) * 0.85));

    await pool(jobs, PARALLEL, async ({ c, i, a, frames }) => {
      const seg = (ext: string) => path.join(work, `${String(i).padStart(4, '0')}.${ext}`);
      if (hasVideo) {
        const cam = c.cam ? assets.get(c.cam) : undefined;
        await segmentVideo(a, c, frames, fps, W, H, seg('mov'), lutFilter(camLut(a.id, cam?.id, luts, managed.colors)), !!tl.reframe, cam);
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
    const mainV = path.join(work, 'main.mov');
    if (hasVideo) await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', await list('mov'), '-c', 'copy', mainV]);
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
      parts.push(`color=c=0x0b0d12:s=${W}x${H}:r=${fpsRational(fps)},trim=duration=${total}[bg]`);
      parts.push(`[0:v]scale=${Math.round(W * 0.16)}:-1,format=rgba[logo]`);
      parts.push(`[1:a]asplit=2[a1][awave]`);
      parts.push(`[awave]aformat=channel_layouts=mono,showwaves=s=${waveW}x${waveH}:mode=cline:draw=full:rate=${fpsRational(fps)}:colors=0x4f84ff:scale=sqrt,format=rgba,colorkey=0x000000:0.02:0[wave]`);
      parts.push(`[bg][logo]overlay=(W-w)/2:H*0.34[bg1]`);
      parts.push(`[bg1][wave]overlay=(W-w)/2:H*0.48:shortest=1,format=yuv420p[v0]`);
    }
    // Com fala em vídeo, a imagem base é a própria entrada 0; overlays encadeiam a partir dela.
    let vCur = hasVideo ? '0:v' : 'v0';
    // Efeito por região (CH-0033): na imagem da fala, já com a cor, antes de B-roll, motion, lettering e legenda.
    if (hasVideo && !trackFlag(tl, 'V1', 'hidden')) {
      const rfx = regionFxGraph(tl, W, H, fps, vCur);
      if (rfx.parts.length) {
        parts.push(...rfx.parts);
        vCur = rfx.out;
        notes.push(`${tl.regionFx!.length} efeito(s) por região`);
      }
    }
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
    // O obturador só nos flashes com som (flashSfx false = o editor põe a amostra dele no A2).
    const flashCues: { at: number; c: SfxCue }[] = flashShutterCues(tl).map(({ at, cue }) => ({ at, c: cue }));
    // SFX dos motions do Motion Studio (cues do film.js), no tempo da timeline.
    for (const { o, start } of placed) if (o.role === 'motion' && o.source.type === 'media' && o.sfx?.length) for (const c of o.sfx) flashCues.push({ at: start + c.t, c: { ...c, kind: c.kind as 'shutter' } });
    placed.forEach(({ o, a, srcIn, start, end }, n) => {
      const d = end - start;
      if (d <= 0.02) return;
      // Imagem (frame, PNG com alfa, GIF): entra como stream em loop pela duração da camada.
      const idx = inputs.push(a.kind === 'image' ? { path: a.path, pre: ['-loop', '1', '-framerate', fpsRational(fps), '-t', (d + 0.1).toFixed(3)] } : a.path) - 1;
      if ((o.role === 'broll' || o.role === 'motion') && (a.kind === 'video' || a.kind === 'image')) {
        const fit = overlayFit(a, W, H, o.framing, lutFilter);
        const w = overlayFrames(start, end, fps);
        parts.push(`[${idx}:v:0]${overlayTiming(o, srcIn, w.at, d)},${fit},setsar=1,fps=${fpsRational(fps)},tpad=stop_mode=clone:stop_duration=${(2 / fps).toFixed(4)}[ov${n}]`);
        parts.push(`[${vCur}][ov${n}]overlay=enable='${w.enable}':eof_action=pass[vo${n}]`);
        vCur = `vo${n}`;
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
      // Janela com meio quadro de folga dos dois lados: o `between` é fechado nas pontas e pegava o quadro
      // seguinte (t0 + 2/fps), saindo com 3 quadros (FB-0189).
      const meio = 0.5 / fps;
      const en = flashes.map((t) => `between(t\\,${(t - meio).toFixed(4)}\\,${(t + FLASH_FRAMES / fps - meio).toFixed(4)})`).join('+');
      parts.push(`[${vCur}]negate=enable='${en}',hue=s=0:enable='${en}'[vflash]`);
      vCur = 'vflash';
    }
    // Texto por cima de tudo (legenda nunca fica escondida atrás de B-roll).
    const transcripts: Record<string, TextWord[]> = {};
    for (const a of p.assets) if (a.transcript) transcripts[a.id] = (await readTranscript(path.join(dir, a.transcript))).words;
    const cues = tl.captions?.enabled ? buildCues(tl, transcripts, tl.captions) : [];
    const semLegenda = captionsWithoutWords(p, cues.length || (tl.captions?.enabled ? buildCues(tl, transcripts, tl.captions, { includeHidden: true }).length : 0));
    if (semLegenda) notes.push(`ATENÇÃO: ${semLegenda}`);
    const textMov = await renderTextLayer({ W, H, fps, total, cues, captions: tl.captions, letterings, motions }, work, (x) => onProgress?.(0.88 + 0.04 * x));
    if (textMov) {
      const t = inputs.push(textMov) - 1;
      parts.push(`[${vCur}][${t}:v]${TEXT_OVERLAY}[vtext]`);
      vCur = 'vtext';
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
    // Um só encode com perda, aqui: entrega em faixa legal, 4:2:0, matriz bt709 (os trechos chegam em ProRes 10 bits).
    parts.push(`[${vCur}]${DELIVERY_VIDEO_FILTER}[vout]`);
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
    args.push('-map', '[vout]', ...deliveryVideoArgs(fps));
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
    // Conversão pela LUT oficial do fabricante: sem ela no disco, o render falha (não sai LOG lavado em silêncio).
    const inCube = grade.inputLut ? await cineproCube(grade.inputLut.id) : null;
    // Com a LUT oficial, 65 pontos: a composição com a do fabricante (33) não perde a curva nas sombras.
    const n = inCube ? 65 : 33;
    await fs.writeFile(f, lutToCube(buildLut(grade, n, cube, inCube), n));
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
  // LUT em RGB de 16 bits (o bruto LOG de 8 bits não ganha degrau a mais na conversão).
  return { luts, lutFilter: (assetId) => `${luts.has(assetId) ? `,format=gbrp16le,lut3d=file='${luts.get(assetId)}':interp=tetrahedral` : ''}${texFilter(assetId)}` };
}

/**
 * De quem é a cor do trecho com 2ª câmera: a da câmera quando ela tem grade ou cor lida do arquivo; a da fala só quando a
 * fala não é LOG lida do arquivo (projeto antigo, mesma câmera graduada uma vez). Câmera Rec.709 sob fala S-Log3 não
 * pode receber a conversão da fala.
 */
export function camLut(falaId: string, camId: string | undefined, luts: Map<string, string>, colors: Map<string, unknown>): string {
  if (!camId) return falaId;
  return luts.has(camId) || colors.has(camId) || colors.has(falaId) ? camId : falaId;
}

/** Tamanho de entrega do export (lado curto 1080), o mesmo para o render e para o quadro de conferência. */
export function deliverySize(tl: Pick<Project['timeline'], 'width' | 'height'>): { W: number; H: number } {
  const k = Math.min(1, DELIVERY_SHORT_SIDE / Math.min(tl.width, tl.height));
  return { W: Math.round((tl.width * k) / 2) * 2, H: Math.round((tl.height * k) / 2) * 2 };
}

/** Faixa de níveis do vídeo: 'pc' (cheia, preto 0, bruto de câmera yuvj) ou 'tv' (limitada, preto 16). */
export type Range = 'pc' | 'tv';

/** Matriz bt709 dita só para fonte HD sem etiqueta (ou bt709): arquivo marcado bt601/bt2020 segue a etiqueta dele. */
export const forceBt709 = (a: Pick<MediaAsset, 'height' | 'matrix'>): boolean => (a.height ?? 1080) >= 720 && (!a.matrix || a.matrix === 'bt709');

/** Etiquetas de cor da entrega e dos trechos: faixa legal, Rec.709 nas três (matriz, primárias, transferência). */
export const BT709_TV_TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

/**
 * Todo trecho da faixa principal sai no mesmo formato e com as mesmas etiquetas de cor, venha de bruto de câmera (yuvj,
 * faixa cheia, sem etiqueta) ou de intermediário ProRes (faixa limitada, bt709). Misturados, o main trocava de
 * formato na emenda e o ffmpeg 9 refazia ali o grafo da passada final: o B-roll por cima sumia ou o render travava
 * (CH-0029) e o loudnorm perdia o que segurava, tirando segundos da fala (CH-0030). Sempre faixa legal (a de entrega;
 * herdar a do 1º clipe deu 9 reels pc e 11 tv na mesma série, FB-0180) e 4:2:2 10 bits: o trecho é intermediário
 * (ProRes 422 HQ), o único encode com perda é o da entrega.
 */
export function segmentFormat(): { filter: string; tags: string[] } {
  return { filter: `scale=out_range=tv:out_color_matrix=bt709,format=yuv422p10le,${BT709_PARAMS}`, tags: BT709_TV_TAGS };
}

/** Trecho intermediário: ProRes 422 HQ 10 bits (sem perda visível; o x264 veryfast crf 17 era uma 2ª geração). */
export const SEGMENT_CODEC = ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'];

/**
 * Etiquetas no próprio quadro: o ffmpeg 7+ leva as do quadro ao encoder por cima das opções `-color_*` (sem isto,
 * primárias e transferência saíam `unknown`, como nas 55 entregas medidas).
 */
export const BT709_PARAMS = 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709';

/** Passada final → entrega: faixa legal (superbranco de câmera e realce do lanczos cortados em 16–235), 4:2:0 8 bits, matriz bt709, escala lanczos. */
export const DELIVERY_VIDEO_FILTER = `scale=flags=lanczos:out_range=tv:out_color_matrix=bt709,format=yuv420p,lutyuv=y='clip(val,16,235)':u='clip(val,16,240)':v='clip(val,16,240)',${BT709_PARAMS}`;

/**
 * fps da timeline → o nominal exato: 29,97 → 30000/1001; celular de fps variável (30,011, 29,981) → o nominal mais perto
 * (até 0,05), senão a entrega sairia 30011/1000.
 */
export function exactFps(fps: number): number {
  for (const base of [24, 30, 60, 120]) if (Math.abs(fps - (base * 1000) / 1001) < 0.005) return (base * 1000) / 1001;
  for (const base of [24, 25, 30, 50, 60, 120]) if (Math.abs(fps - base) < 0.05) return base;
  for (const base of [24, 30, 60]) if (Math.abs(fps - (base * 1000) / 1001) < 0.05) return (base * 1000) / 1001;
  return fps;
}

/** fps da timeline como fração exata (29,97 → 30000/1001): `-r 29.97` gravava 2997/100. */
export function fpsRational(fps: number): string {
  fps = exactFps(fps);
  for (const base of [24, 30, 60, 120]) if (Math.abs(fps - (base * 1000) / 1001) < 0.005) return `${base * 1000}/1001`;
  return Number.isInteger(fps) ? String(fps) : String(Math.round(fps * 1000) / 1000);
}

/**
 * O único encode com perda (FB-0180 A2): x264 High 4.2 slow, crf 16 com teto de 25 Mb/s, aq-mode 3 (degradê de parede e
 * pele), CFR no fps exato, as quatro etiquetas bt709/tv. Os aprovados do cliente são yuv420p/tv/bt709.
 */
export function deliveryVideoArgs(fps: number): string[] {
  return ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-crf', '16', '-maxrate', '25M', '-bufsize', '50M', '-profile:v', 'high', '-level:v', '4.2', '-x264-params', 'aq-mode=3', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', fpsRational(fps), ...BT709_TV_TAGS];
}

/** Faixa de níveis de um arquivo de vídeo (cabeçalho). */
export async function sourceRange(file: string): Promise<Range> {
  const raw = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,color_range', '-of', 'csv=p=0', file]).catch(() => Buffer.from(''))).toString();
  return /yuvj|\bpc\b/.test(raw) ? 'pc' : 'tv';
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
  // Rampa de enquadramento (CH-0036): a âncora anda de `framing` até `framingTo` dentro da janela, quadro a quadro.
  const ramp = framingRampWindow(c);
  const rampTo = (a: string, b: number | undefined): string => {
    if (!ramp || b === undefined || Number(a) === b) return a;
    const f0 = (ramp.start * fps).toFixed(3);
    const fd = Math.max(1, ramp.dur * fps).toFixed(3);
    const p = `min(1\\,max(0\\,(on-${f0})/${fd}))`;
    const e = c.framingTo?.ease === 'linear' ? p : `(1-pow(1-${p}\\,3))`;
    return `(${a}+(${(b - Number(a)).toFixed(4)})*${e})`;
  };
  const rx = useReframe ? ax : rampTo(ax, c.framingTo?.x);
  const ry = rampTo(ay, c.framingTo?.y);
  if (z1 !== z0 || rx !== ax || ry !== ay) {
    // Tamanho "contido" da fonte no quadro (o zoompan entrega direto nesse tamanho).
    const ar = useReframe ? W / H : (src.width ?? W) / (src.height ?? H);
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    const sw = even(Math.min(W, H * ar));
    const sh = even(Math.min(H, W / ar));
    // O zoompan (d=1) entrega 1 quadro por quadro de entrada: a fonte entra já no fps da timeline, senão um bruto
    // 23,976 numa timeline 29,97 sai 1,25× mais rápido que o áudio (CH-0017).
    parts.push(`fps=${fpsRational(fps)}`);
    parts.push(`zoompan=z='${z0}+(${(z1 - z0).toFixed(4)})*(1-pow(1-min(1\\,on/${framesPlayed})\\,3))':x='(iw-iw/zoom)*${rx}':y='(ih-ih/zoom)*${ry}':d=1:s=${sw}x${sh}:fps=${fpsRational(fps)}`);
  } else if (z0 > 1) parts.push(`crop=iw/${z0}:ih/${z0}:x=(iw-ow)*${ax}:y=(ih-oh)*${ay}`);
  // A cor entra depois de reduzir para o tamanho de entrega (mesmo resultado, 4× menos pixels que no 4K). Lanczos, e a
  // matriz bt709 dita: o bruto de câmera vem sem etiqueta e o padrão do swscale (bt601) puxava a pele para o verde.
  const matrix = forceBt709(src) ? ':in_color_matrix=bt709' : '';
  parts.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos${matrix}${lut},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fpsRational(fps)}`);
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
export async function segmentVideo(a: MediaAsset, c: Clip, frames: number, fps: number, W: number, H: number, out: string, lut = '', reframe = false, cam?: MediaAsset): Promise<void> {
  const src = cam ?? a;
  const off = cam ? (cam.syncOffset ?? 0) : 0;
  const fmt = segmentFormat();
  const vf = `${segmentVideoFilter(src, c, fps, W, H, lut, reframe)},${fmt.filter}`;
  const limit = c.freeze ? ['-t', String(c.out - c.in + 0.05)] : [];
  const want = Math.max(1, frames);
  // Decodificação na CPU: o VideoToolbox perdia quadros sem erro (CH-0027, 7-8 quadros no 04 v1) e a contagem não
  // pega quadro trocado. `out` em .mov (ProRes).
  const base = ['-y', '-v', 'error', '-ss', String(c.in + off), ...limit, '-i', src.path, '-frames:v', String(want), '-vf', vf, '-an', ...SEGMENT_CODEC, ...fmt.tags, '-r', fpsRational(fps), out];
  await encodeExactFrames([base], out, want);
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
  // `asetpts=N/SR/TB`: o loudnorm do ffmpeg 9 solta o último bloco curto (10 ms) mas avança o relógio 100 ms; o `-t`
  // corta pelo relógio e jogava fora os últimos ~90 ms de som real, completados com silêncio na entrega (CH-0037).
  await run('ffmpeg', ['-y', '-v', 'error', '-i', premix, '-af', `${LOUDNORM},asetpts=N/SR/TB,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo`, '-c:a', 'pcm_f32le', '-t', String(total), out]);
  const got = await fileDuration(out);
  if (got < total - MIX_SLACK) throw new Error(`mixagem saiu com ${got.toFixed(2)} s, a peça tem ${total.toFixed(2)} s`);
}

/**
 * Folga aceita entre a mix e a peça (s): até ~1 quadro. Era 0,1 s porque o loudnorm "devolvia uns 40-90 ms a menos",
 * mas isso era o relógio do último bloco (CH-0037), já corrigido acima; a folga larga escondia o fim mudo.
 */
const MIX_SLACK = 0.035;

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
  // Lanczos e matriz bt709 dita, como na fala (B-roll de câmera vem sem etiqueta; o padrão bt601 esverdeia).
  const sc = `flags=lanczos${forceBt709(a) ? ':in_color_matrix=bt709' : ''}`;
  if (!framing || !a.width || !a.height) return `scale=${W}:${H}:force_original_aspect_ratio=increase:${sc},crop=${W}:${H}`;
  const c = coverCrop(a.width, a.height, W, H, framing);
  const f = (n: number) => n.toFixed(5);
  return `crop=w='iw*${f(c.kx)}':h='ih*${f(c.ky)}':x='iw*${f(c.u0)}':y='ih*${f(c.v0)}',scale=${W}:${H}:${sc}`;
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
  // Congelado do começo ao fim (freeze = duração) ou trecho menor que 1 quadro: a janela da fonte pode não ter
  // quadro nenhum e o B-roll sumia (CH-0032). O primeiro quadro a partir do início sempre entra e é ele que congela.
  const span = moving * pb.speed;
  const cut = `trim=start=${r(srcIn)},setpts=PTS-STARTPTS,trim=end=${r(Math.max(span, 0.001))}`;
  return `${cut},${pts}${pad},setpts=PTS+${start}/TB`;
}
