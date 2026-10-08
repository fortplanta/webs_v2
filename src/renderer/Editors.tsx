import { useEffect, useRef, useState } from 'react';
import type { GeneratedFragment } from '../backend/events';
import type { FragmentType } from '../types/fragments';
import { FRAGMENT_TYPES } from './boxes';

interface Shell { title: string; onClose: () => void; children: React.ReactNode }

function Panel({ title, onClose, children }: Shell) {
  return (
    <aside className="editor" role="dialog" aria-label={title} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="editor-head">
        <strong>{title}</strong>
        <button className="plain" onClick={onClose} aria-label="Close editor">×</button>
      </div>
      {children}
    </aside>
  );
}

export function FragmentEditor({ fragment, onChange, onDelete, onClose }: {
  fragment: GeneratedFragment;
  onChange: (next: GeneratedFragment) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState((fragment.tags ?? []).join(', '));
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  const set = (patch: Partial<GeneratedFragment>) => onChange({ ...fragment, ...patch });
  const date = fragment.era ?? fragment.historicalEra ?? '';
  // Dates are `era` for events/eras and `historicalEra` for everything else.
  const setDate = (v: string) => {
    const key = fragment.type === 'event' || fragment.type === 'era' ? 'era' : 'historicalEra';
    set({ era: undefined, historicalEra: undefined, [key]: v || undefined });
  };

  return (
    <Panel title="Edit fragment" onClose={onClose}>
      <label>Type
        <select value={fragment.type} onChange={e => set({ type: e.target.value as FragmentType })}>
          {FRAGMENT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label>Title
        <input ref={titleRef} value={fragment.title} onChange={e => set({ title: e.target.value })} />
      </label>
      <label>Body
        <textarea rows={7} value={fragment.body} onChange={e => set({ body: e.target.value })} />
      </label>
      <label>Tags <span className="meta">comma-separated</span>
        <input value={tags} onChange={e => { setTags(e.target.value); set({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }); }} />
      </label>
      <label>Date / era <span className="meta">optional</span>
        <input value={date} onChange={e => setDate(e.target.value)} placeholder="e.g. 1789 or 1914–1918" />
      </label>
      <div className="editor-actions">
        <button className="danger" onClick={onDelete}>Delete fragment</button>
        <button onClick={onClose}>Done</button>
      </div>
    </Panel>
  );
}

export function ClusterEditor({ title, onChange, onAddFragment, onClose }: {
  title: string;
  onChange: (title: string) => void;
  onAddFragment: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <Panel title="Edit cluster" onClose={onClose}>
      <label>Title
        <input ref={ref} value={title} onChange={e => onChange(e.target.value)} />
      </label>
      <div className="editor-actions">
        <button onClick={onAddFragment}>Add fragment here</button>
        <button onClick={onClose}>Done</button>
      </div>
    </Panel>
  );
}

export function EdgeEditor({ label, onChange, onDelete, onClose }: {
  label: string;
  onChange: (label: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <Panel title="Edit connection" onClose={onClose}>
      <label>Verb phrase <span className="meta">e.g. "shaped by", "led to"</span>
        <input ref={ref} value={label} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onClose(); }} />
      </label>
      <div className="editor-actions">
        <button className="danger" onClick={onDelete}>Delete connection</button>
        <button onClick={onClose}>Done</button>
      </div>
    </Panel>
  );
}
