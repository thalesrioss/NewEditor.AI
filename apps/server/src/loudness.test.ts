/**
 * CH-0007: o render v063 saiu com −15,0 LUFS e −0,9 dBTP medidos no MP4 (o AAC passa o pico da 1ª passada).
 * A entrega precisa de −14 LUFS (±0,5) e ≤ −1 dBTP medidos no arquivo final. Aqui a medida é do `ebur128`
 * (independente do loudnorm, a mesma que o QC usa). Fixtures geradas pelo FFmpeg.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { deliverAudio, fixDeliveredFile, miss } from './loudness.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-loud-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

function fixture(name: string, audio: string, secs = 12): string {
  const f = path.join(tmp, name);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=30', '-f', 'lavfi', '-i', audio, '-t', String(secs), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest', f]);
  return f;
}
/** Fala sintética (harmônicos em sílabas + estalos) passando pelo caminho antigo: loudnorm de uma passada e AAC. */
const fala = "aevalsrc=exprs='(sin(2*PI*140*t)+0.6*sin(2*PI*280*t)+0.4*sin(2*PI*420*t)+0.25*sin(2*PI*1150*t)+0.15*sin(2*PI*2400*t))*0.35*pow(abs(sin(2*PI*2.2*t)),2)*(0.6+0.4*sin(2*PI*0.23*t))+0.9*lt(mod(t,1.7),0.004)*sin(2*PI*900*t)':s=48000:c=stereo,loudnorm=I=-14:TP=-1:LRA=11,aresample=48000";
/** Ruído rosa em rajadas a toda (pior caso: picos densos, o AAC passa o pico de forma irregular). */
const ruido = "anoisesrc=color=pink:amplitude=0.9:seed=7,volume='0.15+0.85*gt(sin(2*PI*1.3*t),0.2)':eval=frame,volume=4dB,alimiter=limit=0.97:level=false";

function ebur128(file: string): { i: number; tp: number } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const n = (re: RegExp) => (re.exec(s)![1] === '-inf' ? -Infinity : Number(re.exec(s)![1]));
  return { i: n(/I:\s+(-inf|-?[\d.]+) LUFS/), tp: n(/Peak:\s+(-inf|-?[\d.]+) dBFS/) };
}
const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]).toString()).streams as { codec_type: string; codec_name: string; duration: string; nb_frames: string }[];

describe('loudness de entrega (CH-0007)', () => {
  const dentro = (m: { i: number; tp: number }) => Math.abs(m.i + 14) <= 0.5 && m.tp <= -1;

  test('caminho antigo reproduz o defeito: o AAC passa o pico de −1 dBTP', () => {
    const m = ebur128(fixture('antigo.mp4', fala));
    assert.ok(!dentro(m), `deveria estar fora do alvo: ${JSON.stringify(m)}`);
  });

  test('render: vídeo + mixagem em WAV saem com −14 LUFS (±0,5) e ≤ −1 dBTP medidos no MP4 codificado; vídeo copiado', async () => {
    const src = fixture('src.mp4', fala);
    const wav = path.join(tmp, 'mix.wav');
    ff(['-i', src, '-map', '0:a', '-c:a', 'pcm_f32le', wav]);
    const out = path.join(tmp, 'entrega.mp4');
    const r = await deliverAudio(src, wav, out, 12);
    const m = ebur128(out);
    assert.ok(r.ok && dentro(m), `fora do alvo: ${JSON.stringify(m)} em ${r.passes} passada(s)`);
    const st = probe(out);
    assert.equal(st.find((s) => s.codec_type === 'video')!.nb_frames, probe(src).find((s) => s.codec_type === 'video')!.nb_frames, 'vídeo copiado, mesmos quadros');
    const a = st.find((s) => s.codec_type === 'audio')!;
    assert.equal(a.codec_name, 'aac');
    assert.ok(Math.abs(Number(a.duration) - 12) < 0.05, `áudio com a duração toda: ${a.duration}`);
  });

  test('MP4 já entregue fora do alvo (o caso do v063): refeito no alvo', async () => {
    const f = fixture('v063.mp4', fala);
    const out = path.join(tmp, 'v063_lufs.mp4');
    const r = await fixDeliveredFile(f, out, 12);
    assert.ok(r.ok && dentro(ebur128(out)), JSON.stringify(ebur128(out)));
  });

  test('pior caso (ruído denso a toda): nunca piora e avisa se não fechar', async () => {
    const f = fixture('ruido.mp4', ruido);
    const antes = ebur128(f);
    const out = path.join(tmp, 'ruido_out.mp4');
    const r = await fixDeliveredFile(f, out, 12);
    const depois = ebur128(out);
    assert.ok(miss(depois) <= miss(antes), `piorou: ${JSON.stringify(antes)} → ${JSON.stringify(depois)}`);
    assert.equal(r.ok, dentro(r.after));
  });

  test('silêncio passa sem ganho e sem erro', async () => {
    const f = fixture('mudo.mp4', 'anullsrc=r=48000:cl=stereo', 3);
    const out = path.join(tmp, 'mudo_out.mp4');
    const r = await fixDeliveredFile(f, out, 3);
    assert.equal(r.passes, 1);
    assert.ok(fs.existsSync(out));
  });
});
