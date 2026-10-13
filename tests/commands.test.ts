import { describe, expect, it } from 'vitest';
import { filterCommands, type Command } from '../src/renderer/commands';

const cmd = (id: string, group: string, label: string, extra: Partial<Command> = {}): Command => ({ id, group, label, run: () => {}, ...extra });
const cmds = [
  cmd('home', 'Navigation', 'Go to library', { keywords: 'home saved webs' }),
  cmd('settings', 'Navigation', 'Open settings'),
  cmd('frag', 'Actions', 'Add fragment'),
  cmd('fit', 'Actions', 'Zoom to fit'),
  cmd('c1', 'Cards', 'judgment over events', { detail: 'thesis' }),
  cmd('c2', 'Cards', 'stoicism origins'),
];

describe('filterCommands', () => {
  it('shows everything, grouped in order, when nothing is typed', () => {
    expect(filterCommands(cmds, '').map(c => c.id)).toEqual(['home', 'settings', 'frag', 'fit', 'c1', 'c2']);
  });
  it('matches every word anywhere in the label, detail or keywords, ignoring case and accents', () => {
    expect(filterCommands(cmds, 'ZOOM fit').map(c => c.id)).toEqual(['fit']);
    expect(filterCommands(cmds, 'saved').map(c => c.id)).toEqual(['home']);          // keyword
    expect(filterCommands(cmds, 'thesis').map(c => c.id)).toEqual(['c1']);           // detail
    expect(filterCommands([cmd('x', 'A', 'Café')], 'cafe')).toHaveLength(1);
    expect(filterCommands(cmds, 'nonsense')).toEqual([]);
  });
  it('ranks label starts, then word starts, then the rest, within a group', () => {
    const list = [cmd('a', 'G', 'Bigger zoom'), cmd('b', 'G', 'Zoom in'), cmd('c', 'G', 'Autozoom')];
    expect(filterCommands(list, 'zoom').map(c => c.id)).toEqual(['b', 'a', 'c']);
  });
  it('caps each group so a long one cannot crowd out the others', () => {
    const many = Array.from({ length: 20 }, (_, i) => cmd(`c${i}`, 'Cards', `card ${i}`));
    const out = filterCommands([...many, cmd('z', 'Actions', 'Zoom')], '', 5);
    expect(out.filter(c => c.group === 'Cards')).toHaveLength(5);
    expect(out.some(c => c.id === 'z')).toBe(true);
  });
});
