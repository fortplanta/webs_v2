import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { IconBranch, IconCut, IconEdit, IconExplore, IconLens, IconLink, IconMore } from './icons';
import type { El } from './sceneEdit';

export interface BarActions {
  busy: boolean;
  explore(id: string): void;
  branch(id: string): void;
  connect(id: string): void;
  lenses(id: string, at: { x: number; y: number }): void;
  more(id: string, at: { x: number; y: number }): void;
  /** For a selected connection: the same moves, from the line. */
  exploreFrom(arrowId: string): void;
  branchFrom(arrowId: string): void;
  editLink(arrowId: string): void;
  cut(arrowId: string): void;
}

type Target = { kind: 'card' | 'link'; id: string; x: number; y: number } | null;

/** What is selected, as a point on screen to hang the bar from: the top middle of one card, or the middle of one connection. */
function targetOf(api: ExcalidrawImperativeAPI): Target {
  const a = api.getAppState();
  const ids = Object.keys(a.selectedElementIds);
  if (!ids.length) return null;
  const els = api.getSceneElements() as unknown as El[];
  const byId = new Map(els.map(e => [e.id, e]));
  const sel = ids.map(id => byId.get(id)).filter((e): e is El => !!e);
  const screen = (x: number, y: number) => ({ x: (x + a.scrollX) * a.zoom.value, y: (y + a.scrollY) * a.zoom.value });
  const cards = sel.filter(e => e.type === 'rectangle' && e.customData?.kind === 'fragment');
  if (cards.length === 1 && sel.every(e => e.id === cards[0].id || e.customData?.card === cards[0].id || e.containerId === cards[0].id || e.groupIds?.some((g: string) => cards[0].groupIds?.includes(g)))) {
    const c = cards[0];
    return { kind: 'card', id: c.id, ...screen(c.x + c.width / 2, c.y) };
  }
  const lines = sel.filter(e => e.type === 'arrow' && e.customData?.kind !== 'tether');
  const texts = sel.filter(e => e.type === 'text' && e.containerId && byId.get(e.containerId)?.type === 'arrow');
  const arrow = lines.length === 1 && sel.length === 1 ? lines[0] : texts.length === 1 && sel.length === 1 ? byId.get(texts[0].containerId) : undefined;
  if (arrow && arrow.type === 'arrow' && arrow.points?.length >= 2) {
    const p = arrow.points, a0 = p[0], a1 = p[p.length - 1];
    return { kind: 'link', id: arrow.id, ...screen(arrow.x + (a0[0] + a1[0]) / 2, arrow.y + (a0[1] + a1[1]) / 2 - 18) };
  }
  return null;
}

function Btn({ label, children, onClick, disabled, danger }: { label: string; children: ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; danger?: boolean }) {
  return <button className={`selbar-btn${danger ? ' danger' : ''}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

/**
 * Quick actions on whatever is selected: a card (explore a new angle from it, branch, connect, look at it through a
 * lens) or a connection (explore, branch or cut from it). It follows the selection around the canvas; it listens to the
 * canvas itself, so panning does not re-render the app.
 */
export function SelectionBar({ api, actions, hidden }: { api: ExcalidrawImperativeAPI | null; actions: React.MutableRefObject<BarActions>; hidden?: boolean }) {
  const [target, setTarget] = useState<Target>(null);
  const frame = useRef(0);
  useEffect(() => {
    if (!api) return;
    const update = () => {
      frame.current = 0;
      const next = targetOf(api);
      setTarget(prev => (prev && next && prev.id === next.id && prev.kind === next.kind && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5) || (!prev && !next) ? prev : next);
    };
    const off = api.onChange(() => { if (!frame.current) frame.current = requestAnimationFrame(update); });
    update();
    return () => { off(); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [api]);

  if (hidden || !target) return null;
  const a = actions.current;
  const at = (e: React.MouseEvent<HTMLButtonElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: r.left, y: r.bottom + 6 }; };
  return (
    <div className="selbar" role="toolbar" aria-label={target.kind === 'card' ? 'Card actions' : 'Connection actions'} style={{ left: target.x, top: target.y }}>
      {target.kind === 'card' ? (
        <>
          <Btn label="Explore a different angle from this card" disabled={a.busy} onClick={() => a.explore(target.id)}><IconExplore /></Btn>
          <Btn label="Add a branch from this card" onClick={() => a.branch(target.id)}><IconBranch /></Btn>
          <Btn label="Connect to another card" onClick={() => a.connect(target.id)}><IconLink /></Btn>
          <Btn label="Look at it another way" onClick={e => a.lenses(target.id, at(e))}><IconLens /></Btn>
          <Btn label="More" onClick={e => a.more(target.id, at(e))}><IconMore /></Btn>
        </>
      ) : (
        <>
          <Btn label="Explore a new angle from this connection" disabled={a.busy} onClick={() => a.exploreFrom(target.id)}><IconExplore /></Btn>
          <Btn label="Add a branch from this connection" onClick={() => a.branchFrom(target.id)}><IconBranch /></Btn>
          <Btn label="Edit the label" onClick={() => a.editLink(target.id)}><IconEdit /></Btn>
          <Btn label="Cut this connection" danger onClick={() => a.cut(target.id)}><IconCut /></Btn>
        </>
      )}
    </div>
  );
}
