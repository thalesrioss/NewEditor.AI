/**
 * Leitura dos proxies por partes (HTTP Range) + decodificação por WebCodecs (ADR-005).
 */
import { findMoov, parseMp4, sampleIndexAt as indexAt, videoSampleAt, type Mp4Sample, type Mp4Track } from '@neweditor/core';

export const webcodecsAvailable = () => typeof VideoDecoder !== 'undefined' && typeof AudioDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';

/** Um proxy MP4: índice (moov) lido uma vez, amostras buscadas sob demanda. */
export class MediaFile {
  tracks: Mp4Track[] = [];
  readonly ready: Promise<void>;
  constructor(readonly url: string) {
    this.ready = this.open();
  }
  private async range(start: number, end: number): Promise<Uint8Array> {
    const r = await fetch(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (!r.ok) throw new Error(`proxy ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  private async open(): Promise<void> {
    const head = await this.range(0, 131072);
    const m = findMoov(head);
    if (!m) throw new Error('proxy sem índice no começo (faststart)');
    const moov = m.offset + m.size <= head.length ? head.slice(m.offset, m.offset + m.size) : await this.range(m.offset, m.offset + m.size);
    this.tracks = parseMp4(moov);
  }
  get video(): Mp4Track | undefined {
    return this.tracks.find((t) => t.kind === 'video');
  }
  get audio(): Mp4Track | undefined {
    return this.tracks.find((t) => t.kind === 'audio');
  }
  /** Bytes de várias amostras numa requisição só (do primeiro ao último byte). */
  async bytes(list: Mp4Sample[]): Promise<Uint8Array[]> {
    if (!list.length) return [];
    let a = Infinity;
    let b = 0;
    for (const s of list) {
      a = Math.min(a, s.offset);
      b = Math.max(b, s.offset + s.size);
    }
    const buf = await this.range(a, b);
    return list.map((s) => buf.subarray(s.offset - a, s.offset - a + s.size));
  }
}

/**
 * Vídeo de um arquivo: devolve o QUADRO EXATO de qualquer instante. Tocando, vai decodificando à frente;
 * pulando, recomeça no quadro-chave anterior (os proxies têm um a cada 0,25 s, então é rápido).
 */
export class VideoStream {
  private dec: VideoDecoder | null = null;
  private frames: VideoFrame[] = [];
  private next = 0;
  private feeding = false;
  private want = 0;
  private gen = 0;
  private broken = false;
  constructor(
    private file: MediaFile,
    private track: Mp4Track,
    private onFrame: () => void,
  ) {}

  private decoder(): VideoDecoder {
    if (this.dec && this.dec.state === 'configured') return this.dec;
    if (!this.dec || this.dec.state === 'closed') {
      this.dec = new VideoDecoder({
        output: (f) => this.push(f),
        error: (e) => {
          console.warn('VideoDecoder', e);
          this.broken = true;
        },
      });
    }
    this.dec.configure({ codec: this.track.codec, codedWidth: this.track.width, codedHeight: this.track.height, description: this.track.description, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' });
    return this.dec;
  }

  private push(f: VideoFrame): void {
    this.frames.push(f);
    this.frames.sort((a, b) => a.timestamp - b.timestamp);
    this.prune();
    this.onFrame();
  }

  /** Fecha quadros que já passaram (mantém o melhor ≤ alvo) — VideoFrame segura memória de GPU. */
  private prune(): void {
    const t = this.want * 1e6 + 500;
    let keep = -1;
    for (let i = 0; i < this.frames.length; i++) if (this.frames[i]!.timestamp <= t) keep = i;
    if (keep > 0) for (const f of this.frames.splice(0, keep)) f.close();
    while (this.frames.length > 48) this.frames.pop()!.close();
  }

  private reset(at: number): void {
    this.gen++;
    for (const f of this.frames) f.close();
    this.frames = [];
    if (this.dec && this.dec.state !== 'closed') this.dec.reset();
    let k = at;
    while (k > 0 && !this.track.samples[k]!.key) k--;
    this.next = k;
  }

  /** Melhor quadro para o instante `t` (s, no tempo do arquivo). Também dispara a decodificação. */
  frameAt(t: number, ahead = 8): VideoFrame | null {
    if (this.broken) return null;
    // Antes do 1º quadro do proxy (ex.: 0:00 com pts 0,021 s), vale o 1º quadro — senão o player abre preto.
    const at = videoSampleAt(this.track.samples, t);
    t = at.t;
    this.want = t;
    const k = at.index;
    if (k < 0) return null;
    const first = this.frames[0];
    const behind = first && first.timestamp > this.track.samples[k]!.pts * 1e6 + 500;
    // Voltou no tempo, ou pulou para longe: recomeça do quadro-chave anterior.
    if (behind || k < this.next - 60 || k > this.next + 48) this.reset(k);
    else if (!this.frames.length && this.next > k + 1) this.reset(k);
    void this.pump(k + ahead);
    const tu = t * 1e6 + 500;
    let best: VideoFrame | null = null;
    for (const f of this.frames) if (f.timestamp <= tu) best = f;
    return best;
  }

  private async pump(until: number): Promise<void> {
    if (this.feeding) return;
    const s = this.track.samples;
    until = Math.min(until, s.length - 1);
    if (this.next > until) return;
    this.feeding = true;
    const g = this.gen;
    try {
      const batch = s.slice(this.next, Math.min(until + 1, this.next + 24));
      const data = await this.file.bytes(batch);
      if (g !== this.gen) return;
      const d = this.decoder();
      batch.forEach((smp, i) => d.decode(new EncodedVideoChunk({ type: smp.key ? 'key' : 'delta', timestamp: Math.round(smp.pts * 1e6), duration: Math.round(smp.dur * 1e6), data: data[i]! })));
      this.next += batch.length;
      // Fim do arquivo: libera o que ficou no decodificador.
      if (this.next >= s.length) await d.flush().catch(() => undefined);
    } catch (e) {
      console.warn('VideoStream', e);
    } finally {
      this.feeding = false;
    }
    if (g === this.gen) void this.pump(indexAt(s, this.want) + 8);
  }

  close(): void {
    this.gen++;
    for (const f of this.frames) f.close();
    this.frames = [];
    if (this.dec && this.dec.state !== 'closed') this.dec.close();
  }
}

interface PcmBlock {
  start: number;
  data: Float32Array[];
}

/** Áudio de um arquivo, decodificado em blocos de 2 s (com uma amostra de pré-rolagem para o AAC). */
export class AudioStream {
  private blocks = new Map<number, Promise<PcmBlock | null>>();
  readonly sampleRate: number;
  readonly channels: number;
  constructor(
    private file: MediaFile,
    private track: Mp4Track,
  ) {
    this.sampleRate = track.sampleRate ?? 48000;
    this.channels = Math.min(2, track.channels ?? 2);
  }

  private block(b: number): Promise<PcmBlock | null> {
    let p = this.blocks.get(b);
    if (!p) {
      p = this.decodeBlock(b);
      this.blocks.set(b, p);
      // Memória: guarda ~80 s decodificados.
      if (this.blocks.size > 40) this.blocks.delete(this.blocks.keys().next().value!);
    }
    return p;
  }

  private async decodeBlock(b: number): Promise<PcmBlock | null> {
    const s = this.track.samples;
    const i0 = indexAt(s, b * 2);
    const i1 = indexAt(s, b * 2 + 2 - 1e-6);
    if (i1 < 0) return null;
    const from = Math.max(0, i0);
    const pre = from > 0 ? 1 : 0;
    const list = s.slice(from - pre, i1 + 1);
    const data = await this.file.bytes(list);
    const out: AudioData[] = [];
    const dec = new AudioDecoder({ output: (a) => out.push(a), error: (e) => console.warn('AudioDecoder', e) });
    dec.configure({ codec: this.track.codec, sampleRate: this.sampleRate, numberOfChannels: this.track.channels ?? 2, description: this.track.description });
    list.forEach((smp, i) => dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(smp.pts * 1e6), duration: Math.round(smp.dur * 1e6), data: data[i]! })));
    await dec.flush();
    dec.close();
    const kept = out.filter((a) => a.timestamp >= Math.round(s[from]!.pts * 1e6) - 100);
    for (const a of out) if (!kept.includes(a)) a.close();
    const total = kept.reduce((n, a) => n + a.numberOfFrames, 0);
    const chans = Array.from({ length: this.channels }, () => new Float32Array(total));
    let off = 0;
    for (const a of kept) {
      for (let c = 0; c < this.channels; c++) {
        const plane = new Float32Array(a.numberOfFrames);
        a.copyTo(plane, { planeIndex: Math.min(c, a.numberOfChannels - 1), format: 'f32-planar' });
        chans[c]!.set(plane, off);
      }
      off += a.numberOfFrames;
      a.close();
    }
    return { start: s[from]!.pts, data: chans };
  }

  /** PCM exato do trecho [t0, t1) do arquivo. */
  async range(t0: number, t1: number): Promise<Float32Array[] | null> {
    // Índices de amostra ABSOLUTOS: pedaços vizinhos dividem exatamente a mesma fronteira (sem sobra nem buraco).
    const sr = this.sampleRate;
    const i0 = Math.round(t0 * sr);
    const n = Math.max(0, Math.round(t1 * sr) - i0);
    if (!n) return null;
    const out = Array.from({ length: this.channels }, () => new Float32Array(n));
    for (let b = Math.floor(t0 / 2); b * 2 < t1; b++) {
      const blk = await this.block(b);
      if (!blk) continue;
      // Copia a interseção do bloco com o pedido.
      const blkLen = blk.data[0]!.length;
      const bs = Math.round(blk.start * sr);
      const srcFrom = Math.max(0, i0 - bs);
      const dstFrom = Math.max(0, bs - i0);
      const len = Math.min(blkLen - srcFrom, n - dstFrom);
      if (len <= 0) continue;
      for (let c = 0; c < this.channels; c++) out[c]!.set(blk.data[c]!.subarray(srcFrom, srcFrom + len), dstFrom);
    }
    return out;
  }
}
