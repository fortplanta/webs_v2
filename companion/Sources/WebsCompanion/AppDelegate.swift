import AppKit
import ApplicationServices

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let monitor = GestureMonitor()
    private let panel = WheelPanel()
    private let toast = Toast()
    private var statusLine = NSMenuItem(title: "Asleep. Drag text, then tap ⇧ ⌘ ⌃ (or two or three together)", action: nil, keyEquivalent: "")
    private var permissionLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private var lastDragSource: GestureMonitor.Dragging?
    private var catalog: Catalog?

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
            self?.statusLine.title = "Asleep. Drag text, then tap ⇧ ⌘ ⌃ (or two or three together)"
        }
        panel.wheel.onChoose = { [weak self] spec, segment, text in self?.chosen(spec, segment, text) }
        monitor.start()
        refreshPermissions()
        Journal.trace("launched; accessibility=\(AXIsProcessTrusted()) inputMonitoring=\(CGPreflightListenEventAccess())")
    }

    private func chosen(_ spec: WheelSpec, _ segment: Segment, _ text: String) {
        let src = lastDragSource
        Journal.append(mode: spec.key, action: segment.id, label: segment.label, text: text, source: ["app": src?.appName ?? "", "bundleID": src?.bundleID ?? ""])
        Journal.trace("DROP on \(spec.key)/\(segment.id): \(text.prefix(60).replacingOccurrences(of: "\n", with: " "))")
        toast.show("\(spec.glyphs) \(segment.label) → saved for Webs\n“\(text.prefix(70))”", near: NSEvent.mouseLocation)
        NSSound(named: "Tink")?.play()
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
