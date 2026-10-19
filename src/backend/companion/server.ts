// The local door the Webs Companion app knocks on. It listens only on this computer, answers only requests carrying the
// token Webs wrote to its endpoint file, and streams a run's events back as one JSON object per line. Long answers are
// written here, inside Webs, using the same engine, voice and library as the canvas, and the finished text is handed back
// for the companion to show in its floating window.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { appendJournal, companionDir, writeResult } from './journal';
import type { CompanionEvent, CompanionRequest } from './run';

export interface ServerOptions {
  /** Runs an action; ends with a 'done', 'kept' or 'error' event. */
  run: (req: CompanionRequest, signal: AbortSignal) => AsyncGenerator<CompanionEvent>;
  dir?: string;
  version?: string;
}

export interface CompanionServer { port: number; token: string; close(): Promise<void> }

const MAX_BODY = 200_000;
const MAX_TEXT = 20_000;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export async function startCompanionServer(opts: ServerOptions): Promise<CompanionServer> {
  const dir = opts.dir ?? companionDir();
  const token = crypto.randomBytes(24).toString('hex');
  const send = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    try {
      const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!auth || !safeEqual(auth, token)) return send(res, 401, { error: 'unauthorised' });
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, version: opts.version ?? '' });
      if (req.method !== 'POST' || req.url !== '/run') return send(res, 404, { error: 'not found' });

      let body: Partial<CompanionRequest> & { id?: string };
      try { body = JSON.parse(await readBody(req)); } catch (err) { return send(res, (err as { status?: number }).status ?? 400, { error: 'bad request' }); }
      if (typeof body.mode !== 'string' || typeof body.action !== 'string' || typeof body.text !== 'string') return send(res, 400, { error: 'mode, action and text are required' });
      if (body.text.length > MAX_TEXT) return send(res, 413, { error: `the selection is too long (over ${MAX_TEXT} characters)` });

      const id = (typeof body.id === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(body.id) ? body.id : crypto.randomUUID());
      const request: CompanionRequest = { mode: body.mode, action: body.action, text: body.text, ...(body.source && typeof body.source === 'object' ? { source: body.source } : {}) };
      const controller = new AbortController();
      let finished = false;
      res.on('close', () => { if (!finished) controller.abort(); }); // the companion gave up (Esc): stop the run
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      const emit = (e: unknown) => { if (!res.writableEnded) res.write(`${JSON.stringify(e)}\n`); };
      emit({ type: 'accepted', id });
      appendJournal({ id, at: new Date().toISOString(), status: 'running', mode: request.mode, action: request.action, text: request.text, source: request.source }, dir);

      let last: CompanionEvent | undefined;
      for await (const e of opts.run(request, controller.signal)) { last = e; emit(e); }
      finished = true;
      if (controller.signal.aborted) { appendJournal({ id, at: new Date().toISOString(), status: 'cancelled' }, dir); return void res.end(); }
      if (last?.type === 'done') {
        writeResult({ id, title: last.title, markdown: last.markdown, finishedAt: new Date().toISOString(), mode: request.mode, action: request.action, text: request.text, source: request.source }, dir);
        appendJournal({ id, at: new Date().toISOString(), status: 'done', title: last.title }, dir);
      } else if (last?.type === 'kept') appendJournal({ id, at: new Date().toISOString(), status: 'kept', label: last.label }, dir);
      else appendJournal({ id, at: new Date().toISOString(), status: 'error', error: last?.type === 'error' ? last.message : 'no result' }, dir);
      res.end();
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: err instanceof Error ? err.message : String(err) }); else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  // where the companion finds the door
  const endpointFile = path.join(dir, 'endpoint.json');
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(endpointFile, JSON.stringify({ port, token, pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 }); } catch (err) { console.warn('Could not write the companion endpoint file:', err); }

  return {
    port, token,
    close: () => new Promise<void>(resolve => {
      try { if (JSON.parse(fs.readFileSync(endpointFile, 'utf8')).pid === process.pid) fs.rmSync(endpointFile, { force: true }); } catch { /* already gone */ }
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
