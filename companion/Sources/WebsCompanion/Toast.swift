import AppKit

/// A small notice near the cursor ("Challenge → sent to Webs"), gone after a moment.
final class Toast {
    private var panel: NSPanel?
    private var work: DispatchWorkItem?

    /// A notice that stays until `hide()` (a run in progress), updated in place with `show(_:near:)` again.
    func showPersistent(_ text: String, near point: NSPoint) { show(text, near: point, lasting: nil) }

    func hide() { work?.cancel(); panel?.orderOut(nil) }

    func show(_ text: String, near point: NSPoint, lasting seconds: TimeInterval? = 2.4) {
        work?.cancel()
        panel?.orderOut(nil)
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = NSColor(white: 0.95, alpha: 1)
        label.lineBreakMode = .byTruncatingTail
        label.maximumNumberOfLines = 2
        label.preferredMaxLayoutWidth = 320
        let size = label.fittingSize
        let box = NSView(frame: NSRect(x: 0, y: 0, width: size.width + 28, height: size.height + 18))
        box.wantsLayer = true
        box.layer?.backgroundColor = NSColor(calibratedWhite: 0.06, alpha: 0.96).cgColor
        box.layer?.cornerRadius = 9
        label.frame.origin = NSPoint(x: 14, y: 9)
        box.addSubview(label)
        let p = NSPanel(contentRect: box.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = true; p.level = .popUpMenu
        p.ignoresMouseEvents = true; p.contentView = box
        p.setFrameOrigin(NSPoint(x: point.x + 14, y: point.y - box.frame.height - 14))
        p.orderFrontRegardless()
        panel = p
        guard let seconds else { return }
        let w = DispatchWorkItem { [weak self] in self?.panel?.orderOut(nil) }
        work = w
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: w)
    }
}
