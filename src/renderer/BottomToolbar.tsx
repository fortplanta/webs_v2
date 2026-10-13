import { useEffect, useRef, useState } from 'react';
import { IconChevronUp, IconCursor, IconFit, IconImage, IconInbox, IconMinus, IconPlus } from './icons';

export interface BottomToolbarProps {
  disabled?: boolean;
  onFragment: () => void;
  onImage: () => void;
  /** Present when a capture service is configured. */
  inbox?: { count: number; open: boolean; onToggle: () => void };
  /** Transient states shown in a chip above the toolbar (sticking a card, exploring…). */
  chips?: Array<{ text: string; action?: { label: string; run: () => void } }>;
  /** "▤ your notes · W Wikipedia · ✦ AI", when the web mixes sources. */
  legend?: string | null;
  onZoom: (how: 'in' | 'out' | 'fit') => void;
}

function Tip({ tip, children }: { tip: string; children: React.ReactNode }) {
  return <span className="tip" data-tip={tip}>{children}</span>;
}

/** The floating tool strip: select, add things, and a "More" menu (zoom, legend, hints). */
export function BottomToolbar({ disabled, onFragment, onImage, inbox, chips = [], legend, onZoom }: BottomToolbarProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div className="bottombar">
      {chips.map(c => (
        <div className="bar-chip" key={c.text} role="status">
          {c.text}
          {c.action && <button onClick={c.action.run}>{c.action.label}</button>}
        </div>
      ))}
      <div className="bottombar-row">
        <div className="tool-group">
          <Tip tip="Select"><button className="tool on" aria-label="Select" aria-pressed="true"><IconCursor /></button></Tip>
          <Tip tip="Add fragment"><button className="tool" onClick={onFragment} disabled={disabled} aria-label="Add fragment"><IconPlus /></button></Tip>
          <Tip tip="Add image"><button className="tool" onClick={onImage} disabled={disabled} aria-label="Add image"><IconImage /></button></Tip>
          {inbox && <Tip tip={`Inbox${inbox.count ? ` (${inbox.count})` : ''}`}><button className={`tool${inbox.open ? ' on' : ''}`} onClick={inbox.onToggle} aria-pressed={inbox.open} aria-label="Inbox"><IconInbox />{inbox.count > 0 && <span className="badge">{inbox.count}</span>}</button></Tip>}
        </div>
        <div className="more" ref={wrap}>
          <button className="more-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>More<IconChevronUp /></button>
          {open && (
            <div className="menu more-menu" role="menu">
              <button className="menu-item" onClick={() => onZoom('fit')}><span className="menu-check"><IconFit /></span><span className="menu-text">Zoom to fit</span><span className="menu-key">⇧1</span></button>
              <button className="menu-item" onClick={() => onZoom('in')}><span className="menu-check"><IconPlus /></span><span className="menu-text">Zoom in</span><span className="menu-key">⌘+</span></button>
              <button className="menu-item" onClick={() => onZoom('out')}><span className="menu-check"><IconMinus /></span><span className="menu-text">Zoom out</span><span className="menu-key">⌘−</span></button>
              <div className="menu-sep" />
              {legend && <div className="menu-note" title="Dashed outline: your AI provider. Solid blue outline: an offline library.">{legend}</div>}
              <div className="menu-note">Double-click a card or connection to edit. Paste or drop text, links and images.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
