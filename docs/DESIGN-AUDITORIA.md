# Auditoria de design: Editor Brain (NewEditor.AI)

**Data:** 2026-10-10 · **Escopo:** `apps/web` (Kanban, editor, painéis, timeline, player, avatar, revisão, notificações) · **Base:** código + telas no navegador + `docs/ESTUDO-CAPCUT.md`
**Princípio do produto:** o Editor Brain é autossuficiente. Tudo o que o editor precisa para revisar, ajustar e entregar fica dentro dele.

## Resumo

**Componentes revistos:** 21 · **Problemas encontrados:** 28 · **Nota:** 58/100

A base visual é boa: tema escuro coerente, as cores de corte (retake, começo abandonado, bastidor, hesitação) contam a história da decupagem e o avatar agora tem identidade. O que puxa a nota para baixo é a falta de **sistema**:
- os tokens são só de cor;
- o texto vem em 8 tamanhos soltos, quase todos abaixo de 12 px;
- não existe um componente de botão;
- a acessibilidade de teclado é praticamente zero (0 `aria-label`, 0 `focus-visible`).

Para o agente, falta mostrar **o que ele vai fazer, o que fez e o que precisa do humano** num lugar só. Para o editor, faltam os atalhos e as ferramentas de precisão que o CapCut deixa sempre à mão.

## 1. Tokens

| Categoria | Definido | Valores soltos encontrados |
|---|---|---|
| Cores | 12 neutros (`ink`), 4 da marca (`nc`, `cyan-nc`), 6 de corte | 6 hex e 12 `rgb()` direto nos componentes. Faltam semânticos: sucesso, aviso, erro, informação e "humano/agente" |
| Tipografia | 2 famílias (Inter, mono) | **227** `text-[Npx]`: 9, 9.5, 10, 10.5, 11, 11.5, 12.5 e 13.5 px. Nenhuma escala |
| Espaçamento | escala do Tailwind | razoável. Alturas de trilha fixas no código (`ROW`) e fora de um token |
| Raio | nenhum token | 6 variações (`rounded`, `-md`, `-lg`, `-xl`, `-2xl`, `-full`) usadas sem regra |
| Sombra/elevação | nenhum | `shadow-lg`, `shadow-xl` e `shadow-2xl` misturados |
| Movimento | keyframes do avatar | sem duração ou curva padrão. Sem `prefers-reduced-motion` |
| Camadas (z-index) | nenhum | z-10/20/30/40 decididos caso a caso (cursor, avatar, cabeçalhos) |

**Proposta:**
- **Tipografia:** 5 tamanhos — `--text-2xs` 10, `--text-xs` 11, `--text-sm` 12, `--text-base` 13 e `--text-lg` 15. Mínimo de 11 px em texto que a pessoa precisa ler, e 10 só para rótulos de régua e contadores.
- **Raio:** 3 tamanhos — `--radius-sm` 4 (blocos da timeline), `--radius-md` 8 (controles) e `--radius-lg` 12 (cartões e painéis).
- **Elevação:** 3 níveis — `--shadow-1` popover, `--shadow-2` menu e `--shadow-3` modal.
- **Movimento:** `--dur-fast` 120 ms, `--dur-base` 200 ms, `--ease-out` e `@media (prefers-reduced-motion)` desligando bob, pulo e confete.
- **Camadas:** `--z-track`, `--z-cursor`, `--z-avatar`, `--z-popover`, `--z-toast`.
- **Cores semânticas:**
  - estados: `--color-ok`, `--color-warn`, `--color-danger`, `--color-info`;
  - quem fez: `--color-agent` (ciano) e `--color-human` (âmbar). O Kanban e o histórico já usam essa distinção, só que sem token.

## 2. Componentes

| Componente | Estados | Variantes | Docs | Nota |
|---|---|---|---|---|
| Botão (27 primários `bg-nc-500` escritos à mão) | ⚠️ sem foco nem carregando | ❌ sem primário, secundário, fantasma ou perigo padronizados | ❌ | 4/10 |
| ToolButton (só na timeline) | ⚠️ desabilitado ok, sem foco | ❌ | ❌ | 5/10 |
| Abas (painel esquerdo e direito) | ⚠️ rótulo corta ("Tran…") em telas estreitas | ❌ dois estilos diferentes | ❌ | 5/10 |
| Input / `.input` | ✅ foco | ⚠️ sem erro nem ajuda | ❌ | 6/10 |
| Slider (Áudio, Cor) | ⚠️ grava só no soltar; sem campo numérico | ❌ três implementações | ❌ | 5/10 |
| Bloco de clipe (timeline) | ✅ selecionado | ✅ por trilha | ⚠️ | 7/10 |
| Cabeçalho de trilha | ⚠️ nome corta ("Letterin…", "Audio d…") | — | ❌ | 5/10 |
| Cartão do Kanban | ⚠️ sem miniatura, prazo ou progresso | — | ❌ | 5/10 |
| Balão de fala do agente | ✅ progresso | — | ⚠️ | 7/10 |
| Avatar | ✅ 6 estados | ✅ corpo inteiro e retrato | ✅ `#/avatar` | 9/10 |
| Toast de notificação | ⚠️ sem ação ("Abrir", "Revisar") | — | ❌ | 6/10 |
| Lista de legendas | ✅ dividir/juntar/apagar | — | ⚠️ | 8/10 |
| Diálogos | ❌ `confirm()` nativo no Motion e na Revisão | — | ❌ | 3/10 |

## 3. Acessibilidade e operação pelo teclado

- **0 `aria-label` e 71 `title`:** os botões só de ícone (desfazer, dividir, zoom, sino, motor) não têm nome acessível. O `title` só aparece no hover.
- **0 `focus-visible`:** usando Tab, não se vê onde está o foco.
- **Contraste:** `ink-500` (#4a5263) sobre `ink-850` dá cerca de 2,3:1 e aparece em textos de ajuda. O mínimo é 4,5:1, então use `ink-400`/`ink-300` para texto.
- **Passo de quadro errado:** as setas pulam 1/30 s, mas a timeline do projeto é 23,976 fps. O passo deve ser `1/timeline.fps`.
- **Confirmações nativas** (`confirm()`) quebram o tema e não deixam desfazer. A regra do produto é "tudo se desfaz", então troque por ação direta + desfazer no toast.

## 4. Para o Agente: deixar o trabalho dele legível e controlável

O agente trabalha ao vivo, mas a interface mostra **o que ele está fazendo agora** e quase nada do **antes** e do **depois**.

| # | Proposta | Por quê | Referência |
|---|---|---|---|
| A1 | **Fila de tarefas do agente** no painel Agente: etapas (decupar → cor → legenda → letterings → motions → SFX), cada uma com estado, tempo estimado e tempo gasto | O canvas pede "cálculo de tempo"; hoje só existe o balão do momento | pedido do canvas |
| A2 | **Marcas do agente na timeline:** cada decisão vira um alfinete pequeno (✂ corte, ✦ motion, Aa lettering) com o motivo no hover e "desfazer só isto" | O editor vê o *porquê* sem abrir a Revisão; o motivo já está salvo (`reason`) | CapCut mostra marcadores na régua |
| A3 | **Dúvidas do agente na timeline:** um losango âmbar onde o agente pediu revisão, com o mesmo clique da aba Revisão | Liga a revisão ao lugar do vídeo | — |
| A4 | **Pedir alteração no ponto:** clicar com o direito num clipe ou palavra e escolher "Pedir ao agente…" já preenche "aqui = 1:23" | Hoje o pedido é texto solto no painel | Comando com contexto |
| A5 | **Estado "esperando você"** no avatar e no Kanban: o avatar acena para o humano quando a decupagem vai para revisão | Fecha o ciclo do fluxo de revisão com o personagem | canvas: "comemoração a cada etapa" |
| A6 | **Diferença antes/depois** de cada passada do agente: "Cortei 14 trechos (−38 s)", com a lista e "ver na timeline" | Confiança: o humano sabe o que mudou sem comparar de olho | histórico já existe |
| A7 | **Toast com ação:** "Decupagem pronta — Revisar" leva direto para a aba Revisão, na primeira dúvida | Hoje o toast só informa | — |

## 5. Para o Editor: precisão e velocidade (comparando com o CapCut)

| Área | CapCut | Editor Brain hoje | Trazer |
|---|---|---|---|
| **Atalhos** | Q/W (aparar à esquerda/direita do cursor), Ctrl+B dividir, setas por quadro, I/O, J/K/L | Espaço, S, Delete, setas (1/30 s), +/− | **E1:** Q/W, J/K/L, I/O, setas por quadro real, `?` abrindo a folha de atalhos |
| **Ímã e alinhamento** | ímã liga/desliga, linha guia ao encostar | ímã em início/fim de palavra (só no aparar) | **E2:** botão de ímã, linha guia ao arrastar overlay e encaixe no cursor e em clipes |
| **Seleção** | várias com Shift/arrasto, mover em grupo | uma por vez | **E3:** seleção múltipla e "apagar/mover/aplicar estilo" em grupo |
| **Trilhas** | trava, oculta, muda o som, altura ajustável | olho só na LG | **E4:** cadeado, olho e mudo em cada trilha; arrastar para mudar a altura |
| **Miniaturas** | filmstrip contínua | filmstrip ✅ | ok |
| **Inspector** | painel direito por seleção com abas (Básico, Animação, Texto) | Propriedades ✅ | **E5:** campos numéricos ao lado de cada slider e "aplicar a todos os letterings" |
| **Legenda no player** | edita o texto direto no vídeo | edita na lista e na trilha | **E6:** duplo clique na legenda do player para editar ali (o HTML já é o mesmo do export) |
| **Prévia de estilo** | grade com miniatura animada de cada estilo | lista de estilos com nome | **E7:** cartões com prévia animada (o motor de lettering já desenha qualquer quadro) |
| **Zoom da timeline** | slider + "encaixar" | ✅ | ok |
| **Desfazer** | Ctrl+Z com rótulo | ✅ com rótulo | ok; mostrar o histórico clicável (já existe no store) |
| **Proxy/qualidade** | escolha de qualidade da prévia | motor Clássico/WebCodecs | **E8:** um seletor só "Prévia: Rápida / Completa", escondendo o nome técnico do motor |

**Painéis do lado esquerdo:**
- **Transcrição:** é o diferencial do produto (editar o vídeo pelo texto), e o CapCut não tem igual. Vale dar mais destaque:
  - legenda de cores fixa no topo;
  - busca;
  - "mostrar só o que o agente cortou".
- **Abas com rótulo cortado:** em telas estreitas os ícones ficam e os nomes cortam ("Tran…"). Use ícone + nome curto (Texto, Mídia, Motion, Áudio, Cor, Fala) ou só ícone com tooltip abaixo de 1280 px.
- **Mídia:** permite arrastar para a timeline, mas o material não mostra o que já está em uso. Marque o clipe usado (✓, como o CapCut) e indique quantas vezes o B-roll foi usado, porque a regra é no máximo 2×.

## 6. Kanban

| # | Proposta |
|---|---|
| K1 | **Cartão completo:** miniatura do vídeo, cliente, prazo, duração montada, avatar do responsável (agente ou humano) e uma barra de progresso da etapa |
| K2 | **Colunas vazias recolhidas** em telas estreitas: os projetos ficam fora da tela à direita, e a primeira coisa que se vê são 4 colunas vazias |
| K3 | **Filtro "precisa de mim"**: mostra só o que espera o humano (Revisão da decupagem, Editado, Alteração) |
| K4 | **Tempo estimado do agente** no cartão (pedido do canvas) |
| K5 | **Prévia ao passar o mouse**: tocar 3 s do corte montado |

## 7. Ações prioritárias

1. **Tokens e componentes base:**
   - escala de texto (mínimo 11 px), raio, elevação, movimento, camadas e cores semânticas em `styles.css`;
   - componentes `Button`/`IconButton` (com `aria-label` obrigatório e `focus-visible`), `Tabs` e `Slider` com campo numérico;
   - trocar os 227 tamanhos soltos.
   - Resolve de uma vez a legibilidade, o teclado e a consistência.
2. **Agente legível (A1, A2, A7):** fila de tarefas com tempo, marcas de decisão na timeline e toast com ação.
3. **Precisão do editor (E1, E2, E4):**
   - atalhos do CapCut com passo por quadro real e folha `?`;
   - ímã e linha guia;
   - trava, oculta e mudo por trilha.
4. **Kanban útil (K1, K2, K3):** cartão com miniatura e prazo, colunas vazias recolhidas e filtro "precisa de mim".
5. **Diálogos:** trocar `confirm()` por ação + desfazer no toast.

## Perguntas em aberto

- Qual largura de tela é a principal do editor humano (notebook 13–14" ou monitor)? Ela define se as abas da esquerda ficam só com ícones.
- O Kanban vai mostrar projetos de vários editores (com responsável) ou é pessoal?
- O seletor de motor deve sair da interface e virar um "Rápida/Completa", ou ficar como opção avançada?

## Status da implementação (2026-10-10)

| Item | Status | Onde |
|---|---|---|
| Tokens: escala de texto `text-ui-*`, raio, elevação, movimento, camadas, cores semânticas (ok, aviso, perigo, agente, humano) | ✅ 227 tamanhos soltos trocados | `styles.css` |
| Contraste do texto secundário (`ink-400` ≥ 4,5:1; `text-ink-500` → `ink-400`) | ✅ | `styles.css` + componentes |
| Foco visível global; `prefers-reduced-motion` | ✅ | `styles.css` |
| `Button`, `IconButton` (nome acessível obrigatório), `RangeField` (slider + campo numérico), `ConfirmButton` | ✅ | `components/ui.tsx` |
| Botões só de ícone com `aria-label` | ✅ | componentes |
| `confirm()` trocado por confirmação no próprio botão | ✅ | Revisão, Motion |
| Passo de quadro pelo fps real (23,976) | ✅ | `Editor.tsx` |
| A1 etapas do agente com estimativa e tempo gasto (compacto, expande) | ✅ | `AgentPipeline.tsx` |
| A2 marcas de corte na timeline com motivo e "Restaurar" só aquele | ✅ | `Timeline.tsx` (`AgentMarks`) |
| A3 dúvidas do agente no ponto do vídeo (abre a Revisão) | ✅ | `AgentMarks` |
| A4 clique direito no clipe → pedido ao agente pré-preenchido com o tempo e a fala | ✅ | `ClipBlock` + `AgentPanel` |
| A5 "Sua vez" no painel e no balão do avatar | ✅ | `AgentPipeline`, `Timeline` |
| A6 resumo da última passada (cortes, segundos, motions, letterings) | ✅ | `AgentPipeline` (`LastPass`) |
| A7 notificação com "Revisar agora" / "Depois" | ✅ | `Notifications.tsx` |
| E1 atalhos Q/W, J/K/L, I/O, X, N, `,` `.`, folha `?` | ✅ | `Editor.tsx`, `Shortcuts.tsx` |
| E2 ímã liga/desliga + linha guia (cursor, emendas, overlays) | ✅ | `Timeline.tsx` |
| E3 seleção múltipla de overlays (Shift+clique) e Delete em grupo | ✅ | store + `Timeline` + `Editor` |
| E4 ocultar / mudo / travar por trilha — valem no preview E no export | ✅ | core `set_track_state`, `render.ts`, motores |
| E5 campos numéricos nos sliders; "Aplicar a todos os letterings" | ✅ | `ui.tsx`, `PropertiesPanel` |
| E6 duplo clique na legenda do player para editar ali | ✅ | `PlayerParts.tsx` |
| E7 estilos de lettering em cartões com prévia animada | ✅ | `PropertiesPanel` |
| E8 seletor "Prévia leve / Quadro exato" | ✅ | `PlayerParts.tsx` |
| Mídia: ✓ em uso e contagem de B-roll (máx. 2×) | ✅ | `MediaPanel.tsx` |
| K1 cartão com miniatura, cliente, prazo, responsável | ✅ | `Home.tsx` |
| K2 colunas vazias recolhidas | ✅ | `Home.tsx` |
| K3 filtro "Precisa de mim" (lembrado no navegador) | ✅ | `Home.tsx` |
| K4 estimativa do agente no cartão | ✅ | `Home.tsx` |
| K5 prévia de 3 s ao passar o mouse | ✅ | `Home.tsx` |

### Itens da ADR-007 feitos nesta rodada (design)

| Item | Status |
|---|---|
| D-1 Modo Revisão focado (J/K, L, A, T, R, Enter) | ✅ `ReviewFocus.tsx` |
| D-2 Antes/depois (segurar B ou o botão na barra) | ✅ no motor "Quadro exato" |
| D-4 Paleta de comandos ⌘K (ações + pedido ao agente) | ✅ `CommandPalette.tsx` |
| D-5 Gaveta do projeto no Kanban (briefing, prazo, perfil, estimado × real, versões) | ✅ `ProjectDrawer.tsx` |
| Página de perfis de edição (`#/perfis`) com o Cérebro local e o benchmark | ✅ `ProfilesPage.tsx` |
| QC na aba Revisão; Alterações (comentários com tempo) e versões | ✅ `ReviewPanel.tsx`, `CommentsSection.tsx` |
| Exportar e entregar (preset, .srt, capa, pasta, Entregue) | ✅ `ExportDialog.tsx` |
| Cinéfilo na aba Mídia | ✅ `CinefiloPanel.tsx` |
| D-3 avatar de frente, D-6 página do design system, D-7 presets de layout, D-8 estados vazios | ⏳ |
| D-7 Presets de layout (notebook/monitor) e recolher painéis | ✅ `Editor.tsx` |
| D-8 Estado vazio do Kanban (primeiro projeto guiado) | ✅ `Home.tsx` |
| D-3 Aceno de "sua vez" no avatar (vista de frente ainda precisa de arte) | ⚠️ `Avatar.tsx` |
