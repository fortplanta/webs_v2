#!/bin/sh
# Build "Webs Companion.app" (a menu-bar agent) next to this script.
set -eu
cd "$(dirname "$0")"
swift build -c release --arch arm64
APP="Webs Companion.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/arm64-apple-macosx/release/WebsCompanion "$APP/Contents/MacOS/WebsCompanion"
# the wheels and what they run are the same files the Webs engine reads
mkdir -p "$APP/Contents/Resources"
cp -R ../skills "$APP/Contents/Resources/skills"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>app.webs.companion</string>
  <key>CFBundleName</key><string>Webs Companion</string>
  <key>CFBundleExecutable</key><string>WebsCompanion</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP" 2>/dev/null || true
echo "Built $APP"
