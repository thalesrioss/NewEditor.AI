/**
 * Reframe 16:9 → 9:16 seguindo o rosto (ADR-007 N-1): com o rosto medido pelo Vision (vision.ts), cada clipe
 * ganha o centro horizontal do recorte; o compositor e o export recortam em volta dele em vez de letterbox.
 */
import type { MediaAsset } from '@neweditor/core';
import { store } from './store.ts';
import { facesOf, faceSummary } from './vision.ts';

export async function autoReframe(projectId: string): Promise<{ clips: number; arquivos: string[] }> {
  const p = store.get(projectId);
  const tl = p.timeline;
  const ar = tl.width / tl.height;
  const wide = (a: MediaAsset) => a.kind === 'video' && !!a.width && !!a.height && a.width / a.height > ar + 0.05;
  const falas = p.assets.filter((a) => wide(a) && tl.main.some((c) => c.assetId === a.id));
  if (!falas.length) throw new Error('nenhum vídeo de fala mais largo que a timeline — o reframe serve para material 16:9 numa peça 9:16');
  let n = 0;
  await store.transaction(projectId, 'Reframe pelo rosto', async () => {
    store.apply(projectId, { by: 'agent', op: { type: 'set_reframe', on: true } });
    for (const a of falas) {
      const f = await facesOf(p, a);
      const global = f ? faceSummary(f) : null;
      for (const c of store.get(projectId).timeline.main.filter((x) => x.assetId === a.id)) {
        const s = f ? faceSummary(f, c.in, c.out) : null;
        const x = s && s.coverage > 0.2 ? s.centerX : (global?.centerX ?? 0.5);
        store.apply(projectId, { by: 'agent', op: { type: 'set_framing', clipId: c.id, x: Math.round(x * 1000) / 1000 } });
        n++;
      }
    }
  });
  store.log(projectId, 'agent', `Reframe: ${n} clipe(s) enquadrados no rosto (${falas.map((a) => a.name).join(', ')}).`);
  return { clips: n, arquivos: falas.map((a) => a.name) };
}
