# Skills e plugins oficiais da Anthropic úteis para o NewEditor.AI (estado em 10/out/2026)

Escopo: o que a Anthropic publica oficialmente (repositórios `anthropics/skills`, `anthropics/claude-plugins-official`, `anthropics/knowledge-work-plugins`, `anthropics/claude-code`), skills que já vêm no Claude Code, e o que o Thales já tem ou pode instalar pelo catálogo da conta. Nada foi instalado nesta pesquisa.

Fontes locais consultadas (dados da máquina do usuário, não são páginas web):
- Catálogo da conta claude.ai: ferramentas `ListPlugins`, `ListSkills`, `SearchPlugins` e `SearchSkills`, consultadas em 10/10/2026. Abaixo aparecem como "[Catálogo do usuário]".
- `~/.claude/plugins/installed_plugins.json`, `~/.claude/settings.json` e `~/.claude/plugins/plugin-directory-cache-v2.json`. O último é o cache do diretório de plugins, `fetchedAt` 2026-10-10T01:38Z, com 3.250 listagens. Abaixo aparecem como "[Cache local do diretório]".
- Estado do repo `/Users/thalesrioss/Documents/Claude/Co-Editor`: `git rev-parse`, `git remote -v` e `apps/server/package.json`. Abaixo aparece como "[Repo local]".

---

## 1. O que existe hoje no repositório oficial anthropics/skills, e o que importa para o NewEditor.AI

### Takeaway
O `anthropics/skills` tem 19 skills. Elas são distribuídas como marketplace (`anthropic-agent-skills`) em cinco plugins: `document-skills`, `example-skills`, `claude-api`, `academy-guide` e `discernment-nudge`. Para o NewEditor.AI, as que mais importam são **skill-creator** (já habilitada), **webapp-testing**, **frontend-design** e **mcp-builder**. Num segundo nível vêm **algorithmic-art**, **doc-coauthoring**, **pdf** e **xlsx**. As demais são irrelevantes ou só servem de modelo.

### Cited Findings
**Repositório, licença e instalação**
- As 19 pastas em `skills/` são: academy-guide, algorithmic-art, brand-guidelines, canvas-design, claude-api, discernment-nudge, doc-coauthoring, docx, frontend-design, internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing e xlsx — [GitHub tree](https://github.com/anthropics/skills/tree/main/skills)
- O marketplace se chama `anthropic-agent-skills`, versão 1.0.0, com owner Keith Lazuka. Os plugins são:
  - `document-skills`: xlsx, docx, pptx, pdf.
  - `example-skills`: algorithmic-art, brand-guidelines, canvas-design, doc-coauthoring, frontend-design, internal-comms, mcp-builder, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing.
  - `claude-api`, `academy-guide` e `discernment-nudge`.
  - [marketplace.json](https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json)
- Para instalar no Claude Code: `/plugin marketplace add anthropics/skills`, depois `/plugin install document-skills@anthropic-agent-skills` ou `/plugin install example-skills@anthropic-agent-skills` — [README anthropics/skills](https://github.com/anthropics/skills)
- Licenças e aviso:
  - Muitas skills são Apache 2.0. `docx`, `pdf`, `pptx` e `xlsx` são *source-available*, não open source.
  - O README avisa que as skills são "for demonstration and educational purposes only" e pede para testar antes de usar em tarefas críticas.
  - Números do repo: cerca de 180,3k stars, 21,3k forks, 398 issues abertas.
  - [README anthropics/skills](https://github.com/anthropics/skills)
- Conferi o `LICENSE.txt` de frontend-design, webapp-testing, skill-creator e mcp-builder: os quatro começam com "Apache License" — [LICENSE frontend-design](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/LICENSE.txt), [webapp-testing](https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/LICENSE.txt), [skill-creator](https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/LICENSE.txt), [mcp-builder](https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/LICENSE.txt)
- Atividade recente:
  - Último commit em 9/10/2026, na skill claude-api ("dynamic workflows and the four workflow quickstarts").
  - frontend-design foi atualizada em 3/9/2026 ("avoid generic design defaults").
  - Em 18/8/2026, `claude-academy-guide` foi renomeada para `academy-guide`.
  - Os demais commits recentes mexem quase só na claude-api.
  - [Commits anthropics/skills](https://github.com/anthropics/skills/commits/main)
- O post de engenharia "Equipping agents for the real world with Agent Skills" é de 16/10/2025, de Barry Zhang, Keith Lazuka e Mahesh Murag. Ele define skills como pastas com instruções, scripts e recursos, carregadas por *progressive disclosure*: metadados no início, SKILL.md quando a skill é relevante, arquivos extras sob demanda. Uma nota de atualização diz que Agent Skills virou padrão aberto. Não consegui abrir o post: a data e o resumo vêm de trechos de busca — [Anthropic Engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

**Cada skill e a relevância para o NewEditor.AI**

| Skill | O que faz (fonte: frontmatter do SKILL.md) | Relevância |
|---|---|---|
| **skill-creator** | Cria e melhora skills e mede o desempenho delas: evals com baseline sem a skill (ou com a versão antiga), benchmark com média e desvio padrão, viewer HTML e otimização da `description` (cerca de 20 queries, split 60/40 treino/teste, até 5 iterações) — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md) | **Alta**. Serve para transformar as regras de decupagem, o Gestor de Projetos e o Cinéfilo.AI em skills testáveis, com evals comparáveis ao `npm run bench`. |
| **webapp-testing** | Testa apps web locais com Playwright: verifica a UI, tira screenshots e captura o console. Inclui `scripts/with_server.py`, que sobe um ou mais servidores (`--server ... --port ... -- <comando>`), e exemplos como `element_discovery.py` e `console_logging.py`. Depende do Playwright para **Python** (`sync_playwright`, Chromium headless) — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md) | **Alta**. Testes E2E do Editor Brain (Vite :5173 + Fastify) e do fluxo Kanban "Revisão da decupagem", com evidência em screenshot. |
| **frontend-design** | Orienta um design visual intencional, fugindo de padrões "templated". Pede de 4 a 6 cores nomeadas com hex e tipografia como personalidade. Quer motion contido ("one orchestrated moment"), e o piso de qualidade inclui foco visível, *reduced-motion* e acessibilidade — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md) | **Alta**. UI do Editor Brain, Kanban e telas do avatar. |
| **mcp-builder** | Guia para criar servidores MCP em Python (FastMCP) ou Node/TypeScript (MCP SDK) — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md) | **Média-alta**. Daria para expor as operações de timeline e render do NewEditor, ou o vault "Cérebro do Editor", como MCP local (stdio), sem API paga. |
| **algorithmic-art** | Arte generativa em p5.js com aleatoriedade *seeded* e parâmetros interativos — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/algorithmic-art/SKILL.md) | **Média**. Fundos e texturas de motion determinísticos, o que combina com o render via `window.seek(t)` no Chrome headless. |
| **doc-coauthoring** | Fluxo estruturado para coescrever specs, propostas e documentos de decisão — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/doc-coauthoring/SKILL.md) | **Média**. Specs dos agentes e ADRs. |
| **canvas-design** | Peças estáticas (pôster, design) em .png e .pdf a partir de uma "design philosophy" — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/canvas-design/SKILL.md) | Baixa-média. Thumbnails e peças estáticas. |
| **slack-gif-creator** | Conhecimento e utilitários para GIFs animados (restrições, validação, conceitos de animação) — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/slack-gif-creator/SKILL.md) | Baixa-média. Pode servir de referência para exportar o avatar pixel-art em GIF. |
| **web-artifacts-builder** | Artifacts claude.ai com várias partes (React, Tailwind, shadcn/ui) — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/web-artifacts-builder/SKILL.md) | Baixa. Protótipos rápidos fora do repo. |
| **theme-factory** | 10 temas prontos (cores e fontes) para estilizar artifacts — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/theme-factory/SKILL.md) | Baixa. |
| **brand-guidelines** | Aplica a identidade visual da **Anthropic** — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/brand-guidelines/SKILL.md) | Só como modelo para criar uma skill de marca NewContent. |
| **internal-comms** | Status reports, updates e newsletters internas — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/internal-comms/SKILL.md) | Baixa. |
| **pdf / xlsx / docx / pptx** | Suite de documentos *source-available* — [README](https://github.com/anthropics/skills) | Média: pdf para ler briefings de cliente, xlsx para estimativas de tempo do Gestor de Projetos. **Já habilitadas** na conta (ver seção 4). |
| **claude-api** | Referência da Claude API e do SDK. Dispara automaticamente quando o projeto usa `@anthropic-ai/sdk` — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/claude-api/SKILL.md) | **Conflita com a restrição** "sem API paga". Ver a seção 3. |
| **academy-guide / discernment-nudge** | Recomendam cursos da Claude Academy / acrescentam 2-3 perguntas de checagem depois de respostas substantivas — [SKILL.md academy-guide](https://raw.githubusercontent.com/anthropics/skills/main/skills/academy-guide/SKILL.md), [SKILL.md discernment-nudge](https://raw.githubusercontent.com/anthropics/skills/main/skills/discernment-nudge/SKILL.md) | Irrelevantes. |

### Inferences
- Instalar o `example-skills@anthropic-agent-skills` inteiro traz 12 skills de uma vez, e a maioria não serve ao projeto. Elas custariam contexto, já que as descrições ficam sempre carregadas. Uma alternativa melhor é copiar só `webapp-testing/` (e talvez `mcp-builder/`) para `.claude/skills/` do projeto. A doc confirma que skills de projeto ficam em `.claude/skills/<nome>/SKILL.md` ([docs skills](https://code.claude.com/docs/en/skills)).
- `webapp-testing` usa Playwright em Python, mas o servidor já usa `playwright-core` em Node ([Repo local]: `apps/server/package.json` tem `"playwright-core": "^1.64.0"`). Faz sentido adaptar o padrão `with_server.py` e os scripts de exemplo para Node, ou usar o painel de browser integrado com `/run` e `/verify` (seção 3), em vez de instalar uma segunda stack Playwright.
- Nenhuma skill oficial trata de vídeo, FFmpeg, ASR ou color grading. O ganho no **produto** vem indireto: UI melhor, testes e MCP. O ganho no **processo de desenvolvimento** é direto.

### Gaps
- Não consegui a data do último commit de cada skill além de frontend-design e claude-api. A API do GitHub devolveu 403 e o `gh` não está instalado.
- Não abri o texto completo do post de engenharia (só trechos de busca).

---

## 2. Plugins e marketplaces oficiais do Claude Code: o que cada um contém

### Takeaway
A Anthropic mantém três marketplaces gerais:
- **official** (`claude-plugins-official`, adicionado automaticamente);
- **community** (`claude-community`);
- **demo** (`claude-code-plugins`, no repo `anthropics/claude-code`, legado e duplicado).

Há também marketplaces temáticos: `anthropics/skills` e `anthropics/knowledge-work-plugins`. Para o NewEditor.AI, os plugins oficiais de maior valor são estes: **hookify**, **typescript-lsp**, **security-guidance**, **pr-review-toolkit**, **feature-dev**, **frontend-design**, **claude-code-setup**, **claude-md-management**, **playground** e **mcp-server-dev**. Num segundo nível ficam **skill-creator**, **plugin-dev**, **ralph-loop**, **claude-security** e **project-artifact**.

### Cited Findings
**Marketplaces**
- Official, community e demo:

  | | Official | Community | Demo |
  |---|---|---|---|
  | Repo | `anthropics/claude-plugins-official` | `anthropics/claude-plugins-community` | `anthropics/claude-code` |
  | Nome do marketplace | `claude-plugins-official` | `claude-community` | `claude-code-plugins` |
  | Como entra | Adicionado na primeira sessão interativa | `/plugin marketplace add` | `/plugin marketplace add` |

  Os plugins do demo também estão no official ("code-review, feature-dev, commit-commands, and security-guidance are in both"), e a doc recomenda instalar pelo official para não ter duas cópias — [docs Anthropic's marketplaces](https://code.claude.com/docs/en/plugins/anthropic-marketplaces)
- Instalação: `/plugin install <nome>@claude-plugins-official`, escolhendo o escopo:
  - user: `~/.claude/settings.json`;
  - project: `.claude/settings.json`, versionado;
  - local: `.claude/settings.local.json`.

  No **app desktop**: **+ > Plugins > Add plugin**. O painel mostra "Will install" e, para o official, "Last updated" e "Context cost". No shell, `claude plugin details <nome>` mostra os tokens *always-on* — [docs discover/install plugins](https://code.claude.com/docs/en/discover-plugins)
- Auto-update vem ligado por padrão no `claude-plugins-official`, mas **não** no `knowledge-work-plugins` nem no `first-party-plugins` — [docs discover/install plugins](https://code.claude.com/docs/en/discover-plugins)
- Plugins habilitados na conta claude.ai sincronizam para o Claude Code como `<nome>@synced` — [docs discover/install plugins](https://code.claude.com/docs/en/discover-plugins)
- O repo `claude-plugins-official` tem cerca de 37,6k stars e licença Apache-2.0, mas o licenciamento varia por plugin. `/plugins` guarda os plugins internos da Anthropic e `/external_plugins` os de parceiros e comunidade. Aviso do repo: "Anthropic does not control what MCP servers, files, or other software are included in plugins" — [README claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- Atividade: último commit em 9/10/2026. Inclui merges "oct/sg-2.0.12" e "oct/sg-prompt-cache", ambos do security-guidance — [Commits claude-plugins-official](https://github.com/anthropics/claude-plugins-official/commits/main)
- Plugins em `plugins/` (internos), 40 pastas:
  - **Gerais:** agent-sdk-dev, claude-code-setup, claude-md-management, claude-security, code-modernization, code-review, code-simplifier, commit-commands, cwc-makers, example-plugin, explanatory-output-style, feature-dev, frontend-design, hookify, learning-output-style, math-olympiad, math-proof, mcp-server-dev, mcp-tunnels, playground, plugin-dev, pr-review-toolkit, project-artifact, ralph-loop, receipts, security-guidance, session-report, skill-creator.
  - **LSPs:** clangd, csharp, gopls, jdtls, kotlin, lua, php, pyright, ruby, rust-analyzer, swift, typescript.
  - [GitHub tree plugins/](https://github.com/anthropics/claude-plugins-official/tree/main/plugins)

**Plugins oficiais relevantes: conteúdo e uso no NewEditor.AI**

| Plugin (`@claude-plugins-official`) | Conteúdo | Como ajuda o NewEditor.AI |
|---|---|---|
| **hookify** | Comandos `/hookify`, `/hookify:list`, `/hookify:configure` e `/hookify:help`, agente `conversation-analyzer` e skill `writing-rules`. As regras são arquivos `.claude/hookify.*.local.md` (YAML + regex) e valem sem reiniciar — [README hookify](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/hookify/README.md), [demo plugins table](https://github.com/anthropics/claude-code/tree/main/plugins) | Transforma as regras de memória em travas reais (exemplos na lista abaixo da tabela). |
| **typescript-lsp** | LSP para .ts/.tsx/.js/.mjs etc. (go-to-definition, referências, erros). Exige `npm install -g typescript-language-server typescript` — [README typescript-lsp](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/typescript-lsp/README.md) | Navegação semântica no monorepo (core/server/web). O binário **não está instalado** ([Repo local]: `which typescript-language-server` não encontrou nada). |
| **security-guidance** | Três camadas: (1) regex em Edit/Write para cerca de 25 padrões perigosos (innerHTML, segredos, YAML/pickle); (2) hook **Stop** que manda o diff a um LLM; (3) revisor agêntico no `git commit`/push que segue o fluxo de dados entre arquivos (IDOR, SSRF etc.). Configuração por variáveis como `ENABLE_STOP_REVIEW`, `SG_DUAL_OR` e `SECURITY_REVIEW_MODEL`. Regras da organização vão em `claude-security-guidance.md` — [README security-guidance](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/security-guidance/README.md) | O servidor monta comandos FFmpeg, baixa material do Drive e de sites (clip.cafe) e serve arquivos locais. Por isso injeção de shell, path traversal e SSRF são riscos reais. |
| **pr-review-toolkit** | `/pr-review-toolkit:review-pr` e 6 agentes: comment-analyzer, pr-test-analyzer, **silent-failure-hunter**, **type-design-analyzer**, code-reviewer, code-simplifier — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/pr-review-toolkit/README.md) | O silent-failure-hunter serve para o pipeline FFmpeg/ASR/RNNoise (erros engolidos). O type-design-analyzer serve para os tipos de timeline em `packages/core`. |
| **feature-dev** | `/feature-dev` em 7 fases (discovery, perguntas, arquitetura, implementação, review) com os agentes code-explorer, code-architect e code-reviewer — [README feature-dev](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/feature-dev/README.md) | Bom para features grandes ainda pendentes: Gestor de Projetos (Drive, briefing, estimativa) e Cinéfilo.AI. |
| **frontend-design** | Skill `frontend-design`, mesma linha da skill do `anthropics/skills`. Autores: Prithvi Rajasekaran e Alexander Bricken — [README frontend-design](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/frontend-design/README.md) | UI do Editor Brain e do Kanban. |
| **claude-code-setup** | Skill **somente leitura** que analisa o codebase e recomenda 1-2 automações por categoria (MCP, skills, hooks, subagents, comandos) — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/claude-code-setup/README.md) | Um diagnóstico rápido e sem risco das automações que valem a pena no monorepo. |
| **claude-md-management** | Skill `claude-md-improver` (audita o CLAUDE.md contra o código) e comando `/revise-claude-md` (registra o que se aprendeu na sessão) — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/claude-md-management/README.md) | Mantém a memória do projeto atualizada: portas, benchmarks, projeto *ground truth* intocável. |
| **playground** | Gera HTML de arquivo único com controles, preview ao vivo e um prompt para copiar. Templates: design-playground, data-explorer, concept-map, document-critique — [README playground](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/playground/README.md) | Afinar visualmente estilos de legenda e lettering, curvas de ducking e parâmetros de LUT, e devolver ao Claude um prompt exato. |
| **mcp-server-dev** | Skills `build-mcp-server` (escolhe entre HTTP remoto, MCPB e stdio local), `build-mcp-app` (widgets na conversa) e `build-mcpb` (empacota servidor local com runtime) — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/mcp-server-dev/README.md) | Um MCP local do NewEditor (timeline, render, Kanban) permitiria que o Claude desktop "pilote" o editor sem API paga dentro do produto. |
| **skill-creator** | Mesma skill do repositório de skills, em versão plugin — [cache/README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/skill-creator/.claude-plugin/plugin.json) | Já disponível via claude.ai (seção 4). |
| **plugin-dev** | 7 skills (agent-, command-, hook-, skill-development, mcp-integration, plugin-settings, plugin-structure), `/plugin-dev:create-plugin` e os agentes agent-creator, plugin-validator e skill-reviewer — [Catálogo do usuário: SearchPlugins], [demo plugins table](https://github.com/anthropics/claude-code/tree/main/plugins) | Empacotar o "sistema editorial" e os agentes do NewEditor como plugin versionado. |
| **ralph-loop** | `/ralph-loop "<tarefa>" --completion-promise "DONE"`. Um hook Stop devolve o mesmo prompt até a tarefa terminar — [README ralph-loop](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/ralph-loop/README.md) | Dá para iterar regras de decupagem até atingir a meta dos dois benchmarks (`bench` e `bench:final`). Cuidado com custo e com overfitting. |
| **claude-security** | v0.12.0. `/claude-security` faz scan do codebase, scan de mudanças e sugere patches, com cada achado verificado por agentes. Recomenda Opus 5.5 ou Fable 5.1. Roda na sessão com as permissões do usuário, sem isolamento próprio — [README claude-security](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/claude-security/README.md) | Auditoria pesada e pontual antes de levar ao NewContent ou ao GitHub. |
| **project-artifact** | `/project-artifact` publica uma página de status com abas como Artifact privado e atualiza na mesma URL ("refresh the artifact"). Exige login claude.ai e a ferramenta Artifact; `gh` é opcional — [README project-artifact](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/project-artifact/README.md) | Painel de status do NewEditor.AI (Editor Brain, Kanban, Gestor, Cinéfilo). |
| **code-review** (plugin) | `/code-review` com agentes de conformidade ao CLAUDE.md, detector de bugs, análise de histórico e scorers. Filtra achados com confiança abaixo de 80. **Exige `gh` autenticado e um PR no GitHub** e posta um comentário — [README code-review](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/README.md) | Só depois de existir repositório GitHub. Para diffs locais, o `/code-review` embutido (seção 3) já resolve. |
| **commit-commands** | `/commit`, `/commit-push-pr`, `/clean_gone` — [docs install](https://code.claude.com/docs/en/discover-plugins), [demo plugins table](https://github.com/anthropics/claude-code/tree/main/plugins) | Baixa por enquanto: a regra é não commitar ou dar push sem pedido. |
| **code-simplifier** | Agente que simplifica código preservando o comportamento — [Cache local do diretório] | Já coberto pelo `/simplify` embutido. |
| **agent-sdk-dev** | `/new-sdk-app` e os agentes agent-sdk-verifier-py e agent-sdk-verifier-ts — [demo plugins table](https://github.com/anthropics/claude-code/tree/main/plugins) | **Não recomendado** para o produto: o Agent SDK pressupõe acesso à API da Anthropic (ver a seção 5). |
| session-report, receipts, explanatory/learning-output-style | Relatórios de uso e de impacto; estilos de saída didáticos — [Cache local do diretório] | Opcionais. |

Exemplos de regras hookify para o NewEditor.AI (inferência a partir do README):
- avisar ou bloquear edição em `prj_mv1tcs9p1vslt` (a decupagem *ground truth*);
- bloquear `rm -rf` em `/Volumes/Thales SSD`;
- avisar quando código de produto importar `@anthropic-ai/sdk`;
- avisar sobre `git commit`/`git push` sem pedido explícito.

**Plugins externos dentro do official (parceiros)**
- `playwright`: MCP de automação de browser da Microsoft, em `external_plugins/playwright`.
- `context7`: MCP **hospedado** da Upstash, com documentação por versão. Usa `https://mcp.context7.com/mcp` e pede autenticação.
- `serena`: análise semântica via LSP.
- `github`: MCP oficial do GitHub.
- [Cache local do diretório]; [Catálogo do usuário: SearchPlugins]

**knowledge-work-plugins (Anthropic)**
- O repo é Apache-2.0, com cerca de 28,7k stars, e tem 18 pastas. Instala com `claude plugin marketplace add anthropics/knowledge-work-plugins` e depois `claude plugin install <plugin>@knowledge-work-plugins`. Os plugins combinam skills com conectores MCP (Slack, Linear, Figma, Notion etc.) — [README knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)
- Também traz plugins como `data`, `productivity`, `operations`, `small-business` e `partner-built/brand-voice` — [Cache local do diretório]

**Marketplace demo (legado)**
- O `anthropics/claude-code/plugins` tem 13 plugins, entre eles `ralph-wiggum` (equivale ao `ralph-loop` do official) e `claude-opus-4-5-migration`. O `security-guidance` de lá é a versão antiga: só PreToolUse, "Monitors 9 security patterns" — [GitHub claude-code/plugins](https://github.com/anthropics/claude-code/tree/main/plugins)

### Inferences
- Para um fundador solo, os de melhor custo-benefício para o desenvolvimento são hookify, typescript-lsp e security-guidance. Os três trabalham **passivamente**, em todo turno ou commit, sem exigir disciplina extra.
- feature-dev e pr-review-toolkit valem para os próximos marcos grandes (Gestor de Projetos, Cinéfilo.AI).
- Para o **produto**, o oficial com mais potencial é o mcp-server-dev (ou o mcp-builder). Um MCP stdio local transforma o NewEditor numa ferramenta que o Claude desktop do editor humano consegue operar, sem chave de API dentro do produto.
- Evitar o marketplace demo (`anthropics/claude-code`): `ralph-wiggum`, `claude-opus-4-5-migration` e o `security-guidance` antigo estão obsoletos ou duplicados.

### Gaps
- Não obtive o README de `session-report` nem de `code-simplifier` (vazios ou ausentes) e não medi o "Context cost" de cada plugin. Esse número aparece no painel `/plugin` ou em `claude plugin details`.
- A versão exata do security-guidance (2.0.12) é inferida do nome do branch "oct/sg-2.0.12", não de um manifesto.

---

## 3. Skills e comandos embutidos no Claude Code e como se aplicam

### Takeaway
O Claude Code 2.1.292 instalado já traz skills embutidas que cobrem boa parte do que plugins fariam:
- `/code-review` (alias `/review`), `/simplify`, `/security-review`;
- `/run`, `/verify`, `/run-skill-generator`, `/batch`, `/loop`, `/debug`;
- `/doctor`, `/skill-doctor`, `/fewer-permission-prompts`, `/claude-api`;
- o workflow `/deep-research`, além de `/init` e `/insights`.

Algumas dependem de git com commits e remote, e o repo do NewEditor **ainda não tem commits nem remote**.

### Cited Findings
- **Bundled skills (docs):**
  - `/doctor` faz um checkup do setup; `/doctor prompt-audit` audita CLAUDE.md e skills.
  - `/code-review` roda como subagente fork desde a v2.1.218.
  - `/claude-api` aceita os subcomandos migrate, upgrade, managed-agents-onboard, prompt-audit, cost-optimize, build-eval, hillclimb e preserved-thinking-migration.
  - `/run` e `/verify` sobem o app e confirmam a mudança rodando-o.
  - `/run-skill-generator` grava a receita em `.claude/skills/run-<nome>/`.
  - `/skill-doctor` mostra o custo de contexto e o uso de cada skill.
  - Bundled skills podem ser desligadas com `disableBundledSkills` ou ocultadas uma a uma com `skillOverrides`.
  - [docs skills](https://code.claude.com/docs/en/skills)
- **`/code-review [low…max|ultra] [--fix] [--comment] [--max-findings]`** revisa o diff atual (ou PR, branch ou caminho) atrás de bugs de correção. `ultra` roda revisão profunda na nuvem (3 execuções grátis em Pro e Max, depois créditos). `/review` é alias desde a v2.1.223 — [docs commands](https://code.claude.com/docs/en/commands)
- **`/simplify [target]`**: 4 agentes em paralelo (reuso, simplificação, eficiência, nível de abstração). Não procura bugs — [docs commands](https://code.claude.com/docs/en/commands)
- **`/security-review`** analisa o diff do branch contra o branch padrão do `origin`. "Needs an `origin` remote" — [docs commands](https://code.claude.com/docs/en/commands)
- **`/batch <instrução>`** quebra a mudança em 5 a 30 unidades e roda um subagente por unidade, cada um num worktree isolado. Requer repositório git ou hook `WorktreeCreate`. Fora de git, exige v2.1.281 ou superior — [docs commands](https://code.claude.com/docs/en/commands)
- **`/loop [intervalo] [prompt]`** repete um prompt durante a sessão. **`/debug`** liga o log de debug e o analisa. **`/fewer-permission-prompts`** gera uma allowlist em `.claude/settings.json`. **`/deep-research`** é um workflow de pesquisa com fontes cruzadas. **`/init`** gera o CLAUDE.md (`CLAUDE_CODE_NEW_INIT=1` ativa o fluxo interativo com skills e hooks). **`/insights`** gera um relatório HTML de uso — [docs commands](https://code.claude.com/docs/en/commands)
- **`/claude-api`** "activates automatically when your code imports `anthropic` or `@anthropic-ai/sdk`" — [docs commands](https://code.claude.com/docs/en/commands)
- **Estado do repo [Repo local]:**
  - `git rev-parse` responde `true`, mas "your current branch 'main' does not have any commits yet".
  - `git remote -v` não lista nenhum remote e `gh` não está instalado.
  - `claude --version` mostra 2.1.292.
  - `apps/server/package.json` declara `"@anthropic-ai/sdk": "^0.133.0"`.
  - `.claude/launch.json` tem a config `neweditor` (`npm run dev`, porta 5173).
- **Segurança de skills:** `allowed-tools` concede permissão sem prompt. Skills de projeto vindas de repositórios clonados aplicam essas permissões mesmo em pastas não confiáveis. `` !`cmd` `` executa antes de o Claude ver a skill, e `disableSkillShellExecution` desliga isso — [docs skills](https://code.claude.com/docs/en/skills)

### Inferences
- **Usar já, sem instalar nada:**
  - `/run-skill-generator`: grava como subir o monorepo (Vite :5173 + Fastify em `NEWEDITOR_PORT` + `services/asr`) para que `/run` e `/verify` funcionem sempre.
  - `/simplify` e `/code-review medium --fix`: depois de cada feature.
  - `/skill-doctor`: a conta tem muitas skills de marketing e Instagram que não ajudam no desenvolvimento e consomem contexto.
  - `/fewer-permission-prompts`.
- **Antes de `/security-review` e `/batch`:** é preciso o commit inicial (e um remote, no caso do `/security-review`). Isso é ação do usuário, porque a regra é não commitar sem pedido.
- **Conflito com a restrição "sem API paga":** o servidor ainda depende de `@anthropic-ai/sdk`, então a skill `claude-api` vai disparar sozinha em qualquer tarefa que toque esse código e puxar o desenvolvimento para a API paga. Vale decidir: remover a dependência ou isolá-la atrás de um provedor "local-first". A memória do projeto registra as duas coisas, "Claude via @anthropic-ai/sdk" e "não usar API paga" (`~/.claude/projects/.../memory/`).

### Gaps
- A página de skills foi lida só até 100k caracteres. Pode haver bundled skills adicionais não listadas aqui; `/workflow-authoring` só aparece com *dynamic workflows* ativados.

---

## 4. O que o Thales já tem e o que pode instalar pelo catálogo da conta

### Takeaway
Na conta claude.ai estão **habilitados** cinco plugins: `engineering`, `design`, `product-management` e `marketing` (Anthropic, knowledge-work) e `instagram-agent` (terceiro). Também estão habilitadas as skills Anthropic `skill-creator`, `docx`, `pdf`, `pptx`, `xlsx` e `deep-research`, além das 10 skills do "sistema editorial" e de `copy-to-image`. Localmente, o único plugin instalado é `claude-animation` (**terceiro**), e há a skill pessoal `motion-designer`. Os plugins oficiais de maior valor (frontend-design, plugin-dev, feature-dev, pr-review-toolkit, commit-commands, agent-sdk-dev) aparecem no catálogo como **disponíveis, não habilitados**.

### Cited Findings
**Já habilitado na conta** [Catálogo do usuário: ListPlugins/ListSkills]

Plugins:

| Plugin | ID | Origem | Conteúdo |
|---|---|---|---|
| `engineering` | `plugin_01FTLa86dhbVJ3HB1LdHdhN7` | Anthropic, knowledge-work | architecture (ADR), code-review, debug, deploy-checklist, documentation, incident-response, standup, system-design, tech-debt, testing-strategy |
| `design` | `plugin_01XXJmxLXPEhPMmnxmrgntNw` | Anthropic, knowledge-work, v1.2.0 | accessibility-review, design-critique, design-handoff, design-system, research-synthesis, user-research, ux-copy. MCPs: asana, atlassian, figma, gmail, google calendar, intercom, linear, notion, slack |
| `product-management` | `plugin_01AYHYqVLaZRH2Vi6aHgDwEw` | Anthropic, knowledge-work | write-spec, roadmap-update, sprint-planning, brainstorm/product-brainstorming, competitive-brief, synthesize-research, metrics-review, stakeholder-update |
| `marketing` | `plugin_01Eeb9y5m4iFuY3yRtytYfdc` | Anthropic, knowledge-work | — |
| `instagram-agent` | `plugin_01J7C8VLEPJqMjTBVGhg9hLa` | terceiro | 13 skills |

Skills:
- **Anthropic:** `skill-creator`, `docx`, `pdf`, `pptx`, `xlsx`, `deep-research`, `docs`, `google-workspace`, `computer-use`, `chrome-browser`, `built-in-browser`, `morning`, `import-memory`.
- **Do usuário:** analista-de-conteudo, copywriter-sistema-editorial, roteirista-sistema-editorial, analista-de-material, diretor-narrativo, editor-sistema-editorial, sound-designer (respaldado pelo plugin `plugin_01XBXdQkRXHTv1Pa17btcuHM`), qc-analista-de-retencao, orquestrador-editorial, copy-to-image, copywriter, social-skills.

Conectores MCP desses plugins que **exigem OAuth não feito**: github, datadog, pagerduty, figma, linear, notion, slack, asana, atlassian etc. As skills funcionam sem eles. (Mensagem do sistema da sessão listando os servidores que precisam de autenticação.)

**Instalado localmente** [`~/.claude/plugins/installed_plugins.json`, `~/.claude/settings.json`]:
- `claude-animation@claude-animation-skill`, v1.0.0, instalado em 07/10/2026, marketplace `buildwithhanif/claude-animation-skill` (**terceiro, não oficial**).
- Skill pessoal `~/.claude/skills/motion-designer`.
- O `claude-plugins-official` **não** aparece em `known_marketplaces.json`. Ele é adicionado na primeira sessão interativa de terminal ([docs](https://code.claude.com/docs/en/plugins/anthropic-marketplaces)), e o usuário usa o app desktop. Se faltar: `/plugin marketplace add anthropics/claude-plugins-official`.

**Disponíveis no catálogo, NÃO habilitados** (Anthropic Directory, publisher tier "anthropic") [Catálogo do usuário: SearchPlugins]:

| Plugin | ID | Upstream |
|---|---|---|
| `frontend-design` | `plugin_011XJXyLY2skJXTKdTJcsNBn` | `claude-plugins-official/plugins/frontend-design` |
| `plugin-dev` | `plugin_013uBdVK7isFavtGcttzzWdE` | — |
| `feature-dev` | `plugin_01QVM1JUp8XqCuzk1YxhqSZA` | — |
| `pr-review-toolkit` | `plugin_01XsvpEPhkDPee4oUnno651x` | — |
| `commit-commands` | `plugin_016Yuj5SeCp9zzVHWwvmjgwZ` | — |
| `agent-sdk-dev` | `plugin_011caoP85j8NpXruD4GRtELq` | — |
| `playwright` (parceiro Microsoft) | `plugin_011xRqaX2xpKG67yUtzs71jb` | — |

Os demais oficiais da seção 2 (hookify, typescript-lsp, security-guidance, claude-code-setup, claude-md-management, playground, mcp-server-dev, ralph-loop, claude-security, project-artifact) estão no diretório com "review by anthropic" [Cache local do diretório] e instalam via `/plugin install <nome>@claude-plugins-official`.

**Terceiros relevantes vistos no catálogo/diretório (NÃO oficiais; revisão de diretório nível "community"; avaliar código antes)** [Cache local do diretório; Catálogo do usuário: SearchPlugins]:
- **Vídeo:** Remotion (`remotion-dev/claude-code-plugin`: vídeo programático em React, captions, áudio), watch-video (`marcinsufa/claude-watch-video`: keyframes via ffmpeg + faster-whisper local), ffmpeg-llm (`rendi-api/ffmpeg-llm`: gera comandos FFmpeg), Video Cleanup (`mehdi-ks/video-cleanup`), IT Reelsmaker (`itpartypattaya/reels-montage`: corte de pausas e retakes por áudio), OpenClip, Notes-to-Video (Manim + TTS + ffmpeg).
- **Áudio:** Audiorective (Web Audio, `plugin_01EehybmvtMqzdpQ4VJpfmVT`).
- **Obsidian:** Obsidian Notes (`m4bwav/obsidian-notes`), obsidian-sync.
- **UI/UX:** VectorLab UI/UX Skills (inclui motion e reduced-motion), A11y Enforcer, ux-ui-audit.
- **React:** "Skills For Real React/React Native Engineers" (GSAP, ui-motion, monorepo-architect).
- **Backend:** "Backend Design" (idempotência, observabilidade, hook PreToolUse).

### Inferences
- **Já dá para usar sem instalar:**
  - `engineering:testing-strategy` (Kanban e gates de revisão);
  - `engineering:architecture`/`system-design` (ADRs: WebCodecs vs FFmpeg, ASR local);
  - `engineering:tech-debt`, `design:design-critique` e `design:accessibility-review` (Editor Brain);
  - `design:ux-copy` (microcopy PT-BR do Kanban);
  - `product-management:write-spec` (Gestor de Projetos, Cinéfilo.AI);
  - `pdf`/`xlsx` (briefing e estimativa);
  - `skill-creator` (evals das regras de decupagem).
- Há redundância: `engineering:code-review` (plugin) e `/code-review` (embutido). O embutido é mais completo para diffs locais (níveis de esforço, `--fix`).
- `marketing` e `instagram-agent` não ajudam no desenvolvimento do NewEditor. Desativá-los neste projeto (escopo local) reduz o custo de contexto. Conferir com `/skill-doctor`.
- Os plugins de vídeo de terceiros (Remotion, watch-video, IT Reelsmaker) sobrepõem funcionalidades centrais do NewEditor. Servem mais como **referência de implementação** do que como dependência. Este levantamento não verificou a qualidade nem a segurança deles.

### Gaps
- `ListPlugins` só mostra plugins da conta claude.ai, não os locais. Não executei `claude plugin list` para confirmar plugins sincronizados como `@synced`.
- Não chequei se o `claude-plugins-official` está registrado nas sessões do app desktop (o `known_marketplaces.json` local não o lista).

---

## 5. Maturidade, atualização, licença e ressalvas de cada item relevante

### Takeaway
Os itens oficiais são ativamente mantidos: os dois repositórios principais tiveram commits em 9/10/2026. Para o desenvolvimento, quase todos usam a sessão do Claude Code (assinatura) e não exigem chave de API no produto. Os pontos de atenção são quatro:
- custo de LLM extra (security-guidance, claude-security, ralph-loop, `/code-review ultra`);
- dependências locais (Python Playwright, typescript-language-server, `gh`);
- código de terceiros com permissões do usuário;
- **agent-sdk-dev e claude-api, que empurram o produto para a API paga.**

### Cited Findings
- **Atualização:**
  - `anthropics/skills`: commits em 9/10/2026 (claude-api) e 3/9/2026 (frontend-design) — [commits](https://github.com/anthropics/skills/commits/main)
  - `claude-plugins-official`: commits diários; o último é de 9/10/2026, com merges do security-guidance — [commits](https://github.com/anthropics/claude-plugins-official/commits/main)
  - `claude-security` está na v0.12.0 (pré-1.0) — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/claude-security/README.md)
  - `design` (knowledge-work) está na v1.2.0, atualizado em 22/09/2026 [Catálogo do usuário].
- **Licença:**
  - Skills de exemplo: Apache 2.0. `docx`/`pdf`/`pptx`/`xlsx`: *source-available* — [README skills](https://github.com/anthropics/skills)
  - `claude-plugins-official`: Apache-2.0 no repo, mas "Licensing varies by plugin" — [README](https://github.com/anthropics/claude-plugins-official)
  - `knowledge-work-plugins`: Apache-2.0 — [README](https://github.com/anthropics/knowledge-work-plugins)
- **Custo e uso de LLM:**
  - **security-guidance:** o hook Stop envia o diff ao endpoint configurado e consulta o modelo Opus mais novo (fallback `claude-opus-5-5`). O revisor de commit usa o alias `opus`. Funciona com "a subscription, an API key, or a third-party provider". `SG_DUAL_OR=on` dobra o custo. Diffs e conteúdo de arquivos vão ao endpoint do modelo — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/security-guidance/README.md)
  - **skill-creator:** a otimização de descrição roda `claude -p` em subprocesso (a CLI do Claude Code) — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md)
  - **`/code-review ultra`:** 3 execuções grátis em Pro e Max, depois créditos de uso — [docs commands](https://code.claude.com/docs/en/commands)
- **Dependências locais:**
  - typescript-lsp exige `npm i -g typescript-language-server typescript` — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/typescript-lsp/README.md)
  - webapp-testing exige Python Playwright + Chromium — [SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md)
  - O plugin code-review exige `gh` autenticado e remote GitHub — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/README.md)
  - project-artifact exige login claude.ai (não funciona em sessões via API key, Bedrock ou Vertex) — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/project-artifact/README.md)
- **Rede:** context7 é um MCP **hospedado** (`mcp.context7.com`) com autenticação [Cache local do diretório]. Os conectores dos plugins knowledge-work são serviços SaaS via OAuth — [README knowledge-work](https://github.com/anthropics/knowledge-work-plugins)
- **Segurança:**
  - "A plugin can run hooks and MCP servers, so read the pane before you install" — [docs install](https://code.claude.com/docs/en/discover-plugins)
  - "Anthropic doesn't review third-party marketplaces" — [docs marketplaces](https://code.claude.com/docs/en/plugins/anthropic-marketplaces)
  - claude-security "adds no isolation of its own" — [README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/claude-security/README.md)
  - `allowed-tools` em skills concede permissões — [docs skills](https://code.claude.com/docs/en/skills)
- **Obsoleto ou legado:**
  - O marketplace demo `anthropics/claude-code` duplica plugins do official; instale pelo official.
  - `ralph-wiggum` virou `ralph-loop`.
  - O `security-guidance` do demo é a versão antiga, com 9 padrões só em PreToolUse.
  - `claude-opus-4-5-migration` ficou obsoleto com os modelos 5.x.
  - [GitHub claude-code/plugins](https://github.com/anthropics/claude-code/tree/main/plugins), [docs marketplaces](https://code.claude.com/docs/en/plugins/anthropic-marketplaces)
  - `/review` deixou de ser um comando separado na v2.1.223.
  - `/agents` perdeu a interface interativa depois da v2.1.197.
  - `explanatory-output-style` imita um estilo de saída "deprecated".
  - [docs commands](https://code.claude.com/docs/en/commands), [Cache local do diretório]

### Inferences

Resumo de prioridade para o NewEditor.AI. Todos são ferramentas de **desenvolvimento**; nenhum entra no runtime do produto.

1. **Já disponível, usar agora:**
   - `/run-skill-generator`, `/run`, `/verify`, `/simplify`, `/code-review`;
   - `skill-creator` (evals de decupagem);
   - `engineering:testing-strategy` e `architecture`;
   - `design:design-critique` e `accessibility-review`;
   - `product-management:write-spec`;
   - `/skill-doctor`.
2. **Instalar do official, baixo risco:**
   - `hookify` (travas: *ground truth*, SSD, sem commit, sem SDK pago);
   - `typescript-lsp` (+ binário);
   - `frontend-design`;
   - `claude-md-management`;
   - `claude-code-setup`;
   - `playground`.
3. **Instalar quando houver necessidade:**
   - `security-guidance` (custo extra por turno);
   - `feature-dev` e `pr-review-toolkit` (Gestor e Cinéfilo);
   - `mcp-server-dev` ou `mcp-builder` (MCP local do NewEditor);
   - `plugin-dev` (empacotar o sistema editorial);
   - `ralph-loop` (iterar contra os benchmarks);
   - `project-artifact`;
   - copiar só `webapp-testing` para `.claude/skills`.
4. **Depois do repo GitHub:** `/security-review`, plugin `code-review`, `commit-commands`, `claude-security` e o MCP `github` (exige instalar e autenticar o `gh`).
5. **Evitar ou atenção:**
   - `agent-sdk-dev` e `claude-api` no produto, por conflito com "sem API paga";
   - a dependência `@anthropic-ai/sdk` ainda presente em `apps/server`;
   - o marketplace demo (`anthropics/claude-code`);
   - plugins de vídeo de terceiros sem auditoria.

### Gaps
- Não medi o custo de contexto (tokens *always-on*) de cada plugin. Para isso, rodar `claude plugin details <nome>` ou abrir o painel `/plugin` antes de instalar.
- Não encontrei datas por plugin dentro do `claude-plugins-official` (só a data do repo). O painel `/plugin` mostra "Last updated" para os plugins do marketplace oficial.
