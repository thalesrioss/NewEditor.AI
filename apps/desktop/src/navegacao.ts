/**
 * Para onde vai um link da janela (BL-0177). Função pura, testável sem Electron.
 *
 *  · interna: mesma origem (protocolo + host + porta) da interface carregada: a janela navega.
 *  · externa: outro site http/https: abre no navegador do sistema.
 *  · negada: qualquer outro protocolo (file:, smb:, javascript:, esquema de app…) ou texto que não é URL: nada abre.
 *
 * A comparação é por `new URL(u).origin`, não por prefixo de texto: com prefixo, `http://localhost:5410.exemplo`
 * passava como interno de `http://localhost:5410`. E `shell.openExternal` com `file:`/`smb:` abria arquivo ou
 * compartilhamento de rede a partir de um link na página.
 */
export type DestinoNavegacao = 'interna' | 'externa' | 'negada';

const WEB = new Set(['http:', 'https:']);

export function destinoNavegacao(alvo: string, base: string): DestinoNavegacao {
  let u: URL;
  try {
    u = new URL(alvo);
  } catch {
    // Não vira URL (ex.: `http://localhost:5410.exemplo`, porta inválida): nunca é interna; se é http(s), o
    // navegador do sistema decide; qualquer outra coisa não abre.
    return /^https?:\/\//i.test(alvo.trim()) ? 'externa' : 'negada';
  }
  if (!WEB.has(u.protocol)) return 'negada';
  try {
    if (u.origin === new URL(base).origin) return 'interna';
  } catch {
    /* base inválida: nada é interno */
  }
  return 'externa';
}
