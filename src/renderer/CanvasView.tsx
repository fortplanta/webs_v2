import { useEffect, useRef, useState } from 'react';
import { Excalidraw, restoreElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import type { GeneratedFragment, PivotEvent } from '../backend/events';
import type { InboxItem } from '../types/capture';
import type { SavedFile } from '../types/ipc';
import { captionLabel, clusterLabel, edgeLabel, FRAG_H, FRAG_W, fragmentLook, GAP, HEADER_H } from './boxes';
import { fragmentFromCapture, fragmentFromPaste, looksLikeExcalidrawClipboard } from './capture';
import { ClusterEditor, EdgeEditor, FragmentEditor, ImageCardEditor, InboxPanel, type StickProps } from './Editors';
import { hitTest } from './hit';
import { useLiveLayout } from './layout/useLiveLayout';
import { addImageCard, imageCardLayout, type ImageCardData } from './imageCard';
import { addPivotCluster, addThread, pivotFootprint, placePivot, threadLabelBox, usedPassageIds } from './pivot';
import { addTether, removeTether, tetherOf } from './tether';
import { revealView } from './viewport';
import { blobToDataURL, contentId, describeResize, ImageImportError, imageTypeOf, looksLikeImage, prepareImage } from './images';
import { buildSkeletons } from './layout';
import { convertWithStableIds, mergeScene } from './sceneMerge';
import { addBox, arrowCenterBox, findFreeSpot, removeBox, updateBox, type El } from './sceneEdit';
import type { WebModel } from './webModel';

interface Props {
  /** Identifies the web, so image data can be stored against it. */
  webId: string;
  model: WebModel;
  /** A saved scene to show exactly as stored. When set, the canvas is not rebuilt from `model`. */
  restoredScene?: unknown[];
  /** Image pixel data saved with the web. */
  restoredFiles?: SavedFile[];
  /** Called (debounced) when the user's scene actually changes. */
  onSceneChange?: (elements: unknown[]) => void;
}

type Editing =
  | { kind: 'fragment'; id: string; fragment: GeneratedFragment }
  | { kind: 'cluster'; id: string; title: string; lens?: string; origin?: 'ai' | 'wiki' }
  | { kind: 'edge'; id: string; label: string }
  | { kind: 'image'; id: string; data: ImageCardData }
  | null;

const SAVE_DEBOUNCE_MS = 800;
/** How much of the viewport framed content may fill — less than 1, since toolbars float over the canvas edges. */
const FIT_FACTOR = 0.78;
const INBOX_POLL_MS = 30_000;

interface InboxState { items: InboxItem[]; unsupported: number; error: string | null; busy: boolean }
const emptyInbox: InboxState = { items: [], unsupported: 0, error: null, busy: false };

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const build = (skeletons: unknown[]) => convertWithStableIds(skeletons) as El[];
const makeArrow = (raw: El): El => restoreElements([raw as any], null)[0] as unknown as El;

export function CanvasView({ webId, model, restoredScene, restoredFiles, onSceneChange }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [captureUrl, setCaptureUrl] = useState('');
  const [inbox, setInbox] = useState<InboxState>(emptyInbox);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [pivot, setPivot] = useState<{ status: string } | null>(null);
  // Picking what to stick a card to: set to that card's id until the user clicks a target (or cancels).
  const [sticking, setSticking] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const cancelPivot = useRef<(() => void) | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const fileInput = useRef<HTMLInputElement>(null);
  const savedFiles = useRef(new Set<string>((restoredFiles ?? []).map(f => f.id)));
  const applied = useRef(new Map<string, string>());
  const framed = useRef('');
  const navigated = useRef(false);
  const lastHash = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const restored = restoredScene !== undefined;
  // Layout stays hands-off until the user first touches the canvas, so reopening a saved web never rearranges it.
  const [touched, setTouched] = useState(false);
  const liveLayout = useLiveLayout(api, touched);

  useEffect(() => {
    if (!api || restored) return;
    const next = convertWithStableIds(buildSkeletons(model));
    const { elements, signatures } = mergeScene(api.getSceneElements() as any, next, applied.current);
    applied.current = signatures;
    api.updateScene({ elements: elements as any });
    setTouched(true); // fresh generations settle themselves from the start

    // Keep the whole web in view while it grows (collections arrive one after another and the web is centred on
    // the topic, so each addition shifts the middle) — until the user takes over the viewport.
    const stage = `${model.kb.length > 0 ? 'kb' : ''}:${model.clusters.length}`;
    if (!navigated.current && framed.current !== stage) {
      framed.current = stage;
      frame(elements as El[], true);
    }
  }, [api, model, restored]);

  // Fit the viewport to exactly these elements. Passing them explicitly (rather than letting Excalidraw
  // read its scene back) avoids framing a scene that hasn't absorbed our last update yet, which
  // produced absurd zoom levels.
  function frame(elements: El[], animate: boolean) {
    const target = elements.filter(e => !e.isDeleted);
    if (!api || target.length === 0) return;
    requestAnimationFrame(() => api.scrollToContent(target as any, { fitToViewport: true, viewportZoomFactor: FIT_FACTOR, animate }));
  }

  // A reopened web is shown as stored; just fit it to the viewport once.
  useEffect(() => {
    if (api && restored) frame(restoredScene as El[], false);
  }, [api, restored]);

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(noticeTimer.current); cancelPivot.current?.(); }, []);

  function say(kind: 'info' | 'error', text: string) {
    clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    noticeTimer.current = setTimeout(() => setNotice(null), kind === 'error' ? 12_000 : 7_000);
  }

  function handleChange(elements: readonly { id: string; version: number; type?: string; fileId?: string; isDeleted?: boolean }[], _app: unknown, files: Record<string, BinaryFileData>) {
    liveLayout.poke();

    // Persist each image's pixels once, the first time an image element referencing it is on the scene.
    for (const el of elements) {
      if (el.type !== 'image' || el.isDeleted || !el.fileId || savedFiles.current.has(el.fileId)) continue;
      const f = files[el.fileId];
      if (!f) continue;
      savedFiles.current.add(el.fileId);
      void window.webs.saveFile(webId, { id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created }).then(r => {
        if (!r.ok) { savedFiles.current.delete(el.fileId!); say('error', `Couldn't save an image with this web (${r.message}). It will be missing after you reopen it.`); }
      });
    }

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

  function openEditor(hit: { id: string; kind: 'fragment' | 'cluster' | 'image' | 'edge' }) {
    const el = byId(hit.id);
    if (!el) return;
    api!.updateScene({ appState: { selectedElementIds: { [hit.id]: true } } as any });
    if (hit.kind === 'fragment') setEditing({ kind: 'fragment', id: hit.id, fragment: el.customData.fragment });
    else if (hit.kind === 'cluster') setEditing({ kind: 'cluster', id: hit.id, title: el.customData.title, lens: el.customData.lens, origin: el.customData.origin });
    else if (hit.kind === 'image') setEditing({ kind: 'image', id: hit.id, data: el.customData });
    else setEditing({ kind: 'edge', id: hit.id, label: scene().find(e => e.type === 'text' && e.containerId === hit.id && !e.isDeleted)?.text ?? '' });
  }

  // Dropping image files onto the canvas. Other file types are left to the browser/Excalidraw.
  const dragHasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files');
  function onDragOverCapture(e: React.DragEvent) {
    if (dragHasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  }
  function onDropCapture(e: React.DragEvent) {
    if (!api) return;
    const dropped = [...e.dataTransfer.files].filter(looksLikeImage);
    if (dropped.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
    void importImages(dropped, { x: p.x, y: p.y });
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
    apply(updateBox(scene(), id, { customData: { ...el.customData, title }, label: clusterLabel(title || ' ', el.customData.origin) }, build));
    setEditing({ kind: 'cluster', id, title, lens: el.customData.lens, origin: el.customData.origin });
  }

  function editEdge(id: string, label: string) {
    const el = byId(id);
    if (!el) return;
    apply(updateBox(scene(), id, label.trim() ? { label: edgeLabel(label), geometry: arrowCenterBox(el) } : { label: null }, build));
    setEditing({ kind: 'edge', id, label });
  }

  function editImage(id: string, caption: string) {
    const el = byId(id);
    if (!el) return;
    const data = { ...el.customData, caption } as ImageCardData;
    apply(updateBox(scene(), id, { customData: data, label: caption.trim() ? captionLabel(caption) : null }, build));
    setEditing({ kind: 'image', id, data });
  }

  /** Scroll (and zoom out if needed) just enough to show `bounds`; does nothing if already visible. */
  function reveal(bounds: { x: number; y: number; width: number; height: number }) {
    const a = api!.getAppState();
    const next = revealView({ scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom.value, width: a.width, height: a.height }, bounds);
    if (next) api!.updateScene({ appState: { scrollX: next.scrollX, scrollY: next.scrollY, zoom: { value: next.zoom } } as any });
  }

  /** Swap a card's content in place (used when the model's card replaces a draft excerpt). */
  function replaceFragment(id: string, fragment: GeneratedFragment) {
    const el = byId(id);
    if (!el) return;
    const look = fragmentLook(fragment);
    apply(updateBox(scene(), id, { backgroundColor: look.backgroundColor, customData: { ...el.customData, fragment }, link: fragment.link ?? null, label: look.label }, build));
  }

  // ── Tethers: keep a card within reach of another ───────────────────────────

  function nameOf(el: El): string {
    const d = el.customData ?? {};
    return (d.kind === 'cluster' ? d.title : d.kind === 'fragment' ? d.fragment?.title : d.caption || d.name) || 'an item';
  }

  function stickProps(id: string): StickProps {
    const t = tetherOf(scene(), id);
    const anchor = t && byId(t.startBinding.elementId);
    return {
      to: anchor ? nameOf(anchor) : null,
      onStick: () => { setEditing(null); setSticking(id); },
      onUnstick: () => { apply(removeTether(scene(), id)); redraw(n => n + 1); },
    };
  }

  function finishSticking(anchorId: string | null) {
    const child = sticking;
    setSticking(null);
    if (!child || !anchorId) return;
    if (anchorId === child) return;
    const next = addTether(scene(), anchorId, child, makeArrow);
    if (next === scene() || !tetherOf(next, child)) { say('error', "That would make a loop — a label can't stay near something that stays near it."); return; }
    apply(next);
    say('info', `Stuck to “${nameOf(byId(anchorId)!)}”. Drag either one to see it follow.`);
  }

  function onPointerDownCapture(e: React.PointerEvent) {
    navigated.current = true;
    if (!touched) setTouched(true);
    if (!sticking || !api) return;
    e.stopPropagation();
    e.preventDefault();
    const app = api.getAppState();
    const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, app);
    const hit = hitTest(api.getSceneElements() as unknown as El[], x, y, app.zoom.value);
    finishSticking(hit && hit.kind !== 'edge' ? hit.id : null);
  }

  useEffect(() => {
    if (!sticking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSticking(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sticking]);

  // ── Pivot: grow a new collection out of a card ────────────────────────────

  function startPivot(cardId: string) {
    const el = byId(cardId);
    if (!api || !el || pivot) return;
    setEditing(null);
    setPivot({ status: 'Searching your KB…' });
    const prefix = `pv-${crypto.randomUUID().slice(0, 8)}`;
    cancelPivot.current = window.webs.pivot({ card: el.customData.fragment, usedPassageIds: usedPassageIds(scene()) }, ev => onPivotEvent(prefix, cardId, ev));
  }

  function stopPivot() {
    cancelPivot.current?.();
    cancelPivot.current = null;
    setPivot(null);
  }

  function onPivotEvent(prefix: string, cardId: string, ev: PivotEvent) {
    if (!api) return;
    switch (ev.type) {
      case 'status': setPivot({ status: ev.message }); break;
      case 'plan': {
        const pos = placePivot(scene(), cardId, ev.cards.length);
        if (!pos) { stopPivot(); say('error', 'The card this was growing from is gone.'); return; }
        const added = addPivotCluster(scene(), { id: prefix, ...pos, title: ev.title, lens: ev.lens, fromCardId: cardId, cards: ev.cards }, build);
        let next = addThread(added.elements, { id: `${prefix}-thread`, fromId: cardId, toId: prefix, label: ev.edge }, build, makeArrow);
        // The new cards stay near their collection's header.
        for (const id of added.cardIds) next = addTether(next, added.headerId, id, makeArrow);
        apply(next);
        reveal(pivotFootprint(pos, ev.cards.length));
        break;
      }
      case 'title': {
        const header = byId(prefix);
        if (header) apply(updateBox(scene(), prefix, { customData: { ...header.customData, title: ev.title }, label: clusterLabel(ev.title) }, build));
        const thread = byId(`${prefix}-thread`);
        if (thread && ev.edge) apply(updateBox(scene(), thread.id, { label: edgeLabel(ev.edge), geometry: threadLabelBox(thread) }, build));
        break;
      }
      case 'card': replaceFragment(`${prefix}-c${ev.slot}`, ev.fragment); break;
      case 'done': setPivot(null); cancelPivot.current = null; break;
      case 'error': setPivot(null); cancelPivot.current = null; say('error', ev.message); break;
    }
  }

  /** Every way an image arrives (button, paste, drop) comes through here. */
  async function importImages(files: File[], at?: { x: number; y: number }) {
    if (!api) return;
    const images = files.filter(looksLikeImage);
    const problems: string[] = [], notes: string[] = [];
    const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
    let last: string | null = null;
    for (const file of images) {
      try {
        const p = await prepareImage(file);
        const fileId = await contentId(p.blob);
        const dataURL = await blobToDataURL(p.blob);
        api.addFiles([{ id: fileId as BinaryFileData['id'], mimeType: p.mimeType as BinaryFileData['mimeType'], dataURL: dataURL as BinaryFileData['dataURL'], created: Date.now() }]);

        const lay = imageCardLayout(p.width, p.height);
        const prev = placed.at(-1);
        // The first image goes where asked (default: middle of the view); the rest follow in a row.
        const spot = prev ? { x: prev.x + prev.width + GAP, y: prev.y } : at ?? (() => { const c = viewCenter(); return { x: c.x - lay.width / 2, y: c.y - lay.height / 2 }; })();
        const pos = findFreeSpot(scene(), spot, lay.width, lay.height);
        const id = `m-${crypto.randomUUID().slice(0, 8)}`;
        const added = addImageCard(scene(), {
          id, x: pos.x, y: pos.y,
          data: { fileId, caption: '', name: p.name, width: p.width, height: p.height, ...(p.resizedFrom ? { resizedFrom: p.resizedFrom } : {}) },
        }, build, raw => restoreElements([raw as any], null)[0] as unknown as El);
        apply(added.elements);
        placed.push({ x: pos.x, y: pos.y, width: added.width, height: added.height });
        last = added.cardId;
        if (p.resizedFrom) notes.push(describeResize(p.name, p.resizedFrom, { bytes: p.blob.size, width: p.width, height: p.height }));
      } catch (err) {
        problems.push(`${file.name || 'image'}: ${err instanceof ImageImportError ? err.message : (err as Error).message}`);
      }
    }
    if (last) api.updateScene({ appState: { selectedElementIds: { [last]: true, [`${last}-image`]: true }, selectedGroupIds: { [`grp-${last}`]: true } } as any });
    if (placed.length) {
      const x1 = Math.min(...placed.map(b => b.x)), y1 = Math.min(...placed.map(b => b.y));
      const x2 = Math.max(...placed.map(b => b.x + b.width)), y2 = Math.max(...placed.map(b => b.y + b.height));
      reveal({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
    }
    if (problems.length) say('error', [...problems, ...notes].join('\n'));
    else if (notes.length) say('info', notes.join('\n'));
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
      if (!data) return;
      const pastedImages = [...data.files].filter(looksLikeImage);
      if (pastedImages.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        void importImages(pastedImages);
        return;
      }
      if (data.files.length > 0) return;
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
      <div className={`canvas-inner${sticking ? " sticking" : ""}`} onPointerDownCapture={onPointerDownCapture} onWheelCapture={() => { navigated.current = true; }} onDoubleClickCapture={onDoubleClickCapture} onDragOverCapture={onDragOverCapture} onDropCapture={onDropCapture}>
        <Excalidraw
          excalidrawAPI={setApi}
          onChange={handleChange as any}
          UIOptions={{ tools: { image: false } }}
          initialData={{
            files: Object.fromEntries((restoredFiles ?? []).map(f => [f.id, f])) as any,
            elements: restored ? (restoredScene as any) : undefined,
            appState: { viewBackgroundColor: '#f8f8f8' },
          }}
        />
      </div>

      <div className="canvas-tools">
        <button onClick={addFreeFragment} disabled={!api}>＋ Fragment</button>
        <button className="secondary" onClick={() => fileInput.current?.click()} disabled={!api}>＋ Image</button>
        {sticking && <><span className="hint">Click the card or label it should stay near</span><button className="secondary" onClick={() => setSticking(null)}>Cancel</button></>}
        {pivot && <><span className="hint">Exploring · {pivot.status}</span><button className="secondary" onClick={stopPivot}>Stop</button></>}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void importImages(f); }} />
        {captureUrl && <button className="secondary" onClick={() => { setInboxOpen(o => !o); void refreshInbox(); }} aria-pressed={inboxOpen}>Inbox{inbox.items.length > 0 ? ` (${inbox.items.length})` : ''}</button>}
        {(() => {
          const has = (o: 'ai' | 'wiki') => model.clusters.some(c => c.origin === o || c.slots.some(f => f?.origin === o));
          const parts = [!model.clusters.every(c => c.origin) && '▤ your notes', has('wiki') && 'W Wikipedia', has('ai') && '✦ AI'].filter(Boolean);
          return parts.length > 1 || has('ai') || has('wiki') ? <span className="hint legend" title="Where each card's content comes from: your notes (no outline), Wikipedia and other offline libraries (solid blue outline), your AI provider (dashed outline)">{parts.join(' · ')}</span> : null;
        })()}
        <span className="hint">Double-click a card or connection to edit · paste or drop text, links and images</span>
      </div>

      {inboxOpen && captureUrl && (
        <InboxPanel
          items={inbox.items} unsupported={inbox.unsupported} error={inbox.error} busy={inbox.busy} serviceUrl={captureUrl}
          onAdd={addCapture} onAddAll={addAllCaptures} onDismiss={dismissCapture} onRefresh={refreshInbox} onClose={() => setInboxOpen(false)}
        />
      )}

      {notice && <div className={`canvas-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}

      {editing?.kind === 'image' && (
        <ImageCardEditor key={editing.id} data={editing.data} onCaption={c => editImage(editing.id, c)} onDelete={() => remove(editing.id)} onClose={() => setEditing(null)} stick={stickProps(editing.id)} />
      )}
      {editing?.kind === 'fragment' && (
        <FragmentEditor key={editing.id} fragment={editing.fragment} onChange={f => editFragment(editing.id, f)} onDelete={() => remove(editing.id)} onClose={() => setEditing(null)} onPivot={() => startPivot(editing.id)} pivoting={!!pivot} stick={stickProps(editing.id)} />
      )}
      {editing?.kind === 'cluster' && (
        <ClusterEditor key={editing.id} title={editing.title} lens={editing.lens} origin={editing.origin} aiModel={model.aiModel} onChange={t => editCluster(editing.id, t)} onAddFragment={() => addToCluster(editing.id)} onClose={() => setEditing(null)} stick={stickProps(editing.id)} />
      )}
      {editing?.kind === 'edge' && (
        <EdgeEditor key={editing.id} label={editing.label} onChange={l => editEdge(editing.id, l)} onDelete={() => remove(editing.id)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
