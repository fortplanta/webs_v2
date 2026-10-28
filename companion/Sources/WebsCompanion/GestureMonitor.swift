import AppKit

/// Watches, from the background, for "a piece of text is being dragged, and a modifier key is tapped". Mouse events are seen
/// system-wide; the text being dragged is read from the system's drag pasteboard, which the app you are dragging from fills
/// the moment the drag starts. Needs the Accessibility / Input Monitoring permission to see key presses in other apps.
final class GestureMonitor {
    struct Dragging { let text: String; let appName: String; let bundleID: String }

    var onShow: ((Set<Modifier>, Dragging) -> Void)?
    var onHide: (() -> Void)?
    /// Esc pressed while no wheel is open (used to cancel a run in progress). Never swallowed.
    var onEscape: (() -> Void)?
    private var tap: CFMachPort?

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
    static let chordWindow: TimeInterval = 0.12   // taps this close together are a chord

    func start() {
        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .leftMouseDragged, .leftMouseUp, .flagsChanged, .keyDown]
        if let m = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] e in self?.handle(e) }) { monitors.append(m) }
        installEscapeTap()
        Journal.trace("monitor started (escape \(tap != nil ? "will keep the drag" : "can cancel the drag: no event tap"))")
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
            if e.keyCode == 53 {
                if wheelOpen { if tap == nil { Journal.trace("escape: wheel cancelled"); close() } } // with the tap, it has already been handled (and swallowed)
                else { onEscape?() }
            }
        case .leftMouseUp:
            mouseDown = false
            let wasOpen = wheelOpen
            dragging = nil
            if wasOpen { DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in self?.close() } }
        default: break
        }
    }

    /// Esc while the wheel is open closes the wheel but must not reach the app being dragged from, or macOS would cancel the
    /// drag as well. A passive monitor cannot stop a key press; an event tap can, so this one swallows Esc, and only Esc, and
    /// only while the wheel is open.
    private func installEscapeTap() {
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            guard let refcon else { return Unmanaged.passUnretained(event) }
            let me = Unmanaged<GestureMonitor>.fromOpaque(refcon).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { if let t = me.tap { CGEvent.tapEnable(tap: t, enable: true) }; return Unmanaged.passUnretained(event) }
            if type == .keyDown, event.getIntegerValueField(.keyboardEventKeycode) == 53, me.wheelOpen {
                DispatchQueue.main.async { Journal.trace("escape: wheel closed, drag kept"); me.close() }
                return nil // swallowed: the drag carries on
            }
            return Unmanaged.passUnretained(event)
        }
        guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: callback, userInfo: Unmanaged.passUnretained(self).toOpaque()) else { return }
        tap = t
        CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0), .commonModes)
        CGEvent.tapEnable(tap: t, enable: true)
    }

    private func noteTaps(_ taps: Set<Modifier>) {
        // with the wheel open, a tap toggles that key: the wheel changes to the combination that results (and closes if none is left)
        if wheelOpen {
            let next = Modifier.toggled(shownMods, taps)
            if next.isEmpty { Journal.trace("keys toggled off: wheel closed, drag kept"); close() } else { present(next) }
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
        let wasOpen = wheelOpen
        wheelOpen = true
        shownMods = mods
        Journal.trace("keys \(wasOpen ? "toggled" : "tapped") during text drag → \(Modifier.key(mods)) wheel")
        onShow?(mods, d)
    }

    func close() {
        chordTimer?.cancel(); chordTimer = nil; pending = []
        wheelOpen = false
        shownMods = []
        onHide?()
    }
}
