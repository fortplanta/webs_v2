import AppKit

/// The wheel: a ring of segments around where the cursor was when the key was tapped. It is a drop target for the text
/// being dragged: move over a segment to highlight it, release to choose it, release in the middle (or elsewhere) to cancel.
final class WheelView: NSView {
    static let outer: CGFloat = 176
    static let inner: CGFloat = 46

    var spec = WheelSpec(key: "", glyphs: "", title: "", tagline: "", segments: []) { didSet { hovered = nil; needsDisplay = true } }
    var onChoose: ((WheelSpec, Segment, String) -> Void)?
    private var hovered: Int?

    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.string, NSPasteboard.PasteboardType("public.utf8-plain-text"), .URL])
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { false }

    // MARK: geometry

    private var center: NSPoint { NSPoint(x: bounds.midX, y: bounds.midY) }

    /// The segment under a point in the view, if any. Segment 0 starts at the top and they run clockwise.
    private func segment(at p: NSPoint) -> Int? {
        let dx = p.x - center.x, dy = p.y - center.y
        let dist = hypot(dx, dy)
        guard dist >= Self.inner, dist <= Self.outer else { return nil }
        let n = max(spec.segments.count, 1)
        var angle = atan2(dx, dy)               // 0 at the top, clockwise positive
        if angle < 0 { angle += 2 * .pi }
        let step = 2 * CGFloat.pi / CGFloat(n)
        return Int((angle + step / 2).truncatingRemainder(dividingBy: 2 * .pi) / step) % n
    }

    /// A label on at most two lines, split at the space nearest its middle.
    static func wrap(_ label: String) -> [String] {
        guard label.count > 12, label.contains(" ") else { return [label] }
        let words = label.split(separator: " ").map(String.init)
        var best = (0, Int.max)
        for i in 1..<words.count { let a = words[..<i].joined(separator: " ").count, b = words[i...].joined(separator: " ").count; if abs(a - b) < best.1 { best = (i, abs(a - b)) } }
        return [words[..<best.0].joined(separator: " "), words[best.0...].joined(separator: " ")]
    }

    // MARK: drawing

    override func draw(_ dirty: NSRect) {
        let n = max(spec.segments.count, 1)
        let step = 2 * CGFloat.pi / CGFloat(n)
        let ink = NSColor(white: 0.95, alpha: 1), dim = NSColor(white: 0.62, alpha: 1)

        // disc
        let disc = NSBezierPath(ovalIn: NSRect(x: center.x - Self.outer, y: center.y - Self.outer, width: Self.outer * 2, height: Self.outer * 2))
        NSColor(calibratedWhite: 0.06, alpha: 0.94).setFill(); disc.fill()

        for i in 0..<n {
            // segment i is centred on angle i·step from the top, clockwise
            let mid = CGFloat(i) * step
            let a0 = mid - step / 2, a1 = mid + step / 2
            let path = NSBezierPath()
            func pt(_ r: CGFloat, _ a: CGFloat) -> NSPoint { NSPoint(x: center.x + r * sin(a), y: center.y + r * cos(a)) }
            path.move(to: pt(Self.inner, a0))
            path.line(to: pt(Self.outer, a0))
            path.appendArc(withCenter: center, radius: Self.outer, startAngle: 90 - a0 * 180 / .pi, endAngle: 90 - a1 * 180 / .pi, clockwise: true)
            path.line(to: pt(Self.inner, a1))
            path.appendArc(withCenter: center, radius: Self.inner, startAngle: 90 - a1 * 180 / .pi, endAngle: 90 - a0 * 180 / .pi, clockwise: false)
            path.close()
            (hovered == i ? NSColor(white: 0.93, alpha: 1) : NSColor(white: 0.10, alpha: 1)).setFill()
            path.fill()
            NSColor(white: 0.04, alpha: 1).setStroke(); path.lineWidth = 2; path.stroke()

            guard i < spec.segments.count else { continue }
            let lines = Self.wrap(spec.segments[i].label)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 12, weight: .medium),
                .foregroundColor: hovered == i ? NSColor.black : ink,
            ]
            let c = pt((Self.inner + Self.outer) / 2 + 6, mid)
            let lineH: CGFloat = 15
            for (k, line) in lines.enumerated() {
                let s = NSAttributedString(string: line, attributes: attrs)
                let size = s.size()
                let y = c.y - size.height / 2 + (CGFloat(lines.count - 1) / 2 - CGFloat(k)) * lineH
                s.draw(at: NSPoint(x: c.x - size.width / 2, y: y))
            }
        }

        // the middle: which family, and which key switches
        NSColor(white: 0.04, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: center.x - Self.inner + 4, y: center.y - Self.inner + 4, width: (Self.inner - 4) * 2, height: (Self.inner - 4) * 2)).fill()
        let glyphs = NSAttributedString(string: spec.glyphs, attributes: [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: ink])
        let title = NSAttributedString(string: spec.title, attributes: [.font: NSFont.systemFont(ofSize: 10, weight: .semibold), .foregroundColor: dim])
        let gs = glyphs.size(), ts = title.size()
        glyphs.draw(at: NSPoint(x: center.x - gs.width / 2, y: center.y - 1))
        title.draw(at: NSPoint(x: center.x - ts.width / 2, y: center.y - ts.height - 1))
    }

    // MARK: NSDraggingDestination

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { Journal.trace("wheel: drag entered (types: \(sender.draggingPasteboard.types?.map(\.rawValue).prefix(4).joined(separator: ", ") ?? "none"))"); return update(sender) }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { update(sender) }
    override func draggingExited(_ sender: NSDraggingInfo?) { hovered = nil; needsDisplay = true }

    private func update(_ sender: NSDraggingInfo) -> NSDragOperation {
        let p = convert(sender.draggingLocation, from: nil)
        let next = segment(at: p)
        if next != hovered { hovered = next; needsDisplay = true; Journal.trace("wheel: over \(next.map { spec.segments[$0].label } ?? "the middle")") }
        return next == nil ? [] : .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let p = convert(sender.draggingLocation, from: nil)
        guard let i = segment(at: p) else { Journal.trace("wheel: dropped in the middle, cancelled"); return false }
        let pb = sender.draggingPasteboard
        let text = pb.string(forType: .string) ?? pb.string(forType: NSPasteboard.PasteboardType("public.utf8-plain-text")) ?? pb.string(forType: .URL) ?? ""
        guard i < spec.segments.count else { return false }
        let segment = spec.segments[i]
        hovered = nil; needsDisplay = true
        onChoose?(spec, segment, text)
        return true
    }
}
