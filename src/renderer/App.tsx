import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebEvent } from '../backend/events';
import type { SavedFile, SavedWebSummary } from '../types/ipc';
import { CanvasView } from './CanvasView';
import { CommandPalette } from './CommandPalette';
import type { Command } from './commands';
import { SettingsView } from './SettingsView';
import { buildRows, TopBar, type View } from './TopBar';
import type { SettingsBundle } from '../types/settings';
import { UpdateBanner } from './Updates';
import { hydrateScene } from './sceneEdit';
import { initialModel, progress, reduce, type WebModel } from './webModel';

const MODEL_SAVE_DEBOUNCE_MS = 400;

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function App() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<WebModel | null>(null);
  const [webId, setWebId] = useState<string | null>(null);
  const [restoredScene, setRestoredScene] = useState<unknown[] | undefined>(undefined);
  const [restoredFiles, setRestoredFiles] = useState<SavedFile[]>([]);
  const [library, setLibrary] = useState<SavedWebSummary[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<View>('cluster');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const canvasCommands = useRef<(() => Command[]) | null>(null);
  const imageSink = useRef<((ev: Extract<WebEvent, { type: 'image' }>) => void) | null>(null);

  const cancel = useRef<(() => void) | null>(null);
  const modelRef = useRef<WebModel | null>(null);
  const idRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const refreshLibrary = useCallback(() => {
    window.webs.listWebs().then(l => setLibrary(l.filter(w => w.fragmentCount > 0))).catch(() => {});
  }, []);

  useEffect(() => { if (!model) refreshLibrary(); }, [model, refreshLibrary]);

  // ⌘K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!paletteOpen) return;
    refreshLibrary();
    void window.webs.getSettings().then(setBundle);
  }, [paletteOpen, refreshLibrary]);
  useEffect(() => () => { cancel.current?.(); clearTimeout(saveTimer.current); }, []);

  function setCurrent(next: WebModel | null) {
    modelRef.current = next;
    setModel(next);
  }

  function saveModelNow() {
    clearTimeout(saveTimer.current);
    const m = modelRef.current, id = idRef.current;
    if (m && id) void window.webs.saveWeb({ id, query: m.query, model: m });
  }

  function saveModelSoon() {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveModelNow, MODEL_SAVE_DEBOUNCE_MS);
  }

  function start(q: string) {
    cancel.current?.();
    setView('cluster');
    const id = crypto.randomUUID();
    idRef.current = id;
    setWebId(id);
    setRestoredScene(undefined);
    setRestoredFiles([]);
    setError(null);
    setCurrent(initialModel(q));
    cancel.current = window.webs.generate(q, ev => {
      // No KB hits: nothing to show yet, so return to the query screen with the reason.
      if (ev.type === 'error' && ev.code === 'kb-empty') {
        setCurrent(null);
        setError(ev.message);
        return;
      }
      if (!modelRef.current || idRef.current !== id) return;
      if (ev.type === 'image') { imageSink.current?.(ev); return; } // pictures go straight onto the canvas
      setCurrent(reduce(modelRef.current, ev));
      if (ev.type === 'done' || ev.type === 'error') saveModelNow(); else saveModelSoon();
    });
  }

  async function open(id: string) {
    cancel.current?.();
    setView('cluster');
    const saved = await window.webs.loadWeb(id);
    if (!saved) { refreshLibrary(); return; }
    idRef.current = id;
    setWebId(id);
    setRestoredScene(hydrateScene(saved.scene as any[], saved.model));
    setRestoredFiles(saved.files);
    setCurrent(saved.model);
  }

  async function remove(id: string) {
    await window.webs.deleteWeb(id);
    refreshLibrary();
  }

  function stop() {
    cancel.current?.();
    if (modelRef.current) setCurrent({ ...modelRef.current, phase: 'cancelled', status: '' });
    saveModelNow();
  }

  function back() {
    if (modelRef.current?.phase === 'running') stop();
    cancel.current = null;
    setView('cluster');
    setCurrent(null);
    setWebId(null);
  }

  const onSceneChange = useCallback((elements: unknown[]) => {
    const m = modelRef.current, id = idRef.current;
    if (m && id) void window.webs.saveWeb({ id, query: m.query, scene: elements });
  }, []);

  const renderScreen = () => {
  if (showSettings) return <SettingsView onClose={() => setShowSettings(false)} />;

  if (model && webId) {
    const { filled, total } = progress(model);
    const running = model.phase === 'running';
    return (
      <div className="screen">
        <TopBar
          title={model.query}
          status={running ? `${model.status}${total > 0 ? ` ${filled}/${total}` : ''}` : undefined}
          onBack={back}
          onStop={running ? stop : undefined}
          view={view}
          onView={setView}
          onSettings={() => setShowSettings(true)}
          timeline
        >
          {model.warning && <span className="hint" role="status">{model.warning}</span>}
          {model.phase === 'error' && (
            <>
              <span className="error" role="alert">{model.error}</span>
              <button onClick={() => start(model.query)}>Retry</button>
            </>
          )}
        </TopBar>
        <CanvasView key={webId} webId={webId} model={model} restoredScene={restoredScene} restoredFiles={restoredFiles} onSceneChange={onSceneChange} view={view} registerCommands={p => { canvasCommands.current = p; }} registerImageSink={f => { imageSink.current = f; }} />
      </div>
    );
  }

  return (
    <div className="screen">
      <button className="settings-link" onClick={() => setShowSettings(true)}>Settings</button>
      <div className="query">
        <h1>What do you want to explore?</h1>
        <form onSubmit={e => { e.preventDefault(); if (query.trim()) start(query.trim()); }}>
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); window.webs.warmUp(); }}
            onFocus={() => window.webs.warmUp()}
            placeholder="Search your knowledge base…"
          />
          <button disabled={!query.trim()}>Generate Web</button>
        </form>
        {error && <div className="error" role="alert">{error}</div>}
        {library.length > 0 && (
          <ul className="library" aria-label="Saved webs">
            {library.map(w => (
              <li key={w.id}>
                <button className="open" onClick={() => open(w.id)}>
                  <span className="title">{w.query}</span>
                  <span className="meta">{w.fragmentCount} fragments · {ago(w.updatedAt)}</span>
                </button>
                <button className="del" aria-label={`Delete ${w.query}`} onClick={() => remove(w.id)}>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
  };

  const commands = (q: string): Command[] => {
    const onCanvas = !!(model && webId);
    const cmds: Command[] = [];
    if (onCanvas) cmds.push(...(canvasCommands.current?.() ?? []));
    cmds.push(
      ...(onCanvas ? [
        { id: 'view-cluster', group: 'Navigation', label: 'Cluster view', checked: view === 'cluster', run: () => setView('cluster') },
        { id: 'view-timeline', group: 'Navigation', label: 'Timeline view', checked: view === 'timeline', run: () => setView('timeline') },
        { id: 'library', group: 'Navigation', label: 'Go to library', keywords: 'home back saved webs', run: back },
      ] : []),
      { id: 'settings', group: 'Navigation', label: 'Open settings', keywords: 'preferences ollama knowledge base', run: () => setShowSettings(true) },
    );
    for (const w of library) cmds.push({ id: `web-${w.id}`, group: 'Saved webs', label: w.query, detail: `${w.fragmentCount} fragments · ${ago(w.updatedAt)}`, run: () => open(w.id) });
    if (bundle) {
      const save = async (patch: Record<string, unknown>) => { const r = await window.webs.saveSettings(patch as any); if (r.ok) setBundle(r.bundle); };
      for (const r of buildRows(bundle, save)) {
        if (r.id === 'notes') continue;
        cmds.push({ id: `row-${r.id}`, group: r.group === 'Models' ? 'AI model' : 'Local DB', label: r.group === 'Models' ? `Use ${r.label}` : `${r.checked ? 'Turn off' : 'Turn on'} ${r.label}`, detail: r.detail, checked: r.group === 'Models' ? r.checked : undefined, run: r.run });
      }
    }
    // Last, so ↵ runs the best match for what was typed; it is the first item only when nothing else matches.
    if (q.trim().length >= 2) cmds.push({ id: 'generate', group: 'New web', label: `Generate a web for “${q.trim()}”`, keywords: q, run: () => start(q.trim()) });
    return cmds;
  };

  return (
    <>
      {renderScreen()}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </>
  );
}
