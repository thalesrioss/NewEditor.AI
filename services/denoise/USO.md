# Limpeza de ruído da voz (RNNoise)

Os modelos vêm de GregorR/rnnoise-models (README ao lado). Eles são usados pelo filtro `arnndn` do FFmpeg, em `apps/server/src/denoise.ts`.

- **Modelo usado:** `sh.rnnn` (somnolent-hogwash). Na tabela do README ele é o modelo para ruído de gravação com sinal de fala.
- **Onde roda:** no arquivo inteiro, uma vez por intensidade. Da mesma passada saem o master FLAC (export) e o proxy com o áudio limpo (preview).
- **Latência:** o `arnndn` atrasa a saída em 480 amostras (10 ms a 48 kHz), inclusive a parte original da mistura (`mix`). O filtro compensa com `apad` + `atrim=start_sample=480`.
- **Proxy de vídeo:** o vídeo é copiado do proxy original. O áudio limpo recebe o mesmo deslocamento que o `make_zero` aplicou no proxy (a pré-rolagem do AAC). Medido: alinhado com o proxy original em ±1 amostra.

Medições de 2026-10-10 (40 s de fala; "ruído" = pausas, "voz" = trechos falados):

| Material | Modelo | Ruído | Voz |
|---|---|---|---|
| Lapela limpo (Felicidade), piso −75 dBFS | cb / sh | +0,3 / +0,4 dB | −0,1 / 0,0 dB |
| VO do Davi, piso −63 dBFS | cb / sh | −3,4 / −3,5 dB | −0,3 / −0,3 dB |
| Lapela + ruído rosa, piso −50 dBFS | cb / sh | −9,5 / −9,6 dB | −0,1 / 0,0 dB |

No espectrograma, o `sh` limpa mais nas pausas e mantém os harmônicos da voz. Em gravação limpa, ligar a limpeza quase não muda nada (não estraga, mas também não ajuda).
