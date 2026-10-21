# NewEditor.AI · instruções para agentes

Leia isto antes de mexer no código. É o atalho para não redescobrir, a cada sessão, como rodar e testar este repositório. Detalhes do produto no `README.md`; decisões em `docs/adr/`; estudos e revisão de arquitetura em `docs/`.

## Produto e stack

- Agente editor de vídeo da NewContent com o Editor Brain: editor visual estilo CapCut onde o humano assiste o agente editar e pede alterações em texto.
- Monorepo npm workspaces: `packages/core` (tipos e lógica pura), `apps/server` (API + WebSocket, pipeline de mídia, agente), `apps/web` (Vite + React), `apps/desktop` (Electron).
- Node 24+, FFmpeg 7+ (o app empacota o 6), `uv` (ASR local com Whisper), Mac com Apple Silicon.

## Comandos canônicos

| Para | Comando |
| --- | --- |
| Instalar | `npm install` (ou `npm ci` num worktree limpo; `ELECTRON_SKIP_BINARY_DOWNLOAD=1` se não for abrir o app) |
| Tipos | `npm run typecheck` |
| Todos os testes | `npm test` (núcleo + web + servidor) |
| Só o servidor | `npm run test:server` |
| Um arquivo de teste | `node --import tsx --test apps/server/src/<arquivo>.test.ts` |
| Build da web | `npm run build -w @neweditor/web` |
| Desenvolvimento | `npm run dev` (servidor `:4310` + web `:5173`) |
| App de desktop | `npm run desktop:start` (oculto: `NEWEDITOR_HIDDEN=1`) |
| Instalador | `npm run dist` / `npm run dist:mac` |

Antes de dizer que terminou: `npm run typecheck` e `npm test` verdes, e `npm run build -w @neweditor/web` se mexeu na web. `apps/web` não tem test runner: prova de interface é por Playwright fora do repo (ver abaixo).

## Rodar isolado (sem tocar na instância do chefe)

- A instância do chefe roda de outra pasta nas portas **4310** e **5173**. Nunca mate esses processos nem aponte testes para eles.
- Dados isolados e porta própria: `NEWEDITOR_DATA=/tmp/<pasta> NEWEDITOR_PORT=<porta livre> npm run dev`. Variáveis do processo vencem o `.env`. Copie `data/settings.json` (e perfis) para o `NEWEDITOR_DATA` temporário quando o teste depender do LLM ou de perfis.
- Servidor e web separados: `NEWEDITOR_DATA=/tmp/x NEWEDITOR_PORT=4399 npm run dev -w @neweditor/server` e `cd apps/web && NEWEDITOR_PORT=4399 npx vite --port 5199 --strictPort`.
- O servidor só carrega projetos na partida (`store.load`): copie projetos para a pasta de dados **antes** de subir. Para um projeto novo de teste, copie um existente com outro id (pasta + campo `id`).
- O servidor só serve a web se `apps/web/dist` existir.
- Saúde: `curl localhost:<porta>/api/health`.

## Interface sem abrir janela

- Playwright: use o `playwright-core` do `node_modules` com o Chrome do sistema (`chromium.launch({ channel: 'chrome' })` ou `executablePath` do Google Chrome); o Chromium do cache costuma ser de outra versão. Scripts temporários que importam o pacote precisam rodar de dentro do repo (`createRequire` do `package.json` da raiz).
- App de desktop para automação: `--hidden`, `NEWEDITOR_HIDDEN=1` ou abrir com `--remote-debugging-port=<porta>` (já é oculto; `--show` mostra). Conecte com `connectOverCDP`; nunca feche o browser pelo CDP (fecha o app), termine o script com `process.exit(0)`.
- Nunca abra janelas, apps ou abas na tela do chefe.

## Armadilhas conhecidas

- O store grava `project.json` 400 ms depois do último update. Testes que apagam pastas temporárias devem esperar as gravações (ver `gestor.test.ts`); leitura logo depois de um POST pode mostrar o estado antigo, prefira a API.
- `ebur128` escreve `I: … LUFS` em toda linha por quadro: só o bloco `Summary:` vale. `run()` de `media.ts` devolve só stdout; o relatório do ffmpeg vem por `onStderr`.
- O Qwen local às vezes devolve a string `"null"`: trate texto nulo ao validar saída do LLM.
- O texto da resposta do agente não prova efeito: compare a timeline antes e depois.
- Processos lançados com `&` ou `nohup` dentro de um comando curto morrem quando ele termina; use um processo em segundo plano dedicado e encerre-o no fim. O macOS não tem `timeout`: use `perl -e 'alarm N; exec @ARGV' <cmd>`.
- O `envelope.f32` é em dB, não amplitude.
- Render pela API: `POST /api/projects/<id>/render` devolve `job`; acompanhe com `GET /api/projects/<id>/render/<job>` até `pronto` (arquivo inteiro, com `lufs`/`truePeak`) ou `erro`. Não espere o MP4 parar de crescer. Status em memória: some quando o servidor religa.

## Regras do escritório NewContent (agentes do OpenClaw)

- Trabalhe no clone `~/.openclaw/newcontent/repos/neweditor`, em branch `office/<id-do-item>` a partir de `main` atualizada. Commits pequenos, em português, com o id do item. Commite cedo e anote no item onde parou.
- Nenhum agente faz push, merge, release ou deploy: isso é do chefe.
- Ciclo, backlog, passagem de tarefa e registro de melhorias: `~/.openclaw/newcontent/CICLO.md`.
