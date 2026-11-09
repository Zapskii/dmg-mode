#!/usr/bin/env node
// Validates the manifest and palette JSON. Run locally with `node test/validate.js`.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const palettesDir = path.join(root, 'extension/palettes');
let failed = false;

const fail = (msg) => { console.error(`FAIL: ${msg}`); failed = true; };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

// ---------- manifest ----------
const manifestFile = path.join(root, 'extension/manifest.json');
const manifest = readJson(manifestFile);
if (manifest.manifest_version !== 3) fail('manifest: manifest_version must be 3');
if (!manifest.name) fail('manifest: missing name');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) fail('manifest: version must be x.y.z');
for (const [size, file] of Object.entries(manifest.icons || {})) {
  if (!fs.existsSync(path.join(root, 'extension', file))) fail(`manifest: icon ${size} missing (${file})`);
}
for (const file of Object.values(manifest.action?.default_icon || {})) {
  if (!fs.existsSync(path.join(root, 'extension', file))) fail(`manifest: action icon missing (${file})`);
}

// ---------- Firefox manifest ----------
const ff = require('./firefox-manifest.js').firefoxManifest();
const gecko = ff.browser_specific_settings?.gecko || {};
if (!/^[\w.+-]+@[\w.-]+$/.test(gecko.id || '')) fail('firefox: gecko.id must look like name@domain');
if (!gecko.strict_min_version) fail('firefox: missing gecko.strict_min_version');
if (!gecko.data_collection_permissions) fail('firefox: missing gecko.data_collection_permissions (AMO requires it)');
if (ff.minimum_chrome_version) fail('firefox: minimum_chrome_version should be removed');
const bgScripts = ff.background?.scripts || [];
if (!bgScripts.length || ff.background.service_worker) fail('firefox: background must use scripts, not service_worker');
for (const f of bgScripts) {
  if (!fs.existsSync(path.join(root, 'extension', f))) fail(`firefox: background script missing (${f})`);
}
if (bgScripts.indexOf('src/settings.js') > bgScripts.indexOf('src/background.js')) fail('firefox: settings.js must load before background.js');

// ---------- palettes ----------
const index = readJson(path.join(palettesDir, 'index.json'));
if (!Array.isArray(index) || !index.length) fail('palettes: index.json must list at least one id');
else if (new Set(index).size !== index.length) fail('palettes: index.json has duplicate ids');

for (const id of Array.isArray(index) ? index : []) {
  const file = path.join(palettesDir, `${id}.json`);
  if (!fs.existsSync(file)) { fail(`palettes: ${id}.json is listed but missing`); continue; }
  const p = readJson(file);
  if (p.id !== id) fail(`palettes/${id}: id field is ${JSON.stringify(p.id)}`);
  if (!p.name) fail(`palettes/${id}: missing name`);
  if (!p.author) fail(`palettes/${id}: missing author`);
  if (!p.license) fail(`palettes/${id}: missing license`);
  if (!Array.isArray(p.colors) || p.colors.length !== 4) {
    fail(`palettes/${id}: colors must be exactly 4`);
    continue;
  }
  const bad = p.colors.filter((c) => !/^#[0-9a-f]{6}$/i.test(c));
  if (bad.length) { fail(`palettes/${id}: invalid colours ${bad.join(', ')}`); continue; }
  const lum = p.colors.map(luminance);
  for (let i = 1; i < lum.length; i++) {
    if (!(lum[i] > lum[i - 1])) {
      fail(`palettes/${id}: colours must go darkest first (luminance ${lum.map((v) => v.toFixed(1)).join(', ')})`);
    }
  }
}

for (const f of fs.readdirSync(palettesDir)) {
  if (f.endsWith('.json') && f !== 'index.json' && !(index || []).includes(f.slice(0, -5))) {
    fail(`palettes: ${f} is not listed in index.json`);
  }
}

if (failed) process.exit(1);
console.log(`OK: manifest ${manifest.version} (Chrome + Firefox), ${index.length} palettes`);
