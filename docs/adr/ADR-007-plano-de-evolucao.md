# ADR-007: Plano de evolução — Design, Inteligência, Funcionalidade e Funções

**Status:** Proposto (2026-10-10)
**Decisores:** Thales Rios
**Base:** `NewEditor.AI.canvas` · `docs/REVISAO-DE-ARQUITETURA.md` · ADR-001 a 006 · `docs/DESIGN-AUDITORIA.md` · relatório "Skills para evoluir o NewEditor" · Cérebro do Editor (`_SISTEMA`, `padroes`, `montagens`)

## Contexto

### O que o canvas pede e onde estamos

| # | Pedido do canvas | Hoje |
|---|---|---|
| R1 | Kanban: o editor sobe projetos por **link do Drive** ou pela plataforma | Kanban com 7 colunas e cartões completos ✅ · **Drive: falta** |
| R2 | **Gestor de Projetos**: lê a tarefa, cria o briefing, baixa o vídeo, manda **um por vez** | **Falta** (ADR-004 aprovado, nada implementado) |
| R3 | O NewEditor.AI **estima o tempo** pelas decisões que vai tomar | Estimativa por heurística ⚠️ (não calibrada pelas montagens) |
| R4 | O agente entrega até **Editado**; o humano aprova ou pede **Alteração** | Fluxo de revisão ✅ · **Ciclo de Alteração: falta** (não há comentários nem versões) |
| R5 | Editor Brain estilo CapCut, alterações **por texto**, ao vivo | ✅ (auditoria de design implementada) |
| R6 | **Parte difícil: decupagem** — clientes erram muitas vezes | 93,5% IoU no Felicidade, 95,6% no Davi · **melhor tomada ainda é "a última"** |
| R7 | **Quebra de padrão**; nunca o mesmo B-roll ou motion **mais de 2×** | Alertas de B-roll ✅ · motions ≤2 por modelo ✅ · **ritmo/retenção não é medido** |
| R8 | Avatar Habbo: tesoura, pincel, **sentado de frente para o humano**, pulo | ✅ · **não existe vista de frente** (o sprite é de 3/4) |
| R9 | Local → GitHub → merge na NewContent | **Sem commit e sem remote** |
| R10 | Sem API paga | ✅ (ADR-006) |
| — | **"Conhecimento para edição dos vídeos"** (nó do canvas ligado ao agente) | **Pouco usado** (ver abaixo) |
| — | **Cinéfilo.AI**: B-roll genérico ("Copy to Image") e de filme (clip.cafe) → aba Mídia | **Falta** · clip.cafe não tem licença de reuso |

### O ativo que o produto ainda não usa: o Cérebro do Editor

O vault já tem a "inteligência" que o canvas chama de *Conhecimento para edição*:

- **10 papéis** (`_SISTEMA/memoria`): analista de conteúdo, copywriter, roteirista, analista de material, diretor narrativo, editor, motion designer, sound designer, **QC** e orquestrador.
- **DNA editorial** (`DNA_EDITORIAL.md`), com padrões validados e padrões propostos.
- **Padrões por cliente** (`padroes/`): Brainer, Daniel Sun, Gabriel Lopes e Thales. Cobrem corte, zoom, lettering, flash, SFX, legenda, trilha, cor e B-roll, com as revisões do Thales anotadas (ex.: "lettering no máximo 2 linhas, abaixo do queixo", "motion nada entra seco", "SFX com pico no frame do evento", "legenda automática pode inventar dado").
- **62 correções e 268 decisões** registradas (`correcoes.jsonl`, `decisoes.jsonl`): o que o agente decidiu, o que o Thales corrigiu e por quê.
- **35 montagens**: histórico de peças, base para calibrar a estimativa de tempo (ADR-004).

Hoje o NewEditor usa só as referências de motion e de lettering. **O maior salto de qualidade sem API paga é transformar esse conhecimento em dado que o cérebro local executa.**

## Decisão

**Princípio:** *o conhecimento do Thales vira código e dado, medido por benchmark.* Cada melhoria de inteligência só é ligada se ganhar no benchmark, como a ADR-003 já definiu. Design e funções servem ao fluxo do canvas: o agente faz, o humano revisa num lugar só e entrega.

Seis decisões de arquitetura saem daqui:

1. **Perfil de edição por cliente (Motor de conhecimento).** Os `PADRAO - *.md` são compilados num perfil estruturado (`profile.json`, versionado e revisado pelo Thales). O projeto aponta para o cliente, e todas as etapas leem o perfil: decupagem, cor, legenda, lettering, motion, SFX, trilha e QC.
2. **Inteligência em camadas (reafirma a ADR-003)**, com o **LLM local via MLX como experimento com portão**. Ele só entra no que é ambíguo (melhor tomada, pedido livre, palavra-chave, consulta de B-roll, briefing) e só se ganhar das regras no benchmark.
3. **Ciclo de aprendizado sem treinar modelo.** `review.json` (diferença entre o corte do agente e o do humano) e `correcoes.jsonl` viram:
   - (a) **casos de regressão** no benchmark;
   - (b) **ajuste de parâmetros por cliente** no perfil (limiares, padding, agressividade).
4. **QC automático (papel 09) antes de "Editado".** É um checklist executável do DNA e do perfil. Bloqueia ou avisa, como os alertas editoriais.
5. **Gestor de Projetos e fila global**, conforme a ADR-004: Drive por link público primeiro, OAuth depois.
6. **Cinéfilo.AI só com fontes licenciadas**: biblioteca do cliente, banco local da NewContent, e Pexels/Pixabay com atribuição. Clip.cafe fica fora até haver análise jurídica.

## Opções consideradas (para a decisão central: de onde vem a inteligência)

### Opção A: Só regras escritas à mão
| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa |
| Custo | Zero |
| Qualidade | Boa no óbvio (95,6% e 93,5%); teto baixo em julgamento (tomada, ritmo, estilo do cliente) |
| Manutenção | Cresce mal: cada cliente vira um `if` |

### Opção B: Perfis compilados do Cérebro + regras + aprendizado paramétrico (proposta)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | Zero |
| Qualidade | Estilo do cliente sai certo na primeira; cada revisão humana melhora o próximo vídeo |
| Manutenção | O conhecimento fica no vault (onde o Thales já escreve); o código só lê |

### Opção C: B + LLM local (MLX) nas decisões ambíguas
| Dimensão | Avaliação |
|---|---|
| Complexidade | Média-alta (runtime de modelo, prompts, avaliação) |
| Custo | Zero por uso; download único de ~5–9 GB |
| Qualidade | Potencial acima de B em tomada e pedido livre; **não provado em PT-BR** |
| Risco | Lentidão e alucinação: precisa de benchmark e de saída estruturada |

### Opção D: API paga (Claude)
Rejeitada pela R10 e pela ADR-006. Fica só como teto de comparação no benchmark, se um dia for ligada.

## Análise de trade-offs

O erro mais caro hoje não é falta de "inteligência genérica", é **não aplicar o que o Thales já decidiu**: estilo do cliente, regras de QC e correções passadas. B resolve isso com custo zero e previsibilidade total, e é pré-requisito de C, porque o LLM local só faz sentido com benchmark e perfil prontos. Por isso a ordem é **B primeiro, C como experimento com portão**.

Do lado do produto, o canvas fecha o ciclo **Gestor → Agente → Revisão → Alteração → Entrega**. Hoje faltam as duas pontas (entrada pelo Drive e o ciclo de alteração e entrega), e o meio já está forte.

## Plano

Tamanho: **P** = até 1 dia · **M** = 2–4 dias · **G** = 1–2 semanas. Cada item aponta para o pedido do canvas que atende.

### Design (D)

| ID | O quê | Por quê / canvas | Tam. |
|---|---|---|---|
| D-1 | **Modo Revisão focado**: só player, dúvidas em fila (próxima/anterior), atalhos A = aceitar, T = trocar tomada, R = restaurar, e "Aprovar" | R4/R6: o humano revisa a decupagem em minutos | M |
| D-2 | **Antes/depois da passada do agente** (divisão no player ou alternância com B) | Confiança no que o agente mudou | M |
| D-3 | **Avatar 2.0**: vista de frente sentado ("de frente pro humano, olhando para os cantos"), aceno de "sua vez", caminhada em 4–8 direções no estilo Habbo (referência `81l7y.png`) | R8 ao pé da letra | M |
| D-4 | **Paleta de comandos ⌘K**: ações do editor e pedido ao agente no mesmo campo | R5: alterações por texto | M |
| D-5 | **Gaveta do projeto no Kanban**: briefing, cliente, perfil, histórico, versões, estimado × real | R1/R3 | M |
| D-6 | **Página do design system** (`#/design`) com tokens e componentes vivos | Evita o design voltar a se desorganizar | P |
| D-7 | Presets de layout (notebook ou monitor), painéis recolhíveis, minimapa da timeline | Uso diário em telas pequenas | M |
| D-8 | Estados vazios e primeiro projeto guiado | Adoção por outros editores da NewContent | P |

### Inteligência (I)

| ID | O quê | Por quê / canvas | Tam. |
|---|---|---|---|
| I-1 | **Perfil de edição por cliente** compilado dos `PADRAO-*.md`, revisável na UI, aplicado em todas as etapas | Nó "Conhecimento para edição" | G |
| I-2 | **Banco de benchmark com 5+ projetos reais** (bruto + corte aprovado), contando as montagens do vault | ADR-003 #2: sem gabarito, nenhuma decisão é confiável | M |
| I-3 | **QC automático (papel 09)**: legenda × números ditos, lettering ≤2 linhas abaixo do queixo, motion "não entra seco", SFX no frame do evento, loudness, frame preto, repetição >2× | DNA + padrões; R7 | M |
| I-4 | **Ciclo de aprendizado**: `review.json` + `correcoes.jsonl` → casos de regressão + ajuste de limiares por cliente | R6: cada revisão melhora a próxima | M |
| I-5 | **Melhor tomada por pontuação**: completude, disfluência, velocidade, energia e entonação final, em vez de "a última" | R6 / ADR-003 #1 | M |
| I-6 | **Detector de sílabas** (repetição que o ASR fundiu) + nova transcrição "ao pé da letra" na janela | ADR-003 #1 | M |
| I-7 | **Sinais visuais locais** (Apple Vision via CLI Swift): olhar para a câmera, rosto fora do quadro, careta ou pausa visual como pista de tomada ruim; caixa do rosto para lettering e reframe | R6 + "lettering não cobre o rosto" | M |
| I-8 | **Ritmo e retenção**: gancho nos 3 s, quebra de padrão a cada 2–4 s (zoom, B-roll, lettering), detector de trecho monótono | R7 ("quebras de padrão") | M |
| I-9 | **Experimento com LLM local (MLX)** com portão: melhor tomada, pedido livre, palavras-chave, consulta de B-roll, briefing. Só liga se ganhar no I-2 | ADR-003 camada 3 | G |
| I-10 | **Estimativa calibrada**: tempo por etapa gravado em cada projeto + pesos tirados das 35 montagens | R3 / ADR-004 #4 | P |

### Funcionalidade — fluxos (F)

| ID | O quê | Por quê / canvas | Tam. |
|---|---|---|---|
| F-1 | **Gestor de Projetos**: texto da tarefa → briefing estruturado → cliente/perfil → **download por link do Drive** → projeto na Fila | R1, R2 | G |
| F-2 | **Fila global, um por vez**, com posição, prioridade e cancelamento; o Kanban mostra a fila real | R2 / ADR-004 #2 | M |
| F-3 | **Ciclo de Alteração**: comentários com tempo na timeline (do editor ou repassados do cliente) → tarefas do agente → **versão v2**, com diferença entre versões | R4 ("Alteração") | G |
| F-4 | **Entrega**: presets (Reels, Shorts, TikTok, YouTube 16:9), nome padronizado, SRT, capa, pasta de entrega ou Drive, QC obrigatório antes de "Entregue" | R4 ("Entregue") | M |
| F-5 | **Cinéfilo.AI (genérico)**: pontos narrativos → consultas → biblioteca local + Pexels/Pixabay (com atribuição) → aba Mídia, respeitando o 2× | Grupo Cinéfilo do canvas | G |
| F-6 | **Jobs que sobrevivem a reinício** (retomar o render ou a decupagem interrompida) e cancelamento | Robustez (já perdemos renders em restart) | M |
| F-7 | **Persistência atrás de interfaces** (`ProjectRepository`, `JobQueue`, `MediaStorage`) + commit inicial e GitHub | R9 / ADR-004 #5 | M |

### Funções — ferramentas de edição (N)

| ID | O quê | Origem | Tam. |
|---|---|---|---|
| N-1 | **Reframe 16:9 → 9:16** seguindo o rosto (usa I-7) | Material de YouTube virando Reels | M |
| N-2 | **Zoom dinâmico** (punch-in animado com curva) nas ênfases, além do cut zoom fixo | Padrão Daniel Sun ("cut zoom") + I-8 | M |
| N-3 | **Cadeia de voz**: EQ, compressor e de-esser, com presets por perfil (junto com a limpeza de ruído) | Sound designer (papel 08) | P |
| N-4 | **Trilha automática** por clima e BPM da biblioteca, cortes da música no tempo | Padrões "Trilha" | M |
| N-5 | **Flash e transições** do padrão do cliente | Padrão Daniel Sun §4 e §11.5 | P |
| N-6 | **Legenda segura**: números e nomes conferidos contra a fala e o briefing ("legenda pode inventar dado") | Padrão Daniel Sun §12.4 | P |
| N-7 | **Velocidade e freeze frame** | CapCut | M |
| N-8 | **Capa/thumbnail** a partir de um quadro + lettering do perfil | Entrega | P |
| N-9 | **Duas câmeras sincronizadas pelo áudio** (multicam simples) | Material com A/B cam | G |

## Fases

| Fase | Foco | Itens | Portão para seguir |
|---|---|---|---|
| **1. O Cérebro dentro do produto** | Aplicar o que o Thales já decidiu | I-2, I-1, I-3, I-10, N-6, D-1, D-6, F-6 | Benchmark com 5 projetos; QC acha os erros já registrados nas correções |
| **2. O fluxo do canvas de ponta a ponta** | Entrada e saída | F-1, F-2, F-3, F-4, D-5, D-2, F-7 | Um projeto real vai do link do Drive até "Entregue" sem sair do Editor Brain |
| **3. Julgamento editorial** | Decupagem e ritmo | I-4, I-5, I-6, I-7, I-8, N-1, N-2, N-3, D-3, D-4 | IoU ≥ 96% na média do benchmark; tempo de revisão humana cai pela metade |
| **4. Escala e Cinéfilo** | B-roll, LLM local, merge | F-5, I-9 (se ganhar), N-4, N-5, N-7, N-8, N-9, D-7, D-8, export rápido (ADR-005 5b) | Merge na NewContent |

## Métricas

- **Decupagem:** IoU e palavras iguais ao corte aprovado, por projeto do benchmark. Meta: ≥ 96% de média e nenhum projeto < 92%.
- **Revisão:** tempo do humano entre "Revisão da decupagem" e "Aprovar"; número de dúvidas por minuto de vídeo.
- **Qualidade:** problemas de QC por entrega; quantos pedidos de alteração repetem uma correção já registrada (meta: 0).
- **Fluxo:** tempo da Fila até Editado; estimado × real (erro < 25%).
- **Custo:** API paga = 0 (verificado pela regra do hookify e pela ADR-006).

## Consequências

- **Fica mais fácil:** cada cliente sai no estilo certo desde a primeira versão; o Thales ensina o sistema escrevendo no vault, como já faz; os erros corrigidos uma vez não voltam (regressão).
- **Fica mais difícil:**
  - manter o perfil sincronizado com os `.md` (precisa de compilação e revisão);
  - precisamos de gabaritos reais para cada cliente;
  - o ciclo de alteração exige versões de projeto.
- **Revisitar:**
  - o LLM local (I-9), depois do benchmark;
  - onde o ASR e a fila rodam quando entrar na NewContent (Mac do editor ou servidor);
  - B-roll de filmes, depois de análise jurídica.

## Decisões que dependem do Thales

1. **Commit inicial e repositório no GitHub** (R9). Destrava o versionamento e as revisões automáticas de código.
2. **Gabaritos:** quais projetos entram no benchmark. Precisam do bruto e do corte aprovado; as montagens do vault são candidatas.
3. **Experimento com LLM local (I-9):** baixar um modelo de ~5–9 GB para testar? Só fica ligado se ganhar no benchmark.
4. **Drive:** começar só com link público ("qualquer pessoa com o link") e deixar o login Google para depois?
5. **Cinéfilo:** confirmar só fontes licenciadas (biblioteca própria, Pexels, Pixabay). B-roll de filme fica em espera até análise jurídica.

## Ações imediatas (Fase 1)

1. [ ] I-2: montar o benchmark (formato de gabarito + script que roda todos e imprime a tabela de métricas)
2. [ ] I-1: esquema do `profile.json` + compilador dos `PADRAO-*.md` + tela de revisão do perfil
3. [ ] I-3: QC como etapa antes de "Editado", com os 7 checks do DNA e do perfil
4. [ ] I-10: gravar o tempo de cada etapa no projeto; calibrar a estimativa
5. [ ] N-6: legenda segura (números e nomes)
6. [ ] D-1: Modo Revisão focado
7. [ ] F-6: retomar jobs após reinício

## Status da implementação (2026-10-10, mesma sessão)

Decisões do Thales: sem GitHub por enquanto; LLM local autorizado (baixado `mlx-community/Qwen3-8B-4bit`, 4,6 GB, responde em ~1,4 s); gabaritos do benchmark vão se acumulando conforme ele edita; Drive por link público; Cinéfilo **usa o clip.cafe** (decisão dele; a ressalva de licença fica registrada em `cinefilo.ts`).

| Item | Status | Onde |
|---|---|---|
| I-1 perfil por cliente (compilado dos `PADRAO-*.md`, revisável) | ✅ 4 perfis importados: Brainer, Daniel Sun, Gabriel Lopes, Thales | `core/profile.ts`, `server/profiles.ts`, `#/perfis` |
| I-2 benchmark (gabarito a cada aprovação/entrega, `bench:all`, `--tune --apply`) | ✅ acumula a partir de agora | `server/benchmark.ts`, `decupagem/bench-all.ts` |
| I-3 QC (papel 09) antes de Editado e no render | ✅ 12 regras + loudness/pico/quadro preto | `server/qc.ts` |
| I-4 aprendizado paramétrico (folgas por perfil pelo benchmark) | ✅ via `bench:all --tune --apply` | idem |
| I-5 melhor tomada por pontuação | ✅ com dúvida quando empata ou fica a anterior | `decupagem/local.ts` |
| I-6 detector de sílabas (repetição fundida) | ✅ vira dúvida; sem re-transcrição automática | `decupagem/analyze.ts` |
| I-7 sinais visuais (Vision do macOS) | ✅ rostos por amostra; legenda abaixo do queixo; QC "texto sobre rosto" | `services/vision/faces.swift`, `server/vision.ts` |
| I-8 ritmo / quebra de padrão (cut zooms nas ênfases) | ✅ na finalização e por ⌘K | `server/ritmo.ts` |
| I-9 LLM local com portão | ✅ serviço + usos: briefing, comando (reescreve na gramática local), B-roll. **Desligado por padrão** até ganhar no benchmark | `services/llm/serve.py`, `server/llm-local.ts` |
| I-10 estimativa calibrada por etapa | ✅ tempos reais gravados; estimativa por mediana | `server/estimate.ts` |
| F-1 Gestor (tarefa → briefing → Drive → fila) | ✅ arquivo e pasta pública do Drive | `server/gestor.ts`, formulário "Colar a tarefa" |
| F-2 fila global, um por vez, posição/prioridade/cancelar | ✅ | `server/jobs.ts`, `/api/fila` |
| F-3 ciclo de Alteração (comentários → agente → versão → diff) | ✅ testado: 1 pedido feito, 1 marcado manual | `server/alteracoes.ts`, `CommentsSection` |
| F-4 entrega (preset, .srt, capa, pasta, QC obrigatório) | ✅ | `server/entrega.ts`, `ExportDialog` |
| F-5 Cinéfilo (clip.cafe: busca, sugestões pelo roteiro, baixar para a Mídia, inserir) | ✅ | `server/cinefilo.ts`, `CinefiloPanel` |
| F-6 jobs sobrevivem a reinício | ✅ `data/fila.json` | `server/jobs.ts` |
| F-7 persistência atrás de interfaces | ⏳ não feito | — |
| D-1 modo revisão focado (J/K, L, A, T, R) | ✅ | `ReviewFocus` |
| D-2 antes/depois (segurar B) | ✅ no motor "Quadro exato" | `EnginePlayer`, `PlayerParts` |
| D-3 avatar de frente / aceno | ⏳ precisa de arte nova (sprite de frente) | — |
| D-4 paleta ⌘K | ✅ | `CommandPalette` |
| D-5 gaveta do projeto no Kanban | ✅ | `ProjectDrawer` |
| D-6 página do design system | ⏳ | — |
| D-7 presets de layout / D-8 estados vazios | ⏳ | — |
| N-1 reframe seguindo o rosto | ⏳ (rosto já medido) | — |
| N-2 zoom dinâmico | ⏳ | — |
| N-3 cadeia de voz (EQ, compressor, de-esser) | ✅ junto da limpeza, preview = export | `server/denoise.ts`, aba Áudio |
| N-4 trilha por BPM · N-5 flash · N-7 velocidade/freeze · N-9 multicam | ⏳ | — |
| N-6 legenda segura (números/nomes) | ✅ no QC | `server/qc.ts` |
| N-8 capa | ✅ na entrega | `server/entrega.ts` |

## Segunda rodada (2026-10-10): os itens que tinham ficado

| Item | Status | Verificação |
|---|---|---|
| N-2 zoom dinâmico (`zoomTo`, ease-out) | ✅ preview (dois motores) + export (zoompan quadro a quadro) | quadros do export em 3 instantes do clipe: o rosto cresce 1,0→1,2 |
| N-5 flash (2 quadros invertidos sem cor + SFX "obturador") | ✅ preview (`mix-blend-mode: difference`) + export (`negate`/`hue` com timeline) | export: YAVG 31→228→27 e saturação ≈0 só no quadro do flash |
| N-7 velocidade (0,5–2×, áudio sem mudar o tom) e freeze (último quadro, silêncio) | ✅ núcleo (duração, locate, legendas), preview, export (`setpts`/`atempo`, `tpad`/`apad`) | duração do MP4 145,94 s = esperado 145,93 s; freeze confirmado no trecho isolado (quadros idênticos); no MP4 final esse trecho ficou coberto por um motion |
| N-9 duas câmeras sincronizadas pelo áudio | ✅ `sync-cam` (correlação dos envelopes), seleção por clipe, alternância automática | cópia deslocada 3,21 s alinhada em **−3,21 s** (confiança 1): o quadro da 2ª câmera no deslocamento é idêntico ao da fala (SSIM 1,000; 0,96 a 0,2 s de distância); o preview decodifica a 2ª câmera; o export usa o mesmo trecho deslocado |
| N-1 reframe seguindo o rosto | ✅ núcleo (`framing.x`, `reframe`), compositor ("reframe"), export (`crop` em volta do rosto), `reframe-auto` pelo Vision | **não testado com material 16:9 real** (os projetos locais são 9:16) |
| N-4 trilha por BPM | ✅ análise local (BPM, clima, intro calma, fase da batida), `music-auto` pelo ritmo do corte, começo num tempo forte, nível do perfil | 26 faixas analisadas; alvo 104 BPM para corte mediano de 2,3 s → escolheu "Extraño" |
| D-3 avatar | ⚠️ parcial: aceno de "sua vez" (mão pixel art) | a vista de frente sentado ainda precisa de arte nova |
| D-7 presets de layout | ✅ notebook/monitor + recolher painéis | header do editor |
| D-8 estados vazios | ✅ Kanban sem projetos (primeiro projeto guiado) | — |
| Correção: `prepare()` sobrescrevia papel/sincronia do asset | ✅ `saveAsset` mescla | sync-cam agora persiste |

Correções desta rodada: sinal do deslocamento da 2ª câmera; nome do render não colide quando a fila retoma um trabalho; a tela não acusa "Claude sem chave" enquanto o servidor reinicia; o avatar volta a ficar livre depois do render.

## Correção de rumo (2026-10-10): só o estilo do Thales é referência

Thales: *"O único estilo de vídeo que é padrão de sucesso é o meu. O restante são testes que não ficaram bons."*

- O perfil **thales** (lido da SAND v1) é o **padrão da casa** e o único **validado**: vale para todo projeto sem perfil escolhido. A identidade dele entrou como dado: corte seco, zoom com teto 1,10 ciclando três valores sem repetir, flash de 3 quadros com obturador só em cima de corte (troca de arquivo e salto longo), movimento em ~¼ dos clipes, lettering literal que nunca repete a fala inteira, trilha em fases com silêncio antes do que pesa mais, cobertura perto de 40%.
- **Brainer, Daniel Sun e Gabriel Lopes** ficam no sistema como **teste** (`validado: false`): servem para consulta, o Gestor não os assume pelo nome do cliente, e o QC/estimativa partem do padrão da casa.
- O vault (`DNA_EDITORIAL.md`, `padroes/`) não foi alterado — é do Thales.
- O que o padrão dele diz que **não vira número fixo** (§10 DECISÃO: onde o ritmo sobe, quantas fases de trilha, quais cortes levam flash, quais filmes) continua sendo decidido por peça; os automáticos (cut zooms, flash, trilha) são propostas que ele revisa.
- **Flash automático pela regra dele** (`autoFlashes`, em `ritmo.ts`): entra no fluxo de finalização depois dos cut zooms e no ⌘K ("Flashes onde a emenda apareceria"). Só põe flash em cima de corte onde a emenda denunciaria — troca de arquivo (sempre) e salto longo na mesma fonte (acima de 1,6× a mediana dos saltos) — nunca dois a menos de 2 s, teto de ~15% dos cortes (a fração medida na SAND v1). Testado no projeto de teste: 59 cortes de uma só fonte → 9 flashes nos maiores saltos; o Thales revisa como qualquer proposta do agente.

## Aba "Cérebro" (2026-10-10): os dois cérebros como grafo em 3D

Thales: *"Quero que na parte que fica a foto do avatar a parte de 'Cérebro do Editor' vira um botão para uma aba, que mostra de forma visual e em uma perspectiva 3D o conhecimento e as notas conectadas assim como o vault do obsidian. (…) para os motions tem que ser como se fosse um outro cérebro que se conecta a esse — o nosso Vault do Motion Studio."*

- **Botão:** a foto do avatar no painel do agente (e o link "Cérebro" no Kanban) abre `#/cerebro`.
- **Dois cérebros, cada um com seu centro:** Cérebro do Editor (`~/Documents/Cérebro do Editor`, tons frios) e Motion Studio Brain (`~/Documents/Motion Studio - Brain`, tons quentes). Em motion manda o Motion Studio Brain (regra A-08 do próprio vault); a memória 07 do Editor fica como receita técnica — e é exatamente essa a ponte que o grafo mostra.
- **Ligações lidas, não inventadas:** `[[wikilinks]]` do Obsidian; menções a caminhos e nomes de nota; pastas (projeto/filme); diário de decisões e correções (skill ↔ projeto); mapa Skill → brains; cliente ↔ PADRAO; canvas; perfis do produto ← PADRAO lido. **Pontes** entre cérebros: nota que cita o outro vault (nome ou caminho), material de motion do Editor ↔ Motion Studio Brain, "Padrões do Thales" (motion) ↔ PADRAO Thales (editor).
- **Números hoje:** 242 notas, 815 ligações, 24 pontes; o grafo é montado em ~0,15 s e cacheado 45 s (`GET /api/cerebro/grafo`, `?refresh=1` relê).
- **3D sem dependência:** simulação de força em 3D e projeção em perspectiva num Canvas 2D (`apps/web/src/lib/graph3d.ts`): órbita por arrasto, zoom na roda, névoa por profundidade, rótulos que aparecem conforme a escala, hover realça vizinhos, clique abre a nota (prévia em markdown, ligações agrupadas, "Abrir no Obsidian"), duplo clique centraliza, busca com dimming, grupos por cérebro com liga/desliga.
- **Só leitura:** o produto nunca escreve nos vaults. Editar é no Obsidian.

## Exclusão (2026-10-10): Brainer, Davi Lo e Gabriel Lopes saem do vault

Thales: *"Tudo que for da Brainer, Davi Lo e Gabriel Lopes exclui, isso não é padrão, pode excluir até do Vault."*

- Movido para `~/Documents/Cérebro do Editor/.trash/` (a lixeira do próprio Obsidian — reversível, nada foi apagado de vez): os 2 PADRAO, as 10 montagens avulsas, `_arquivo-claude/`, os projetos `davi-lo-15-dias-sem-treinar`, `gabriel-lopes-segredo-vida-feliz` e `_palestra-gabriel-inquietos` (brutas em "Gabriel Lopes 2"), os B-rolls, renders, grades, motions (.drt, comps e scripts `brainer_*`) e as prévias em `Claude outputs/`.
- No produto: perfis `brainer` e `gabriel-lopes` e o projeto "Davi Lo — 15 dias sem treinar" (38 MB) foram para `data/_lixeira/`; o exemplo do Gestor passou a citar o Thales.
- Ficaram, de propósito: o diário `_SISTEMA/decisoes.jsonl`/`correcoes.jsonl` (71 decisões e 8 correções desses projetos) e as memórias das Skills que os citam — são aprendizado do processo, não padrão de estilo; limpar só se o Thales pedir. Também ficaram as imagens de QC sem dono claro em `Claude outputs/` e `_renders/`.
- Grafo depois: Cérebro do Editor com 98 notas (eram 133); padrões agora são só Thales (casa) e Daniel Sun (teste).

## Kanban: apagar projeto · duas brutas (2026-10-10)

- **Apagar projeto:** lixeira no card (dois cliques: arma "Apagar?" e confirma; desarma em 4 s) e na gaveta ("Apagar projeto", confirmação). `DELETE /api/projects/:id` exige o cabeçalho `x-apagar: sim` (a tela manda) e registra quem pediu; cancela o que estiver na fila para o projeto, fecha os sockets e move a pasta para `data/_lixeira/projects/` — reversível à mão, nunca apagado de vez.
- **Duas brutas:** o segundo vídeo com áudio e ≥ 60 s que chega antes de qualquer decupagem vira **fala** (antes virava B-roll) e entra na montagem crua em seguida; a decupagem (`runDecupagem` sem `assetId`) planeja cada bruta e aplica tudo numa transação só, na ordem em que chegaram, preservando o que o humano já decidiu por bruta. Na aba Mídia dá para trocar o papel ("virar fala" / "virar B-roll"); virar fala transcreve. O Gestor passou a decupar uma vez só, depois de todas as brutas transcritas.

## Primeiro teste real do Thales (2026-10-11): o que faltava na finalização

Thales, vendo a peça "João Pedro Vdmkt" finalizada: *"Os motions que esse projeto criou estão podres, horríveis, comparados aos que criamos antes e eu os aprovei. Não adicionou B-roll, não adicionou trilha, não corrigiu a cor. O que me mostra que o agente não tá indo bem ainda."*

Causas e correções:
- **Cor:** o bruto é XAVC HEVC 10-bit S-Log3 bem exposto (YMAX > 760) e o detector o tratou como Rec.709 — a peça saiu lavada. `guessInput` agora reconhece LOG pelo preto alto (85–140/1023) com pouca saturação, mais forte em XAVC (Sony).
- **B-roll:** a finalização não tinha a etapa. Entrou `broll.ts` (`autoBroll`): frases de imagem forte → Cinéfilo (clip.cafe) → cobre a frase inteira na V2 até ~40% de cobertura, nunca a mesma cena > 2×, sem sobrepor B-roll/motion existente.
- **Trilha:** também não tinha etapa. Entrou `musicAuto` na finalização (BPM alvo pelo corte, clima, nível do perfil, começo num tempo forte), só se a peça ainda não tem trilha.
- **Motions:** os "cartões" de template (`core/motion.ts`) são justamente o que o Motion Studio proíbe (título centralizado, tudo com fade). Regra A-08: em motion manda o Motion Studio Brain. A finalização passou a **escrever as ordens de cena** para o Studio (`motion-studio.ts`: pasta por cena em `Cérebro do Editor/montagens/<slug>/motions/`, com BRIEF.md no modo CENA da skill `motion-designer`, `cena.json`, `contexto.jpg` do bruto e posição do rosto) e a **importar os renders** com alfa (ProRes 4444 → proxy WebM VP9 com alfa para o preview; no export, `overlay` com `yuva420p`) na V3 no frame exato, com re-render substituindo. Os cartões continuam disponíveis com `perfil.motion.fonte = 'cartoes'`. Letterings seguem no produto (A-07: lettering ≠ animação).
- Novas etapas `broll` e `trilha` na estimativa, na gaveta e na faixa do agente; `MediaAsset.alpha` e papel `motion`.

## Feedback do Thales no JP (2026-10-11, 2ª rodada)

- **Cut zoom in/out onde não há camada:** `autoZooms` agora dá cut zoom em todo clipe sem lettering/motion/B-roll (cobertura < ⅓), alternando zoom in (valor do perfil, nunca o mesmo do anterior) e zoom out (volta a 1,0); clipes ≥ 4 s ganham push lento (`zoomTo`). Zoom do humano é respeitado e a alternância parte dele.
- **Cinéfilo não rodava:** o LLM local estava desligado e o dicionário PT→EN não tinha os termos do vídeo (audiência, funil, oferta, confiança…) → nenhum "beat". LLM local ligado (`data/settings.json`), dicionário com ~45 termos de marketing/negócio, rota `POST /api/projects/:id/broll-auto` + ⌘K.
- **SFX dos motions do Studio:** os `cues` do `film.js` (`render.mjs --cues`) entram no overlay (`OverlayItem.sfx`, op `set_overlay_sfx`) e são sintetizados no preview e no export com o foley do produto; nomes do Studio mapeados (`normalizeSfxKind`) e foley novo: giz, papel amassado, rasgo, moeda, tapa na mesa.
- **Aba Legenda separada da aba Lettering:** `CaptionPanel` com posição (altura, centro, largura), fonte (Inter, Montserrat, Bebas, Anton, Playfair), tamanho, peso, itálico, cor, cor do destaque, palavras e caracteres por bloco, caixa alta, espaçamento, entrelinha, contorno, sombra, tarja — e **presets só de legenda** (`data/presets-legenda.json`, 5 embutidos). O mesmo estilo inline vale no preview e no export (`captionInlineStyle`).
- **Lettering:** posição por lettering (altura + alinhamento) nas propriedades, e um controle na aba para mover todos; presets de estilo mantidos.
- **Legenda some sob camada (regra de uso):** sempre que há lettering, motion ou B-roll em cima de uma legenda (≥ ⅓ dela, ou do seu começo), ela não aparece — no preview e no export (`cueVisible`). Na timeline o bloco fica apagado (tracejado, 40%) com o motivo no tooltip; o olho no bloco força mostrar mesmo assim (`captionEdits[].force`), e desfaz.
