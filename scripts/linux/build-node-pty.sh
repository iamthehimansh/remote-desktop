#!/usr/bin/env bash
# Build the node-pty native addon for Linux and place it in prebuilds/linux-<arch>/
# so it coexists with the Windows prebuild already in node_modules (shared NTFS mount).
#
# node-pty's loader checks build/Release FIRST, then prebuilds/<platform>-<arch>.
# We put the compiled binary in prebuilds/linux-<arch>/ and keep build/ absent, so
# Windows keeps loading prebuilds/win32-x64 and Linux loads prebuilds/linux-<arch>.
#
# IMPORTANT: we compile in a TEMP dir on the local filesystem. The NTFS fuse mount
# (ntfs-3g) throws intermittent EIO under node-gyp's many small writes, so building
# in place on /mnt/winnvme is unreliable. We only copy the finished .node back.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PTY="$REPO/node_modules/node-pty"

if [ ! -d "$PTY" ]; then
  echo "ERROR: $PTY not found. Run 'bun install' / 'npm install' first." >&2
  exit 1
fi

ARCH="$(node -p 'process.arch')"
DEST="$PTY/prebuilds/linux-$ARCH"

loads_ok() { node -e 'require(process.argv[1])' "$PTY" >/dev/null 2>&1; }

# A stale Linux build/ would shadow the Windows prebuild — never leave one around.
rm -rf "$PTY/build"

# Fast path: a working prebuild is already in place.
if [ -f "$DEST/pty.node" ] && loads_ok; then
  echo "==> node-pty linux-$ARCH prebuild already present and loadable — nothing to do."
  ls -la "$DEST"
  exit 0
fi

echo "==> Compiling node-pty for linux-$ARCH (in a temp dir, off the NTFS mount)..."
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Copy only what node-gyp needs (NOT the whole dir — it may contain corrupt NTFS
# entries from interrupted builds, and a huge prebuilds/ we don't want).
mkdir -p "$TMP/node-pty/node_modules"
cp -r "$PTY/src" "$PTY/binding.gyp" "$PTY/package.json" "$TMP/node-pty/"
# node-addon-api is header-only; give the temp build a local copy so binding.gyp's
# require('node-addon-api') resolves without touching the NTFS tree for writes.
cp -r "$REPO/node_modules/node-addon-api" "$TMP/node-pty/node_modules/"

( cd "$TMP/node-pty" && rm -rf build && node-gyp rebuild )

if [ ! -f "$TMP/node-pty/build/Release/pty.node" ]; then
  echo "ERROR: node-gyp build did not produce pty.node." >&2
  echo "       Ensure build-essential + python3 are installed." >&2
  exit 1
fi

cp -f "$TMP/node-pty/build/Release/pty.node" "$DEST/"
rm -rf "$PTY/build"

if ! loads_ok; then
  echo "ERROR: node-pty still not loadable from $DEST" >&2
  exit 1
fi

echo "==> Done:"
ls -la "$DEST"
