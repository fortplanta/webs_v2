import { isHttp, normalizeServiceUrl } from './capture.js';

const $ = id => document.getElementById(id);
const status = (msg, cls = '') => { $('status').textContent = msg; $('status').className = cls; };

chrome.storage.local.get(['serviceUrl', 'token']).then(({ serviceUrl, token }) => {
  $('url').value = serviceUrl ?? '';
  $('token').value = token ?? '';
});

function read() {
  const serviceUrl = normalizeServiceUrl($('url').value);
  const token = $('token').value.trim();
  if (!isHttp(serviceUrl)) { status('Enter a full http:// or https:// URL.', 'err'); return null; }
  if (!token) { status('Enter the token.', 'err'); return null; }
  return { serviceUrl, token };
}

$('save').addEventListener('click', async () => {
  const v = read();
  if (!v) return;
  // Needed so the extension's requests to your service aren't blocked by CORS. Must come from a click.
  const granted = await chrome.permissions.request({ origins: [`${new URL(v.serviceUrl).origin}/*`] });
  if (!granted) { status('Permission to reach that address was declined.', 'err'); return; }
  await chrome.storage.local.set(v);
  status('Saved.', 'ok');
});

$('test').addEventListener('click', async () => {
  const v = read();
  if (!v) return;
  try {
    const res = await fetch(`${v.serviceUrl}/captures?limit=1`, { headers: { Authorization: `Bearer ${v.token}` } });
    if (res.status === 401) status('Reachable, but the token was rejected.', 'err');
    else if (res.ok) status('Connected.', 'ok');
    else status(`The service returned ${res.status}.`, 'err');
  } catch {
    status("Can't reach the service. Save first so the extension can request access to that address.", 'err');
  }
});
