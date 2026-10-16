# NewEditor.AI

Agente editor de vídeo da **NewContent**, com o **Editor Brain**: o editor visual (estilo CapCut) onde o
humano assiste o agente editar ao vivo e pede alterações em texto.

Validado aqui, fora da plataforma, para depois entrar na NewContent. Repositório: https://github.com/thalesrioss/NewEditor.AI (privado).

## Rodar

Pré-requisitos: Node 24+, FFmpeg 7+, [uv](https://docs.astral.sh/uv/) e um Mac com Apple Silicon (ASR local).

```bash
npm install
cp .env.example .env      # cole a ANTHROPIC_API_KEY
npm run dev               # servidor :4310 + Editor Brain :5173
```

Abra http://localhost:5173 → **Novo projeto** → cole o caminho do bruto (ou arraste o arquivo) → **Decupar automaticamente**.

Na primeira transcrição o `uv` baixa o modelo `whisper-large-v3-turbo` (~1,6 GB). Depois disso, 3 minutos
de áudio transcrevem em ~12 s, sem custo e sem o material sair da máquina.

### Como app de desktop (Mac e Windows)

```bash
npm run desktop           # janela do app (Electron) sobre o servidor + Vite em desenvolvimento
npm run desktop:start     # o app com o servidor embutido, sem Vite (usa a interface construída)
npm run dist              # instalador: DMG/zip no Mac, NSIS no Windows → apps/desktop/release/
```

O app empacotado sobe o servidor num processo auxiliar (`utilityProcess`, como o VEHelper do CapCut) numa porta livre e guarda os
dados em `~/Library/Application Support/Editor Brain/data` (Windows: `%APPDATA%/Editor Brain/data`). Para o app usar os projetos deste
repositório, essa pasta pode ser um link para `data/`. Diário de abertura: `~/Library/Logs/Editor Brain/main.log` (diz se o servidor
subiu no auxiliar ou, de reserva, no processo principal, e qual FFmpeg foi escolhido).

FFmpeg e ffprobe vão dentro do app (`ffmpeg-static` 6.0 e `ffprobe-static`, fora do asar); se a máquina tem o do Homebrew, ele é
preferido por ser mais novo. O servidor lê `NEWEDITOR_FFMPEG` / `NEWEDITOR_FFPROBE` e escolhe a sintaxe certa por versão. Whisper, Qwen
(uv/Python) e Chrome ainda vêm do sistema (ADR-009, ADR-013). Instalar a build: `npm run dist:mac` e depois `ditto` (nunca `cp -R`)
de `apps/desktop/release/mac-arm64/Editor Brain.app` para `/Applications`.

## Editor Brain

Layout de referência do CapCut: **Transcrição | Mídia** à esquerda, player no centro, **Agente | Propriedades**
à direita e a timeline na largura inteira (V3 lettering/motion · V2 B-roll · V1 fala · A1 áudio · A2 SFX · A3 trilha).

| Atalho | Ação |
|---|---|
| Espaço | Tocar / pausar |
| ← / → (⇧ = 1 s) | Andar o cursor quadro a quadro |
| S | Dividir no cursor |
| ⌫ / Delete | Apagar o selecionado (clipe, overlay ou palavras da transcrição) |
| ⌘Z / ⇧⌘Z | Desfazer / refazer (a decupagem inteira é um passo só) |
| + / − | Zoom da timeline |
| Esc | Limpar seleção |

- **Transcrição editável**: arraste sobre as palavras e apague — o corte sai com bordas medidas na forma de onda.
- **Biblioteca**: o primeiro arquivo é a fala; os seguintes viram B-roll/áudio. Arraste para V2/A2/A3 ou use "+ no cursor".
- **Regra editorial**: o mesmo B-roll ou motion mais de 2× vira alerta (contorno vermelho + aba Propriedades).
- **Refazer a decupagem** preserva o que você restaurou, cortou e deu zoom.

## Como funciona

```
bruto ──► ingest ──► proxy 540p · wav 16k · envelope de energia (10 ms) · transcrição palavra a palavra
                         │
                         ▼
             decupagem (MEDIDA + EDITORIAL)
             ├─ analyze.ts   pausas, falas, pistas de retake      ← código, determinístico
             ├─ decide.ts    o que fica / o que sai e por quê      ← Claude (saída estruturada)
             └─ keptRanges   bordas medidas na forma de onda       ← código
                         │
                         ▼
      timeline (JSON) ◄── operações ──► WebSocket ──► Editor Brain (ao vivo)
                         │
                         ▼
                render FFmpeg a partir do ORIGINAL
```

- **A timeline é um documento.** Agente e humano editam o mesmo objeto, sempre por operações
  (`packages/core/src/types.ts` → `TimelineOp`). O servidor aplica, versiona e transmite — é isso que faz
  o humano ver o agente trabalhando e poder desfazer qualquer coisa.
- **Nada se perde.** Todo corte vira uma `Removal` com tipo e motivo; o humano restaura com um clique
  (na transcrição ou na faixa do bruto).
- **Regras do Cérebro do Editor viram código:** ASR não é fonte de tempo (bordas saem da energia),
  limiar medido no próprio material, nunca cortar fala no meio, pausas internas encurtadas, micro-fade
  de 5 ms nas emendas.

## Estrutura

| Caminho | O quê |
|---|---|
| `packages/core` | Modelo da timeline, operações (puras, testadas), tipos do WebSocket |
| `apps/server` | Fastify + WebSocket, ingest, decupagem, agente de comandos, render (`index.ts` só inicializa; rotas por área em `src/routes/`) |
| `apps/server/src/decupagem` | `analyze` (medido) · `decide` (Claude) · `plan` · `run` (ao vivo) · `bench` |
| `apps/web` | Editor Brain (Vite + React + Tailwind) |
| `services/asr` | Transcrição local com mlx-whisper |

## Benchmark da decupagem

Compara a decupagem automática com um corte base aprovado por humano:

```bash
npm run bench -w @neweditor/server -- <audio16k.wav> <transcript.json> <gabarito.json> [--cached]
```

Reporta precisão/recall de tempo, concordância palavra a palavra, erro de borda e lista cada divergência.

## Testes

```bash
npm test              # núcleo (operações da timeline) + servidor
npm run test:server   # só o servidor: probe/proxy por tipo de arquivo e o caminho ingest → ops → QC → render (gera as fixtures com o FFmpeg)
npm run typecheck
```

Os testes do servidor rodam numa pasta de dados temporária (`NEWEDITOR_DATA`) e respeitam `NEWEDITOR_FFMPEG` / `NEWEDITOR_FFPROBE`:
apontar para `node_modules/ffmpeg-static/ffmpeg` e `node_modules/ffprobe-static/bin/<os>/<arch>/ffprobe` confere o render com os
binários que o app leva.

## Próximas etapas

1. Kanban de projetos + agente **Gestor de Projetos** (briefing, link do Drive, estimativa de tempo)
2. Quebra de padrão: cut zoom, B-roll, motion (regra: não repetir o mesmo recurso mais de 2×)
3. Vídeo + render com motion; avatar com mais estados
4. Merge na NewContent
