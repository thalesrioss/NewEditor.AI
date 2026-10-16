# ADR-005: Motor único de composição (WebCodecs + WebGL), no padrão do CapCut

**Status:** Aceito (2026-10-10)
**Data:** 2026-10-10
**Decisores:** Thales Rios
**Base:** [docs/ESTUDO-CAPCUT.md](../ESTUDO-CAPCUT.md)

## Contexto

A ADR-002 garantiu que texto, motion, lettering, LUT e SFX saiam iguais no preview e no export, porque usam as mesmas funções. O **vídeo** ainda tem dois motores:
- **Preview:** dois `<video>` em revezamento. A troca acontece quando o navegador deixa, o salto não cai no quadro exato e o B-roll é outro `<video>` solto.
- **Export:** filtros do FFmpeg.

O CapCut resolveu isso com **um motor só** (o mesmo motor nativo, compilado para WebAssembly), vídeo por **WebCodecs** e tudo **empacotado**: fontes, modelos e presets. O Thales aprovou seguir esse caminho (2026-10-10), sem export para o CapCut.

## Decisão

1. **Preview com WebCodecs.** Os proxies (H.264, índice no começo, quadro-chave a cada 0,25 s) são lidos por partes (HTTP Range) por um demuxer MP4 próprio, sem dependência nova. O vídeo é decodificado por `VideoDecoder` e o áudio por `AudioDecoder`, os dois com aceleração do navegador.
2. **Compositor WebGL único:** fala, zoom, B-roll e o LUT de cor de cada arquivo são desenhados num canvas só, no quadro exato da timeline. A camada de texto (legenda, lettering, motion) continua por cima, com o mesmo HTML do export.
3. **Áudio agendado por segmento:** cada trecho mantido da fala vira um `AudioBufferSourceNode` agendado no tempo exato, com as mesmas rampas de 5 ms do export. O corte é exato por amostra. Trilha e SFX entram no mesmo relógio.
4. **O motor antigo fica como reserva** (navegador sem WebCodecs, ou erro). Ele deve ser removido depois que o novo se provar.
5. **Próximos passos desta ADR:**
   - (a) **fontes livres empacotadas** (OFL), carregadas por `@font-face`, para o export não depender do Mac;
   - (b) **export pelo mesmo compositor** (WebGL em headless + `VideoEncoder`), decidido só depois de medir contra o FFmpeg;
   - (c) **cache e offline:** os recursos do editor no Cache Storage, rascunhos e proxies no IndexedDB/OPFS.

## Consequências

- **Fica mais fácil:**
  - preview com quadro exato, inclusive ao pular e em pausa;
  - várias trilhas de vídeo;
  - o caminho para o export sair do mesmo compositor.
- **Fica mais difícil:** o player passa a cuidar do próprio relógio, dos buffers e da memória dos quadros. É preciso fechar cada `VideoFrame` no momento certo.
- **Para rever:**
  - suporte a HEVC no `VideoDecoder`, se um dia o proxy deixar de ser H.264;
  - o tamanho do cache de áudio decodificado em vídeos longos.

## Medição: export pelo mesmo compositor × FFmpeg (2026-10-10)

Teste: 20 s (480 quadros) do bruto `TRS20260807_0301.MP4`, em HEVC 4:2:2 10-bit, 4K, S-Log3 full range, girado. A saída é 1080×1920 com a correção de cor do projeto, num MacBook com M5 Pro e Chrome 154 headless.

| Caminho | Tempo | Vazão | Gargalo |
|---|---|---|---|
| Compositor (WebCodecs HW + WebGL + `VideoEncoder` HW, 16 Mbps) | 1,97 s | 244 fps | codificador (o proxy H.264 dá os mesmos ~230 fps) |
| FFmpeg atual (VT decode + escala/LUT na CPU + x264 veryfast crf17) | 5,97 s | 80 fps | escala + LUT na CPU |
| FFmpeg com codificador VT | 5,53 s | 87 fps | escala + LUT na CPU |

**Cor (PSNR RGB, comparando as saídas reduzidas):**
- prévia de hoje (proxy no compositor) × export FFmpeg: **38,2 dB**. Hoje estão coerentes.
- compositor lendo o bruto × prévia: **26,2 dB**. O Chrome respeita o "full range" do HEVC da Sony, e o proxy H.264 é lido como "limited". A correção de cor foi ajustada em cima da leitura do proxy.
  - Forçar `colorSpace` no `VideoDecoderConfig` não muda nada.
  - Um ajuste afim (3×4) depois do LUT leva a **39,6 dB**. A correção tem que entrar no shader, antes do LUT, e ser validada para cada formato de câmera.

**Codificador** (SSIM contra uma referência sem perdas): x264 crf17 em ~4 Mbps = 0,9889; VT em 16 Mbps = 0,9917. O hardware precisa de ~4× a taxa para empatar.

**Formatos:** o outro projeto (`prj_mv1tcs9p1vslt`) usa ProRes LT 4:2:2 10-bit, que o WebCodecs não decodifica. O export só pelo compositor não cobriria esse material.

### Decisão (5b)

- **O export continua no FFmpeg por enquanto.** Ele aceita qualquer formato (ProRes incluso), sua cor bate com a prévia e o x264 dá o mesmo resultado com ¼ do tamanho.
- O compositor fica como **caminho rápido opcional, para H.264/HEVC**, depois de três passos:
  - (1) correção de níveis no shader, validada contra a prévia (meta ≥ 38 dB);
  - (2) camada de texto desenhada na mesma página, sem screenshot por quadro;
  - (3) taxa ~16 Mbps.
  - Ganho esperado: cerca de 3× na parte de vídeo.
- O compositor já ganhou suporte a rotação (`Layer.rotate`) e o demuxer, a HEVC (`hvcC`). Os dois servem tanto para esse caminho quanto para tocar originais no preview.
- **Testado e deixado para depois:** escala/rotação na GPU dentro do FFmpeg (`scale_vt`/`transpose_vt`) deu 1,5× (3,98 s), mas a rotação saiu errada no FFmpeg 9.0.1.
