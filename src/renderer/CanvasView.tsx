import { useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, restoreElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { LENS_CHOICES, type GeneratedFragment, type LensId, type PivotEvent, type WebEvent } from '../backend/events';
import type { InboxItem } from '../types/capture';
import type { CompanionItem } from '../types/companion';
import type { SavedFile } from '../types/ipc';
import { captionLabel, clusterLabel, edgeLabel, FRAG_H, FRAG_W, GAP, HEADER_H } from './boxes';
import { BottomToolbar } from './BottomToolbar';
import type { Command } from './commands';
import { TimelineView } from './TimelineView';
import { LodOverlay } from './LodOverlay';
import { BackdropOverlay } from './BackdropOverlay';
import { FlowOverlay } from './FlowOverlay';
import { FxOverlay } from './FxOverlay';
import { sound } from './sound';
import { PopMenu, type PopItem } from './PopMenu';
import { SelectionBar, type BarActions } from './SelectionBar';
import { branchSpot, connectionSeed } from './branch';
import { BUDGET, clipCard, planDerived, quoteCard, sourceText } from './derived';
import { drawFacts, drawMap, drawTimeline } from './infographic';
import { cutTargets, DRAG_PX, modeFor, type GestureMode } from './gesture';
import { IconBranch, IconCut, IconEdit, IconExplore, IconLink, IconLens, IconPlus } from './icons';
import type { TimelineCard } from './timeline';
import { addCard, cardSize, updateCard } from './card';
import { fragmentFromCapture, fragmentFromCompanion, fragmentFromPaste, looksLikeExcalidrawClipboard } from './capture';
import { ClusterEditor, ConnectPanel, EdgeEditor, FragmentEditor, ImageCardEditor, InboxPanel, type StickProps } from './Editors';
import { hitTest } from './hit';
import { useLiveLayout } from './layout/useLiveLayout';
import { useCamera } from './layout/useCamera';
import { fitTarget, viewFor, zoomBy } from './camera';
import { addImageCard, imageCardLayout, type ImageCardData } from './imageCard';
import { addPivotCluster, addThread, pivotFootprint, placePivot, threadLabelBox, usedPassageIds } from './pivot';
import { addTether, removeTether, tetherOf } from './tether';
import { addLink, hasLink, LINK_KIND } from './link';
import { revealView } from './viewport';
import { blobToDataURL, contentId, dataUrlToBlob, describeResize, ImageImportError, imageTypeOf, looksLikeImage, prepareImage } from './images';
import { buildSkeletons } from './layout';
import { convertWithStableIds, mergeScene } from './sceneMerge';
import { addBox, arrowCenterBox, dropOrphanPictures, findFreeSpot, removeBox, updateBox, type El } from './sceneEdit';
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
  /** 'timeline' shows the cards along a time axis instead of the collection map. */
  view?: 'cluster' | 'timeline';
  /** Lets the command palette ask the canvas for its commands (add, zoom, jump to a card…). */
  registerCommands?: (provider: (() => Command[]) | null) => void;
  /** Lets the generation hand pictures to the canvas as they are fetched. */
  registerImageSink?: (sink: ((ev: Extract<WebEvent, { type: 'image' | 'media-link' }>) => void) | null) => void;
}

type Editing =
  | { kind: 'fragment'; id: string; fragment: GeneratedFragment }
  | { kind: 'cluster'; id: string; title: string; lens?: string; origin?: 'ai' | 'wiki' }
  | { kind: 'edge'; id: string; label: string; link?: { by: 'user' | 'model'; tier: string; link: string; note?: string; explanation?: string } }
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
const makeImage = makeArrow; // same restore step for images
/** Longest side of a fetched picture on the canvas. */
const PICTURE_SIDE = 200;

export function CanvasView({ webId, model, restoredScene, restoredFiles, onSceneChange, view = 'cluster', registerCommands, registerImageSink }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [captureUrl, setCaptureUrl] = useState('');
  const [inbox, setInbox] = useState<InboxState>(emptyInbox);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [companionItems, setCompanionItems] = useState<CompanionItem[]>([]);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [pivot, setPivot] = useState<{ status: string } | null>(null);
  const [lensing, setLensing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ a: string; b: string; busy: boolean } | null>(null);
  // Picking the second card of a link after pressing Connect on the first.
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; title?: string; items: PopItem[] } | null>(null);
  // The link/branch/cut gesture (see gesture.ts): a trail while it is drawn, and which key is held to start one.
  const [trail, setTrail] = useState<{ mode: GestureMode; ax: number; ay: number; bx: number; by: number } | null>(null);
  const [held, setHeld] = useState<'l' | 'k' | null>(null);
  const heldRef = useRef<'l' | 'k' | null>(null);
  const gesture = useRef<{ mode: GestureMode; startId: string | null; startKind: string | null; sx: number; sy: number; moved: boolean; rmb: boolean } | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pivotAt = useRef<{ x: number; y: number } | undefined>(undefined);
  // Picking what to stick a card to: set to that card's id until the user clicks a target (or cancels).
  const [sticking, setSticking] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const [sceneTick, setSceneTick] = useState(0); // bumps when the scene changes, so the timeline stays current
  const viewRef = useRef(view);
  viewRef.current = view;
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
  const camera = useCamera(api);

  useEffect(() => {
    if (!api || restored) return;
    const next = convertWithStableIds(buildSkeletons(model));
    const merged = mergeScene(api.getSceneElements() as any, next, applied.current);
    const { signatures } = merged;
    const elements = dropOrphanPictures(merged.elements as El[]);
    applied.current = signatures;
    api.updateScene({ elements: liveLayout.stage(api.getSceneElements() as unknown as El[], elements as El[]) as any });
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
    if (kind === 'error') sound.play('error');
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
    if (viewRef.current === 'timeline') setSceneTick(t => t + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSceneChange(api ? (api.getSceneElementsIncludingDeleted() as unknown[]) : [...elements]), SAVE_DEBOUNCE_MS);
  }

  // ── Manual editing ────────────────────────────────────────────────────────

  const scene = () => [...(api!.getSceneElementsIncludingDeleted() as unknown as El[])];
  const apply = (next: El[]) => api!.updateScene({ elements: liveLayout.stage(scene(), next) as any });
  const byId = (id: string) => scene().find(e => e.id === id && !e.isDeleted);

  /** Selecting a card selects its whole group (box, title, footer), so dragging moves them together. */
  function selectionFor(id: string) {
    const el = byId(id);
    const g = el?.groupIds?.[el.groupIds.length - 1];
    if (!g) return { selectedElementIds: { [id]: true } };
    const members = scene().filter(e => !e.isDeleted && e.groupIds?.includes(g));
    return { selectedElementIds: Object.fromEntries(members.map(e => [e.id, true])), selectedGroupIds: { [g]: true } };
  }

  function openEditor(hit: { id: string; kind: 'fragment' | 'cluster' | 'image' | 'edge' }) {
    const el = byId(hit.id);
    if (!el) return;
    api!.updateScene({ appState: selectionFor(hit.id) as any });
    if (hit.kind === 'fragment') setEditing({ kind: 'fragment', id: hit.id, fragment: el.customData.fragment });
    else if (hit.kind === 'cluster') setEditing({ kind: 'cluster', id: hit.id, title: el.customData.title, lens: el.customData.lens, origin: el.customData.origin });
    else if (hit.kind === 'image') setEditing({ kind: 'image', id: hit.id, data: el.customData });
    else setEditing({ kind: 'edge', id: hit.id, label: scene().find(e => e.type === 'text' && e.containerId === hit.id && !e.isDeleted)?.text ?? '', ...(el.customData?.kind === LINK_KIND ? { link: el.customData } : {}) });
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
    apply(updateCard(scene(), id, fragment, el.customData, build));
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
    setEditing(prev => ({ kind: 'edge', id, label, ...(prev?.kind === 'edge' && prev.link ? { link: prev.link } : {}) }));
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
    if (next) camera.glideTo(next);
  }

  /** Swap a card's content in place (used when the model's card replaces a draft excerpt). */
  function replaceFragment(id: string, fragment: GeneratedFragment) {
    const el = byId(id);
    if (!el) return;
    apply(updateCard(scene(), id, fragment, el.customData, build));
  }

  /** Everything the timeline shows, read from the scene so it always reflects the user's edits. */
  const timelineCards = useMemo<TimelineCard[]>(() => {
    if (!api || view !== 'timeline') return [];
    const files = api.getFiles() as Record<string, { dataURL?: string }>;
    return scene().flatMap((e): TimelineCard[] => {
      if (e.isDeleted) return [];
      if (e.type === 'rectangle' && e.customData?.kind === 'fragment') return [{ id: e.id, kind: 'fragment', fragment: e.customData.fragment, cluster: e.customData.cluster }];
      if (e.type === 'rectangle' && e.customData?.kind === 'image-card') return [{ id: e.id, kind: 'image', caption: e.customData.caption, imageUrl: files[e.customData.fileId]?.dataURL }];
      return [];
    });
  }, [api, view, sceneTick, editing]);

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

  const sceneAt = (clientX: number, clientY: number) => viewportCoordsToSceneCoords({ clientX, clientY }, api!.getAppState());
  const hitAt = (clientX: number, clientY: number) => {
    const { x, y } = sceneAt(clientX, clientY);
    return hitTest(api!.getSceneElements() as unknown as El[], x, y, api!.getAppState().zoom.value);
  };

  if (import.meta.env.DEV && api) (window as unknown as { __hit?: unknown }).__hit = (cx: number, cy: number) => hitAt(cx, cy); // dev only: lets test scripts probe hit-testing

  function onPointerDownCapture(e: React.PointerEvent) {
    navigated.current = true;
    camera.release();
    if (!touched) setTouched(true);
    if (!api) return;
    if (sticking) {
      e.stopPropagation();
      e.preventDefault();
      const hit = hitAt(e.clientX, e.clientY);
      finishSticking(hit && hit.kind !== 'edge' ? hit.id : null);
      return;
    }
    if (connectFrom) {
      e.stopPropagation();
      e.preventDefault();
      const hit = hitAt(e.clientX, e.clientY);
      const from = connectFrom;
      setConnectFrom(null);
      if (hit?.kind === 'fragment' && hit.id !== from) setConnecting({ a: from, b: hit.id, busy: false });
      else if (hit) say('info', 'Links join two cards.');
      return;
    }

    // The link / branch / cut gesture: right-button drag, or the left button with L (link, branch) or K (knife) held.
    const keyed = heldRef.current && e.button === 0;
    if (!(e.button === 2 || keyed) || view === 'timeline') return;
    const hit = hitAt(e.clientX, e.clientY);
    const mode = modeFor(hit?.kind ?? null, keyed ? heldRef.current : null);
    if (!mode) return;
    e.stopPropagation();
    e.preventDefault();
    gesture.current = { mode, startId: hit && hit.kind !== 'edge' ? hit.id : null, startKind: hit?.kind ?? null, sx: e.clientX, sy: e.clientY, moved: false, rmb: e.button === 2 };
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', onGestureUp, { once: true });
  }

  const local = (clientX: number, clientY: number) => { const r = innerRef.current?.getBoundingClientRect(); return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) }; };

  function onGestureMove(e: PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_PX) return;
    g.moved = true;
    const a = local(g.sx, g.sy), b = local(e.clientX, e.clientY);
    setTrail({ mode: g.mode, ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }

  function onGestureUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onGestureMove);
    const g = gesture.current;
    gesture.current = null;
    setTrail(null);
    if (!g || !api) return;
    if (!g.moved) { if (g.rmb) openContextMenu(e.clientX, e.clientY); return; }
    if (g.mode === 'cut') {
      const a = sceneAt(g.sx, g.sy), b = sceneAt(e.clientX, e.clientY);
      const cuts = cutTargets(scene(), a, b);
      if (cuts.length) cutConnections(cuts); else say('info', 'Nothing there to cut. Drag across a line.');
      return;
    }
    const end = hitAt(e.clientX, e.clientY);
    const start = g.startId ? byId(g.startId) : null;
    if (!start) return;
    if (end && end.kind !== 'edge') {
      if (end.id === g.startId) return;
      if (end.kind === 'fragment' && g.startKind === 'fragment') setConnecting({ a: g.startId!, b: end.id, busy: false });
      else say('info', 'Links join two cards. Drop into empty space to branch instead.');
      return;
    }
    if (end) return; // dropped on a line: nothing to do
    branchMenuAt(g.startId!, g.startKind === 'fragment', e.clientX, e.clientY);
  }

  /** The menu a gesture opens when a card is dragged into empty space. */
  function branchMenuAt(startId: string, isCard: boolean, clientX: number, clientY: number) {
    const at = sceneAt(clientX, clientY);
    setMenu({
      x: clientX, y: clientY, title: 'Branch from here',
      items: [
        { id: 'card', label: 'New card here', icon: <IconBranch />, run: () => addBranch(startId, at) },
        { id: 'pivot', label: 'Explore a different angle here', icon: <IconExplore />, disabled: !isCard || !!pivot, run: () => startPivot(startId, { at }) },
      ],
    });
  }

  /** Right-click without dragging: what can be done with what is under the pointer. */
  function openContextMenu(clientX: number, clientY: number) {
    const hit = hitAt(clientX, clientY);
    const at = sceneAt(clientX, clientY);
    if (hit?.kind === 'fragment') { api!.updateScene({ appState: selectionFor(hit.id) as any }); setMenu({ x: clientX, y: clientY, title: nameOf(byId(hit.id)!), items: cardItems(hit.id, { x: clientX, y: clientY }) }); return; }
    if (hit?.kind === 'edge') { const arrow = byId(hit.id); api!.updateScene({ appState: { selectedElementIds: { [hit.id]: true } } as any }); setMenu({ x: clientX, y: clientY, title: 'Connection', items: connectionItems(hit.id, !!arrow && /^origin-\d+$/.test(arrow.id)) }); return; }
    if (hit) return; // headers, pictures: their own editors
    setMenu({ x: clientX, y: clientY, items: [
      { id: 'add', label: 'New card here', icon: <IconPlus />, run: () => newFragment({ x: at.x - 140, y: at.y - 60 }) },
      { id: 'image', label: 'Add image…', icon: <IconPlus />, run: () => fileInput.current?.click() },
      { id: 'fit', label: 'Zoom to fit', run: () => zoom('fit') },
    ] });
  }

  const cardItems = (id: string, at: { x: number; y: number }): PopItem[] => [
    { id: 'explore', label: 'Explore a different angle', icon: <IconExplore />, disabled: !!pivot, run: () => startPivot(id) },
    { id: 'branch', label: 'Add a branch', icon: <IconBranch />, run: () => addBranch(id) },
    { id: 'connect', label: 'Connect to another card…', icon: <IconLink />, run: () => { setConnectFrom(id); } },
    { id: 'lenses', label: 'Look at it another way…', icon: <IconLens />, sepBefore: true, run: () => lensMenuAt(id, at.x, at.y) },
    { id: 'edit', label: 'Edit', icon: <IconEdit />, run: () => openEditor({ id, kind: 'fragment' }) },
    { id: 'delete', label: 'Delete', danger: true, run: () => remove(id) },
  ];

  const connectionItems = (arrowId: string, isOrigin: boolean): PopItem[] => [
    { id: 'explore', label: 'Explore a new angle from here', icon: <IconExplore />, disabled: !!pivot, run: () => pivotFromConnection(arrowId) },
    { id: 'branch', label: 'Add a branch from here', icon: <IconBranch />, run: () => branchFromConnection(arrowId) },
    { id: 'edit', label: 'Edit the label…', icon: <IconEdit />, sepBefore: true, run: () => openEditor({ id: arrowId, kind: 'edge' }) },
    { id: 'cut', label: isOrigin ? 'Cut (not for the line from the question)' : 'Cut this connection', icon: <IconCut />, danger: true, disabled: isOrigin, run: () => cutConnections([{ id: arrowId, kind: arrowKind(arrowId) }]) },
  ];
  const arrowKind = (id: string): 'tether' | 'link' => (byId(id)?.customData?.kind === 'tether' ? 'tether' : 'link');

  function lensMenuAt(id: string, x: number, y: number) {
    setMenu({ x, y, title: 'Look at it another way', items: LENS_CHOICES.map(l => ({ id: l.id, label: l.label, detail: l.kind === 'argument' ? '✦ AI' : undefined, disabled: !!lensing, run: () => void startLens(id, l.id) })) });
  }

  // Which key is held decides what a left-button drag does (L: link/branch, K: cut). Excalidraw's own letter shortcuts
  // for those keys are kept out of the way while the canvas has focus.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target) || viewRef.current === 'timeline') return;
      const k = e.key.toLowerCase();
      if (k !== 'l' && k !== 'k') return;
      e.stopPropagation();
      e.preventDefault();
      heldRef.current = k; setHeld(k);
    };
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === heldRef.current) { heldRef.current = null; setHeld(null); } };
    const clear = () => { heldRef.current = null; setHeld(null); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', clear); };
  }, []);

  useEffect(() => {
    if (!connectFrom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConnectFrom(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectFrom]);

  // What the bar over a selected card or connection can do (read at click time, so it is never stale).
  const barActions = useRef<BarActions>(null as unknown as BarActions);
  barActions.current = {
    busy: !!pivot,
    explore: id => startPivot(id),
    branch: id => addBranch(id),
    connect: id => setConnectFrom(id),
    lenses: (id, at) => lensMenuAt(id, at.x, at.y),
    more: (id, at) => setMenu({ x: at.x, y: at.y, title: nameOf(byId(id) ?? ({} as El)), items: cardItems(id, at).filter(i => i.id === 'edit' || i.id === 'delete') }),
    exploreFrom: id => pivotFromConnection(id),
    branchFrom: id => branchFromConnection(id),
    editLink: id => openEditor({ id, kind: 'edge' }),
    cut: id => { if (/^origin-\d+$/.test(id)) say('info', 'The line from your question stays: it is what keeps this collection part of the web.'); else cutConnections([{ id, kind: arrowKind(id) }]); },
  };

  useEffect(() => {
    if (!sticking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSticking(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sticking]);

  // ── Pivot: grow a new collection out of a card ────────────────────────────

  /** `from` is the element the new collection grows out of; `seed` what it is seeded with (the card itself unless given); `at` where its header goes (default: on past `from`). */
  function startPivot(cardId: string, opts: { seed?: GeneratedFragment; at?: { x: number; y: number } } = {}) {
    const el = byId(cardId);
    const seed = opts.seed ?? el?.customData?.fragment;
    if (!api || !el || !seed || pivot) return;
    setEditing(null);
    setPivot({ status: 'Searching your KB…' });
    pivotAt.current = opts.at;
    const prefix = `pv-${crypto.randomUUID().slice(0, 8)}`;
    cancelPivot.current = window.webs.pivot({ card: seed, usedPassageIds: usedPassageIds(scene()), query: model.query }, ev => onPivotEvent(prefix, cardId, ev));
  }

  /** A new card growing out of `sourceId` (or placed at `at`), tied to it by a tether, opened for writing. */
  function addBranch(sourceId: string, at?: { x: number; y: number }) {
    const src = byId(sourceId);
    if (!api || !src) return;
    const fragment: GeneratedFragment = { type: 'concept', title: 'new branch', body: 'Say what this branch is about.', tags: [] };
    const size = cardSize(fragment);
    const spot = at ? { x: at.x - size.width / 2, y: at.y - size.height / 2 } : branchSpot(scene(), sourceId, size.width, size.height);
    if (!spot) return;
    const id = newFragment(spot, undefined, fragment, false);
    apply(addTether(scene(), sourceId, id, makeArrow, 760));
    sound.play('branch');
    api.updateScene({ appState: selectionFor(id) as any });
    setEditing({ kind: 'fragment', id, fragment });
    reveal({ x: spot.x, y: spot.y, width: size.width, height: size.height });
  }

  /** Pivot from a connection: the new angle grows on past its target, seeded with what the line says. */
  function pivotFromConnection(arrowId: string, at?: { x: number; y: number }) {
    const seed = connectionSeed(scene(), arrowId, model.query, model.context ?? '');
    if (!seed) { say('error', 'That connection is missing one of its ends.'); return; }
    startPivot(seed.target.id, { seed: seed.card, at });
  }

  /** Branch from a connection: a new card past its target. */
  function branchFromConnection(arrowId: string, at?: { x: number; y: number }) {
    const seed = connectionSeed(scene(), arrowId, model.query, model.context ?? '');
    if (!seed) { say('error', 'That connection is missing one of its ends.'); return; }
    addBranch(seed.target.id, at);
  }

  /** Remove connections: tethers are unstuck, other lines deleted. The line from the origin to a collection is never cut. */
  function cutConnections(cuts: Array<{ id: string; kind: 'tether' | 'link' }>) {
    if (!cuts.length) return;
    let next = scene();
    for (const c of cuts) {
      const el = next.find(e => e.id === c.id);
      if (!el) continue;
      next = c.kind === 'tether' ? removeTether(next, el.endBinding?.elementId) : removeBox(next, c.id);
    }
    apply(next);
    sound.play('cut');
    say('info', cuts.length === 1 ? 'Cut 1 connection.' : `Cut ${cuts.length} connections.`);
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
        const pos = placePivot(scene(), cardId, ev.cards.length, pivotAt.current);
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
      case 'done': {
        setPivot(null); cancelPivot.current = null;
        const fresh = new Set(scene().filter(e => !e.isDeleted && e.id.startsWith(`${prefix}-c`) && e.customData?.kind === 'fragment').map(e => e.id));
        if (fresh.size) addDerivedMedia(fresh); // companions for the new cards
        break;
      }
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
    const id = `m-${crypto.randomUUID().slice(0, 8)}`;
    apply(addCard(scene(), {
      id, x: at.x, y: at.y, fragment,
      customData: { kind: 'fragment', ...(cluster !== undefined ? { cluster } : {}), fragment },
    }, build));
    if (open) {
      api!.updateScene({ appState: selectionFor(id) as any });
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

  const refreshCompanion = () => window.webs.getCompanionInbox().then(setCompanionItems).catch(() => {});
  useEffect(() => {
    void refreshCompanion();
    const t = setInterval(() => { void refreshCompanion(); }, 4000);
    const onFocus = () => { void refreshCompanion(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);

  async function addCompanion(item: CompanionItem) {
    if (!api) return;
    newFragment(freeSpotInView(), undefined, fragmentFromCompanion(item), false);
    setCompanionItems(l => l.filter(x => x.id !== item.id));
    await window.webs.markCompanion(item.id, 'filed');
  }

  async function dismissCompanion(item: CompanionItem) {
    setCompanionItems(l => l.filter(x => x.id !== item.id));
    await window.webs.markCompanion(item.id, 'dismissed');
  }

  async function addCapture(item: InboxItem) {
    if (!api) return;
    const id = newFragment(freeSpotInView(), undefined, fragmentFromCapture(item), false);
    setInbox(i => ({ ...i, items: i.items.filter(x => x.id !== item.id) }));
    const r = await window.webs.fileCapture(item.id, id);
    if (!r.ok) setInbox(i => ({ ...i, error: `Placed on the canvas, but couldn't mark it filed (${r.message}). It may reappear here.` }));
  }

  async function addAllCaptures() {
    for (const item of [...inbox.items]) await addCapture(item);
    for (const item of [...companionItems]) await addCompanion(item);
  }

  async function dismissCapture(item: InboxItem) {
    setInbox(i => ({ ...i, items: i.items.filter(x => x.id !== item.id) }));
    const r = await window.webs.dismissCapture(item.id);
    if (!r.ok) setInbox(i => ({ ...i, error: `Couldn't dismiss it (${r.message}).` }));
  }

  function zoom(how: 'in' | 'out' | 'fit') {
    if (!api) return;
    const v = camera.view();
    if (!v) return;
    if (how === 'fit') {
      const live = (api.getSceneElements() as unknown as El[]).filter(e => !e.isDeleted && e.type !== 'text');
      if (!live.length) return;
      const x0 = Math.min(...live.map(e => e.x)), y0 = Math.min(...live.map(e => e.y));
      camera.glideTo(fitTarget(v, { x: x0, y: y0, width: Math.max(...live.map(e => e.x + e.width)) - x0, height: Math.max(...live.map(e => e.y + e.height)) - y0 }));
    } else camera.glideTo(zoomBy(v, how === 'in' ? 1.25 : 0.8));
  }

  /** Bring a card into view: select and centre it on the map, or open it from the timeline. */
  function focusCard(id: string) {
    const el = byId(id);
    if (!api || !el) return;
    if (viewRef.current === 'timeline') { openEditor({ id, kind: 'fragment' }); return; }
    api.updateScene({ appState: selectionFor(id) as any });
    const v = camera.view();
    if (v) camera.glideTo(viewFor(el.x + el.width / 2, el.y + el.height / 2, v.zoom, v.width, v.height));
  }

  /** The two cards the user has selected, if exactly two: the ends of a link they might draw. */
  const selectedPair = (): [El, El] | null => {
    if (!api) return null;
    const ids = Object.keys(api.getAppState().selectedElementIds);
    const cards = ids.map(id => byId(id)).filter((e): e is El => !!e && e.type === 'rectangle' && e.customData?.kind === 'fragment');
    return cards.length === 2 ? [cards[0], cards[1]] : null;
  };

  /** Draw the arrow the user asked for, then ask the model what it makes of the link. Their arrow stays whatever it says. */
  async function connect(explanation: string) {
    if (!connecting) return;
    const a = byId(connecting.a), b = byId(connecting.b);
    if (!a || !b) { setConnecting(null); say('error', 'One of the cards is gone.'); return; }
    setConnecting({ ...connecting, busy: true });
    const said = explanation.trim();
    try {
      const res = await window.webs.connect({ a: a.customData.fragment, b: b.customData.fragment, ...(said ? { explanation: said } : {}) });
      if (!res.ok) { say('error', res.message); return; }
      const v = res.verdict;
      if (!said && v.link === 'none') { say('info', v.note || 'The model sees no real link between these two.'); setConnecting(null); return; }
      const { elements, id } = addLink(scene(), { from: a.id, to: b.id, verdict: v, by: said ? 'user' : 'model', ...(said ? { explanation: said } : {}) }, build, makeArrow);
      apply(elements);
      sound.play('link');
      setConnecting(null);
      setEditing({ kind: 'edge', id, label: v.verb, link: { by: said ? 'user' : 'model', tier: v.tier, link: v.link, note: v.note, ...(said ? { explanation: said } : {}) } });
    } finally { setConnecting(c => (c ? { ...c, busy: false } : c)); }
  }

  /** Look at a card another way: the result is a new card beside it, tethered to it; the original is untouched. */
  async function startLens(cardId: string, lens: LensId) {
    const el = byId(cardId), label = LENS_CHOICES.find(l => l.id === lens)?.label ?? lens;
    if (!api || !el || lensing) return;
    setLensing(label);
    try {
      const res = await window.webs.lens({ card: el.customData.fragment, lens });
      const source = byId(cardId);
      if (!res.ok) { say('error', res.message); return; }
      if (!source) { say('error', 'The card this was made from is gone.'); return; }
      const f = res.fragment, id = `lens-${crypto.randomUUID().slice(0, 8)}`;
      const size = cardSize(f);
      const x = source.x + source.width / 2 >= 0 ? source.x + source.width + 56 : source.x - size.width - 56;
      const at = findFreeSpot(scene(), { x, y: source.y }, size.width, size.height);
      const added = addCard(scene(), { id, x: at.x, y: at.y, fragment: f, customData: { kind: 'fragment', fragment: f } }, build);
      apply(addTether(added, cardId, id, makeArrow, 640));
      api.updateScene({ appState: selectionFor(id) as any });
      reveal({ x: at.x, y: at.y, width: size.width, height: size.height });
    } finally { setLensing(null); }
  }

  /**
   * Pictures fetched for a library card: saved with the web, placed beside their card on the side away from the middle,
   * and tethered to it. Besides the lead picture there can be a couple more from the article and a map of the place
   * (drawn onto the canvas's dark look, the place marked, the credit on it).
   */
  const pictureQueue = useRef<Promise<void>>(Promise.resolve());
  const PICTURE_COL = (card: El) => (card.x + card.width / 2 >= 0 ? card.x + card.width + 28 : card.x - 28);

  /** Put an image (already a data URL) on the canvas as a card tethered to `parent`, in free space on its outward side. */
  async function placeImageCard(parent: El, id: string, img: { dataURL: string; mimeType: string; width: number; height: number; caption: string; link?: string }, maxSide: number) {
    const blob = dataUrlToBlob(img.dataURL);
    const fileId = await contentId(blob);
    api!.addFiles([{ id: fileId as BinaryFileData['id'], mimeType: img.mimeType as BinaryFileData['mimeType'], dataURL: img.dataURL as BinaryFileData['dataURL'], created: Date.now() }]);
    const lay = imageCardLayout(img.width, img.height, maxSide);
    const right = parent.x + parent.width / 2 >= 0;
    const at = findFreeSpot(scene(), { x: right ? PICTURE_COL(parent) : PICTURE_COL(parent) - lay.width, y: parent.y }, lay.width, lay.height);
    const placed = addImageCard(scene(), { id, x: at.x, y: at.y, maxSide, data: { fileId, caption: img.caption, name: img.caption, width: img.width, height: img.height, link: img.link } }, build, makeImage);
    apply(addTether(placed.elements, parent.id, id, makeArrow, 640));
  }

  function placePicture(ev: Extract<WebEvent, { type: 'image' }>) {
    pictureQueue.current = pictureQueue.current.then(async () => {
      if (!api) return;
      const n = ev.image.n ?? 0;
      const card = byId(`frag-${ev.cluster}-${ev.slot}`), id = n === 0 ? `wimg-${ev.cluster}-${ev.slot}` : `wimg-${ev.cluster}-${ev.slot}-${n}`;
      if (!card || byId(id)) return; // the card was set aside or deleted, or already has this picture
      let image = ev.image;
      if (image.kind === 'map' && image.marker) image = { ...image, ...(await drawMap(image.dataURL, image.marker)) };
      const caption = image.credit ? `${image.caption} · ${image.credit}` : image.caption;
      await placeImageCard(card, id, { ...image, caption }, n === 0 ? PICTURE_SIDE : image.kind === 'map' ? 240 : 260);
    }).catch(err => { console.warn('Could not place a picture:', err); /* it is simply absent */ });
  }

  /** A clip from the card's article, as a card that opens it on Commons. */
  function placeClip(ev: Extract<WebEvent, { type: 'media-link' }>) {
    pictureQueue.current = pictureQueue.current.then(() => {
      if (!api) return;
      const parent = byId(`frag-${ev.cluster}-${ev.slot}`), id = `dclip-${ev.cluster}-${ev.slot}`;
      if (!parent || byId(id)) return;
      const fragment = clipCard(ev.link);
      const size = cardSize(fragment);
      const at = findFreeSpot(scene(), { x: parent.x + parent.width / 2 >= 0 ? PICTURE_COL(parent) : PICTURE_COL(parent) - size.width, y: parent.y }, size.width, size.height);
      apply(addTether(addCard(scene(), { id, x: at.x, y: at.y, fragment, customData: { kind: 'fragment', fragment } }, build), parent.id, id, makeArrow, 640));
    }).catch(err => console.warn('Could not place a clip:', err));
  }

  /**
   * Companions for source-based cards, lifted from their own text: a figures card or a timeline picture, and a quotation
   * set large. Within a budget, heaviest cards first, once per card (see derived.ts).
   */
  const derivedDone = useRef(new Set<string>());
  function addDerivedMedia(onlyIds?: ReadonlySet<string>) {
    pictureQueue.current = pictureQueue.current.then(async () => {
      if (!api) return;
      const live = scene().filter(e => !e.isDeleted);
      let infographics = live.filter(e => /^dmedia-.*-(facts|timeline)$/.test(e.id)).length, quotes = live.filter(e => /^dquote-/.test(e.id)).length;
      const cards = live.filter(e => e.type === 'rectangle' && e.customData?.kind === 'fragment' && (!onlyIds || onlyIds.has(e.id)) && !derivedDone.current.has(e.id))
        .sort((a, b) => (b.customData.fragment?.weight ?? 2) - (a.customData.fragment?.weight ?? 2));
      for (const card of cards) {
        derivedDone.current.add(card.id);
        const f: GeneratedFragment = card.customData.fragment;
        for (const d of planDerived(f)) {
          if (d.kind === 'quote') {
            const id = `dquote-${card.id}`;
            if (quotes >= BUDGET.quotes || byId(id)) continue;
            quotes++;
            const qf = quoteCard(f, d.quote), size = cardSize(qf);
            const at = findFreeSpot(scene(), { x: card.x + card.width / 2 >= 0 ? PICTURE_COL(card) : PICTURE_COL(card) - size.width, y: card.y }, size.width, size.height);
            apply(addTether(addCard(scene(), { id, x: at.x, y: at.y, fragment: qf, customData: { kind: 'fragment', fragment: qf } }, build), card.id, id, makeArrow, 640));
            continue;
          }
          const id = `dmedia-${card.id}-${d.kind}`;
          if (infographics >= BUDGET.infographics || byId(id)) continue;
          infographics++;
          const img = d.kind === 'facts' ? await drawFacts(d.facts) : await drawTimeline(d.entries);
          const label = d.kind === 'facts' ? 'Key figures' : 'Timeline';
          await placeImageCard(card, id, { ...img, caption: `${label}: ${f.title}`, link: f.link }, d.kind === 'facts' ? 330 : 460);
        }
      }
    }).catch(err => console.warn('Could not add companions:', err));
  }
  // a freshly written web gets its companions once it is complete (reopening a saved one never adds any)
  useEffect(() => {
    if (api && !restored && model.phase === 'done') addDerivedMedia();
  }, [api, restored, model.phase]);

  const placeRef = useRef<(ev: Extract<WebEvent, { type: 'image' | 'media-link' }>) => void>(() => undefined);
  placeRef.current = ev => (ev.type === 'image' ? placePicture(ev) : placeClip(ev));
  useEffect(() => {
    registerImageSink?.(ev => placeRef.current(ev));
    return () => registerImageSink?.(null);
  }, []);

  // The command palette asks for these when it opens, so they always reflect the current scene and selection.
  const buildCommands = (): Command[] => {
    const selected = api ? Object.keys(api.getAppState().selectedElementIds).map(id => byId(id)).find(e => e?.customData?.kind === 'fragment') : undefined;
    const cmds: Command[] = [
      { id: 'add-fragment', group: 'Actions', label: 'Add fragment', keywords: 'new card', run: addFreeFragment },
      { id: 'add-image', group: 'Actions', label: 'Add image', keywords: 'picture photo', run: () => fileInput.current?.click() },
      { id: 'zoom-fit', group: 'Actions', label: 'Zoom to fit', hint: '⇧1', keywords: 'view', run: () => zoom('fit') },
      ...(selected ? [{ id: 'branch', group: 'Actions', label: 'Add a branch from this card', detail: selected.customData.fragment?.title, keywords: 'new card child grow', run: () => addBranch(selected.id) }] : []),
      { id: 'gestures', group: 'Actions', label: 'Link, branch and cut: how', detail: 'right-drag, or hold L / K and drag', keywords: 'gesture wrangler connect cut knife', run: () => say('info', 'Drag from a card to another card to link them, or into empty space to branch. Drag across lines in empty space to cut them. Use the right mouse button, or hold L (link, branch) or K (cut) and drag.') },
      ...(selected && !pivot ? [{ id: 'explore', group: 'Actions', label: 'Explore a different angle', detail: selected.customData.fragment?.title, run: () => startPivot(selected.id) }] : []),
      ...(connecting ? [] : (pair => (pair && !hasLink(scene(), pair[0].id, pair[1].id) ? [{ id: 'connect', group: 'Actions', label: 'Connect these two cards…', detail: `${pair[0].customData.fragment.title} → ${pair[1].customData.fragment.title}`, keywords: 'link relate arrow', run: () => setConnecting({ a: pair[0].id, b: pair[1].id, busy: false }) }] : []))(selectedPair())),
      ...(selected && !lensing ? LENS_CHOICES.map(l => ({ id: `lens-${l.id}`, group: 'Look at this card', label: l.label, detail: l.kind === 'argument' ? '✦ AI · not from your notes' : l.description, keywords: `${l.description} ${selected.customData.fragment?.title ?? ''}`, run: () => startLens(selected.id, l.id) })) : []),
    ];
    for (const e of scene()) {
      if (e.isDeleted || e.type !== 'rectangle' || e.customData?.kind !== 'fragment') continue;
      const f = e.customData.fragment;
      cmds.push({ id: `card-${e.id}`, group: 'Cards', label: f.title, detail: f.type, keywords: f.body, run: () => focusCard(e.id) });
    }
    return cmds;
  };
  const buildRef = useRef(buildCommands);
  buildRef.current = buildCommands;
  useEffect(() => {
    registerCommands?.(() => buildRef.current());
    return () => registerCommands?.(null);
  }, []);

  return (
    <div className="canvas">
      {view === 'timeline' && <TimelineView topic={model.query} cards={timelineCards} onOpen={(id, kind) => openEditor({ id, kind })} />}
      <div ref={innerRef} className={`canvas-inner${sticking || connectFrom ? " sticking" : ""}`} onContextMenuCapture={e => { e.preventDefault(); e.stopPropagation(); }} style={view === 'timeline' ? { visibility: 'hidden', pointerEvents: 'none' } : undefined} onPointerDownCapture={onPointerDownCapture} onWheelCapture={() => { navigated.current = true; camera.release(); }} onDoubleClickCapture={onDoubleClickCapture} onDragOverCapture={onDragOverCapture} onDropCapture={onDropCapture}>
        <BackdropOverlay api={api} hidden={view === 'timeline'} />
        <Excalidraw
          excalidrawAPI={a => { setApi(a); if (import.meta.env.DEV) (window as unknown as { __api?: unknown }).__api = a; /* dev only: lets test scripts drive the canvas */ }}
          onChange={handleChange as any}
          UIOptions={{ tools: { image: false } }}
          initialData={{
            files: Object.fromEntries((restoredFiles ?? []).map(f => [f.id, f])) as any,
            elements: restored ? (restoredScene as any) : undefined,
            appState: { viewBackgroundColor: 'transparent' }, // the backdrop behind it paints the surface (see BackdropOverlay)
          }}
        />
        <FlowOverlay api={api} hidden={view === 'timeline'} />
        <FxOverlay api={api} phase={model.phase} hidden={view === 'timeline'} />
        <LodOverlay api={api} hidden={view === 'timeline'} />
        <SelectionBar api={api} actions={barActions} hidden={view === 'timeline' || !!menu || !!trail} />
        {trail && (
          <svg className="gesture" aria-hidden>
            {trail.mode === 'link'
              ? <><line x1={trail.ax} y1={trail.ay} x2={trail.bx} y2={trail.by} stroke="#F2F2F2" strokeWidth="1.5" strokeDasharray="5 5" strokeLinecap="round" /><circle cx={trail.bx} cy={trail.by} r="4" fill="#F2F2F2" /></>
              : <line x1={trail.ax} y1={trail.ay} x2={trail.bx} y2={trail.by} stroke="#E5846F" strokeWidth="2" strokeLinecap="round" />}
          </svg>
        )}
        {held && !trail && <div className="gesture-hint">{held === 'l' ? 'Drag from a card to another card to link them, or into empty space to branch.' : 'Drag across lines to cut them.'}</div>}
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void importImages(f); }} />
      <BottomToolbar
        disabled={!api || view === 'timeline'}
        onFragment={addFreeFragment}
        onImage={() => fileInput.current?.click()}
        inbox={captureUrl || companionItems.length ? { count: inbox.items.length + companionItems.length, open: inboxOpen, onToggle: () => { setInboxOpen(o => !o); if (captureUrl) void refreshInbox(); void refreshCompanion(); } } : undefined}
        chips={[
          ...(sticking ? [{ text: 'Click the card or label it should stay near', action: { label: 'Cancel', run: () => setSticking(null) } }] : []),
          ...(connectFrom ? [{ text: 'Click the card to connect it to', action: { label: 'Cancel', run: () => setConnectFrom(null) } }] : []),
          ...(lensing ? [{ text: `${lensing}…` }] : []),
          ...(pivot ? [{ text: `Exploring · ${pivot.status}`, action: { label: 'Stop', run: stopPivot } }] : []),
        ]}
        legend={(() => {
          const has = (o: 'ai' | 'wiki') => model.clusters.some(c => c.origin === o || c.slots.some(f => f?.origin === o));
          const parts = [!model.clusters.every(c => c.origin) && '▤ your notes', has('wiki') && 'W Wikipedia', has('ai') && '✦ AI'].filter(Boolean);
          return parts.length > 1 || has('ai') || has('wiki') ? parts.join(' · ') : null;
        })()}
        onZoom={zoom}
      />

      {menu && <PopMenu x={menu.x} y={menu.y} title={menu.title} items={menu.items} onClose={() => setMenu(null)} />}

      {inboxOpen && (
        <InboxPanel
          items={inbox.items} unsupported={inbox.unsupported} error={inbox.error} busy={inbox.busy} serviceUrl={captureUrl}
          companion={companionItems} onAddCompanion={addCompanion} onDismissCompanion={dismissCompanion}
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
      {connecting && byId(connecting.a) && byId(connecting.b) && (
        <ConnectPanel a={byId(connecting.a)!.customData.fragment.title} b={byId(connecting.b)!.customData.fragment.title} busy={connecting.busy} onConnect={t => void connect(t)} onClose={() => setConnecting(null)} />
      )}
      {editing?.kind === 'edge' && (
        <EdgeEditor key={editing.id} label={editing.label} link={editing.link} onChange={l => editEdge(editing.id, l)} onDelete={() => remove(editing.id)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
