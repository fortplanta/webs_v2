// What the command palette lists and how it filters. Pure, so it can be tested.

import type { ReactNode } from 'react';

export interface Command {
  id: string;
  group: string;
  label: string;
  /** Dimmer text after the label. */
  detail?: string;
  /** Shortcut, shown on the right. */
  hint?: string;
  /** Extra words that should also match. */
  keywords?: string;
  icon?: ReactNode;
  /** Marks the current choice in a set (shown with a check). */
  checked?: boolean;
  run: () => void | Promise<void>;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Commands matching every word of `query` (in the label, detail or keywords), best first: label starts with it,
 * then a word starts with it, then the rest. Group order is kept; `limit` caps each group so one big group
 * (every card on the canvas) can't push the others off the list.
 */
export function filterCommands(commands: Command[], query: string, limitPerGroup = 8): Command[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const scored = commands.flatMap((c, i) => {
    const label = norm(c.label), hay = norm(`${c.label} ${c.detail ?? ''} ${c.keywords ?? ''}`);
    if (!words.every(w => hay.includes(w))) return [];
    const score = !words.length ? 0 : label.startsWith(words[0]) ? 0 : label.split(/\s+/).some(t => t.startsWith(words[0])) ? 1 : 2;
    return [{ c, score, i }];
  });
  const groups = new Map<string, typeof scored>();
  for (const s of scored) groups.set(s.c.group, [...(groups.get(s.c.group) ?? []), s]);
  return [...groups.values()].flatMap(g => g.sort((a, b) => a.score - b.score || a.i - b.i).slice(0, limitPerGroup).map(s => s.c));
}
