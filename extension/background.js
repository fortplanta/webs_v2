import { buildCapture, normalizeServiceUrl } from './capture.js';

const MENU_ID = 'send-to-webs';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Send to Webs', contexts: ['selection', 'link', 'page'] });
});

async function settings() {
  const { serviceUrl, token } = await chrome.storage.local.get(['serviceUrl', 'token']);
  return { serviceUrl: normalizeServiceUrl(serviceUrl), token: String(token ?? '') };
}

function flash(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

async function send(info, tab) {
  const { serviceUrl, token } = await settings();
  if (!serviceUrl || !token) { chrome.runtime.openOptionsPage(); return; }

  const built = buildCapture({ ...info, pageUrl: info.pageUrl ?? tab?.url, title: tab?.title });
  if (!built.ok) { flash(tab?.id, '!', '#c0392b'); console.warn('Send to Webs:', built.error); return; }

  try {
    const res = await fetch(`${serviceUrl}/captures`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(built.body),
    });
    if (res.ok) flash(tab?.id, '✓', '#2e8b57');
    else { flash(tab?.id, String(res.status), '#c0392b'); console.warn('Send to Webs: service returned', res.status); }
  } catch (err) {
    flash(tab?.id, '!', '#c0392b');
    console.warn('Send to Webs: could not reach', serviceUrl, err);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) void send(info, tab);
});

// Toolbar button: send the current selection if there is one, otherwise the page.
chrome.action.onClicked.addListener(async tab => {
  let selectionText = '';
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(window.getSelection() ?? '') });
    selectionText = r?.result ?? '';
  } catch { /* restricted page: fall back to the URL */ }
  void send({ selectionText }, tab);
});
