import AppKit
import ApplicationServices

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let monitor = GestureMonitor()
    private let panel = WheelPanel()
    private let toast = Toast()
    private var statusLine = NSMenuItem(title: "Asleep. Drag text, tap ⇧ ⌘ ⌃ (tap more to switch)", action: nil, keyEquivalent: "")
    private var permissionLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private var lastDragSource: GestureMonitor.Dragging?
    private var catalog: Catalog?
    private let engine = Engine()
    private let result = ResultPanel()
    private var runTask: Task<Void, Never>?
    private let pill = Toast()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // key presses in other apps are only visible with this permission; asking here shows the system prompt once
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
        _ = CGRequestListenEventAccess()

        catalog = Catalog.load()
        Journal.trace(catalog == nil ? "catalog NOT found (looked in the app, WEBS_SKILLS_DIR, ./skills, ~/Projects/webs_v2/skills)" : "catalog loaded from \(Catalog.directory?.path ?? "?")")
        buildMenu()
        monitor.onShow = { [weak self] mods, dragging in
            guard let self else { return }
            self.lastDragSource = dragging
            guard let spec = self.catalog?.wheel(for: mods) else { Journal.trace("no wheel for \(Modifier.key(mods))"); return }
            self.panel.show(spec: spec, at: NSEvent.mouseLocation)
            self.statusLine.title = "Awake: \(spec.glyphs) \(spec.title)"
        }
        monitor.onHide = { [weak self] in
            self?.panel.hide()
            self?.statusLine.title = "Asleep. Drag text, tap ⇧ ⌘ ⌃ (tap more to switch)"
        }
        panel.wheel.onChoose = { [weak self] spec, segment, text in self?.chosen(spec, segment, text) }
        monitor.onEscape = { [weak self] in self?.cancelRun() }
        result.onOpenWebs = { if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.webs.desktop") { NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) } }
        monitor.start()
        refreshPermissions()
        Journal.trace("launched; accessibility=\(AXIsProcessTrusted()) inputMonitoring=\(CGPreflightListenEventAccess())")
    }

    /// A segment was chosen: run it inside Webs (waking it quietly if needed), show progress, then show the answer.
    private func chosen(_ spec: WheelSpec, _ segment: Segment, _ text: String) {
        let src = lastDragSource
        let source = ["app": src?.appName ?? "", "bundleID": src?.bundleID ?? ""]
        let id = UUID().uuidString.lowercased()
        let at = NSEvent.mouseLocation
        Journal.trace("DROP on \(spec.key)/\(segment.id): \(text.prefix(60).replacingOccurrences(of: "\n", with: " "))")
        runTask?.cancel()
        pill.showPersistent("\(spec.glyphs) \(segment.label)…  ·  Esc to cancel", near: at)

        runTask = Task { @MainActor in
            var title = segment.label
            do {
                for try await ev in engine.run(id: id, mode: spec.key, action: segment.id, text: text, source: source) {
                    switch ev {
                    case .start(let t, _): title = t
                    case .status(let m): pill.showPersistent("\(spec.glyphs) \(m)  ·  Esc to cancel", near: at)
                    case .kept(let label):
                        pill.hide(); toast.show("\(label) → saved in Webs\n“\(text.prefix(70))”", near: at); NSSound(named: "Tink")?.play(); return
                    case .done(let t, let md):
                        pill.hide(); NSSound(named: "Glass")?.play()
                        result.show(title: t, source: source.merging(["title": ""]) { a, _ in a }, markdown: md)
                        Journal.trace("done: \(t) (\(md.count) characters)")
                        return
                    case .error(let m):
                        pill.hide(); toast.show("\(title): \(m)", near: at, lasting: 6); Journal.trace("error: \(m)"); return
                    default: break
                    }
                }
                pill.hide()
            } catch {
                pill.hide()
                // Webs could not be reached: keep what was chosen so nothing is lost, and say so
                Journal.append(mode: spec.key, action: segment.id, label: segment.label, text: text, source: source)
                toast.show("Webs isn't reachable: saved for later.\n\(error.localizedDescription)", near: at, lasting: 6)
                Journal.trace("engine unreachable: \(error.localizedDescription)")
            }
        }
    }

    /// Esc while a run is going: stop it (the connection closing stops it inside Webs too).
    private func cancelRun() {
        guard let task = runTask, !task.isCancelled else { return }
        task.cancel()
        runTask = nil
        pill.hide()
        toast.show("Cancelled", near: NSEvent.mouseLocation, lasting: 1.2)
        Journal.trace("escape: run cancelled")
    }

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "circle.dotted", accessibilityDescription: "Webs Companion")
            button.image?.isTemplate = true
        }
        let menu = NSMenu()
        menu.addItem(statusLine)
        menu.addItem(permissionLine)
        menu.addItem(.separator())
        let open = NSMenuItem(title: "Open journal folder", action: #selector(openJournal), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        let perms = NSMenuItem(title: "Open privacy settings…", action: #selector(openPrivacy), keyEquivalent: "")
        perms.target = self
        menu.addItem(perms)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Webs Companion", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu
        menu.delegate = self
    }

    private func refreshPermissions() {
        let ok = AXIsProcessTrusted() || CGPreflightListenEventAccess()
        permissionLine.title = ok ? "Key permission: granted" : "Key permission needed (see privacy settings)"
    }

    @objc private func openJournal() { NSWorkspace.shared.open(Journal.directory) }
    @objc private func openPrivacy() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }
}

extension AppDelegate: NSMenuDelegate {
    func menuWillOpen(_ menu: NSMenu) { refreshPermissions() }
}
