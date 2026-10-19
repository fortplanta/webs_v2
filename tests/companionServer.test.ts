import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCompanionServer, type CompanionServer } from '../src/backend/companion/server';
import { readJournal, readResult } from '../src/backend/companion/journal';
import type { CompanionEvent, CompanionRequest } from '../src/backend/companion/run';

let server: CompanionServer | null = null;
let dir = '';
afterEach(async () => { await server?.close(); server = null; if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

async function start(run: (req: CompanionRequest, signal: AbortSignal) => AsyncGenerator<CompanionEvent>) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-'));
  server = await startCompanionServer({ run, dir, version: 'test' });
  return { url: `http://127.0.0.1:${server.port}`, auth: { Authorization: `Bearer ${server.token}` } };
}
const finishes = async function* (req: CompanionRequest): AsyncGenerator<CompanionEvent> {
  yield { type: 'start', title: 'Thing', steps: 1 };
  yield { type: 'text', chunk: `you said: ${req.text}` };
  yield { type: 'done', title: 'Thing', markdown: `you said: ${req.text}` };
};
const post = (url: string, headers: Record<string, string>, body: unknown) => fetch(`${url}/run`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const lines = async (res: Response) => (await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l));

describe('the companion server', () => {
  it('only opens to the token written to its endpoint file', async () => {
    const { url, auth } = await start(finishes);
    expect((await fetch(`${url}/health`)).status).toBe(401);
    expect((await fetch(`${url}/health`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect(await (await fetch(`${url}/health`, { headers: auth })).json()).toEqual({ ok: true, version: 'test' });
    const ep = JSON.parse(fs.readFileSync(path.join(dir, 'endpoint.json'), 'utf8'));
    expect(ep).toMatchObject({ port: server!.port, token: server!.token, pid: process.pid });
  });

  it('streams a run as one JSON object per line, then records it and keeps the result', async () => {
    const { url, auth } = await start(finishes);
    const res = await post(url, auth, { id: 'run-12345678', mode: 'shift', action: 'devils-advocate', text: 'Losses loom larger.', source: { app: 'Safari', url: 'https://x.test' } });
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    const events = await lines(res);
    expect(events.map(e => e.type)).toEqual(['accepted', 'start', 'text', 'done']);
    expect(events[0].id).toBe('run-12345678');
    const entry = readJournal(dir).find(e => e.id === 'run-12345678')!;
    expect(entry).toMatchObject({ status: 'done', title: 'Thing', mode: 'shift', action: 'devils-advocate', text: 'Losses loom larger.', source: { app: 'Safari' } });
    expect(readResult('run-12345678', dir)).toMatchObject({ markdown: 'you said: Losses loom larger.', mode: 'shift' });
  });

  it('records keeps and errors without a result file', async () => {
    const { url, auth } = await start(async function* (req) { if (req.action === 'send-to-webs') yield { type: 'kept', action: req.action, label: 'Send to Webs' }; else yield { type: 'error', message: 'no model' }; });
    await (await post(url, auth, { id: 'keep-1234567', mode: 'shift+control', action: 'send-to-webs', text: 'x' })).text();
    await (await post(url, auth, { id: 'fail-1234567', mode: 'shift', action: 'analyze', text: 'x' })).text();
    const j = readJournal(dir);
    expect(j.find(e => e.id === 'keep-1234567')).toMatchObject({ status: 'kept', label: 'Send to Webs' });
    expect(j.find(e => e.id === 'fail-1234567')).toMatchObject({ status: 'error', error: 'no model' });
    expect(readResult('fail-1234567', dir)).toBeNull();
  });

  it('stops the run when the companion gives up (Esc), and says so in the journal', async () => {
    let aborted = false;
    const { url, auth } = await start(async function* (_req, signal) {
      yield { type: 'start', title: 'Slow', steps: 1 };
      await new Promise<void>(r => signal.addEventListener('abort', () => { aborted = true; r(); }));
    });
    const controller = new AbortController();
    const res = await fetch(`${url}/run`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'cancel-123456', mode: 'shift', action: 'analyze', text: 'x' }), signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();   // the first events arrive…
    controller.abort();    // …then the companion hangs up
    await new Promise(r => setTimeout(r, 300));
    expect(aborted).toBe(true);
    expect(readJournal(dir).find(e => e.id === 'cancel-123456')?.status).toBe('cancelled');
  });

  it('rejects malformed, oversized and unknown requests', async () => {
    const { url, auth } = await start(finishes);
    expect((await post(url, auth, { mode: 'shift' })).status).toBe(400);
    expect((await fetch(`${url}/run`, { method: 'POST', headers: auth, body: '{nope' })).status).toBe(400);
    expect((await post(url, auth, { mode: 'shift', action: 'analyze', text: 'x'.repeat(20_001) })).status).toBe(413);
    expect((await fetch(`${url}/elsewhere`, { headers: auth })).status).toBe(404);
  });
});
