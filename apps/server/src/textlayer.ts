/**
 * Camada de texto do export (legenda + lettering), desenhada pelo Chrome do próprio Mac — o mesmo
 * HTML/CSS do preview (TEXT_CSS). O FFmpeg daqui não tem drawtext/libass; e mesmo que tivesse, desenhar
 * com o navegador garante que o export é igual ao que o editor viu.
 *
 * Cada ESTADO do texto (legenda ativa, palavra destacada, letterings visíveis) vira um PNG transparente;
 * os PNGs viram uma trilha de vídeo com alfa (concat de imagens com duração) que entra numa sobreposição só.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { captionInlineStyle, cueCaptions, cueHtml, cueVisible, DEFAULT_CAPTIONS, FONT_FILES, FONT_PRELOADS, fontFaceCss, letteringFrameHtml, LETTERING_CSS, motionHtml, MOTION_CSS, TEXT_CSS, type CaptionSettings, type Cue, type LetteringSpec, type MotionSpec } from '@neweditor/core';
import { ROOT } from './config.ts';
import { run } from './media.ts';

/** Fontes empacotadas embutidas (data URI): a página do Chrome não tem origem para buscar arquivos. */
const FONT_DIR = path.join(ROOT, 'apps', 'web', 'public', 'fonts');
let fontCss: string | null = null;
async function embeddedFonts(): Promise<string> {
  if (!fontCss) {
    const data = new Map<string, string>();
    for (const f of FONT_FILES) data.set(f.file, (await fs.readFile(path.join(FONT_DIR, f.file))).toString('base64'));
    fontCss = fontFaceCss((file) => `data:font/ttf;base64,${data.get(file)}`);
  }
  return fontCss;
}

const CHROME = process.env.NEWEDITOR_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface TextItem {
  start: number;
  end: number;
  html: string;
}

export interface TextLayerInput {
  W: number;
  H: number;
  fps: number;
  total: number;
  cues: Cue[];
  captions: CaptionSettings | undefined;
  /** Letterings: animados, no lugar da legenda. */
  letterings: { start: number; end: number; spec: LetteringSpec }[];
  /** Motions narrativos: composições função do tempo, capturadas quadro a quadro. */
  motions?: { start: number; end: number; spec: MotionSpec }[];
}

const PAGES = 4;

/** Devolve o caminho de um .mov com alfa, ou null se não há texto nenhum. */
export async function renderTextLayer(inp: TextLayerInput, work: string, onProgress?: (p: number) => void): Promise<string | null> {
  const caps = inp.captions?.enabled ? inp.captions : undefined;
  const cues = caps ? inp.cues : [];
  const motions = inp.motions ?? [];
  if (!cues.length && !inp.letterings.length && !motions.length) return null;
  const wu = (inp.W / inp.H) * 100;

  // Pontos de mudança: início/fim de legenda, de cada palavra (destaque) e de cada lettering.
  const cuts = new Set<number>([0, inp.total]);
  for (const c of cues) {
    cuts.add(c.start).add(c.end);
    if (caps?.highlight) for (const w of c.words) cuts.add(w.start).add(w.end);
  }
  // Motion e lettering: um corte por quadro (estados iguais — holds — são reaproveitados lá embaixo).
  for (const l of inp.letterings) for (let k = 0; l.start + k / inp.fps < l.end; k++) cuts.add(+(l.start + k / inp.fps).toFixed(6));
  for (const l of inp.letterings) cuts.add(l.end);
  // Motion: um corte por quadro (estados iguais — holds — são reaproveitados lá embaixo).
  for (const m of motions) for (let k = 0; m.start + k / inp.fps < m.end; k++) cuts.add(+(m.start + k / inp.fps).toFixed(6));
  for (const m of motions) cuts.add(m.end);
  const times = [...cuts].filter((t) => t >= 0 && t <= inp.total).sort((a, b) => a - b);

  const stateAt = (t: number): string => {
    const parts: string[] = [];
    // Lettering ou motion na tela → a legenda sai (os dois juntos diriam a mesma coisa duas vezes).
    const lettering = inp.letterings.some((l) => t >= l.start && t < l.end);
    const motion = motions.find((m) => t >= m.start && t < m.end);
    if (motion) {
      // Quadro do motion no INÍCIO do quadro de vídeo (o player faz igual).
      const lt = Math.floor((t - motion.start) * inp.fps + 1e-6) / inp.fps;
      parts.push(motionHtml(motion.spec, lt, motion.end - motion.start, wu));
    }
    const cue = cues.find((c) => t >= c.start && t < c.end && cueVisible(c));
    if (cue && caps) parts.push(`<div class="ne-caption ${caps.style}${caps.box ? ' boxed' : ''}" style="${captionInlineStyle(cueCaptions(caps, cue), { t, start: cue.start, end: cue.end })}"><span>${cueHtml(cue, caps, t)}</span></div>`);
    const position = (inp.captions ?? DEFAULT_CAPTIONS).position;
    for (const l of inp.letterings)
      if (t >= l.start && t < l.end) parts.push(letteringFrameHtml(l.spec, Math.floor((t - l.start) * inp.fps + 1e-6) / inp.fps, l.end - l.start, wu, position));
    return parts.join('');
  };

  // Intervalos com o mesmo estado são fundidos; estados iguais reaproveitam o mesmo PNG.
  const intervals: { dur: number; html: string }[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const a = times[i]!;
    const b = times[i + 1]!;
    if (b - a < 1e-4) continue;
    const html = stateAt((a + b) / 2);
    const last = intervals[intervals.length - 1];
    if (last && last.html === html) last.dur += b - a;
    else intervals.push({ dur: b - a, html });
  }
  const unique = [...new Set(intervals.map((x) => x.html))];

  const dir = path.join(work, 'text');
  await fs.mkdir(dir, { recursive: true });
  // A janela tem que ter o tamanho do quadro: a captura direta (CDP) pega a janela, não o viewport emulado.
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [`--window-size=${inp.W},${inp.H}`] });
  try {
    // Várias abas em paralelo: motion gera centenas de quadros, uma aba só vira gargalo.
    let next = 0;
    let done = 0;
    const fonts = await embeddedFonts();
    const worker = async () => {
      const page = await browser.newPage({ viewport: { width: inp.W, height: inp.H }, deviceScaleFactor: 1 });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}html,body{margin:0;background:transparent;width:${inp.W}px;height:${inp.H}px;overflow:hidden}${TEXT_CSS}${MOTION_CSS}${LETTERING_CSS}</style></head>` +
          `<body><div id="layer" class="ne-text-layer" style="--u:${inp.H / 100}px"></div></body></html>`,
      );
      // Nenhum quadro sai com fonte de reserva: carrega todas antes do primeiro.
      await page.evaluate((list) => Promise.all(list.map((f) => document.fonts.load(f))).then(() => document.fonts.ready), FONT_PRELOADS);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      for (let i = next++; i < unique.length; i = next++) {
        await page.evaluate((html) => {
          document.getElementById('layer')!.innerHTML = html;
        }, unique[i]!);
        const out = path.join(dir, `s${i}.png`);
        const png = Buffer.from(((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true } as never)) as { data: string }).data, 'base64');
        // Cabeçalho PNG: largura/altura em 16..24. Tamanho errado → captura pelo Playwright (mais lenta, sempre certa).
        if (png.readUInt32BE(16) === inp.W && png.readUInt32BE(20) === inp.H) await fs.writeFile(out, png);
        else await page.screenshot({ path: out, omitBackground: true });
        onProgress?.(++done / unique.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGES, unique.length) }, worker));
  } finally {
    await browser.close();
  }

  // Concat de imagens com duração exata (a última repetida, exigência do demuxer).
  const idx = new Map(unique.map((h, i) => [h, i]));
  const lines: string[] = [];
  for (const it of intervals) lines.push(`file 's${idx.get(it.html)}.png'`, `duration ${it.dur.toFixed(6)}`);
  lines.push(`file 's${idx.get(intervals[intervals.length - 1]!.html)}.png'`);
  const list = path.join(dir, 'list.txt');
  await fs.writeFile(list, lines.join('\n'));
  const out = path.join(work, 'text.mov');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${inp.fps},format=argb`, '-c:v', 'qtrle', '-t', String(inp.total), out]);
  return out;
}
