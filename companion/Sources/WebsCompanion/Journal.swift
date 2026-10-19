import Foundation

/// Every use of the companion is appended here, one JSON object per line, so nothing is lost whether or not Webs is open.
/// Webs reads this file into its inbox.
enum Journal {
    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/Webs/Companion", isDirectory: true)
    }
    static var file: URL { directory.appendingPathComponent("journal.jsonl") }
    static var log: URL { directory.appendingPathComponent("spike.log") }

    private static let queue = DispatchQueue(label: "webs.companion.journal")

    static func append(mode: String, action: String, label: String, text: String, source: [String: String]) {
        let entry: [String: Any] = [
            "id": UUID().uuidString,
            "at": ISO8601DateFormatter().string(from: Date()),
            "mode": mode,
            "action": action,
            "label": label,
            "text": text,
            "source": source,
            "status": "queued",
        ]
        write(entry, to: file)
    }

    /// Diagnostics for the gesture spike: what was seen, in order.
    static func trace(_ message: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date()))  \(message)\n"
        queue.async {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if let data = line.data(using: .utf8) {
                if let h = try? FileHandle(forWritingTo: log) { h.seekToEndOfFile(); h.write(data); try? h.close() }
                else { try? data.write(to: log) }
            }
        }
    }

    private static func write(_ entry: [String: Any], to url: URL) {
        queue.async {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            guard let data = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]) else { return }
            var line = data
            line.append(0x0A)
            if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(line); try? h.close() }
            else { try? line.write(to: url) }
        }
    }
}
