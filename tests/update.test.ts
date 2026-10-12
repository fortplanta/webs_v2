import { describe, expect, it } from 'vitest';
import { appBundlePath, compareVersions, newerRelease, notReplaceable, parseLatestYml, swapScript } from '../src/backend/update';

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.0', body: 'What changed', html_url: 'https://github.com/x/y/releases/tag/v0.2.0',
  assets: [{ name: 'Webs-0.2.0-arm64-mac.zip', browser_download_url: 'https://dl/zip', size: 10 }, { name: 'latest-mac.yml', browser_download_url: 'https://dl/yml', size: 1 }],
  ...over,
});

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('v1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
  });
});

describe('newerRelease', () => {
  it('finds a newer release and its files', () => {
    const r = newerRelease(release(), '0.1.0', 'arm64')!;
    expect(r).toMatchObject({ version: '0.2.0', zip: { url: 'https://dl/zip', size: 10 }, yml: 'https://dl/yml', notes: 'What changed' });
  });
  it('ignores the same or an older version, drafts, prereleases and half-uploaded releases', () => {
    expect(newerRelease(release(), '0.2.0', 'arm64')).toBeNull();
    expect(newerRelease(release(), '0.3.0', 'arm64')).toBeNull();
    expect(newerRelease(release({ draft: true }), '0.1.0', 'arm64')).toBeNull();
    expect(newerRelease(release({ prerelease: true }), '0.1.0', 'arm64')).toBeNull();
    expect(newerRelease(release({ assets: [] }), '0.1.0', 'arm64')).toBeNull();
    expect(newerRelease(release(), '0.1.0', 'x64')).toBeNull(); // no build for this architecture
  });
});

describe('parseLatestYml', () => {
  const yml = `version: 0.2.0
files:
  - url: Webs-0.2.0-arm64-mac.zip
    sha512: AbC+/==
    size: 142853487
  - url: Webs-0.2.0-arm64.dmg
    sha512: other==
    size: 5
`;
  it('reads the zip checksum and size', () => {
    expect(parseLatestYml(yml, 'Webs-0.2.0-arm64-mac.zip')).toEqual({ sha512: 'AbC+/==', size: 142853487 });
    expect(parseLatestYml(yml, 'nope.zip')).toBeNull();
  });
});

describe('swap script and bundle checks', () => {
  it('quotes paths safely and restores the old app on failure', () => {
    const s = swapScript({ pid: 42, newApp: "/tmp/it's/Webs.app", dest: '/Applications/Webs.app', stageDir: '/tmp/it\'s' });
    expect(s).toContain('kill -0 42');
    expect(s).toContain(`'/tmp/it'\\''s/Webs.app'`);
    expect(s).toMatch(/else\s+rm -rf '\/Applications\/Webs.app'\s+mv '\/Applications\/Webs.app.old-update' '\/Applications\/Webs.app'/);
    expect(s.trim().endsWith("open '/Applications/Webs.app'")).toBe(true);
  });
  it('finds the bundle and refuses places it cannot replace', () => {
    expect(appBundlePath('/Applications/Webs.app/Contents/MacOS/Webs')).toBe('/Applications/Webs.app');
    expect(appBundlePath('/usr/bin/node')).toBeNull();
    expect(notReplaceable('/Applications/Webs.app')).toBeNull();
    expect(notReplaceable('/Volumes/Webs/Webs.app')).toMatch(/disk image/);
    expect(notReplaceable('/private/var/folders/x/AppTranslocation/y/d/Webs.app')).toMatch(/temporary/);
    expect(notReplaceable(null)).toMatch(/app bundle/);
  });
});
