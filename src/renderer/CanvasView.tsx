import { useEffect, useRef, useState } from 'react';
import { Excalidraw, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import type { GeneratedFragment } from '../backend/events';
import type { InboxItem } from '../types/capture';
import { clusterLabel, edgeLabel, FRAG_H, FRAG_W, fragmentLook, GAP, HEADER_H } from './boxes';
import { fragmentFromCapture, fragmentFromPaste, looksLikeExcalidrawClipboard } from './capture';
import { ClusterEditor, EdgeEditor, FragmentEditor, InboxPanel } from './Editors';
import { hitTest } from './hit';
import { buildSkeletons } from './layout';
import { convertWithStableIds, mergeScene } from './sceneMerge';
import { addBox, arrowCenterBox, findFreeSpot, removeBox, updateBox, type El } from './sceneEdit';
import type { WebModel } from './webModel';

interface Props {
  model: WebModel;
  /** A saved scene to show exactly as stored. When set, the canvas is not rebuilt from `model`. */
  restoredScene?: unknown[];
  /** Called (debounced) when the user's scene actually changes. */
  onSceneChange?: (elements: unknown[]) => void;
}

type Editing =
  | { kind: 'fragment'; id: string; fragment: GeneratedFragment }
  | { kind: 'cluster'; id: string; title: string }
  | { kind: 'edge'; id: string; label: string }
  | null;

const SAVE_DEBOUNCE_MS = 800;
const INBOX_POLL_MS = 30_000;

interface InboxState { items: InboxItem[]; unsupported: number; error: string | null; busy: boolean }
const emptyInbox: InboxState = { items: [], unsupported: 0, error: null, busy: false };

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const build = (skeletons: unknown[]) => convertWithStableIds(skeletons) as El[];

export function CanvasView({ model, restoredScene, onSceneChange }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [captureUrl, setCaptureUrl] = useState('');
  const [inbox, setInbox] = useState<InboxState>(emptyInbox);
  const [inboxOpen, setInboxOpen] = useState(false);
  const applied = useRef(new Map<string, string>());
  const framed = useRef({ kb: false, overview: false });
  const lastHash = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const restored = restoredScene !== undefined;

  useEffect(() => {
    if (!api || restored) return;
    const next = convertWithStableIds(buildSkeletons(model));
    const { elements, signatures } = mergeScene(api.getSceneElements() as any, next, applied.current);
    applied.current = signatures;
    api.updateScene({ elements: elements as any });

    // Re-frame once when the first content lands and once when the outline defines the layout.
    const stage = model.clusters.length > 0 ? 'overview' : 'kb';
    if (!framed.current[stage]) {
      framed.current[stage] = true;
      requestAnimationFrame(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true }));
    }
  }, [api, model, restored]);

  // A reopened web is shown as stored; just fit it to the viewport once.
  useEffect(() => {
    if (!api || !restored) return;
    requestAnimationFrame(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 }));
  }, [api, restored]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleChange(elements: readonly { id: string; version: number }[]) {
    if (!onSceneChange || elements.length === 0) return;
    // Pan/zoom/selection also fire onChange; only persist when an element actually changed.
    const hash = elements.map(e => `${e.id}:${e.version}`).join(',');
    if (lastHash.current === null) { lastHash.current = hash; if (restored) return; }
    if (hash === lastHash.current) return;
    lastHash.current = hash;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSceneChange(api ? (api.getSceneElementsIncludingDeleted() as unknown[]) : [...elements]), SAVE_DEBOUNCE_MS);
  }

  // ── Manual editing ────────────────────────────────────────────────────────

  const scene = () => [...(api!.getSceneElementsIncludingDeleted() as unknown as El[])];
  const apply = (next: El[]) => api!.updateScene({ elements: next as any });
  const byId = (id: string) => scene().find(e => e.id === id && !e.isDeleted);

  function openEditor(hit: { id: string; kind: 'fragment' | 'cluster' | 'edge' }) {
    const el = byId(hit.id);
    if (!el) return;
    api!.updateScene({ appState: { selectedElementIds: { [hit.id]: true } } as any });
    if (hit.kind === 'fragment') setEditing({ kind: 'fragment', id: hit.id, fragment: el.customData.fragment });
    else if (hit.kind === 'cluster') setEditing({ kind: 'cluster', id: hit.id, title: el.customData.title });
    else setEditing({ kind: 'edge', id: hit.id, label: scene().find(e => e.type === 'text' && e.containerId === hit.id && !e.isDeleted)?.text ?? '' });
  }

  function onDoubleClickCapture(e: React.MouseEvent) {
    if (!api) return;
    const app = api.getAppState();
    const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, app);
    const hit = hitTest(api.getSceneElements() as unknown as El[], x, y, app.zoom.value);
    if (!hit) return; // empty canvas / user-drawn shapes keep Excalidraw's native behaviour
    e.stopPropagation(); // keep Excalidraw from opening its raw text editor on our boxes
    e.preventDefault();
    openEditor(hit);
  }

  function editFragment(id: string, fragment: GeneratedFragment) {
    const el = byId(id);
    if (!el) return;
    const look = fragmentLook(fragment);
    apply(updateBox(scene(), id, { backgroundColor: look.backgroundColor, customData: { ...el.customData, fragment }, link: fragment.link ?? null, label: look.label }, build));
    setEditing({ kind: 'fragment', id, fragment });
  }

  function editCluster(id: string, title: string) {
    const el = byId(id);
    if (!el) return;
    apply(updateBox(scene(), id, { customData: { ...el.customData, title }, label: clusterLabel(title || ' ') }, build));
    setEditing({ kind: 'cluster', id, title });
  }

  function editEdge(id: string, label: string) {
    const el = byId(id);
    if (!el) return;
    apply(updateBox(scene(), id, label.trim() ? { label: edgeLabel(label), geometry: arrowCenterBox(el) } : { label: null }, build));
    setEditing({ kind: 'edge', id, label });
  }

  function remove(id: string) {
    apply(removeBox(scene(), id));
    setEditing(null);
  }

  /** Places a card and returns its id. `open` also selects it and opens the editor. */
  function newFragment(at: { x: number; y: number }, cluster?: number, fragment: GeneratedFragment = { type: 'concept', title: 'new fragment', body: 'Describe this fragment.', tags: [] }, open = true): string {
    const look = fragmentLook(fragment);
    const id = `m-${crypto.randomUUID().slice(0, 8)}`;
    apply(addBox(scene(), {
      id, x: at.x, y: at.y, width: FRAG_W, height: FRAG_H,
      backgroundColor: look.backgroundColor, label: look.label, link: fragment.link,
      customData: { kind: 'fragment', ...(cluster !== undefined ? { cluster } : {}), fragment },
    }, build));
    if (open) {
      api!.updateScene({ appState: { selectedElementIds: { [id]: true } } as any });
      setEditing({ kind: 'fragment', id, fragment });
    }
    return id;
  }

  const viewCenter = () => {
    const app = api!.getAppState();
    return viewportCoordsToSceneCoords({ clientX: app.offsetLeft + app.width / 2, clientY: app.offsetTop + app.height / 2 }, app);
  };

  /** Free spot near the middle of the view for a new card. */
  const freeSpotInView = () => {
    const c = viewCenter();
    return findFreeSpot(scene(), { x: c.x - FRAG_W / 2, y: c.y - FRAG_H / 2 }, FRAG_W, FRAG_H);
  };

  function addFreeFragment() {
    if (api) newFragment(freeSpotInView());
  }

  function addToCluster(id: string) {
    const header = byId(id);
    if (!header) return;
    // Stack under whatever already sits in this column (generated slots, ghost slots, earlier additions).
    const column = scene().filter(e => !e.isDeleted && e.type === 'rectangle' && Math.abs(e.x - header.x) < 1 && e.y > header.y);
    const bottom = Math.max(header.y + HEADER_H, ...column.map(e => e.y + e.height));
    newFragment({ x: header.x, y: bottom + GAP }, header.customData.index);
  }

  // ── Paste & capture inbox ─────────────────────────────────────────────────

  // Text/URL pasted onto the canvas becomes a card. Capture phase on `document` runs before
  // Excalidraw's own paste handler; images, Excalidraw's own clipboard and text fields are left alone.
  useEffect(() => {
    if (!api) return;
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const data = e.clipboardData;
      if (!data || data.files.length > 0) return;
      const text = data.getData('text/plain');
      if (looksLikeExcalidrawClipboard(text)) return;
      const fragment = fragmentFromPaste(text);
      if (!fragment) return;
      e.preventDefault();
      e.stopPropagation();
      newFragment(freeSpotInView(), undefined, fragment);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  });

  useEffect(() => {
    window.webs.getSettings().then(b => setCaptureUrl(b.settings.capture.url)).catch(() => {});
  }, []);

  async function refreshInbox() {
    setInbox(i => ({ ...i, busy: true }));
    const r = await window.webs.getInbox();
    setInbox(r.ok ? { items: r.items, unsupported: r.unsupported, error: null, busy: false } : { ...emptyInbox, error: r.message });
  }

  useEffect(() => {
    if (!captureUrl) return;
    void refreshInbox();
    const t = setInterval(() => { void refreshInbox(); }, INBOX_POLL_MS);
    return () => clearInterval(t);
  }, [captureUrl]);

  async function addCapture(item: InboxItem) {
    if (!api) return;
    const id = newFragment(freeSpotInView(), undefined, fragmentFromCapture(item), false);
    setInbox(i => ({ ...i, items: i.items.filter(x => x.id !== item.id) }));
    const r = await window.webs.fileCapture(item.id, id);
    if (!r.ok) setInbox(i => ({ ...i, error: `Placed on the canvas, but couldn't mark it filed (${r.message}). It may reappear here.` }));
  }

  async function addAllCaptures() {
    for (const item of [...inbox.items]) await addCapture(item);
  }

  async function dismissCapture(item: InboxItem) {
    setInbox(i => ({ ...i, items: i.items.filter(x => x.id !== item.id) }));
    const r = await window.webs.dismissCapture(item.id);
    if (!r.ok) setInbox(i => ({ ...i, error: `Couldn't dismiss it (${r.message}).` }));
  }

  return (
    <div className="canvas">
      <div className="canvas-inner" onDoubleClickCapture={onDoubleClickCapture}>
        <Excalidraw
          excalidrawAPI={setApi}
          onChange={handleChange as any}
          initialData={{
            elements: restored ? (restoredScene as any) : undefined,
            appState: { viewBackgroundColor: '#f8f8f8' },
          }}
        />
      </div>

      <div className="canvas-tools">
        <button onClick={addFreeFragment} disabled={!api}>＋ Fragment</button>
        {captureUrl && <button className="secondary" onClick={() => { setInboxOpen(o => !o); void refreshInbox(); }} aria-pressed={inboxOpen}>Inbox{inbox.items.length > 0 ? ` (${inbox.items.length})` : ''}</button>}
        <span className="hint">Double-click a card or connection to edit · paste text or a link to add a card</span>
      </div>

      {inboxOpen && captureUrl && (
        <InboxPanel
          items={inbox.items} unsupported={inbox.unsupported} error={inbox.error} busy={inbox.busy} serviceUrl={captureUrl}
          onAdd={addCapture} onAddAll={addAllCaptures} onDismiss={dismissCapture} onRefresh={refreshInbox} onClose={() => setInboxOpen(false)}
        />
      )}

      {editing?.kind === 'fragment' && (
        <FragmentEditor key={editing.id} fragment={editing.fragment} onChange={f => editFragment(editing.id, f)} onDelete={() => remove(editing.id)} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === 'cluster' && (
        <ClusterEditor key={editing.id} title={editing.title} onChange={t => editCluster(editing.id, t)} onAddFragment={() => addToCluster(editing.id)} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === 'edge' && (
        <EdgeEditor key={editing.id} label={editing.label} onChange={l => editEdge(editing.id, l)} onDelete={() => remove(editing.id)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
