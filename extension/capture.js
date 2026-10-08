// Pure helpers: build the JSON the webs-capture service expects. No browser APIs here, so the app's
// test suite can exercise it.
//
// The service stores either a `url` (pointer) or `text` capture, not both. A selection is therefore
// sent as text with a source footer that the Webs app parses back out:
//
//     <selection>
//
//     — <page title>
//     <page url>

export const MAX_SELECTION = 20_000;

export const isHttp = url => {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};

export const normalizeServiceUrl = raw => String(raw ?? '').trim().replace(/\/+$/, '');

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * @param {{selectionText?: string, linkUrl?: string, pageUrl?: string, title?: string}} info
 * @returns {{ok: true, body: object} | {ok: false, error: string}}
 */
export function buildCapture({ selectionText, linkUrl, pageUrl, title } = {}) {
  const base = { channel: 'share', device: 'browser' };
  const selection = String(selectionText ?? '').trim();

  if (selection) {
    const text = selection.slice(0, MAX_SELECTION);
    if (!isHttp(pageUrl)) return { ok: true, body: { ...base, text } };
    return { ok: true, body: { ...base, text: `${text}\n\n— ${oneLine(title)}\n${pageUrl}` } };
  }
  const url = linkUrl || pageUrl;
  if (!url || !isHttp(url)) return { ok: false, error: 'Only http(s) pages and links can be sent.' };
  return { ok: true, body: { ...base, url } };
}
