import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCommands, type Command } from './commands';
import { IconCheck } from './icons';

const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
);

export interface CommandPaletteProps {
  /** Static commands, plus any that depend on what's typed (e.g. "Generate a web for …"). */
  commands: Command[] | ((query: string) => Command[]);
  onClose: () => void;
}

/** ⌘K: type to find a command, a saved web or a card on the canvas. ↑↓ to move, ↵ to run, Esc to close. */
export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const all = typeof commands === 'function' ? commands(query) : commands;
  const shown = useMemo(() => filterCommands(all, query), [all, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [active, shown]);

  function run(c: Command | undefined) {
    if (!c) return;
    onClose();
    void c.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (shown.length ? (a + 1) % shown.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (shown.length ? (a - 1 + shown.length) % shown.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(shown[active]); }
  }

  let lastGroup = '';
  return (
    <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="palette-input">
          <IconSearch />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Type a command or search…" spellCheck={false} aria-label="Command" />
        </div>
        <div className="palette-list" ref={list} role="listbox">
          {shown.length === 0 && <div className="palette-empty">Nothing matches “{query}”.</div>}
          {shown.map((c, i) => {
            const header = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{c.group}</div>}
                <div className={`palette-item${i === active ? ' active' : ''}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => run(c)}>
                  <span className="palette-icon">{c.checked ? <IconCheck /> : c.icon}</span>
                  <span className="palette-label">{c.label}{c.detail && <span className="palette-detail">{c.detail}</span>}</span>
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
