import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runStrategy, strategies } from '../backend/strategies';
import { listOllamaModels, warmUp } from '../backend/llm';
import { listKbModules } from '../backend/kb';
import { defaultSettings, getSettings, getSettingsOverrides, mergePatches, setSettingsOverrides, validatePatch } from '../backend/settings';
import type { SaveSettingsResult, SettingsBundle, SettingsPatch } from '../types/settings';
import { WebStore } from '../backend/db';

// KB lives next to the project in dev; override with WEBS_KB_DIR.
process.env.WEBS_KB_DIR ??= path.resolve(app.getAppPath(), 'kb');

let store: WebStore;
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

ipcMain.handle('webs:list', () => store.list());
ipcMain.handle('webs:load', (_e, id: string) => store.get(id));
ipcMain.handle('webs:save', (_e, input) => store.save(input));
ipcMain.handle('webs:delete', (_e, id: string) => store.delete(id));

const SETTINGS_KEY = 'settings';

async function settingsBundle(): Promise<SettingsBundle> {
  const settings = getSettings();
  return { settings, defaults: defaultSettings(), strategies: Object.keys(strategies), modules: await listKbModules(settings.kb.dir) };
}

ipcMain.handle('settings:get', () => settingsBundle());

ipcMain.handle('settings:save', async (_e, patch: SettingsPatch): Promise<SaveSettingsResult> => {
  const { value, errors } = validatePatch(patch, Object.keys(strategies));
  if (value.kb?.dir !== undefined && !errors['kb.dir']) {
    const isDir = await fs.stat(value.kb.dir).then(st => st.isDirectory(), () => false);
    if (!isDir) errors['kb.dir'] = 'That folder does not exist.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const next = mergePatches(getSettingsOverrides(), value);
  store.setSetting(SETTINGS_KEY, next);
  setSettingsOverrides(next);
  return { ok: true, bundle: await settingsBundle() };
});

ipcMain.handle('settings:reset', async () => {
  store.deleteSetting(SETTINGS_KEY);
  setSettingsOverrides({});
  return settingsBundle();
});

ipcMain.handle('settings:ollama-models', (_e, baseUrl: string) => listOllamaModels(baseUrl));
ipcMain.handle('settings:kb-modules', (_e, dir: string) => listKbModules(dir));
ipcMain.handle('settings:pick-kb-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: getSettings().kb.dir });
  return r.canceled ? null : r.filePaths[0];
});

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

app.whenReady().then(() => {
  store = new WebStore(process.env.WEBS_DB?.trim() || path.join(app.getPath('userData'), 'webs.db'));
  setSettingsOverrides(store.getSetting<SettingsPatch>(SETTINGS_KEY) ?? {});
  warmOnce();
  createWindow();
});
app.on('will-quit', () => store?.close());
app.on('window-all-closed', () => app.quit());
