# ADR-001: Timeline multitrilha

**Status:** Aceito (2026-10-09)
**Data:** 2026-10-09
**Decisores:** Thales Rios

## Contexto

A timeline hoje é `{ main: Clip[], removals: Removal[] }`: uma trilha magnética com os cortes do A-roll.
Serviu para a decupagem, mas o canvas pede o que vem depois — quebra de padrão com B-roll e motion
("nunca o mesmo B-roll ou motion mais de 2×") — e não há onde colocar nada disso.

A forma como o Thales monta no DaVinci já está medida no Cérebro do Editor (memória 06):
`V1 fala · V2 B-ROLL · V3 LETTERING · V4 flash · A1 diálogo · A2 SFX · A3/A4 trilha · A5–A7 SFX`.
Ele finaliza peças no Resolve, então ida e volta com o DaVinci tem valor real.

Forças em jogo:
- O agente e o humano editam o mesmo documento, ao vivo, por operações (princípio que funciona e fica).
- A trilha principal precisa continuar **magnética**: cortar fala não pode deixar buraco.
- Overlays (B-roll, lettering, motion, SFX) precisam ficar **presos ao momento da fala**, não a um tempo
  absoluto — se um corte antes deles acontece, eles andam junto.
- Precisa exportar para o DaVinci (FCPXML) sem perder estrutura.

## Decisão

Adotar **trilha principal magnética + trilhas de overlay ancoradas**:

```ts
interface Timeline {
  fps; width; height;
  main: Clip[];                 // V1+A1: magnética, como hoje
  tracks: Track[];              // V2 B-roll, V3 lettering/motion, V4 efeitos, A2.. SFX/trilha
  removals: Removal[];
}
interface Track { id; kind: 'video' | 'overlay' | 'audio'; name; muted?; locked? }
interface OverlayItem {
  id; trackId;
  anchor: { assetId: string; at: number };       // preso a um INSTANTE DA FALA no bruto (sobrevive a corte, divisão e nova decupagem)
  duration: number;
  source: { assetId; in } | { compositionId } | { text; style };   // vídeo, motion HTML, lettering
  role?: 'broll' | 'lettering' | 'motion' | 'sfx' | 'music' | 'flash';
  reason: string; by: Actor;
}
```

Operações novas: `add_overlay`, `move_overlay`, `trim_overlay`, `remove_overlay`, `set_track`.
Validadores de **regra editorial** rodam sobre esse modelo (ex.: mesmo asset de B-roll ou mesmo motion
usado > 2× → aviso/bloqueio), e o export gera **FCPXML** com as trilhas na ordem do Thales.

## Opções consideradas

### Opção A: Manter uma trilha + listas laterais (`broll[]`, `letterings[]`)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa agora, alta depois |
| Custo | Zero |
| Escalabilidade | Ruim: cada tipo novo = estrutura nova + UI nova + export novo |
| Familiaridade | Alta (é o que existe) |

**Prós:** nenhuma migração. **Contras:** vira colcha de retalhos; não mapeia para FCPXML/OTIO; a UI estilo
CapCut (trilhas empilhadas) não sai disso.

### Opção B: Multitrilha com overlays ancorados na fala (proposta)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | Zero |
| Escalabilidade | Boa: tipo novo = novo `source`/`role`, mesma mecânica |
| Familiaridade | Alta: é o modelo de CapCut/Premiere/Resolve |

**Prós:** overlays seguem a fala quando há corte; mapeia 1:1 para FCPXML; regra "≤ 2×" vira uma consulta.
**Contras:** ancoragem exige resolver posição (clipe + offset → tempo) em todo lugar; migração do formato.

### Opção C: Adotar OpenTimelineIO (OTIO) como formato interno
| Dimensão | Avaliação |
|---|---|
| Complexidade | Alta |
| Custo | Zero (open source), mas a lib madura é Python/C++ |
| Escalabilidade | Excelente para interchange |
| Familiaridade | Baixa |

**Prós:** padrão da indústria. **Contras:** não tem trilha magnética nem ancoragem na fala; o servidor e o
front são TypeScript; força o modelo de edição a se adaptar ao formato de troca.

## Análise de trade-offs

A diferença que decide é **ancoragem**. Em edição de conteúdo falado, quase toda intervenção depois da
decupagem é *sobre uma fala* ("B-roll em cima de 'minha cabeça fica no lugar'"). Com tempo absoluto
(A ou C), cada ajuste de corte desalinharia tudo o que vem depois — e é exatamente o momento em que o
humano pede alteração. B paga uma complexidade média uma vez e elimina essa classe inteira de erro.
OTIO fica como **formato de saída** (junto com FCPXML), não como modelo interno.

> **Ajuste na implementação (2026-10-09):** a âncora ficou no *instante da fala no bruto* (`assetId` + `at`),
> não no `clipId`. Ids de clipe mudam quando se divide um clipe ou se refaz a decupagem; o instante da fala não.
> Overlay cujo instante foi cortado vira **órfão**: some da timeline, aparece nos alertas e volta se o trecho
> for restaurado.

## Consequências

- Mais fácil: B-roll, lettering, motion, SFX e trilha usam a mesma mecânica; regra "≤ 2×" é verificável;
  export para DaVinci com trilhas nomeadas.
- Mais difícil: toda leitura de posição de overlay passa por `resolveAnchor()`; testes precisam cobrir
  "corte antes do overlay", "corte dentro do âncora", "restauração".
- Revisitar: overlay cujo âncora foi cortado — some junto (padrão) ou vira órfão para revisão?

## Ações

1. [x] Estender `packages/core` com `Track`, `OverlayItem`, `resolveOverlay()` e as operações, com testes
2. [x] Migrar projetos existentes (`normalizeTimeline`) — sem quebrar o formato atual
3. [x] Timeline do Editor Brain com trilhas empilhadas (V3/V2/V1/A1/A2/A3)
4. [~] Validador editorial: repetição > 2× e B-roll < 3,3 s ✅ · cobertura 20–40% pendente
5. [ ] Export FCPXML (e depois OTIO) com a arquitetura de trilhas do Thales
