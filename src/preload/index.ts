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
};

contextBridge.exposeInMainWorld('webs', api);
