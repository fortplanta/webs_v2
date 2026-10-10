// Runs as a classic script, before any module, so it is in place when Excalidraw builds its font list.
// Excalidraw would otherwise load its fonts from a CDN (blocked by this app's CSP; nothing works offline).
// The fonts are copied beside the app at build time — see electron.vite.config.ts.
window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw-assets/', document.baseURI).href;
