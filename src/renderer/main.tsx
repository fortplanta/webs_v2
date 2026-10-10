import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import './app.css';
import { App } from './App';
import { NoBridge } from './NoBridge';

// window.webs comes from the Electron preload script; in a plain browser tab it's absent.
createRoot(document.getElementById('root')!).render(window.webs ? <App /> : <NoBridge />);
