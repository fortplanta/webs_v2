import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedWebSummary } from '../types/ipc';
import { CanvasView } from './CanvasView';
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
  const [library, setLibrary] = useState<SavedWebSummary[]>([]);

  const cancel = useRef<(() => void) | null>(null);
  const modelRef = useRef<WebModel | null>(null);
  const idRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const refreshLibrary = useCallback(() => {
    window.webs.listWebs().then(l => setLibrary(l.filter(w => w.fragmentCount > 0))).catch(() => {});
  }, []);

  useEffect(() => { if (!model) refreshLibrary(); }, [model, refreshLibrary]);
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
    const id = crypto.randomUUID();
    idRef.current = id;
    setWebId(id);
    setRestoredScene(undefined);
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
      setCurrent(reduce(modelRef.current, ev));
      if (ev.type === 'done' || ev.type === 'error') saveModelNow(); else saveModelSoon();
    });
  }

  async function open(id: string) {
    cancel.current?.();
    const saved = await window.webs.loadWeb(id);
    if (!saved) { refreshLibrary(); return; }
    idRef.current = id;
    setWebId(id);
    setRestoredScene(saved.scene);
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
    setCurrent(null);
    setWebId(null);
  }

  const onSceneChange = useCallback((elements: unknown[]) => {
    const m = modelRef.current, id = idRef.current;
    if (m && id) void window.webs.saveWeb({ id, query: m.query, scene: elements });
  }, []);

  if (model && webId) {
    const { filled, total } = progress(model);
    const running = model.phase === 'running';
    return (
      <div className="screen">
        <div className="bar">
          <button onClick={back}>← Library</button>
          <span className="q">{model.query}</span>
          {running && (
            <span className="status">
              <span className="dot" />
              {model.status}
              {total > 0 && ` ${filled}/${total}`}
            </span>
          )}
          {running && <button onClick={stop}>Stop</button>}
          {model.phase === 'error' && (
            <>
              <span className="error" role="alert">{model.error}</span>
              <button onClick={() => start(model.query)}>Retry</button>
            </>
          )}
        </div>
        <CanvasView key={webId} model={model} restoredScene={restoredScene} onSceneChange={onSceneChange} />
      </div>
    );
  }

  return (
    <div className="screen">
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
}
