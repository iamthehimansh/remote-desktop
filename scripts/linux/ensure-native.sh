#!/usr/bin/env bash
# Ensure the platform-specific native packages for BOTH Windows and Linux are
# present in the shared node_modules — WITHOUT running `npm install`/`bun install`,
# which prune the "other" platform's optional deps and would break the other OS.
#
# We add only what's missing, by downloading the package tarball with `npm pack`
# and extracting it in place. Safe and idempotent.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

ver_of() { node -p "require('$1/package.json').version" 2>/dev/null || true; }

# esbuild version (used by tsx to run the TS servers)
ESBUILD_VER="$(ver_of esbuild)"
# next SWC version — take it from whichever @next/swc-* is already installed
# (the next package's own version can differ from its swc binary version).
SWC_VER=""
for d in node_modules/@next/swc-*; do
  [ -f "$d/package.json" ] && { SWC_VER="$(node -p "require('./$d/package.json').version")"; break; }
done
[ -z "$SWC_VER" ] && SWC_VER="$(ver_of next)"

ensure_pkg() {  # $1=npm-name  $2=version
  local name="$1" ver="$2" dir
  dir="node_modules/$1"
  if [ -z "$ver" ]; then echo "  skip $name (no version resolved)"; return; fi
  if [ -f "$dir/package.json" ]; then echo "  ok   $name@$ver"; return; fi
  local tgz
  tgz="$(cd /tmp && npm pack "${name}@${ver}" --silent 2>/dev/null || true)"
  if [ -z "$tgz" ] || [ ! -f "/tmp/$tgz" ]; then
    echo "  WARN could not download $name@$ver (continuing)"; return
  fi
  rm -rf /tmp/_ensure_ex && mkdir -p /tmp/_ensure_ex
  tar -xzf "/tmp/$tgz" -C /tmp/_ensure_ex
  mkdir -p "$dir"
  cp -a /tmp/_ensure_ex/package/. "$dir/"
  rm -f "/tmp/$tgz"; rm -rf /tmp/_ensure_ex
  echo "  add  $name@$ver"
}

echo "  next swc version: ${SWC_VER:-?}   esbuild version: ${ESBUILD_VER:-?}"
# Linux runtime needs these:
ensure_pkg "@next/swc-linux-x64-gnu" "$SWC_VER"
ensure_pkg "@esbuild/linux-x64"      "$ESBUILD_VER"
# Keep Windows working too:
ensure_pkg "@next/swc-win32-x64-msvc" "$SWC_VER"
ensure_pkg "@esbuild/win32-x64"       "$ESBUILD_VER"
