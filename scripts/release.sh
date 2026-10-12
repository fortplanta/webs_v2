#!/bin/sh
# Build the app and publish it as a GitHub Release, which installed copies of Webs pick up as an update.
#
#   npm run release            # release the version already in package.json
#   npm run release -- patch   # bump first (patch | minor | major), commit, push, then release
#
# Needs: the GitHub CLI (`gh`, logged in), a clean working tree on main, and a public repo (the app downloads
# release files without logging in).
set -eu
cd "$(dirname "$0")/.."

BUMP="${1:-}"
[ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first." >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Release from main." >&2; exit 1; }

npm run typecheck
npm test

if [ -n "$BUMP" ]; then
  npm version "$BUMP" --no-git-tag-version >/dev/null
  git add package.json package-lock.json
  git commit -q -m "Release v$(node -p "require('./package.json').version")"
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
if git rev-parse "$TAG" >/dev/null 2>&1 || gh release view "$TAG" >/dev/null 2>&1; then
  echo "$TAG already exists. Bump the version (npm run release -- patch)." >&2
  exit 1
fi

git push -q origin main
npm run dist

FILES="release/Webs-$VERSION-arm64-mac.zip release/Webs-$VERSION-arm64.dmg release/latest-mac.yml"
for f in $FILES; do [ -f "$f" ] || { echo "Missing $f — the build didn't produce it." >&2; exit 1; }; done

# shellcheck disable=SC2086
gh release create "$TAG" $FILES --target "$(git rev-parse HEAD)" --title "Webs $VERSION" --generate-notes
echo "Released $TAG. Running copies of Webs will offer it on their next check."
