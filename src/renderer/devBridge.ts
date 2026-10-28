// Development only (never in a build): a stand-in for the Electron bridge so the canvas can be opened in an ordinary browser
// tab at `/?mock` and watched while it is worked on. It "generates" a canned web with realistic timing, grows a pivot, and
// answers everything else with empty results. Nothing here is saved or sent anywhere.

import type { GeneratedFragment, PivotEvent, WebEvent } from '../backend/events';
import type { WebsApi } from '../types/ipc';

const frag = (type: GeneratedFragment['type'], title: string, body: string, extra: Partial<GeneratedFragment> = {}): GeneratedFragment => ({ type, title, body, tags: [], weight: 2, ...extra });

const TOPICS = [
  { title: 'How it began', edge: 'started with', cards: [
    frag('event', 'The first workshop', 'Around 1440 a goldsmith in Mainz began working out how to cast metal type that could be set, inked and reused.', { weight: 3, kbPassageIds: ['p1'], era: '1440' }),
    frag('person', 'Johannes Gutenberg', 'A goldsmith and merchant who combined an oil-based ink, a screw press and movable metal type into one working system.', { kbPassageIds: ['p2'] }),
    frag('concept', 'Movable type', 'Each letter is cast as its own small block, so a page can be set, printed and the letters used again for the next one.', { kbPassageIds: ['p3'], relates: [{ to: 'p2', verb: 'made by' }] }),
    frag('source', 'The Gutenberg Bible', 'About 180 copies were printed in the 1450s, each page set in two columns of 42 lines.', { kbPassageIds: ['p4'], link: 'https://example.org/gutenberg-bible' }),
  ] },
  { title: 'Why it spread so fast', edge: 'led to', cards: [
    frag('thesis', 'Cheaper books, more readers', 'Printed books cost a fraction of a hand-copied one, which pulled in readers who had never owned a book.', { weight: 3, kbPassageIds: ['p5'], relates: [{ to: 'p4', verb: 'built on' }] }),
    frag('event', 'Printers in every trade city', 'By 1500 presses were running in more than 250 European cities, mostly along trade routes.', { kbPassageIds: ['p6'] }),
    frag('concept', 'A market for print', 'Printers were businesses, so they published whatever would sell, and that was often not what the church wanted.', { kbPassageIds: ['p7'] }),
  ] },
  { title: 'What it did to ideas', edge: 'changed', cards: [
    frag('thesis', 'Arguments travel faster', 'A pamphlet could reach a whole region in weeks, so a dispute stopped being local.', { weight: 3, kbPassageIds: ['p8'] }),
    frag('person', 'Martin Luther', 'His theses spread through printing within months, which helped turn a university dispute into a movement.', { kbPassageIds: ['p9'], relates: [{ to: 'p5', verb: 'rode on' }] }),
    frag('concept', 'Standard texts', 'When many copies match exactly, people can point to the same page, and mistakes become easier to catch.', { kbPassageIds: ['p10'] }),
    frag('quote', 'On error and print', 'The same machine that spread a correction also spread the mistake, to far more readers.', { kbPassageIds: ['p11'] }),
  ] },
  { title: 'Who lost out', edge: 'cost', cards: [
    frag('concept', 'Scribes and copyists', 'Professional copyists lost their trade within a generation in many cities.', { weight: 3, kbPassageIds: ['p12'] }),
    frag('thesis', 'Control slipped away', 'Authorities tried licensing and censorship, but a book printed in one city could be sold in another.', { kbPassageIds: ['p13'] }),
  ] },
  { title: 'Before and after', edge: 'set against', cards: [
    frag('era', 'Manuscript culture', 'Books were rare, expensive and each slightly different from the last, so reading was shared and local.', { kbPassageIds: ['p14'], historicalEra: 'before 1450' }),
    frag('era', 'Print culture', 'Books became common and identical, and reading became something a person did alone.', { weight: 3, kbPassageIds: ['p15'], historicalEra: 'after 1500' }),
    frag('event', 'The first newspapers', 'Weekly printed news sheets began appearing in the early 1600s, turning events into a shared daily conversation.', { kbPassageIds: ['p16'] }),
  ] },
  { title: 'Tangent: the screw press', edge: 'borrowed from', cards: [
    frag('concept', 'Wine and olive presses', 'The screw press already existed for crushing grapes and olives; printing reused it for pressing paper onto type.', { weight: 3, kbPassageIds: ['p17'], relates: [{ to: 'p3', verb: 'carried' }] }),
    frag('source', 'Roman screw presses', 'Roman engineers described screw presses in the first century, long before anyone thought of printing with one.', { kbPassageIds: ['p18'] }),
  ] },
];

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function generate(query: string, onEvent: (e: WebEvent) => void): () => void {
  let stop = false;
  void (async () => {
    const emit = (e: WebEvent) => { if (!stop) onEvent(e); };
    emit({ type: 'status', message: 'Searching your notes…' });
    await wait(350);
    emit({ type: 'kb', passages: [
      { source: 'notes/printing.md', text: 'Movable type was cast from a metal alloy and set letter by letter into a frame.', lens: 'direct' },
      { source: 'notes/books.md', text: 'The number of books in Europe grew from thousands to millions within a few generations.', lens: 'direct' },
      { source: 'notes/reformation.md', text: 'Pamphlets carried arguments far beyond the town where they were written.', lens: 'bridge' },
    ] });
    await wait(300);
    emit({ type: 'overview', context: `${query} reshaped who could read, who could argue and who could be silenced.`, clusters: TOPICS.map(t => ({ title: t.title, slots: t.cards.length, edge: t.edge })), edges: [{ source: 0, target: 5, label: 'borrowed from' }, { source: 1, target: 2, label: 'fed' }] });
    for (let ci = 0; ci < TOPICS.length; ci++) {
      for (let si = 0; si < TOPICS[ci].cards.length; si++) {
        await wait(260);
        emit({ type: 'fragment', cluster: ci, slot: si, fragment: TOPICS[ci].cards[si] });
      }
    }
    await wait(300);
    emit({ type: 'done' });
  })();
  return () => { stop = true; };
}

function pivot(req: Parameters<WebsApi['pivot']>[0], onEvent: (e: PivotEvent) => void): () => void {
  let stop = false;
  void (async () => {
    await wait(250);
    if (stop) return;
    onEvent({ type: 'plan', title: `Beyond ${req.card.title}`, lens: 'direct', edge: 'leads to', cards: [
      frag('concept', 'A side road', 'Following this idea somewhere unexpected turns up a neighbouring field with its own vocabulary.'),
      frag('event', 'An unexpected turn', 'The idea turned up again two centuries later in a different trade, with a different name.'),
      frag('thesis', 'What it implies', 'If this holds, then a few other things people take for granted have to be reconsidered.'),
    ] });
    await wait(500);
    if (!stop) onEvent({ type: 'done' });
  })();
  return () => { stop = true; };
}

const none = async () => ({ ok: false, message: 'Not available in the mock.' });

const mock = {
  generate, pivot,
  warmUp: () => undefined,
  connect: async () => ({ ok: true, verdict: { link: 'solid', tier: 'obvious', verb: 'led to', note: 'These are plainly related.' } }),
  lens: none,
  listWebs: async () => [],
  loadWeb: async () => null,
  saveWeb: async () => undefined,
  deleteWeb: async () => undefined,
  saveFile: async () => ({ ok: true }),
  getSettings: async () => ({ settings: { capture: { url: '', token: '' }, images: { wikipedia: false }, generation: { clusterCount: 6, fragmentsPerCluster: 4, strategy: 'lensed' }, library: { dir: '', disabled: [] } }, defaults: {}, strategies: ['lensed'], modules: [], aiKeySet: false, libraries: [] }),
  getInbox: none,
  getCompanionInbox: async () => [],
  markCompanion: async () => ({ ok: true }),
  getVersion: async () => 'mock',
  onUpdateState: () => () => undefined,
} as unknown as WebsApi;

(window as unknown as { webs: WebsApi }).webs = new Proxy(mock, { get: (t, k) => (k in t ? (t as any)[k] : async () => ({ ok: false, message: 'Not available in the mock.' })) });
