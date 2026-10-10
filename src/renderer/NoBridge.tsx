/** Shown when the page is opened in a plain browser tab, where Electron's preload bridge (window.webs) doesn't exist. */
export function NoBridge() {
  return (
    <div className="screen">
      <div className="query">
        <h1>Open Webs in the desktop app</h1>
        <p className="hint">
          This page only works inside the Webs desktop window. Generation, saving and settings all go through the Electron app,
          so a regular browser tab can't run them.
        </p>
        <p className="hint">
          Start it with <code>npm run dev</code> in the project folder. The Webs window opens on its own.
        </p>
      </div>
    </div>
  );
}
