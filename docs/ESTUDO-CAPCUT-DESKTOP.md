# Estudo: como o CapCut de desktop (Mac) é montado, e o que levar para o Editor Brain

*2026-10-12.* O Thales entregou o instalador (`CapCut_7695800703616516117_installer.dmg`) e o app instalado (`/Applications/CapCut.app`, versão 9.5.0, `com.lemon.lvoverseas`). O que está aqui foi lido da **estrutura** do pacote: nomes e tamanhos de arquivos, `Info.plist`, bibliotecas ligadas ao binário (`otool -L`) e as pastas de dados do usuário. Nada foi descompilado, aberto ou copiado — código, modelos, fontes e templates deles ficam onde estão. Complementa o `docs/ESTUDO-CAPCUT.md` (a versão web).

## 1. O que vem dentro do app (2,1 GB)

| Camada | O que é | Evidência |
|---|---|---|
| **Casca nativa em Qt 6 / QML** | A janela, a timeline, os painéis e os diálogos são QtQuick (QML), com Widgets para o resto | `QtQuick`, `QtQml`, `QtQuickControls2`, `QtQuickDialogs2`, `QtWidgets`, `QtSvg`, plugin `libqcocoa` (macOS), `Resources/qml` |
| **Motor de vídeo nativo** | O mesmo "VE" que o estudo web mostrou compilado para WebAssembly; aqui é C++ nativo, com shaders Metal pré-compilados | `libVECreator.dylib` (544 MB), `libvideoeditor.dylib` (84 MB), `libcccreator.dylib` (132 MB), `libAGFX.dylib`, `VEMetalBinary_Mac.bundle`, `VEHelper.app` (processo auxiliar do motor), `VECrashHandler.app` |
| **FFmpeg embutido** | Decodificação/codificação próprias, inclusive AV1 (`dav1d`) e o codec ByteVC1 | `libavcodec`, `libavformat`, `libavfilter`, `libswscale`, `libdav1d`, `libByteVC1_dec`, `libmp3lame` e um `ffmpeg` de linha de comando (1 MB) em `Resources` |
| **Chromium embutido (CEF)** | Para as partes "web" do app: loja de materiais, publicação de efeitos/stickers/templates, assinatura, central de créditos, o chat de edição inteligente | `Chromium Embedded Framework.framework` (454 MB), `CapCut Helper (GPU/Plugin/Renderer).app`, `Resources/image_h5_*` (páginas HTML), `Resources/lynx_config` + `libLynx.dylib` (Lynx = framework de UI web da ByteDance) |
| **Modelos de IA locais (191 MB)** | Recorte de pessoa (matting), rosto (detecção, verificação, agrupamento, fitting 3D), interpolação de quadros, detecção de cena/corte (`shotDetect`), saliência, profundidade, pele, mãos, marca-d'água invisível, modelos de áudio, "media_search" | `Resources/models/*` (`.model`, `.bytenn`) + runtime `libbytenn.dylib` |
| **Fala e áudio** | SDK de fala (ASR/TTS) e SAMI (processamento de áudio) | `libspeechsdk.dylib`, `libsamicore.dylib`, `Resources/audiosami`, `audio_metrics` |
| **Agentes** | Camada de "deep agents" (o assistente de IA do app) | `libdeepagents_capi.dylib` (112 MB), `libDeepAgentsService.dylib`, `Resources/builtin_skills`, `image_h5_smart_edit_chat_bot` |
| **Cor** | Presets de ajuste e LUTs, rodas de cor, curvas | `DefaultAdjustBundle`, `lut`, `PrimaryWheel`, `LogWheel`, `Curves`, `Chroma` |
| **Fontes** | Fonte do sistema + fontes de efeito, por idioma | `Resources/Font` (45 MB), `po` (traduções, 35 MB), `*.lproj` |
| **Nuvem, conta, pagamento** | Sincronização de rascunhos, download de materiais, compras no app, atualização | `libever_cloud_sdk`, `libTTNetDownloaderCrossPlatform`, `libuploader`, `PIPOIAP.framework` (compras), `Sparkle.framework` (auto-update), `libtt_c2pa_sdk` (credencial de conteúdo C2PA) |
| **Infra** | Rede própria, settings em MMKV, SQLite, rastreamento | `libsscronet`, `libmmkv`, `libqsqlite`, `libTracking`, `libIESAppLogger` |

Outros fatos:
- O **instalador tem 3,6 MB**: é um instalador online, que baixa o app de 2 GB depois.
- Pede macOS 10.14+, categoria `public.app-category.video`, esquema de URL `capcut://` (deep links: `deeplink_local_*_res.mp4` são vídeos de boas-vindas locais).
- Permissões declaradas: câmera e microfone.

## 2. Onde ficam os projetos do usuário

`~/Movies/CapCut/User Data/`:
- `Projects/com.lveditor.draft/<id do projeto>/` — um rascunho por pasta (`draft_content.json` etc., o formato descrito no estudo web) e uma `.recycle_bin` para projetos apagados;
- `Projects/com.lveditor.textTemplate.draft/` — templates de texto do usuário;
- `Config/` (AutoBackUp, atalhos, idioma, módulos), `Cache/` (207 MB: templates, IA, materiais), `MMKV/` (preferências), `Log/`, `Crash/`, `CEF/` (dados do Chromium embutido).

## 3. CapCut × Editor Brain (desktop)

| | CapCut | Editor Brain (hoje) |
|---|---|---|
| Casca | Qt/QML nativo + CEF para páginas web | Electron: Chromium para tudo (React) |
| Motor | C++ nativo + Metal, num processo auxiliar (`VEHelper`) | Preview: WebCodecs + WebGL no renderer. Export: FFmpeg + Chrome headless (texto/motion), no processo do servidor |
| FFmpeg | Bibliotecas embutidas | O do sistema (Homebrew) |
| IA local | 40+ modelos próprios (bytenn) | Whisper (mlx), Qwen local opcional, `faces` (Swift), Cinéfilo (clip.cafe) |
| Projetos | Pasta por rascunho + lixeira + backup automático | `data/projects/<id>` + `_lixeira` (igual na ideia; sem backup automático) |
| Atualização | Sparkle | nenhuma |
| Falhas | Crash handler próprio + logs | `~/Library/Logs/Editor Brain/main.log` (novo) |
| Tamanho | 2,1 GB | 324 MB |

## 4. O que levar para o nosso app (por ordem)

1. **Processos auxiliares para o trabalho pesado.** O CapCut não renderiza no processo da interface (`VEHelper`). No nosso, FFmpeg e o Chrome headless já são processos filhos, mas o **servidor** roda no processo principal do Electron: uma decupagem ou um render longo pode travar o menu e a janela. Mover o servidor para um processo filho (`utilityProcess` do Electron) com a mesma porta.
2. **Empacotar o FFmpeg** (binários por plataforma em `resources/bin`, com `NEWEDITOR_FFMPEG`) e **baixar os modelos no primeiro uso** (Whisper, Qwen) com barra de progresso e o ok do usuário — é o que o cache de 207 MB e o instalador online deles fazem.
3. **Backup automático e lixeira com restauração** por projeto (eles têm `AutoBackUp`; nós temos a `_lixeira`, falta o botão de restaurar e o backup periódico do JSON do projeto).
4. **Auto-update** com `electron-updater` (o equivalente do Sparkle) quando houver repositório/release.
5. **Modelo de cena local**: o `shotDetect` deles é o que decide cortes automáticos; o nosso corte vem da fala (decupagem), que é melhor para talk head. Vale um detector de cena só para B-roll bruto (ffmpeg `scdet` resolve sem modelo).
6. **Não copiar:** loja/assinatura/créditos em páginas web dentro do app, c2pa, rastreamento. O que é diferencial deles (templates, efeitos) não é o nosso caminho (ADR-008: o padrão é do editor, não da loja).
