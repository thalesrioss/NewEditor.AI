/**
 * Alvo da aba Cor (BL-0159 C3): a grade do arquivo (todos os clipes dele) ou a do clipe, por cima da do arquivo.
 * Contas puras do ColorPanel: qual clipe, quais clipes são "desta câmera" e como uma grade colada entra no alvo.
 */
import { clipGradeOf, isNeutral, locate, NEUTRAL_GRADE, type Clip, type ColorGrade, type Timeline } from '@neweditor/core';

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

/** Grade copiada na aba Cor, com o alvo em que foi copiada. */
export interface CopiaCor {
  grade: ColorGrade;
  alvo: AlvoCor;
}

/**
 * Grade colada no alvo, ou null quando a cópia veio do outro alvo. A grade do arquivo já faz a conversão e as primárias;
 * colada num clipe do mesmo arquivo, entraria de novo por cima (primárias duas vezes no render). E a do clipe colada no
 * arquivo trocaria a grade de todos os clipes por um ajuste feito para um só. No arquivo, a conversão de entrada fica a
 * do arquivo (a colada não troca a câmera); no clipe, a entrada sai (o `set_clip_grade` já tira).
 */
export function colarGrade(copia: CopiaCor, atual: ColorGrade, alvo: AlvoCor): ColorGrade | null {
  if (copia.alvo !== alvo) return null;
  if (alvo === 'clipe') return { ...copia.grade };
  const { input: _i, codeRange: _c, inputLut: _l, ...resto } = copia.grade;
  const out: ColorGrade = { ...resto, input: atual.input };
  if (atual.codeRange) out.codeRange = atual.codeRange;
  if (atual.inputLut) out.inputLut = atual.inputLut;
  return out;
}

/**
 * Grade do arquivo no player antigo (sem grade por clipe): o rascunho só vale quando é do arquivo. O rascunho de "Este
 * clipe" é Rec.709 sem conversão de entrada; no lugar da grade do arquivo, a imagem LOG apareceria crua durante o arraste.
 */
export function gradeDoArquivoAoVivo(
  draft: { assetId: string; grade: ColorGrade; clipId?: string } | null | undefined,
  assetId: string,
  grades: Record<string, ColorGrade> | undefined,
): ColorGrade | undefined {
  return draft && !draft.clipId && draft.assetId === assetId ? draft.grade : grades?.[assetId];
}

/** Grade sem a conversão de entrada é a identidade (o arquivo só converte a câmera, o clipe não mexe). */
const semLook = (g: ColorGrade | null | undefined): boolean => !g || isNeutral({ ...NEUTRAL_GRADE, ...clipGradeOf(g) });

/**
 * A grade que vai para o padrão do cliente (BL-0161): o still guarda o quadro com as duas camadas (o look do arquivo,
 * sem a conversão da câmera, e a grade do clipe por cima), então o padrão precisa ser a camada que tem o look. Com look
 * nas duas, recusa: compor duas grades (rodas, curvas, HSL, look) numa só não é exato, e o projeto herdeiro sairia fora
 * do próprio still. `arquivo` e `clipe` são as grades como o player mostra agora (a do alvo, ao vivo).
 */
export function gradeParaPadrao(arquivo: ColorGrade | null | undefined, clipe: ColorGrade | null | undefined): { grade: ColorGrade } | { erro: string } {
  const lookArquivo = !semLook(arquivo);
  const lookClipe = !semLook(clipe);
  if (lookArquivo && lookClipe) {
    return { erro: 'O look está nas duas camadas (arquivo e este clipe) e o still mostra as duas juntas. Deixe o look numa só (zere a outra, mantendo a conversão da câmera) e salve de novo.' };
  }
  if (lookClipe) return { grade: clipGradeOf(clipe!) };
  return { grade: clipGradeOf(arquivo ?? NEUTRAL_GRADE) };
}
