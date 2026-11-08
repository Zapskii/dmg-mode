#!/usr/bin/env bash
# Build the Chrome Web Store package: zips the contents of extension/ into dist/.
set -euo pipefail
cd "$(dirname "$0")"

version=$(grep -m1 '"version"' extension/manifest.json | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')
out="dist/dmg-mode-${version}.zip"

mkdir -p dist
rm -f "$out"
(cd extension && zip -r -X -q "../$out" . -x '*.DS_Store' -x '*/.DS_Store')

echo "Built $out ($(du -h "$out" | cut -f1))"
