import { describe, it, expect, afterEach, vi } from 'vitest';
// @ts-expect-error plain-JS extension module, shared with the real extension
import { buildCapture, isHttp, normalizeServiceUrl, MAX_SELECTION } from '../extension/capture.js';
import { listInbox, markComposted, markFiled, parseSourceFooter, testCapture, toInboxItem } from '../src/backend/capture';
import { setSettingsOverrides, validatePatch } from '../src/backend/settings';
import { fragmentFromCapture, fragmentFromPaste, looksLikeExcalidrawClipboard } from '../src/renderer/capture';
import { fragmentLook, hostLabel } from '../src/renderer/boxes';
import { addBox, updateBox, type El } from '../src/renderer/sceneEdit';

afterEach(() => { setSettingsOverrides({}); vi.unstubAllGlobals(); });
const configure = () => setSettingsOverrides({ capture: { url: 'http://svc:8787', token: 'tok' } });

describe('extension payloads', () => {
  it('sends a page or link as a url capture (link wins over page)', () => {
    expect(buildCapture({ pageUrl: 'https://a.com/p', title: 't' })).toEqual({ ok: true, body: { channel: 'share', device: 'browser', url: 'https://a.com/p' } });
    expect(buildCapture({ pageUrl: 'https://a.com/p', linkUrl: 'https://b.com/x' }).body.url).toBe('https://b.com/x');
  });
  it('refuses non-web pages', () => {
    expect(buildCapture({ pageUrl: 'chrome://extensions' }).ok).toBe(false);
    expect(buildCapture({ pageUrl: 'file:///etc/hosts' }).ok).toBe(false);
    expect(buildCapture({ pageUrl: 'javascript:alert(1)' }).ok).toBe(false);
    expect(buildCapture({}).ok).toBe(false);
  });
  it('sends a selection as text with a source footer the app parses back (round trip)', () => {
    const { body } = buildCapture({ selectionText: '  Virtue is the only good.\nSecond line.  ', pageUrl: 'https://a.com/p?x=1', title: 'On\n  Stoicism ' });
    expect(body.url).toBeUndefined();
    expect(parseSourceFooter(body.text)).toEqual({ text: 'Virtue is the only good.\nSecond line.', title: 'On Stoicism', url: 'https://a.com/p?x=1' });
  });
  it('sends a selection from a non-web page as plain text, and caps its length', () => {
    expect(buildCapture({ selectionText: 'hi', pageUrl: 'chrome://x' }).body).toEqual({ channel: 'share', device: 'browser', text: 'hi' });
    expect(buildCapture({ selectionText: 'x'.repeat(MAX_SELECTION + 500), pageUrl: 'chrome://x' }).body.text).toHaveLength(MAX_SELECTION);
  });
  it('helpers', () => {
    expect(isHttp('https://a.com')).toBe(true); expect(isHttp('ftp://a.com')).toBe(false); expect(isHttp('nope')).toBe(false);
    expect(normalizeServiceUrl(' http://h:1/// ')).toBe('http://h:1');
  });
});

describe('parseSourceFooter / toInboxItem', () => {
  it('leaves ordinary text alone, and only strips a footer at the very end', () => {
    expect(parseSourceFooter('plain text')).toEqual({ text: 'plain text' });
    expect(parseSourceFooter('a\n\n— not a footer\nhttps://x.com\nmore')).toEqual({ text: 'a\n\n— not a footer\nhttps://x.com\nmore' });
  });
  it('maps pointer and text captures, and skips images/files', () => {
    const base = { id: '1', channel: 'share', device: 'iphone', created_at: '2026-01-01T00:00:00Z' };
    expect(toInboxItem({ ...base, kind: 'pointer', pointer: { url: 'https://y.com/v', t_start_seconds: 143 }, derived: { title: 'Vid' } }))
      .toMatchObject({ kind: 'pointer', url: 'https://y.com/v', title: 'Vid', startSeconds: 143 });
    expect(toInboxItem({ ...base, kind: 'text', text: 'note\n\n— T\nhttps://a.com' })).toMatchObject({ kind: 'text', text: 'note', title: 'T', url: 'https://a.com' });
    expect(toInboxItem({ ...base, kind: 'image' })).toBeNull();
    expect(toInboxItem({ ...base, kind: 'text', text: '' })).toBeNull();
  });
});

describe('capture service client', () => {
  const raw = (kind: string, extra = {}) => ({ id: kind, kind, channel: 'share', device: 'd', created_at: '2026-01-01T00:00:00Z', ...extra });

  it('is a no-op message until configured', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    expect(await listInbox()).toMatchObject({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists received+ready captures with the bearer token, counting unsupported ones', async () => {
    configure();
    const calls: Array<{ url: string; auth: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ items: [raw('pointer', { pointer: { url: 'https://a.com' } }), raw('image'), raw('text', { text: 'hi' })] }));
    });
    const r = await listInbox();
    expect(calls[0]).toEqual({ url: 'http://svc:8787/captures?status=received,ready&limit=100', auth: 'Bearer tok' });
    expect(r).toMatchObject({ ok: true, unsupported: 1 });
    expect(r.ok && r.items.map(i => i.kind)).toEqual(['pointer', 'text']);
  });

  it('reports bad tokens, server errors and unreachable services readably', async () => {
    configure();
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    expect(await listInbox()).toEqual({ ok: false, message: 'The capture service rejected the token.' });
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    expect(await listInbox()).toEqual({ ok: false, message: 'The capture service returned 500.' });
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    expect(await listInbox()).toEqual({ ok: false, message: "Can't reach the capture service at http://svc:8787." });
  });

  it('files and dismisses with PATCH', async () => {
    configure();
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { calls.push({ url, method: init.method, body: JSON.parse(init.body as string) }); return new Response('{}'); });
    expect(await markFiled('A/1', 'm-9')).toEqual({ ok: true });
    expect(await markComposted('B')).toEqual({ ok: true });
    expect(calls).toEqual([
      { url: 'http://svc:8787/captures/A%2F1', method: 'PATCH', body: { status: 'filed', filed_node_id: 'm-9' } },
      { url: 'http://svc:8787/captures/B', method: 'PATCH', body: { status: 'composted' } },
    ]);
  });

  it('tests an unsaved url+token: health first, then the token', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { urls.push(url); return url.endsWith('/health') ? new Response(JSON.stringify({ captures_total: 7 })) : new Response('{"items":[]}'); });
    expect(await testCapture(' http://x:1/ ', 'T')).toEqual({ ok: true, message: 'Connected · 7 captures stored' });
    expect(urls).toEqual(['http://x:1/health', 'http://x:1/captures?limit=1']);
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('/health') ? new Response('{}') : new Response('', { status: 401 })));
    expect(await testCapture('http://x:1', 'bad')).toEqual({ ok: false, message: 'Reachable, but the token was rejected.' });
    expect((await testCapture('', 't')).ok).toBe(false);
  });
});

describe('settings: capture', () => {
  it('accepts empty (disabled) or an http(s) url, trims, and rejects other schemes', () => {
    expect(validatePatch({ capture: { url: ' http://svc:8787/ ', token: ' t ' } }, []).value.capture).toEqual({ url: 'http://svc:8787', token: 't' });
    expect(validatePatch({ capture: { url: '' } }, []).value.capture).toEqual({ url: '' });
    expect(validatePatch({ capture: { url: 'ftp://x' } }, []).errors['capture.url']).toBeDefined();
    expect(validatePatch({ capture: { url: 'svc:8787' } }, []).errors['capture.url']).toBeDefined();
  });
});

describe('fragments from paste and captures', () => {
  it('a lone URL becomes a source card with a link', () => {
    expect(fragmentFromPaste(' https://www.example.com/a/b/ \n')).toMatchObject({ type: 'source', title: 'example.com/a/b', body: 'https://www.example.com/a/b/'.replace(/\/$/, '/'), link: 'https://www.example.com/a/b/' });
  });
  it('other text becomes an editable concept card titled by its first words', () => {
    const f = fragmentFromPaste('# The Stoic view of control\n\nSome longer paragraph here.');
    expect(f).toMatchObject({ type: 'concept', title: 'The Stoic view of control' });
    expect(f!.link).toBeUndefined();
    expect(fragmentFromPaste('one two three four five six seven eight')!.title).toBe('one two three four five six…');
  });
  it('ignores empty text, javascript: links and non-URL single words', () => {
    expect(fragmentFromPaste('   \n ')).toBeNull();
    expect(fragmentFromPaste('javascript:alert(1)')!.link).toBeUndefined();
    expect(fragmentFromPaste('hello')!.type).toBe('concept');
  });
  it('recognizes Excalidraw clipboard data so it is left to Excalidraw', () => {
    expect(looksLikeExcalidrawClipboard('{"type":"excalidraw/clipboard","elements":[]}')).toBe(true);
    expect(looksLikeExcalidrawClipboard('{"a":1}')).toBe(false);
  });
  it('turns captures into cards, with provenance and media timestamps', () => {
    const base = { id: '1', channel: 'share', device: 'd', createdAt: 'x' };
    expect(fragmentFromCapture({ ...base, kind: 'pointer', url: 'https://youtu.be/x', startSeconds: 143 }))
      .toMatchObject({ type: 'source', title: 'youtu.be/x', body: 'https://youtu.be/x ▶ 2:23', link: 'https://youtu.be/x', tags: ['captured'] });
    expect(fragmentFromCapture({ ...base, kind: 'text', text: 'A selected passage', url: 'https://a.com', title: 'Page' }))
      .toMatchObject({ type: 'source', title: 'Page', body: 'A selected passage', link: 'https://a.com' });
    expect(fragmentFromCapture({ ...base, kind: 'text', text: 'a loose thought' })).toMatchObject({ type: 'concept', title: 'a loose thought' });
  });
});

describe('links on cards', () => {
  it('shows the source host on the card', () => {
    expect(fragmentLook({ type: 'source', title: 't', body: 'b', link: 'https://www.a.com/x' }).label.text).toMatch(/\n\n↗ a\.com$/);
    expect(fragmentLook({ type: 'source', title: 't', body: 'b' }).label.text).not.toContain('↗');
    expect(hostLabel('not a url')).toBe('not a url');
  });
  it('stores the link on the box when adding and updates/removes it when editing', () => {
    const build = (sk: unknown[]): El[] => (sk as El[]).map(({ label: _l, ...b }) => ({ version: 1, ...b }));
    const look = fragmentLook({ type: 'source', title: 't', body: 'b' });
    const added = addBox([], { id: 'm', x: 0, y: 0, width: 1, height: 1, backgroundColor: '#fff', label: look.label, link: 'https://a.com', customData: { kind: 'fragment', fragment: { type: 'source', title: 't', body: 'b' } } }, build);
    expect(added.find(e => e.id === 'm')!.link).toBe('https://a.com');
    expect(updateBox(added, 'm', { link: null }, build).find(e => e.id === 'm')!.link).toBeNull();
    expect(updateBox(added, 'm', { backgroundColor: '#000' }, build).find(e => e.id === 'm')!.link).toBe('https://a.com');
  });
});
