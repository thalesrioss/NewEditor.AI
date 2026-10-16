# ADR-003: Cérebro local-first (sem API paga)

**Status:** Aceito (2026-10-09)
**Data:** 2026-10-09
**Decisores:** Thales Rios

## Contexto

Decisão do Thales: **não usar API paga durante o desenvolvimento, e de preferência nunca.**

Hoje o "cérebro" tem duas implementações com a mesma interface (`decide()` → partição MANTER/CORTAR):
- **local** (padrão): regras em código — reinício, pré/pós-roll, bastidor, hesitação, fragmento abandonado.
  Resultado no benchmark do Davi: **95,6% das palavras iguais ao corte aprovado**, bordas com erro
  mediano de 36 ms. Custo zero, instantâneo.
- **claude** (desligado): API da Anthropic.

O que as regras **não** fazem:
1. Escolher **a melhor tomada** por fluidez/energia (hoje: sempre a última).
2. Entender **roteiro/briefing** ("Mas o meu objetivo" saiu no corte aprovado por escolha editorial).
3. Ver **repetição que o ASR fundiu** ("ningu… ninguém" vira uma palavra só no Whisper).
4. Entender pedido em texto livre (o interpretador local cobre ~8 padrões de frase).

Hardware: MacBook Pro **M5 Pro, 24 GB** — já roda o Whisper large-v3-turbo local (187 s em ~12 s).

## Decisão

**Cérebro em camadas, todas locais, atrás da mesma interface; API só como opção explícita:**

| Camada | O que resolve | Como | Custo |
|---|---|---|---|
| 1. **Medido** | Pausas, bordas, sílabas, repetição fundida | Forma de onda + transcrição (código) | 0 |
| 2. **Regras** | Reinício, bastidor, pré-roll, hesitação | Código (`local.ts`, já existe) | 0 |
| 3. **LLM local** | Melhor tomada, roteiro, pedidos em texto livre | Modelo aberto rodando no Mac via MLX (mesmo runtime do Whisper) | 0 |
| 4. Claude (opcional) | Casos que a camada 3 não resolver | `NEWEDITOR_BRAIN=claude` | pago, só se ligado |

Para a repetição fundida (item 3 acima), a camada 1 ganha um **detector de sílabas**: conta os núcleos
silábicos na energia de cada palavra e compara com as sílabas esperadas do texto. "ninguém" tem 2 sílabas;
se a energia mostra 4 núcleos no espaço dessa palavra, há repetição escondida → re-transcreve só aquela
janela em modo "ao pé da letra" e corta a primeira tentativa.

## Opções consideradas

### Opção A: Só regras (atual)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa |
| Custo | Zero |
| Qualidade | 95,6% no Davi; teto baixo para escolha de tomada e roteiro |
| Privacidade | Total |

**Prós:** previsível, rápido, testável. **Contras:** não evolui para julgamento editorial.

### Opção B: Claude via API
| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa (já implementado) |
| Custo | Por uso; contraria a decisão do Thales |
| Qualidade | A mais alta disponível |
| Privacidade | Material do cliente sai da máquina |

**Prós:** melhor julgamento. **Contras:** custo, dependência externa, contraria R10.

### Opção C: Camadas locais com LLM local (proposta)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | Zero por uso; download único do modelo (alguns GB) |
| Qualidade | Acima das regras para escolha de tomada e pedidos livres; abaixo do Claude |
| Privacidade | Total |

**Prós:** cumpre "nunca usar API"; o LLM só decide o que é ambíguo — o medido e as regras continuam
fazendo o grosso, então o modelo pequeno não precisa ser brilhante. **Contras:** precisa validar se um modelo
de 7–14B em 4 bits (~5–9 GB de memória) escolhe tomada bem em português; mais lento que regra.

## Análise de trade-offs

O erro mais caro numa decupagem não é o difícil — é o **óbvio que passou** (gagueira, bastidor, tomada
repetida). Esses as camadas 1 e 2 resolvem com 0 custo e 100% de previsibilidade. O LLM local entra só nas
decisões ambíguas, que são poucas por vídeo — então mesmo um modelo menor e mais lento cabe no orçamento de
tempo. O Claude fica como teto de qualidade **opcional**, e o benchmark contra cortes aprovados decide, com
número, se ele algum dia vale o custo.

## Consequências

- Mais fácil: rodar tudo offline; dados do cliente nunca saem do Mac; custo previsível (zero).
- Mais difícil: precisamos de **mais gabaritos** (cortes aprovados) para medir cada camada — um vídeo só não
  sustenta decisão.
- Revisitar: se o LLM local não superar as regras no benchmark, a camada 3 sai e o pedido livre fica com
  gramática local.

## Ações

1. [ ] Detector de sílabas (camada 1) + re-ASR em janela no modo "ao pé da letra"
2. [ ] Montar banco de benchmark: 5+ brutos reais de clientes com o corte aprovado de cada um
3. [ ] Spike de LLM local via MLX: medir escolha de tomada e pedidos livres contra o benchmark
4. [ ] Só ligar a camada 3 se ganhar das regras no benchmark
