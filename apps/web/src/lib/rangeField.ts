/**
 * Regras puras do RangeField (slider + campo numérico), testáveis sem DOM.
 * BL-0108 (CH-0013): um valor vindo da API acima da faixa da tela (zoom 2,6 com o controle até 1,3) não pode ser
 * cortado só porque o editor clicou no campo e saiu.
 */

/** Valor a gravar ao sair do campo: só se o texto foi editado (senão null, nada muda). */
export function blurValue(text: string, shown: string): number | null {
  if (text.trim() === shown) return null;
  return Number(text.replace(',', '.')) || 0;
}

/** Fim da faixa do controle: a referência da casa, ou o valor atual se ele veio maior (pela API). */
export const rangeMax = (house: number, value: number): number => Math.max(house, value);
