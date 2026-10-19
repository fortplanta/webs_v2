import AppKit
import Foundation

/// What the Webs engine sends back for a run, one event per line.
enum EngineEvent {
    case accepted(id: String)
    case start(title: String, steps: Int)
    case status(String)
    case section(id: String, title: String)
    case text(String)
    case sectionEnd(String)
    case done(title: String, markdown: String)
    case kept(label: String)
    case error(String)

    init?(json: [String: Any]) {
        switch json["type"] as? String {
        case "accepted": self = .accepted(id: json["id"] as? String ?? "")
        case "start": self = .start(title: json["title"] as? String ?? "", steps: json["steps"] as? Int ?? 1)
        case "status": self = .status(json["message"] as? String ?? "")
        case "section": self = .section(id: json["id"] as? String ?? "", title: json["title"] as? String ?? "")
        case "text": self = .text(json["chunk"] as? String ?? "")
        case "section-end": self = .sectionEnd(json["id"] as? String ?? "")
        case "done": self = .done(title: json["title"] as? String ?? "", markdown: json["markdown"] as? String ?? "")
        case "kept": self = .kept(label: json["label"] as? String ?? "")
        case "error": self = .error(json["message"] as? String ?? "Something went wrong.")
        default: return nil
        }
    }
}

struct EngineError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// The Webs app, running quietly in the background, does the thinking: long answers are written inside Webs, with the same
/// engine, voice and library as the canvas. The companion finds it through the endpoint file Webs writes, wakes it if it is
/// not running, and streams a run's events back.
final class Engine {
    struct Endpoint { let port: Int; let token: String; let pid: Int32 }

    private var endpointFile: URL { Journal.directory.appendingPathComponent("endpoint.json") }

    func endpoint() -> Endpoint? {
        guard let data = try? Data(contentsOf: endpointFile),
              let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let port = j["port"] as? Int, let token = j["token"] as? String, let pid = j["pid"] as? Int else { return nil }
        guard kill(Int32(pid), 0) == 0 else { return nil } // Webs quit without cleaning up
        return Endpoint(port: port, token: token, pid: Int32(pid))
    }

    private func request(_ e: Endpoint, _ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var r = URLRequest(url: URL(string: "http://127.0.0.1:\(e.port)\(path)")!)
        r.httpMethod = method
        r.setValue("Bearer \(e.token)", forHTTPHeaderField: "Authorization")
        if let body { r.httpBody = body; r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        r.timeoutInterval = 10
        return r
    }

    func healthy() async -> Bool {
        guard let e = endpoint() else { return false }
        guard let (_, resp) = try? await URLSession.shared.data(for: request(e, "/health")) else { return false }
        return (resp as? HTTPURLResponse)?.statusCode == 200
    }

    /// Make sure Webs is up, starting it in the background (no window, no Dock icon) if it is not.
    func ensureRunning(progress: @escaping (String) -> Void) async throws -> Endpoint {
        if await healthy(), let e = endpoint() { return e }
        progress("Waking Webs…")
        let workspace = NSWorkspace.shared
        guard let url = workspace.urlForApplication(withBundleIdentifier: "com.webs.desktop") else {
            throw EngineError(message: "Webs isn't installed, or isn't running. Open Webs once, then try again.")
        }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        config.addsToRecentItems = false
        config.arguments = ["--background"]
        _ = try? await workspace.openApplication(at: url, configuration: config)
        for _ in 0..<60 { // up to ~15 s
            try? await Task.sleep(nanoseconds: 250_000_000)
            if await healthy(), let e = endpoint() { return e }
        }
        throw EngineError(message: "Webs didn't wake up in time. Open it and try again.")
    }

    /// Run an action. Cancelling the task closes the connection, which stops the run inside Webs.
    func run(id: String, mode: String, action: String, text: String, source: [String: String]) -> AsyncThrowingStream<EngineEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let e = try await self.ensureRunning { continuation.yield(.status($0)) }
                    let body = try JSONSerialization.data(withJSONObject: ["id": id, "mode": mode, "action": action, "text": text, "source": source])
                    var req = self.request(e, "/run", method: "POST", body: body)
                    req.timeoutInterval = 3600
                    let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                    guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw EngineError(message: "Webs refused the request.") }
                    for try await line in bytes.lines {
                        guard let data = line.data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let ev = EngineEvent(json: j) else { continue }
                        continuation.yield(ev)
                    }
                    continuation.finish()
                } catch is CancellationError { continuation.finish() }
                catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
