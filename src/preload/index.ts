import { contextBridge, ipcRenderer } from 'electron';
import type { PivotEvent, WebEvent } from '../backend/events';
import type { UpdateState, WebsApi } from '../types/ipc';

let nextId = 1;

const api: WebsApi = {
  generate(query, onEvent) {
    const id = nextId++;
    const handler = (_e: unknown, evId: number, event: WebEvent) => {
      if (evId !== id) return;
      onEvent(event);
      if (event.type === 'done' || event.type === 'error') ipcRenderer.removeListener('webs:event', handler);
    };
    ipcRenderer.on('webs:event', handler);
    ipcRenderer.send('webs:start', id, query);
    return () => {
      ipcRenderer.removeListener('webs:event', handler);
      ipcRenderer.send('webs:cancel', id);
    };
  },
  pivot(req, onEvent) {
    const id = nextId++;
    const handler = (_e: unknown, evId: number, event: PivotEvent) => {
      if (evId !== id) return;
      onEvent(event);
      if (event.type === 'done' || event.type === 'error') ipcRenderer.removeListener('webs:pivot-event', handler);
    };
    ipcRenderer.on('webs:pivot-event', handler);
    ipcRenderer.send('webs:pivot-start', id, req);
    return () => {
      ipcRenderer.removeListener('webs:pivot-event', handler);
      ipcRenderer.send('webs:pivot-cancel', id);
    };
  },
  warmUp() { ipcRenderer.send('webs:warmup'); },
  connect: req => ipcRenderer.invoke('webs:connect', req),
  lens: req => ipcRenderer.invoke('webs:lens', req),
  listWebs: () => ipcRenderer.invoke('webs:list'),
  loadWeb: id => ipcRenderer.invoke('webs:load', id),
  saveWeb: input => ipcRenderer.invoke('webs:save', input),
  deleteWeb: id => ipcRenderer.invoke('webs:delete', id),
  saveFile: (webId, file) => ipcRenderer.invoke('webs:save-file', webId, file),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  listOllamaModels: baseUrl => ipcRenderer.invoke('settings:ollama-models', baseUrl),
  listKbModules: dir => ipcRenderer.invoke('settings:kb-modules', dir),
  pickKbFolder: () => ipcRenderer.invoke('settings:pick-kb-folder'),
  revealKbFolder: () => ipcRenderer.invoke('settings:reveal-kb'),
  clearAiKey: () => ipcRenderer.invoke('settings:clear-ai-key'),
  testAi: () => ipcRenderer.invoke('settings:test-ai'),
  getInbox: () => ipcRenderer.invoke('capture:inbox'),
  fileCapture: (id, nodeId) => ipcRenderer.invoke('capture:file', id, nodeId),
  dismissCapture: id => ipcRenderer.invoke('capture:dismiss', id),
  getVersion: () => ipcRenderer.invoke('update:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openReleasePage: () => ipcRenderer.invoke('update:open-page'),
  onUpdateState(cb) {
    const handler = (_e: unknown, s: UpdateState) => cb(s);
    ipcRenderer.on('update:state', handler);
    void ipcRenderer.invoke('update:state').then(cb);
    return () => { ipcRenderer.removeListener('update:state', handler); };
  },
  testCapture: (url, token) => ipcRenderer.invoke('capture:test', url, token),
};

contextBridge.exposeInMainWorld('webs', api);
