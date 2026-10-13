import { useEffect, useRef, useState } from 'react';
import type { SettingsBundle } from '../types/settings';
import { IconBack, IconBook, IconCheck, IconChevronDown, IconGear, IconPlus } from './icons';

export type View = 'cluster' | 'timeline';

export interface TopBarProps {
  title: string;
  /** What the generation is doing right now (shown beside the title), if anything. */
  status?: string;
  onBack: () => void;
  onStop?: () => void;
  /** Extra inline content (retry, warnings…). */
  children?: React.ReactNode;
  view: View;
  onView: (v: View) => void;
  onSettings: () => void;
  /** Whether the Timeline view exists yet. */
  timeline?: boolean;
}

const hostLabel = (ai: SettingsBundle['settings']['ai']) =>
  /anthropic/i.test(ai.baseUrl) ? 'Claude' : /openai\.com/i.test(ai.baseUrl) ? 'ChatGPT' : /openrouter/i.test(ai.baseUrl) ? 'OpenRouter' : /groq/i.test(ai.baseUrl) ? 'Groq' : 'Custom model';
const inferKind = (baseUrl: string) => (/anthropic/i.test(baseUrl) ? 'anthropic' : 'openai') as 'anthropic' | 'openai';

interface Row { id: string; group: 'Models' | 'Local DB'; label: string; detail?: string; checked: boolean; run: () => Promise<void> | void }

/** The model and local-library picker that hangs off the Settings button. ⌘1…⌘9 pick the rows in order. */
function ModelsMenu({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const load = () => window.webs.getSettings().then(setBundle);
  useEffect(() => { void load(); }, []);

  const rows = bundle ? buildRows(bundle, async patch => { const r = await window.webs.saveSettings(patch); if (r.ok) setBundle(r.bundle); }) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const row = rows[Number(e.key) - 1];
        if (row) { e.preventDefault(); void row.run(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let n = 0;
  return (
    <div className="menu models-menu" role="menu">
      {(['Models', 'Local DB'] as const).map(group => (
        <div key={group}>
          <div className="menu-label">{group}</div>
          {rows.filter(r => r.group === group).map(r => (
            <button key={r.id} className="menu-item" role="menuitemradio" aria-checked={r.checked} onClick={() => void r.run()}>
              <span className="menu-check">{r.checked && <IconCheck />}</span>
              <span className="menu-text">{r.label}{r.detail && <span className="menu-detail">{r.detail}</span>}</span>
              <span className="menu-key">⌘{++n}</span>
            </button>
          ))}
        </div>
      ))}
      <div className="menu-sep" />
      <button className="menu-item" onClick={() => { onClose(); onSettings(); }}>
        <span className="menu-check"><IconPlus /></span>
        <span className="menu-text">Add model or library…</span>
      </button>
    </div>
  );
}

function buildRows(b: SettingsBundle, save: (patch: Record<string, unknown>) => Promise<void>): Row[] {
  const ai = b.settings.ai, ollama = b.settings.ollama;
  const rows: Row[] = [
    { id: 'ollama', group: 'Models', label: 'Ollama', detail: ollama.model, checked: ai.enabled && ai.kind === 'ollama', run: () => save({ ai: { enabled: true, kind: 'ollama' } }) },
  ];
  // A hosted provider, if one has been set up (its key, URL and model are kept even while Ollama is selected).
  if (b.aiKeySet && ai.baseUrl && ai.model) {
    rows.push({ id: 'hosted', group: 'Models', label: hostLabel(ai), detail: ai.model, checked: ai.enabled && ai.kind !== 'ollama', run: () => save({ ai: { enabled: true, kind: ai.kind === 'ollama' ? inferKind(ai.baseUrl) : ai.kind } }) });
  }
  rows.push({ id: 'off', group: 'Models', label: 'No AI answers', checked: !ai.enabled, run: () => save({ ai: { enabled: false } }) });
  rows.push({ id: 'notes', group: 'Local DB', label: 'Your notes', detail: 'always on', checked: true, run: () => {} });
  for (const l of b.libraries) {
    const off = b.settings.library.disabled.includes(l.name);
    rows.push({ id: `lib-${l.name}`, group: 'Local DB', label: l.label, detail: `${l.articles.toLocaleString()} articles`, checked: !off, run: () => save({ library: { disabled: off ? b.settings.library.disabled.filter(x => x !== l.name) : [...b.settings.library.disabled, l.name] } }) });
  }
  return rows;
}

export function TopBar({ title, status, onBack, onStop, children, view, onView, onSettings, timeline = false }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn" onClick={onBack} aria-label="Back to library" title="Library"><IconBack /></button>
        <div className="tab">
          <IconBook />
          <span className="tab-title">{title}</span>
          {status && <span className="tab-status"><span className="dot" />{status}</span>}
          {onStop && <button className="tab-stop" onClick={onStop}>Stop</button>}
        </div>
        {children}
      </div>
      <div className="topbar-right">
        <div className="segmented" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'cluster'} className={view === 'cluster' ? 'on' : ''} onClick={() => onView('cluster')}>Cluster</button>
          <button role="tab" aria-selected={view === 'timeline'} className={view === 'timeline' ? 'on' : ''} onClick={() => onView('timeline')} disabled={!timeline} title={timeline ? undefined : 'Timeline view is coming in the next step'}>Timeline</button>
        </div>
        <div className="split" ref={wrap}>
          <button className="split-main" onClick={onSettings}><IconGear />Settings</button>
          <button className="split-more" aria-label="Models and local databases" aria-expanded={open} onClick={() => setOpen(o => !o)}><IconChevronDown /></button>
          {open && <ModelsMenu onClose={() => setOpen(false)} onSettings={onSettings} />}
        </div>
      </div>
    </header>
  );
}
