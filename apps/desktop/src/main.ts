/**
 * Editor Brain como app de desktop (Mac e Windows), como o CapCut:
 * o servidor (Fastify) sobe num processo auxiliar (utilityProcess, como o VEHelper do CapCut) e a janela abre
 * a interface nele. Um render ou uma decupagem longa não disputa a thread da janela e dos menus; se o auxiliar
 * não subir, o servidor roda dentro do processo principal (reserva), e o diário conta qual dos dois foi.
 *
 *  · desenvolvimento: NEWEDITOR_DEV_URL=http://localhost:5173 (Vite + servidor de `npm run dev`)
 *  · empacotado: servidor em resources/app-root, dados em ~/Library/Application Support/Editor Brain/data
 */
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.NEWEDITOR_DEV_URL;
const isMac = process.platform === 'darwin';

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

/** Sobe o servidor (auxiliar; reserva no processo principal) e devolve a URL da interface. */
async function startServer(): Promise<string> {
  if (DEV_URL) return DEV_URL;
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
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: 'Editor Brain', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
    {
      label: 'Arquivo',
      submenu: [
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
      // Sem desfazer/refazer/selecionar tudo aqui: o editor trata ⌘Z, ⇧⌘Z e ⌘A na própria timeline.
      label: 'Editar',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { label: 'Atalhos do teclado', accelerator: 'Shift+/', click: () => void win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`) }],
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
    title: 'Editor Brain',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  buildMenu(win);
  win.once('ready-to-show', () => win.show());
  // Links externos abrem no navegador do sistema; a janela só navega dentro do app.
  win.webContents.setWindowOpenHandler(({ url: u }) => (void shell.openExternal(u), { action: 'deny' }));
  win.webContents.on('will-navigate', (e, u) => {
    if (!u.startsWith(url)) (e.preventDefault(), void shell.openExternal(u));
  });
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  log('ready');
  fixPath();
  try {
    const url = await startServer();
    await createWindow(url);
    log('janela aberta', url);
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && void createWindow(url));
  } catch (e) {
    log('falhou ao abrir', e as Error);
    dialog.showErrorBox('Editor Brain não abriu', `${(e as Error).message}\n\nDiário: ${LOG_FILE}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
