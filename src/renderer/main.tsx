import { createRoot } from 'react-dom/client';
import '../styles/fonts.css';
import '../styles/tokens.css';
import './app.css';
import '../styles/motion.css';
import { App } from './App';
import { NoBridge } from './NoBridge';
import { UpdateBanner } from './Updates';
import { attachInterfaceSounds } from './sound';

// The title bar is the page's own (see the "title bar" rules in app.css); which OS draws the window controls decides
// where it must leave room for them.
const platform = /Mac/i.test(navigator.userAgent) ? 'mac' : /Win/i.test(navigator.userAgent) ? 'win' : 'linux';
document.documentElement.dataset.platform = platform;
// macOS hides the traffic lights in full screen, so the bar needs no room for them then.
const syncFullscreen = () => { document.documentElement.dataset.fullscreen = String(window.innerHeight >= screen.height); };
window.addEventListener('resize', syncFullscreen);
syncFullscreen();

// the interface's small sounds: unlock on the first gesture, tick over menus, tock on a press
attachInterfaceSounds();

// window.webs comes from the Electron preload script; in a plain browser tab it's absent (in development, open `/?mock`
// to get a stand-in for it, see devBridge.ts: it is left out of builds).
async function boot() {
  if (import.meta.env.DEV && !window.webs && new URLSearchParams(location.search).has('mock')) await import('./devBridge');
  createRoot(document.getElementById('root')!).render(window.webs ? <><App /><UpdateBanner /></> : <NoBridge />);
}
void boot();
