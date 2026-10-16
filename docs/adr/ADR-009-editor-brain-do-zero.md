# ADR-009: Editor Brain do zero, no layout do CapCut, e o caminho para o app de desktop

**Status:** Aceito (interface) · Proposto (app de desktop)
**Data:** 2026-10-12
**Decide:** Thales

## Contexto

O Thales não estava gostando do Editor Brain e pediu para começar do zero, com "todo o layout e funcionalidade do CapCut online" que o estudo `docs/ESTUDO-CAPCUT.md` já tinha trazido, deixando o agente (NewEditor.AI) para a etapa seguinte. No mesmo dia pediu que o produto seja "literalmente um app, para Mac e Windows, igual o CapCut".

O que já existia e não é o problema: o núcleo TypeScript (timeline por operações, legenda presa à fala, lettering, motion, cor, SFX), o servidor (ingest, decupagem, render com FFmpeg, Motion Studio) e o motor de preview (WebCodecs + WebGL). O problema era a interface: painéis com abas que cortavam, propriedades soltas, timeline sem laço nem menu de contexto, player com transporte mínimo.

## Decisão

### 1. A interface do editor é reescrita numa pasta própria, `apps/web/src/editor/`

Layout do CapCut, peça por peça:

| Região | O que tem | Arquivo |
|---|---|---|
| Barra superior | voltar · logo · **nome editável** · etapa · perfil ··· estado "Salvo" · sino · atalhos · recolher painéis · **Exportar** | `TopBar.tsx` |
| Trilho + painel de recursos | ícones com rótulo (Mídia, Fala, Áudio, Legenda, Texto, Motion, Cor); clicar abre o painel ao lado, clicar de novo recolhe; largura arrastável e lembrada | `Rail.tsx`, `ResourcePanel.tsx` |
| Player | cabeçalho "Player" com formato (proporção · resolução · fps) e qualidade da prévia; transporte completo: início, corte anterior, um quadro, play, um quadro, corte seguinte, fim, **timecode HH:MM:SS:FF**, mudo, tela cheia | `stage/Stage.tsx` |
| Inspetor | abas Ajustes · Agente · Revisão. Ajustes é contextual, em seções recolhíveis (Básico, Zoom, Velocidade, Câmera, Cor para clipe; Básico, Texto, Posição, Estilo, Áudio para camadas; Formato, Legenda, Voz, Briefing, Regras para o projeto) | `inspector/Inspector.tsx`, `inspector/Properties.tsx` |
| Timeline | barra de ferramentas (desfazer, refazer, dividir, aparar Q/W, apagar, lettering, ímã, acompanhar o cursor, timecode, zoom); cabeçalhos com olho/som/cadeado; régua com **marcas por quadro** no zoom alto; cursor arrastável pela cabeça; **laço de seleção** (clipes e camadas); **menu de contexto** (dividir, aparar, flash, esticar até o corte, pedir ao agente, remover); **⌘+roda** dá zoom em volta do mouse, **⇧+roda** rola; aparar pela esquerda e pela direita nas camadas; arrastar da biblioteca para a trilha certa (V3 só aceita motion com alfa); o avatar continua andando pelos cortes | `timeline/*` |
| Biblioteca de mídia | Importar em destaque, busca, grade por grupo (Fala, B-roll, Motions, Áudio), **"+" no cartão insere no cursor até o fim do corte**, aba Cinéfilo | `components/MediaPanel.tsx` |

Atalhos somados aos que já existiam: ⌘B dividir, ↑/↓ corte anterior/seguinte, Home/End, ⌘A seleciona as camadas, ⌘E exporta. A folha `?` foi atualizada.

O que **não** mudou: o modelo (ops, âncoras na fala), o servidor, o motor de preview, os painéis de conteúdo (Fala, Legenda, Texto, Motion, Áudio, Cor) — eles só ganharam a moldura nova. Os arquivos antigos (`Editor.tsx`, `Timeline.tsx`, `PropertiesPanel.tsx`) foram apagados; o que outros painéis importavam deles vive em `editor/shared.ts`.

### 2. O produto vira um app de desktop (Mac e Windows)

**Recomendação: Electron**, com o servidor Fastify rodando dentro do processo principal e o FFmpeg/mlx-whisper empacotados.

| Dimensão | Electron | Tauri |
|---|---|---|
| Complexidade | Baixa: o servidor já é Node; vira um processo filho do app | Média: o backend seria Rust, ou um sidecar Node de qualquer jeito |
| WebCodecs + WebGL + SharedArrayBuffer (o motor de preview) | Chromium embutido, igual em Mac e Windows | WebView do sistema: no Windows é o WebView2 (ok), no Mac é o WebKit (WebCodecs parcial, sem VP9 com alfa) |
| Tamanho | ~180 MB | ~15 MB + sidecar |
| Familiaridade | TypeScript do começo ao fim | Rust novo no projeto |

O CapCut Web prova que um editor de vídeo cabe num Chromium; o nosso motor de preview foi feito para esse Chromium. O preço é o tamanho do instalador, que para um editor de vídeo é aceitável.

**Plano** (depois do editor e do agente):
1. `apps/desktop/` com `electron` + `electron-builder`: janela única carregando a web; o servidor sobe no processo principal numa porta livre; os dados ficam em `~/Library/Application Support/NewEditor` (Mac) e `%APPDATA%/NewEditor` (Windows).
2. Binários do FFmpeg por plataforma e o modelo do Whisper baixados no primeiro uso (com o ok do usuário), não embutidos no instalador.
3. Diálogos nativos (abrir arquivo, salvar export, revelar no Finder/Explorer), menu nativo com os atalhos do editor, ícone e nome "Editor Brain".
4. Auto-update por release no GitHub (quando o repositório existir).

Instalar o Electron é um download: só com o ok do Thales.

## Consequências

- **Mais fácil:** evoluir cada região sem tocar nas outras (cada uma é um arquivo); comparar com o CapCut lado a lado; trabalhar no agente em seguida, porque ele mora numa aba do inspetor e nas marcas da timeline.
- **Mais difícil:** o layout é denso e pede 1280 px ou mais de largura; abaixo disso o painel de recursos deve ficar recolhido (o estado é lembrado).
- **Revisitar:** mover de trilha arrastando (hoje cada papel tem uma trilha); pré-visualização animada dos estilos nos cartões; o formato da entrega editável (hoje é definido na criação do projeto).

## O que foi feito no app de desktop (2026-10-12, "Pra cima")

O Thales mandou o app subir na fila. Está em `apps/desktop/` (Electron 44):
- `src/main.ts`: sobe o servidor Fastify **dentro do processo principal** numa porta livre, abre a janela nele, menu nativo (Arquivo, Editar, Ver, Janela, Ajuda), links externos no navegador, PATH do Homebrew para o FFmpeg, barra de título escondida no Mac (as barras do topo da interface viram área de arrasto e abrem espaço para os semáforos: classe `electron-mac` em `styles.css`).
- `esbuild.mjs`: empacota o main e o servidor (TypeScript do monorepo) em `dist/*.mjs`; as dependências ficam no node_modules.
- `electron-builder.yml`: leva serviços, fontes, logo, perfis e a interface construída para `resources/app-root`; o servidor lê `NEWEDITOR_ROOT`, `NEWEDITOR_DATA` (dados em `~/Library/Application Support/Editor Brain/data`) e `NEWEDITOR_WEB_DIST` (`apps/server/src/config.ts`).
- Comandos: `npm run desktop` (servidor + Vite + janela do app em desenvolvimento), `npm run desktop:start` (o app com o servidor embutido, sem Vite), `npm run dist` (DMG/zip no Mac, NSIS no Windows, em `apps/desktop/release/`).
- Conferido: o `.app` empacotado abre, sobe o servidor em `127.0.0.1:<porta livre>`, cria a pasta de dados e mostra o Kanban.

**Instalado de verdade (12/10, mais tarde).** O app está em `/Applications/Editor Brain.app` e abre com os projetos do Thales: a pasta de dados do app (`~/Library/Application Support/Editor Brain/data`) é um link simbólico para `data/` do repositório, então app e `npm run dev` veem os mesmos projetos (não rodar os dois editando o mesmo projeto ao mesmo tempo). Dois erros de empacotamento só apareceram fora do repositório, porque dentro dele o Node achava tudo em `node_modules`: o bundle do servidor deixava `@neweditor/core` como externo (agora o esbuild tem `alias` para o pacote do monorepo) e o SDK da Anthropic, importado estaticamente pelo servidor, não ia no app (agora é dependência do `apps/desktop`). Para não caçar isso às cegas de novo, o app escreve um diário em `~/Library/Logs/Editor Brain/main.log` (início, servidor, janela, erro) e mostra o caminho no aviso de erro.

Pendências do app: FFmpeg, Whisper e Chrome continuam vindo do sistema (empacotar depois); build de Windows só numa máquina Windows (ou CI); assinatura/notarização da Apple quando houver conta de desenvolvedor.

## Ações

1. [x] Interface nova em `apps/web/src/editor/` (compila, build ok, conferida no navegador com o projeto do JP).
2. [x] App de desktop (Electron) em desenvolvimento e empacotado para Mac (sem assinatura).
3. [ ] Agente NewEditor.AI (próxima etapa).
4. [ ] Empacotar FFmpeg/Whisper, build Windows, assinatura.
