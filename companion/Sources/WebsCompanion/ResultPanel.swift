import AppKit

/// The answer, in a floating window that appears when a skill has finished running. It floats above other apps without
/// taking over: scroll and select inside it, copy it, or press Esc to put it away. (Long answers are written inside Webs and
/// are already saved there; this is just where you see them.)
final class ResultPanel: NSPanel {
    private let titleLabel = NSTextField(labelWithString: "")
    private let sourceLabel = NSTextField(labelWithString: "")
    private let textView = NSTextView()
    private let scroll = NSScrollView()
    private var markdown = ""
    var onOpenWebs: (() -> Void)?

    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 560, height: 640),
                   styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel, .fullSizeContentView],
                   backing: .buffered, defer: false)
        title = ""
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        level = .floating
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isReleasedWhenClosed = false
        appearance = NSAppearance(named: .darkAqua)
        backgroundColor = NSColor(calibratedWhite: 0.07, alpha: 0.98)
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        minSize = NSSize(width: 380, height: 260)
        build()
    }

    private func build() {
        guard let content = contentView else { return }
        titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        titleLabel.textColor = Markdown.ink
        titleLabel.lineBreakMode = .byTruncatingTail
        sourceLabel.font = .systemFont(ofSize: 11)
        sourceLabel.textColor = Markdown.dim
        sourceLabel.lineBreakMode = .byTruncatingMiddle

        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 20, height: 8)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        scroll.documentView = textView
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.scrollerStyle = .overlay
        scroll.borderType = .noBorder

        let copy = button("Copy", #selector(copyAnswer))
        let open = button("Open Webs", #selector(openWebs))
        let hint = NSTextField(labelWithString: "Esc to close")
        hint.font = .systemFont(ofSize: 11); hint.textColor = Markdown.faint

        let head = NSStackView(views: [titleLabel, sourceLabel])
        head.orientation = .vertical; head.alignment = .leading; head.spacing = 2
        let foot = NSStackView(views: [hint, NSView(), open, copy])
        foot.orientation = .horizontal; foot.spacing = 8; foot.alignment = .centerY
        foot.setHuggingPriority(.defaultLow, for: .horizontal)

        for v in [head, scroll, foot] { v.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(v) }
        NSLayoutConstraint.activate([
            head.topAnchor.constraint(equalTo: content.topAnchor, constant: 34),
            head.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 22),
            head.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -22),
            scroll.topAnchor.constraint(equalTo: head.bottomAnchor, constant: 10),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: foot.topAnchor, constant: -8),
            foot.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 22),
            foot.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -22),
            foot.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14),
        ])
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        let b = NSButton(title: title, target: self, action: action)
        b.bezelStyle = .rounded
        b.controlSize = .small
        return b
    }

    /// Show a finished answer on the screen the cursor is on, at its right edge so it does not cover what you were reading.
    func show(title: String, source: [String: String], markdown: String) {
        self.markdown = markdown
        titleLabel.stringValue = title
        let from = [source["title"], source["app"]].compactMap { $0 }.filter { !$0.isEmpty }.first
        sourceLabel.stringValue = from.map { "About: \($0)" } ?? ""
        textView.textStorage?.setAttributedString(Markdown.render(markdown))
        textView.scrollToBeginningOfDocument(nil)
        let mouse = NSEvent.mouseLocation
        if let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main {
            let f = screen.visibleFrame
            let h = min(660, f.height - 80), w: CGFloat = 560
            setFrame(NSRect(x: f.maxX - w - 24, y: f.maxY - h - 40, width: w, height: h), display: true)
        }
        orderFrontRegardless()
    }

    @objc private func copyAnswer() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(markdown, forType: .string)
    }
    @objc private func openWebs() { onOpenWebs?() }

    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}
