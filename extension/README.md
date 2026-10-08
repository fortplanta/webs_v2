# Send to Webs (browser extension)

Sends a selection, link or page from Chrome/Chromium/Edge/Brave to your **webs-capture** service. The captures then show up in the Webs canvas **Inbox**.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose this `extension/` folder.
3. Open the extension's **Details → Extension options**, enter your capture service URL (e.g. `http://localhost:8787`) and token, click **Save** (the browser asks to allow access to that address), then **Test connection**.

## Use

- Select text → right-click → **Send to Webs**
- Right-click a link or the page → **Send to Webs**
- Or click the toolbar button: sends the current selection, otherwise the page.

The toolbar icon flashes ✓ on success, or `!` / the HTTP status on failure.

## How captures are stored

The service stores either a URL or text, not both. A page or link is sent as a URL capture. A selection is sent as text with a footer so the source isn't lost:

```
<selected text>

— <page title>
<page url>
```

Webs reads the footer back and shows the card with a source link. (If you'd rather store both natively, the service's `handleJson` could accept `url` and `text` together; the footer is the no-changes-needed route.)

## Security notes

- The token is kept in `chrome.storage.local` (unencrypted, per browser profile). Treat it like any API key; rotate it by changing `CAPTURE_TOKEN` on the service.
- Prefer `localhost` or a private network (e.g. Tailscale). A plain `http://` address sends the token unencrypted.
- The extension only talks to the one address you grant, and only sends when you click.
