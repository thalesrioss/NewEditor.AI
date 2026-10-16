# ADR-013: Ponderação sobre o que fizemos (avaliação da arquitetura em 16/10/2026)

**Status:** Avaliação (para o Thales decidir o que vira ação)
**Data:** 2026-10-16
**Decide:** Thales

## O que existe, em números

| Parte | Linhas | O que é |
|---|---|---|
| `packages/core` | 4.305 | o modelo: timeline por operações (49 ops), legenda, lettering, motion de cartão, cor (LUT), SFX, perfis. Puro, sem I/O. 37 testes. |
| `apps/server` | 9.672 | 46 módulos, 94 rotas HTTP + WebSocket. Ingest, ASR, decupagem, agente local, finalização, render (FFmpeg + Chrome), QC, Cérebro, CinePRO, Motion Studio. Zero testes. |
| `apps/web` | 12.288 | o Editor Brain: casca CapCut (trilho, player, inspetor, timeline), painéis, Kanban, Cérebro 3D, motor de preview WebCodecs/WebGL. Zero testes. |
| `apps/desktop` | 172 | o app (Electron): servidor embutido, menu, diário. |
| `services` | 235 | ASR (Whisper), LLM local (Qwen), denoise, spell, faces. |
| Decisões | 12 ADRs | mais o Cérebro no vault e a memória de trabalho. |

Dependências de runtime: 8 pacotes no servidor, 5 na web. O resto é **ferramenta externa**: FFmpeg (30 chamadas), ffprobe, Chrome (texto/motion no export), `uv`/Python (Whisper, Qwen), Swift (rostos). Dados: 2,7 GB de projetos (hoje 1 projeto), 48 MB de referências, 15 MB de cache do CinePRO.

**Nada está em um commit.** O repositório existe (`git init`), mas os 26 mil linhas estão só no disco.

## O que está certo (e vale proteger)

1. **O modelo é o acerto estrutural.** Tudo é uma timeline JSON editada por operações, com âncoras presas à fala. Agente e humano mexem no mesmo objeto, o histórico é de graça, o "antes/depois" do agente é de graça, o padrão editorial lido de uma edição (ADR-010) é de graça. É a decisão que pagou todas as outras.
2. **Preview = export, por construção.** Texto, lettering, motion, legenda animada, cor (LUT) e agora textura e SFX reais saem da mesma função nos dois lados. Cada vez que uma função nova respeitou isso (fases 1–3 da ADR-011), ela entrou sem bug de "no export ficou diferente".
3. **Conhecimento como dado.** Perfis, vocabulário, formato por cliente, regras de QC: o agente lê dado, não prosa. O Cérebro (vault) continua sendo a fonte, e o produto compila o que precisa. É o que permite a ADR-012 (agente local lendo o Cérebro) sem reescrever nada.
4. **Local-first de verdade.** Sem API paga, sem servidor externo. O app roda no Mac com o servidor dentro. O CinePRO entrou pela nuvem, mas com cache permanente e reserva (síntese de SFX) quando não há rede.
5. **Decisões escritas.** Doze ADRs e a memória do projeto fizeram cada sessão retomar sem perder o fio, mesmo com o contexto apagado. Isso não é documentação: é o que torna o produto governável.

## O que está torto (e por quê)

| # | Problema | Evidência | Risco |
|---|---|---|---|
| 1 | **Nenhum commit** | `git log` vazio; 15 pastas não rastreadas | um `rm` errado, um disco cheio, um `ditto` mal feito, e 2 meses somem. É o maior risco do projeto hoje, e o mais barato de resolver. |
| 2 | **Testes só no núcleo** | 37 testes em `core`; 0 no servidor, 0 na web | o servidor tem o render, o ingest e a finalização — o que mais quebra (o proxy de áudio numa imagem desta semana passou direto). Sem teste, cada mudança é verificada à mão, no app, por mim. |
| 3 | **`index.ts` do servidor virou um balcão** | 614 linhas, 94 rotas num arquivo | rotas de CinePRO, perfis, Cérebro, projetos e render no mesmo lugar; fica difícil ler e cada rota nova empurra as outras. |
| 4 | **O servidor roda no processo principal do Electron** | ADR-009, `main.ts` | um render ou uma decupagem longa compete com a janela e os menus. O CapCut separa (`VEHelper`); nós ainda não. |
| 5 | **Dados do app linkados ao repositório** | symlink de `~/Library/Application Support/Editor Brain/data` → `data/` | prático para você, mas o `data/` mistura projetos (2,7 GB), cache do CinePRO, manifesto e perfis num lugar que também é o repositório. Vai confundir o primeiro backup e o primeiro Windows. |
| 6 | **Ferramentas externas não empacotadas** | FFmpeg, Chrome, `uv`, Swift vêm do sistema | o app só funciona num Mac montado como o seu. "Literalmente um app" ainda não é verdade para outra máquina. |
| 7 | **O agente de verdade ainda é regra + eu** | ADR-012 | a LLM local está ligada mas quase não é usada; motion de cena depende de mim. O produto é autossuficiente para editar, não para criar. |
| 8 | **Áreas grandes sem dono claro** | `motion/refs.ts` 745 linhas, `CerebroPage.tsx` 700, `Properties.tsx` 692, `MotionPanel.tsx` 620 | não é bug, é peso: são os lugares onde a próxima mudança vai custar mais do que devia. |
| 9 | **Chaves em notas** | a nota do Cloudflare no Obsidian tem token e chaves em texto puro | não entraram no produto (só leitura pública), mas estão num vault que o grafo lê. Rotacionar e tirar da nota. |

## O que mudou de rumo nestas duas semanas (e se foi bom)

- **Do editor remendado para o editor do zero no layout do CapCut.** Foi bom: a casca nova absorveu formato, legenda completa, posição livre, cor, CinePRO e Efeitos sem precisar de outra reescrita.
- **Do site para o app.** Foi bom e foi cedo o bastante: os dois erros de empacotamento (núcleo e SDK) só apareceram fora do repositório. Faltam as ferramentas (item 6).
- **Do pack local para a nuvem do CinePRO.** Foi bom: o mesmo sistema do plugin, zero duplicação de catálogo, e a divisão som/visual/looks deixou cada coisa no lugar.
- **Do CapCut como inspiração para o CapCut como dado.** Foi a decisão mais importante da semana: cada função entra em três lugares (núcleo, editor, conhecimento), senão não entra. É o que impede o Editor Brain de virar um CapCut pior.

## Opções para os próximos 30 dias

### A. Consolidar antes de crescer
Commit inicial e commits por rodada; testes do servidor onde dói (ingest por tipo de arquivo, render de uma timeline pequena, finalização em modo seco); quebrar `index.ts` em rotas por área; servidor num processo auxiliar do Electron; empacotar FFmpeg; tirar as chaves da nota.

| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa a média |
| Custo | ~1 semana |
| Ganho | o produto para de depender da minha verificação manual e de um disco só |

### B. Crescer o agente (ADR-012)
Modo offline declarado; Cérebro como RAG local; laço de agente local com as ferramentas da timeline e o QC como juiz; composição local de cenas.

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média a alta |
| Custo | 2–4 semanas, com pesquisa (tamanho do modelo) |
| Ganho | o "com ou sem internet, com ou sem a gente" |

### C. Continuar o CapCut (fases 4–6 da ADR-011)
Camadas infinitas, transições, efeitos.

| Dimensão | Avaliação |
|---|---|
| Complexidade | Alta (mexe no compositor dos dois lados) |
| Custo | 3+ semanas |
| Ganho | paridade de funções; não muda o diferencial |

## Recomendação

**A primeiro, curta e sem negociação; depois B; C quando B estiver andando.** O motivo: A custa uma semana e remove o risco de perder tudo e o custo de eu ser o único teste; B é o que você pediu desde o começo ("o cérebro é meu, o agente tem que saber fazer com ou sem a gente"); C é onde o CapCut já ganha e onde nós não precisamos ganhar primeiro.

Dentro de A, a ordem: (1) commit hoje; (2) chaves fora da nota; (3) testes do servidor nos três pontos que já quebraram (ingest, render, finalização); (4) rotas por área; (5) servidor em processo auxiliar; (6) FFmpeg empacotado.

## Consequências

- Mais fácil, se A: cada rodada vira um commit com diff legível; o app sobrevive a uma máquina nova; eu deixo de ser o único teste.
- Mais difícil: uma semana sem função nova visível.
- Revisitar: quando houver dois projetos reais passando pelo pipeline inteiro (hoje há um), medir o tempo de cada etapa e a taxa de "virou regra" dos feedbacks — é o número que diz se o produto aprende.
