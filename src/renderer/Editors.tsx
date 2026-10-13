import { useEffect, useRef, useState } from 'react';
import type { GeneratedFragment } from '../backend/events';
import type { FragmentType } from '../types/fragments';
import type { InboxItem } from '../types/capture';
import { FRAGMENT_TYPES, hostLabel, isHttpUrl } from './boxes';
import { formatBytes } from './images';
import type { ImageCardData } from './imageCard';

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

/** "Stick to…" / "Unstick": keep this item within reach of another (a theme label, say). */
export interface StickProps {
  /** Name of the item this one is stuck to, if any. */
  to: string | null;
  onStick: () => void;
  onUnstick: () => void;
}

function StickRow({ stick }: { stick?: StickProps }) {
  if (!stick) return null;
  return (
    <div className="stick-row">
      {stick.to
        ? <><span className="hint">Stays near “{stick.to}”.</span><button onClick={stick.onUnstick}>Unstick</button></>
        : <><span className="hint">Free to go anywhere.</span><button onClick={stick.onStick}>Stick to…</button></>}
      {stick.to && <button onClick={stick.onStick}>Change…</button>}
    </div>
  );
}

export function FragmentEditor({ fragment, onChange, onDelete, onClose, onPivot, pivoting, stick }: {
  stick?: StickProps;
  fragment: GeneratedFragment;
  onChange: (next: GeneratedFragment) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Grow a new collection from this card. */
  onPivot?: () => void;
  pivoting?: boolean;
}) {
  const [tags, setTags] = useState((fragment.tags ?? []).join(', '));
  const [link, setLink] = useState(fragment.link ?? '');
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
      <label>How it connects <span className="meta">the bridge to the topic</span>
        <input value={fragment.bridge ?? ''} onChange={e => set({ bridge: e.target.value || undefined })} />
      </label>
      {fragment.retold && fragment.original && (
        <div className="hint ai-note">
          Retold in the narrator's voice. Every name and number was checked against the source, and nothing was added.
          <details><summary>Original passage</summary><div className="original-text">{fragment.original}</div></details>
          <button className="plain-link" onClick={() => set({ body: fragment.original!, original: undefined, retold: false })}>Use the original wording</button>
        </div>
      )}
      {fragment.retellingRefused && <div className="hint">Kept the original wording: the narrator's retelling was refused because {fragment.retellingRefused}.</div>}
      {fragment.origin === 'wiki' && (
        <div className="hint ai-note">W From {fragment.sourceLabel ?? 'an offline reference library'}{fragment.kbSources?.[0] ? ` — “${fragment.kbSources[0]}”` : ''}. Not from your notes.</div>
      )}
      {fragment.origin === 'ai' && (
        <div className="hint ai-note">✦ Written by {fragment.aiModel || 'your AI provider'} from its own knowledge — not from your notes. Check it before relying on it.</div>
      )}
      {fragment.kbSources?.length ? (
        <div className="hint">
          From {fragment.kbSources.join(', ')}{fragment.lens ? ` · route: ${fragment.lens}` : ''}
          {fragment.grounding !== undefined && <> · {Math.round(fragment.grounding * 100)}% of its wording is in that passage</>}
        </div>
      ) : null}
      <label>Source link <span className="meta">optional · opens in your browser</span>
        <input
          value={link}
          onChange={e => { const v = e.target.value.trim(); setLink(e.target.value); set({ link: isHttpUrl(v) ? v : undefined }); }}
          placeholder="https://…"
          aria-invalid={link.trim() !== '' && !isHttpUrl(link.trim())}
        />
      </label>
      {link.trim() !== '' && !isHttpUrl(link.trim()) && <div className="field-error" role="alert">Use a full http:// or https:// address.</div>}
      {onPivot && (
        <div className="explore">
          <button onClick={onPivot} disabled={pivoting}>{pivoting ? 'Exploring…' : '↗ Explore a different angle'}</button>
          <div className="hint">Finds notes in your KB related to this card that aren't on the canvas yet, and adds them as a new collection.</div>
        </div>
      )}
      <StickRow stick={stick} />
      <div className="editor-actions">
        <button className="danger" onClick={onDelete}>Delete fragment</button>
        <button onClick={onClose}>Done</button>
      </div>
    </Panel>
  );
}

export function ClusterEditor({ title, lens, origin, aiModel, onChange, onAddFragment, onClose, stick }: {
  origin?: 'ai' | 'wiki';
  aiModel?: string;
  stick?: StickProps;
  title: string;
  lens?: string;
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
      {origin === 'wiki' && <div className="hint ai-note">W Found in an offline reference library, not in your notes.</div>}
      {origin === 'ai' && <div className="hint ai-note">✦ Written by {aiModel || 'your AI provider'} from its own knowledge — not from your notes.</div>}
      {lens && <div className="hint">Found through the “{lens}” route.</div>}
      <StickRow stick={stick} />
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

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m) || m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function InboxPanel({ items, unsupported, error, busy, serviceUrl, onAdd, onAddAll, onDismiss, onRefresh, onClose }: {
  items: InboxItem[];
  unsupported: number;
  error: string | null;
  busy: boolean;
  serviceUrl: string;
  onAdd: (item: InboxItem) => void;
  onAddAll: () => void;
  onDismiss: (item: InboxItem) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="editor inbox" role="dialog" aria-label="Capture inbox" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="editor-head">
        <strong>Capture inbox</strong>
        <button className="plain" onClick={onClose} aria-label="Close inbox">×</button>
      </div>
      <div className="inbox-actions">
        <button onClick={onRefresh} disabled={busy}>{busy ? 'Checking…' : 'Refresh'}</button>
        <button onClick={onAddAll} disabled={busy || items.length === 0}>Add all ({items.length})</button>
      </div>
      {error && <div className="field-error" role="alert">{error}</div>}
      {!error && items.length === 0 && !busy && <div className="hint">Nothing waiting. Captures from the browser extension and your phone show up here.</div>}
      <ul className="inbox-list">
        {items.map(item => (
          <li key={item.id}>
            {(() => {
              const title = item.title || (item.url ? hostLabel(item.url) : (item.text ?? '').slice(0, 60));
              return (
                <>
                  <div className="inbox-title">{title}</div>
                  {item.text && <div className="inbox-snippet">{item.text.slice(0, 140)}</div>}
                  {item.url && hostLabel(item.url) !== title && <div className="meta">{hostLabel(item.url)}</div>}
                </>
              );
            })()}
            <div className="meta">{item.device} · {ago(item.createdAt)}</div>
            <div className="inbox-row">
              <button onClick={() => onAdd(item)}>Add to canvas</button>
              <button className="plain-link" onClick={() => onDismiss(item)}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
      {unsupported > 0 && (
        <div className="hint">
          {unsupported} image/file capture{unsupported === 1 ? '' : 's'} can't be placed on the canvas yet. View {unsupported === 1 ? 'it' : 'them'} in the{' '}
          <a href={`${serviceUrl}/inbox/`} target="_blank" rel="noreferrer">capture inbox page</a>.
        </div>
      )}
    </aside>
  );
}

export function ImageCardEditor({ data, onCaption, onDelete, onClose, stick }: {
  stick?: StickProps;
  data: ImageCardData;
  onCaption: (caption: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState(data.caption);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Panel title="Edit image" onClose={onClose}>
      <label>Caption <span className="meta">optional</span>
        <input ref={ref} value={caption} onChange={e => { setCaption(e.target.value); onCaption(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') onClose(); }} />
      </label>
      <div className="hint">
        {data.link ? <>From <a href={data.link} target="_blank" rel="noreferrer">{data.name}</a> · </> : <>{data.name} · </>}{data.width}×{data.height}
        {data.resizedFrom && <> · shrunk from {data.resizedFrom.width}×{data.resizedFrom.height} ({formatBytes(data.resizedFrom.bytes)}); your original file is untouched</>}
      </div>
      <StickRow stick={stick} />
      <div className="editor-actions">
        <button className="danger" onClick={onDelete}>Delete image</button>
        <button onClick={onClose}>Done</button>
      </div>
    </Panel>
  );
}
