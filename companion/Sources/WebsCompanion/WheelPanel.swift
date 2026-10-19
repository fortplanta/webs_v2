import AppKit

/// A borderless panel that holds the wheel. It never takes focus from the app you are working in.
final class WheelPanel: NSPanel {
    let wheel: WheelView

    init() {
        let side = WheelView.outer * 2 + 24
        wheel = WheelView(frame: NSRect(x: 0, y: 0, width: side, height: side))
        super.init(contentRect: NSRect(x: 0, y: 0, width: side, height: side), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .popUpMenu
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        isReleasedWhenClosed = false
        contentView = wheel
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    /// Open with the wheel's middle under `point` (screen coordinates), kept on screen.
    func show(spec: WheelSpec, at point: NSPoint) {
        wheel.spec = spec
        var origin = NSPoint(x: point.x - frame.width / 2, y: point.y - frame.height / 2)
        if let screen = NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) }) ?? NSScreen.main {
            let f = screen.visibleFrame
            origin.x = min(max(origin.x, f.minX + 4), f.maxX - frame.width - 4)
            origin.y = min(max(origin.y, f.minY + 4), f.maxY - frame.height - 4)
        }
        if !isVisible { setFrameOrigin(origin); orderFrontRegardless() }
        wheel.needsDisplay = true
    }

    func hide() { orderOut(nil) }
}
