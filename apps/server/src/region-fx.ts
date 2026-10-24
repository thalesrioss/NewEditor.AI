import { resolveRegionFx, type RegionFx, type Timeline } from '@neweditor/core';
import { overlayFrames } from './render.ts';

/**
 * Efeito por região no export (CH-0033): para cada efeito ativo, recorta só a área (retângulo + margem da borda
 * suave) no trecho dele, aplica o desfoque ou a limpeza, monta a máscara (retângulo com borda suave, rampa de
 * entrada/saída e, se pedido, os pixels escuros protegidos) e cola de volta por cima da imagem da fala.
 * Devolve as linhas do filtergraph e o rótulo da saída; sem efeito ativo, devolve o próprio `input`.
 */
export function regionFxGraph(tl: Timeline, W: number, H: number, fps: number, input: string): { parts: string[]; out: string } {
  const parts: string[] = [];
  let cur = input;
  (tl.regionFx ?? []).forEach((fx, i) => {
    const pos = resolveRegionFx(tl, fx);
    if (!pos || pos.end - pos.start < 1 / fps) return;
    const w = overlayFrames(pos.start, pos.end, fps);
    const d = (w.f1 - w.f0) / fps;
    const g = regionGeometry(fx, W, H);
    const n = `rfx${i}`;
    const protect = fx.protectDark !== undefined && fx.protectDark > 0;
    parts.push(`[${cur}]split=2[${n}b][${n}s]`);
    const crop = `trim=start=${w.at.toFixed(6)}:duration=${d.toFixed(6)},setpts=PTS-STARTPTS,crop=${g.cw}:${g.ch}:${g.cx}:${g.cy}`;
    parts.push(protect ? `[${n}s]${crop},split=2[${n}o][${n}k]` : `[${n}s]${crop}[${n}o]`);
    parts.push(`[${n}o]${effectFilter(fx, H, n)},format=yuv420p[${n}e]`);
    // Máscara: retângulo branco (255: o branco do drawbox em gray é 235 e deixava 8% da imagem de baixo) com borda suave no tamanho do recorte, com rampa de entrada/saída no tempo.
    const fade = fx.fade ? `,fade=t=in:st=0:d=${fx.fade}:color=black,fade=t=out:st=${Math.max(0, d - fx.fade).toFixed(4)}:d=${fx.fade}:color=black` : '';
    const soft = g.sigma > 0 ? `,gblur=sigma=${g.sigma}` : '';
    parts.push(`color=c=black:s=${g.cw}x${g.ch}:r=${fps}:d=${d.toFixed(6)},format=gray,drawbox=x=${g.rx}:y=${g.ry}:w=${g.rw}:h=${g.rh}:color=white:t=fill,lut=y='if(gt(val\\,127)\\,255\\,0)'${soft}${fade}[${n}r]`);
    if (protect) {
      // Escuro (pessoa, cabelo, roupa, parede abaixo do limiar) fica fora da máscara. A área clara (o texto) cresce
      // ~12 px (em 1920) para levar junto a borda suavizada das letras, que fica abaixo do limiar e viraria contorno;
      // é a chave de luma dilatada do contorno da Lia no eq2210-02.
      const thr = Math.round(16 + fx.protectDark! * 219);
      const grow = Array.from({ length: Math.max(2, Math.round((12 * H) / 1920)) }, () => 'dilation').join(',');
      parts.push(`[${n}k]format=gray,lut=y='if(lt(val\\,${thr})\\,0\\,255)',${grow},gblur=sigma=${Math.max(1, Number(((4 * H) / 1920).toFixed(2)))}[${n}p]`);
      parts.push(`[${n}r][${n}p]blend=all_mode=multiply[${n}m]`);
    } else parts.push(`[${n}r]null[${n}m]`);
    parts.push(`[${n}e][${n}m]alphamerge,setpts=PTS+${w.at.toFixed(6)}/TB[${n}a]`);
    parts.push(`[${n}b][${n}a]overlay=${g.cx}:${g.cy}:eof_action=pass:enable='${w.enable}'[${n}]`);
    cur = n;
  });
  return { parts, out: cur };
}

/** Recorte (retângulo + margem para a borda suave), posição do retângulo dentro dele e o sigma da borda, em pixels pares. */
export function regionGeometry(fx: Pick<RegionFx, 'rect' | 'feather'>, W: number, H: number) {
  const even = (x: number) => Math.max(0, Math.round(x / 2) * 2);
  const fpx = fx.feather * H;
  const x0 = fx.rect.x * W;
  const y0 = fx.rect.y * H;
  const x1 = (fx.rect.x + fx.rect.w) * W;
  const y1 = (fx.rect.y + fx.rect.h) * H;
  const cx = even(Math.max(0, x0 - fpx * 1.5));
  const cy = even(Math.max(0, y0 - fpx * 1.5));
  const cw = Math.max(2, Math.min(W - cx, even(x1 + fpx * 1.5 - cx)));
  const ch = Math.max(2, Math.min(H - cy, even(y1 + fpx * 1.5 - cy)));
  // A borda suave fica centrada na linha do retângulo (metade para dentro, metade para fora), como no preview.
  return { cx, cy, cw, ch, rx: Math.round(x0 - cx), ry: Math.round(y0 - cy), rw: Math.max(1, Math.round(x1 - x0)), rh: Math.max(1, Math.round(y1 - y0)), sigma: Number((fpx / 2).toFixed(2)) };
}

/**
 * Desfoque (sigma até ~60 px em 1920) ou limpeza. A limpeza é a receita que a Lia validou no eq2210-02: abertura
 * morfológica na luma (erosão e depois dilatação, ~16 px em 1920 na força 1) apaga letra clara mais fina que a janela
 * e devolve a parede em volta; um desfoque leve tira o degrau e o croma é desfocado à parte (a erosão sozinha
 * escurece e esverdeia). Mediana e desfoque simples deixavam a palavra legível em letra grossa.
 */
export function effectFilter(fx: Pick<RegionFx, 'mode' | 'strength'>, H: number, tag = 'rfx'): string {
  const k = H / 1920;
  if (fx.mode === 'clean') {
    const n = Math.max(2, Math.round((6 + fx.strength * 10) * k));
    const rep = (f: string) => Array.from({ length: n }, () => `${f}=threshold1=0:threshold2=0`).join(',');
    const sig = (x: number) => Math.max(1, Number((x * k).toFixed(2)));
    return `format=yuv444p,split[${tag}l][${tag}c];[${tag}l]${rep('erosion')},${rep('dilation')},gblur=sigma=${sig(24)}[${tag}ly];[${tag}c]gblur=sigma=${sig(70)}[${tag}lc];[${tag}ly][${tag}lc]mergeplanes=0x001112:yuv444p`;
  }
  return `gblur=sigma=${Number(((3 + fx.strength * 57) * k).toFixed(2))}`;
}
