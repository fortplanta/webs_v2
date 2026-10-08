// Client for the webs-capture service (the user's capture inbox: phone Shortcuts, browser extension).
// Runs in the main process so the token never needs to live in the renderer's network stack.
//
// The service stores either a `url` (pointer) or `text` capture, not both. The browser extension
// therefore appends a source footer to selections; parseSourceFooter() reads it back.

import { getSettings } from './settings';
import type { CaptureTestResult, InboxItem, InboxResult } from '../types/capture';

const TIMEOUT_MS = 5000;

/** Footer written by extension/capture.js:  "<selection>\n\n— <title>\n<url>" */
const FOOTER = /\n\n— ([^\n]*)\n(https?:\/\/\S+)\s*$/;

export function parseSourceFooter(text: string): { text: string; title?: string; url?: string } {
  const m = FOOTER.exec(text);
  if (!m) return { text };
  return { text: text.slice(0, m.index).trimEnd(), title: m[1].trim() || undefined, url: m[2] };
}

interface RawCapture {
  id: string;
  kind: 'image' | 'text' | 'pointer' | 'file';
  channel: string;
  device: string;
  created_at: string;
  pointer?: { url: string; t_start_seconds?: number };
  text?: string;
  derived?: { title?: string };
}

export function toInboxItem(c: RawCapture): InboxItem | null {
  const base = { id: c.id, channel: c.channel, device: c.device, createdAt: c.created_at };
  if (c.kind === 'pointer' && c.pointer) {
    return { ...base, kind: 'pointer', url: c.pointer.url, title: c.derived?.title, startSeconds: c.pointer.t_start_seconds };
  }
  if (c.kind === 'text' && c.text) {
    const parsed = parseSourceFooter(c.text);
    return { ...base, kind: 'text', text: parsed.text, url: parsed.url, title: parsed.title ?? c.derived?.title };
  }
  return null; // image/file: not placeable yet
}

function config(): { url: string; token: string } | null {
  const { url, token } = getSettings().capture;
  return url ? { url, token } : null;
}

async function request(cfg: { url: string; token: string }, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${cfg.url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function failure(cfg: { url: string }, err: unknown): { ok: false; message: string } {
  if (err instanceof Error && err.name === 'TimeoutError') return { ok: false, message: `The capture service at ${cfg.url} took too long to respond.` };
  return { ok: false, message: `Can't reach the capture service at ${cfg.url}.` };
}

/** Captures waiting to be filed (received or ready), newest first. */
export async function listInbox(): Promise<InboxResult> {
  const cfg = config();
  if (!cfg) return { ok: false, message: 'Capture service not configured (Settings → Capture).' };
  try {
    const res = await request(cfg, '/captures?status=received,ready&limit=100');
    if (res.status === 401) return { ok: false, message: 'The capture service rejected the token.' };
    if (!res.ok) return { ok: false, message: `The capture service returned ${res.status}.` };
    const data = (await res.json()) as { items?: RawCapture[] } | RawCapture[];
    const raw = Array.isArray(data) ? data : data.items ?? [];
    const items = raw.map(toInboxItem).filter((i): i is InboxItem => i !== null);
    return { ok: true, items, unsupported: raw.length - items.length };
  } catch (err) {
    return failure(cfg, err);
  }
}

async function patch(id: string, body: object): Promise<{ ok: boolean; message?: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, message: 'Capture service not configured.' };
  try {
    const res = await request(cfg, `/captures/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    return res.ok ? { ok: true } : { ok: false, message: `The capture service returned ${res.status}.` };
  } catch (err) {
    return { ok: false, message: failure(cfg, err).message };
  }
}

export const markFiled = (id: string, nodeId: string) => patch(id, { status: 'filed', filed_node_id: nodeId });
export const markComposted = (id: string) => patch(id, { status: 'composted' });

/** Checks reachability (health, unauthenticated) and the token (an authenticated list). Uses the given values, not saved ones. */
export async function testCapture(url: string, token: string): Promise<CaptureTestResult> {
  const cfg = { url: url.trim().replace(/\/+$/, ''), token: token.trim() };
  if (!cfg.url) return { ok: false, message: 'Enter the capture service URL first.' };
  try {
    const health = await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!health.ok) return { ok: false, message: `The service answered ${health.status} on /health. Is that the capture service?` };
    const list = await request(cfg, '/captures?limit=1');
    if (list.status === 401) return { ok: false, message: 'Reachable, but the token was rejected.' };
    if (!list.ok) return { ok: false, message: `Reachable, but listing failed (${list.status}).` };
    const h = (await health.json().catch(() => ({}))) as { captures_total?: number };
    return { ok: true, message: `Connected${typeof h.captures_total === 'number' ? ` · ${h.captures_total} captures stored` : ''}` };
  } catch (err) {
    return failure(cfg, err);
  }
}
