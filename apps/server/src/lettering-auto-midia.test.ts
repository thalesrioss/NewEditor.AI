/**
 * Lettering automático não apaga lettering de mídia (BL-0173, FB-0214, achado no CH-0046): a Lia monta .mov com
 * alfa na V3 como role `lettering` pela API (`by: 'agent'`). Rodar o lettering automático depois troca só os
 * letterings de texto que ele mesmo gerou; o .mov e o lettering de texto do humano continuam na timeline.
 * Projeto montado à mão (fala sintética), sem FFmpeg nem ASR.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-lt-auto-midia-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
process.env.NEWEDITOR_BRAIN = 'local';

let projectId = '';

const fala =
  'Hoje eu vou mostrar como editar um vídeo inteiro usando inteligência artificial. O segredo é a conversa com o agente. Ele edita ao vivo na sua frente, sem perder o controle do resultado final. Isso muda tudo no seu trabalho. Você economiza horas toda semana.';
const words = fala.split(' ').map((w, i) => ({ w, start: 0.5 + i * 0.4, end: 0.5 + i * 0.4 + 0.35, p: 0.99 }));
const dur = Math.ceil(words.at(-1)!.end + 1);

before(async () => {
  const { store } = await import('./store.ts');
  await store.load();
  const p = await store.create('Lettering automático e lettering de mídia', 'projeto de teste');
  projectId = p.id;
  fs.writeFileSync(path.join(store.dir(p.id), 'transcript.json'), JSON.stringify({ language: 'pt', duration: dur, model: 'fixture', words, segments: [] }));
  store.upsertAsset(p.id, { id: 'a1', name: 'fala.mp4', path: path.join(tmp, 'fala.mp4'), kind: 'video', duration: dur, hasAudio: true, role: 'fala', transcript: 'transcript.json' });
  store.upsertAsset(p.id, { id: 'mov1', name: 'titulo.mov', path: path.join(tmp, 'titulo.mov'), kind: 'video', duration: 3, hasAudio: false });
  store.apply(p.id, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId: 'a1', in: 0, out: dur, by: 'human' }], removals: [] } });
});

after(async () => {
  await (await import('./store.ts')).store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rodar o lettering automático de novo mantém o .mov do agente e o texto do humano, e troca só o texto automático', async () => {
  const { store } = await import('./store.ts');
  const { autoLettering } = await import('./agent-text.ts');

  assert.ok((await autoLettering(projectId, 'muito')) > 0, 'a fala sintética precisa render letterings automáticos');
  const auto = store.get(projectId).timeline.overlays.filter((o) => o.role === 'lettering').map((o) => o.id);
  assert.ok(auto.length > 0);

  store.apply(projectId, { by: 'agent', op: { type: 'add_overlay', item: { trackId: 'V3', role: 'lettering', anchor: { assetId: 'a1', at: 1 }, duration: 3, source: { type: 'media', assetId: 'mov1', in: 0 } } } });
  store.apply(projectId, { by: 'human', op: { type: 'add_overlay', item: { trackId: 'V3', role: 'lettering', anchor: { assetId: 'a1', at: 6 }, duration: 1.5, source: { type: 'text', text: '*segredo*' } } } });
  const mov = store.get(projectId).timeline.overlays.find((o) => o.source.type === 'media');
  const humano = store.get(projectId).timeline.overlays.find((o) => o.by === 'human' && o.role === 'lettering');
  assert.ok(mov && humano);

  await autoLettering(projectId, 'muito');
  const depois = store.get(projectId).timeline.overlays.filter((o) => o.role === 'lettering');
  assert.ok(depois.some((o) => o.id === mov.id), 'o .mov posto como lettering pelo agente continua');
  assert.ok(depois.some((o) => o.id === humano.id), 'o lettering de texto do humano continua');
  assert.ok(!depois.some((o) => auto.includes(o.id)), 'os letterings de texto da rodada anterior foram trocados');
  assert.ok(depois.some((o) => o.by === 'agent' && o.source.type === 'lettering'), 'a rodada nova pôs letterings de texto');
});
