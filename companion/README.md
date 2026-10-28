# Webs Companion (gesture spike)

A menu-bar agent that sleeps until you **drag selected text and tap a key**. A wheel opens under the cursor and stays open
until you drop: drop on a segment to choose it, in the middle (or press Escape) to cancel.

| Tap | Wheel | Options |
|---|---|---|
| ⇧ Shift | Test it | Challenge · Steelman · Fact-check · Explain simply · Place it historically |
| ⌘ Command | Explore | A different angle · What led to this · What follows · Who disagrees · Related reading |
| ⌃ Control | Keep | Send to Webs · New web from this · Copy with source |

**Switching wheels:** with a wheel open, tap ⇧, ⌘ or ⌃ again to toggle that key in or out of the combination, without dropping the drag. ⇧ opens Challenge, then tapping ⌘ gives ⇧⌘ (Diagnose), tapping ⇧ again gives ⌘ (Understand). Toggling off the last key closes the wheel and keeps the drag. Keys tapped together at the start open the combination directly. `WebsCompanion --self-test` checks the rules.

Esc closes the wheel and keeps the drag (it swallows that one key press while the wheel is open); Esc during a run cancels it.

Choosing an option sends the run to Webs, which wakes quietly in the background if it isn't running (no window, no Dock icon).
Webs writes the answer with its own engine and voice and hands it back; it appears in a floating window when finished. Every run
is recorded in `~/Documents/Webs/Companion/` (`journal.jsonl`, `results/`).

Earlier, in the spike: it proves the gesture. Choosing an option appends a line to `~/Documents/Webs/Companion/journal.jsonl`
(text, action, source app) and shows a notice; answers and the Webs inbox come next. What it saw, step by step, is in
`~/Documents/Webs/Companion/spike.log`.

```sh
sh build-app.sh && open "Webs Companion.app"
```

Signing: run `sh sign-setup.sh` once (makes a local certificate; macOS asks for your password once), then `build-app.sh` signs every build the same way, so the permission below survives rebuilds. Without the certificate it falls back to an ad-hoc signature and the permission is lost on each rebuild.

First run: allow it under System Settings → Privacy & Security → Accessibility (and Input Monitoring if asked), then quit and reopen it.
