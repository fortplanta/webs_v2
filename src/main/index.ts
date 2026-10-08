import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { runStrategy } from '../backend/strategies';
import { warmUp } from '../backend/llm';

// KB lives next to the project in dev; override with WEBS_KB_DIR.
process.env.WEBS_KB_DIR ??= path.resolve(app.getAppPath(), 'kb');

const running = new Map<string, AbortController>();
const key = (senderId: number, id: number) => `${senderId}:${id}`;

ipcMain.on('webs:start', async (e, id: number, query: string) => {
  const k = key(e.sender.id, id);
  const controller = new AbortController();
  running.set(k, controller);
  try {
    for await (const event of runStrategy(query, { signal: controller.signal })) {
      if (e.sender.isDestroyed()) break;
      e.sender.send('webs:event', id, event);
    }
  } finally {
    running.delete(k);
  }
});

ipcMain.on('webs:cancel', (e, id: number) => running.get(key(e.sender.id, id))?.abort());

let lastWarm = 0;
function warmOnce() {
  if (Date.now() - lastWarm < 5 * 60_000) return;
  lastWarm = Date.now();
  void warmUp();
}
ipcMain.on('webs:warmup', warmOnce);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => { warmOnce(); createWindow(); });
app.on('window-all-closed', () => app.quit());
