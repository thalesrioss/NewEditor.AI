/**
 * Faixa de SFX dos motions para o export: os mesmos efeitos que o player toca (core/sfx.ts), mixados num WAV
 * estéreo do tamanho da timeline, no nível calibrado pela fala (o loudnorm final sobe tudo junto).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { letteringCues, motionCues, panGains, sfxBusDb, SFX_RATE, shapeSfxSample, speechLevelDb, synthSfx, type LetteringSpec, type MotionSpec, type Project, type SfxBank, type SfxCue } from '@neweditor/core';
import { cineproPick, cineproSample } from './cinepro.ts';
import { readEnvelope } from './media.ts';

/** Nível da fala do projeto (média dos arquivos que estão na trilha principal). */
export async function projectSpeechDb(p: Project, dir: string): Promise<number> {
  const ids = [...new Set(p.timeline.main.map((c) => c.assetId))];
  const levels: number[] = [];
  for (const id of ids) {
    const a = p.assets.find((x) => x.id === id);
    if (a?.envelope) levels.push(speechLevelDb(await readEnvelope(path.join(dir, a.envelope)).catch(() => new Float32Array())));
  }
  return levels.length ? levels.reduce((x, y) => x + y, 0) / levels.length : -24;
}

/** Devolve o caminho de um WAV float estéreo 48 kHz com todos os SFX, ou null se não há nenhum. */
/** Amostra de um efeito: real (CinePRO) quando o banco pede e existe; senão o foley sintetizado. */
async function sampleFor(c: SfxCue, bank: SfxBank): Promise<Float32Array> {
  if (bank === 'cinepro') {
    try {
      const it = await cineproPick(c.kind, c.seed);
      if (it) return shapeSfxSample(await cineproSample(it.id, SFX_RATE), c, SFX_RATE);
    } catch {
      /* sem nuvem / sem acerto: síntese */
    }
  }
  return synthSfx(c);
}

export async function renderSfxTrack(motions: { start: number; end: number; spec: MotionSpec }[], letterings: { start: number; end: number; spec: LetteringSpec }[], total: number, busDb: number, work: string, extra: { at: number; c: SfxCue }[] = [], bank: SfxBank = 'sintetizado'): Promise<string | null> {
  const placed = [
    ...extra,
    ...motions.flatMap((m) => motionCues(m.spec, m.end - m.start).map((c) => ({ at: m.start + c.t, c }))),
    ...letterings.flatMap((l) => letteringCues(l.spec, l.end - l.start).map((c) => ({ at: l.start + c.t, c }))),
  ];
  if (!placed.length) return null;
  const n = Math.ceil(total * SFX_RATE);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const bus = Math.pow(10, busDb / 20);
  for (const { at, c } of placed) {
    const x = await sampleFor(c, bank);
    const [gl, gr] = panGains(c.pan);
    const i0 = Math.round(at * SFX_RATE);
    for (let i = 0; i < x.length && i0 + i < n; i++) {
      L[i0 + i] = L[i0 + i]! + x[i]! * gl * bus;
      R[i0 + i] = R[i0 + i]! + x[i]! * gr * bus;
    }
  }
  // WAV IEEE float 32 bits, estéreo intercalado.
  const data = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i++) {
    data.writeFloatLE(L[i]!, i * 8);
    data.writeFloatLE(R[i]!, i * 8 + 4);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(SFX_RATE, 24);
  head.writeUInt32LE(SFX_RATE * 8, 28);
  head.writeUInt16LE(8, 32);
  head.writeUInt16LE(32, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  const out = path.join(work, 'motion-sfx.wav');
  await fs.writeFile(out, Buffer.concat([head, data]));
  return out;
}

export { sfxBusDb };
