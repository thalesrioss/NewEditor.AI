# ADR-004: Gestor de Projetos, fila global e persistência

**Status:** Aceito (2026-10-09)
**Data:** 2026-10-09
**Decisores:** Thales Rios

## Contexto

O canvas define o fluxo entre agentes:

> O Gestor de Projetos pega, entende o contexto do que está sendo pedido na descrição da tarefa, cria um
> briefing, baixa o vídeo e manda para o NewEditor.AI **um conteúdo por vez**. O NewEditor.AI faz um
> **cálculo de tempo** com base nas decisões que vai tomar; o Gestor deixa isso claro na tarefa.

Hoje: cada projeto tem sua própria fila, e várias decupagens rodariam em paralelo; não há Gestor, nem
link do Drive, nem estimativa. A persistência é JSON por projeto + estado em memória — bom para validar
localmente, mas a NewContent vai precisar de banco e storage.

## Decisão

1. **Gestor de Projetos é um agente determinístico + cérebro local** (ADR-003): lê a descrição da tarefa,
   extrai briefing estruturado (formato, duração-alvo, tom, o que não pode faltar), baixa o material e
   cria o projeto em **Fila de Produção**.
2. **Fila global, um conteúdo por vez** no NewEditor.AI. O Kanban é a visão dessa fila.
3. **Estimativa de tempo em duas fases:** antes de editar (por duração do bruto e tipo de peça) e depois da
   decupagem (por decisões reais: nº de cortes, B-rolls, motions, letterings). Os pesos saem dos projetos
   já feitos no Cérebro do Editor (`montagens/`), não de chute.
4. **Drive:** importação por link de compartilhamento no Gestor (download direto do arquivo do Drive, sem
   API paga).
5. **Persistência atrás de interfaces** (`ProjectRepository`, `JobQueue`, `MediaStorage`): implementação local
   hoje (JSON + fila em memória + disco), trocável por Postgres + fila + object storage no merge.

## Opções consideradas

### Opção A: Fila por projeto, tudo em paralelo (atual)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa |
| Custo | Zero |
| Escalabilidade | Satura CPU/memória com 3+ decupagens + ASR ao mesmo tempo no Mac |
| Aderência ao canvas | Baixa ("um conteúdo por vez") |

### Opção B: Fila global com Gestor como produtor (proposta)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | Zero |
| Escalabilidade | Previsível; na NewContent vira N workers da mesma fila |
| Aderência ao canvas | Total |

### Opção C: Já subir Postgres + Redis/BullMQ agora
| Dimensão | Avaliação |
|---|---|
| Complexidade | Alta para a fase de validação |
| Custo | Infra local extra |
| Escalabilidade | Pronta para produção |
| Aderência ao canvas | Total |

**Contras de C:** fricção para validar no Mac sem ganho de produto agora; a stack da NewContent ainda não
está definida para este módulo, então escolher banco agora é escolher no escuro.

## Análise de trade-offs

O canvas é explícito sobre "um por vez", e o Mac é o gargalo real (ASR + análise + render). B entrega o
fluxo do canvas sem infra nova; as interfaces de repositório/fila garantem que C seja uma troca de
implementação no merge, não uma reescrita.

## Consequências

- Mais fácil: Kanban reflete a fila de verdade; estimativa calibrada com histórico real; merge sem reescrita.
- Mais difícil: precisa de cancelamento/prioridade na fila; estimativa precisa de dados de tempo reais das
  edições passadas.
- Revisitar: quando entrar na NewContent, quantos workers e onde rodam o ASR (Mac do editor × servidor).

## Ações

1. [ ] Kanban arrastável (status) + card com briefing e estimativa
2. [ ] Fila global com posição, prioridade e cancelamento
3. [ ] Gestor: briefing estruturado a partir da descrição da tarefa + importação por link do Drive
4. [ ] Modelo de estimativa calibrado com `Cérebro do Editor/montagens`
5. [ ] Extrair `ProjectRepository`, `JobQueue`, `MediaStorage` do `store.ts`
