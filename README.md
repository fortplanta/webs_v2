# Webs

A local research canvas. Ask about a topic and Webs builds a **web** from *your own knowledge base*: themed
collections of cards, each grounded in a specific note, connected by labelled threads. Everything runs on
your machine — a local model through [Ollama](https://ollama.com), your notes as markdown files, your
canvases in a local SQLite file.

Built with Electron, React, Excalidraw and Node's built-in SQLite.

## Using it

1. **Add notes.** Put markdown files in your knowledge-base folder. Each top-level folder is a *module*
   you can switch on or off in Settings. A few sample notes are included to try it out.
2. **Ask.** Type a topic and press *Generate Web*. A first version built straight from your notes appears
   almost immediately; the model then names the collections and writes the cards, replacing the excerpts
   as it goes. If Ollama isn't running you still get the note excerpts, with a banner saying so.
3. **Explore.** Double-click a card to edit it, or press **↗ Explore a different angle** to grow a new
   collection from it (never repeating notes already on the canvas). Drop, paste or pick images
   (**＋ Image**); paste text or links to add cards; draw connections with the arrow tool.
   Cards never overlap: drag one onto another and the other glides aside, staying where it was pushed.
   **Stick to…** (in a card's editor) keeps a card within reach of a label; generated collections come that way.
4. **Settings** (top right of the first screen): Ollama URL and model, the KB folder and modules, the
   generation strategy, and an optional capture inbox.

## Requirements

- macOS on Apple Silicon (the packaged build); Node 22+ to develop.
- [Ollama](https://ollama.com) running locally with a model pulled. The default is `qwen3:8b`:

  ```bash
  ollama pull qwen3:8b
  ollama serve
  ```

## Develop

```bash
npm install
npm run dev        # starts the dev server and opens the Electron window
npm test           # unit tests
npm run typecheck
```

`npm run dev` opens the app in Electron. The dev server's URL in a browser tab only shows a notice — the
app needs Electron's bridge for storage, settings and generation.

## Build the app

```bash
npm run pack       # unpacked app → release/mac-arm64/Webs.app (quick to try)
npm run dist       # also the .dmg and .zip → release/
```

The app is **ad-hoc signed, not notarized**. One built on your own Mac runs normally; if you move the
download to another Mac, right-click → *Open* the first time.

## Where things are

| | Development | Packaged app |
|---|---|---|
| Canvases, settings | `~/Library/Application Support/Webs/webs.db` | same |
| Knowledge base | the repo's `kb/` | `~/Documents/Webs/KB` (created from the samples on first launch; never overwritten) |

Override with `WEBS_DB` (database file) and `WEBS_KB_DIR` (KB folder). The KB folder can also be changed
in Settings. A library saved by earlier builds (in `~/Library/Application Support/webs-v1a`) is copied
across once on first launch; the original is left untouched.

The app makes no network requests of its own: fonts are bundled, and the only outbound calls are to your
Ollama (and your capture service, if you set one).

## How generation works

`src/backend/retrieval/` chooses *what* to show; the model only names and words it.

- Notes are split into passages and scored with BM25 (with a relevance floor).
- Seven "lenses" (direct, lineage, use, consequence, analogy, representation, tension) detect *how* a
  passage relates to the topic from cue words, and a bridge route follows ideas shared with the best
  matches to passages that don't mention the topic at all.
- Selection is set-level: the anchor first, then whatever adds the most to what's already chosen.
- Every card records its note, route, and a grounding score; cards that go beyond the note are flagged.

All weights and thresholds are in `retrieval/config.ts`; the lenses in `retrieval/lenses.ts`. The
strategy is pluggable (`src/backend/strategies/`); the simpler `progressive` strategy is kept for
comparison and can be selected in Settings.

## Browser capture (optional)

`extension/` is a small Chrome extension that sends a selection, link or page to a
`webs-capture` service; the canvas **Inbox** pulls from it. See `extension/README.md`.

## Layout

```
src/main/       Electron main process, IPC, window, custom webs:// protocol
src/preload/    the bridge (window.webs) exposed to the renderer
src/backend/    generation, retrieval, Ollama client, SQLite, settings, first-run helpers
src/renderer/   the React app and the Excalidraw canvas logic
src/types/      shared types
extension/      browser extension
kb/             sample notes
build/          app icon (placeholder)
tests/          vitest suites
```
