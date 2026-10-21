/**
 * Motor de preview (ADR-005): um relógio (Web Audio), decodificação por WebCodecs e um compositor WebGL.
 *
 * - Vídeo: em cada quadro da tela, desenha o quadro EXATO da timeline (fala com zoom + B-roll + cor).
 * - Áudio: cada trecho mantido da fala vira um AudioBufferSourceNode agendado no instante exato, com as mesmas
 *   rampas de 5 ms do export — o corte é exato por amostra. Trilha e SFX entram no mesmo relógio, com volume,
 *   fades e o "abaixa quando você fala".
 */
import { clipDuration, clipPlayed, clipSpeed, clipStarts, DEFAULT_MUSIC_MIX, overlayActive, overlaySourceTime, trackFlag, zoomAt, locate, resolveOverlay, timelineDuration, type ColorGrade, type MediaAsset, type Timeline } from '@neweditor/core';
import { Compositor, type Layer } from './compositor.ts';
import { AudioStream, MediaFile, VideoStream } from './media.ts';

const FADE = 0.005;
const LOOKAHEAD = 1.6;
const CHUNK = 1.0;
const MUSIC_GAIN = 0.18;
const DUCK = 0.32;

interface Scheduled {
  node: AudioBufferSourceNode;
  gain: GainNode;
}

export class Engine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private comp: Compositor;
  private files = new Map<string, MediaFile>();
  private videos = new Map<string, VideoStream>();
  private audios = new Map<string, AudioStream>();
  private tl: Timeline | null = null;
  private assets = new Map<string, MediaAsset>();
  private speech: [number, number][] = [];
  private gradeOverride: { assetId: string; grade: ColorGrade } | null = null;
  private showGrade = true;

  private playing = false;
  private pausedAt = 0;
  private t0 = 0;
  private c0 = 0;
  private scheduledTo = 0;
  private sources: Scheduled[] = [];
  private pumpTimer = 0;
  private session = 0;
  /** Chamado quando chega um quadro novo (para redesenhar em pausa). */
  onFrame: () => void = () => undefined;

  constructor(
    canvas: HTMLCanvasElement,
    private urlOf: (a: MediaAsset, tl: Timeline | null) => string | null,
  ) {
    this.comp = new Compositor(canvas);
  }

  get compositor(): Compositor {
    return this.comp;
  }

  /** Timeline nova (corte, overlay, mixagem): em reprodução, reagenda o áudio a partir de agora. */
  setTimeline(tl: Timeline, assets: MediaAsset[], speech: [number, number][]): void {
    let changed = this.tl !== tl;
    this.tl = tl;
    this.assets = new Map(assets.map((a) => [a.id, a]));
    this.speech = speech;
    // Arquivo que trocou de proxy (ex.: voz limpa ficou pronta): esquece o antigo e decodifica o novo.
    for (const [id, f] of [...this.files]) {
      const a = this.assets.get(id);
      if (a && this.urlOf(a, tl) === f.url) continue;
      this.files.delete(id);
      this.videos.get(id)?.close();
      this.videos.delete(id);
      this.audios.delete(id);
      changed = true;
    }
    if (changed && this.playing) this.restartAudio();
  }

  setGrade(override: { assetId: string; grade: ColorGrade } | null, show: boolean): void {
    this.gradeOverride = override;
    this.showGrade = show;
  }

  private file(assetId: string): MediaFile | null {
    let f = this.files.get(assetId);
    if (!f) {
      const a = this.assets.get(assetId);
      const url = a ? this.urlOf(a, this.tl) : null;
      if (!url) return null;
      f = new MediaFile(url);
      f.ready.catch((e) => console.warn('proxy', a?.name, e));
      this.files.set(assetId, f);
    }
    return f;
  }

  private video(assetId: string): VideoStream | null {
    let v = this.videos.get(assetId);
    if (v) return v;
    const f = this.file(assetId);
    if (!f || !f.tracks.length) {
      void f?.ready.then(() => this.onFrame());
      return null;
    }
    if (!f.video) return null;
    v = new VideoStream(f, f.video, () => this.onFrame());
    this.videos.set(assetId, v);
    return v;
  }

  private async audio(assetId: string): Promise<AudioStream | null> {
    let a = this.audios.get(assetId);
    if (a) return a;
    const f = this.file(assetId);
    if (!f) return null;
    await f.ready;
    if (!f.audio) return null;
    a = this.audios.get(assetId) ?? new AudioStream(f, f.audio);
    this.audios.set(assetId, a);
    return a;
  }

  // --- Relógio --------------------------------------------------------------------------------

  get isPlaying(): boolean {
    return this.playing;
  }

  time(): number {
    // Antes do áudio começar (folga de partida), o relógio segura no ponto de partida — nunca anda para trás.
    return this.playing ? this.t0 + Math.max(0, this.ctx.currentTime - this.c0) : this.pausedAt;
  }

  play(at: number): void {
    void this.ctx.resume();
    this.playing = true;
    this.t0 = at;
    this.c0 = this.ctx.currentTime + 0.08; // pequena folga para o primeiro trecho chegar decodificado
    this.restartAudio(false);
  }

  pause(): void {
    if (this.playing) this.pausedAt = Math.max(0, this.time());
    this.playing = false;
    this.stopAudio();
  }

  seek(t: number): void {
    if (this.playing) this.play(t);
    else this.pausedAt = t;
  }

  // --- Vídeo ----------------------------------------------------------------------------------

  /** Desenha o quadro da timeline no instante `t`. Devolve false se ainda falta decodificar algo. */
  draw(t: number): boolean {
    const tl = this.tl;
    if (!tl || !tl.main.length) {
      this.comp.clear();
      return true;
    }
    const layers: Layer[] = [];
    let complete = true;
    const loc = locate(tl, Math.min(t, Math.max(0, timelineDuration(tl) - 0.001)));
    const gradeOf = (assetId: string) => (!this.showGrade ? null : this.gradeOverride?.assetId === assetId ? this.gradeOverride.grade : (tl.grades?.[assetId] ?? null));
    if (loc) {
      // 2ª câmera: mesmo instante, deslocado pelo alinhamento de áudio; a cor é a da fala.
      const cam = loc.clip.cam ? this.assets.get(loc.clip.cam) : undefined;
      const a = cam ?? this.assets.get(loc.clip.assetId);
      if (a?.kind === 'video') {
        const srcT = cam ? loc.sourceTime + (cam.syncOffset ?? 0) : loc.sourceTime;
        const f = this.video(a.id)?.frameAt(srcT, this.playing ? 10 : 2);
        const reframe = !!tl.reframe && loc.clip.framing?.x !== undefined && !!a.width && !!a.height && a.width / a.height > tl.width / tl.height + 0.02;
        if (f) layers.push({ frame: f, fit: reframe ? 'reframe' : 'contain', zoom: zoomAt(loc.clip, loc.local), cx: loc.clip.framing?.x, cy: loc.clip.framing?.y, grade: gradeOf(loc.clip.assetId) });
        else complete = false;
      }
    }
    // B-roll por cima (mesma ordem do export).
    for (const o of tl.overlays) {
      if (o.role !== 'broll' || o.source.type !== 'media' || !overlayActive(tl, o)) continue;
      if (this.assets.get(o.source.assetId)?.kind !== 'video') continue; // imagens: camada DOM (MediaMotionLayer)
      const pos = resolveOverlay(tl, o);
      if (!pos || t < pos.start || t >= pos.end) continue;
      // Velocidade e congelamento (CH-0004): o instante da fonte, preso no último quadro dela.
      const dur = this.assets.get(o.source.assetId)?.duration ?? Infinity;
      const f = this.video(o.source.assetId)?.frameAt(Math.min(overlaySourceTime(o, t - pos.start), dur - 1 / (tl.fps || 30)), this.playing ? 10 : 2);
      if (f) layers.push({ frame: f, fit: 'cover', framing: o.framing, grade: gradeOf(o.source.assetId) });
      else complete = false;
    }
    if (layers.length) this.comp.draw(layers);
    return complete;
  }

  // --- Áudio ----------------------------------------------------------------------------------

  private stopAudio(): void {
    this.session++;
    clearInterval(this.pumpTimer);
    for (const s of this.sources) {
      try {
        s.node.stop();
      } catch {
        /* já parou */
      }
      s.node.disconnect();
      s.gain.disconnect();
    }
    this.sources = [];
  }

  private restartAudio(rebase = true): void {
    if (rebase) {
      // Timeline mudou tocando: continua do mesmo ponto, com 40 ms para o novo áudio chegar.
      this.t0 = this.time();
      this.c0 = this.ctx.currentTime + 0.04;
    }
    this.stopAudio();
    const at = this.t0;
    this.scheduledTo = at;
    void this.scheduleWindow();
    this.pumpTimer = window.setInterval(() => void this.scheduleWindow(), 250);
  }

  /** Agenda tudo o que começa entre o que já foi agendado e agora + LOOKAHEAD. */
  private async scheduleWindow(): Promise<void> {
    const tl = this.tl;
    if (!tl || !this.playing) return;
    const session = this.session;
    const a = this.scheduledTo;
    // Agenda em células de uma grade fixa (CHUNK): poucas emendas, sempre nos mesmos instantes.
    const end = timelineDuration(tl);
    const b = Math.min(end, Math.ceil((this.time() + LOOKAHEAD) / CHUNK) * CHUNK);
    if (b <= a + 1e-4) return;
    this.scheduledTo = b;
    const jobs: Promise<void>[] = [];
    const cell = (x: number, limit: number) => Math.min(limit, (Math.floor(x / CHUNK + 1e-9) + 1) * CHUNK);

    // Fala (trilha principal): cada clipe, em pedaços de CHUNK, com rampa só nas pontas do clipe.
    const starts = clipStarts(tl);
    const speechGain = trackFlag(tl, 'A1', 'muted') ? 0 : 1;
    tl.main.forEach((c, i) => {
      const s = starts[i]!;
      const sp = clipSpeed(c);
      // O áudio toca só na parte que anda (o congelamento é silêncio).
      const e = s + clipPlayed(c);
      if (e <= a || s >= b) return;
      for (let x = Math.max(a, s); x < Math.min(b, e) - 1e-4; ) {
        const y = cell(x, Math.min(b, e));
        jobs.push(this.place(session, c.assetId, c.in + (x - s) * sp, c.in + (y - s) * sp, x, speechGain, x - s < 1e-4, e - y < 1e-4, undefined, sp));
        x = y;
      }
    });

    // Trilha e SFX (A2/A3): volume, fades e ducking sob a fala — o mesmo da mixagem do export.
    for (const o of tl.overlays) {
      if ((o.role !== 'music' && o.role !== 'sfx') || o.source.type !== 'media' || !overlayActive(tl, o)) continue;
      const pos = resolveOverlay(tl, o);
      if (!pos || pos.end <= a || pos.start >= b) continue;
      const mix = o.mix ?? (o.role === 'music' ? DEFAULT_MUSIC_MIX : undefined);
      const gain = mix ? Math.pow(10, mix.gainDb / 20) : o.role === 'music' ? MUSIC_GAIN : 1;
      for (let x = Math.max(a, pos.start); x < Math.min(b, pos.end) - 1e-4; ) {
        const y = cell(x, Math.min(b, pos.end));
        jobs.push(this.place(session, o.source.assetId, o.source.in + (x - pos.start), o.source.in + (y - pos.start), x, gain, false, false, { start: pos.start, end: pos.end, fadeIn: mix?.fadeIn ?? 0, fadeOut: mix?.fadeOut ?? 0, duck: mix?.duck ?? o.role === 'music' }));
        x = y;
      }
    }
    await Promise.all(jobs);
  }

  /** Agenda o trecho [src0, src1) do arquivo para tocar no instante `at` da timeline. */
  private async place(
    session: number,
    assetId: string,
    src0: number,
    src1: number,
    at: number,
    level: number,
    fadeIn: boolean,
    fadeOut: boolean,
    env?: { start: number; end: number; fadeIn: number; fadeOut: number; duck: boolean },
    rate = 1,
  ): Promise<void> {
    const stream = await this.audio(assetId);
    const pcm = stream ? await stream.range(src0, src1) : null;
    if (!pcm || session !== this.session || !this.playing) return;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(pcm.length, pcm[0]!.length, stream!.sampleRate);
    pcm.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
    const node = ctx.createBufferSource();
    node.buffer = buf;
    const g = ctx.createGain();
    node.connect(g).connect(ctx.destination);
    const when = this.c0 + (at - this.t0);
    const bufDur = src1 - src0;
    const dur = bufDur / rate;
    node.playbackRate.value = rate;
    const now = ctx.currentTime;
    // Chegou atrasado (decodificação lenta): entra no meio, sem estalo.
    const late = Math.max(0, now + 0.005 - when);
    if (late >= dur) return;
    const w = when + late;
    const lvl = (tt: number) => {
      // Envelope da trilha: fades da mixagem × ducking quando tem fala.
      if (!env) return level;
      const ttl = at + (tt - when);
      let v = level;
      if (env.fadeIn > 0) v *= Math.min(1, Math.max(0, (ttl - env.start) / env.fadeIn));
      if (env.fadeOut > 0) v *= Math.min(1, Math.max(0, (env.end - ttl) / env.fadeOut));
      if (env.duck && this.speech.some(([s, e]) => ttl >= s - 0.05 && ttl <= e + 0.3)) v *= DUCK;
      return v;
    };
    g.gain.setValueAtTime(fadeIn && !late ? 0 : lvl(w), w);
    if (fadeIn && !late) g.gain.linearRampToValueAtTime(lvl(w + FADE), w + FADE);
    if (env) for (let tt = w + 0.05; tt < when + dur; tt += 0.05) g.gain.linearRampToValueAtTime(lvl(tt), tt);
    if (fadeOut) {
      g.gain.setValueAtTime(lvl(when + dur - FADE), when + dur - FADE);
      g.gain.linearRampToValueAtTime(0, when + dur);
    }
    node.start(w, late * rate, bufDur - late * rate);
    const s = { node, gain: g };
    this.sources.push(s);
    node.onended = () => {
      this.sources = this.sources.filter((x) => x !== s);
      node.disconnect();
      g.disconnect();
    };
  }

  close(): void {
    this.stopAudio();
    for (const v of this.videos.values()) v.close();
    void this.ctx.close();
  }
}
