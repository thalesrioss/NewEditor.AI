# Skills, plugins e coleções de agentes da comunidade (não-Anthropic) para o fluxo de desenvolvimento do NewEditor.AI (out/2026)

> Escopo: o que a comunidade oferece para Claude Code em planejamento/arquitetura, TDD/testes (unit, e2e, visual, golden de mídia), debugging, review/refactor, performance, git/PR, docs/ADR, frontend React/Tailwind/a11y e contexto/memória. Nada foi instalado. Metadados (estrelas, último push, licença) foram consultados na GitHub API em 2026-10-10, salvo indicação. "Último push" = data do commit mais recente na branch padrão.
>
> Observação do ambiente local (lista de skills desta sessão, não é fonte web): o usuário JÁ tem o plugin Anthropic `engineering` (skills `architecture` (ADR), `debug`, `code-review`, `testing-strategy`, `tech-debt`, `documentation`), além de `code-review`, `simplify` e `security-review` embutidos. Qualquer pacote da comunidade abaixo vai SOBREPOR parte disso. Ver a seção de armadilhas.

## 1. Quais são as coleções mais adotadas e quais skills específicas servem ao NewEditor?

### Takeaway
As duas referências dominantes em out/2026 são **obra/superpowers** (~297k ★, metodologia completa: brainstorm → plano → TDD → review) e **mattpocock/skills** (~284k ★, skills pequenas e combináveis). Ambas estão no marketplace oficial da Anthropic. **wshobson/agents** (~40k ★) é um "catálogo à la carte" de 94 plugins. As listas "awesome" (hesreallyhim, ComposioHQ, travisvn) servem para descobrir coisas, não para instalar em bloco. Para um fundador solo, a recomendação é escolher **UM** dono do fluxo (Superpowers ou Matt Pocock ou Compound Engineering) e completar com poucas skills pontuais.

### Cited Findings

**Tabela-resumo (metadados de 2026-10-10)**

| Coleção | ★ | Último push | Licença | Instalação no Claude Code | Fonte |
|---|---|---|---|---|---|
| obra/superpowers | 297.150 | 2026-10-10 | MIT | `/plugin install superpowers@claude-plugins-official` ou `/plugin marketplace add obra/superpowers-marketplace` + `/plugin install superpowers@superpowers-marketplace` | [GitHub](https://github.com/obra/superpowers) |
| mattpocock/skills | ~284k (contagem da página) | ativo (545 commits) | MIT | `claude plugin install mattpocock-skills@claude-plugins-official`, depois `/setup-matt-pocock-skills` uma vez por repo | [GitHub](https://github.com/mattpocock/skills) |
| wshobson/agents | 40.326 | 2026-10-05 | MIT | `/plugin marketplace add wshobson/agents`, depois `/plugin install <plugin>@claude-code-workflows` | [GitHub](https://github.com/wshobson/agents) |
| EveryInc/compound-engineering-plugin | ~25,5k | ativo (1.444 commits, rodapé 2026) | MIT | `/plugin marketplace add EveryInc/compound-engineering-plugin` + `/plugin install compound-engineering` | [GitHub](https://github.com/EveryInc/compound-engineering-plugin) |
| hesreallyhim/awesome-claude-code (lista) | 55.360 | 2026-10-10 | NOASSERTION | lista curada; não se instala | [GitHub](https://github.com/hesreallyhim/awesome-claude-code) |
| ComposioHQ/awesome-claude-skills (lista) | 76.798 | 2026-09-18 | repo Apache 2.0 segundo o README; licenças variam por skill | lista; parte depende de conta Composio | [GitHub](https://github.com/ComposioHQ/awesome-claude-skills) |
| travisvn/awesome-claude-skills (lista) | 15.349 | **2026-04-28 (~5,5 meses parado)** | — | lista | [GitHub API](https://api.github.com/repos/travisvn/awesome-claude-skills) |
| VoltAgent/awesome-claude-code-subagents | 25.625 | 2026-10-05 | MIT | 100+ subagents (copiar `.md`) | [GitHub API](https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents) |
| davila7/claude-code-templates | 32.537 | 2026-10-10 | MIT | CLI de configuração e monitoramento | [GitHub API](https://api.github.com/repos/davila7/claude-code-templates) |
| alirezarezvani/claude-skills | 27.958 | 2026-08-30 | MIT | "380+ skills" (volume alto, curadoria duvidosa) | [GitHub API](https://api.github.com/repos/alirezarezvani/claude-skills) |
| anthropics/claude-plugins-community | 4.613 | 2026-10-05 | Apache-2.0 | `/plugin marketplace add anthropics/claude-plugins-community` (espelho só-leitura) | [GitHub API](https://api.github.com/repos/anthropics/claude-plugins-community) |
| obra/superpowers-skills | 750 | **ARQUIVADO** (2025-10-14) | MIT | não usar; incorporado ao repo principal | [GitHub API](https://api.github.com/repos/obra/superpowers-skills) |
| mrgoonie/claudekit-skills | 2.228 | **2026-04-03 (parado)** | sem licença detectada | — | [GitHub API](https://api.github.com/repos/mrgoonie/claudekit-skills) |

**Marketplace oficial como canal de distribuição**
- Em 2026-10-10 o `marketplace.json` de anthropics/claude-plugins-official lista **315 plugins**. Vários são da comunidade ou de vendors (superpowers, mattpocock-skills, chrome-devtools-mcp, playwright, context7, remember, serena, greptile, coderabbit, sonarqube, codspeed etc.) — [marketplace.json](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json)
- Roundups de 2026 registram 276 plugins no oficial em 31/jul e 2.307 no marketplace community. O oficial é registrado automaticamente na primeira execução do Claude Code — [Developers Digest](https://www.developersdigest.tech/blog/best-claude-code-skills-2026) (número de roundup; minha contagem direta acima é mais recente)

**obra/superpowers (Jesse Vincent): skills relevantes**
- Testes/debug: `test-driven-development` (RED-GREEN-REFACTOR + referência de anti-padrões de teste), `systematic-debugging` (processo de causa-raiz em 4 fases, com root-cause-tracing, defense-in-depth e condition-based-waiting), `verification-before-completion` — [README](https://github.com/obra/superpowers)
- Planejamento/execução: `brainstorming`, `writing-plans`, `executing-plans` (inline, mais barato), `subagent-driven-development` (subagent novo por tarefa + review em 2 estágios, spec e qualidade; o mais completo), `dispatching-parallel-agents` — [README](https://github.com/obra/superpowers)
- Colaboração: `requesting-code-review`, `receiving-code-review`, `using-git-worktrees`, `finishing-a-development-branch`, `writing-skills` — [README](https://github.com/obra/superpowers)
- Usa um hook `SessionStart` para injetar o bootstrap `using-superpowers`. Os hooks pedem aprovação na instalação e é preciso reiniciar a sessão. A telemetria (logo carregado com a versão, no visual brainstorming) é desligada com `SUPERPOWERS_DISABLE_TELEMETRY`, `DISABLE_TELEMETRY` ou `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` — [README](https://github.com/obra/superpowers)
- Superpowers 5 (mar/2026) trouxe visual brainstorming, loop adversarial de revisão de spec e subagent-driven-development como padrão, com workers em modelos mais baratos. As notas de release mandam priorizar instruções do usuário/CLAUDE.md sobre as internas do Superpowers e chamam o visual brainstorming de "token-intensive" — [mcp.directory](https://mcp.directory/blog/superpowers-skill-worth-it-2026)

**mattpocock/skills: skills relevantes**
- `tdd` (red-green-refactor, uma fatia vertical por vez), `diagnosing-bugs` (loop disciplinado de diagnóstico red→green), `code-review` (eixos Standards e Spec em subagents paralelos), `pr` (corpo de PR com evidências e avaliação de risco de merge) — [GitHub](https://github.com/mattpocock/skills)
- Arquitetura: `grill-me` / `grill-with-docs` (entrevista até resolver cada ramo do plano; o segundo atualiza `GLOSSARY.md` e **ADRs**), `domain-modeling`, `improve-codebase-architecture` (procura oportunidades de "aprofundar" módulos), `codebase-design` (vocabulário de deep modules e seams limpas), `wayfinder` (trabalho grande como mapa de tickets de decisão), `to-spec`, `to-tickets`, `implement`, `implement-spec` — [GitHub](https://github.com/mattpocock/skills)
- Contexto: `handoff` (compacta a conversa para outro agente), `retro` (sugere melhorias de ambiente após a sessão) — [GitHub](https://github.com/mattpocock/skills)
- Filosofia declarada: skills "small, easy to adapt, and composable", em oposição a frameworks como GSD, BMAD e Spec-Kit, que segundo o autor "tiram o controle". Aviso: instalar por dois métodos duplica todas as skills — [GitHub](https://github.com/mattpocock/skills)

**wshobson/agents: plugins relevantes** (94 plugins, sendo 92 locais; 202 agents, 184 skills, 105 commands) — [README](https://github.com/wshobson/agents)
- Nomes exatos no marketplace `claude-code-workflows`: `javascript-typescript`, `unit-testing`, `tdd-workflows`, `debugging-toolkit`, `error-debugging`, `error-diagnostics`, `code-refactoring`, `codebase-cleanup`, `comprehensive-review`, `performance-testing-review`, `application-performance`, `git-pr-workflows`, `code-documentation`, `documentation-generation`, `c4-architecture`, `accessibility-compliance`, `frontend-mobile-development`, `ui-design`, `context-management`, `agent-teams` (review paralelo, debugging por hipóteses), `full-stack-orchestration`, `conductor` (Context-Driven Development), `developer-essentials` (git, code review, E2E), `block-no-verify` (hook PreToolUse que impede `--no-verify`), `plugin-eval` (lint estático de plugins/skills), `hol-guard` (scan pré-instalação), `file-conversion` — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- Instalação granular: um plugin por vez, ou só a skill: `npx skills add wshobson/agents --skill <skill>` / `gh skill install wshobson/agents <skill>` (sem agents, commands e hooks) — [README](https://github.com/wshobson/agents)

**Compound Engineering (Every)**
- 36 skills num loop brainstorm → plan → work → review → compound: `/ce-brainstorm`, `/ce-plan`, `/ce-work`, `/ce-simplify-code`, `/ce-code-review` (multi-agente, só relatório), `/ce-compound` (grava aprendizados em `docs/solutions/`, que planos futuros leem), `/ce-debug`, `/lfg` (pipeline inteiro, incluindo commit e PR). Para atualizar é preciso dar refresh no marketplace antes do `/plugin update` — [GitHub](https://github.com/EveryInc/compound-engineering-plugin)

**awesome-claude-code (hesreallyhim)**
- A tabela da lista tem 249 recursos. Itens relevantes: TDD Guard (Testing), Superpowers (Skills), Dev Browser (Design & UI/UX: o agente dirige um browser para verificar o próprio trabalho), localpr (revisa mudanças não commitadas numa página local estilo PR), Claude Code Safety Net (hook que barra comandos git/fs destrutivos), SkillSpector da NVIDIA (scanner de segurança de skills), SkilLock (fixa o comportamento de skills e bloqueia drift em CI), agnix (linter de CLAUDE.md/SKILL.md/hooks), Caveman (economia de tokens) — [CSV da lista](https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/THE_RESOURCES_TABLE_NEW.csv)

**ComposioHQ/awesome-claude-skills**
- Entradas de dev/teste: lackeyjb/playwright-skill, webapp-testing, test-driven-development (do superpowers), pypict (testes pairwise), Full-Page Screenshot via CDP. A skill "Connect" exige API key do Composio, e as automações de apps usam o Rube MCP (Composio). Não há garantia de segurança ou qualidade por entrada — [GitHub](https://github.com/ComposioHQ/awesome-claude-skills)

### Inferences
- Para o NewEditor, o "kit mínimo" mais coerente é: **um** framework de fluxo (Superpowers **ou** mattpocock/skills), mais skills pontuais de browser/perf/frontend (seções 3 e 6). Como o usuário já tem o plugin `engineering`, a sobreposição com `debug`, `code-review` e `architecture` é certa. Desative um dos lados.
- mattpocock/skills casa melhor com as dores de "arquivos grandes crescendo" e "ADRs": `improve-codebase-architecture`, `codebase-design` e `grill-with-docs` (que mantém ADR e glossário). Superpowers casa melhor com "evitar regressões" (TDD + verification-before-completion + review por subagent).
- wshobson serve como "loja": vale instalar só `javascript-typescript`, `accessibility-compliance` ou `application-performance` se agregarem algo. Instalar o catálogo inteiro contraria o próprio README.

### Gaps
- O repo jeremylongshore/claude-code-plugins-plus-skills (citado em roundups como "346 plugins, quality-graded") retornou 301 (movido) na GitHub API. Não verifiquei o novo endereço nem a qualidade.
- Não obtive data exata do último commit de mattpocock/skills e EveryInc/compound-engineering-plugin: a API bateu o rate limit e a página não exibiu a data.

## 2. Existem boas skills de TDD, debugging sistemático, causa-raiz, verificação antes de concluir, brainstorming/planejamento e desenvolvimento por subagents?

### Takeaway
Sim. São as categorias mais maduras do ecossistema. Superpowers cobre todas num pacote só; mattpocock/skills cobre TDD, diagnóstico e planejamento com peças menores; **TDD Guard** é a única opção que **força** TDD por hooks, mas não lista suporte a `node:test`, o runner do `packages/core`.

### Cited Findings
- **Superpowers**: `test-driven-development`, `systematic-debugging` (4 fases, root-cause-tracing, defense-in-depth, condition-based-waiting), `verification-before-completion` ("confirma que um fix funciona antes de declarar pronto"), `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development` (review em 2 estágios), `dispatching-parallel-agents` — [README](https://github.com/obra/superpowers)
- Simon Willison destacou em out/2025 o Superpowers e, como exemplo, a técnica de debugging root-cause tracing. Ele também publicou as skills internas da Anthropic em simonw/claude-skills — [simonwillison.net](https://feeds.simonwillison.net/2025/Oct/10/claude-skills/)
- **mattpocock/skills**: `tdd` (uma fatia vertical por vez), `diagnosing-bugs`, `grill-me`, `to-spec`, `to-tickets`, `implement` (TDD e depois code-review) e `implement-spec` (spec inteira numa branch via subagents paralelos) — [GitHub](https://github.com/mattpocock/skills)
- **TDD Guard (nizos/tdd-guard)**: hooks que bloqueiam implementação sem teste falhando e impõem refactor com as regras de lint. Runners suportados: Vitest, Jest, Storybook, pytest, PHPUnit, Go, Rust, RSpec, Minitest (**node:test não aparece**). Instalação: `/plugin marketplace add nizos/tdd-guard` → `/plugin install tdd-guard@tdd-guard` → `/tdd-guard:setup`. Requer Node 22+. ~2,4k ★, MIT. O README diz que o projeto evoluiu para o **Probity** (Claude Code, Codex, Copilot CLI) e que novos projetos devem ir para lá. O modelo de validação é configurável, mas o README não explica custo ou provedor — [GitHub](https://github.com/nizos/tdd-guard)
- **wshobson**: `tdd-workflows` ("red-green-refactor cycles and code review"), `unit-testing` ("Python and JavaScript"), `debugging-toolkit`, `error-debugging` ("multi-agent problem diagnosis"), `error-diagnostics` ("root cause analysis"), `agent-teams` ("hypothesis-driven debugging") — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- **Compound Engineering**: `/ce-brainstorm` → `/ce-plan` → `/ce-work` → `/ce-code-review` → `/ce-compound`, mais `/ce-debug` — [GitHub](https://github.com/EveryInc/compound-engineering-plugin)

### Inferences
- `verification-before-completion` e `systematic-debugging` atacam diretamente o padrão "declarar pronto sem medir", útil para preview == export e para o bug do dev server que mata jobs ao reiniciar. São skills de texto (instrução), então o ganho depende de existir um comando de verificação real (ex.: `npm run test:golden`).
- Para TDD imposto por hook no `packages/core` (node:test via tsx), TDD Guard/Probity exigiria migrar para Vitest ou escrever um reporter próprio. Sem isso, as skills `tdd` (Pocock) ou `test-driven-development` (Superpowers) são a opção "soft".
- Subagent-driven development é o modo mais caro em tokens (o próprio README chama de "most thorough" e o executing-plans de "cheapest"). Para um solo founder com assinatura, use em features grandes (ex.: novo pipeline de export) e não em ajustes.

### Gaps
- Não encontrei benchmark independente comparando a taxa de bugs com e sem essas skills. Só relatos (seção 5).
- Não confirmei se o Probity suporta `node:test`.

## 3. Há skills para Playwright/browser, regressão visual, orçamentos de performance, análise de bundle, React 19 e Tailwind v4?

### Takeaway
Para browser, as melhores opções são **microsoft/playwright-cli** (com skills próprias e mais econômico em tokens que o MCP), **lackeyjb/playwright-skill** e **ChromeDevTools/chrome-devtools-mcp** (traces de performance). Para qualidade web, **addyosmani/web-quality-skills** (CWV, a11y WCAG 2.2, orçamentos) e **vercel-labs/agent-skills** (react-best-practices, web-design-guidelines, composition-patterns). Regressão visual e Tailwind v4 só têm skills pequenas e pouco verificadas. Análise de bundle dedicada: não encontrei.

### Cited Findings

**Browser / e2e**
- **microsoft/playwright-cli** (13,9k ★, Apache-2.0, push 2026-09-28): `npm install -g @playwright/cli@latest` + `playwright-cli install --skills`. Comandos `screenshot`, `snapshot`, `tracing-start/stop`, `video-start/stop/chapter`, `recording-start/stop` (gera código Playwright) e `generate-locator`. A skill traz um guia "plan / generate / heal". Segundo o README, o CLI é mais eficiente em tokens que o MCP porque não carrega schemas e árvores de acessibilidade; o MCP continua melhor para estado persistente e introspecção rica — [GitHub](https://github.com/microsoft/playwright-cli)
- **lackeyjb/playwright-skill** (3,2k ★, MIT, push 2026-10-01): o agente escreve código Playwright e executa via `run.js`. Plugin: `/plugin marketplace add lackeyjb/playwright-skill` + `/plugin install playwright-skill@playwright-skill` + `npm run setup` (baixa Chromium). Abre o browser visível por padrão. Serve para scripts ad-hoc e para scripts reutilizáveis com asserções. Tem screenshots; "visual regression" é citado no API_REFERENCE sem um fluxo detalhado — [GitHub](https://github.com/lackeyjb/playwright-skill)
- **microsoft/playwright-mcp** (38k ★, Apache-2.0) existe como plugin `playwright` no marketplace oficial — [GitHub API](https://api.github.com/repos/microsoft/playwright-mcp); [marketplace.json](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json)
- **ChromeDevTools/chrome-devtools-mcp** (53,2k ★, Apache-2.0, push 2026-10-09), plugin `chrome-devtools-mcp` no marketplace oficial: "Record performance traces, analyze network requests" — [marketplace.json](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json); [GitHub API](https://api.github.com/repos/ChromeDevTools/chrome-devtools-mcp)
- **Dev Browser (SawyerHood/dev-browser)**: plugin/skill para o Claude dirigir um browser e "testar e verificar o próprio trabalho" — [awesome-claude-code CSV](https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/THE_RESOURCES_TABLE_NEW.csv)

**Regressão visual**
- Skills de comunidade em registries: `testland/playwright-snapshots` (asserções `toHaveScreenshot()`, masks, thresholds, layout de snapshots por SO/browser, fluxo de update, matriz de viewports) — [tessl](https://tessl.io/registry/testland/playwright-snapshots/skills); `petrkindlmann/qa-skills/visual-testing` (toHaveScreenshot + Chromatic/Percy/Argos; recomenda mascarar conteúdo dinâmico, esperar uma âncora visível em vez de timeout fixo e começar com thresholds estritos) — [skillselion](https://skillselion.com/skills/petrkindlmann/qa-skills/visual-testing)
- O cookbook da skill webapp-testing avisa que os specs gerados não instalam o Playwright nem sobem o dev server — [mcp.directory](https://mcp.directory/blog/claude-webapp-testing-skill-guide)

**Performance / orçamentos / bundle**
- **addyosmani/web-quality-skills** (2,9k ★, MIT, push 2026-08-24): `web-quality-audit` (orquestrador que separa falhas medidas de hipóteses), `performance` (traces do DevTools, code splitting), `core-web-vitals` (LCP < 2,5s, INP < 200ms, CLS < 0,1), `accessibility` (WCAG 2.2), `best-practices`. Orçamentos iniciais sugeridos: página < 1,5 MB, JS < 300 KB comprimido, CSS < 100 KB ("initial guardrails, not universal thresholds"). Não descreve ferramenta de análise de bundle. Lighthouse via `lighthouse_audit` do Chrome DevTools MCP. Instalação: `/plugin marketplace add addyosmani/web-quality-skills` + `/plugin install web-quality-skills@addy-web-quality-skills` — [GitHub](https://github.com/addyosmani/web-quality-skills)
- wshobson `application-performance` ("profiling, performance optimization, and observability for frontend and backend") e `performance-testing-review` — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- O plugin `codspeed` (oficial) traz benchmarking e flamegraphs, mas depende da plataforma CodSpeed — [marketplace.json](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json)

**React 19 / composição / a11y**
- **vercel-labs/agent-skills** (32,2k ★, push 2026-08-28, MIT segundo o README): `react-best-practices` (40+ regras: waterfalls, bundle size, re-renders, rendering performance, micro-otimizações JS; mistura React e Next.js; **não diz que versão do React mira**), `web-design-guidelines` (100+ regras: aria-labels, HTML semântico, foco visível, teclado, forms, animação, dark mode), `composition-patterns` (compound components, evitar "boolean prop sprawl"), `react-view-transitions`. Instalação: `npx skills add vercel-labs/agent-skills` — [GitHub](https://github.com/vercel-labs/agent-skills)
- wshobson `accessibility-compliance` (WCAG, leitores de tela, navegação por teclado) — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- `modern-web-guidance` (GoogleChrome, Apache-2.0) está no marketplace oficial: "Keep your coding agent up to date with the latest web best practices" — [marketplace.json](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json)

**Tailwind v4**
- Não há skill oficial da Tailwind Labs nos resultados. Opções da comunidade: `paulrberg/agent-skills` → `tailwind-css` (v4, tailwind-variants; inspeciona versão, entrypoints CSS e `@theme` antes de editar; ~70 ★, MIT; `npx skills add paulrberg/agent-skills --skill tailwind-css --agent claude-code`) — [claudeskills.info](https://claudeskills.info/skills/paulrberg/agent-skills/tailwind-css/); `nweii/agent-stuff` → `use-tailwind-v4` — [vibeindex](https://www.vibeindex.ai/skills/nweii/agent-stuff/use-tailwind-v4)

### Inferences
- Para "verificação de UI num browser pane" e "latência de seek do preview", o par mais útil é **playwright-cli** (scripts e e2e baratos em tokens) mais **chrome-devtools-mcp** (traces de performance em Chrome real). WebCodecs/WebGL2 exigem um Chrome de verdade, e headless pode diferir em GPU. Teste isso antes de confiar nos números.
- `react-best-practices` vale para re-renders e bundle, mas as regras de servidor/Next.js não se aplicam a um SPA Vite. Instale só se aceitar ignorar essa parte, ou copie as regras úteis para um SKILL.md próprio.
- Tailwind v4: uma skill de projeto de ~30 linhas (CSS-first, `@import "tailwindcss"`, `@theme`, "verifique a versão instalada") provavelmente rende mais que skills de terceiros com 70 ★.
- Para medir velocidade de export e seek, nenhuma skill substitui um script de benchmark do próprio repo. A skill só deve ensinar o agente a rodá-lo e comparar com o baseline.

### Gaps
- Não encontrei skill dedicada a **análise de bundle** (rollup-plugin-visualizer, source-map-explorer) nem a **orçamentos de performance aplicados em CI** para Vite.
- Não encontrei skill específica de **React 19** (Actions, `use`, React Compiler). As que existem não declaram a versão.
- Não verifiquei manutenção nem conteúdo completo das skills de regressão visual e Tailwind (só vi as listagens dos registries).

## 4. Existem skills/plugins para testes golden de pipelines de mídia (frames de vídeo/áudio, SSIM/PSNR, loudness), ou algo adaptável?

### Takeaway
**Não existe skill pronta de testes golden de mídia** (comparar render × referência com SSIM/PSNR/VMAF + loudness). Há peças adaptáveis: um validador SSIM imaturo (demo-video-skill), skills de FFmpeg com QC/métricas e o plugin `file-conversion` do wshobson. O caminho realista é escrever uma skill de projeto que embrulhe um harness de testes próprio.

### Cited Findings
- **alinaqi/demo-video-skill** (MIT, **0 ★, 1 commit**: imaturo): grava walkthroughs Playwright com legenda e roda `validate-video.sh out.mp4 [sample_fps=1] [max_ssim=0.985]`, que compara frames consecutivos via SSIM do ffmpeg e falha se houver poucas mudanças reais de tela. Os testes do validador geram vídeos sintéticos com ffmpeg (estático, multi-capítulo, tela dominante, curto demais) e rodam em CI a cada push. É um "motion gate", não uma comparação com referência — [GitHub](https://github.com/alinaqi/demo-video-skill)
- **FFmpeg Video Analysis & QC** (listagem no mcpmarket): detecção de cena e padrões para calcular PSNR, SSIM e VMAF entre original e encodado. Não parece trazer harness de regressão — [mcpmarket](https://mcpmarket.com/tools/skills/ffmpeg-video-analysis-qc)
- **kajisho5/ffmpeg-skill** (MIT): fluxo probe → editar sem perdas quando possível → checar → verificar, com checagens de entrega e SSIM ao comparar configurações de encoder — [GitHub](https://github.com/kajisho5/ffmpeg-skill)
- **donghaozhang/ffmpeg-claude-skill**: basicamente referência de comandos — [GitHub](https://github.com/donghaozhang/ffmpeg-claude-skill)
- wshobson `file-conversion`: converte imagem/áudio/vídeo "with installed local tools" — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)

### Inferences
- Proposta concreta (inferência, não é skill existente): criar `.claude/skills/media-golden/SKILL.md` que manda o agente rodar um script `npm run test:golden`. O script renderizaria fixtures sintéticas (geradas com `ffmpeg -f lavfi testsrc2/sine`, como o demo-video faz), extrairia N frames e compararia com a referência via filtros `ssim`/`psnr` (e `libvmaf` se disponível). Para o áudio, compararia loudness integrada/LRA com o filtro `ebur128` e checaria duração e sincronia via `ffprobe`, falhando acima de um threshold. Os filtros estão documentados em [FFmpeg Filters](https://ffmpeg.org/ffmpeg-filters.html). Tudo local, sem API paga, o que respeita a restrição do produto.
- Para "preview == export": o mesmo harness pode capturar frames do preview WebCodecs/WebGL2 via Playwright (`page.screenshot` ou canvas `toDataURL` num tempo `t`) e compará-los com frames do export FFmpeg no mesmo `t` usando SSIM. Isso pede que a UI exponha um seek determinístico.
- A skill `verification-before-completion` (Superpowers) e o `/ce-compound` (Compound Engineering) podem apontar para esse comando como "prova obrigatória" antes de declarar pronto.

### Gaps
- Não encontrei nenhum relato público de uso de Claude Code com testes golden de vídeo/áudio em produção.
- Não verifiquei o código do `validate-video.sh` (filtros e cálculo exatos).

## 5. O que praticantes relatam sobre a eficácia real e quais as armadilhas (inchaço de contexto, skills conflitantes)?

### Takeaway
A recepção é positiva para a pausa forçada de planejamento e para os artefatos (spec e plano), e negativa para a cerimônia em tarefas pequenas e o custo em tokens. As armadilhas concretas são: skills duplicadas consumindo dezenas de milhares de tokens, descrições truncadas que fazem skills "pararem de disparar" e frameworks concorrentes disputando o fluxo.

### Cited Findings
- Evan Schwartz publicou em 02/04/2026 uma review muito positiva do Superpowers: o loop brainstorm/plano/implementação deixou as features "mais corretas" que o Claude Code puro. A review teve ~50 pontos e 25 comentários no HN. É opinião individual, não benchmark — [blog.fsck.com (menção)](https://blog.fsck.com/mentions/mentions/2026-04-02-emschwartz-rave-review/); [mcp.directory](https://mcp.directory/blog/superpowers-skill-worth-it-2026)
- O thread do r/ClaudeCode "Are you guys still using the superpowers skill?" teve 150+ upvotes e 110+ comentários em jun/2026. O crítico mais votado disse que o fluxo é bom, mas o empacotamento é "bloated". Um usuário pesado voltou para Opus + um fork do Superpowers depois de testar o Fable 5 sem ele — [mcp.directory](https://mcp.directory/blog/superpowers-skill-worth-it-2026)
- Críticas recorrentes (resumo de busca agregando HN e blogs): tarefas simples ficam mais lentas (regex ou um log viram processo longo de planejamento), verbosidade, o plano é reescrito inteiro em vez de editado, e o TDD rígido pode remover código escrito antes do teste. O compromisso comum é usar em features novas e refactors e pular em bugfix pequeno e scripts descartáveis — [mcp.directory](https://mcp.directory/blog/superpowers-skill-worth-it-2026); [Developers Digest](https://www.developersdigest.tech/blog/claude-code-superpowers-plugin-guide) (agregado; trate como direcional)
- Compound Engineering e Superpowers podem coexistir desde que uma regra no AGENTS.md/CLAUDE.md diga qual dos dois é dono do fluxo. A falha típica do Superpowers é "ceremony" — [wotai.co](https://wotai.co/blog/compound-engineering-vs-superpowers) (via resumo de busca)
- Duplicação: dois plugins do mesmo marketplace carregaram as mesmas 17 skills duas vezes (~50k tokens desperdiçados, segundo o relato) — [anthropics/skills#189](https://github.com/anthropics/skills/issues/189). Um tracker comunitário cita 37 skills únicas que viraram 74 entradas no system prompt — [claudeissues.com](https://claudeissues.com/issue/29971-bug-claude-code-context-bloat-bug-report-community-issue-tracker)
- Com muitas skills, as descrições competem pelo orçamento e "dez skills medíocres expulsam as importantes". A recomendação é ter poucas skills, com descrições curtas e com as palavras-chave na frente — [HackerNoon](https://hackernoon.com/lite/navigating-claude-code-skills-that-actually-fire)
- Docs oficiais: no início só nome e descrição entram no contexto, e o corpo carrega quando a skill é usada. `description` + `when_to_use` são truncados em 1.536 caracteres na listagem. Após compactação, o Claude Code reanexa as skills invocadas (5.000 tokens cada, 25.000 no total). `disable-model-invocation: true` tira a descrição do contexto (só invocação manual) — [Claude Code Docs](https://code.claude.com/docs/en/skills)
- O Matt Pocock avisa que instalar por plugin e por `npx skills` ao mesmo tempo duplica tudo — [GitHub](https://github.com/mattpocock/skills)
- Roundups dizem que contagem de instalações mede popularidade, não qualidade, e que skills sobrepostas conflitam — [Firecrawl](https://www.firecrawl.dev/blog/best-claude-code-skills); [Developers Digest](https://www.developersdigest.tech/blog/best-claude-code-skills-2026)

### Inferences
- Regra prática para o NewEditor: (1) um framework de fluxo; (2) desligar ou não instalar duplicatas do plugin `engineering` já presente; (3) marcar skills de efeito colateral (deploy, PR, `/lfg`) com `disable-model-invocation`; (4) checar `/context` depois de cada instalação; (5) regras que valem sempre (ex.: "nunca reiniciar o dev server com job rodando") ficam no CLAUDE.md ou num hook, não numa skill.
- Sessões longas: preferir artefatos em disco (planos do Superpowers, `docs/solutions/` do Compound, ADRs) a memória "mágica", porque sobrevivem à compactação e vão para o GitHub/NewContent depois.

### Gaps
- Um valor de ~22k tokens de overhead no startup do Superpowers (11% da janela) apareceu num resumo de busca atribuído à issue #190 via artigo em chinês. Não verifiquei a fonte primária.
- Um "A/B de 12 sessões com 14% menos tokens" também veio de resumo de busca, sem fonte primária localizada.
- O artigo "11 Tested, 4 Worth Keeping" (Build to Launch, 23/03/2026) está atrás de paywall na parte de código — [Substack](https://buildtolaunch.substack.com/p/best-claude-code-plugins-tested-review)
- Não verifiquei a citação de Simon Willison sobre skills serem "bigger deal than MCP": ela veio de um agregador ([news.smol.ai](https://news.smol.ai/tags/simonwillison)).

## 6. Quais opções cobrem as áreas restantes do objetivo: code review/refactor, git/GitHub/PR, docs/ADR e contexto/memória?

### Takeaway
Para refactor de arquivos grandes, as opções mais alinhadas são `improve-codebase-architecture` e `codebase-design` (Pocock), `code-refactoring` e `codebase-cleanup` (wshobson) e `/ce-simplify-code` (Compound). Para git/PR antes de existir remote, servem `using-git-worktrees` e `finishing-a-development-branch` (Superpowers), `pr` (Pocock), localpr e hooks de segurança (Safety Net, block-no-verify). Para ADR, `grill-with-docs`/`domain-modeling` (Pocock) ou uma skill de ADR pequena. Para memória: claude-mem é popular, mas tem dependências de nuvem/assinatura e uma controvérsia de token cripto. Artefatos em disco (handoff, docs/solutions) são mais simples.

### Cited Findings

**Review / refactor**
- Pocock: `code-review` (Standards + Spec em paralelo), `improve-codebase-architecture`, `codebase-design` (deep modules, seams limpas) — [GitHub](https://github.com/mattpocock/skills)
- Superpowers: `requesting-code-review`, `receiving-code-review`, e review em 2 estágios no `subagent-driven-development` — [README](https://github.com/obra/superpowers)
- wshobson: `code-refactoring` ("technical debt management with context restoration"), `codebase-cleanup`, `comprehensive-review` (arquitetura, segurança, boas práticas) — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- Compound: `/ce-simplify-code`, `/ce-code-review` (multi-agente, só relatório) — [GitHub](https://github.com/EveryInc/compound-engineering-plugin)
- **trailofbits/skills** (7,5k ★, **CC-BY-SA-4.0**, push 2026-10-09): skills de pesquisa de segurança, detecção de vulnerabilidades e auditoria — [GitHub API](https://api.github.com/repos/trailofbits/skills)

**Git / GitHub / PR**
- Superpowers: `using-git-worktrees`, `finishing-a-development-branch` (decide entre merge e PR) — [README](https://github.com/obra/superpowers)
- Pocock: `pr` (corpo de PR com evidências e avaliação de risco de merge) — [GitHub](https://github.com/mattpocock/skills)
- wshobson: `git-pr-workflows`, `block-no-verify` (hook que impede `--no-verify` e afins), `review-agent-governance` (exige aprovação humana antes de postar review ou fazer merge) — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- Compound: `/lfg` faz commit e abre PR quando há remote — [GitHub](https://github.com/EveryInc/compound-engineering-plugin)
- localpr (gilles-g): revisa mudanças não commitadas do Claude numa página local estilo PR. Claude Code Safety Net (kenryu42): hook que pega comandos git/fs destrutivos — [awesome-claude-code CSV](https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/THE_RESOURCES_TABLE_NEW.csv)

**Docs / ADR**
- Pocock `grill-with-docs` e `domain-modeling` atualizam `GLOSSARY.md` e ADRs inline — [GitHub](https://github.com/mattpocock/skills)
- wshobson tem uma skill `architecture-decision-records` e os plugins `c4-architecture`, `code-documentation` e `documentation-generation` (Mermaid, OpenAPI) — [vibeindex](https://www.vibeindex.ai/skills/wshobson/agents/architecture-decision-records); [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- `adr-drafting` (giuseppe-trisciuoglio/developer-kit): detecta as convenções de ADR existentes (numeração, pasta) ou usa `docs/architecture/adr`, mostra preview e só grava com aprovação. Não gerencia supersessão — [claudemarketplaces](https://claudemarketplaces.com/skills/giuseppe-trisciuoglio/developer-kit/adr-drafting)
- ECC `architecture-decision-records` (affaan-m/everything-claude-code): detecta "momentos de decisão" na sessão e grava em `docs/adr/` — [claudemarketplaces](https://claudemarketplaces.com/skills/affaan-m/everything-claude-code/architecture-decision-records)

**Contexto / memória**
- **thedotmack/claude-mem** (99,2k ★, Apache-2.0, push 2026-10-09, v13.35.0): 5 hooks de ciclo de vida, worker HTTP local (Bun), SQLite + FTS5 e Chroma. A compressão das observações usa IA, e o provedor é escolhido no login: observer hospedado (trial de 30 dias, depois "fallback" para o plano Anthropic), chave própria OpenRouter/Gemini ou o plano Anthropic. Há Cloud Sync opcional (cmem.ai), e a tag `<private>` exclui conteúdo. O README tem a seção "What About CMEM?" sobre um token cripto "criado por terceiro mas oficialmente abraçado" pelo criador. Instalação: `/plugin marketplace add thedotmack/claude-mem` + `/plugin install claude-mem` ou `npx claude-mem install` — [GitHub](https://github.com/thedotmack/claude-mem)
- wshobson `context-management` ("context persistence, restoration, and long-running conversation management") — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- Pocock `handoff` (compacta a conversa para outro agente) e `retro` — [GitHub](https://github.com/mattpocock/skills)
- Compound `/ce-compound` grava aprendizados em `docs/solutions/` para os próximos planos — [GitHub](https://github.com/EveryInc/compound-engineering-plugin)
- **upstash/context7** (62,9k ★, MIT): docs atualizadas de bibliotecas via servidor MCP **hospedado** (plugin `context7` no oficial). Ajuda com APIs novas (Vite 8, React 19, Tailwind 4) — [marketplace.json](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json); [GitHub API](https://api.github.com/repos/upstash/context7)

### Inferences
- Para os "arquivos grandes crescendo" do NewEditor (ex.: componentes React e rotas Fastify), `improve-codebase-architecture` + `codebase-design` dão um vocabulário de módulos profundos. Combine com testes golden antes de qualquer refactor do pipeline de export.
- claude-mem resolve memória entre sessões, mas tem o maior custo de confiança da lista: daemon, hooks em todo tool call, provedor de nuvem opcional e a controvérsia do token. A restrição "sem API paga" vale para o cérebro do **produto**, não para o tooling de dev, mas a privacidade do código ainda conta. A memória nativa do Claude Code (já em uso pelo usuário) e artefatos em `docs/` provavelmente bastam.
- Como ainda não há git local, o primeiro passo de valor é `git init` + um hook de segurança (Safety Net ou block-no-verify) antes de adotar fluxos de worktree ou PR.

### Gaps
- Não verifiquei em qual plugin do wshobson vive a skill `architecture-decision-records`, nem o conteúdo dela.
- Não verifiquei os termos do free tier do Context7 (o plugin usa servidor hospedado).

## 7. Como vetar skills e plugins de terceiros com segurança (eles executam código)?

### Takeaway
Skills são uma cadeia de suprimentos nova e com problemas documentados. Numa auditoria de fev/2026, 13,4% das skills em registries públicos tinham problemas críticos. O Claude Code aplica `allowed-tools` de skills de projeto mesmo em pastas não confiáveis e executa `!`comandos`` sem prompt. Leia SKILL.md, scripts e hooks antes de instalar, fixe versões e prefira o marketplace oficial e repos com autor identificável.

### Cited Findings
- **Snyk ToxicSkills (05/02/2026)**: 3.984 skills analisadas no ClawHub e no skills.sh. 13,4% (534) com pelo menos um problema crítico (malware, prompt injection, segredos expostos) e 36,82% (1.467) com alguma falha de segurança — [Snyk](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub). Números secundários divergentes circulam (ex.: "76 payloads maliciosos confirmados") — [codex.danielvaughan.com](https://codex.danielvaughan.com/2026/06/07/agent-skill-supply-chain-crisis-clawhavoc-toxicskills-skillsieve-codex-cli-defence/)
- Docs oficiais: "A skill can grant itself broad tool access, so review the `allowed-tools` of skills checked into a repository before you run Claude Code there." O `allowed-tools` de skill de projeto é aplicado mesmo em `-p` numa pasta nunca confiada. Comandos `!` injetados "never prompt for permission while the skill renders". Mitigações: `"disableSkillShellExecution": true` e regras `Skill(...)` de deny — [Claude Code Docs](https://code.claude.com/docs/en/skills)
- Plugins como Superpowers e claude-mem instalam **hooks** (SessionStart, PostToolUse etc.) que rodam a cada sessão ou tool call — [obra/superpowers](https://github.com/obra/superpowers); [claude-mem](https://github.com/thedotmack/claude-mem)
- Ferramentas de vetting da comunidade: NVIDIA **SkillSpector** (scanner de skills), **SkilLock** (fixa comportamento e bloqueia drift em CI), **agnix** (linter de SKILL.md/hooks/MCP) — [awesome-claude-code CSV](https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/THE_RESOURCES_TABLE_NEW.csv); wshobson `plugin-eval` (lint estático) e `hol-guard` (scan pré-instalação) — [marketplace.json](https://raw.githubusercontent.com/wshobson/agents/main/.claude-plugin/marketplace.json)
- O README da lackeyjb/playwright-skill usa `--yes` nos comandos de instalação (pula confirmações) e o `npm run setup` baixa o Chromium — [GitHub](https://github.com/lackeyjb/playwright-skill)
- A ComposioHQ/awesome-claude-skills não dá garantia de segurança ou qualidade por entrada — [GitHub](https://github.com/ComposioHQ/awesome-claude-skills)

### Inferences
- Checklist para o NewEditor: (1) ler SKILL.md, scripts e `hooks.json`; procurar `curl`/`wget`, `eval`, base64, acesso a `~/.ssh` e envs de token; (2) preferir copiar só o SKILL.md útil para `.claude/skills/` do projeto (versionado, auditável) em vez de instalar o plugin inteiro; (3) fixar versão/commit e revisar diffs de update; (4) desligar telemetria (ex.: `SUPERPOWERS_DISABLE_TELEMETRY`); (5) não instalar nada que exija conta ou API key de terceiros no caminho do produto; (6) rodar `/context` e `/doctor` depois de instalar.

### Gaps
- Não encontrei auditoria de segurança independente específica de Superpowers, mattpocock/skills, wshobson/agents ou claude-mem.
- Não verifiquei se o marketplace oficial da Anthropic faz revisão de segurança dos plugins de terceiros que lista, nem com que profundidade.
