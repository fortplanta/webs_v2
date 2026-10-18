import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface PopItem {
  id: string;
  label: string;
  /** Dimmer text after the label. */
  detail?: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  /** A thin rule above this item. */
  sepBefore?: boolean;
  run: () => void;
}

/** Index of the next enabled item in `dir`, wrapping; -1 if none. Pure so the keyboard behaviour is testable. */
export function nextEnabled(items: ReadonlyArray<{ disabled?: boolean }>, from: number, dir: 1 | -1): number {
  const n = items.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n;
    if (!items[i].disabled) return i;
  }
  return -1;
}

/**
 * A small floating menu at a screen point. Closes on Escape, a click elsewhere or choosing an item; ↑/↓ move, Enter
 * chooses, and the first item is focused so it is usable from the keyboard alone.
 */
export function PopMenu({ x, y, items, title, onClose }: { x: number; y: number; items: PopItem[]; title?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => nextEnabled(items, -1, 1));
  const [pos, setPos] = useState({ left: x, top: y });

  // keep it on screen
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y, items.length]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => nextEnabled(items, a, 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => nextEnabled(items, a, -1)); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); const it = items[active]; onClose(); it.run(); }
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', key, true); };
  }, [items, active, onClose]);

  return (
    <div ref={ref} className="popmenu" role="menu" aria-label={title} style={pos}>
      {title && <div className="popmenu-title">{title}</div>}
      {items.map((it, i) => (
        <div key={it.id}>
          {it.sepBefore && <div className="popmenu-sep" role="separator" />}
          <button
            role="menuitem" className={`popmenu-item${i === active ? ' active' : ''}${it.danger ? ' danger' : ''}`} disabled={it.disabled}
            onMouseEnter={() => !it.disabled && setActive(i)} onClick={() => { onClose(); it.run(); }}
          >
            <span className="popmenu-icon">{it.icon}</span>
            <span className="popmenu-label">{it.label}{it.detail && <span className="popmenu-detail">{it.detail}</span>}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
