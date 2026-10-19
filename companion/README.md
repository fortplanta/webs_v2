# Webs Companion (gesture spike)

A menu-bar agent that sleeps until you **drag selected text and tap a key**. A wheel opens under the cursor and stays open
until you drop: drop on a segment to choose it, in the middle (or press Escape) to cancel.

| Tap | Wheel | Options |
|---|---|---|
| ⇧ Shift | Test it | Challenge · Steelman · Fact-check · Explain simply · Place it historically |
| ⌘ Command | Explore | A different angle · What led to this · What follows · Who disagrees · Related reading |
| ⌃ Control | Keep | Send to Webs · New web from this · Copy with source |

This is the spike: it proves the gesture. Choosing an option appends a line to `~/Documents/Webs/Companion/journal.jsonl`
(text, action, source app) and shows a notice; answers and the Webs inbox come next. What it saw, step by step, is in
`~/Documents/Webs/Companion/spike.log`.

```sh
sh build-app.sh && open "Webs Companion.app"
```

First run: allow it under System Settings → Privacy & Security → Accessibility (and Input Monitoring if asked), then quit and reopen it.
