/**
 * B-roll automático (BL-0018 / FB-0019): fora do gancho (nada antes de 3 s), no máximo 4 s e só clipe ≥ 720p.
 * A busca no clip.cafe e as frases são trocadas por fixtures (sem rede, sem LLM); o resto é o caminho real:
 * ingest dos clipes gerados pelo FFmpeg, store, timeline e operações.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resolveOverlay, type Timeline } from '@neweditor/core';
import type { CafeClip } from './cinefilo.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-broll-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const gera = (nome: string, size: string, dur: number) => {
  const f = path.join(tmp, `${nome}.mp4`);
  ff(['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=30`, '-t', String(dur), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f]);
  return f;
};
const cafe = (slug: string, filme: string): CafeClip => ({ slug, link: '', filme, duracao: 5, transcript: slug, poster: '', mp4: '', vtt: undefined });

let projectId = '';
let falaId = '';
const arquivos: Record<string, string> = {};

before(async () => {
  const fala = gera('fala', '320x180', 30);
  arquivos.hd1 = gera('hd1', '1280x720', 5);
  arquivos.hd2 = gera('hd2', '1920x1080', 5);
  arquivos.sd = gera('sd', '640x480', 5);
  const { store } = await import('./store.ts');
  const { ingest } = await import('./ingest.ts');
  await store.load();
  projectId = (await store.create('Teste de B-roll', 'projeto de teste')).id;
  falaId = (await ingest(projectId, fala, 'broll')).id;
  // Três cortes: 0–8, 8–20, 20–30 na timeline (mesmo tempo na fonte).
  store.apply(projectId, {
    by: 'human',
    op: {
      type: 'set_main',
      clips: [
        { id: 'c1', assetId: falaId, in: 0, out: 8, by: 'human' },
        { id: 'c2', assetId: falaId, in: 8, out: 20, by: 'human' },
        { id: 'c3', assetId: falaId, in: 20, out: 30, by: 'human' },
      ],
    },
  });
});
after(async () => {
  await (await import('./store.ts')).store.flush(); // grava o que espera o debounce de 400 ms antes de apagar a pasta
  fs.rmSync(tmp, { recursive: true, force: true });
});

const tl = (main: [number, number][]): Timeline =>
  ({ main: main.map(([i, o], k) => ({ id: `c${k}`, assetId: 'a', in: i, out: o, by: 'human' })), overlays: [] }) as unknown as Timeline;

describe('janelaBroll', () => {
  test('frase no gancho: começa em 3 s, termina no fim do corte, até 4 s', async () => {
    const { janelaBroll } = await import('./broll.ts');
    // Caso do FB-0019: frase de 1 s a 12,8 s num corte que vai até 12,8 s → 8,8–12,8.
    assert.deepEqual(janelaBroll(tl([[0, 12.8], [12.8, 20]]), 1, 12.8, 2), { start: 8.8, duration: 4 });
    // Corte curto dentro do gancho: começa em 3 s e vai até o fim do corte.
    assert.deepEqual(janelaBroll(tl([[0, 6], [6, 20]]), 1, 5.5, 2), { start: 3, duration: 3 });
  });
  test('frase toda dentro do gancho não recebe B-roll', async () => {
    const { janelaBroll } = await import('./broll.ts');
    assert.equal(janelaBroll(tl([[0, 20]]), 0.5, 4.5, 2), null);
  });
  test('fim do corte longe da frase: começa na frase e para em 4 s', async () => {
    const { janelaBroll } = await import('./broll.ts');
    assert.deepEqual(janelaBroll(tl([[0, 30]]), 10, 13, 2), { start: 10, duration: 4 });
  });
  test('altura mínima de 720 px; desconhecida não passa', async () => {
    const { alturaOk } = await import('./broll.ts');
    assert.equal(alturaOk({ height: 720 }), true);
    assert.equal(alturaOk({ height: 480 }), false);
    assert.equal(alturaOk({}), false);
  });
});

describe('autoBroll com fixture', () => {
  test('candidatos em 1 s e 11,8 s e um 480p: só B-roll ≥ 3 s, ≤ 4 s e ≥ 720p', async () => {
    const { autoBroll } = await import('./broll.ts');
    const { ingest } = await import('./ingest.ts');
    const { store } = await import('./store.ts');
    const busca: Record<string, CafeClip[]> = {
      treinar: [cafe('sd', 'Filme SD'), cafe('hd1', 'Filme HD 1')], // o 480p vem primeiro e tem de ser descartado
      dormir: [cafe('hd2', 'Filme HD 2')],
      so480: [cafe('sd', 'Filme SD')], // só candidato baixo: nada entra
    };
    const r = await autoBroll(projectId, {
      cobertura: 0.6,
      deps: {
        beats: async () => [
          { assetId: falaId, start: 1, end: 7.5, fala: 'Oi, esse sou eu e hoje faz 15 dias que voltei a treinar', queries: ['treinar'], motivo: 'tema: treinar' },
          { assetId: falaId, start: 11.8, end: 19, fala: 'e eu tenho dormido muito melhor desde então', queries: ['dormir'], motivo: 'tema: dormir' },
          { assetId: falaId, start: 21, end: 28, fala: 'e isso mudou a forma como eu trabalho', queries: ['so480'], motivo: 'tema: trabalho' },
        ],
        search: async (q) => busca[q] ?? [],
        use: async (id, c) => {
          const f = arquivos[c.slug]!;
          const existing = store.get(id).assets.find((a) => a.path === f);
          return { assetId: (existing ?? (await ingest(id, f, 'broll'))).id };
        },
      },
    });
    const p = store.get(projectId);
    const brolls = p.timeline.overlays.filter((o) => o.role === 'broll');
    assert.equal(r.colocados, 2);
    assert.equal(brolls.length, 2);
    for (const o of brolls) {
      const pos = resolveOverlay(p.timeline, o)!;
      assert.ok(pos.start >= 3, `começa em ${pos.start}`);
      assert.ok(o.duration <= 4, `dura ${o.duration}`);
      const a = p.assets.find((x) => o.source.type === 'media' && x.id === o.source.assetId)!;
      assert.ok((a.height ?? 0) >= 720, `${a.name} tem ${a.height} px`);
    }
    const pos = brolls.map((o) => resolveOverlay(p.timeline, o)!);
    assert.deepEqual(pos.map((x) => [x.start, x.end]), [[4, 8], [16, 20]]);
    assert.deepEqual(r.filmes, ['Filme HD 1', 'Filme HD 2']);
  });
});
