# ADR-011: As funções do CapCut no Editor Brain, como dado que o agente usa

**Status:** Proposto
**Data:** 2026-10-12
**Decide:** Thales

## Contexto

O Thales entregou o CapCut (app e instalador) e pediu: legenda personalizável como a deles; cor como a deles, mantendo a conversão de LOG que é melhor no nosso; camadas infinitas; formato em pixels personalizável; transições e efeitos, que não temos; a aba Motion como está (Motion Studio), só menos apertada; e que tudo isso vire **informação que o agente usa para editar**. O inventário completo, área por área, está em `docs/ESTUDO-CAPCUT-FUNCOES.md`.

Regras que valem (memória do projeto): toda alteração acontece dentro do app; cada função é pensada pela inteligência do agente e pela funcionalidade para o editor; os motions vêm do Motion Studio; o padrão é do editor, não de uma loja (ADR-008).

## Decisão

**Cada função nova existe em três lugares ou não existe:** uma operação da timeline (núcleo), um controle no editor (interface) e um campo de conhecimento (perfil + regra do agente + regra do QC). O vocabulário editorial (quando usar cada transição, efeito, animação) entra no Cérebro do Editor como nota de ofício.

### Ordem de implementação

| Fase | O que | Por que primeiro |
|---|---|---|
| **1. Formato** | `set_format` (largura, altura, fps) com presets e campos livres, na criação e no inspetor do projeto; reframe automático ao mudar a proporção; perfil por formato já existe (ADR-010) | pequeno, destrava o resto (camadas e transições dependem do quadro) e fecha o pedido "formatos personalizáveis" |
| **2. Legenda igual** | sombra completa (cor, desfoque, distância, ângulo), tarja com raio e margem, opacidade, rotação/escala, animação de entrada/saída e do destaque da palavra, cartões de preset com prévia | o dado (`CaptionSettings`) já viaja para o perfil do cliente; é a função que mais aparece em toda peça |
| **3. Cor completa** | nitidez, clareza, vinheta, grão, fade; HSL por matiz; curvas; rodas lift/gamma/gain (e a roda LOG); LUT `.cube` importada depois da conversão de entrada; combinar cor entre câmeras | o look do cliente passa a caber em `cor.grade` do perfil; a conversão de LOG continua primeiro na cadeia |
| **4. Camadas** | trilhas adicionáveis (V4+, A4+), mover entre trilhas, transformação por camada (opacidade, escala, posição, rotação), modos de mesclagem; hierarquia de camadas no perfil | muda o modelo de trilhas e o compositor; vem depois de o quadro ser livre |
| **5. Transições** | `set_transition` na emenda (seco, flash, dissolve, fade preto/branco, desfoque, deslizar, zoom), duração e SFX, no FFmpeg (`xfade`) e no preview; vocabulário narrativo e `transicoes.*` no perfil; QC | precisa do compositor pronto para misturar dois clipes |
| **6. Efeitos** | `OverlayRole` `efeito` (tremor, zoom pulsante, desfoque, vazamento de luz, vinheta, glitch leve, P&B, grão) com função narrativa e custo de atenção; camada de ajuste; teto por minuto no perfil; QC "efeito sem motivo" | é o que mais pode estragar uma peça; entra por último, com regra |
| **Transversal** | aba Motion com mais espaço (largura lembrada por aba, cartão do Studio como cabeçalho); batidas da trilha na régua | pedidos diretos do Thales |

### O que não entra
Chroma key, remoção de fundo, stickers, templates, loja, efeitos de rosto/corpo, TTS. Não são o nosso vídeo nem o nosso jeito (ADR-008).

## Consequências

- Mais fácil: o padrão editorial do cliente (ADR-010) passa a carregar legenda, cor, camadas, transições e efeitos como ficaram numa edição; o agente reproduz o look inteiro.
- Mais difícil: o compositor (preview e export) cresce em cada fase; preview = export continua obrigatório, então cada função é feita nos dois lados antes de entrar.
- Revisitar: keyframes e máscaras (depois das camadas); smooth-cut (morph) como transição; velocidade por curva.

## Fase 1 feita (2026-10-12)
- **Núcleo:** operação `set_format` (largura, altura, fps; pares, 64–8192 px; entra no histórico) e a marca `formatoManual` na timeline; presets `FORMAT_PRESETS` (9:16 1080×1920, 4:5 1080×1350, 1:1 1080×1080, 16:9 1920×1080 e 3840×2160, 21:9 2560×1080), `formatSize`, `ratioLabel`.
- **Editor:** campo "Formato da entrega" no diálogo de novo projeto (pela tarefa, preset ou pixels livres); seletor de formato no cabeçalho do player (como a proporção no CapCut); seção Formato editável em Ajustes → Projeto, com largura, altura, fps e o botão "Reenquadrar no rosto" quando o material é mais largo.
- **Conhecimento:** o Gestor cria o projeto já no formato da tarefa (o primeiro vídeo não sobrescreve um formato escolhido); a finalização faz o reframe pelo rosto antes da cor quando o bruto é mais largo que o quadro; o QC avisa `formato` (peça fora do formato do padrão) e `tarja` (material mais largo sem reframe); o padrão editorial por formato (ADR-010) já lê `formato` da timeline.

## Fase 2 feita (2026-10-12): legenda igual à do CapCut + posição livre no player
- **Núcleo:** `CaptionSettings` ganhou sombra completa (cor, desfoque, distância, ângulo), tarja com raio e margem, opacidade, rotação, escala, sublinhado, animação de entrada (pop, deslizar, fade, palavra por palavra), de saída (fade, deslizar) e da palavra falada (cor, cresce, caixa). Tudo é função do tempo em `captionInlineStyle(s, { t, start, end })` e `cueHtml`: o export desenha quadro a quadro o mesmo que o preview. `captionSafe` diz se a legenda está na área segura. `LetteringSpec.x` para posição horizontal livre.
- **Editor:** aba Legenda com presets em cartões (prévia desenhada pelo mesmo HTML), grupos Blocos, Animação, Posição e transformação, Tipografia, Contorno, Sombra, Tarja. **No player (pedido do Thales, "mexer livre com o mouse"):** arrastar a legenda move (x e altura), a alça do canto muda a escala, duplo clique edita; arrastar um lettering move (altura e centro). Gravado como operação normal (desfaz com ⌘Z).
- **Conhecimento:** `legenda.ajustes` do padrão editorial já leva os campos novos; o QC avisa `legenda-fora-do-quadro` (sai do quadro, encosta na borda ou girada demais); o vocabulário do Cérebro diz quando animar.

## CinePRO dentro do Editor Brain (2026-10-12, pedido do Thales; revisto no mesmo dia)
O Thales pediu a biblioteca **da nuvem do CinePRO** (os arquivos renomeados com o branding), não o pack local, e a divisão: a aba CinePRO só com som; overlays e transições numa aba Efeitos; as LUTs na aba Cor. "É só usar o sistema do CinePRO pra gente, porque é nosso."

- **Fonte:** o mesmo sistema do plugin. Catálogo = o manifesto público publicado no jsDelivr (categorias branded "CinePRO Sound Design", "CinePRO Sound Library", "CinePRO Visual", "CinePRO Presets", "CinePRO Essentials"; ids, tags, conceitos), com cópia em `data/cinepro-manifest.json` e reserva no `manifest/dist` do projeto CinePRO. Arquivos = a CDN própria (Cloudflare R2, `{id}.{ext}`), com o Drive público como reserva; baixados sob demanda para `data/cinepro-cache/files/` (cache permanente: os projetos apontam para esse caminho, como o plugin faz). Miniaturas pelo thumb público do Drive, em cache. Nenhuma chave entra no produto: só leitura pública. (`apps/server/src/cinepro.ts`)
- **Abas:** `CinePRO` (modo som: 9.466 SFX + 571 trilhas; árvore Sound Design / Sound Library / Essentials) e `Efeitos` (modo visual: 482 overlays, 230 transições, 43 flares, 109 frames, 332 GIFs, 3 lower thirds, 230 presets .mogrt só listados). O mesmo painel (`CineproPanel`, prop `modo`): árvore, busca (nome, pasta, tags), lista ou grade, prévia, "+" no cursor, arrasto para a trilha.
- **Looks na aba Cor (começo da fase 3):** `ColorGrade.lut = { id, nome, strength }` — a LUT .cube do CinePRO Looks (170, "Luts Thales": conversões e looks) entra **depois** da conversão de LOG e das primárias, com força 0–100 %. `parseCube`/`sampleCube` no núcleo; `buildLut(g, n, cube)` compõe; o preview (WebGL, `compositor.setCube`) e o export (`lut3d` do FFmpeg) usam a mesma LUT composta. O look viaja no padrão editorial (`cor.grade`).
- **Para o agente (próximo passo):** os papéis do auto-SFX (passagem no corte, impacto, riser, cama) e as receitas viram a fonte de SFX reais no lugar dos sintetizados — `sfx.biblioteca: 'cinepro'` no perfil e `cineproPick(conceito, duração)` usando os `concepts` do manifesto. O vocabulário do Cérebro já descreve os papéis.

## Fase 3 (cor) e o agente com SFX reais — 2026-10-16
- **Cor, no mesmo `gradePixel` (preview = export):** rodas lift/gamma/gain (RGB), HSL por faixa de matiz (8 faixas, pesos suaves entre vizinhas), curvas por 5 pontos (luma, R, G, B), e look do CinePRO; **textura** (nitidez, vinheta, grão) como filtro de quadro, com os mesmos valores no shader do compositor e no `unsharp`/`vignette`/`noise` do FFmpeg. A aba Cor ganhou as seções Rodas de cor, HSL por cor, Curvas (com prévia), Look e Textura. Fica para depois: editor gráfico de curvas (hoje são 5 pontos em sliders) e combinar cor entre câmeras.
- **SFX reais do CinePRO para o agente:** `SFX_CONCEPTS` liga cada foley sintetizado (whoosh, impacto, riser, carimbo, fita, papel, máquina de escrever…) a termos de busca, duração e palavras a evitar; o servidor escolhe uma amostra determinística pela semente da cue (`cineproPick`), baixa da nuvem e decodifica (`cineproSample`), e `shapeSfxSample` dá a ela a forma do efeito (corte na duração, fade, pico 0,95 × ganho). O export (`renderSfxTrack`) e o preview (`motionSfx.ts`, pré-carregando as amostras) usam a mesma escolha; sem rede ou sem acerto, cai na síntese. `timeline.sfxBank` ('cinepro' | 'sintetizado') é escolhido pelo agente a partir do perfil (`sfx.biblioteca`, padrão 'cinepro') na finalização e pode ser trocado em Ajustes → Projeto → Voz.

## Ações
1. [x] Fase 1 (formato).
2. [x] Fase 2 (legenda igual + posição livre no player).
2b. [x] CinePRO (som) e Efeitos (visual) pela nuvem; looks na Cor; [x] agente escolhendo SFX reais do catálogo.
3. [x] Fase 3 (cor): looks, rodas, HSL, curvas, nitidez, vinheta, grão. [ ] editor gráfico de curvas; [ ] combinar cor entre câmeras.
4. [ ] Fase 4 (camadas).
5. [ ] Fase 5 (transições).
6. [ ] Fase 6 (efeitos).
7. [x] Vocabulário no Cérebro (`_SISTEMA/VOCABULARIO - Ferramentas e quando usar.md`).
