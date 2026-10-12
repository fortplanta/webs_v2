// Pure logic for self-updating from GitHub Releases: which release is newer, where its files are, how to check
// them, and the shell script that swaps the app bundle once the app has quit. No Electron here, so it can be tested.

export const RELEASES_REPO = 'fortplanta/webs_v2';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

export interface UpdateInfo {
  version: string;
  notes: string;
  zipName: string;
  zipUrl: string;
  zipSize: number;
  /** base64 sha512 of the zip, from the release's latest-mac.yml */
  sha512: string;
  pageUrl: string;
}

/** Compares dotted numeric versions ("0.10.1" > "0.9.9"); a leading "v" and any "-suffix" are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

interface ReleaseJson {
  tag_name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name: string; browser_download_url: string; size: number }>;
}

export const zipNameFor = (version: string, arch: string) => `Webs-${version}-${arch}-mac.zip`;

/** The checksum and size electron-builder records for `zipName` in latest-mac.yml. */
export function parseLatestYml(text: string, zipName: string): { sha512: string; size: number } | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(`url: ${zipName}`)) continue;
    const sha = /sha512:\s*(\S+)/.exec(lines[i + 1] ?? '')?.[1];
    const size = Number(/size:\s*(\d+)/.exec(lines[i + 2] ?? '')?.[1]);
    if (sha && size > 0) return { sha512: sha, size };
  }
  return null;
}

/** Everything needed from the release JSON to decide on and locate an update (checksum comes separately). */
export function newerRelease(release: ReleaseJson, current: string, arch: string): { version: string; zip: { name: string; url: string; size: number }; yml: string; notes: string; pageUrl: string } | null {
  if (release.draft || release.prerelease || !release.tag_name) return null;
  const version = release.tag_name.replace(/^v/i, '');
  if (compareVersions(version, current) <= 0) return null;
  const zipName = zipNameFor(version, arch);
  const zip = release.assets?.find(a => a.name === zipName);
  const yml = release.assets?.find(a => a.name === 'latest-mac.yml');
  if (!zip || !yml) return null; // release not fully uploaded yet
  return { version, zip: { name: zip.name, url: zip.browser_download_url, size: zip.size }, yml: yml.browser_download_url, notes: (release.body ?? '').trim().slice(0, 800), pageUrl: release.html_url ?? `https://github.com/${RELEASES_REPO}/releases` };
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Shell script run (detached) after the app quits: wait for it to exit, move the old bundle aside, copy the new one
 * in, relaunch. If the copy fails the old app is put back, so a bad update can't leave the user without an app.
 */
export function swapScript(opts: { pid: number; newApp: string; dest: string; stageDir: string }): string {
  const { pid, newApp, dest, stageDir } = opts;
  const old = `${dest}.old-update`;
  return `#!/bin/sh
while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
rm -rf ${q(old)}
if mv ${q(dest)} ${q(old)}; then
  if ditto ${q(newApp)} ${q(dest)}; then
    xattr -cr ${q(dest)} 2>/dev/null
    rm -rf ${q(old)} ${q(stageDir)}
  else
    rm -rf ${q(dest)}
    mv ${q(old)} ${q(dest)}
  fi
fi
open ${q(dest)}
`;
}

/** Bundle path of the running app, from its executable (…/Webs.app/Contents/MacOS/Webs), or null if not in a bundle. */
export function appBundlePath(execPath: string): string | null {
  const m = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  return m ? m[1] : null;
}

/** Why an app at `bundle` can't be replaced in place, or null if it looks fine. */
export function notReplaceable(bundle: string | null): string | null {
  if (!bundle) return "Webs isn't running from an app bundle.";
  if (bundle.startsWith('/Volumes/')) return 'Webs is running from a disk image. Drag it into Applications first.';
  if (bundle.includes('/AppTranslocation/')) return 'macOS is running Webs from a temporary location. Move it into Applications and reopen it.';
  return null;
}
