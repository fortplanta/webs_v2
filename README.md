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

## Offline libraries (Wikipedia)

Big reference collections live in `~/Documents/Webs/Libraries/` as one compressed, searchable SQLite file each —
searching never loads them into memory. **Order of sources: your notes → your libraries → your AI provider.** If your
notes have nothing on a topic, the enabled libraries are searched (Settings → Libraries) and the web is built from
what they find, with the same lenses and bridges as your notes. Cards from a library show a **W**, a solid blue
outline and a link to the article.

Simple English Wikipedia (223k articles) is installed this way. To add a library, download a MediaWiki dump and run:

```bash
npm run library:import -- path/to/dump.xml.bz2 --name enwiki --label "English Wikipedia" --url https://en.wikipedia.org/wiki/
```

It streams the dump (any size) through `bzcat`, drops redirects, disambiguation pages, stubs, templates, tables and
reference sections, and writes `<name>.db`. Simple English takes ~5 minutes and ~0.4 GB.

## Bring your own AI (optional)

Your notes and libraries always come first. If they have nothing on a topic, Webs can ask an AI provider of your choosing to
write the web from its own knowledge instead — set it up in **Settings → AI provider**: any OpenAI-compatible
endpoint (OpenAI, OpenRouter, Groq, LM Studio, …) or Anthropic, with your own model name and API key. The key is
sealed with the macOS keychain and never shown again.

- **It runs alongside, never in front.** Collections and cards from your notes appear instantly as before; the
  AI's outline and cards stream in separately.
- **You can always tell the difference.** Anything the AI wrote has a dashed outline, a **✦** on its collection
  headers, and a footer "✦ AI · model — not from your notes". Cards from your notes show their source file.
  The editors say so too, and the canvas shows a small legend.
- **Fill gaps** (off by default): when your notes find *some* collections but fewer than requested, the AI adds the
  rest, in parallel; if it fails you keep your notes' web and see a warning.
- **Privacy:** only the topic (and, when filling gaps, the titles of the collections you already have) is sent
  to the provider — never your notes. The AI is not used when your notes cover the topic, and not at all unless
  you turn it on. It applies to the default "lensed" strategy.

## Updates

Installed copies of Webs check GitHub Releases on launch (and every few hours) and show a notice when a newer
version is out. **Install & restart** downloads it, verifies its checksum, swaps the app in place and relaunches —
no dmg to drag. (Settings → Updates shows the version and can check on demand.) If Webs can't replace itself — it's
running from the dmg, or its folder isn't writable — the notice offers the download instead.

To publish an update (needs `gh` logged in, and the repo public so the app can download without logging in):

```bash
npm run release -- patch    # or minor / major: bump, commit, push, build, publish the release
```

The first install of a version that has the updater still has to be the dmg; after that, updates install themselves.

## Where things are

| | Development | Packaged app |
|---|---|---|
| Canvases, settings | `~/Library/Application Support/Webs/webs.db` | same |
| Knowledge base | the repo's `kb/` | `~/Documents/Webs/KB` (created from the samples on first launch; never overwritten) |

Override with `WEBS_DB` (database file) and `WEBS_KB_DIR` (KB folder). The KB folder can also be changed
in Settings. A library saved by earlier builds (in `~/Library/Application Support/webs-v1a`) is copied
across once on first launch; the original is left untouched.

The app's only outbound calls are to your Ollama, your capture service and AI provider (if you set them up), and
GitHub (the update check); fonts are bundled.

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
