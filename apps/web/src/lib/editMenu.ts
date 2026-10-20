/**
 * Menu Editar do app de desktop (Desfazer ⌘Z, Refazer ⇧⌘Z, Selecionar tudo ⌘A).
 *
 * No Mac, ⌘Z/⌘A dentro de um campo só funcionam se o menu do app tiver esses itens: o Chromium manda a tecla
 * primeiro à página e, se ninguém tratar, ao menu. O processo principal manda `ne:edit` (detail = comando)
 * e aqui um handler único decide: campo de texto em foco → edita o campo; senão → o editor (timeline).
 * Nunca as duas coisas.
 */
export type EditCmd = 'undo' | 'redo' | 'selectAll';

type Doc = Pick<Document, 'activeElement' | 'execCommand'>;

export const isEditable = (el: Element | null | undefined): boolean =>
  !!(el as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

let appHandler: ((cmd: EditCmd) => void) | null = null;
const lastKey: Partial<Record<EditCmd, number>> = {};
/** Janela em que o menu ignora o mesmo comando já tratado pelo atalho da página (tecla e menu no mesmo toque). */
const DEDUPE_MS = 150;

/** O editor registra aqui o que ⌘Z/⇧⌘Z/⌘A fazem fora de campo; devolve a função que desfaz o registro. */
export function setEditHandler(fn: (cmd: EditCmd) => void): () => void {
  appHandler = fn;
  return () => {
    if (appHandler === fn) appHandler = null;
  };
}

/** O atalho de teclado da página tratou o comando (e chamou preventDefault). */
export function markKeyHandled(cmd: EditCmd, now = Date.now()): void {
  lastKey[cmd] = now;
}

export function runEditCommand(cmd: EditCmd, doc: Doc = document, now = Date.now()): 'field' | 'app' | 'page' | 'none' {
  if (isEditable(doc.activeElement)) {
    doc.execCommand(cmd);
    return 'field';
  }
  if (now - (lastKey[cmd] ?? -Infinity) < DEDUPE_MS) return 'none';
  if (appHandler) {
    appHandler(cmd);
    return 'app';
  }
  // Fora do editor (Kanban, perfis): Selecionar tudo faz o de sempre do navegador.
  if (cmd === 'selectAll') {
    doc.execCommand('selectAll');
    return 'page';
  }
  return 'none';
}

const CMDS: readonly string[] = ['undo', 'redo', 'selectAll'];

export function installEditMenu(win: Pick<Window, 'addEventListener'> = window): void {
  win.addEventListener('ne:edit', (e) => {
    const cmd = (e as CustomEvent).detail;
    if (CMDS.includes(cmd)) runEditCommand(cmd as EditCmd);
  });
}
