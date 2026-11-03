# Perfil de captura automático no ingest (FB-0185) — rascunho técnico

Estado: rascunho da Mari (neweditor), 03/11/2026. Ainda sem código. Pedido do dono (Thales 27/10 12:23): "os editores
precisam identificar como foi gravado e converter para o Rec.709; se eu colocar outros formatos, como uma Blackmagic,
vou ter que ficar toda hora falando o que é o quê?". Regra: zero pergunta ao dono; no máximo uma pergunta ao gestor por
câmera sem metadado, gravada para sempre.

## 1. O que já existe em main (2b19761)

| Peça | Onde | O que faz | Limite |
|---|---|---|---|
| `SourceColor` (input, gamma, gamut, modelo, fonte, codeRange, inputLut) | `packages/core/src/color.ts:59` | cor de entrada gravada no asset (`MediaAsset.color`) | `fonte` só aceita `'xml'` ou `'herdado'` |
| `sonyXmlColor` + `cameraXml` | `apps/server/src/color-source.ts` | lê o NonRealTimeMeta da Sony (caixa do MP4 ou `<clipe>M01.XML`) | só Sony; curva desconhecida = null |
| `readSourceColor` / `withSourceColor` / `projectColors` | `color-source.ts` | lê, guarda em cache e herda do bruto (recorte ProRes) | sem XML Sony, devolve null e o arquivo vira Rec.709 em silêncio |
| `InputTransform` | `color.ts:16` | rec709, slog3, vlog, clog3, applelog, flog2, nlog, logc3, logc4, bmdfilm5, com curva e gamut | não tem HLG nem PQ (iPhone HDR padrão, Dolby Vision) |
| `slog3Lc709TypeA` (`BUILTIN_INPUT`) | `color.ts:250` | S-Log3 converte embutido, sem LUT do Resolve | só S-Log3 é embutido; os outros usam curva + tone map da casa ou `inputLut` |
| `guessInput` (palpite pelo quadro) | `color.ts:532`, usado em `apps/server/src/color.ts:43` | preto alto e pouca saturação = LOG | só na correção automática; não grava nada no asset, não avisa |
| qc-tecnico | `apps/server/src/qc-tecnico.ts` | gate da FT | não olha curva de entrada |

O buraco do pedido é exatamente o "null → Rec.709 sem aviso" do `readSourceColor`: foi o que estragou os 18 projetos da
eq2210 (S-Log3 tratado como 709).

## 2. Desenho proposto

Um módulo só, `apps/server/src/perfil-captura.ts`, chamado no ingest no lugar do `readSourceColor`, que devolve sempre
um `SourceColor` com a origem da decisão. Nunca devolve null para vídeo de câmera.

### 2.1 `SourceColor` ganha origem e confiança

```ts
fonte: 'xml' | 'herdado' | 'tag' | 'codec' | 'camera-conhecida' | 'resposta' | 'medida' | 'presumido';
camera?: string;          // "Sony ZV-E10", "iPhone 15 Pro", "Blackmagic Pocket 6K"
confianca: 'certa' | 'provavel' | 'desconhecida';
```

`certa` = metadado do arquivo ou resposta gravada; `provavel` = medida do quadro; `desconhecida` = nenhum sinal.
Projeto antigo sem `confianca` é lido como hoje (teste de compatibilidade).

### 2.2 Ordem de detecção (a primeira que responde vence)

1. **Sidecar e XML do fabricante.** Sony NonRealTimeMeta (já existe). Blackmagic: `.sidecar` do BRAW e os metadados do
   ProRes da câmera (`com.blackmagic-design.camera.*`: `gamma`, `colorScience`). Canon: XML `<clipe>.XML` /
   `CameraMetadata` do Cinema RAW Light e MXF.
2. **Tags do stream e do container (ffprobe, sem dependência nova).**
   - `color_transfer=arib-std-b67` → **HLG** (iPhone HDR padrão, Sony HLG, Android HDR). Novo `InputTransform` `'hlg'`.
   - `color_transfer=smpte2084` → **PQ** (Dolby Vision perfil 8.4 vira HLG na base; DV 5 e PQ puro são raros em celular). Novo `'pq'`.
   - Apple Log: o iPhone 15/16/17 Pro grava ProRes ou HEVC com a chave `com.apple.quicktime.camera.log` ou
     `color_transfer` próprio; confirmar nas amostras e mapear para `'applelog'` (já existe a curva).
   - `com.apple.quicktime.make` / `model` e `make`/`model` do udta dão a câmera para o texto do editor.
   - `bt709` explícito + câmera de celular = Rec.709 certo.
3. **Codec.** BRAW (fourcc `brw*`) e ProRes RAW não são lidos pelo FFmpeg: o ingest recusa com mensagem clara ("exporte
   em ProRes da câmera" ou converter pelo `braw-decode` do SDK livre da Blackmagic, item separado). ProRes com make
   Blackmagic sem `gamma` → `bmdfilm5` provável.
4. **Câmera conhecida + resposta gravada.** Tabela versionada `packages/core/src/cameras.ts` (marca/modelo/tag →
   transformação) e as respostas do gestor gravadas no perfil do cliente (`profiles.ts`, campo `capturas: { [chave da
   câmera]: InputTransform }`). Chave da câmera = make + model + resolução + codec (o mesmo corpo com outra curva muda o
   metadado, então a chave só é usada quando o metadado de curva não existe).
5. **Medida do quadro** (`guessInput` promovido, com 3 quadros em vez de 1, e o HLG detectado pelo pico acima de 100 IRE
   em 10 bits). Dá `confianca: 'provavel'`.
6. **Nada:** Rec.709 com `fonte: 'presumido'`, `confianca: 'desconhecida'`.

### 2.3 Transformações

| Origem | `input` | Conversão |
|---|---|---|
| Sony S-Log3/S-Gamut3.Cine | `slog3` | embutida LC-709 Type A (já existe) |
| iPhone/Android/Sony HLG | `hlg` (novo) | HLG BT.2100 → linear (OOTF 1,2) → BT.2020 → BT.709 + tone map da casa, em 16 bits, no mesmo ponto da conversão LOG (`gradePixel` no core = WebGL = FFmpeg) |
| Apple Log | `applelog` | curva já no core; gamut Rec.2020 → 709 |
| Blackmagic Film Gen5 | `bmdfilm5` | curva já no core; gamut BMD WG5 → 709 |
| PQ | `pq` (novo) | ST 2084 → linear → 709, tone map com pico 1000 nits |
| Rec.709 / SDR | `rec709` | identidade |

Para HLG existe a alternativa de usar o `zscale` do FFmpeg (`tin=arib-std-b67:t=bt709` + `tonemap`), mas a prévia
WebGL não teria a mesma conta. Proposta: conta própria no core (como as outras curvas), com teste de paridade contra o
`zscale` (ΔE médio < 2 nos patches).

### 2.4 Quando não sabe: uma pergunta, uma vez

- `confianca: 'desconhecida'` com medida de LOG (`provavel` diferente de rec709): o render e a entrega ficam bloqueados
  para aquele asset, e o painel do projeto mostra ao **gestor** (não ao dono) "Câmera X (modelo, resolução): como foi
  gravado?" com as opções da tabela e o quadro convertido de cada opção lado a lado.
- A resposta grava `capturas[chave]` no perfil do cliente e reaplica em todos os assets com a mesma chave, em todos os
  projetos daquele cliente. A mesma câmera não pergunta de novo.
- `desconhecida` com medida de Rec.709 (celular comum): não pergunta, segue Rec.709 com `fonte: 'presumido'`.

### 2.5 Gate e transparência

- **qc-tecnico** reprova peça com asset `desconhecida` que pareça LOG, e avisa (sem reprovar) `presumido` em bruto
  que não parece LOG.
- **Nota do render e do 00_ANALISE_INICIAL**: "Câmera X, curva Y (de onde veio: XML / tag / resposta do gestor em
  dd/mm), conversão Z", uma linha por câmera. O `convertedBy` já existe e ganha a origem.
- **Inspetor do clipe**: a cor de entrada mostra a origem e permite trocar (a troca vira resposta gravada).

## 3. Fatias e estimativa

| Fatia | Conteúdo | Estimativa |
|---|---|---|
| P1 | amostras reais das 5 origens em `fixtures` fora do repo (iPhone HLG, iPhone Apple Log, ZV-E10 S-Log3, Blackmagic ProRes Film, Android SDR) + teste de detecção que falha hoje | 2 h (depende de alguém gravar 5 s em cada câmera; a NewStudios tem iPhone e Sony) |
| P2 | `perfil-captura.ts` com as camadas 1, 2, 3 e 6; `fonte`/`confianca` no `SourceColor`; ingest passa a usar | 4 h |
| P3 | `hlg` e `pq` no core (curva + gamut + tone map), WebGL e FFmpeg iguais, teste de paridade com `zscale` | 4 h |
| P4 | tabela de câmeras + `capturas` no perfil do cliente + pergunta ao gestor no painel + bloqueio do render | 5 h |
| P5 | gate no qc-tecnico, nota no render, linha no 00_ANALISE_INICIAL | 2 h |

Total perto de 17 h, cerca de 2 dias de rodada. Custo recorrente zero (ffprobe e conta própria; nada de exiftool,
que não está instalado no Mac, nem serviço externo). BRAW nativo fica fora: o FFmpeg não lê, e o SDK da Blackmagic é
item próprio se a NewStudios passar a gravar em BRAW.

## 4. Aceite (do FB-0185)

Amostras das 5 origens detectadas e convertidas sem intervenção; 0 pergunta ao Thales; amostra sem metadado gera 1
pergunta ao gestor e não repete no 2º arquivo nem no 2º projeto do mesmo cliente; gate reprova "rec709 presumido" em
bruto que parece LOG; `npm run typecheck` e `npm test` verdes.

## 5. Dúvidas para o lead

1. Ordem: entra depois do BL-0153 (03 v8 até 06/11) ou passa na frente? Sugiro P1 + P2 logo depois, porque o risco de
   repetir o erro da eq2210 existe a cada câmera nova.
2. Quem grava as amostras de 5 s (iPhone HLG, iPhone Apple Log, Android) na NewStudios.
