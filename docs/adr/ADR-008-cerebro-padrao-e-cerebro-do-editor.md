# ADR-008: Cérebro padrão × cérebro do editor — diferencial vira marca

**Status:** Aceito (decisão do Thales)
**Data:** 2026-10-10
**Decisor:** Thales Rios

## Contexto

Thales, ao ver a aba `#/cerebro` com os dois vaults ligados:

> Minha ideia não é que as pessoas tenham acesso ao mesmo conhecimento que eu. Quero que elas tenham acesso ao Motion Studio Brain **sem as referências**, e ao Cérebro do Editor **de forma padrão, sem as minhas referências** também. O cérebro vai ser individual, de acordo com o estilo do editor e com o que o cliente do editor gosta — assim a gente cria diferencial na edição. **Esse cérebro que estamos criando é o meu.** Quando as pessoas criarem as suas contas, elas vão ter um cérebro padrão, que entende de coisas padrões de edição; o Motion Studio vai ter todo conhecimento e tecnologia embarcados, mas sem as mesmas referências. Eu quero que exista diferencial, e com diferencial se cria MARCA. Hoje o maior problema de editar vídeo com IA é que todos ficam iguais.

Até aqui o produto tratava "o Cérebro" como uma coisa só: regras em código, perfis em `data/perfis`, QC lido do DNA, referências de motion importadas do Motion Studio Brain. Isso serve para a conta do Thales — e só para ela.

Em seguida, a precisão:

> O editor novo tem que receber o Cérebro do Editor **sem nenhum registro**, só conhecimento de edição de vídeo embarcado. E o Motion com o mesmo padrão de funcionamento, mas sem as referências — ele vai **cru**. A ideia é essa.

## Decisão

O conhecimento passa a ter **três camadas**, e o produto embarca só a primeira:

| Camada | O que é | Vai para outras contas? | Hoje, no vault |
|---|---|---|---|
| **Ofício** | O que todo editor precisa saber: processo, protocolo, os brains de ofício, princípios de animação, estilos de motion, receita técnica de motion, template de projeto, a tecnologia do Motion Studio (skills, blueprints, regras de animação) | **Sim** — é o cérebro padrão | `brains/`, `_SISTEMA/PROTOCOLO_GLOBAL.md`, `_SISTEMA/README.md`, `README.md`, o canvas do racional, `padroes de motions/`, `montagens/_TEMPLATE-PROJETO/`; no Motion: a pasta `Motion Studio/` (menos `films/`) |
| **Pessoal** | O gosto e a identidade do editor: o que ele aprovou nas peças dele, as referências que ele escolheu, o DNA promovido do trabalho dele, a memória dos jobs dele, os filmes dele | **Não** — é do Thales | `_SISTEMA/DNA_EDITORIAL.md`, `_SISTEMA/memoria/`, `padroes/PADRAO - Thales`, `Claude outputs/`, `montagens/thales-*`, `pope-in-the-pool`; no Motion: `Referências/`, `Mapa Estético`, `Registro de Decisões/`, `Assets Gerados/`, `Motion Studio/films/` |
| **Cliente** | O que cada cliente do editor aprova: padrão por cliente, projetos, B-roll e correções desses jobs | **Não** — é de cada editor com os clientes dele | `padroes/PADRAO - <cliente>`, `montagens/<cliente>/`, `_broll/` |

**O cérebro de cada conta nasce só com o ofício** e se individualiza pelo mesmo caminho que o do Thales se formou:

1. **Identidade do editor** — lida das peças que ele aprova como *suas* (como o PADRAO Thales foi compilado da SAND v1): corte, zoom, flash, lettering, trilha, cobertura. Vira o padrão da casa daquela conta.
2. **Clientes do editor** — cada cliente ganha um perfil compilado do que aprovou; o Gestor só assume perfis validados pelo editor.
3. **Memória e DNA** — correções e alterações do editor (comentários, trocas de tomada, QC recusado) alimentam a memória da conta; o que se repete sobe para o DNA *daquela* conta.
4. **Referências de motion** — o Motion Studio Brain da conta começa com a tecnologia e sem obras; as referências que o editor trouxer entram na inteligência dele, não na de todos.

## Consequências

- **Fica mais fácil:** separar o que é produto do que é dado do cliente; criar contas novas sem vazar gosto; explicar o diferencial ("o seu cérebro aprende com você e com os seus clientes").
- **Fica mais difícil:** o cérebro padrão, sozinho, edita "no genérico" — a promessa é que ele deixa de ser genérico rápido, pela peça validada do editor. Precisamos do fluxo "esta peça é a minha referência" bem curto.
- **Revisitar:** onde o DNA de uma conta mora (hoje é um arquivo no vault do Thales); como medir que dois editores com o mesmo cérebro padrão chegam a resultados diferentes (benchmark por conta).

## O que já mudou no produto (2026-10-10)

- Cada nó do grafo tem `camada: 'oficio' | 'pessoal' | 'cliente'` (regra em `apps/server/src/cerebro.ts`, `camadaOf`). Pastas ficam na camada da maioria dos arquivos; o perfil padrão da casa é pessoal, os outros são de cliente.
- A aba `#/cerebro` ganhou o controle **Tudo · Cérebro padrão · O meu**: "Cérebro padrão" mostra exatamente o que uma conta nova receberia; "O meu" mostra o que é só do Thales e dos clientes dele. A nota aberta mostra a camada ("ofício · embarca", "pessoal · só seu", "cliente").
- As 33 skills embarcadas do Motion Studio (`Motion Studio/.claude/skills/*`: hyperframes, remotion, captions, media…) aparecem como um nó por skill, kind `tecnologia`, camada ofício — é o "mesmo padrão de funcionamento" que vai cru. `REFERENCIAS.md` e o manual dos packs de treino são pessoais.
- "Sem nenhum registro": `_SISTEMA/memoria/`, `DNA_EDITORIAL.md`, `decisoes.jsonl`, `correcoes.jsonl`, `Registro de Decisões/`, `Assets Gerados/` e `films/` são pessoais — não entram no cérebro padrão.
- Nada muda no comportamento do agente para a conta do Thales: o padrão da casa continua sendo o perfil dele.

## Próximos passos

1. [ ] Um `HOUSE_PROFILE` de ofício de verdade (sem valores lidos da SAND v1) para ser o padrão da casa de contas novas — hoje `fillProfile` usa defaults genéricos, mas a importação dos padrões sobrescreve o da casa com o do Thales.
2. [ ] Fluxo "esta peça é a minha referência": o editor marca uma peça aprovada e o produto compila o perfil de identidade dele (o que `compileProfileMarkdown` faz a partir de um PADRAO, mas a partir da timeline aprovada).
3. [ ] Separar fisicamente as camadas quando houver contas: ofício no produto (`packages/core` + um vault de ofício versionado), pessoal e clientes por conta.
4. [ ] Motion Studio Brain embarcado sem `Referências/`, `Registro de Decisões/`, `Assets Gerados/` e `films/`.
