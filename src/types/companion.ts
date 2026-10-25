/** Something the Webs Companion produced, waiting in the inbox to be placed on the canvas. */
export interface CompanionItem {
  id: string;
  at: string;
  /** A finished answer, or text the companion was asked to keep as it is. */
  kind: 'result' | 'kept';
  title: string;
  /** What was written (results) or the kept selection. */
  body: string;
  /** The action's id, e.g. "devils-advocate". */
  action: string;
  /** The text that was dragged, for results. */
  selection?: string;
  source?: { app?: string; url?: string; title?: string };
}
