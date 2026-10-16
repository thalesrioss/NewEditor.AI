# ADR-002: Motor de preview e render (o que se vê = o que se entrega)

**Status:** Aceito (2026-10-09)
**Data:** 2026-10-09
**Decisores:** Thales Rios

## Contexto

Hoje existem dois motores que precisam concordar:

- **Preview** (navegador): dois `<video>` em revezamento; a troca no corte é detectada por
  `requestAnimationFrame` — atraso de 16–40 ms, audível em ritmo vertical (corte a cada ~1,5 s).
- **Render** (servidor): filtergraph do FFmpeg a partir dos originais. Exato (0,5 ms de diferença medida).

Com só corte + zoom, os dois concordam. Com lettering, motion e B-roll composto, não vão concordar —
e a regra nº 1 do DNA editorial é **"conferir o frame resultante, nunca o plano"**.

O Thales já tem um sistema de motion que funciona (skill `motion-designer`): motion como **HTML
determinístico com `window.seek(t)`**, renderizado em H.264 ou ProRes 4444 com alfa. Ou seja: a peça de
motion já é uma página que sabe se posicionar em qualquer instante.

## Decisão

**Um modelo de composição, dois executores, mesma fonte de verdade:**

1. **A-roll (cortes, zoom, áudio):** FFmpeg no export (rápido e exato, como hoje). No preview, o **áudio
   passa a ser agendado no Web Audio** com precisão de amostra (`AudioBufferSourceNode.start(when, offset,
   duration)`) e o vídeo **segue o relógio do áudio**. Fim do "corte sujo".
2. **Overlays gráficos (lettering, motion, cartelas):** cada um é uma **composição HTML com `seek(t)`**.
   - Preview: a composição roda num `<iframe>`/camada sobre o player, recebendo `seek(t)` do mesmo relógio.
   - Export: a **mesma** composição é capturada quadro a quadro por Chromium headless → ProRes 4444 com
     alfa → `overlay` no FFmpeg. O que o editor viu é, byte a byte, o que vai para o render.
3. **B-roll de vídeo:** camada `<video>` no preview; `overlay` no FFmpeg no export.
4. **Conferência pós-render** (automática, local): duração = timeline, −14 LUFS / −1 dBTP, detecção de
   estalo em cada emenda, folha de frames ±1,5 s por corte.

## Opções consideradas

### Opção A: Dois motores independentes (atual)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa hoje, cresce com cada efeito |
| Custo | Zero |
| Fidelidade | Quebra no primeiro overlay gráfico |
| Familiaridade | Alta |

**Prós:** já existe. **Contras:** cada efeito implementado duas vezes (CSS e filtro FFmpeg); divergência certa.

### Opção B: Remotion (composição React, Player + render)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | **Licença paga** para empresa com mais de 3 pessoas |
| Fidelidade | Ótima (mesma composição nos dois lados) |
| Familiaridade | Média |

**Prós:** maduro, preview e render idênticos. **Contras:** licença; renderizar o A-roll inteiro quadro a
quadro em navegador é muito mais lento que FFmpeg (talk head de 20 min em 4K); prende ao ecossistema.

### Opção C: Compositor WebCodecs/WebGL próprio no navegador
| Dimensão | Avaliação |
|---|---|
| Complexidade | Alta |
| Custo | Zero |
| Fidelidade | Ótima se o export também usar o mesmo compositor |
| Familiaridade | Baixa |

**Prós:** controle total, preview rapidíssimo. **Contras:** meses de engenharia de mídia antes de editar
qualquer vídeo; reimplementa o que FFmpeg já faz.

### Opção D: Híbrido FFmpeg + HTML com `seek(t)` (proposta)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | Zero (FFmpeg + Chromium headless) |
| Fidelidade | Exata nos overlays (mesmo HTML), exata no A-roll (mesmo corte) |
| Familiaridade | Alta: é o formato que o `motion-designer` do Thales já usa |

**Prós:** reaproveita os motions já validados; A-roll segue no caminho rápido; sem licença.
**Contras:** captura headless é lenta para motions longos (aceitável: motion dura 3–14 s); dois relógios
(Web Audio e `seek`) precisam ser o mesmo.

## Análise de trade-offs

O vídeo de conteúdo falado é **90% A-roll cortado e 10% overlay**. Passar o A-roll quadro a quadro por um
navegador (B, C) troca segundos por minutos de render sem ganho de fidelidade, porque corte e zoom já
são exatos no FFmpeg. Onde a fidelidade quebra é nos gráficos, e para isso o formato HTML com `seek(t)`
resolve com um único artefato, que **já é o padrão do sistema de motion do Thales**. D concentra a
complexidade onde ela paga.

## Consequências

- Mais fácil: plugar os motions existentes do Cérebro do Editor; preview sem "corte sujo"; QC automático.
- Mais difícil: precisa de um relógio único no front (`EditorClock`) que dirige Web Audio, `<video>` e
  `seek(t)` das composições.
- Revisitar: se o preview com muitos overlays ficar pesado, cachear motions já renderizados como vídeo
  com alfa também no preview.

## Ações

1. [x] Áudio do A-roll no Web Audio: o clipe que sai vai a zero no ponto de saída, no relógio de áudio (resolve o corte sujo)
2. [~] Camada de overlays no player: B-roll, lettering, SFX e trilha ✅ · composição HTML com `seek(t)` pendente
3. [ ] Captura headless (Playwright/Chromium) → ProRes 4444 → `overlay` no render
4. [x] Normalização −14 LUFS / −1 dBTP no export
5. [ ] Conferência pós-render: duração, estalo por emenda, folha de frames por corte
