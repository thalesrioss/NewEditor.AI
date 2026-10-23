/**
 * CH-0026: set_voice_chain on e set_voice_denoise 0.5 em menos de 1 s disparam dois jobs de voz no mesmo arquivo
 * (0c e 50c). O do 0c termina antes e a limpeza dele (rm dos clean-* que não são dele) apagava o clean-50c.flac
 * que o outro acabara de gravar; o asset ficava com clean 50c apontando para um master inexistente e o render
 * falhava com "Error opening input ... clean-50c.flac". Confere que (1) as ops seguidas terminam com o master da
 * intensidade atual no disco e (2) master apagado é refeito no sync (que o render chama antes de montar o áudio).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-voz-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { store } = await import('./store.ts');
const { cleanMaster, syncVoiceClean } = await import('./denoise.ts');

let projectId = '';
const assetId = 'ast_voz';

before(async () => {
  await store.load();
  projectId = (await store.create('Voz', 'teste CH-0026')).id;
  const dir = path.join(store.dir(projectId), assetId);
  fs.mkdirSync(dir, { recursive: true });
  const bruto = path.join(tmp, 'bruto.mp4');
  // 20 s de voz de mentira (tom + ruído rosa) para a passada do RNNoise levar mais que a do job sem limpeza.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:d=20', '-f', 'lavfi', '-i', 'sine=f=220:d=20', '-f', 'lavfi', '-i', 'anoisesrc=c=pink:a=0.05:d=20', '-filter_complex', '[1][2]amix=inputs=2[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', bruto]);
  fs.copyFileSync(bruto, path.join(dir, 'proxy.mp4'));
  store.upsertAsset(projectId, { id: assetId, kind: 'video', path: bruto, proxy: `${assetId}/proxy.mp4`, width: 160, height: 90, duration: 20, hasAudio: true } as never);
  store.apply(projectId, { by: 'human', op: { type: 'set_main', clips: [{ id: 'c1', assetId, in: 0, out: 20, by: 'human' }] } } as never);
});

const asset = () => store.get(projectId).assets.find((a) => a.id === assetId)!;

describe('voz: ops seguidas não apagam o master atual (CH-0026)', () => {
  test('set_voice_chain + set_voice_denoise em seguida: clean 50c com master e proxy no disco', async () => {
    // Igual ao onTimeline do servidor: um sync por op, sem esperar o anterior.
    store.apply(projectId, { by: 'human', op: { type: 'set_voice_chain', on: true } });
    const a = syncVoiceClean(projectId);
    store.apply(projectId, { by: 'human', op: { type: 'set_voice_denoise', amount: 0.5 } });
    const b = syncVoiceClean(projectId);
    await Promise.all([a, b]);
    await syncVoiceClean(projectId);
    const c = asset().clean!;
    assert.equal(c.mix, 0.5);
    assert.equal(c.chain, true);
    const root = store.dir(projectId);
    assert.ok(fs.existsSync(path.join(root, c.master)), `master ${c.master} sumiu`);
    assert.ok(fs.existsSync(path.join(root, c.proxy!)), `proxy ${c.proxy} sumiu`);
    assert.deepEqual(fs.readdirSync(path.join(root, assetId)).filter((f) => f.includes('clean-')).sort(), ['clean-50c.flac', 'proxy-clean-50c.mp4']);
  });

  test('master apagado com asset.clean batendo: o sync do render refaz', async () => {
    const root = store.dir(projectId);
    fs.rmSync(path.join(root, asset().clean!.master));
    await syncVoiceClean(projectId);
    const m = cleanMaster(store.get(projectId), asset());
    assert.ok(m && fs.existsSync(m), 'master não foi refeito');
  });
});
