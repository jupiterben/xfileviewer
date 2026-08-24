#!/usr/bin/env bash
# Bump version files, commit, tag, and push to trigger the Release workflow.
# Usage:
#   npm run release              # bump patch (0.1.0 -> 0.1.1)
#   npm run release -- minor     # bump minor (0.1.0 -> 0.2.0)
#   npm run release -- major     # bump major (0.1.0 -> 1.0.0)
#   npm run release -- 0.3.0     # set exact version
#   ./scripts/release-tag.sh [patch|minor|major|<version>]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUMP="${1:-patch}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit or stash changes before releasing." >&2
  git status --short
  exit 1
fi

CURRENT="$(node -p "require('./package.json').version")"
CORE_CURRENT="${CURRENT%%[-+]*}"

if [[ ! "$CORE_CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Current version is not semver X.Y.Z: $CURRENT" >&2
  exit 1
fi

IFS=. read -r MAJOR MINOR PATCH <<<"$CORE_CURRENT"

case "$BUMP" in
  patch)
    VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
    ;;
  minor)
    VERSION="$MAJOR.$((MINOR + 1)).0"
    ;;
  major)
    VERSION="$((MAJOR + 1)).0.0"
    ;;
  v*[0-9].*[0-9].*[0-9]*|*[0-9].*[0-9].*[0-9]*)
    VERSION="${BUMP#v}"
    if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]]; then
      echo "Invalid version: $BUMP (expected patch|minor|major|0.2.0)" >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 [patch|minor|major|<version>]" >&2
    echo "Default: patch" >&2
    exit 1
    ;;
esac

TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag already exists: $TAG" >&2
  exit 1
fi

if [[ "$CURRENT" == "$VERSION" ]]; then
  echo "Version is already $VERSION" >&2
  exit 1
fi

echo "Bumping version: $CURRENT -> $VERSION"

VERSION="$VERSION" node <<'EOF'
const fs = require('fs');
const version = process.env.VERSION;

const packagePath = 'package.json';
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

const tauriPath = 'src-tauri/tauri.conf.json';
const tauriJson = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
tauriJson.version = version;
fs.writeFileSync(tauriPath, JSON.stringify(tauriJson, null, 2) + '\n');

const cargoPath = 'src-tauri/Cargo.toml';
const cargo = fs.readFileSync(cargoPath, 'utf8');
const updated = cargo.replace(
  /^(\[package\]\n(?:(?!^\[).*\n)*?)version = "[^"]*"/m,
  `$1version = "${version}"`
);
if (updated === cargo) {
  console.error('Failed to update version in src-tauri/Cargo.toml');
  process.exit(1);
}
fs.writeFileSync(cargoPath, updated);

const lockPath = 'src-tauri/Cargo.lock';
const lock = fs.readFileSync(lockPath, 'utf8');
const lockUpdated = lock.replace(
  /(\[\[package\]\]\nname = "xfileviewer"\nversion = ")[^"]+(")/,
  `$1${version}$2`
);
if (lockUpdated === lock) {
  console.error('Failed to update version in src-tauri/Cargo.lock');
  process.exit(1);
}
fs.writeFileSync(lockPath, lockUpdated);
EOF

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
TAURI_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
CARGO_VERSION="$(sed -n '/^\[package\]/,/^\[/{s/^version = "\([^"]*\)"/\1/p;}' src-tauri/Cargo.toml | head -n 1)"

for candidate in "$PACKAGE_VERSION" "$TAURI_VERSION" "$CARGO_VERSION"; do
  if [[ "$candidate" != "$VERSION" ]]; then
    echo "Version mismatch after update: package=$PACKAGE_VERSION tauri=$TAURI_VERSION cargo=$CARGO_VERSION" >&2
    exit 1
  fi
done

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "release: $TAG"
git tag "$TAG"
echo "Created tag $TAG"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push origin "HEAD"
git push origin "$TAG"

echo "Pushed $BRANCH and $TAG. GitHub Actions Release workflow should start shortly."
