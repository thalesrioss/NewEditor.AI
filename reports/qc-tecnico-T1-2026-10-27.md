# T1 do qc-tecnico: gate retroativo nos 20 finais da série Leandro (eq2210), 27/10/2026

Frente Q3 da força-tarefa de qualidade (plano `PLANO-QUALIDADE-EM-MASSA-2026-10-27.md`, 2.A item 4 e seção 3/T1).
Código: `apps/server/src/qc-tecnico.ts` (gate), `apps/server/src/qc-tecnico-cli.ts` (linha de comando), testes em `apps/server/src/qc-tecnico.test.ts`.

## Como foi rodado
- Arquivo: para cada `~/newstudios/producao/equity-sales/2210-leandro-reels/eq2210-NN/entrega/`, a versão mais alta `*_vN.mp4`. A 19 v1 entrou à parte, sem projeto, para a câmera lenta.
- Projeto: `~/newstudios/editor-brain/data/projects/*/project.json`, casado pelo `eq2210-NN` no nome do projeto (20 de 20 encontrados). É o estado atual do projeto: nas 20, a duração da timeline bate com a da entrega (o gate avisa quando não bate, e nenhum aviso apareceu).
- Assinatura de cor: os 4 aprovados do Leandro em `/Volumes/Thales SSD/Clientes/Equity Sales/Editados/Leandro Arruda/` (fonte: `RELATO-QUALIDADE/studio-revisor-2.md` e `curadoria/clientes/equity-sales.md`). Medida guardada em `reports/qc-tecnico-assinatura-leandro.json`, para não depender do SSD. SATAVG no centro do quadro: 14,8 / 10,0 / 8,3 / 9,1. Vale o menor (8,3), e o limite fica em 0,7 × 8,3 = 5,8. O Igor mediu 7 a 12 com outro recorte; o gate mede os aprovados e as entregas com o mesmo recorte. Ressalva da curadoria: esse padrão de formato foi reprovado em 26/10 (P-0038), mas a cor dos 4 continua sendo a única régua aprovada pelo cliente.
- Comando, por reel:
  `npm run qc-tecnico -- <entrega.mp4> --project <project.json> --assinatura-json reports/qc-tecnico-assinatura-leandro.json`
  Cada reel leva cerca de 5 s.
- Conferência de falso positivo: os 4 aprovados passam em todas as regras (perfil, níveis, saturação, freeze, cadência). Só falham no fps, porque são 23,976 e o alvo é 29,97: com o fps deles, passam inteiros.

## Resultado: 20 de 20 reprovados
| Reel | Arquivo | Perfil (etiquetas fora) | Níveis (Y fora de 16–235) | Saturação (SATAVG, × assinatura) | Freeze sob fala | Câmera lenta | Escala máx. | Boca de outro momento | Corte embutido | Sync câmera | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | 01_v2.mp4 | pix_fmt=yuvj420p, color_range=pc, colorspace=ausente, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 11,15% **reprova** | 2,2 (0,27×) **reprova** | ok | ok | 1,00× | **1** (18,10 s) | ok | sem câmera | **reprova** |
| 02 | 02_v6.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,18%  | 4,6 (0,56×) **reprova** | ok | ok | 1,12× | ok | ok | **1 câm.** | **reprova** |
| 03 | 03_v6.mp4 | pix_fmt=yuvj420p, color_range=pc, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 5,23% **reprova** | 6,4 (0,77×) | ok | ok | 1,15× | **1** (3,40 s) | ok | sem câmera | **reprova** |
| 04 | 04_v2.mp4 | pix_fmt=yuvj420p, color_range=pc, colorspace=ausente, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 15,68% **reprova** | 5,5 (0,66×) **reprova** | ok | ok | 1,00× | **2** (9,81; 10,99 s) | ok | sem câmera | **reprova** |
| 05 | 05_v3.mp4 | color_range=ausente, colorspace=ausente, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,17%  | 4,9 (0,59×) **reprova** | ok | ok | 1,12× | ok | ok | **2 câm.** | **reprova** |
| 06 | 06_v2.mp4 | pix_fmt=yuvj420p, color_range=pc, colorspace=ausente, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 22,78% **reprova** | 2,8 (0,34×) **reprova** | ok | ok | 1,00× | **1** (18,91 s) | ok | sem câmera | **reprova** |
| 07 | 07_v2.mp4 | pix_fmt=yuvj420p, color_range=pc, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 24,58% **reprova** | 3,6 (0,43×) **reprova** | ok | ok | 1,00× | **1** (22,72 s) | ok | sem câmera | **reprova** |
| 08 | 08_v4.mp4 | color_range=ausente, colorspace=ausente, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,16%  | 5,6 (0,67×) **reprova** | ok | ok | 0,80× | ok | **1** (15,12 s) | **1 câm.** | **reprova** |
| 09 | 09_v2.mp4 | pix_fmt=yuvj420p, color_range=pc, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 8,47% **reprova** | 6,3 (0,75×) | ok | ok | 1,15× | **3** (24,91; 39,06; 6,78 s) | ok | sem câmera | **reprova** |
| 10 | 10_v2.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,14%  | 3,9 (0,47×) **reprova** | ok | ok | 1,00× | **1** (31,93 s) | ok | sem câmera | **reprova** |
| 11 | 11_v2.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,21%  | 3,9 (0,47×) **reprova** | ok | ok | 0,80× | ok | **3** (3,87; 8,81; 8,94 s) | **3 câm.** | **reprova** |
| 12 | 12_v2.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,19%  | 3,7 (0,45×) **reprova** | ok | ok | 1,00× | **2** (2,87; 4,57 s) | ok | sem câmera | **reprova** |
| 13 | 13_v2.mp4 | pix_fmt=yuvj420p, color_range=pc, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 12,96% **reprova** | 3,8 (0,46×) **reprova** | ok | ok | 1,15× | **3** (13,13; 16,47; 48,75 s) | ok | sem câmera | **reprova** |
| 14 | 14_v2.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,21%  | 5,4 (0,65×) **reprova** | **1** (0,07 s) | ok | 0,84× | **2** (11,20; 0,30 s) | ok | **2 câm.** | **reprova** |
| 15 | 15_v4.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,12%  | 4,0 (0,48×) **reprova** | ok | ok | 1,00× | ok | **2** (5,81; 6,27 s) | sem câmera | **reprova** |
| 16 | 16_v3.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,17%  | 5,6 (0,68×) **reprova** | ok | ok | 0,80× | **1** (3,60 s) | ok | **3 câm.** | **reprova** |
| 17 | 17_v2.mp4 | pix_fmt=yuvj420p, color_range=pc, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 23,75% **reprova** | 6,1 (0,73×) | ok | ok | **1,30×** (18,64; 18,92; 20,05 s) | **1** (18,63 s) | ok | sem câmera | **reprova** |
| 18 | 18_v2.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,16%  | 2,9 (0,35×) **reprova** | ok | ok | 1,00× | ok | **3** (11,34; 13,88; 21,19 s) | sem câmera | **reprova** |
| 19 | 19_v2.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,17%  | 5,0 (0,60×) **reprova** | ok | ok | 0,80× | **1** (24,84 s) | ok | **2 câm.** | **reprova** |
| 20 | 20_v1.mp4 | pix_fmt=yuvj420p, color_range=pc, color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 17,19% **reprova** | 5,9 (0,70×) | **2** (11,18; 11,48 s) | ok | **1,50×** (11,36; 11,18; 14,50 s) | **1** (11,18 s) | ok | sem câmera | **reprova** |
| 19-v1 | 19_v1.mp4 | color_primaries=ausente, color_transfer=ausente, fps=2997/100 | 0,17%  | 5,0 (0,60×) **reprova** | ok | **1** (25,06 s) | — | — | — | — | **reprova** |

Números entre parênteses: início do trecho na peça (s). "câm." = câmeras 9:16 sem sincronia medida. Detalhe de cada achado (medido, limite, clipe e arquivo): rodar o comando acima com `--json`.

## Meta do T1
**Cor e faixa: 20 de 20 reprovam.**
- Perfil: as 20 saem sem `color_primaries` e sem `color_transfer`, e com fps `2997/100` em vez de `30000/1001`.
- 9 saem em faixa cheia (yuvj420p/pc): 01, 03, 04, 06, 07, 09, 13, 17, 20. Nessas, 5 a 25% dos pixels têm Y fora de 16–235.
- 05 e 08 saem sem nenhuma etiqueta de cor.
- Saturação abaixo de 0,7× a assinatura em 16 de 20. Ficam acima 03 (0,77×), 09 (0,75×), 17 (0,73×) e 20 (0,70×).

**Coberturas pedidas no T1: 12 de 12 acusadas, com o tempo.**

| Reel | Regra | Onde (peça) | O que o dado mostra |
| --- | --- | --- | --- |
| 01 | boca-outro-momento | 18,10–20,50 s | `C3100_cob_43s60_b` (bruto 43,77 s) sob a voz do bruto 65,19 s (Δ 21,4 s) |
| 03 | boca-outro-momento | 3,40–5,28 s (gancho do piloto) | bruto C3039 52,35 s sob a voz de 27,62 s (Δ 24,7 s) |
| 04 | boca-outro-momento (embutida) | troca em 9,81 s; clipe 10,99–14,01 s | `C3030_A_hist_cob_v2b` e `C3030_B_cob_tese_v2b`: cobertura dentro do intermediário |
| 06 | boca-outro-momento | 18,91–20,03 s | bruto C3070 10,17 s sob a voz de 5,75 s |
| 08 | corte-embutido | 15,12 s | troca de plano dentro de `C3035_cam9x16_v7` (punch-in de outro momento → close; o REVISAO v3 descreve o punch-in de bruto ~34,9 s sob "economizar"). A entrada em 14,38 s cai num corte da timeline e não aparece como troca solta |
| 09 | boca-outro-momento | 6,78 / 24,91 / 39,06 s | 3 coberturas de C3082 com Δ 21 a 71 s |
| 10 | boca-outro-momento (embutida) | trocas em 31,93 e 33,53 s | `C3036_B_62s4_cob4`: a cobertura do zoom ótico (1,6 s), como diz `intermediarios.sh` |
| 12 | boca-outro-momento (embutida) | trocas em 2,87 e 4,57 s | `C3050_A2_102s2_cob` (gancho) e `C3050_B2_86s3_cob2` |
| 13 | boca-outro-momento | 13,13 / 16,47 / 48,75 s | 3 coberturas de C3081 com Δ 5 a 62 s |
| 14 | boca-outro-momento | 0,30 s e 11,20–11,85 s | cobertura do chicote com a câmera A2 em 57,97 s sob a voz de 26,22 s; no gancho, B3 2 quadros fora (Δ 0,07 s) |
| 16 | boca-outro-momento | 3,60–5,40 s | `C3029_cam9x16_A2` em 0,99 s sob a voz de 5,78 s (cobertura do borrão) |
| 18 | corte-embutido | 11,34 / 13,88 / 21,19 s | trocas de plano dentro de `S1cp` e `S3a2p`. A de 21,19 s é o plano aberto da sala de outro instante sob "polidos aqui?" (HANDOFF v2) |

Também acusados fora da lista:
- 07: L-cut com o rosto do C3103 sob a voz do C3072, em 22,72 s.
- 15: cobertura embutida em `v3_B`, de 5,81 a 6,27 s (0,46 s; "cobertura de frente 0,43 s" na revisão).
- 11: trocas de quadro embutidas na câmera A2 em 3,87 e 8,81/8,94 s ("2 quadros congelados cada", HANDOFF).
- 17: L-cut em 18,63 s e escala 1,30×.
- 19 v2: cobertura `C3039_cam9x16_C` em 24,84 s. O PROJETO diz que é o bruto 56,95 s sob a voz de 69,00 s. O gate não tem como ler esse instante (o arquivo não tem tempo de origem no nome nem syncOffset) e reprova como "instante não verificável".
- 20: Δ 9 quadros com congelamento em 11,18 s e escala 1,50×.

**Câmera lenta do 19: acusada na v1, em 25,06–26,46 s.** São quadros repetidos a cada 3 (setpts 1,5× + fps, `edl/fg39c.txt`). Bate com o achado do Igor, "25,0–26,4".

A **v2 do 19 não tem câmera lenta**, e isso o dado mostra. A câmera A5 da v2 é em tempo real (`PROJETO.md`: "A5 (tempo real)", `cam19v2.py`). Medi a diferença quadro a quadro na entrega v2 e na própria A5, em 24,3–25,1 s e 2,4–3,3 s: nenhum quadro repetido (mínimo 1,66 na entrega, contra ~0,05 nos quadros repetidos da v1). O aviso de 27/10 ~02:00 no PROJETO ("a v2 ainda tem a câmera lenta de fg39c") não se confirma na medição. Na v2, o 19 reprova pela cobertura sem instante verificável (24,84 s) e pelas 2 câmeras com offset −66 s digitado.

## O que não acusou, e por quê
1. **Níveis nas 11 entregas em faixa tv.** Elas têm valores fora da faixa (YMIN 8–12, YMAX 244–255, como o Bento e o Ultron mediram), mas em só 0,12–0,21% dos pixels, abaixo do limite de 0,5%. A regra 2 do jeito que foi pedida não as reprova. Elas reprovam pelo perfil (primaries/transfer ausentes) e pela saturação. Se quiserem pegar esse caso, um segundo limite é possível (YMIN < 12 ou YMAX > 245 em ≥ 0,05%), mas não foi aplicado sem decisão.
2. **Saturação em 03, 09, 17 e 20** (0,70–0,77×). Medi o croma na escala tv: em faixa cheia o croma vai a ±127 e a medida é multiplicada por 224/255. Sem esse ajuste, essas 4 dariam ainda mais alto. Elas reprovam por faixa e níveis.
3. **Freezes do Ultron no 17 (8,11 s), no 18 (2,27 s) e no 20 (14,51 s).** Caem no respiro entre frases. A energia da voz desce a −40/−55 dBFS: no 17, fala até 7,95 s e de novo em 8,29 s; no 18, até 2,13 s e de novo em 2,44 s; no 20, até 14,45 s e de novo em 14,80 s. Não há fala sob o quadro parado. O freeze do 11 (11,24 s) também está sobre o ar da emenda (HANDOFF: "imagem parada 6 quadros" entre "produzidos." e "E é engraçado") e não reprova. Os do 14 (0,07 s) e do 20 (11,18 s) têm fala e reprovam.
4. **18: quadro parado do slide em 17,88–18,98 s**, com aproximação 1,00→1,06. A aproximação mexe os pixels, então o freezedetect e a cadência não veem imagem parada. Não é boca (é o slide), e o gate não acusa.
5. **Escala de dentro dos intermediários e das câmeras.** O projeto só enxerga o zoom aplicado no Editor Brain. Ficam fora o punch-in 3,2× embutido na câmera do 08, o `C3050_D2_90s4_z18` do 12 (~1,6×), o `C3091_D2_72s5_z145` do 15 (~1,3×) e as câmeras 1350×2400 que já são recortes ampliados. O gate avisa isso em todo reel com intermediário do falante. Correção de base: os brutos são 3840×2160 com rotação 90 (o projeto lê 2160×3840). Então zoom 2,0 ainda é nativo, 3,0 dá 1,5× (20) e 3,2 daria 1,6×. A conta "recorte de 1215 px, 3,0 = 2,7×" do plano vale para bruto deitado com reframe; a regra calcula os dois casos.
6. **02 e 05:** nenhuma cobertura nem corte embutido medidos. Reprovam por cor, etiqueta e câmera com offset 0 digitado.

## Como cada regra mede (para quem for mexer)
- **Perfil:** ffprobe. O fps nominal sai da timeline (29,97 → `30000/1001`). CFR = `avg_frame_rate` igual a `r_frame_rate`.
- **Níveis:** `fps=1,extractplanes=y,scale=360:-2:flags=neighbor`. É o código Y gravado, sem conversão de faixa: o teste confere que preto e branco saem 0/255 em pc e 16/235 em tv.
- **Saturação:** `signalstats` SATAVG em `crop=iw/2:ih/2`, 1 quadro/s, na escala tv.
- **Fala:** energia da voz na própria entrega (passa-faixa 150–4000 Hz, janela 20 ms) acima de max(−45, p95 − 18) dB. Vãos < 0,12 s são juntados. Trilha alta conta como fala.
- **Freeze:** `freezedetect=n=0.001:d=0.1`. Reprova com ≥ 0,15 s e ≥ 0,1 s de fala.
- **Câmera lenta:** diferença média de quadro (cinza 96×96, todos os quadros). Um quadro repetido (< 0,6) entre quadros que mexem (> 1,5), 4 ou mais vezes em 1 s, é a cadência do setpts + fps.
- **Cortes da entrega:** salto ≥ 20 que é ≥ 3× o movimento de um lado e ≥ 1,5× o do outro. Chicote e panorâmica não contam. Corte a até 3 quadros de uma borda da timeline (clipe ou overlay) é da timeline. Fora disso, dentro de um clipe, sob fala, e fora de B-roll de terceiros, vira "corte-embutido".
- **Boca de outro momento:** cobertura (broll/motion de mídia) do mesmo falante. Conta como mesmo falante o mesmo asset de um clipe principal, uma `cam`, ou o mesmo `C\d{4}` no nome. O gate compara, quadro a quadro e só onde há fala, o instante do bruto mostrado com o instante do bruto da voz. Esse instante vem do bruto original, de `_NNsD` no nome (ex. `86s3` = 86,3 s) ou do `syncOffset` da câmera. Reprova acima de 1 quadro. Arquivo com "cob" no nome na trilha principal é cobertura embutida, acusada no clipe onde a troca de plano aparece.
- **Sync da câmera:** `syncConfianca` ausente conta como sincronia manual (o comentário do campo diz "manual = ausente"). Por isso o −66 s do 19 também reprova, e não só os offsets 0.

## Achado lateral para o render (não mexi em render.ts)
No FFmpeg 9, `-color_primaries bt709 -color_trc bt709` na saída **não são gravados** quando o quadro chega do grafo com essas etiquetas em "unknown". O ffprobe continua mostrando `unknown`. Só grava com `setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709` no fim do `-vf`. Reproduzido no teste (`qc-tecnico.test.ts`, arquivo "bom"). Isso explica "0 de 55 com primárias e transfer" mesmo com as etiquetas na linha de comando.

## Pendente
- Escala embutida no arquivo: medir pela própria imagem (energia de alta frequência / ida e volta de escala), para pegar punch-in feito fora do Editor Brain.
- Quadro parado com Ken Burns sob fala (18): precisa de detecção de imagem estática com transformação global.
- Sincronia áudio × bruto por trecho (correlação do áudio da entrega com o bruto e comparação do quadro do mesmo instante): é a única forma de verificar coberturas sem tempo no nome, como a C do 19. Depende do bruto no SSD.
