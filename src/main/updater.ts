// Self-update from GitHub Releases. The app checks for a newer release, and on request downloads its zip,
// checks it against the checksum in the release, unpacks it next to the running app, and then — once the app has
// quit — a small detached script swaps the bundle in /Applications and relaunches. That is what a "drag the new
// version into Applications" does, without the dmg. Files fetched by the app itself carry no download quarantine,
// so the ad-hoc signed build opens without Gatekeeper prompts.

import { app, BrowserWindow, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { appBundlePath, LATEST_RELEASE_URL, newerRelease, notReplaceable, RELEASES_REPO, parseLatestYml, swapScript, type UpdateInfo } from '../backend/update';
import type { UpdateCheckResult, UpdateState } from '../types/ipc';

const run = promisify(execFile);
const CHECK_EVERY_MS = 6 * 60 * 60_000;

let pending: UpdateInfo | null = null;
let state: UpdateState = { kind: 'idle' };
let busy = false;

/** `WEBS_UPDATE_URL` points the check at another release feed (used for testing; not set in normal use). */
const feedUrl = () => process.env.WEBS_UPDATE_URL?.trim() || LATEST_RELEASE_URL;
const enabled = () => (app.isPackaged && process.platform === 'darwin') || !!process.env.WEBS_UPDATE_URL;

function push(next: UpdateState) {
  state = next;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', next);
}

export const currentState = () => state;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Webs-updater' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.json();
}

/** Look for a newer release. `quiet` swallows failures (background checks must never nag). */
export async function checkForUpdate(quiet = false): Promise<UpdateCheckResult> {
  if (!enabled()) return { status: 'current', message: 'Updates are checked in the installed app.' };
  if (busy) return { status: 'busy' };
  try {
    const release = await getJson(feedUrl());
    const found = newerRelease(release, app.getVersion(), process.arch);
    if (!found) { pending = null; if (state.kind === 'available') push({ kind: 'idle' }); return { status: 'current' }; }
    const yml = await (await fetch(found.yml, { signal: AbortSignal.timeout(15_000) })).text();
    const sum = parseLatestYml(yml, found.zip.name);
    if (!sum) throw new Error('The release has no checksum for its download.');
    pending = { version: found.version, notes: found.notes, zipName: found.zip.name, zipUrl: found.zip.url, zipSize: sum.size, sha512: sum.sha512, pageUrl: found.pageUrl };
    const why = notReplaceable(appBundlePath(process.execPath)) ?? (await writeProblem());
    push({ kind: 'available', version: found.version, notes: found.notes, pageUrl: found.pageUrl, canInstall: !why, ...(why ? { whyNot: why } : {}) });
    return { status: 'available', version: found.version };
  } catch (err) {
    if (quiet) return { status: 'error', message: '' };
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

async function writeProblem(): Promise<string | null> {
  const bundle = appBundlePath(process.execPath);
  if (!bundle) return null; // test feeds in dev; real installs are caught by notReplaceable
  try {
    await fs.promises.access(path.dirname(bundle), fs.constants.W_OK);
    await fs.promises.access(bundle, fs.constants.W_OK);
    return null;
  } catch {
    return `Webs can't write to ${path.dirname(bundle)}. Download the update and drag it in yourself.`;
  }
}

async function download(info: UpdateInfo, file: string, onPercent: (p: number) => void) {
  const res = await fetch(info.zipUrl, { headers: { 'User-Agent': 'Webs-updater' } });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
  const hash = createHash('sha512');
  let got = 0;
  const body = Readable.fromWeb(res.body as any);
  body.on('data', (chunk: Buffer) => { hash.update(chunk); got += chunk.length; onPercent(Math.min(99, Math.round((got / info.zipSize) * 100))); });
  await pipeline(body, fs.createWriteStream(file));
  if (got !== info.zipSize) throw new Error('The download was incomplete.');
  if (hash.digest('base64') !== info.sha512) throw new Error("The download didn't match its checksum, so it was discarded.");
}

/** Download, verify and stage the update, then hand over to the swap script and quit. */
export async function installUpdate(): Promise<void> {
  const info = pending;
  if (!info || busy) return;
  busy = true;
  const stage = path.join(app.getPath('userData'), 'updates', info.version);
  try {
    const bundle = appBundlePath(process.execPath);
    const why = notReplaceable(bundle) ?? (await writeProblem());
    if (why || !bundle) throw new Error(why ?? 'Cannot update in place.');

    await fs.promises.rm(stage, { recursive: true, force: true });
    await fs.promises.mkdir(stage, { recursive: true });
    const zip = path.join(stage, info.zipName);
    push({ kind: 'downloading', version: info.version, percent: 0 });
    await download(info, zip, percent => { if (state.kind === 'downloading' && percent !== state.percent) push({ kind: 'downloading', version: info.version, percent }); });

    push({ kind: 'installing', version: info.version });
    const out = path.join(stage, 'unpacked');
    await run('/usr/bin/ditto', ['-x', '-k', zip, out]);
    const newApp = path.join(out, path.basename(bundle));
    const { stdout } = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(newApp, 'Contents', 'Info.plist')]);
    if (stdout.trim() !== info.version) throw new Error(`The download contains version ${stdout.trim()}, not ${info.version}.`);
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', newApp]);

    const script = path.join(stage, 'swap.sh');
    await fs.promises.writeFile(script, swapScript({ pid: process.pid, newApp, dest: bundle, stageDir: stage }), { mode: 0o755 });
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  } catch (err) {
    await fs.promises.rm(stage, { recursive: true, force: true }).catch(() => {});
    busy = false;
    push({ kind: 'error', message: err instanceof Error ? err.message : String(err), pageUrl: info.pageUrl });
  }
}

export function openReleasePage() {
  void shell.openExternal(pending?.pageUrl ?? `https://github.com/${RELEASES_REPO}/releases`);
}

/** Check shortly after launch, then every few hours. */
export function startUpdateChecks() {
  if (!enabled()) return;
  setTimeout(() => void checkForUpdate(true), 8_000);
  setInterval(() => void checkForUpdate(true), CHECK_EVERY_MS).unref();
}
