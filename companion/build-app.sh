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
# Sign with the same certificate every time: macOS ties the Accessibility / Input Monitoring permission to the signature, and an
# ad-hoc one changes with every build (so the permission was lost on each rebuild). The certificate lives in its own keychain,
# made once by sign-setup.sh.
ID="Webs Companion Dev"
KC="$HOME/Library/Keychains/webs-companion-signing.keychain-db"
if [ -f "$KC" ] && security unlock-keychain -p "" "$KC" 2>/dev/null && security find-identity -p codesigning "$KC" | grep -q "\"$ID\""; then
  codesign --force --sign "$ID" --keychain "$KC" --identifier app.webs.companion "$APP"
  echo "Signed with \"$ID\""
else
  codesign --force --sign - "$APP" 2>/dev/null || true
  echo "No \"$ID\" certificate (run companion/sign-setup.sh once): signed ad-hoc, so the key permission will need granting again after this build."
fi
echo "Built $APP"
