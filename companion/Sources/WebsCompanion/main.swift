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

// `--self-test`: check the key-toggling rules without a drag
if CommandLine.arguments.contains("--self-test") {
    var failed = 0
    func check(_ name: String, _ got: Set<Modifier>, _ want: Set<Modifier>) { if got != want { failed += 1; print("FAIL \(name): \(Modifier.key(got)) != \(Modifier.key(want))") } else { print("ok   \(name)") } }
    check("⇧ then ⌘ → ⇧⌘", Modifier.toggled([.shift], [.command]), [.shift, .command])
    check("⇧⌘ then ⇧ → ⌘", Modifier.toggled([.shift, .command], [.shift]), [.command])
    check("⇧ then ⇧ → stays ⇧ (never none)", Modifier.toggled([.shift], [.shift]), [.shift])
    check("⌃ then ⌃ → stays ⌃", Modifier.toggled([.control], [.control]), [.control])
    check("⇧⌃ then ⇧⌃ together → stays ⇧⌃", Modifier.toggled([.shift, .control], [.shift, .control]), [.shift, .control])
    // from every wheel, any tap sequence goes on: every wheel reaches every other, and none is ever empty
    let all: [Set<Modifier>] = [[.shift], [.command], [.control], [.shift, .command], [.command, .control], [.shift, .control], [.shift, .command, .control]]
    let singles: [Set<Modifier>] = [[.shift], [.command], [.control]]
    for from in all {
        var seen: Set<String> = [Modifier.key(from)], frontier = [from], dead = false
        while !frontier.isEmpty { let cur = frontier.removeFirst(); for t in singles { let n = Modifier.toggled(cur, t); if n.isEmpty { dead = true }; if seen.insert(Modifier.key(n)).inserted { frontier.append(n) } } }
        if dead || seen.count != 7 { failed += 1; print("FAIL from \(Modifier.key(from)): reaches \(seen.count) of 7\(dead ? ", hits an empty wheel" : "")") } else { print("ok   from \(Modifier.glyphs(from)) every wheel is reachable") }
    }
    check("⌃ then ⇧⌘ together → all three", Modifier.toggled([.control], [.shift, .command]), [.shift, .command, .control])
    check("⇧⌘⌃ then ⌘⌃ together → ⇧", Modifier.toggled([.shift, .command, .control], [.command, .control]), [.shift])
    exit(failed == 0 ? 0 : 1)
}

// `--run-test <mode> <action> <text…>`: send one run to Webs and print what comes back (checks the whole path without a drag)
if let i = CommandLine.arguments.firstIndex(of: "--run-test"), CommandLine.arguments.count > i + 3 {
    let mode = CommandLine.arguments[i + 1], action = CommandLine.arguments[i + 2], text = CommandLine.arguments[(i + 3)...].joined(separator: " ")
    Task {
        do {
            for try await ev in Engine().run(id: UUID().uuidString.lowercased(), mode: mode, action: action, text: text, source: ["app": "cli"]) {
                switch ev {
                case .status(let s): print("[status] \(s)")
                case .start(let t, let n): print("[start] \(t) (\(n) step\(n == 1 ? "" : "s"))")
                case .done(let t, let md): print("[done] \(t): \(md.count) characters\n\(md.prefix(600))")
                case .kept(let l): print("[kept] \(l)")
                case .error(let e): print("[error] \(e)")
                default: break
                }
            }
        } catch { print("failed: \(error.localizedDescription)") }
        exit(0)
    }
    RunLoop.main.run()
}

// `--demo-result`: show the result window with a sample answer
if CommandLine.arguments.contains("--demo-result") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let panel = ResultPanel()
    panel.show(title: "Devil's advocate", source: ["title": "Prospect theory — Wikipedia", "app": "Dia"], markdown: """
    ## The pushback

    You're saying **losses loom larger than gains**. Fine. But who measured it, and *on whom*?

    - Most of the classic studies ran on students with *small* stakes. Does loss aversion survive when it's rent money?
    - Some replications find the effect shrinking as stakes grow. That's a crack, not a footnote.
    - `Loss aversion` and risk aversion are not the same fight, and the argument keeps swapping one for the other.

    ### Where it breaks

    | Claim | Weak spot | Test |
    |---|---|---|
    | Losses hurt about twice as much | Varies by context | Replicate with real money |
    | It's universal | Mostly WEIRD samples | Cross-cultural data |

    1. Ask who profits from believing it.
    2. Find the case where it predicts the wrong move.

    > The real question isn't whether it's true. It's when it stops being true.
    """)
    DispatchQueue.main.asyncAfter(deadline: .now() + 600) { exit(0) }
    app.run()
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // no Dock icon, no window: asleep until the gesture
app.run()
