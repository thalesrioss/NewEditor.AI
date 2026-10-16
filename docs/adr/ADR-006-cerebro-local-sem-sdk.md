# ADR-006: O cérebro local não carrega o SDK da Anthropic

**Status:** Aceito (2026-10-10)
**Decisores:** Thales Rios

## Contexto

O produto roda com o cérebro local por padrão (`NEWEDITOR_BRAIN` ausente), sem API paga. Mesmo assim, `@anthropic-ai/sdk` era dependência obrigatória e importado estaticamente em `llm.ts`, `index.ts`, `agent.ts` e `decupagem/decide.ts`. Com isso, o SDK entrava no processo mesmo no modo local, e quem lia o código entendia o Claude como o cérebro "natural" do produto.

## Decisão

- Tudo que usa o SDK foi para `apps/server/src/claude/`:
  - `client.ts`: cliente e parâmetros;
  - `commands.ts`: agente de comandos com ferramentas;
  - `decide.ts`: decupagem estruturada.
- `agent.ts` e `decupagem/decide.ts` só carregam esses módulos por `import()` dinâmico quando `NEWEDITOR_BRAIN=claude`.
- `llm.ts` ficou sem SDK. Ele tem `hasCredentials`, `RefusalError` e `apiErrorMessage`, que identifica o erro pelo nome da classe.
- O schema da decupagem (`Decision`) continua em zod puro em `decupagem/decide.ts`. É o contrato dos dois cérebros.
- O SDK passou de `dependencies` para `optionalDependencies`.

## Consequências

- No modo local, o SDK não é carregado e nenhuma chave é exigida.
- O caminho Claude continua disponível para comparação (`bench`), sem custo para quem não o liga.
- Regra para o futuro: código de produto fora de `claude/` não importa `@anthropic-ai/sdk`.
