import type { WebsApi } from '../types/ipc';
declare global { interface Window { webs: WebsApi } }
export {};
