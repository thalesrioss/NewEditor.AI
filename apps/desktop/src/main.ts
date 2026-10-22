/**
 * Editor Brain como app de desktop (Mac e Windows), como o CapCut:
 * o servidor (Fastify) sobe num processo auxiliar (utilityProcess, como o VEHelper do CapCut) e a janela abre
 * a interface nele. Um render ou uma decupagem longa não disputa a thread da janela e dos menus; se o auxiliar
 * não subir, o servidor roda dentro do processo principal (reserva), e o diário conta qual dos dois foi.
 *
 *  · desenvolvimento: NEWEDITOR_DEV_URL=http://localhost:5173 (Vite + servidor de `npm run dev`)
 *  · central da NewStudios (padrão, FB-0169): a janela abre direto em http://localhost:5410, a mesma fonte de projetos
 *    e vídeos dos editores agentes, sem servidor próprio e sem escolha de origem (ver central.ts)
 *  · reserva, se a central não responder: servidor em resources/app-root, dados em ~/Library/Application Support/Editor Brain/data
 */
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CENTRAL_DADOS_PADRAO, escolherOrigem } from './central';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Commit do build, gravado pelo esbuild.mjs (aparece em "Sobre o Editor Brain"). */
declare const __NEWEDITOR_COMMIT__: string;
const COMMIT = typeof __NEWEDITOR_COMMIT__ === 'string' ? __NEWEDITOR_COMMIT__ : 'dev';
const isMac = process.platform === 'darwin';
/**
 * Modo oculto, para automação (agente testador, CI): `--hidden`, NEWEDITOR_HIDDEN=1 ou, por padrão, quando o app é
 * aberto com `--remote-debugging-port` (quem liga o DevTools remoto é um script, não uma pessoa; `--show` desfaz).
 * O app sobe inteiro (servidor, janela, DevTools remoto) mas a janela não aparece nem rouba o foco, e o ícone fica
 * fora do Dock. Sem isso, cada rodada de teste abria o Editor Brain na frente do que a pessoa estava fazendo.
 */
const argv = process.argv.slice(1);
const automated = argv.some((a) => a.startsWith('--remote-debugging-port')); // DevTools remoto = alguém (agente, Playwright) dirigindo o app
const HIDDEN = !argv.includes('--show') && (argv.includes('--hidden') || process.env.NEWEDITOR_HIDDEN === '1' || automated);

/** Diário do app em ~/Library/Logs/Editor Brain/main.log (Windows: %APPDATA%/Editor Brain/logs): o que aconteceu ao abrir. */
const LOG_FILE = path.join(app.getPath('logs'), 'main.log');
function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map((x) => (x instanceof Error ? `${x.message}\n${x.stack ?? ''}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* sem log */
  }
  process.stderr.write(line);
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e as Error));
process.on('exit', (code) => log('exit', code));
app.on('will-quit', () => log('will-quit'));
app.on('quit', (_e, code) => log('quit', code));
log('start', { packaged: app.isPackaged, exec: process.execPath, resources: process.resourcesPath, argv: process.argv, cwd: process.cwd(), electron: process.versions.electron });

app.setName('Editor Brain');
// Motor de preview (WebCodecs + WebGL com memória compartilhada) e vídeo com alfa.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

/** Apps abertos pelo Finder/Explorer não herdam o PATH do terminal: o FFmpeg do Homebrew precisa estar visível. */
function fixPath(): void {
  const extra = isMac ? ['/opt/homebrew/bin', '/usr/local/bin', path.join(process.env.HOME ?? '', '.local', 'bin')] : [];
  const cur = (process.env.PATH ?? '').split(path.delimiter);
  process.env.PATH = [...extra.filter((p) => p && !cur.includes(p)), ...cur].join(path.delimiter);
}

/** Primeiro executável com esse nome no PATH (já com o Homebrew incluído por fixPath). */
function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const f = path.join(dir, name);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return f;
    } catch {
      /* não está aqui */
    }
  }
  return null;
}

/**
 * FFmpeg e ffprobe: o do sistema (Homebrew), se existir, porque é mais novo; senão os que o app leva consigo
 * (ffmpeg-static / ffprobe-static, desempacotados fora do asar). O servidor lê NEWEDITOR_FFMPEG / NEWEDITOR_FFPROBE.
 */
function resolveTools(): void {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const unasar = (f: string) => f.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const bundled = (load: () => string): string | null => {
    try {
      const f = unasar(load());
      return fs.existsSync(f) ? f : null;
    } catch {
      return null;
    }
  };
  const ffmpeg = bundled(() => require('ffmpeg-static') as string);
  const ffprobe = bundled(() => (require('ffprobe-static') as { path: string }).path);
  process.env.NEWEDITOR_FFMPEG ??= onPath(`ffmpeg${exe}`) ?? ffmpeg ?? 'ffmpeg';
  process.env.NEWEDITOR_FFPROBE ??= onPath(`ffprobe${exe}`) ?? ffprobe ?? 'ffprobe';
  log('ferramentas', { ffmpeg: process.env.NEWEDITOR_FFMPEG, ffprobe: process.env.NEWEDITOR_FFPROBE, empacotados: { ffmpeg, ffprobe } });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('sem porta'))));
    });
    srv.on('error', reject);
  });
}

function waitHealth(url: string, ms = 20000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(`${url}/api/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else retry();
        })
        .on('error', retry);
    };
    const retry = () => (Date.now() - t0 > ms ? reject(new Error('O servidor do Editor Brain não respondeu.')) : setTimeout(tick, 250));
    tick();
  });
}

/** O processo auxiliar do servidor (vivo enquanto o app estiver aberto). */
let serverProc: UtilityProcess | null = null;

/**
 * Sobe o servidor num processo auxiliar e resolve quando ele responde ao /api/health.
 * Rejeita se o processo morrer antes disso (aí o chamador usa a reserva no processo principal).
 */
function forkServer(script: string, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const child = utilityProcess.fork(script, [], { env: { ...process.env }, stdio: 'pipe', serviceName: 'Editor Brain · servidor' });
    serverProc = child;
    const pipe = (prefix: string, stream: NodeJS.ReadableStream | null) => stream?.on('data', (d: Buffer) => process.stderr.write(`${prefix} ${d}`));
    pipe('[servidor]', child.stdout);
    pipe('[servidor!]', child.stderr);
    child.on('spawn', () => log('servidor auxiliar', { pid: child.pid }));
    child.on('exit', (code) => {
      serverProc = null;
      log('servidor auxiliar saiu', { code });
      if (!done) (done = true), reject(new Error(`o servidor auxiliar saiu com código ${code}`));
      else if (!quitting) dialog.showErrorBox('O servidor do Editor Brain parou', `Código ${code}. Feche e abra o app de novo.\n\nDiário: ${LOG_FILE}`);
    });
    waitHealth(url).then(
      () => !done && ((done = true), resolve()),
      (e) => !done && ((done = true), child.kill(), reject(e)),
    );
  });
}
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
  serverProc?.kill();
});

/** De onde a janela abriu: a central da NewStudios, o Vite de desenvolvimento ou o servidor próprio do app. */
let origem: 'central' | 'dev' | 'local' = 'local';

/**
 * Devolve a URL da interface: a central da NewStudios se ela responder (sem subir nada); senão
 * o servidor próprio (auxiliar; reserva no processo principal).
 */
async function startServer(): Promise<string> {
  const o = await escolherOrigem(process.env);
  if (o.tipo !== 'local') {
    origem = o.tipo;
    if (o.tipo === 'central') process.env.NEWEDITOR_DATA = process.env.NEWEDITOR_CENTRAL_DATA ?? CENTRAL_DADOS_PADRAO;
    log('origem', o);
    return o.url;
  }
  log('origem', o, '(servidor próprio do app)');
  const packaged = app.isPackaged;
  // Raiz do produto: no repositório é a raiz do monorepo; empacotado, a cópia em resources/app-root.
  const root = packaged ? path.join(process.resourcesPath, 'app-root') : path.resolve(here, '../../..');
  process.env.NEWEDITOR_ROOT ??= root;
  process.env.NEWEDITOR_DATA ??= packaged ? path.join(app.getPath('userData'), 'data') : path.join(root, 'data');
  process.env.NEWEDITOR_WEB_DIST ??= path.join(root, 'apps', 'web', 'dist');
  const port = Number(process.env.NEWEDITOR_PORT) || (await freePort());
  process.env.NEWEDITOR_PORT = String(port);
  log('server', { root, data: process.env.NEWEDITOR_DATA, webDist: process.env.NEWEDITOR_WEB_DIST, port });
  await fs.promises.mkdir(path.join(process.env.NEWEDITOR_DATA, 'projects'), { recursive: true });
  if (!fs.existsSync(process.env.NEWEDITOR_WEB_DIST)) throw new Error(`Interface não encontrada em ${process.env.NEWEDITOR_WEB_DIST}. Rode "npm run build -w @neweditor/web".`);
  const url = `http://127.0.0.1:${port}`;
  const script = path.join(here, 'server.mjs');
  if (process.env.NEWEDITOR_SERVER_INPROC !== '1') {
    try {
      await forkServer(script, url);
      log('server pronto (auxiliar)', url);
      return url;
    } catch (e) {
      log('servidor auxiliar falhou; usando o processo principal', e as Error);
    }
  }
  await import(/* @vite-ignore */ script);
  await waitHealth(url);
  log('server pronto (no processo principal)', url);
  return url;
}

function buildMenu(win: BrowserWindow): void {
  const go = (hash: string) => () => void win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
  const edit = (cmd: 'undo' | 'redo' | 'selectAll') => () =>
    void win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('ne:edit', { detail: ${JSON.stringify(cmd)} }))`);
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: 'Editor Brain', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Vídeos editados', accelerator: 'CmdOrCtrl+Shift+V', click: go('#/videos') },
        { label: 'Projetos (Kanban)', accelerator: 'CmdOrCtrl+Shift+P', click: go('#/') },
        { label: 'Cérebro do Editor', click: go('#/cerebro') },
        { label: 'Perfis de edição', click: go('#/perfis') },
        { type: 'separator' },
        { label: 'Pasta de entregas', click: () => void shell.openPath(path.join(app.getPath('home'), 'Movies', 'NewEditor Entregas')) },
        { label: 'Pasta de dados', click: () => void shell.openPath(process.env.NEWEDITOR_DATA ?? app.getPath('userData')) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      // ⌘Z/⇧⌘Z/⌘A precisam estar no menu, senão não funcionam nos campos de texto do Mac. O renderer decide
      // (apps/web/src/lib/editMenu.ts): campo em foco → edita o campo; senão → desfaz/refaz/seleciona na timeline.
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', accelerator: 'CmdOrCtrl+Z', click: edit('undo') },
        { label: 'Refazer', accelerator: 'Shift+CmdOrCtrl+Z', click: edit('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Selecionar tudo', accelerator: 'CmdOrCtrl+A', click: edit('selectAll') },
        { type: 'separator' },
        // Sem acelerador: com "Shift+/" o menu engolia o "?" digitado no chat. O "?" fora de campo já abre a folha.
        { label: 'Atalhos do teclado (?)', click: () => void win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`) },
      ],
    },
    {
      label: 'Ver',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { label: 'Janela', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }])] },
    { label: 'Ajuda', submenu: [{ label: 'NewContent', click: () => void shell.openExternal('https://newcontent.com.br') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(url: string): Promise<void> {
  nativeTheme.themeSource = 'dark';
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0b0d12',
    title: origem === 'local' ? 'Editor Brain · só neste Mac (central da NewStudios fora do ar)' : 'Editor Brain',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  buildMenu(win);
  if (!HIDDEN) win.once('ready-to-show', () => win.show());
  // Links externos abrem no navegador do sistema; a janela só navega dentro do app.
  win.webContents.setWindowOpenHandler(({ url: u }) => (void shell.openExternal(u), { action: 'deny' }));
  win.webContents.on('will-navigate', (e, u) => {
    if (!u.startsWith(url)) (e.preventDefault(), void shell.openExternal(u));
  });
  await win.loadURL(url);
}

if (HIDDEN && isMac) app.dock?.hide();
app.setAboutPanelOptions({ applicationName: 'Editor Brain', applicationVersion: app.getVersion(), version: COMMIT, copyright: 'NewContent' });
app.whenReady().then(async () => {
  log('ready', HIDDEN ? '(modo oculto)' : '', { versao: app.getVersion(), commit: COMMIT });
  fixPath();
  resolveTools();
  try {
    const url = await startServer();
    await createWindow(url);
    log('janela aberta', url);
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && void createWindow(url));
    // No modo oculto, a janela só aparece se alguém pedir de propósito (ativar o app no Dock/Spotlight).
    if (HIDDEN) app.on('activate', () => BrowserWindow.getAllWindows()[0]?.show());
  } catch (e) {
    log('falhou ao abrir', e as Error);
    dialog.showErrorBox('Editor Brain não abriu', `${(e as Error).message}\n\nDiário: ${LOG_FILE}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
