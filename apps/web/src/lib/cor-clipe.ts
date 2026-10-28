/**
 * Alvo da aba Cor (BL-0159 C3): a grade do arquivo (todos os clipes dele) ou a do clipe, por cima da do arquivo.
 * Contas puras do ColorPanel: qual clipe, quais clipes são "desta câmera" e como uma grade colada entra no alvo.
 */
import { locate, type Clip, type ColorGrade, type Timeline } from '@neweditor/core';

export type AlvoCor = 'arquivo' | 'clipe';

/** O clipe da aba Cor: o selecionado na timeline; sem seleção de clipe, o que está sob o cursor. */
export function clipeDaCor(tl: Timeline | undefined, selecionado: string | null | undefined, playhead: number): Clip | null {
  if (!tl?.main.length) return null;
  const sel = selecionado ? tl.main.find((c) => c.id === selecionado) : undefined;
  return sel ?? locate(tl, Math.max(0, playhead))?.clip ?? null;
}

/** Os clipes da timeline com a mesma câmera do clipe: mesma 2ª câmera (`cam`) quando ele tem, senão o mesmo arquivo. */
export function clipesDaCamera(tl: Timeline, clip: Clip): string[] {
  const cam = (c: Clip) => c.cam ?? c.assetId;
  return tl.main.filter((c) => cam(c) === cam(clip)).map((c) => c.id);
}

/**
 * Grade colada no alvo. No arquivo, a conversão de entrada fica a do arquivo (a colada não troca a câmera); no clipe, a
 * entrada sai (o `set_clip_grade` já tira: a grade do clipe entra sobre a imagem convertida).
 */
export function colarGrade(colada: ColorGrade, atual: ColorGrade, alvo: AlvoCor): ColorGrade {
  if (alvo === 'clipe') return { ...colada };
  const { input: _i, codeRange: _c, inputLut: _l, ...resto } = colada;
  const out: ColorGrade = { ...resto, input: atual.input };
  if (atual.codeRange) out.codeRange = atual.codeRange;
  if (atual.inputLut) out.inputLut = atual.inputLut;
  return out;
}
