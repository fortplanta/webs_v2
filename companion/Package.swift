// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "WebsCompanion",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "WebsCompanion", path: "Sources/WebsCompanion"),
    ]
)
