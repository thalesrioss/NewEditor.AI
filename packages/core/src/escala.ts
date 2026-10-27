/**
 * Escala efetiva (FB-0180 A3): quantos pixels de saída cada pixel da fonte vira. Acima de 1 a imagem é ampliada e
 * amolece; o recorte 9:16 de um 4K deitado tem 1215 px de largura, então zoom acima de ~1,125 já amplia numa entrega
 * 1080×1920. O qc-tecnico reprova acima de `ESCALA_MAX`.
 */
import { normalizeFraming } from './timeline.ts';
import type { Clip, MediaAsset, OverlayFraming } from './types.ts';

export const ESCALA_MAX = 1.25;
/** Lado curto da entrega (o mesmo do render). */
const DELIVERY_SHORT_SIDE = 1080;

const delivery = (tl: { width: number; height: number }) => {
  const k = Math.min(1, DELIVERY_SHORT_SIDE / Math.min(tl.width, tl.height));
  return { W: tl.width * k, H: tl.height * k };
};

/** Clipe da trilha principal: contido no quadro (ou recortado no aspecto do quadro com o reframe) e o zoom por cima. */
export function clipScale(src: Pick<MediaAsset, 'width' | 'height'>, c: Pick<Clip, 'zoom' | 'zoomTo' | 'framing'>, tl: { width: number; height: number; reframe?: boolean }): number | null {
  if (!src.width || !src.height) return null;
  const { W, H } = delivery(tl);
  const z = Math.max(c.zoom ?? 1, c.zoomTo ?? c.zoom ?? 1);
  // Com reframe (e o x do rosto marcado, como no render), a fonte mais larga é recortada na altura inteira; sem, contida.
  const crop = tl.reframe && c.framing?.x !== undefined && src.width / src.height > W / H + 0.02;
  const k = crop ? H / src.height : Math.min(W / src.width, H / src.height);
  return k * z;
}

/** B-roll: preenche o quadro (cover) e o zoom do enquadramento por cima. */
export function overlayScale(src: Pick<MediaAsset, 'width' | 'height'>, framing: Partial<OverlayFraming> | null | undefined, tl: { width: number; height: number }): number | null {
  if (!src.width || !src.height) return null;
  const { W, H } = delivery(tl);
  return Math.max(W / src.width, H / src.height) * normalizeFraming(framing ?? {}).zoom;
}

/** Aviso curto para o log da operação, ou null quando não amplia. */
export function escalaAviso(scale: number | null, quem: string): string | null {
  if (scale === null || scale <= 1.001) return null;
  const x = scale.toFixed(2).replace('.', ',');
  return scale > ESCALA_MAX
    ? `${quem}: escala efetiva ${x}× (amplia a fonte acima de ${String(ESCALA_MAX).replace('.', ',')}×, a imagem amolece; o gate técnico reprova). Use zoom menor ou outro plano.`
    : `${quem}: escala efetiva ${x}× (amplia um pouco a fonte).`;
}
