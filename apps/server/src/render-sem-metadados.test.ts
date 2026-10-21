/**
 * BL-0085 (FB-0143): o MP4 entregue saía com o menu de capítulos ("Chapter 13/14") e uma trilha de texto do filme usado
 * como B-roll, e com o título dos insumos. Render de verdade: fala e B-roll com título e capítulos; a saída tem que ter
 * só 1 vídeo e 1 áudio, 0 capítulos e nenhuma tag dos insumos.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-sem-meta-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const fala = path.join(tmp, 'fala.mp4');
const broll = path.join(tmp, 'broll.mp4');
let projectId = '';

/** Metadados no formato ffmetadata: título global, comentário e dois capítulos. */
function meta(title: string): string {
  const f = path.join(tmp, `${title.replace(/\W+/g, '-')}.txt`);
  const ch = (n: number, start: number, end: number) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${end}\ntitle=Chapter ${n}\n`;
  fs.writeFileSync(f, `;FFMETADATA1\ntitle=${title}\ncomment=fonte de teste\n${ch(13, 0, 1500)}${ch(14, 1500, 3000)}`);
  return f;
}

before(async () => {
  ff(['-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=4', '-i', meta('Bruto da fala'), '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fala]);
  ff(['-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30:d=3', '-i', meta('Filme do B-roll'), '-map', '0:v', '-map_metadata', '1', '-map_chapters', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', broll]);
  const { store } = await import('./store.ts');
  await store.load();
  projectId = (await store.create('BL-0085', 'sem metadados herdados')).id;
});
after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const probe = (file: string) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_chapters', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as {
    chapters: unknown[];
    streams: { codec_type: string; tags?: Record<string, string> }[];
    format: { tags?: Record<string, string> };
  };

describe('MP4 entregue sem capítulos nem metadados dos insumos (BL-0085)', () => {
  test('o insumo de teste tem mesmo capítulos e título (senão o teste não prova nada)', () => {
    const b = probe(broll);
    assert.equal(b.chapters.length, 2);
    assert.equal(b.format.tags?.title, 'Filme do B-roll');
    assert.equal(probe(fala).format.tags?.title, 'Bruto da fala');
  });

  test('B-roll com capítulos: a saída tem 0 capítulos, só 1 vídeo e 1 áudio, sem título nem comentário', async () => {
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const { render } = await import('./render.ts');
    const f = await ingest(projectId, fala, 'broll');
    const b = await ingest(projectId, broll, 'broll');
    store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: f.id, in: 0, out: 3, by: 'human' }] } });
    store.apply(projectId, { by: 'human', op: { type: 'set_format', width: 90, height: 160, fps: 30 } });
    const trackId = store.get(projectId).timeline.tracks.find((t) => t.roles.includes('broll'))!.id;
    store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId, role: 'broll', anchor: { assetId: f.id, at: 0.5 }, duration: 1.5, source: { type: 'media', assetId: b.id, in: 0 } } } });
    const res = await render(store.get(projectId), store.dir(projectId));
    const out = probe(path.join(store.dir(projectId), res.file));
    assert.deepEqual(out.chapters, [], 'capítulos do B-roll vazaram para a entrega');
    assert.deepEqual(out.streams.map((s) => s.codec_type).sort(), ['audio', 'video'], `streams além de 1 vídeo e 1 áudio: ${out.streams.map((s) => s.codec_type).join(', ')}`);
    const tags = { ...out.format.tags, ...Object.assign({}, ...out.streams.map((s) => s.tags ?? {})) } as Record<string, string>;
    for (const k of ['title', 'comment']) assert.equal(tags[k], undefined, `tag ${k} do insumo na entrega: ${tags[k]}`);
  });
});
