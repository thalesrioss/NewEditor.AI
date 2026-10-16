# Skills/plugins de Produto, UX/UI e Qualidade de Agentes de IA para o NewEditor.AI (out/2026)

> Escopo: o que existe (oficial e comunidade) em skills e plugins do Claude para descoberta de produto, design UX/UI, avaliação de agentes e heurísticas sem API paga, além de um bloco curto sobre lançamento. Pesquisa feita em 10/out/2026. Nada foi instalado.
> As contagens de estrelas foram lidas do campo `stargazerCount` das páginas do GitHub em 10/out/2026. Os agregadores (skills.sh, claudemarketplaces, blogs) mostram números divergentes e desatualizados, então vale sempre o que está no repositório.
> Achado prático importante: os plugins oficiais **product-management, design, marketing e engineering (v1.2.0, autor Anthropic)** já estão disponíveis na sessão Claude desktop do Thales. Os arquivos estão em `~/Library/Application Support/Claude/local-agent-mode-sessions/.../rpm/plugin_*`, e as skills aparecem como `product-management:write-spec`, `design:design-critique` etc. Para usá-los no Claude Code CLI, o caminho é instalar pelo marketplace (veja abaixo).

---

## 1. O que os plugins oficiais de knowledge work da Anthropic (product-management, design, marketing, data, engineering) contêm, e como usar cada um no NewEditor.AI?

### Takeaway
O repositório oficial `anthropics/knowledge-work-plugins` (Apache-2.0, ~28,7k estrelas, atualizado em 10/out/2026) traz plugins prontos de PM (PRD, roadmap, síntese de pesquisa, competitive brief, métricas, brainstorm), de Design (crítica, design system, handoff, UX copy, acessibilidade WCAG, pesquisa) e de Marketing. Os conectores (Figma, Amplitude, Linear, Notion…) são **opcionais**: sem eles, as skills trabalham só com o que o usuário fornece. Nenhum exige API paga além da assinatura do próprio Claude.

### Cited Findings

**Repositório e instalação**
- O repo lista os plugins productivity, sales, customer-support, product-management, marketing, legal, finance, data, enterprise-search, bio-research e cowork-plugin-management, com pastas também para design, engineering, human-resources, operations, small-business, pdf-viewer e partner-built. Licença Apache-2.0, ~28,7k estrelas — [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)
- Instalação no Claude Code: `claude plugin marketplace add anthropics/knowledge-work-plugins` e depois `claude plugin install product-management@knowledge-work-plugins` (o mesmo vale para `design@…`, `marketing@…`, `data@…`). Os comandos ficam namespaced, por exemplo `/product-management:write-spec` — [knowledge-work-plugins README](https://github.com/anthropics/knowledge-work-plugins); [design README](https://github.com/anthropics/knowledge-work-plugins/blob/main/design/README.md)
- Os plugins foram feitos "primariamente para o Cowork", mas "também funcionam no Claude Code" — [design README](https://github.com/anthropics/knowledge-work-plugins/blob/main/design/README.md); [data README](https://github.com/anthropics/knowledge-work-plugins/blob/main/data/README.md)
- Os conectores são agnósticos: os arquivos usam placeholders `~~project tracker`, `~~design`, `~~product analytics` etc., e qualquer MCP da categoria serve. O `.mcp.json` do PM pré-configura Slack, Linear, Asana, monday, ClickUp, Atlassian, Notion, Figma, Amplitude, Pendo, Intercom, Fireflies, Google Calendar, Gmail e Similarweb — [product-management/CONNECTORS.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/CONNECTORS.md)
- O write-spec diz explicitamente: "If these tools are not connected, work entirely from what the user provides. Do not ask the user to connect tools" — [write-spec/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/write-spec/SKILL.md)

**product-management (v1.2.0): 8 skills e o comando `/brainstorm`**
- `write-spec`: PRD com Problem Statement, Goals, Non-Goals, User Stories, Requirements (MoSCoW), Open Questions, Timeline, além de Success Metrics divididos em indicadores leading e lagging com metas — [write-spec/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/write-spec/SKILL.md)
- `competitive-brief`: mapeamento do landscape, matriz de comparação de features (com escalas de rating), análise de posicionamento e mensagem, e metodologia de win/loss. A pesquisa usa web search em páginas de produto, preços, changelogs, reviews no G2/Capterra, vagas de emprego e comunidades — [competitive-brief/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/competitive-brief/SKILL.md)
- `roadmap-update`: formatos Now/Next/Later, temas trimestrais, OKR e Gantt; priorização por RICE, MoSCoW, ICE e Valor×Esforço; mapa de dependências e planejamento de capacidade — [roadmap-update/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/roadmap-update/SKILL.md)
- `synthesize-research`: análise temática, affinity mapping, triangulação, interpretação de surveys (fechadas e abertas), integração qual+quant e personas baseadas em evidência — [synthesize-research/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/synthesize-research/SKILL.md)
- `product-brainstorming`: quatro modos (exploração de problema, ideação de solução, teste de premissas, estratégia) e os frameworks HMW, JTBD, Opportunity Solution Tree, First Principles, SCAMPER, OODA e Reverse Brainstorming — [product-brainstorming/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/product-brainstorming/SKILL.md)
- `metrics-review`: hierarquia North Star → L1 → L2, retenção/ativação/conversão, OKRs e cadências semanal/mensal/trimestral — [metrics-review/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/metrics-review/SKILL.md)
- `stakeholder-update`: templates por público, status verde/amarelo/vermelho, framework de risco ROAM e uma seção de registro de decisões no formato ADR — [stakeholder-update/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/stakeholder-update/SKILL.md)
- `sprint-planning`: capacidade, backlog P0/stretch, riscos e Definition of Done — [sprint-planning/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/sprint-planning/SKILL.md)

**design (v1.2.0): 7 skills**
- Comandos: `/critique`, `/design-system`, `/handoff`, `/ux-copy`, `/accessibility`, `/research-synthesis`. Funcionam "standalone" com screenshot ou descrição e ficam "supercharged" quando há MCP (Figma etc.) — [design README](https://github.com/anthropics/knowledge-work-plugins/blob/main/design/README.md)
- `design-critique`: primeira impressão (2 segundos), usabilidade, hierarquia visual, consistência, acessibilidade, "What Works Well" e recomendações priorizadas. O Figma e o feedback de usuários são opcionais — [design-critique/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/design/skills/design-critique/SKILL.md)
- `accessibility-review`: auditoria WCAG 2.1 AA (Perceivable/Operable/Understandable/Robust) com checagem de contraste, navegação por teclado, leitor de tela e correções priorizadas — [accessibility-review/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/design/skills/accessibility-review/SKILL.md)
- `design-system`: três modos (Audit, Document, Extend) cobrindo tokens, consistência de nomes, cobertura de tokens, completude de componentes e documentação de variantes/estados/a11y com do's and don'ts — [design-system/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/design/skills/design-system/SKILL.md)
- `design-handoff`: spec com layout, tokens, componentes, estados e interações, responsivo, edge cases, uma seção de **Animation/Motion** e notas de acessibilidade — [design-handoff/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/design/skills/design-handoff/SKILL.md)
- `ux-copy`: padrões para CTAs, mensagens de erro, empty states, diálogos de confirmação, tooltips, loading states e onboarding, mais voz e tom, alternativas, racional e "Localization Notes" (expansão de caracteres, contexto cultural) — [ux-copy/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/design/skills/ux-copy/SKILL.md)
- `user-research` e `research-synthesis`: métodos, roteiro de entrevista, framework de análise; síntese em temas → insights → oportunidades, segmentos e recomendações — [design/skills](https://github.com/anthropics/knowledge-work-plugins/tree/main/design/skills)

**marketing, data, engineering e partner-built**
- marketing (v1.2.0): brand-review, campaign-plan, competitive-brief, content-creation, draft-content, email-sequence, performance-report e seo-audit. Conectores opcionais: Canva, Figma, HubSpot, Amplitude, Notion, Ahrefs, Similarweb, Klaviyo, Supermetrics — [marketing/](https://github.com/anthropics/knowledge-work-plugins/tree/main/marketing); [knowledge-work-plugins README](https://github.com/anthropics/knowledge-work-plugins)
- data: `/analyze`, `/explore-data`, `/write-query`, `/create-viz`, `/build-dashboard`, `/validate`. Sem warehouse, funciona com CSV/Excel colados ou enviados — [data README](https://github.com/anthropics/knowledge-work-plugins/blob/main/data/README.md)
- engineering: architecture (ADR), code-review, debug, deploy-checklist, documentation, incident-response, standup, system-design, tech-debt, testing-strategy. A skill `architecture` serve para "Create or evaluate an architecture decision record (ADR)" — [engineering/skills/architecture](https://github.com/anthropics/knowledge-work-plugins/blob/main/engineering/skills/architecture/SKILL.md)
- partner-built `brand-voice` (Tribe AI): `/brand-voice:discover-brand`, `generate-guidelines` e `enforce-voice`. **Depende de conectores** (Notion, Atlassian, Box, M365, Figma, Gong, Granola) para a fase de descoberta — [brand-voice README](https://github.com/anthropics/knowledge-work-plugins/blob/main/partner-built/brand-voice/README.md)

**Outros oficiais relevantes (fora do knowledge-work-plugins)**
- `anthropics/skills` (~180k estrelas) traz algorithmic-art, brand-guidelines, canvas-design, doc-coauthoring, **frontend-design**, mcp-builder, **skill-creator**, theme-factory, **web-artifacts-builder**, **webapp-testing**, docx/pdf/pptx/xlsx, entre outras. Instalação: `/plugin marketplace add anthropics/skills` e depois `/plugin install example-skills@anthropic-agent-skills` — [anthropics/skills](https://github.com/anthropics/skills)
- `anthropics/claude-plugins-official` (~37,6k estrelas, "Official, Anthropic-managed directory"): plugins frontend-design, playground, skill-creator, feature-dev, code-review, pr-review-toolkit, hookify e outros, além de externos como playwright, context7 e linear — [claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- `playground`: gera HTMLs interativos de um só arquivo (controles + preview ao vivo + prompt copiável), com templates design-playground, data-explorer, concept-map e document-critique — [playground README](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/playground/README.md)
- `feature-dev`: workflow de 7 fases (Discovery → exploração do codebase → perguntas → arquitetura → implementação → revisão) via `/feature-dev` — [feature-dev README](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/feature-dev/README.md)

### Inferences
- **Uso concreto no NewEditor.AI. Todos rodam sem API paga e sem conectores. Basta colar contexto, screenshots ou arquivos do vault.**
  - `/product-management:write-spec` → PRDs do **Gestor de Projetos** (lê a task, gera briefing, baixa do Drive, estima tempo) e do **Cinéfilo.AI**. Os Non-Goals deixam explícito "sem LLM pago dentro do produto", e as success metrics podem ser leading (tempo até primeiro corte) e lagging (% de projetos aprovados sem retrabalho).
  - `competitive-brief` (PM ou marketing) → matriz de features vs CapCut, Descript, Opus Clip, Submagic e Captions.ai, focada no diferencial "gate de revisão humana + cérebro local + Kanban de agência".
  - `roadmap-update` → Now/Next/Later com RICE para decidir a ordem entre o Gestor de Projetos, o Cinéfilo.AI e a melhoria de decupagem.
  - `synthesize-research` / `design:research-synthesis` → sintetizar feedback dos editores da NewContent e os "diffs" de `review.json` como pesquisa qualitativa.
  - `metrics-review` → definir a North Star (ex.: minutos de edição economizados por vídeo aprovado) e L1/L2 (IoU da decupagem, taxa de aprovação na 1ª revisão).
  - `design:design-critique` + `design:accessibility-review` → passar screenshots do editor dark/Kanban/legendas. O contraste em tema escuro e a navegação por teclado na timeline são riscos típicos.
  - `design:design-system` (modo Audit/Document) → auditar tokens Tailwind 4 e componentes React 19 do editor.
  - `design:ux-copy` → microcopy em PT-BR para notificações, empty states do Kanban e mensagens do avatar do Editor Brain. Pedir explicitamente "PT-BR, tom de editor de vídeo".
  - `design:design-handoff` → spec de animação do avatar pixel-art e de estados da timeline (seção Motion).
  - `engineering:architecture` → ADRs como "cérebro rule-based local vs LLM", "formato do review.json" e "estratégia de download do Drive".
  - `playground` (oficial) → montar explorers HTML para calibrar visualmente parâmetros da decupagem (limiares de silêncio, padding) e copiar o prompt resultante.
- Como esses plugins já estão na sessão desktop, o custo de testar é zero. Para o CLI basta o `marketplace add`.
- A parte mais fraca para o caso do Thales são os conectores (Amplitude, Pendo, Linear), pensados para times grandes e SaaS com analytics. Como ele é solo, faz sentido ignorá-los.

### Gaps
- O repo não informa data de release/changelog por plugin. A versão 1.2.0 foi verificada localmente, mas não confirmei se há versão mais nova no GitHub.
- Não achei documentação oficial sobre a qualidade das skills em PT-BR. O ux-copy só tem "Localization Notes" genérico.
- Não li a pasta `small-business` nem `operations` (fora de escopo).

---

## 2. Quais skills da comunidade são fortes para UI/UX (estética frontend, packs "pro max", acessibilidade, geração de design system) e são confiáveis?

### Takeaway
Quatro opções dominam: **Impeccable** (pbakaus, ~79k ★, 24 comandos e 59 regras determinísticas que rodam sem LLM e sem API key), **UI UX Pro Max** (nextlevelbuilder, ~134k ★, banco de estilos/paletas/fontes com busca BM25 local em Python), **Taste Skill** (Leonxlnx, ~94k ★, "dials" de variância/motion/densidade) e a **frontend-design oficial** da Anthropic. Para qualidade técnica (a11y, performance, i18n), **web-design-guidelines da Vercel** (~32k ★) é a mais objetiva. A popularidade é alta, mas o ecossistema de skills tem riscos de supply chain documentados, então convém ler o SKILL.md antes de instalar.

### Cited Findings

**Oficial Anthropic: frontend-design**
- A skill `frontend-design` pede direção estética "distinta" e evita defaults templated. Ela lista os "tells" de design gerado por IA (fundo creme ~#F4F1EA com serif e acento terracota ~#D97757; fundo quase preto com um único acento verde-ácido ou vermelhão; destacar uma única palavra no headline; labels em caixa-alta; marcadores 01/02/03 sem sequência real). Sobre motion: "A single orchestrated moment… lands better than scattered effects". Motion que responde à ação do usuário é bem-vindo — [anthropics/skills frontend-design/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
- Também existe como plugin em claude-plugins-official, de autoria de Prithvi Rajasekaran e Alexander Bricken, com link para o "Frontend Aesthetics Cookbook" — [frontend-design plugin README](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/frontend-design/README.md)

**Impeccable (pbakaus): comunidade, ~79,3k ★**
- "1 skill, 24 commands, live browser iteration, and 59 deterministic detector rules". "The CLI and browser extension run the deterministic rules with no LLM and no API key" — [pbakaus/impeccable](https://github.com/pbakaus/impeccable)
- `/impeccable init` grava o contexto durável do produto em `PRODUCT.md` (público, propósito, restrições, voz) e `/impeccable document` gera `DESIGN.md` a partir do código. Outros comandos: shape, critique, audit (a11y/perf/responsivo), polish, harden (erros, i18n, overflow de texto), onboard (first-run, empty states, ativação), animate, clarify (UX copy), typeset, layout, colorize, distill, bolder/quieter, live e generate (variantes no browser) — [pbakaus/impeccable README](https://github.com/pbakaus/impeccable)
- Instalação: `npx impeccable install` (detecta `~/.claude`) ou `/plugin marketplace add pbakaus/impeccable`. Grava arquivos de trabalho em `.impeccable/` (convém colocar no .gitignore) — [pbakaus/impeccable README](https://github.com/pbakaus/impeccable)
- Segundo review de terceiro, Impeccable "builds on" a frontend-design da Anthropic, e a sub-skill avulsa frontend-design foi aposentada em favor da skill principal — [Emelia review](https://emelia.io/hub/impeccable-design-skill-review); licença Apache-2.0 segundo a mesma listagem (não confirmei o arquivo LICENSE)

**UI UX Pro Max (nextlevelbuilder): comunidade, ~134,4k ★**
- v2: 79 estilos pesquisáveis (50 ativos), 192 paletas, 74 pares de fontes, 25 tipos de gráfico, 22 stacks (React, shadcn/ui, HTML+Tailwind…), 119 UX guidelines e 192 regras de raciocínio por indústria. Inclui a categoria "Photo/Video Editor" em Creative, e cada regra traz padrão recomendado, estilo, cores, tipografia, efeitos e **anti-patterns** — [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- A busca é BM25 local: "Python 3.x is required for the search script (standard library only — the scripts install nothing and make no network calls)" — [ui-ux-pro-max README](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- Instalação: `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` e depois `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`, ou `npm install -g ui-ux-pro-max-cli` seguido de `uipro init --ai claude` — [ui-ux-pro-max README](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- **Existe versão Premium paga** (brand identity, logo, slides, geração de imagem com IA, tokens enterprise) em uupm.cc. A versão do repo é open source — [ui-ux-pro-max README](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- Os agregadores divergem sobre contagens e versão (59k–88,7k ★; v2.1.0 vs v2.5.0; nome do pacote CLI "uipro-cli" vs "ui-ux-pro-max-cli"). O README atual usa `ui-ux-pro-max-cli` — [skillsindex/mintlify via busca](https://www.mintlify.com/nextlevelbuilder/ui-ux-pro-max-skill/guides/cli-commands); [guia Pillitteri PT](https://pasqualepillitteri.it/pt/news/982/claude-code-18-melhores-skills-design-uiux-guia)

**Taste Skill (Leonxlnx): comunidade, ~94,4k ★**
- `design-taste-frontend` v2 (experimental) lê o brief, infere a linguagem de design e ajusta três dials: DESIGN_VARIANCE, MOTION_INTENSITY e VISUAL_DENSITY (dashboards densos = densidade alta). Variantes: `redesign-existing-projects` (audita a UI existente antes de corrigir), `minimalist-ui` (Notion/Linear), `high-end-visual-design`, `industrial-brutalist-ui`, `full-output-enforcement` e skills de geração de imagem (que dependem de gerador de imagem externo) — [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
- Instalação: `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"` — [taste-skill README](https://github.com/Leonxlnx/taste-skill)

**Qualidade técnica, acessibilidade e consistência**
- Vercel `web-design-guidelines`: audita o código de UI contra mais de 100 regras (aria-labels, HTML semântico, focus-visible, forms, `prefers-reduced-motion`, transforms compositor-friendly, tabular-nums, virtualização, URL refletindo estado, color-scheme/dark mode, Intl.DateTimeFormat/NumberFormat). O mesmo repo traz `react-best-practices` (40+ regras em 8 categorias) e `react-view-transitions`. Instalação: `npx skills add vercel-labs/agent-skills` — [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (~32,2k ★)
- `addyosmani/web-quality-skills`: "Agent Skills for optimizing web quality based on Lighthouse and Core Web Vitals" (~2,9k ★) — [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills)
- `Dammyjay93/interface-design`: "Design engineering for Claude Code. Craft, memory, and enforcement for consistent UI" (~5,8k ★) — [Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design)
- Plugin externo `playwright` no diretório oficial, útil para o Claude verificar a UI renderizada — [claude-plugins-official/external_plugins](https://github.com/anthropics/claude-plugins-official). Um vídeo citado em guia de terceiros recomenda combinar skills de design com Playwright para checagem visual — [Pillitteri PT](https://pasqualepillitteri.it/pt/news/982/claude-code-18-melhores-skills-design-uiux-guia)
- Guias de terceiros posicionam assim: UI UX Pro Max = gerador de sistema a partir do zero; Impeccable/Taste = camada anti-"AI slop"; Vercel = qualidade técnica. Nenhum comparou as skills no mesmo projeto (opinião) — [Pillitteri PT](https://pasqualepillitteri.it/pt/news/982/claude-code-18-melhores-skills-design-uiux-guia)

**Credibilidade e segurança do ecossistema**
- Koi Security auditou 2.857 skills do ClawHub e marcou 341 como maliciosas, 335 delas de uma campanha que instalava o stealer macOS AMOS via "pré-requisitos" falsos — [The Hacker News](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)
- O OWASP Agentic Skills Top 10 classifica skills maliciosas como críticas (rodam com as permissões do agente). Um estudo (Liu et al., USENIX Sec 2026) analisou 98.380 skills e confirmou 157 maliciosas — [OWASP AST01](https://owasp.org/www-project-agentic-skills-top-10/ast01.html)
- Snyk "ToxicSkills" (fev/2026): 13,4% de 3.984 skills do ClawHub e do skills.sh tinham ao menos um problema crítico. Esse número veio de um resumo secundário e não foi verificado no original — [resumo Daniel Vaughan](https://codex.danielvaughan.com/2026/06/07/agent-skill-supply-chain-crisis-clawhavoc-toxicskills-skillsieve-codex-cli-defence/)

### Inferences
- **Recomendação para o editor (React 19 + Tailwind 4, dark, PT-BR):**
  1. **Impeccable** como camada principal. `/impeccable init` gravaria o `PRODUCT.md` com "editor de vídeo para agência, editores humanos, PT-BR, dark", e `/impeccable document` geraria o `DESIGN.md` do editor atual. Depois `critique`/`audit`/`polish` na timeline, `onboard` no first-run do Kanban, `harden` para overflow de legendas longas em PT-BR e `clarify` para microcopy. As regras determinísticas sem API key se alinham com a filosofia "sem API paga".
  2. **Vercel web-design-guidelines** para auditoria objetiva de código: foco visível na timeline, `prefers-reduced-motion` para o avatar animado, `Intl.NumberFormat`/datas em pt-BR, `tabular-nums` para timecodes.
  3. **UI UX Pro Max** só como "consulta" de paletas e tipografia (tem a categoria Photo/Video Editor). Ele é mais útil em landing pages e projetos novos do que num editor já existente. Evitar o Premium.
  4. **Taste Skill** (`redesign-existing-projects`, VISUAL_DENSITY alto) é alternativa ao Impeccable. Não faz sentido instalar os dois ao mesmo tempo, porque são instruções estéticas concorrentes.
- Para motion e interação (avatar pixel-art, transições da timeline): `/impeccable animate`, a regra "um momento orquestrado" da frontend-design oficial e a seção Motion do `design:design-handoff`. O Thales já tem `claude-animation` e `motion-designer` instalados para motion de vídeo; essas skills de UI são complementares.
- Credibilidade: as quatro principais têm repositório público, código legível e dezenas de milhares de estrelas. As instruções de instalação usam `npx`/npm/Python locais. Mesmo assim, pelo histórico de malware em marketplaces de skills, a recomendação é **ler SKILL.md e scripts antes de instalar** e preferir `/plugin marketplace add <repo>` de autor conhecido a agregadores (ClawHub, skills.sh mirrors).

### Gaps
- Não achei benchmark independente comparando Impeccable × Taste × UI UX Pro Max no mesmo projeto. As comparações disponíveis são opinião de blogs.
- Não encontrei nenhuma skill de UX writing específica para **português do Brasil**.
- Não verifiquei os arquivos de LICENSE de Impeccable e Taste Skill (só listagens de terceiros).
- Accessibility para componentes de vídeo (legendas/closed captions, controles de player) não aparece como regra específica nas skills lidas.

---

## 3. Que skills ajudam a desenhar evals/benchmarks e loops de feedback humano para agentes ou heurísticas, sem API paga (inclui alternativas locais ao LLM-as-judge)?

### Takeaway
A peça central é o plugin **evals** de Hamel Husain e Shreya Shankar (`ai-evals-course/evals-skills`). O `error-discovery` dele monta um app de revisão em HTML com servidor Python stdlib, sem dependências, e o `write-code-eval` encaixa no benchmark determinístico (IoU) que o NewEditor já tem. O **skill-creator** oficial traz um padrão reutilizável de benchmark com viewer, feedback humano e comparação cega. O guia da Anthropic "Demystifying evals for AI agents" (jan/2026) dá a metodologia: graders de código primeiro, tarefas tiradas de falhas reais, capability vs regression. Para LLM-judge local, o promptfoo permite trocar o grader, mas não achei skill pronta Ollama/MLX.

### Cited Findings

**Metodologia oficial (Anthropic)**
- "Demystifying evals for AI agents" (Anthropic Engineering, 09/jan/2026; Grace, Hadfield, Olivares, De Jonghe) define três tipos de grader. **Code-based**: rápido, barato, reprodutível, mas frágil a variações válidas. **Model-based**: flexível, mas não determinístico e precisa de calibração. **Human**: padrão-ouro, caro. A ordem recomendada é determinístico onde der, LLM onde for necessário e humano com parcimônia — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- O post diz que "20-50 simple tasks drawn from real failures is a great start". Recomenda converter falhas reportadas em casos de teste, ter solução de referência por tarefa e balancear casos em que o comportamento deve e não deve ocorrer — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- pass@k (ao menos 1 acerto em k) vs pass^k (todos os k acertam; 0,75³ ≈ 42%). Capability evals começam com taxa baixa e, quando estabilizam, "graduam" para regression evals (~100%). O post insiste em "Read the transcripts!" e, para juízes LLM, recomenda calibrar contra humanos, oferecer opção "Unknown" e usar um juiz isolado por dimensão — [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

**Plugin "evals" (Hamel Husain + Shreya Shankar): comunidade, mantido pelos autores do curso**
- O repo `hamelsmu/evals-skills` (~1,7k ★) está **deprecated** ("The skills moved to ai-evals-course/evals-skills, a plugin called `evals`"). Item obsoleto: não instalar o antigo — [hamelsmu/evals-skills](https://github.com/hamelsmu/evals-skills)
- O novo repo (~1,5k ★) tem as skills `evals-start` (roteador), `eval-audit`, `error-discovery`, `generate-synthetic-data`, `write-code-eval` ("code checks for objective failure modes"), `write-judge-prompt`, `validate-evaluator` (calibra o juiz contra rótulos humanos com TPR/TNR e correção de viés), `evaluate-rag` e `build-review-interface`. Instalação: `npx skills add https://github.com/ai-evals-course/evals-skills` — [ai-evals-course/evals-skills](https://github.com/ai-evals-course/evals-skills)
- `error-discovery` lê um JSONL/CSV/JSON de saídas ou traces, desenha a codificação visual, "Builds a single-file HTML review app served by a Python stdlib server. No dependencies", clusteriza e escolhe amostra diversa. Depois roda um loop interativo em que o humano escreve notas livres e o agente as agrupa em failure modes e propõe novas amostras para cobrir lacunas. "You should only write evals after doing this step" — [ai-evals-course/evals-skills](https://github.com/ai-evals-course/evals-skills)
- Os próprios autores avisam: "Skills grounded in your stack, your domain, and your data will outperform them". O repo antigo trazia um "meta-skill" para isso — [hamelsmu/evals-skills](https://github.com/hamelsmu/evals-skills)
- A abordagem de juiz do Husain usa veredito binário pass/fail, um failure mode por juiz e crítica antes do veredito, evitando escalas de 1 a 5 (descrição em listagem de terceiros) — [claudemarketplaces write-judge-prompt](https://claudemarketplaces.com/skills/hamelsmu/evals-skills/write-judge-prompt)

**skill-creator (oficial Anthropic)**
- Descrição: "run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy". Os casos ficam em `evals/evals.json`; cada iteração roda com e sem a skill; um subagente grader produz `grading.json` (`text`/`passed`/`evidence`); `aggregate_benchmark` gera `benchmark.json`/`.md` com pass_rate, tempo e tokens (média ± desvio padrão e delta) — [skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- O `eval-viewer/generate_review.py` abre um HTML com abas "Outputs" (o humano deixa feedback por caso) e "Benchmark". O feedback volta como JSON para a próxima iteração. Há também "Blind comparison" (comparator e analyzer agents julgam duas versões sem saber qual é qual). E a nota: "Subjective skills (writing style, design quality) are better evaluated qualitatively — don't force assertions" — [skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- O analyzer procura assertions "non-discriminating" (passam com ou sem skill) e evals de alta variância (flaky) — [skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- Instalação: vem em `example-skills@anthropic-agent-skills` e também como plugin em claude-plugins-official — [anthropics/skills](https://github.com/anthropics/skills); [claude-plugins-official](https://github.com/anthropics/claude-plugins-official)

**LLM-as-judge local / ferramentas**
- promptfoo permite trocar o juiz de assertions model-graded (`llm-rubric` etc.) por `--grader <provider>`, `defaultTest.options.provider` ou `provider` por assertion. Também aceita juízes self-hosted compatíveis com OpenAI. A página não mostra o ID do provider Ollama — [promptfoo docs](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/)
- Existe uma skill comunitária "promptfoo-evaluation" (daymade/claude-code-skills) para configs, assertions Python e llm-rubric. Só vi listagens de agregadores, e uma delas aponta um scanner que sinalizou `npm install -g` numa skill relacionada — [skills.cat promptfoo-evaluation](https://skills.cat/skills/daymade/claude-code-skills/promptfoo-evaluation)
- O plugin `pm-ai-shipping` do phuryn/pm-skills tem `intended-vs-implemented` ("finding the gap between what a system is documented to do and what the code actually does, with cited evidence") e `/derive-tests` (mapa de cobertura a partir da intenção documentada) — [phuryn/pm-skills](https://github.com/phuryn/pm-skills)
- `generate-synthetic-data` cria entradas de teste por "dimension-based tuple generation" — [ai-evals-course/evals-skills](https://github.com/ai-evals-course/evals-skills)

### Inferences
- **Encaixe direto no problema da decupagem (o "hard part"):**
  - O benchmark atual (IoU ~93,5% contra cortes ajustados por humano) já é um **grader code-based**, o tipo que a Anthropic recomenda priorizar. `write-code-eval` serve para adicionar checagens objetivas por failure mode além do IoU agregado: corte no meio de palavra, respiração cortada, silêncio residual acima de X ms, repetição de take não removida.
  - `error-discovery` é o mais valioso. Basta apontá-lo para um JSONL com os `review.json` (diff entre o corte do agente e o ajuste humano) para gerar um app de revisão local, onde o Thales escreve notas e o agente agrupa em failure modes ("corta cedo demais em pausas dramáticas", "não detecta fala sobreposta"). Isso transforma o loop de aprendizado em taxonomia mensurável. Roda 100% local (Python stdlib), mas a categorização das notas é feita pelo próprio Claude Code da sessão de desenvolvimento, não dentro do produto.
  - Seguindo a Anthropic: separar uma **regression suite** (casos que já passam, IoU ≥ limiar, rodar a cada mudança de regra) de uma **capability suite** (casos difíceis com baixa taxa: podcasts com 2 vozes, ruído). Medir pass^k quando houver não-determinismo (ex.: Whisper com seeds diferentes).
  - Montar 20–50 casos a partir de falhas reais (projetos em que o editor humano mais mexeu) com "solução de referência" = corte humano final.
- **LLM-as-judge**: para decupagem, um juiz LLM provavelmente não é necessário, porque a qualidade é mensurável contra o corte humano. Se surgir algo subjetivo (copy/letterings, escolha de B-roll do Cinéfilo.AI), o caminho sem API paga seria rodar o juiz no próprio Claude Code (dev-time) ou um modelo local via Ollama/promptfoo, sempre calibrado com `validate-evaluator` contra rótulos humanos. Isso é inferência: não achei skill pronta para juiz local.
- **skill-creator** serve para medir as skills do próprio Thales (motion-designer, a cadeia editorial analista → copywriter → diretor → editor). Ele tem benchmark com e sem skill, viewer com feedback humano e comparação cega entre versões.
- O padrão do viewer do skill-creator (abas Outputs/Benchmark, feedback salvo em JSON) pode inspirar a própria tela de revisão humana do NewEditor (gate de decupagem), capturando feedback estruturado por segmento.

### Gaps
- **Não achei skill oficial ou comunitária confiável para rodar juízes locais via Ollama/MLX dentro do Claude Code.** Também não confirmei o ID do provider Ollama na página do promptfoo lida.
- Não encontrei nenhuma skill chamada "build-eval" ou "hillclimb" com fonte verificável. O conceito de "hill to climb" aparece no post da Anthropic (capability evals com taxa inicial baixa), não como skill.
- Não há skill específica para eval de segmentação temporal (IoU de intervalos, alinhamento de timecode). Teria de ser escrita pelo Thales, e o próprio Husain recomenda skills próprias do domínio.

---

## 4. Há skills para análise competitiva/teardown de SaaS de vídeo e para escrever ADRs/docs de produto no Obsidian? (+ bônus breve: lançamento)

### Takeaway
Para competitivo, além do `competitive-brief` oficial, há dois packs de PM com muita adoção: **phuryn/pm-skills** (~26,9k ★, nove plugins incluindo market-research, strategy e pricing) e **deanpeters/Product-Manager-Skills** (~7,2k ★, 70 skills, "Market Intelligence Suite" de jul/2026 com rótulos Fato/Inferência/Premissa). Para ADR há o oficial `engineering:architecture`. Para escrever no vault há **kepano/obsidian-skills** (~49,4k ★: Obsidian Markdown, Bases, JSON Canvas, CLI). Nenhum é específico de ferramentas de vídeo: o recorte CapCut/Descript/Opus Clip/Submagic/Captions.ai precisa ser passado no prompt.

### Cited Findings

**Competitivo / estratégia**
- phuryn/pm-skills, "PM Skills Marketplace: 100+ agentic skills, commands, and plugins". Instalação: `claude plugin marketplace add phuryn/pm-skills` e depois `claude plugin install pm-market-research@pm-skills` (também pm-product-discovery, pm-product-strategy, pm-execution, pm-go-to-market, pm-marketing-growth, pm-data-analytics, pm-ai-shipping, pm-toolkit) — [phuryn/pm-skills](https://github.com/phuryn/pm-skills) (~26,9k ★)
  - `pm-market-research`: competitor-analysis, personas, segmentação, customer-journey-map, market-sizing (TAM/SAM/SOM), sentiment-analysis; comandos `/competitive-analysis`, `/research-users`, `/analyze-feedback` — [phuryn/pm-skills](https://github.com/phuryn/pm-skills)
  - `pm-product-strategy`: product-strategy canvas, value-proposition (JTBD em 6 partes), pricing-strategy, SWOT, PESTLE, Porter, Ansoff; `/pricing`, `/market-scan` — [phuryn/pm-skills](https://github.com/phuryn/pm-skills)
  - `pm-product-discovery`: opportunity-solution-tree, identify/prioritize-assumptions, interview-script e summarize-interview (JTBD), analyze-feature-requests; `/discover`, `/triage-requests` — [phuryn/pm-skills](https://github.com/phuryn/pm-skills)
  - `pm-execution`: create-prd, pre-mortem (Tigers/Paper Tigers/Elephants), `/red-team-prd` (stress-test adversarial que ranqueia premissas pelo teste mais barato), release-notes, job-stories, test-scenarios — [phuryn/pm-skills](https://github.com/phuryn/pm-skills)
- deanpeters/Product-Manager-Skills: "70 skills". A v0.83 (17/jul/2026) adicionou a "Market Intelligence Suite" (14 skills), com a cadeia market-landscape-scan → competitive-research-snapshot → competitive-intel-watch → battle-card-builder, e o modo `autonomous-investigation` com rótulos "Fact / Inference / Assumption" em cada afirmação, listas do-not-invent e schemas diffáveis para comparar trimestre a trimestre. Cada skill oferece profundidade Light/Standard/Heavy. Instalação: `claude /plugin marketplace add deanpeters/Product-Manager-Skills` — [deanpeters/Product-Manager-Skills](https://github.com/deanpeters/Product-Manager-Skills) (~7,2k ★)
- coreyhaines31/marketingskills (~54k ★): `competitor-profiling` (perfil de concorrentes a partir das URLs), `competitors` (páginas de comparação/alternativas), `pricing`, `onboarding` (ativação e time-to-value), `launch`, `copywriting`, `cro`, `product-marketing`, `directory-submissions` — [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
- Repos menores ou de baixo sinal: Digidai/product-manager-skills (~185 ★) — [GitHub](https://github.com/Digidai/product-manager-skills); julesb22/product-builder-kit (0 ★ em 10/out/2026, apesar de citado em guias) — [GitHub](https://github.com/julesb22/product-builder-kit)

**ADRs e docs de produto no Obsidian**
- `engineering:architecture` (oficial): "Create or evaluate an architecture decision record (ADR)… documenting a design decision with trade-offs and consequences" — [engineering/skills/architecture](https://github.com/anthropics/knowledge-work-plugins/blob/main/engineering/skills/architecture/SKILL.md). O `stakeholder-update` também traz o formato ADR (Status/Context/Decision/Consequences) — [stakeholder-update/SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/stakeholder-update/SKILL.md)
- kepano/obsidian-skills (~49,4k ★): `obsidian-markdown` (wikilinks, embeds, callouts, properties), `obsidian-bases` (`.base` com views, filtros, fórmulas), `json-canvas` (`.canvas`), `obsidian-cli` (interagir com o vault via Obsidian CLI), `defuddle` (web → markdown limpo) e `knap` (templates a partir de JSON/CSV). Instalação: `/plugin marketplace add kepano/obsidian-skills` e depois `/plugin install obsidian@obsidian-skills` — [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills)
- O `doc-coauthoring` existe no repo oficial anthropics/skills (não li o conteúdo) — [anthropics/skills](https://github.com/anthropics/skills)

**Bônus breve: lançamento (landing page, vídeos demo)**
- `marketing` oficial: content-creation/draft-content (landing pages, posts, e-mail), campaign-plan e seo-audit. Ahrefs/Similarweb/HubSpot são opcionais e pagos — [knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)
- Remotion Agent Skills (oficiais do Remotion, ~5k ★): `/remotion-best-practices`, `/remotion-create` ("Make a promo video…"), `/remotion-markup`. Instalação: `npx skills add remotion-dev/skills` — [remotion-dev/skills](https://github.com/remotion-dev/skills); [docs Remotion](https://www.remotion.dev/docs/ai/skills)
- Para landing: frontend-design oficial / Impeccable / UI UX Pro Max (a seção 2 traz as fontes). O marketingskills tem `copywriting`, `cro` e `launch` — [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)

### Inferences
- **Teardown competitivo de vídeo**: usar `/product-management:competitive-brief` ou `/competitive-analysis` (phuryn) com prompt fechado, por exemplo "CapCut, Descript, Opus Clip, Submagic, Captions.ai; eixo: fluxo de agência com revisão humana, legendas editáveis PT-BR, decupagem automática, preço em BRL, IA local vs nuvem". Gravar o resultado no vault com `obsidian-markdown`/`obsidian-bases`, criando uma Base "Concorrentes" com propriedades (preço, decupagem automática?, gate humano?, PT-BR?).
- O `autonomous-investigation` do deanpeters (Fato/Inferência/Premissa e schema diffável) serve para um **monitor trimestral de concorrentes**, por exemplo como tarefa agendada que gera nota nova no Obsidian e mostra o diff do que mudou no CapCut/Descript.
- `/red-team-prd` e `pre-mortem` (phuryn) são úteis para estressar o PRD do Gestor de Projetos antes de codar (riscos: quota da API do Drive, estimativa de tempo errada, briefing que alucina requisitos).
- ADRs: `engineering:architecture`, salvando em `vault/ADR/NNNN-titulo.md` com properties do Obsidian (status, data, decisão). Primeiros candidatos: "cérebro local rule-based (sem LLM pago)", "review.json como fonte de aprendizado", "avatar pixel-art: sprite vs canvas".
- Demo de lançamento: como o stack é React, as skills do Remotion permitem gerar vídeos demo/promos programáticos. Para a demo principal, porém, gravar o próprio editor funcionando tende a ser mais convincente (inferência).
- Prioridade sugerida para testar (todas sem API paga):

| # | Skill/plugin | Tipo | Como instalar/invocar | API/conta paga? | Uso no NewEditor.AI |
|---|---|---|---|---|---|
| 1 | evals (`error-discovery`, `write-code-eval`, `validate-evaluator`) | Comunidade (Husain/Shankar) | `npx skills add https://github.com/ai-evals-course/evals-skills` | Não | Taxonomia de falhas da decupagem a partir de review.json; checks por failure mode |
| 2 | product-management (write-spec, roadmap-update, competitive-brief, synthesize-research) | Oficial | já na sessão desktop; CLI: `claude plugin install product-management@knowledge-work-plugins` | Não (conectores opcionais e pagos) | PRDs do Gestor de Projetos e do Cinéfilo.AI; roadmap RICE; teardown |
| 3 | Impeccable | Comunidade (pbakaus) | `npx impeccable install` → `/impeccable init` | Não | PRODUCT.md/DESIGN.md; critique/audit/polish/onboard/clarify no editor |
| 4 | design (critique, accessibility-review, ux-copy, design-system, handoff) | Oficial | já na sessão; CLI: `claude plugin install design@knowledge-work-plugins` | Não (Figma opcional) | Crítica de screenshots, WCAG no tema dark, microcopy PT-BR |
| 5 | Vercel web-design-guidelines + react-best-practices | Oficial Vercel | `npx skills add vercel-labs/agent-skills` | Não | Auditoria de a11y/i18n/motion do código React |
| 6 | engineering:architecture + kepano/obsidian-skills | Oficial + comunidade | `/plugin install obsidian@obsidian-skills` | Não | ADRs e Bases no vault |
| 7 | skill-creator | Oficial | `example-skills@anthropic-agent-skills` | Não | Benchmark das skills editoriais do Thales (com/sem skill, blind compare) |
| 8 | phuryn/pm-skills (market-research, execution) ou deanpeters | Comunidade | `claude plugin marketplace add phuryn/pm-skills` | Não | `/red-team-prd`, pre-mortem, monitor competitivo |
| 9 | UI UX Pro Max (só busca de paletas/fontes) / Taste Skill | Comunidade | ver seção 2 | Não (Premium do UUPM é pago) | Landing page; referências de estilo |
| 10 | Remotion skills / marketing oficial | Oficial Remotion / Anthropic | `npx skills add remotion-dev/skills` | Não (verificar licença Remotion) | Vídeo promo e landing de lançamento |

### Gaps
- Não achei nenhuma skill específica de **teardown de ferramentas de edição de vídeo** nem base de dados pronta de concorrentes de vídeo com IA.
- Não verifiquei os termos de licença do Remotion para uso comercial (há licença para empresas, mas não confirmei os critérios nesta pesquisa).
- Não li o conteúdo do `doc-coauthoring` oficial nem do `obsidian-cli` (requisitos de versão do Obsidian CLI).
- Os packs phuryn e deanpeters têm muitas skills, mas não achei avaliação independente da qualidade dos outputs. A popularidade (estrelas) é o único sinal objetivo.
