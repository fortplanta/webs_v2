import Foundation

/// A modifier tapped during a drag. Taps that land together (within a moment of each other) are one chord: ⇧⌘, ⌘⌃, ⇧⌃, ⇧⌘⌃.
enum Modifier: String, CaseIterable {
    case shift, command, control

    var glyph: String {
        switch self { case .shift: return "⇧"; case .command: return "⌘"; case .control: return "⌃" }
    }

    /// The name the catalog uses for a set of modifiers: always in the order shift, command, control.
    static func key(_ mods: Set<Modifier>) -> String { allCases.filter { mods.contains($0) }.map(\.rawValue).joined(separator: "+") }
    /// With a wheel open, each key tapped flips that key in or out of the combination (⇧ open, tap ⌘ → ⇧⌘, tap ⇧ → ⌘), so one
    /// drag can walk through every wheel. Taps that land together flip together. Nothing left means the wheel closes.
    static func toggled(_ shown: Set<Modifier>, _ taps: Set<Modifier>) -> Set<Modifier> { shown.symmetricDifference(taps) }
    static func glyphs(_ mods: Set<Modifier>) -> String { allCases.filter { mods.contains($0) }.map(\.glyph).joined() }
}

struct Segment: Equatable {
    let id: String
    let label: String
}

/// One wheel: what the modifier combination is called and what is on it.
struct WheelSpec {
    let key: String
    let glyphs: String
    let title: String
    let tagline: String
    let segments: [Segment]
}
