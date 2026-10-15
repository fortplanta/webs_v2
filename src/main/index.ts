import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { listLibraries } from '../backend/library/service';
import { testProvider } from '../backend/provider';
import { checkForUpdate, currentState, installUpdate, openReleasePage, startUpdateChecks } from './updater';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runStrategy, strategies } from '../backend/strategies';
import { runPivot } from '../backend/pivot';
import { runLens } from '../backend/lenses';
import { judgeConnection } from '../backend/connections';
import { listOllamaModels, warmUp } from '../backend/llm';
import { listKbModules } from '../backend/kb';
import { listInbox, markComposted, markFiled, testCapture } from '../backend/capture';
import { defaultSettings, getSettings, getSettingsOverrides, mergePatches, setSettingsOverrides, validatePatch, publicSettings, setSecretCodec } from '../backend/settings';
import type { SaveSettingsResult, SettingsBundle, SettingsPatch } from '../types/settings';
import { WebStore } from '../backend/db';

import { migrateLegacyDb, seedKb } from '../backend/firstRun';

// A packaged app runs a single instance (two would write the same database). Dev builds are exempt, so
// `npm run dev` still works while the packaged app is open.
if (app.isPackaged && !app.requestSingleInstanceLock()) app.quit();

/**
 * Where the knowledge base lives unless WEBS_KB_DIR or Settings say otherwise: the repo's kb/ in dev; in a
 * packaged app a writable ~/Documents/Webs/KB, created from the bundled sample notes on first launch.
 */
async function resolveDefaultKbDir(): Promise<string> {
  if (!app.isPackaged) return path.resolve(app.getAppPath(), 'kb');
  const dir = path.join(app.getPath('documents'), 'Webs', 'KB');
  await seedKb(path.join(process.resourcesPath, 'kb-sample'), dir).catch(err => console.warn('Could not seed the sample KB:', err));
  return dir;
}

let store: WebStore;

/** Seals the AI API key with the OS keychain (Electron safeStorage); falls back to plain text where that isn't available. */
function keychainCodec() {
  const ok = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
  return {
    encrypt: (plain: string) => (ok() ? `enc1:${safeStorage.encryptString(plain).toString('base64')}` : `plain:${plain}`),
    decrypt: (stored: string) => {
      if (stored.startsWith('plain:')) return stored.slice(6);
      if (!stored.startsWith('enc1:')) return stored;
      try { return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64')); } catch { return ''; }
    },
  };
}
// The production renderer is served from webs://app/ rather than file://. Chromium won't fetch() file: URLs,
// which Excalidraw uses to load its (locally bundled) fonts, and a real origin is safer in general.
const APP_SCHEME = 'webs';
const APP_ORIGIN = `${APP_SCHEME}://app`;
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

function serveRenderer() {
  const root = path.join(__dirname, '../renderer');
  protocol.handle(APP_SCHEME, req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 }); // no escaping the renderer folder
    return net.fetch(pathToFileURL(file).toString());
  });
}

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

ipcMain.on('webs:pivot-start', async (e, id: number, req) => {
  const k = `pivot:${key(e.sender.id, id)}`;
  const controller = new AbortController();
  running.set(k, controller);
  try {
    for await (const event of runPivot(req, { signal: controller.signal })) {
      if (e.sender.isDestroyed()) break;
      e.sender.send('webs:pivot-event', id, event);
    }
  } finally {
    running.delete(k);
  }
});
ipcMain.on('webs:pivot-cancel', (e, id: number) => running.get(`pivot:${key(e.sender.id, id)}`)?.abort());

ipcMain.handle('webs:connect', (_e, req) => judgeConnection(req));
ipcMain.handle('webs:lens', (_e, req) => runLens(req));
ipcMain.handle('webs:list', () => store.list());
ipcMain.handle('webs:load', (_e, id: string) => store.get(id));
ipcMain.handle('webs:save', (_e, input) => store.save(input));
ipcMain.handle('webs:delete', (_e, id: string) => store.delete(id));
ipcMain.handle('webs:save-file', (_e, webId: string, file) => {
  try { store.saveFile(webId, file); return { ok: true }; } catch (err) { return { ok: false, message: (err as Error).message }; }
});

const SETTINGS_KEY = 'settings';

async function settingsBundle(): Promise<SettingsBundle> {
  const settings = getSettings();
  // The API key stays in this process: the renderer only learns whether one is saved.
  return { settings: publicSettings(settings), defaults: defaultSettings(), strategies: Object.keys(strategies), modules: await listKbModules(settings.kb.dir), aiKeySet: !!settings.ai.apiKey, libraries: listLibraries(settings.library.dir) };
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

ipcMain.handle('settings:clear-ai-key', async () => {
  const next = mergePatches(getSettingsOverrides(), { ai: { apiKey: '' } });
  store.setSetting(SETTINGS_KEY, next);
  setSettingsOverrides(next);
  return settingsBundle();
});
ipcMain.handle('settings:test-ai', () => testProvider());

ipcMain.handle('settings:reset', async () => {
  store.deleteSetting(SETTINGS_KEY);
  setSettingsOverrides({});
  return settingsBundle();
});

ipcMain.handle('settings:reveal-kb', async () => (await shell.openPath(getSettings().kb.dir)) || null); // '' on success, else an error message
ipcMain.handle('settings:ollama-models', (_e, baseUrl: string) => listOllamaModels(baseUrl));
ipcMain.handle('settings:kb-modules', (_e, dir: string) => listKbModules(dir));
ipcMain.handle('settings:pick-kb-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: getSettings().kb.dir });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('update:version', () => app.getVersion());
ipcMain.handle('update:state', () => currentState());
ipcMain.handle('update:check', () => checkForUpdate());
ipcMain.handle('update:install', () => installUpdate());
ipcMain.handle('update:open-page', () => openReleasePage());
ipcMain.handle('capture:inbox', () => listInbox());
ipcMain.handle('capture:file', (_e, id: string, nodeId: string) => markFiled(id, nodeId));
ipcMain.handle('capture:dismiss', (_e, id: string) => markComposted(id));
ipcMain.handle('capture:test', (_e, url: string, token: string) => testCapture(url, token));

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
  // Links on cards open in the user's browser; the app window never navigates away or spawns windows.
  const openExternal = (url: string) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL;
    if (dev && new URL(url).origin === new URL(dev).origin) return; // dev-server reloads
    if (url.startsWith(`${APP_ORIGIN}/`)) return; // the app's own pages
    e.preventDefault();
    openExternal(url);
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadURL(`${APP_ORIGIN}/index.html`);
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
  const dbFile = process.env.WEBS_DB?.trim() || path.join(app.getPath('userData'), 'webs.db');
  if (!process.env.WEBS_DB) {
    // This app used to store its data under the package name; bring that library across once.
    try { migrateLegacyDb(path.join(app.getPath('appData'), 'webs-v1a', 'webs.db'), dbFile); }
    catch (err) { console.warn('Could not migrate the earlier library:', err); }
  }
  process.env.WEBS_KB_DIR ??= await resolveDefaultKbDir();
  process.env.WEBS_LIBRARY_DIR ??= path.join(app.getPath('documents'), 'Webs', 'Libraries');
  store = new WebStore(dbFile);
  setSettingsOverrides(store.getSetting<SettingsPatch>(SETTINGS_KEY) ?? {});
  setSecretCodec(keychainCodec());
  serveRenderer();
  warmOnce();
  createWindow();
  startUpdateChecks();
});
app.on('will-quit', () => store?.close());
app.on('window-all-closed', () => app.quit());
