# ADR-010: "Personalizado" e a edição que vira o padrão editorial do cliente

**Status:** Aceito
**Data:** 2026-10-12
**Decide:** Thales

## Contexto

O padrão de edição de um projeto vinha só de duas fontes: o padrão da casa (o estilo do Thales) e os perfis compilados dos `PADRAO - *.md` do vault. O Thales pediu dois caminhos a mais, dentro do Editor Brain: um padrão **Personalizado**, e a opção de **a edição criada se tornar a edição editorial de um dos formatos do cliente**.

## Decisão

1. **Medir a edição é uma função do núcleo.** `profileFromTimeline(timeline, base, info)` em `packages/core/src/profile.ts` lê a timeline e devolve um `ClientProfile` com tudo marcado MEDIDO: formato, duração da peça (±15 %), mediana do clipe, zoom (mín/máx/por minuto), lettering (por minuto, estilo, altura, alinhamento, linhas), fonte dos motions (Studio ou cartões), flash, **a legenda inteira** (`legenda.ajustes`, a `CaptionSettings` como ficou), trilha (dB, fades, ducking), cor (`input` + a correção inteira em `cor.grade`) e B-roll (repetição, cobertura mínima).

2. **Personalizado** (`profileId = 'personalizado'`): o perfil do projeto é a própria edição, lida **ao vivo** a cada passada do agente (`profileOf` em `apps/server/src/profiles.ts`). Mudou o zoom ou a legenda na timeline, mudou a regra.

3. **Um padrão editorial por cliente e por formato.** `ClientProfile` ganhou `cliente`, `formatoPeca` (reels, shorts, tiktok, youtube, stories, outro) e `origem` (de qual edição foi lido). O id é `slug(cliente-formato)`; gravar de novo substitui as medições e mantém o que foi marcado à mão em Perfis. O Gestor, ao criar um projeto a partir da tarefa, prefere o padrão do formato pedido.

4. **No Editor Brain:** o seletor "Padrão de edição" da barra superior lista o padrão da casa, os perfis (com o formato) e **Personalizado (esta edição)**. Em Ajustes → Projeto → "Padrão de edição", o botão **Tornar esta edição o padrão editorial…** abre o diálogo com cliente (sugere os existentes), formato, nome, a prévia do que foi medido e "usar neste projeto também". Rotas: `GET/POST /api/projects/:id/perfil-da-edicao`.

5. **O agente usa de verdade:** a finalização aplica `legenda.ajustes` ao ligar a legenda; zoom, ritmo, flash, trilha, B-roll e QC já liam o perfil.

## Consequências

- Mais fácil: o Thales edita uma peça do jeito do cliente uma vez e o resto das peças daquele formato nasce igual, sem escrever `PADRAO - *.md`.
- Mais difícil: dois caminhos para o mesmo perfil (vault e edição). Regra: o vault continua sendo a fonte do padrão da casa; o padrão editorial lido de uma edição é do cliente.
- Revisitar: estilo de lettering e referência de motion aplicados automaticamente a partir do padrão (hoje só legenda, altura e quantidade); cor aplicada ao novo bruto quando é a mesma câmera.
