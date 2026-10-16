# Estudo: as funções do CapCut, o que o Editor Brain tem, e como cada uma vira informação para o agente

*2026-10-12.* Pedido do Thales: a personalização de legenda igual à deles; as configurações de cor também (mantendo o que já é melhor no nosso: a conversão de LOG); camadas infinitas; formato em pixels personalizável; transições e efeitos, que não temos; a aba de motion continua como está (Motion Studio), só menos apertada. E tudo isso virando **informação que o agente usa para editar**.

Fonte: a interface do CapCut (desktop e web), a estrutura do app em `docs/ESTUDO-CAPCUT-DESKTOP.md` (pastas `Curves`, `PrimaryWheel`, `LogWheel`, `Chroma`, `MixMode`, `lut`, `matting*`, `lvop_intelligent_crop`, `SceneEditDetection`) e o nosso código. Decisões e ordem de implementação na ADR-011.

Princípio que vale para tudo: no CapCut cada função é um **controle para o humano**. No Editor Brain cada função precisa existir em **três lugares**: no modelo (uma operação da timeline), na interface (o editor mexe) e no **conhecimento** (o agente sabe quando usar e o QC sabe quando está errado). Uma função sem a terceira parte é só um botão.

---

## 1. Legenda (personalização)

### O que o CapCut tem
Fonte (biblioteca por idioma), tamanho, cor, opacidade, negrito/itálico/sublinhado, alinhamento, **espaçamento entre letras e entre linhas**, **contorno** (cor, largura), **sombra** (cor, opacidade, desfoque, distância, ângulo), **fundo/tarja** (cor, opacidade, raio dos cantos, margem interna), posição/escala/rotação no quadro, **destaque da palavra falada** (cor, animação por palavra), **animação de entrada/saída/loop** por bloco, "aplicar a todas", templates de texto, e a lista editável (dividir, juntar, buscar e substituir, exportar).

### O que temos
Em `CaptionSettings`: estilo (reels/frase/karaokê…), fonte (das empacotadas), peso, itálico, tamanho, cor, acento (palavra falada), posição X/Y, largura, palavras e caracteres por bloco, caixa alta, espaçamento de letras, entrelinha, contorno (largura e cor), sombra (0–1), tarja (cor, opacidade); presets; lista editável com os atalhos do CapCut; o mesmo HTML no preview e no export.

### O que falta para ficar igual
- Sombra com **cor, desfoque, distância e ângulo** (hoje é uma intensidade só).
- Tarja com **raio dos cantos e margem interna**.
- **Rotação e escala** do bloco (hoje só posição e largura).
- **Animação** de entrada/saída por bloco (pop, slide, fade, máquina de escrever) e do destaque da palavra (escala, cor, fundo na palavra).
- **Opacidade** do texto.
- Sublinhado.
- Templates de legenda como **cartões com prévia** (hoje são nomes).

### O que vira informação para o agente
- `CaptionSettings` já é o dado que o padrão editorial guarda (`legenda.ajustes`, ADR-010). Os campos novos entram nele e passam automaticamente para o perfil do cliente.
- Regra editorial para o perfil: `legenda.animacao` (nenhuma / palavra / bloco) e o teto de "quanta animação por minuto"; o QC avisa quando a legenda animada briga com lettering ou motion no mesmo trecho (já existe a regra de esconder a legenda sob camadas).

---

## 2. Cor

### O que o CapCut tem
**Básico:** temperatura, matiz, saturação, exposição, brilho, contraste, realces, sombras, brancos, pretos, nitidez, clareza, vinheta, granulado, fade. **HSL** por faixa de cor (8 matizes: matiz, saturação, luminância). **Curvas** (luma, R, G, B). **Rodas de cor** (lift/gamma/gain, como no DaVinci; a pasta `PrimaryWheel` e `LogWheel`). **LUT** importada (`lut-import`). **Filtros** de biblioteca. **Auto ajuste** e **combinar cor** entre clipes. Chroma key (`Chroma`), remoção de fundo (`matting`).

### O que temos
`ColorGrade`: transformação de entrada (**LOG → Rec.709 por câmera**, com detecção automática do LOG: `guessInput`), exposição, contraste, realces, sombras, brancos, pretos, temperatura, matiz, saturação, vibrância; LUT de preview no WebGL igual à do export; "antes/depois"; o agente faz a cor automática na finalização.

### O que falta
- **Nitidez, clareza, vinheta, granulado, fade.**
- **HSL por matiz.**
- **Curvas.**
- **Rodas de cor** (lift/gamma/gain), com a roda LOG separada como eles.
- **LUT importada** (.cube) como passo da cadeia, depois da conversão de entrada.
- **Combinar cor** entre a fala e a 2ª câmera (temos `syncCam`; falta igualar a cor).
- Chroma key e remoção de fundo ficam fora por ora (não são o nosso vídeo).

### O que é melhor no nosso e não muda
A **conversão de LOG** por câmera, medida no arquivo (S-Log3, V-Log, C-Log, HLG…), antes de qualquer ajuste. No CapCut o usuário escolhe uma LUT no escuro. Aqui o agente mede, converte e só depois ajusta; a cadeia nova (HSL, curvas, rodas, LUT) entra **depois** dessa conversão.

### O que vira informação para o agente
- `cor.grade` no perfil já guarda a correção inteira (ADR-010); com rodas/curvas/HSL dentro de `ColorGrade`, o padrão do cliente carrega o "look" dele e o agente aplica em qualquer bruto da mesma câmera.
- Regra: a cor automática mede exposição e balanço do bruto e aplica o look do perfil **relativo** (não copia valores absolutos). O QC mede pele e pretos depois da correção (já existe a medição de `signalstats`).

---

## 3. Camadas infinitas

### O que o CapCut tem
Trilhas ilimitadas de vídeo/overlay, texto e áudio; cada segmento com opacidade, **modo de mesclagem** (`MixMode`: multiply, screen, overlay…), máscara, escala/posição/rotação, keyframes; a trilha principal é magnética, as outras são livres.

### O que temos
Trilha principal magnética (fala) + V2 (B-roll), V3 (lettering/motion), A2 (SFX), A3 (trilha), LG (legenda). Fixas, uma por papel.

### O que falta
- **Adicionar trilhas** (V4, V5… A4…) com papel escolhido; mover camadas entre trilhas do mesmo tipo (`move_overlay` já aceita `trackId`).
- **Transformação por camada**: opacidade, escala, posição, rotação (hoje o B-roll é sempre tela cheia e o motion vem pronto do Studio).
- **Modo de mesclagem** (pelo menos multiply, screen, overlay, add) para efeitos de luz e textura.
- Keyframes de transformação (a longo prazo; o motion do Studio já cobre o que é animado).

### O que vira informação para o agente
- O agente decide **em que trilha** cada coisa entra pela hierarquia do perfil (`camadas.ordem`: fala < B-roll < motion < lettering < legenda), igual ao padrão de trilhas do Thales no DaVinci (memória 06 do Cérebro).
- Regra de empilhamento: lettering nunca sob motion; B-roll com opacidade < 1 só em "tela dividida"; o QC bloqueia trilha de vídeo oculta com camadas dentro.

---

## 4. Formato em pixels personalizável

### O que o CapCut tem
Proporção (16:9, 9:16, 1:1, 4:3, 3:4, 21:9) e **tamanho em pixels livre**; resolução e fps escolhidos no export.

### O que temos
Formato definido pelo primeiro vídeo (`store.setFormat`), 1080×1920 por padrão; o Gestor lê "reels/shorts/youtube" da tarefa; o export segue a timeline.

### O que falta
- **Escolher na criação** e **mudar depois** (operação `set_format` com largura, altura e fps, no histórico): presets (1080×1920, 1920×1080, 1080×1080, 1080×1350, 3840×2160) e campos livres.
- **Reenquadrar ao mudar** (temos o reframe pelo rosto: aplicar automaticamente quando a proporção muda).
- Export com resolução e fps diferentes da timeline (hoje é 1:1).

### O que vira informação para o agente
- `FORMATOS_PECA` ganha largura/altura por formato e o **perfil por formato** (ADR-010) já liga formato → padrão editorial. O agente, ao receber "Reels" na tarefa, cria 1080×1920 e usa o padrão Reels do cliente; ao receber "YouTube", 1920×1080 e o padrão YouTube.
- Regra: ao mudar o formato de um projeto já editado, o agente refaz reframe, altura de legenda e posição de lettering (as alturas são relativas, então sobrevivem).

---

## 5. Transições

### O que o CapCut tem
Biblioteca (dissolve, fade para preto/branco, cortina/wipe, deslizar, zoom, desfoque, glitch, giro, luz, "smooth cut"…), duração por transição, **aplicar a todas**, arrastar para a emenda.

### O que temos
Corte seco; flash de 2 quadros na entrada (o "cut" do Thales); smooth-cut como campo do perfil (`corte.transicao`) sem implementação.

### O que falta
- Operação `set_transition` na emenda entre dois clipes da fala: tipo, duração, SFX; render no FFmpeg (`xfade` cobre dissolve, fade, wipes, slides, zoom, blur; smooth-cut = morph entre quadros, pode ficar para depois) e no preview (mesmo motor).
- Biblioteca pequena e **nossa**, nada de 200 opções: corte seco, flash, dissolve, fade preto/branco, desfoque, deslizar, zoom.

### O que vira informação para o agente
- **Vocabulário de transição** com função narrativa: corte seco = continuidade de fala; flash = ênfase/zoom; dissolve = passagem de tempo ou de assunto; fade preto = fim de bloco; desfoque/zoom = entrada de B-roll ou de lista. É o mesmo desenho das funções narrativas dos motions (`NARRATIVE_FUNCTIONS`).
- No perfil: `transicoes.permitidas`, `transicoes.padraoNaFala` (seco), `transicoes.entreBlocos` (dissolve 8 f, por exemplo). O QC avisa transição onde não cabe (dissolve no meio de uma frase).

---

## 6. Efeitos

### O que o CapCut tem
Efeitos de vídeo como camadas com duração (glitch, desfoque, tremor, vazamento de luz, retrô, VHS, zoom pulsante, partículas…), efeitos de corpo/rosto, e uma **camada de ajuste** que afeta tudo abaixo.

### O que temos
Flash (2 quadros invertidos), zoom (fixo e animado), freeze, velocidade; motions com matéria pelo Motion Studio.

### O que falta
- `OverlayRole` `efeito`: uma camada com tipo e duração, presa à fala como as outras. Primeiros efeitos, todos renderizáveis no FFmpeg e no WebGL: tremor (shake), zoom pulsante, desfoque, vazamento de luz, vinheta pulsante, glitch leve, preto e branco, grão.
- **Camada de ajuste** (cor aplicada a um trecho, não ao arquivo inteiro): o mesmo `ColorGrade` preso a um intervalo.

### O que vira informação para o agente
- Cada efeito nasce com a **função narrativa** e o **custo de atenção** (quanto distrai): tremor = impacto/erro; glitch = quebra/revelação; desfoque = memória/transição; P&B = passado/contraste; zoom pulsante = batida da trilha. Teto por minuto no perfil (`efeitos.porMinuto`), como já existe para lettering e zoom.
- Regra de ouro (DNA editorial): efeito **sempre com motivo na fala**; nunca em cima de motion do Studio; o QC bloqueia efeito sem `reason`.

---

## 7. Motion (fica como está)

Os motions continuam vindo do Motion Studio (cenas com alfa, originais, QC do Studio). Só a aba: hoje o cartão do Studio e a lista de cenas disputam o espaço com "Neste vídeo" e "Referências". Proposta: o painel de recursos abre com largura maior para a aba Motion (lembrada), o cartão do Studio vira um cabeçalho fixo e as cenas uma lista com a contact sheet maior.

---

## 8. O que mais o CapCut tem (e o que fazemos com isso)

| Função | O que é | Para nós |
|---|---|---|
| Keyframes | animar escala/posição/opacidade por camada | depois das camadas; o Studio já anima o que importa |
| Máscaras | recortes por forma com suavização | com as camadas, para tela dividida com forma |
| Chroma key / remoção de fundo | recorte de pessoa | não é o nosso vídeo (talk head) — fora |
| Estabilização | — | só se o bruto precisar; FFmpeg `vidstab` |
| Velocidade por curva | rampas | temos velocidade fixa + freeze; rampa só por pedido |
| Redução de ruído, efeitos de voz, TTS | — | temos RNNoise e cadeia de voz; TTS fora |
| Detecção de batida | marca na trilha | temos a análise da trilha (`music-analysis`): expor as batidas na régua |
| Corte inteligente de cena (`SceneEditDetection`) | corta por mudança de imagem | nosso corte é pela fala; usar só para B-roll bruto |
| Recorte inteligente (`lvop_intelligent_crop`) | reframe automático | temos reframe pelo rosto; ligar ao formato (seção 4) |
| Stickers, templates, loja | — | não (ADR-008: o padrão é do editor) |

## 9. Como isso vira conhecimento no Cérebro

Além do código (ops, perfil, QC), o vocabulário acima entra no Cérebro do Editor como nota de ofício (`_SISTEMA/VOCABULARIO - Ferramentas e quando usar.md`), para o agente local e o grafo em `#/cerebro` lerem. É a camada **ofício** (vale para toda conta); o que é gosto do Thales continua nos padrões dele.
