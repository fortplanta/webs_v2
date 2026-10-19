import AppKit

/// Markdown (what the Webs engine writes) as styled text for the result window: headings, bold and italic, code, bullet and
/// numbered lists, quotes, rules and simple tables. Small on purpose: just what the answers use.
enum Markdown {
    static let ink = NSColor(white: 0.93, alpha: 1)
    static let dim = NSColor(white: 0.62, alpha: 1)
    static let faint = NSColor(white: 0.34, alpha: 1)

    static func render(_ md: String) -> NSAttributedString {
        let out = NSMutableAttributedString()
        var inCode = false
        var table: [[String]] = []
        let lines = md.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")

        func flushTable() {
            guard !table.isEmpty else { return }
            let rows = table.filter { !$0.allSatisfy { $0.trimmingCharacters(in: CharacterSet(charactersIn: "-: ")).isEmpty } }
            let cols = rows.map(\.count).max() ?? 0
            var widths = [Int](repeating: 0, count: cols)
            for r in rows { for (i, c) in r.enumerated() { widths[i] = min(max(widths[i], c.count), 34) } }
            for (ri, r) in rows.enumerated() {
                let cells = (0..<cols).map { i -> String in
                    let c = i < r.count ? r[i] : ""
                    let clipped = c.count > 34 ? String(c.prefix(33)) + "…" : c
                    return clipped.padding(toLength: widths[i], withPad: " ", startingAt: 0)
                }
                append(out, cells.joined(separator: "  "), font: .monospacedSystemFont(ofSize: 11.5, weight: ri == 0 ? .semibold : .regular), color: ri == 0 ? ink : dim, spacing: 2)
            }
            append(out, "", font: .systemFont(ofSize: 6), color: dim, spacing: 0)
            table = []
        }

        for raw in lines {
            if raw.trimmingCharacters(in: .whitespaces).hasPrefix("```") { flushTable(); inCode.toggle(); continue }
            if inCode { append(out, raw, font: .monospacedSystemFont(ofSize: 11.5, weight: .regular), color: dim, spacing: 1); continue }
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("|") {
                table.append(line.split(separator: "|", omittingEmptySubsequences: false).dropFirst().dropLast().map { $0.trimmingCharacters(in: .whitespaces) })
                continue
            }
            flushTable()
            if line.isEmpty { append(out, "", font: .systemFont(ofSize: 7), color: dim, spacing: 0); continue }
            if let (level, text) = heading(line) {
                let size: CGFloat = level == 1 ? 19 : level == 2 ? 16 : 14
                append(out, text, font: .systemFont(ofSize: size, weight: .semibold), color: ink, spacing: level <= 2 ? 6 : 3, before: level <= 2 ? 10 : 6)
            } else if line == "---" || line == "***" {
                append(out, String(repeating: "─", count: 40), font: .systemFont(ofSize: 10), color: faint, spacing: 4)
            } else if let (indent, text) = bullet(raw) {
                append(out, "•  " + text, font: .systemFont(ofSize: 13), color: ink, spacing: 3, indent: 10 + CGFloat(indent) * 14, hanging: 14, inline: true)
            } else if let (n, text) = numbered(raw) {
                append(out, "\(n)  " + text, font: .systemFont(ofSize: 13), color: ink, spacing: 3, indent: 10, hanging: 20, inline: true)
            } else if line.hasPrefix(">") {
                append(out, String(line.dropFirst()).trimmingCharacters(in: .whitespaces), font: .systemFont(ofSize: 13), color: dim, spacing: 3, indent: 12, inline: true)
            } else {
                append(out, line, font: .systemFont(ofSize: 13), color: ink, spacing: 4, inline: true)
            }
        }
        flushTable()
        return out
    }

    private static func heading(_ s: String) -> (Int, String)? {
        guard s.hasPrefix("#") else { return nil }
        let hashes = s.prefix { $0 == "#" }
        guard hashes.count <= 6, s.dropFirst(hashes.count).hasPrefix(" ") else { return nil }
        return (hashes.count, s.dropFirst(hashes.count).trimmingCharacters(in: .whitespaces))
    }

    private static func bullet(_ raw: String) -> (Int, String)? {
        let spaces = raw.prefix { $0 == " " }.count
        let rest = raw.dropFirst(spaces)
        guard let f = rest.first, "-*•".contains(f), rest.dropFirst().first == " " else { return nil }
        return (spaces / 2, rest.dropFirst(2).trimmingCharacters(in: .whitespaces))
    }

    private static func numbered(_ raw: String) -> (String, String)? {
        let t = raw.trimmingCharacters(in: .whitespaces)
        let digits = t.prefix { $0.isNumber }
        guard !digits.isEmpty, digits.count <= 2, let sep = t.dropFirst(digits.count).first, ".)".contains(sep), t.dropFirst(digits.count + 1).first == " " else { return nil }
        return ("\(digits)\(sep)", t.dropFirst(digits.count + 2).trimmingCharacters(in: .whitespaces))
    }

    private static func append(_ out: NSMutableAttributedString, _ text: String, font: NSFont, color: NSColor, spacing: CGFloat, before: CGFloat = 0, indent: CGFloat = 0, hanging: CGFloat = 0, inline: Bool = false) {
        let p = NSMutableParagraphStyle()
        p.paragraphSpacing = spacing; p.paragraphSpacingBefore = before
        p.firstLineHeadIndent = indent; p.headIndent = indent + hanging
        p.lineSpacing = 2
        let base: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: p]
        let piece = inline ? Self.inline(text, base: base, font: font) : NSMutableAttributedString(string: text, attributes: base)
        out.append(piece)
        out.append(NSAttributedString(string: "\n", attributes: base))
    }

    /// **bold**, *italic* / _italic_ and `code` inside a line.
    static func inline(_ text: String, base: [NSAttributedString.Key: Any], font: NSFont) -> NSMutableAttributedString {
        let out = NSMutableAttributedString()
        let pattern = try! NSRegularExpression(pattern: "\\*\\*(.+?)\\*\\*|`([^`]+)`|(?<![\\w*])\\*([^*\\s][^*]*?)\\*(?![\\w*])|(?<![\\w_])_([^_\\s][^_]*?)_(?![\\w_])")
        let ns = text as NSString
        var last = 0
        for m in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            if m.range.location > last { out.append(NSAttributedString(string: ns.substring(with: NSRange(location: last, length: m.range.location - last)), attributes: base)) }
            var attrs = base
            let manager = NSFontManager.shared
            if m.range(at: 1).location != NSNotFound { attrs[.font] = manager.convert(font, toHaveTrait: .boldFontMask); out.append(NSAttributedString(string: ns.substring(with: m.range(at: 1)), attributes: attrs)) }
            else if m.range(at: 2).location != NSNotFound { attrs[.font] = NSFont.monospacedSystemFont(ofSize: font.pointSize - 1, weight: .regular); attrs[.backgroundColor] = NSColor(white: 1, alpha: 0.07); out.append(NSAttributedString(string: ns.substring(with: m.range(at: 2)), attributes: attrs)) }
            else { let r = m.range(at: 3).location != NSNotFound ? m.range(at: 3) : m.range(at: 4); attrs[.font] = manager.convert(font, toHaveTrait: .italicFontMask); out.append(NSAttributedString(string: ns.substring(with: r), attributes: attrs)) }
            last = m.range.location + m.range.length
        }
        if last < ns.length { out.append(NSAttributedString(string: ns.substring(from: last), attributes: base)) }
        return out
    }
}
