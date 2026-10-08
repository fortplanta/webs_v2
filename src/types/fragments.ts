// All core types for Webs. Single source of truth for data shapes.

export type SlotType = "body" | "image" | "tags" | "list" | "disclaimer";

export interface SlotVersion {
  content?: string;
  items?: string[];
  promptId?: string;
  producedAt: number;
}

export type FragmentType =
  | "person"
  | "concept"
  | "thesis"
  | "source"
  | "event"
  | "era"
  | "domain"
  | "quote"
  | "spark"
  | "text-note";

export type LayoutType =
  | "vertical-flow"
  | "image-hero"
  | "quote-centered"
  | "card-split"
  | "timeline"
  | "list-prominent"
  | "text-note";

export type ConnectorType = "standard" | "strong";
export type ConnectorRenderType = "bezier" | "straight" | "step" | "smoothstep";

export interface FragmentSlot {
  type: SlotType;
  content?: string;
  items?: string[];
  history?: SlotVersion[];
  historyIndex?: number;
}

export interface FragmentSource {
  url: string;
  domain: string;
  faviconUrl: string;
  label: string;
}

export interface AccordionSlot {
  id: string;
  promptId: string;
  promptLabel: string;
  content: string;
  createdAt: number;
}

export interface Fragment {
  id: string;
  clusterId: string;       // logical parent — never changes
  x: number;              // own canvas-space position (center)
  y: number;
  initialX?: number;       // spawn position — set once, never updated
  initialY?: number;
  type: FragmentType;
  layout: LayoutType;
  title: string;
  slots: FragmentSlot[];
  createdAtZoom: number;
  starred: boolean;
  pinned?: boolean;
  anchored?: boolean;      // locks position relative to cluster spawn
  anchorOffsetX?: number;
  anchorOffsetY?: number;
  width?: number;           // only set if user explicitly resized
  note?: string;            // personal annotation, separate from AI body
  sources?: FragmentSource[];
  accordions?: AccordionSlot[];
  sparkMediaUrl?: string;  // data URL for spark image
  sparkMediaType?: 'image' | 'text';
  sparkStatus?: 'idle' | 'processing' | 'done';
  emptySlots?: SlotType[];
  historicalEra?: string;  // e.g. "1066", "1839–1860", "300 BCE", "1960s"
  groupId?: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface Cluster {
  id: string;
  x: number;              // canvas-space position (center)
  y: number;
  initialX?: number;       // spawn position — set once, never updated
  initialY?: number;
  label: string;
  isSeed: boolean;
  note?: string;
  collapsed?: boolean;
}

export interface Connector {
  id: string;
  sourceId: string;       // fragment id or cluster id
  targetId: string;       // fragment id or cluster id
  type: ConnectorType;
  renderType?: ConnectorRenderType; // default "bezier"
  label: string;          // editable verb phrase, empty by default
}

export type CanvasObjectType = 'text' | 'image' | 'video' | 'pdf' | 'document' | 'group';

export interface CanvasObjectProvenance {
  source?: 'upload' | 'paste' | 'broker' | 'generated' | 'manual';
  quality?: 'editable' | 'lossy' | 'reference' | 'unsupported';
  brokerHandoffId?: string;
  transferRecordId?: string;
  filedToEagle?: boolean;
}

export interface CanvasObject {
  id: string;
  type: CanvasObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  text?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  dataUrl?: string;
  thumbnailUrl?: string;
  assetRef?: string;
  provenance?: CanvasObjectProvenance;
  groupId?: string;
  childIds?: string[];
  childFragmentIds?: string[];
  createdAt: number;
  locked?: boolean;
  hidden?: boolean;
}

export interface CaptureCanvasNode {
  id: string;
  x: number;
  y: number;
  captureId: string;
  createdAt: number;
  locked?: boolean;
  hidden?: boolean;
}

export interface CanvasState {
  clusters: Cluster[];
  fragments: Fragment[];
  connectors: Connector[];
  objects?: CanvasObject[];
  captures?: CaptureCanvasNode[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  query: string;
  createdAt: number;
  scratchpad?: string;
  progressState?: ProgressState;
}

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  state: CanvasState;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  fragmentCount?: number;
  clusterCount?: number;
}

export type CreativeApp = 'figma' | 'cavalry' | 'blender' | 'eagle' | 'local' | 'webs';

export type ProjectStatus = 'exploring' | 'active' | 'blocked' | 'handoff' | 'archived';

export interface ProjectSourceLink {
  id: string;
  app: CreativeApp;
  label: string;
  url: string;
  createdAt: number;
}

export interface ProjectTransferRecord {
  id: string;
  sourceApp: CreativeApp;
  destinationApp: CreativeApp;
  sourceObject: string;
  format: string;
  editability: 'editable' | 'rendered' | 'reference' | 'filed';
  assetRef?: string;
  eagleRef?: string;
  notes?: string;
  provenance?: {
    capabilityId?: string;
    brokerHandoffId?: string;
    quality: 'editable' | 'lossy' | 'reference' | 'unsupported';
    filedToEagle?: boolean;
  };
  createdAt: number;
}

export interface ProjectBrain {
  projectId: string;
  status: ProjectStatus;
  notes: string;
  sourceLinks: ProjectSourceLink[];
  transferHistory: ProjectTransferRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface Project extends ProjectMeta {
  canvasState: CanvasState;
  thumbnail?: string;
  brain?: ProjectBrain;
}

export interface TabSession {
  id: string;
  name: string;
  isLoaded: boolean;
  isActive: boolean;
}

export interface AppState {
  tabs: TabSession[];
  activeTabId: string;
}

// Pivot API response shape — returned by the pivot endpoint.
export interface PivotApiResponse {
  clusterTitle: string;
  fragments: Array<{
    type: FragmentType;
    title: string;
    body: string;
    tags?: string[];
    list?: string[];
    era?: string;
  }>;
  edgeLabel: string;
}

// Raw API response shape before client-side processing.
// Uses flat fields — client converts to FragmentSlot[] via buildSlots().
export type ConnectionTier = "obvious" | "non-obvious-user" | "non-obvious-claude";

export interface ConnectionScore {
  tier: ConnectionTier;
  points: number;
  explanation: string;
  context?: string;
  isValid: boolean;
}

export interface ProgressState {
  current: number;        // 0–1000
  threshold: number;      // always 1000
  totalLifetime: number;  // never resets
}

export interface UserConnection {
  id: string;
  sourceFragmentId: string;
  targetFragmentId: string;
  label: string;
  strength: 0 | 1 | 2 | 3;
  rationale?: string;
  createdAt: number;
  tier?: ConnectionTier;
  score?: number;
  claudeExplanation?: string;
  isGlowing?: boolean;
}

export interface FragmentConnectionState {
  connected: boolean;
  connectionCount: number;
}

export interface ExplorationConnectionState {
  userConnections: UserConnection[];
  depthScore: number;
  fragmentStates: Record<string, FragmentConnectionState>;
  milestonesReached: number[];
}

export interface CrossLink {
  id: string;
  explorationAId: string;
  fragmentAId: string;
  explorationBId: string;
  fragmentBId: string;
  label: string;
  createdAt: number;
}

export interface GenerateApiResponse {
  context: string;
  clusters: Array<{
    title: string;
    fragments: Array<{
      type: FragmentType;
      title: string;
      body: string;
      tags?: string[];
      list?: string[];
      era?: string;
      historicalEra?: string;
    }>;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label: string;
  }>;
}
