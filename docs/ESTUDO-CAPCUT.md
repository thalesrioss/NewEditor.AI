# Estudo: como o CapCut Web é construído, e o que levar para o NewEditor

*2026-10-10.* Fontes, marcadas em cada ponto:
- **[observado]**: o que o editor web (capcut.com/editor) carrega e guarda num navegador comum, sem login e sem enviar mídia. Olhei só nomes de recursos, recursos do navegador e a interface. Não baixei, abri nem desofusquei código deles.
- **[web.dev]**: o estudo de caso oficial do CapCut com o Google ([web.dev/case-studies/capcut](https://web.dev/case-studies/capcut)).
- **[comunidade]**: o formato de projeto, descrito por projetos abertos de engenharia reversa ([pyCapCut](https://github.com/GuanYixuan/pyCapCut), [schema do draft_content.json](https://cdn.jsdelivr.net/npm/capcut-cli-david@2.5.0/docs/draft-schema/README.md)).

---

## 1. Como o CapCut Web funciona

### Um motor só, em todas as plataformas
- O motor de edição é C++, o mesmo do app de celular e do desktop. Ele é compilado para WebAssembly com Emscripten. Efeitos, edição e mais de 1 milhão de templates vieram junto. **[web.dev]**
- No navegador, o motor aparece como `vesdk-lvapi-opt.js`, mais um worker `vesdk-lvapi-opt.worker.mjs` e dois `*.module.wasm`. "VESDK" é o SDK de edição de vídeo da ByteDance e "LV" é o nome interno do Jianying/CapCut. **[observado]**
- O worker do motor sobe **12 vezes**, um pool de threads. A página roda com `crossOriginIsolated = true` (cabeçalhos COOP/COEP), o que libera `SharedArrayBuffer`: são threads de verdade do WebAssembly, não workers isolados. **[observado]**
- Com SIMD, o processamento ficou cerca de **300% mais rápido**. Trocar as exceções de JavaScript pelas exceções nativas do WebAssembly reduziu o pacote em **15%**. **[web.dev]**

### Decodificação e codificação de vídeo: WebCodecs
- A decodificação e a codificação usam **WebCodecs** acelerado por hardware, e não o `<video>` do navegador. Isso permite **vários 4K simultâneos** e os formatos H.264, HEVC, VP8, VP9 e AV1. **[web.dev]**
- O problema que isso resolveu: mesmo com decodificador SIMD em WebAssembly, um quadro 4K levava dezenas de ms, inviável com várias trilhas. **[web.dev]**

### Tudo o que aparece na tela passa pelo motor
- As fontes vêm empacotadas por idioma (`en/ja/ko/th/zh.ttf.zip`, `minority_languages.zip`). O texto é desenhado pelo motor, não pelo CSS do navegador, e por isso sai igual no celular, no desktop e no export. **[observado]**
- Os modelos de áudio também rodam no navegador: `rnnoise_v2.0.3.model` (redução de ruído RNNoise) e `audio_metrics_v1.4.model`. **[observado]**
- Os presets de cor ficam em `adjustment-preset.png` (LUT em imagem). **[observado]**

### Carregamento e armazenamento
- O pré-carregamento é agressivo e acontece antes de abrir o editor: `wasmPreloader`, `prefetchEditorResources`, `draftPreload`, `templatePreload`, e a descompactação roda num worker (`warmupUnzipitWorker`). **[observado]**
- O motor, os modelos e as fontes ficam guardados no **Cache Storage** (`cache_manager`). Na segunda visita, nada disso é baixado de novo. **[observado]**
- Os rascunhos ficam em **IndexedDB**: `lvweb-offline-data` para trabalhar offline e `lv-ever-cloud` para sincronizar com a nuvem. O cliente da nuvem também é WebAssembly (`ever_cloud_sdk/*.wasm`). **[observado]**
- O app é instalável como PWA. **[web.dev]**

### O formato de projeto (o "draft")
- O projeto é um JSON (`draft_content.json`) organizado em **trilhas → segmentos → materiais**. **[comunidade]**
  - Cada segmento tem `source_timerange` (o trecho do material) e `target_timerange` (onde ele cai na timeline). A diferença entre os dois vira velocidade.
  - Os tempos são em **microssegundos**, as posições são normalizadas de −1 a 1 a partir do centro e os IDs são UUID.
  - Os materiais ficam num **pool separado**. O segmento aponta para eles e para "materiais extras" (velocidade, canvas, canal de áudio, animação, cor) por `extra_material_refs`.
- O formato muda entre versões (o 8.x usa `draft_info.json`) e não tem especificação oficial. **[comunidade]**

### Legendas (a interface)
- Há quatro jeitos de criar legenda: automática (recurso pago), manual, importar `.srt`/`.ass`/`.lrc` e letras de música. **[observado]**
- O painel de legendas é uma **lista editável como um documento**. Cada legenda tem tempo, texto, ▶ e apagar. Os atalhos: **Enter** divide no cursor, **⌫ no começo** junta com a de cima, **Delete no fim** junta com a de baixo. **[observado]**
- O painel também tem **encontrar e substituir** em todas as legendas, exportar o arquivo e traduzir. **[observado]**
- Na timeline, a trilha de legenda tem um bloco por legenda, com alças para ajustar o tempo. O texto também é editável direto no player. **[observado]**

---

## 2. CapCut × NewEditor

| | CapCut Web | NewEditor hoje |
|---|---|---|
| Motor | C++ → WebAssembly, o mesmo em todas as plataformas | TypeScript (núcleo puro) + FFmpeg no servidor + Chrome headless para texto e motion |
| Preview = export | Garantido: o mesmo motor desenha os dois | Garantido em texto, motion, lettering, LUT de cor e SFX (mesmas funções). O vídeo **não**: no preview são dois `<video>`, no export são filtros do FFmpeg |
| Decodificação no preview | WebCodecs (por hardware, quadro exato, várias trilhas 4K) | `<video>` sobre proxies de 540p; o corte é feito no relógio do Web Audio |
| Threads | Pool de 12 com memória compartilhada | Trabalho pesado no servidor (FFmpeg, ASR); o navegador faz pouco |
| Texto | Fontes empacotadas, desenhadas pelo motor | Fontes do Mac (Montserrat, IvyOra…) via Chrome. **Isso quebra num servidor da NewContent** |
| Projeto | Trilhas → segmentos → materiais, em µs, com pool de materiais | Clipes magnéticos + overlays presos à fala + ajustes presos a palavras (decupagem, legenda, grafia) |
| Offline/cache | Cache Storage + IndexedDB, PWA | Tudo no servidor local |
| Inteligência | Efeitos e modelos genéricos | Decupagem, leitura da história, motions narrativos e revisão humana. **Aqui o NewEditor está na frente** |

O projeto do CapCut é pensado para edição manual. O nosso é pensado para o agente editar e o humano revisar: cortes, overlays, legenda e grafia ficam presos à fala. Isso é uma vantagem e deve ser mantido.

---

## 3. O que levar para o NewEditor (por prioridade)

### Feito nesta rodada
- **Legendas editáveis como no CapCut:**
  - trilha **LG** na timeline;
  - lista editável com Enter, ⌫ e Delete;
  - encontrar e substituir num único desfazer;
  - apagar e restaurar;
  - voltar ao automático;
  - exportar `.srt`.
- **Diferença em relação ao CapCut:** a legenda continua derivada da fala, e cada ajuste fica preso à palavra do bruto. Se a decupagem mudar, as edições não se perdem.

### P1: preview com WebCodecs e um compositor WebGL único
O ganho é preview com quadro exato, várias trilhas sem engasgar e o fim do truque dos dois `<video>`.
- **Como:**
  - `mp4box.js` para separar o vídeo em amostras;
  - `VideoDecoder` para decodificar;
  - um canvas WebGL que já existe (`GradeCanvas`) para compor fala, B-roll, LUT e camada de texto num único lugar.
- **Custo:** alto, porque reescreve o Player. Vale fazer **antes** de entrar na NewContent, porque é a base de tudo o que for visual.

### P1: fontes empacotadas
Levar no projeto as fontes livres (OFL) que os estilos usam, como Montserrat, Playfair Display, Bebas Neue, Anton e Inter, carregadas com `@font-face`. Com isso:
- o export funciona em qualquer máquina, inclusive no servidor da NewContent;
- o preview fica idêntico ao export fora do Mac.

As fontes comerciais (IvyOra, FreightBig) só entram com licença. Baixar as fontes livres depende do seu ok.

### P2: export pelo mesmo compositor (preview = export também no vídeo)
- **Como:** o export desenha cada quadro no compositor WebGL, codifica com `VideoEncoder` e o FFmpeg só junta áudio e vídeo. É o princípio do CapCut aplicado ao nosso caso: um motor só.
- **Trade-off:** o render passa a depender do navegador (headless). Hoje o FFmpeg corta os segmentos por cópia e é muito rápido. Precisa medir antes de decidir.

### P2: exportar para o CapCut (`draft_content.json`)
O agente decupa, revisa e finaliza no NewEditor, e o editor que trabalha no CapCut abre o projeto lá para os retoques finais. Os cortes viram segmentos com `source_timerange`/`target_timerange` e as legendas viram uma trilha de texto.
- **Risco:** o formato não tem especificação oficial e muda de versão. A comunidade recomenda clonar um rascunho real como molde. Funciona como ponte, não como base.

### P2: cache e offline
O PWA usa Cache Storage para os recursos do editor e IndexedDB ou OPFS para guardar proxies e rascunhos no navegador. Isso importa quando o NewEditor rodar dentro da NewContent, na nuvem e com mídia pesada: o editor abre na hora e não baixa o proxy de novo a cada sessão.

### P3: redução de ruído da voz
- O CapCut roda RNNoise no navegador. O nosso FFmpeg tem o filtro `arnndn`, que usa os modelos RNNoise abertos. Uma chave "Limpar ruído da voz" no export é um ganho rápido.
- **Pendências:**
  - baixar o modelo `.rnnn`, que depende do seu ok;
  - medir no seu áudio de lapela, porque redução de ruído pode deixar a voz metálica.

### P3: importar legenda (`.srt`/`.ass`)
Hoje só exportamos. Importar seria útil quando o cliente manda a legenda pronta: cada bloco do `.srt` vira um ajuste de texto preso às palavras daquele trecho.

### O que não copiar
- **Portar um motor C++:** foi a saída do CapCut porque eles já tinham o motor em quatro plataformas. Para nós, o equivalente é o núcleo TypeScript puro, que já roda igual no preview e no export.
- **Recursos pagos:** a legenda automática deles é paga. A nossa (mlx-whisper local) já é melhor para português e não custa nada.

---

## Fontes
- [web.dev: CapCut com WebAssembly e WebCodecs](https://web.dev/case-studies/capcut)
- [pyCapCut (formato de rascunho, comunidade)](https://github.com/GuanYixuan/pyCapCut)
- [Schema do `draft_content.json` (comunidade)](https://cdn.jsdelivr.net/npm/capcut-cli-david@2.5.0/docs/draft-schema/README.md)
- [Série "Como fazer um Jianying web" (WebCodecs, timeline, salto preciso de quadro)](https://pipe.b3log.org/blogs/wilsons/articles/2025/04/05/1743788129228)
