/** A capture from the webs-capture service, reduced to what the canvas can place. */
export interface InboxItem {
  id: string;
  kind: 'pointer' | 'text';
  /** Where it came from (e.g. "share", "manual") and on what device. */
  channel: string;
  device: string;
  createdAt: string;
  /** Page/media URL (pointer captures, or parsed from a text capture's source footer). */
  url?: string;
  /** Page title when known (service-derived title or the footer written by the browser extension). */
  title?: string;
  /** Selected/pasted text, without the source footer. */
  text?: string;
  /** Media timestamp in seconds (e.g. YouTube ?t=). */
  startSeconds?: number;
}

export type InboxResult =
  | { ok: true; items: InboxItem[]; /** Image/file captures: not placeable on the canvas yet. */ unsupported: number }
  | { ok: false; message: string };

export type CaptureTestResult =
  | { ok: true; message: string }
  | { ok: false; message: string };
