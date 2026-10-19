import Foundation

/// The wheels, read from the same catalog the Webs engine uses (skills/catalog.json), so what you see here is exactly what
/// runs. Change the catalog and rebuild; nothing about the wheels is hard-coded in the app.
struct Catalog: Decodable {
    struct Mode: Decodable { let title: String; let tagline: String; let skills: [String]?; let cascade: String?; let keeps: [String]? }
    struct WheelEntry: Decodable { let id: String; let label: String }
    struct Cascade: Decodable { let name: String; let wheel: [WheelEntry] }
    struct Keep: Decodable { let label: String; let hint: String }

    let modes: [String: Mode]
    let cascades: [String: Cascade]
    let keeps: [String: Keep]

    /// The folder holding catalog.json and the skill files: inside the app, else the repo's skills/ next to it.
    static var directory: URL? {
        let fm = FileManager.default
        var candidates: [URL] = []
        if let r = Bundle.main.resourceURL { candidates.append(r.appendingPathComponent("skills")) }
        if let env = ProcessInfo.processInfo.environment["WEBS_SKILLS_DIR"] { candidates.append(URL(fileURLWithPath: env)) }
        candidates.append(URL(fileURLWithPath: fm.currentDirectoryPath).appendingPathComponent("skills"))
        candidates.append(fm.homeDirectoryForCurrentUser.appendingPathComponent("Projects/webs_v2/skills"))
        return candidates.first { fm.fileExists(atPath: $0.appendingPathComponent("catalog.json").path) }
    }

    static func load() -> Catalog? {
        guard let dir = directory, let data = try? Data(contentsOf: dir.appendingPathComponent("catalog.json")) else { return nil }
        return try? JSONDecoder().decode(Catalog.self, from: data)
    }

    /// A skill's wheel label: the `name:` line of its front matter.
    static func skillName(_ id: String) -> String {
        guard let dir = directory, let text = try? String(contentsOf: dir.appendingPathComponent("\(id).md"), encoding: .utf8) else { return id }
        for line in text.split(separator: "\n").prefix(8) where line.hasPrefix("name:") { return line.dropFirst(5).trimmingCharacters(in: .whitespaces) }
        return id
    }

    /// The wheel for a combination of modifiers, if the catalog has one.
    func wheel(for mods: Set<Modifier>) -> WheelSpec? {
        let key = Modifier.key(mods)
        guard let mode = modes[key] else { return nil }
        let segments: [Segment]
        if let skills = mode.skills { segments = skills.map { Segment(id: $0, label: Catalog.skillName($0)) } }
        else if let c = mode.cascade, let cascade = cascades[c] { segments = cascade.wheel.map { Segment(id: $0.id, label: $0.label) } }
        else if let keeps = mode.keeps { segments = keeps.map { Segment(id: $0, label: self.keeps[$0]?.label ?? $0) } }
        else { return nil }
        return WheelSpec(key: key, glyphs: Modifier.glyphs(mods), title: mode.title, tagline: mode.tagline, segments: segments)
    }
}
