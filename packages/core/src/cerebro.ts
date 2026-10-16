/**
 * Cérebros como grafo (aba #/cerebro): os vaults do Obsidian e o que liga as notas — dentro de cada
 * cérebro e entre eles. Dois cérebros hoje: o Cérebro do Editor (fluxo editorial, padrões de cliente) e o
 * Motion Studio Brain (estética e decisões de motion — em motion, manda ele: A-08). O produto só lê.
 */

export type CerebroVaultId = 'editor' | 'motion';

/**
 * Camada do conhecimento (decisão do Thales, 2026-10-10): o produto embarca só o OFÍCIO; o que é dele
 * (referências, gosto, DNA, memória dos jobs) é PESSOAL e não vai para outras contas; o que cada
 * cliente aprova é do CLIENTE do editor. Assim cada cérebro fica diferente — e diferencial vira marca.
 */
export type CerebroCamada = 'oficio' | 'pessoal' | 'cliente';

export type CerebroKind =
  // comuns
  | 'cerebro' // o hub de um vault
  | 'pasta' // hub de pasta de primeiro nível
  | 'raiz' // nota na raiz
  | 'canvas' // .canvas
  // Cérebro do Editor
  | 'sistema' // _SISTEMA: protocolo, DNA
  | 'memoria' // _SISTEMA/memoria: memória de cada Skill
  | 'brain' // brains/: ofício
  | 'padrao' // padroes/: padrão por cliente
  | 'motion' // padroes de motions/
  | 'projeto' // montagens/<slug>: a pasta de um projeto (hub)
  | 'arquivo' // arquivo dentro de um projeto
  | 'montagem' // nota avulsa em montagens/
  | 'saida' // Claude outputs/
  | 'perfil' // perfil do produto (data/perfis)
  // Motion Studio Brain
  | 'referencia' // Referências/Ref - *
  | 'mapa' // Mapa Estético, Técnica
  | 'aprovado' // Registro de Decisões/Aprovados
  | 'recusado' // Registro de Decisões/Recusados
  | 'alteracao' // Registro de Decisões/Alterações
  | 'registro' // Registro de Decisões (índice, Padrões do Thales)
  | 'asset' // Assets Gerados
  | 'filme' // Motion Studio/films/<slug>
  | 'tecnologia'; // uma skill embarcada do Motion Studio (um nó por skill, não por documento)

export type CerebroEdgeKind =
  | 'wikilink' // [[ligação]] escrita no Obsidian
  | 'mencao' // a nota cita a outra (caminho/nome no texto)
  | 'pasta' // está dentro da pasta/projeto
  | 'decisao' // decisões registradas (skill ↔ projeto)
  | 'correcao' // correções do Thales (skill ↔ projeto)
  | 'oficio' // Skill → brains (mapa de ofício)
  | 'cliente' // nota do mesmo cliente ↔ padrão do cliente
  | 'canvas' // ligação desenhada num canvas
  | 'perfil' // perfil do produto ← padrão lido
  | 'ponte'; // entre os dois cérebros

export interface CerebroNode {
  id: string;
  vault: CerebroVaultId;
  label: string;
  /** Caminho relativo ao vault (vazio para hubs e perfis). */
  path: string;
  kind: CerebroKind;
  camada: CerebroCamada;
  /** Grupo para cor/legenda. */
  group: string;
  words: number;
  mtime: number;
  excerpt: string;
  /** Padrão da casa / validado (padrões e perfis). */
  casa?: boolean;
  teste?: boolean;
}

export interface CerebroEdge {
  s: string;
  t: string;
  kind: CerebroEdgeKind;
  w: number;
}

export interface CerebroVault {
  id: CerebroVaultId;
  /** Nome do vault no Obsidian (= nome da pasta). */
  name: string;
  /** Como aparece na tela. */
  label: string;
  dir: string;
  notas: number;
  /** O que esse cérebro manda (regra do Thales). */
  papel: string;
}

export interface CerebroGraph {
  vaults: CerebroVault[];
  geradoEm: string;
  nodes: CerebroNode[];
  edges: CerebroEdge[];
  grupos: { id: string; vault: CerebroVaultId; label: string; kind: CerebroKind; n: number }[];
  pontes: number;
  /** Quantas notas em cada camada (sem hubs e perfis). */
  camadas: Record<CerebroCamada, number>;
}

export interface CerebroNote {
  vault: CerebroVaultId;
  path: string;
  title: string;
  content: string;
  words: number;
  mtime: number;
  truncated: boolean;
}

export const CEREBRO_KIND_LABEL: Record<CerebroKind, string> = {
  cerebro: 'Cérebro',
  pasta: 'Pasta',
  raiz: 'Raiz',
  canvas: 'Canvas',
  sistema: 'Sistema',
  memoria: 'Memória das Skills',
  brain: 'Ofício (brains)',
  padrao: 'Padrão por cliente',
  motion: 'Padrões de motion (antigos)',
  projeto: 'Projeto',
  arquivo: 'Arquivo de projeto',
  montagem: 'Montagem',
  saida: 'Saídas do Claude',
  perfil: 'Perfil (produto)',
  referencia: 'Referência',
  mapa: 'Mapa estético / técnica',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  alteracao: 'Alteração (regra)',
  registro: 'Registro de decisões',
  asset: 'Assets gerados',
  filme: 'Filme',
  tecnologia: 'Tecnologia (skills)',
};

export const CEREBRO_CAMADA_LABEL: Record<CerebroCamada, string> = {
  oficio: 'Ofício — o cérebro padrão que todo editor recebe',
  pessoal: 'Pessoal — só do Thales, não vai para outras contas',
  cliente: 'Clientes — o que cada cliente do editor aprova',
};

export const CEREBRO_EDGE_LABEL: Record<CerebroEdgeKind, string> = {
  wikilink: '[[liga]]',
  mencao: 'cita',
  pasta: 'está em',
  decisao: 'decisões',
  correcao: 'correções do Thales',
  oficio: 'ofício',
  cliente: 'mesmo cliente',
  canvas: 'no canvas',
  perfil: 'perfil lido de',
  ponte: 'ponte entre cérebros',
};
