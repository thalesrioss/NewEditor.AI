/**
 * Qual FFmpeg e qual ffprobe o servidor do app usa. Função pura, testável sem Electron.
 *
 * Ordem (a primeira que existir vale para os dois, sem misturar versões):
 *  1. NEWEDITOR_FFMPEG / NEWEDITOR_FFPROBE já definidos (quem abriu o app escolheu).
 *  2. Mac: o FFmpeg 9.0.2 estático que vai dentro do app (`Resources/ffmpeg/`; em desenvolvimento,
 *     `apps/desktop/vendor/ffmpeg/darwin-<arch>/`, baixado por `scripts/fetch-ffmpeg.mjs`). É a versão contra a
 *     qual a suíte do servidor roda; o do Homebrew pode virar 10 sozinho num `brew upgrade` e mudar o render.
 *  3. O do PATH (Homebrew no Mac, instalado no Windows).
 *  4. Windows: ffmpeg-static / ffprobe-static (ainda 6.0 e 4.4; o QC de níveis reprova esse render).
 *  5. `ffmpeg` / `ffprobe` puros (falha clara no primeiro uso).
 */
export interface FerramentasEntrada {
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  resourcesPath: string;
  /** Pasta apps/desktop (para achar vendor/ em desenvolvimento). */
  desktopDir: string;
  env: Record<string, string | undefined>;
  existe: (arquivo: string) => boolean;
  noPath: (nome: string) => string | null;
  /** Caminhos de ffmpeg-static / ffprobe-static, se o pacote estiver no app. */
  estaticoNpm: () => { ffmpeg: string | null; ffprobe: string | null };
  join: (...partes: string[]) => string;
}

export type OrigemFerramentas = 'ambiente' | 'empacotado-9' | 'path' | 'ffmpeg-static' | 'nenhuma';

export interface Ferramentas {
  ffmpeg: string;
  ffprobe: string;
  origem: OrigemFerramentas;
}

export function escolherFerramentas(e: FerramentasEntrada): Ferramentas {
  const exe = e.platform === 'win32' ? '.exe' : '';
  if (e.env.NEWEDITOR_FFMPEG && e.env.NEWEDITOR_FFPROBE) return { ffmpeg: e.env.NEWEDITOR_FFMPEG, ffprobe: e.env.NEWEDITOR_FFPROBE, origem: 'ambiente' };
  const par = (dir: string) => ({ ffmpeg: e.join(dir, `ffmpeg${exe}`), ffprobe: e.join(dir, `ffprobe${exe}`) });
  const ambos = (p: { ffmpeg: string | null; ffprobe: string | null }) => p.ffmpeg && p.ffprobe && e.existe(p.ffmpeg) && e.existe(p.ffprobe);

  if (e.platform === 'darwin') {
    const dir = e.packaged ? e.join(e.resourcesPath, 'ffmpeg') : e.join(e.desktopDir, 'vendor', 'ffmpeg', `darwin-${e.arch}`);
    const p = par(dir);
    if (ambos(p)) return { ...p, origem: 'empacotado-9' };
  }
  const sistema = { ffmpeg: e.noPath(`ffmpeg${exe}`), ffprobe: e.noPath(`ffprobe${exe}`) };
  if (ambos(sistema)) return { ffmpeg: sistema.ffmpeg!, ffprobe: sistema.ffprobe!, origem: 'path' };
  const npm = e.estaticoNpm();
  if (ambos(npm)) return { ffmpeg: npm.ffmpeg!, ffprobe: npm.ffprobe!, origem: 'ffmpeg-static' };
  return { ffmpeg: e.env.NEWEDITOR_FFMPEG || 'ffmpeg', ffprobe: e.env.NEWEDITOR_FFPROBE || 'ffprobe', origem: 'nenhuma' };
}
