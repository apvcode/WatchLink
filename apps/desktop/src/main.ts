import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BaseWindow, clipboard, ipcMain, Menu, WebContentsView } from 'electron';

const dir = path.dirname(fileURLToPath(import.meta.url));
// Name the app before anything else: the Wayland app_id / X11 class (taskbar icon) and the
// name Chromium reports to PipeWire/PulseAudio (volume mixer) both come from it.
app.setName('WatchLink');
if (process.platform === 'linux') {
  // Linux only: desktop-entry name and PulseAudio stream properties (these APIs do not exist elsewhere).
  (app as unknown as { setDesktopName(name: string): void }).setDesktopName('watchlink.desktop');
  for (const key of ['PULSE_PROP_OVERRIDE', 'PULSE_PROP']) {
    process.env[key] =
      `${process.env[key] ?? ''} application.name='WatchLink' application.icon_name=watchlink application.process.binary=watchlink`.trim();
  }
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}
// Windows: taskbar grouping, pinning and the volume mixer entry are keyed on this id.
if (process.platform === 'win32') app.setAppUserModelId('com.apvcode.watchlink');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.WATCHLINK_PROFILE) app.setPath('userData', process.env.WATCHLINK_PROFILE);
let main: BaseWindow;
let ui: WebContentsView;
let content: WebContentsView;
let activeFrame: Electron.WebFrameMain | null = null;
let rect: { x: number; y: number; width: number; height: number } | null = null;
let hidden = false;
let loading = false;
let loadGeneration = 0;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
function notify(message: unknown) {
  if (ui?.webContents && !ui.webContents.isDestroyed())
    ui.webContents.send('watchlink:host', message);
}
function load(url: string) {
  const generation = ++loadGeneration;
  if (loadTimer) clearTimeout(loadTimer);
  content.webContents.stop();
  loading = url !== 'about:blank';
  notify({ type: 'watchlink:loading', loading });
  layout();
  if (loading)
    loadTimer = setTimeout(() => {
      if (generation !== loadGeneration) return;
      content.webContents.stop();
      loading = false;
      hidden = true;
      layout();
      notify({ type: 'watchlink:loading', loading: false });
      notify({
        type: 'watchlink:error',
        message:
          'Не удалось загрузить видео за 20 секунд. Проверьте интернет и разрешение WatchLink / Electron в файрволе. / Video loading timed out; check the network and firewall.',
      });
    }, 20000);
  void content.webContents.loadURL(url).catch((error) => {
    if (generation !== loadGeneration || error.code === 'ERR_ABORTED') return;
    if (loadTimer) clearTimeout(loadTimer);
    loading = false;
    hidden = true;
    layout();
    notify({ type: 'watchlink:loading', loading: false });
    notify({
      type: 'watchlink:error',
      message: `Не удалось загрузить видео / Video load failed: ${error.code ?? error.message}`,
    });
  });
}
function layout() {
  if (!content || !ui) return;
  const [width, height] = main.getContentSize();
  ui.setBounds({ x: 0, y: 0, width: width!, height: height! });
  content.setVisible(Boolean(rect) && !hidden && !loading);
  if (rect) content.setBounds(rect);
}
function allowed(raw: unknown): raw is string {
  try {
    return typeof raw === 'string' && ['https:', 'http:'].includes(new URL(raw).protocol);
  } catch {
    return false;
  }
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  main = new BaseWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'WatchLink',
    icon: path.join(dir, 'icon.png'),
    backgroundColor: '#0B0D12',
    autoHideMenuBar: true,
  });
  content = new WebContentsView({
    webPreferences: {
      preload: path.join(dir, 'preload-content.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  ui = new WebContentsView({
    webPreferences: {
      preload: path.join(dir, 'preload-ui.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // The UI view sits above the video and is transparent over it, so controls can overlay playback.
  main.contentView.addChildView(content);
  main.contentView.addChildView(ui);
  ui.setBackgroundColor('#00000000');
  // Electron grants every permission request by default: sites in the video view must not get
  // camera, microphone, location, notifications... Only the app's own UI and fullscreen pass.
  const ses = content.webContents.session;
  ses.setPermissionRequestHandler((wc, permission, callback) =>
    callback(wc === ui.webContents || permission === 'fullscreen'),
  );
  ses.setPermissionCheckHandler(
    (wc, permission) => wc === ui.webContents || permission === 'fullscreen',
  );
  content.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ui.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  content.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
  content.webContents.on('will-redirect', (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
  ui.webContents.on('will-navigate', (event) => event.preventDefault());
  content.webContents.session.on('will-download', (event) => event.preventDefault());
  content.webContents.on('did-start-navigation', (_event, _url, inPlace, isMain) => {
    if (isMain && !inPlace) activeFrame = null;
  });
  content.setBackgroundColor('#0B0D12');
  // Present as plain Chromium: sites such as YouTube withhold features (e.g. subtitles) from "Electron" clients.
  content.webContents.setUserAgent(
    content.webContents.getUserAgent().replace(/\s(Electron|@?watchlink[^\s]*)\/\S+/gi, ''),
  );
  content.webContents.on('dom-ready', () => {
    if (loadTimer) clearTimeout(loadTimer);
    loading = false;
    notify({ type: 'watchlink:loading', loading: false });
    layout();
  });
  ipcMain.on('watchlink:content', (event, data) => {
    if (
      event.sender.id !== content.webContents.id ||
      !event.senderFrame ||
      !data ||
      JSON.stringify(data).length > 8192
    )
      return;
    if (data.type === 'watchlink:state' && data.state?.duration > 0)
      activeFrame = event.senderFrame;
    if (activeFrame && event.senderFrame !== activeFrame) return;
    ui.webContents.send('watchlink:host', data);
  });
  ipcMain.on('watchlink:ui', (event, data) => {
    if (
      event.sender.id !== ui.webContents.id ||
      event.senderFrame?.routingId !== ui.webContents.mainFrame.routingId ||
      !data ||
      JSON.stringify(data).length > 8192
    )
      return;
    if (data.type === 'copy' && typeof data.text === 'string') clipboard.writeText(data.text);
    if (data.type === 'load' && allowed(data.url)) load(data.url);
    if (data.type === 'bounds') {
      const r = data.rect;
      rect =
        r && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(r[key]) && r[key] >= 0)
          ? {
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height),
            }
          : null;
      hidden = Boolean(data.hidden);
      layout();
    }
    if (
      data.type === 'command' &&
      [
        'play',
        'pause',
        'seek',
        'rate',
        'quality',
        'audio',
        'captions',
        'ambient',
        'getState',
      ].includes(data.action)
    ) {
      const command = {
        type: `watchlink:cmd:${data.action}`,
        position: data.position,
        rate: data.rate,
        on: data.on === true,
        quality: typeof data.quality === 'string' ? data.quality.slice(0, 12) : undefined,
        id: typeof data.id === 'string' ? data.id.slice(0, 160) : undefined,
      };
      (activeFrame ?? content.webContents.mainFrame).send('watchlink:command', command);
    }
    if (data.type === 'fullscreen') main.setFullScreen(Boolean(data.on));
    if (data.type === 'clear') {
      rect = null;
      activeFrame = null;
      layout();
      load('about:blank');
    }
  });
  main.setMenuBarVisibility(false);
  main.on('resize', layout);
  main.on('closed', () => {
    if (loadTimer) clearTimeout(loadTimer);
    loadGeneration++;
    ui.webContents.close();
    content.webContents.close();
  });
  if (process.env.WATCHLINK_DEV_URL) await ui.webContents.loadURL(process.env.WATCHLINK_DEV_URL);
  else await ui.webContents.loadFile(path.join(dir, 'ui/index.html'));
  layout();
});
app.on('window-all-closed', () => app.quit());
