# DMG Mode

A Chrome and Firefox extension that makes any web page look like it's running on a Game Boy: every pixel snaps to one of four shades, with pixel fonts and chunky pixelated images.

Free and open source. Collects nothing, makes no network requests, runs no remote code. [Read the source](https://github.com/Zapskii/dmg-mode).

## Features (v0.1, MVP)

Out of the box, DMG Mode pixelates images, switches text to the Pixelify Sans pixel font, and stays on as the tab browses. Each one can be turned off in the popup.

- Every pixel on the page snapped to a 4-shade palette: **DMG pea-green**, **Pocket grey**, **Greyscale**
- Brightness and contrast sliders, plus an invert option for dark sites
- **Pixelate images**: chunky 2–12 px blocks on images, video, canvases and CSS background images; text stays sharp
- **Text font**: swap page text to a bundled pixel font, either Pixelify Sans (readable) or Press Start 2P (classic 8×8 arcade); icon fonts are left alone
- `Alt+Shift+G` toggles the current tab (rebind at `chrome://extensions/shortcuts` in Chrome, or
  `about:addons` → gear → **Manage Extension Shortcuts** in Firefox)
- Popup with live settings; settings sync across your browser installs
- **Stay on as this tab browses**: once switched on, DMG Mode follows the tab to new pages and sites until you turn it off
- "Remember for this site" auto-applies on future visits

Both of the last two need your browser's "all sites" access. The extension asks for it the first time you press **Turn on** (or tick either box); without it, DMG Mode only touches the page you switched it on for.

Coming in v1: LCD dot grid, whole-page pixelation, dither, SGB-style borders, snapshot and share.

## Install (development)

```
git clone https://github.com/Zapskii/dmg-mode.git
```

Chrome/Edge:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the **`extension/`** folder inside the repo.
3. Pin DMG Mode to the toolbar, open any page, and press `Alt+Shift+G` (or use the popup).

Firefox (`extension/` carries the Chrome manifest, which Firefox can't load — build the Firefox copy first):

1. `./build.sh` writes `dist/firefox-unpacked/`, the same files with `manifest.firefox.json` merged over `manifest.json`.
2. Open `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on…**, and pick `dist/firefox-unpacked/manifest.json`.

Test against `test/pages/fixture.html` (palette, pixelation, tall pages) and `test/pages/fonts.html` (pixel fonts). Serve the repo over HTTP — `python3 -m http.server` at the repo root, then open `http://localhost:8000/test/pages/fixture.html`. The extension doesn't request file:// access.

## Build the store package

```
./build.sh
```

This writes two zips: `dist/dmg-mode-<version>.zip` for the Chrome Web Store, and
`dist/dmg-mode-firefox-<version>.zip` for addons.mozilla.org (the same files with
`manifest.firefox.json` merged over `manifest.json`). Only `extension/` ships; docs, tests and this
README stay out of the package.

CI validates both manifests and the palettes, syntax-checks the scripts, builds both packages and
lints the Firefox one with `web-ext`. Pushing a `v*` tag publishes a GitHub release with both zips attached.

The end-to-end checks need Selenium and a real Firefox:

```
python3 -m pip install selenium pillow
python3 test/e2e/firefox.py               # fixture pages, served locally
python3 test/e2e/firefox.py --real-sites  # also BBC News, eBay, the Guardian, LinkedIn
```

## How it works

`extension/src/content.js` adds one inline SVG filter to the page. It applies the filter as a `backdrop-filter` on a fixed, click-through overlay the size of the viewport:

1. `feComponentTransfer` (linear): brightness, contrast, invert
2. `feColorMatrix`: luminance into R, G and B
3. `feComponentTransfer` (discrete): each channel snaps to the palette's 4 values, so every pixel is an exact palette colour

Because only what's on screen is filtered, page length doesn't matter and page layout is untouched. Fixed and sticky elements, and iframes, are recoloured too. (An earlier version filtered `<html>` directly. Chrome gives up on that for very tall pages such as eBay search results, which showed as a plain green screen.)

Firefox can't use that method: it ignores `backdrop-filter: url()` and `filter: url()` on `<html>`, and a
filter on `<body>` makes fixed elements scroll with the page. So in Firefox the filter goes on the page's
elements instead, stepping down past any element that contains a `position: fixed` element so each fixed
element is filtered on its own and stays pinned; the elements that step down get their background colour
mapped to the palette in place of the filter.

Known gaps in both browsers: elements in the browser's top layer (fullscreen video, modal `<dialog>`s)
keep their normal colours. In Firefox, text and background images painted directly by one of the
unfiltered wrapper elements stay in colour.

## Layout

## Layout

```
extension/            everything that ships (load this folder unpacked)
  manifest.json
  src/
    background.js     service worker: shortcut, per-tab state, tab mode, per-site auto-apply
    content.js        palette overlay, image pixelation, pixel fonts
    settings.js       shared defaults
    popup/            popup UI
  palettes/           one JSON file per palette + index.json
  assets/             icons, fonts/ (bundled pixel fonts + licences)
docs/SPEC.md          product spec (snapshot of the online doc)
manifest.firefox.json Firefox-only manifest keys, merged over extension/manifest.json at build time
test/pages/           fixture pages for manual and automated testing
test/e2e/firefox.py   Selenium end-to-end checks for the Firefox build
build.sh              builds both store zips into dist/
```

## Adding a palette

Add `extension/palettes/<id>.json` and list the id in `extension/palettes/index.json`:

```json
{
  "id": "dmg",
  "name": "DMG pea-green",
  "colors": ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  "author": "Your name",
  "license": "CC-BY-4.0"
}
```

Colours go darkest first, with exactly 4 per palette. Art and palettes are CC-BY 4.0.

## Support

DMG Mode is free. If you enjoy it, you can [buy me a coffee](https://buymeacoffee.com/zapski).

## Licence

Code: MIT (see `LICENSE`). Palettes and art: CC-BY 4.0.

Bundled fonts, both under the SIL Open Font License 1.1 (licence texts in `extension/assets/fonts/`):
- Press Start 2P, © 2012 The Press Start 2P Project Authors (CodeMan38)
- Pixelify Sans, © 2021 The Pixelify Sans Project Authors

Not affiliated with or endorsed by Nintendo. "Game Boy" is a trademark of Nintendo, used here descriptively.
