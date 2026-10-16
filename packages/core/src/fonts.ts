/**
 * Fontes empacotadas (OFL, google/fonts) — ADR-005 "tudo empacotado": o mesmo arquivo de fonte no preview e no
 * export, em qualquer máquina. Os arquivos ficam em apps/web/public/fonts (licenças em fonts/licencas).
 */

export interface FontFile {
  family: string;
  file: string;
  /** Faixa de peso (fonte variável) ou peso único. */
  weight: string;
  style: 'normal' | 'italic';
}

export const FONT_FILES: FontFile[] = [
  { family: 'Montserrat', file: 'Montserrat-VF.ttf', weight: '100 900', style: 'normal' },
  { family: 'Montserrat', file: 'Montserrat-Italic-VF.ttf', weight: '100 900', style: 'italic' },
  { family: 'Playfair Display', file: 'PlayfairDisplay-VF.ttf', weight: '400 900', style: 'normal' },
  { family: 'Playfair Display', file: 'PlayfairDisplay-Italic-VF.ttf', weight: '400 900', style: 'italic' },
  { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Anton', file: 'Anton-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Inter', file: 'Inter-VF.ttf', weight: '100 900', style: 'normal' },
];

/** `@font-face` de todas as fontes; `src(file)` diz de onde carregar (URL no app, data: no export). */
export function fontFaceCss(src: (file: string) => string): string {
  return FONT_FILES.map((f) => `@font-face{font-family:'${f.family}';src:url("${src(f.file)}") format("truetype");font-weight:${f.weight};font-style:${f.style};font-display:block;}`).join('\n');
}

/** Força o carregamento de cada fonte (o Chrome só baixa a fonte quando algum texto a usa). */
export const FONT_PRELOADS = FONT_FILES.map((f) => `${f.style} ${f.weight.split(' ')[0] === '100' ? 400 : f.weight.split(' ')[0]} 32px '${f.family}'`);
