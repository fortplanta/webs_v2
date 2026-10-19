import AppKit

// `--print-wheels`: list every wheel the catalog defines and exit (a quick check of the catalog and the skill names)
if CommandLine.arguments.contains("--print-wheels") {
    guard let catalog = Catalog.load() else { print("catalog not found"); exit(1) }
    let combos: [Set<Modifier>] = [[.shift], [.command], [.control], [.shift, .command], [.command, .control], [.shift, .control], [.shift, .command, .control]]
    for mods in combos {
        if let w = catalog.wheel(for: mods) { print("\(w.glyphs)  \(w.title) — \(w.tagline)\n     " + w.segments.map(\.label).joined(separator: "  ·  ")) }
        else { print("\(Modifier.glyphs(mods))  (no wheel)") }
    }
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // no Dock icon, no window: asleep until the gesture
app.run()
