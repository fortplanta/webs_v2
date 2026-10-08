import { contextBridge, ipcRenderer } from 'electron';
import type { WebEvent } from '../backend/events';
import type { WebsApi } from '../types/ipc';

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
  warmUp() { ipcRenderer.send('webs:warmup'); },
  listWebs: () => ipcRenderer.invoke('webs:list'),
  loadWeb: id => ipcRenderer.invoke('webs:load', id),
  saveWeb: input => ipcRenderer.invoke('webs:save', input),
  deleteWeb: id => ipcRenderer.invoke('webs:delete', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  listOllamaModels: baseUrl => ipcRenderer.invoke('settings:ollama-models', baseUrl),
  listKbModules: dir => ipcRenderer.invoke('settings:kb-modules', dir),
  pickKbFolder: () => ipcRenderer.invoke('settings:pick-kb-folder'),
  getInbox: () => ipcRenderer.invoke('capture:inbox'),
  fileCapture: (id, nodeId) => ipcRenderer.invoke('capture:file', id, nodeId),
  dismissCapture: id => ipcRenderer.invoke('capture:dismiss', id),
  testCapture: (url, token) => ipcRenderer.invoke('capture:test', url, token),
};

contextBridge.exposeInMainWorld('webs', api);
