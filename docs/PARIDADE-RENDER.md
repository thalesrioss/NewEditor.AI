# Paridade do render com o padrão Daniel Sun e o DaVinci do Thales (BL-0100)

Lista única do que o Editor Brain já faz e do que falta para editar um vídeo no padrão Daniel Sun (Reels 9:16, talk head com inserts de filme, motions do Motion Studio, flash, SFX por evento, lettering de cliente, LUT FUJI) sem abrir chamado no meio da edição.

Fontes lidas em 21/10/2026: memória da Lia (`~/newstudios/agentes/studio-editor-2/memoria/2026-10-20.md` e `2026-10-21.md`), `~/newstudios/curadoria/CRITERIOS.md` (R-007, A-001 a A-008), `~/newstudios/memoria/FEEDBACK-EDITOR-BRAIN.md`, CH-0001 a CH-0012 e o lote `office/bancada-chamados` 15ad598. Base deste documento: branch `office/bl-0100-paridade-render` (lote + correções do BL-0100).

Todas as operações vão por `POST /api/projects/<id>/op` com `{ op, note, by: 'agent' }`. Overlay ancora no tempo do **bruto** (`anchor: { assetId, at }`), não da timeline.

## Tabela

Estado: **existe** (operação + teste que prova) ou **falta** (esforço P/M/G). Esforço P entrou nesta branch; M e G viraram `melhoria` em FEEDBACK.md citando BL-0100.

| Recurso do padrão | Chamado | Estado | Como usar | Prova |
| --- | --- | --- | --- | --- |
| Busca de looks (LUT) do CinePRO | CH-0001 | existe | `GET /api/cinepro/itens?modo=cor&busca=fuji` (cor, looks, look e lut são sinônimos) | `apps/server/src/cinepro.test.ts` |
| Transcrição conferida no lugar do ASR | CH-0002 | existe | `POST /api/projects/<id>/assets/<assetId>/transcript` com `{ words: [{ w, start, end }] }` (ou só um intervalo) | `apps/server/src/transcript-import.test.ts` |
| ASR por trecho sem perder nem inventar palavra (bruto com retake) | CH-0002 | falta, M | já é o BL-0097 (P2, planejado); até lá, importar a transcrição conferida | — |
| B-roll: posição e zoom no overlay | CH-0003 | existe | `{ type: 'set_overlay_framing', id, framing: { x, y, zoom } }` (x/y de 0 a 1 na fonte, zoom 1 a 4; `null` volta ao central) | `render-framing.test.ts`, `packages/core/src/framing.test.ts` |
| B-roll: velocidade e congelar o fim | CH-0004 | existe | `{ type: 'set_overlay_speed', id, speed: 0.573, freeze: 1.1 }` (speed 0,25 a 4; freeze 0 a 10 s; `null` volta) | `render-overlay-speed.test.ts`, `overlay-speed.test.ts` |
| Timeline no fps do bruto (29,97) | CH-0005 | existe | automático no import; manual: `{ type: 'set_format', width: 1080, height: 1920, fps: 29.97 }` | `fps-do-bruto.test.ts` |
| Zoom de ênfase ancorado nos olhos | CH-0006 | existe | `{ type: 'set_framing', clipId, y: 0.36 }` + `{ type: 'set_zoom', clipId, zoom: 1.2 }` | `render-zoom-ancora.test.ts`, `timeline.test.ts` |
| Loudness de entrega no MP4 (−14 LUFS ±0,5, ≤ −1 dBTP) | CH-0007 | existe | automático no render; o "Render pronto" mostra a medida | `loudness.test.ts` |
| Overlays encostados sem quadro da fala entre eles | CH-0008 | existe | basta encostar (fim de um = âncora do outro) | `render-overlay-quadros.test.ts` |
| LUT `.cube` do disco (FUJI_CLASSICO) | CH-0009 | existe | `{ type: 'set_grade', assetId, grade: { ...grade, lut: { path: '<caminho absoluto>.cube', strength: 1 } } }` | `lut-local.test.ts` |
| Flash só na imagem, SFX do editor no A2 | CH-0010 | existe | `{ type: 'set_flash', clipId, on: true, sfx: false }` | `render-flash-sem-som.test.ts` |
| Flash por cima de B-roll e motion de arquivo | CH-0011 | existe | `set_flash` de sempre | `render-flash-sobre-camadas.test.ts` |
| Lettering no template do cliente (Helvetica Neue Bold, caixa alta, 213/24/0, tracking −0,06, troca seca) | CH-0012 | existe | `add_overlay` V3 role `lettering`, `source: { type: 'lettering', lettering: { estilo: 'cliente', template: { font, weight, color, tracking, upper } } }` | `lettering-cliente.test.ts`, `lettering.test.ts` |
| Legenda em Helvetica Neue | CH-0012 | existe | `set_captions` com `font: 'helvetica'` | `legenda-helvetica.test.ts` |
| Lettering de arquivo (PNG ou ProRes 4444 com alfa) na V3 | candidato 21/10 | **corrigido nesta branch** (P) | `add_overlay` V3 role `lettering` com `source: { type: 'media', assetId, in: 0 }`; antes sumia no render e no preview e ainda escondia a legenda | `render-lettering-midia.test.ts` |
| `set_captions` parcial (`{ font }` sozinho) | candidato 21/10 | **corrigido nesta branch** (P) | os campos obrigatórios que faltam (enabled, style, uppercase, highlight, position) vêm do padrão; antes `position` ficava indefinida e a legenda ia para o topo. Os opcionais continuam trocados por inteiro: mande o objeto completo para manter tamanho, cor etc. | `packages/core/src/captions-parcial.test.ts` |
| Legenda por cima de insert e motion (pedido do card) | FEEDBACK 20/10 | **corrigido nesta branch** (P) | `set_captions` com `overLayers: true` (ou no painel Legenda, "Por cima de B-roll e motion"); antes era `edit_captions` com `force` em cada legenda | `captions-parcial.test.ts` (overLayers) |
| Render do Motion Studio entra como motion na biblioteca | FEEDBACK 20/10 | **corrigido nesta branch** (P) | `POST /api/projects/<id>/assets` com `{ path, role: 'motion' }` (fala, broll ou motion; outro valor devolve 400) | `assets-role.test.ts` |
| Motion do Studio com alfa na V3 | — | existe | `POST /assets {path}` + `add_overlay` V3 role `motion` com `source: { type: 'media' }`; `.mov` ProRes 4444 entra com `alpha: true` e compõe transparente | uso real da Lia (v2 Daniel Sun); sem teste dedicado |
| SFX de arquivo por evento, encavalados, trecho do arquivo | R-007 | existe | `add_overlay` A2 role `sfx` com `source: { type: 'media', assetId, in }` e `duration`; sobrepostos saem juntos (amix) | uso real (44 SFX na v3); `render-flash-sem-som.test.ts` cobre o A2 |
| Nível de cada SFX relativo à mix (dB do DaVinci do Thales) | R-007 | existe | `{ type: 'set_overlay_mix', id, mix: { gainDb: -11, fadeIn: 0, fadeOut: 0, duck: false } }`; dB aqui = dB do DaVinci | uso real (v3/v4); medir no render, não no arquivo |
| SFX automático dos motions | R-007 | existe | `{ type: 'set_motion_sfx', gainDb }` (mínimo −24); mutar: `set_track_state` no A2 cala todos os SFX | uso real (v3); sem teste dedicado |
| Trilha com ducking | — | existe | `add_overlay` role `music` + `set_overlay_mix` (`duck: true`) | sem teste dedicado (lacuna de teste, anotada em FEEDBACK) |
| Cor por controles (exposição, sombras, curva) e LUT do catálogo | — | existe | `set_grade` (controles + `lut: { id }`) | `timeline.test.ts` (gradePixel), `lut-local.test.ts` |
| Edição fina da legenda (dividir, juntar, esconder, texto) | — | existe | `{ type: 'edit_captions', edits: [{ assetId, at, patch: { split, join, hidden, force, text } }] }` | `timeline.test.ts` |
| Lettering e legenda no mesmo grid de quadros | FEEDBACK 21/10 (rodada 9) | falta, M | o vídeo do overlay entra em `round(t·fps)` e a legenda some em `t` exato: lettering fora do grid (2,74 s = quadro 82,2) aparece 1 quadro antes, junto com a legenda. Contorno: entrada do lettering = `ceil(t·fps)/fps + 0,001` | — |
| Lettering em escada (recuo por linha) | FEEDBACK 21/10 | falta, M | `LetteringSpec` tem linhas e `align`, sem `x` por linha; contorno: Motion Studio com alfa como lettering de arquivo (agora entra no render) | — |
| Status do render (saber quando terminou e o arquivo) | FEEDBACK 20/10 | **existe** (BL-0103) | `POST /api/projects/<id>/render` devolve `{ job, queued, posicao }`; `GET /api/projects/<id>/render/<job>` dá `estado`: `fila` (`posicao`), `rodando` (`pct` 0 a 100), `pronto` (`file`, `caminho` absoluto, `url`, `bytes`, `lufs`, `truePeak`, `loudnessOk`; o arquivo já está inteiro no disco) ou `erro` (`mensagem`); job desconhecido = 404. O status fica na memória do servidor: depois de religar, um render que ainda estava na fila continua aparecendo como `fila`; um que já tinha terminado volta 404 (aí vale `versions.at(-1).render` do projeto) | `render-status.test.ts` |
| Tela dividida (B-roll em cima, rosto embaixo) | A-004 (Guilherme) | falta, G | já é o BL-0082 (P3) | — |
| Pistas extras de SFX (A5/A6) | CH-0010 | não precisa | o A2 aceita efeitos sobrepostos | — |

## Resposta para o próximo vídeo no padrão Daniel Sun

Tudo o que a Lia usou nos cards 6ad7faa6 e 6ad85635 tem operação no lote + esta branch, com três exceções que têm contorno escrito acima: lettering fora do grid de quadros (1 quadro junto da legenda) e lettering em escada (o status do render entrou no BL-0103). Transcrição de bruto com retake continua precisando da transcrição conferida até o BL-0097.
