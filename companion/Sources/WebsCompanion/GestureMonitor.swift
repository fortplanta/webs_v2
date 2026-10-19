import AppKit

/// Watches, from the background, for "a piece of text is being dragged, and a modifier key is tapped". Mouse events are seen
/// system-wide; the text being dragged is read from the system's drag pasteboard, which the app you are dragging from fills
/// the moment the drag starts. Needs the Accessibility / Input Monitoring permission to see key presses in other apps.
final class GestureMonitor {
    struct Dragging { let text: String; let appName: String; let bundleID: String }

    var onShow: ((Set<Modifier>, Dragging) -> Void)?
    var onHide: (() -> Void)?

    private var monitors: [Any] = []
    private var mouseDown = false
    private var downPoint = NSPoint.zero
    private var changeCountAtDown = 0
    private var frontAtDown: (name: String, id: String) = ("", "")
    private(set) var dragging: Dragging?
    private var lastFlags: NSEvent.ModifierFlags = []
    private(set) var wheelOpen = false
    // Keys tapped within a moment of each other are one chord. The first tap opens a short window; whatever lands in it counts together.
    private var pending: Set<Modifier> = []
    private var chordTimer: DispatchWorkItem?
    private var shownMods: Set<Modifier> = []
    private var shownAt: Date = .distantPast
    static let chordWindow: TimeInterval = 0.12   // taps this close together are a chord
    static let upgradeWindow: TimeInterval = 0.35 // a second key this soon after the wheel opened upgrades it to a chord

    func start() {
        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .leftMouseDragged, .leftMouseUp, .flagsChanged, .keyDown]
        if let m = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] e in self?.handle(e) }) { monitors.append(m) }
        Journal.trace("monitor started")
    }

    private func handle(_ e: NSEvent) {
        switch e.type {
        case .leftMouseDown:
            mouseDown = true
            downPoint = NSEvent.mouseLocation
            changeCountAtDown = NSPasteboard(name: .drag).changeCount
            let app = NSWorkspace.shared.frontmostApplication
            frontAtDown = (app?.localizedName ?? "", app?.bundleIdentifier ?? "")
            dragging = nil
        case .leftMouseDragged:
            guard mouseDown, dragging == nil else { return }
            let p = NSEvent.mouseLocation
            guard hypot(p.x - downPoint.x, p.y - downPoint.y) >= 4 else { return }
            let pb = NSPasteboard(name: .drag)
            guard pb.changeCount != changeCountAtDown, let text = pb.string(forType: .string), !text.isEmpty else { return }
            dragging = Dragging(text: text, appName: frontAtDown.name, bundleID: frontAtDown.id)
            Journal.trace("text drag started in \(frontAtDown.name): \(text.prefix(60).replacingOccurrences(of: "\n", with: " "))")
        case .flagsChanged:
            let flags = e.modifierFlags.intersection([.shift, .command, .control])
            let pressed = flags.subtracting(lastFlags)
            lastFlags = flags
            guard dragging != nil, !pressed.isEmpty else { return }
            var taps: Set<Modifier> = []
            if pressed.contains(.shift) { taps.insert(.shift) }
            if pressed.contains(.command) { taps.insert(.command) }
            if pressed.contains(.control) { taps.insert(.control) }
            noteTaps(taps)
        case .keyDown:
            if e.keyCode == 53, wheelOpen { // escape
                Journal.trace("escape: wheel cancelled")
                close()
            }
        case .leftMouseUp:
            mouseDown = false
            let wasOpen = wheelOpen
            dragging = nil
            if wasOpen { DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in self?.close() } }
        default: break
        }
    }

    private func noteTaps(_ taps: Set<Modifier>) {
        // a key tapped right after the wheel opened turns it into a chord (a slower second finger)
        if wheelOpen, Date().timeIntervalSince(shownAt) < Self.upgradeWindow, !taps.isSubset(of: shownMods) {
            present(shownMods.union(taps))
            return
        }
        pending.formUnion(taps)
        if chordTimer == nil {
            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                let chord = self.pending
                self.pending = []; self.chordTimer = nil
                self.present(chord)
            }
            chordTimer = work
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.chordWindow, execute: work)
        }
    }

    private func present(_ mods: Set<Modifier>) {
        guard let d = dragging, !mods.isEmpty else { return }
        wheelOpen = true
        shownMods = mods; shownAt = Date()
        Journal.trace("keys tapped during text drag → \(Modifier.key(mods)) wheel")
        onShow?(mods, d)
    }

    private func close() {
        chordTimer?.cancel(); chordTimer = nil; pending = []
        wheelOpen = false
        onHide?()
    }
}
