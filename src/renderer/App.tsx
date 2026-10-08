import { useEffect, useRef, useState } from 'react';
import { CanvasView } from './CanvasView';
import { initialModel, progress, reduce, type WebModel } from './webModel';

export function App() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<WebModel | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => () => cancel.current?.(), []);

  function start(q: string) {
    cancel.current?.();
    setError(null);
    setModel(initialModel(q));
    cancel.current = window.webs.generate(q, ev => {
      // No KB hits: nothing to show yet, so return to the query screen with the reason.
      if (ev.type === 'error' && ev.code === 'kb-empty') {
        setModel(null);
        setError(ev.message);
        return;
      }
      setModel(m => (m ? reduce(m, ev) : m));
    });
  }

  function back() {
    cancel.current?.();
    cancel.current = null;
    setModel(null);
  }

  if (model) {
    const { filled, total } = progress(model);
    const running = model.phase === 'running';
    return (
      <div className="screen">
        <div className="bar">
          <button onClick={back}>← New query</button>
          <span className="q">{model.query}</span>
          {running && (
            <span className="status">
              <span className="dot" />
              {model.status}
              {total > 0 && ` ${filled}/${total}`}
            </span>
          )}
          {running && <button onClick={() => { cancel.current?.(); setModel(m => (m ? { ...m, phase: 'cancelled', status: '' } : m)); }}>Stop</button>}
          {model.phase === 'error' && (
            <>
              <span className="error" role="alert">{model.error}</span>
              <button onClick={() => start(model.query)}>Retry</button>
            </>
          )}
        </div>
        <CanvasView model={model} />
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
      </div>
    </div>
  );
}
