#!/usr/bin/env node
// Prints the Firefox manifest: extension/manifest.json overlaid with manifest.firefox.json.
// Top-level keys in the overlay replace the Chrome ones; null removes a key.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

function firefoxManifest() {
  const m = { ...read('extension/manifest.json'), ...read('manifest.firefox.json') };
  for (const k of Object.keys(m)) if (m[k] === null) delete m[k];
  return m;
}

module.exports = { firefoxManifest };
if (require.main === module) process.stdout.write(JSON.stringify(firefoxManifest(), null, 2) + '\n');
