#!/usr/bin/env bash
# Build the store packages: zips extension/ into dist/ for Chrome, and again with
# the Firefox manifest (manifest.json overlaid with manifest.firefox.json) for AMO.
set -euo pipefail
cd "$(dirname "$0")"

version=$(grep -m1 '"version"' extension/manifest.json | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')
out="dist/dmg-mode-${version}.zip"
ffout="dist/dmg-mode-firefox-${version}.zip"

mkdir -p dist
rm -f "$out" "$ffout"
(cd extension && zip -r -X -q "../$out" . -x '*.DS_Store' -x '*/.DS_Store')
echo "Built $out ($(du -h "$out" | cut -f1))"

# Firefox: same files, merged manifest. Top-level keys in the overlay replace the
# Chrome ones; a null value removes the key.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -R extension/. "$tmp"
node test/firefox-manifest.js > "$tmp/manifest.json"
(cd "$tmp" && zip -r -X -q "$OLDPWD/$ffout" . -x '*.DS_Store' -x '*/.DS_Store')
echo "Built $ffout ($(du -h "$ffout" | cut -f1))"

# Unpacked Firefox build, for about:debugging (extension/ itself carries the
# Chrome manifest, which Firefox can't load: no background.service_worker).
rm -rf dist/firefox-unpacked
cp -R "$tmp" dist/firefox-unpacked
echo "Built dist/firefox-unpacked (Load Temporary Add-on -> manifest.json)"
