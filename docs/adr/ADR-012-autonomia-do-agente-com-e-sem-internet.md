# ADR-012: O agente do Editor Brain com e sem internet (e com e sem o Claude)

**Status:** Proposto
**Data:** 2026-10-16
**Decide:** Thales

## Contexto

Pergunta do Thales: "quando acabam os tokens do Claude, e quando estou sem internet, o agente fica limitado; o objetivo do Second Brain é ele entender tudo que precisa fazer, com ou sem internet. Não foi por isso que instalamos a nossa LLM?"

A pergunta mistura duas coisas que hoje são separadas, e isso precisa ficar explícito.

## O que acontece de verdade

Existem **dois agentes**:

1. **O agente do produto (NewEditor.AI dentro do app).** Roda no servidor do Editor Brain, no Mac, sem nenhuma chave de API (`NEWEDITOR_BRAIN=local`). Ele é feito de **regras em código** (decupagem, cor, legenda, lettering, zoom, flash, B-roll, QC, perfis) e, quando ligado, da **LLM local** (Qwen3-8B em MLX) só em quatro pontos: entender o pedido em texto que as regras não entendem, montar o briefing da tarefa, escolher as frases de imagem para o Cinéfilo e (desligado) julgar tomadas. Não depende do Claude em nada. **Sem internet ele faz tudo, menos:** o Cinéfilo (clip.cafe é um serviço web), a biblioteca do CinePRO na primeira vez que um arquivo é usado (depois fica em cache), links do Drive, e o download inicial dos modelos (Whisper, Qwen).

2. **Eu (Claude Code), nesta conversa.** Sou quem **constrói o produto** e quem faz hoje o trabalho criativo pesado: as **cenas do Motion Studio** (ler a história, escrever `film.js`, QC com nota 8+, render), as regras novas, as notas no Cérebro. Quando acabam os tokens, ou sem internet, **isso para**. O produto continua aberto e funcionando, mas o passo "motions de cena" só importa o que já foi renderizado; se não houver render, ele escreve as ordens e espera.

Então a sensação de "o agente fica limitado" vem de três lugares reais:
- Motion de cena depende de mim, não do produto (regra A-08: em motion manda o Motion Studio; quem executa o Studio sou eu).
- A LLM local está ligada, mas é usada em pouca coisa e é um modelo de 8 bilhões de parâmetros: serve para entender pedidos e classificar, não para escrever uma cena de motion com código.
- O Cérebro (vault) é lido pelo produto só em partes: os perfis compilados dos `PADRAO - *.md`, as referências de motion e a nota de vocabulário. O resto (DNA editorial, decisões, aprendizados das peças) é lido por mim, não pelo app.

## Decisão (proposta): três camadas, cada uma inteira no que faz

| Camada | Quem | Com internet | Sem internet | Sem Claude |
|---|---|---|---|---|
| **Ofício em código** (decupar, cortar, cor, legenda, lettering, zoom, flash, SFX, QC, perfis, formato) | o produto | ✓ | ✓ | ✓ |
| **Juízo local** (entender pedido, briefing, escolher frase de imagem, escolher SFX/cena por conceito, revisar o próprio QC, ler o Cérebro) | LLM local + Cérebro como RAG | ✓ | ✓ | ✓ |
| **Criação** (cena de motion original, decisões de linguagem novas) | Claude (eu), via Motion Studio | ✓ | ✗ | ✗ |

O que falta para a camada 2 existir de verdade — e é o que faz "o agente saber tudo com ou sem a gente":

1. **O Cérebro como memória de trabalho do agente local.** Indexar o vault (DNA editorial, protocolo, vocabulário, decisões, padrões) em trechos com embeddings locais e deixar a LLM local consultar antes de cada etapa ("o que o Cérebro diz sobre lettering em talk head?"). Hoje o grafo do `#/cerebro` é visualização; vira consulta. Tudo local (MLX ou `sentence-transformers` em CPU).
2. **Um laço de agente local no app**: a LLM local recebe o estado do projeto (transcrição, timeline, perfil, QC) e as mesmas ferramentas que o humano tem (as operações da timeline, o Cinéfilo, o CinePRO, o QC) e trabalha em passos pequenos, com o QC como juiz. Isso é o "chat do agente" crescendo de interpretador de comandos para executor com tools.
3. **Motion sem mim, no que dá**: o Motion Studio tem um vocabulário de helpers (mesa, objetos pousando, fita, giz, marcador, mão). Uma LLM local maior (Qwen3-32B/72B, se a máquina tiver memória; hoje 8B) pode **compor cenas a partir desse vocabulário** seguindo o contrato (`window.seek(t)`, frames até o corte), com o QC de contact sheet medindo. Não substitui a cena original que eu escrevo, mas cobre o "motion que corrobora a fala" quando eu não estou. A cena fica marcada como "composta localmente" e entra no mesmo registro de aprovação do Studio.
4. **Modo offline declarado**: o app sabe quando está sem rede e diz o que vai fazer diferente (B-roll do cache do CinePRO e da biblioteca local em vez do clip.cafe; SFX sintetizados se a amostra não está em cache; motion por cartões ou composição local). Nada falha em silêncio.
5. **Cache deliberado**: pré-baixar os SFX dos conceitos usados pelos motions e as LUTs dos perfis, para o offline não ser pego de surpresa.

O que **não** muda: nenhuma API paga no produto (memória `no-api-key`); o Claude continua sendo o estúdio criativo e o construtor, e o diferencial de marca (ADR-008) continua no estilo do Thales, não num modelo genérico.

## Ordem sugerida

1. Modo offline declarado + cache deliberado (pequeno, imediato).
2. Cérebro como RAG local para o agente (base de tudo).
3. Laço de agente local com ferramentas (o "chat" vira executor).
4. Composição local de cenas de motion a partir do vocabulário do Studio (depende de um modelo maior; medir primeiro se o 8B já compõe cenas simples).

## Consequências

- Mais fácil: o editor humano nunca fica parado por falta de rede ou de Claude; o produto vira autossuficiente de fato (ADR-001/-007).
- Mais difícil: qualidade do juízo local é menor que a minha; o QC passa a ser a trava de qualidade, não eu. O Thales continua aprovando.
- Revisitar: tamanho do modelo local × memória do Mac; quando o Windows chegar, a LLM local precisa de outro runtime (llama.cpp em vez de MLX).
