# CLAUDE.md — DMG Mode

Chrome extension (Manifest V3) that redraws any web page in 4 shades, like a classic handheld LCD. Free, open source (MIT code, CC-BY 4.0 palettes/art), Chrome-only at launch.

- Repo: https://github.com/Zapskii/dmg-mode
- Spec: `docs/SPEC.md` (snapshot of the online spec; requirement IDs like PAL-1, LCD-5 come from there)
- Owner: Zapski. Support link: https://buymeacoffee.com/zapski

## Layout

```
extension/            everything that ships; load this folder unpacked in chrome://extensions
  manifest.json
  src/background.js   service worker: shortcut, per-tab on/off state, tab mode, per-site auto-apply
  src/content.js      palette overlay, image + CSS-background pixelation, pixel fonts
  src/settings.js     shared defaults (DMG_DEFAULTS) + dmgIsRestricted(); used by worker and popup
  src/popup/          popup UI (html/css/js)
  palettes/           one JSON per palette + index.json (darkest colour first, exactly 4)
  assets/             icons; fonts/ = bundled OFL pixel fonts + licence texts
docs/SPEC.md          product spec
test/pages/           fixture pages: fixture.html (palette, pixelation, fixed/sticky, iframe, canvas), fonts.html (pixel fonts, strict font CSP, icon-font stand-ins)
build.sh              zips extension/ into dist/dmg-mode-<version>.zip for the Chrome Web Store
```

Only `extension/` ships. Never add docs, tests or tooling inside it.

## Conventions

- Plain JavaScript, no framework, no bundler, no build step for the extension itself. Keep it that way unless asked.
- Content scripts can't load `settings.js`; they read resolved settings from `chrome.storage.sync` and fall back to `FALLBACK` in `content.js`. If you add a setting, add its default to `DMG_DEFAULTS` and handle it being missing in `content.js`. Stored values are untrusted: validate palette colours (`#rrggbb`) and clamp numeric ranges before use.
- Every DOM change the content script makes must be undone on toggle-off: no leftover elements, attributes, inline custom properties or styles (CTL-7).
- Build SVG with `createElementNS`, never `innerHTML` (pages with Trusted Types CSP).
- No network requests, analytics or remote code (NFR-6). Fonts and palettes are bundled.
- Bump `version` in `extension/manifest.json` for each release; `build.sh` reads it.
- Trademarks: never use "Game Boy", "Nintendo" or console logos in the name, icon, UI or store listing. "DMG" is fine as a descriptive word. All art must be original or openly licensed.
- Attribution: the public name is **Zapski** (GitHub `Zapskii`). Never use a real name in code, palette `author` fields, commits, UI or store text; commit as the GitHub noreply address.
- UK English in user-facing text.

## How the effect works (and why)

1. **Palette:** one SVG filter (`#dmg-mode-filter`) applied as `backdrop-filter` on a fixed, `pointer-events:none`, max-z-index overlay (`#dmg-mode-overlay`), the last child of `<html>`. Pipeline: linear `feComponentTransfer` (brightness/contrast/invert) → luminance `feColorMatrix` → discrete `feComponentTransfer` whose `tableValues` are the palette channels.
   - **Do not go back to `filter` on `<html>`.** Chrome gives up on very tall pages (eBay search, ~20,000px ≈ 40,000 device px) and the filter receives an empty image, so the page shows as solid dark green. The backdrop only processes the viewport.
   - `color-interpolation-filters="sRGB"` is required.
   - Table values must be full precision (`n / 255`). Rounding to 4 decimals put every colour 1 step off the palette.
   - Known gap: top-layer elements (fullscreen video, modal `<dialog>`) render above the overlay and aren't recoloured.
2. **Image pixelation** (`#dmg-mode-pixelate`): `feFlood` dot → `feComposite` crop → `feTile` → `feComposite in` → `feMorphology dilate`. Dot size is 2 for even block sizes and 1 for odd, with radius `(size - dot) / 2`, so blocks are exactly `size` px. Overlapping blocks left 1px seams. Applied per element to `img, video, canvas`, so blocks align to each image's corner.
3. **CSS background images:** a throttled scan plus a `MutationObserver` marks elements with a `url()` background (`data-dmg-bg`). It skips form controls and anything under 24px in either direction.
   - `direct`: element has no content of its own → filter on the element.
   - `layer`: element has text on top → background moved to a filtered `::before` (values passed via `--dmg-bg-*` custom properties), `isolation:isolate`, `position:relative` only if it was static (`data-dmg-pos`). Elements already using `::before` are skipped.
4. **Pixel fonts:** Pixelify Sans and Press Start 2P (both SIL OFL 1.1), fetched from the extension and registered with the `FontFace` API so a page's `font-src` CSP can't block them. Press Start 2P uses `sizeAdjust: 68%` because it is very wide. Ligatures are off (broken "fi" glyphs). Icon fonts are excluded via `ICON_EXCLUDES`.

## State and permissions

- Per-tab on/off lives in `chrome.storage.session` (`on:<tabId>`); the badge shows "ON".
- Toolbar click opens the popup (Chrome can't both open a popup and toggle). `Alt+Shift+G` toggles directly.
- Install permissions: `activeTab`, `scripting`, `storage`. `*://*/*` (http/https only) is an **optional** host permission, needed for tab mode ("Stay on as this tab browses") and "Remember for this site", because `activeTab` access ends when the tab navigates. `file://` pages are not supported: no file host permission is requested.
- The permission prompt needs a user gesture in an extension page, so the popup requests it on the first **Turn on** (and when either checkbox is ticked). The keyboard shortcut can't request it.
- `minimum_chrome_version` is 130 because the font `web_accessible_resources` uses `use_dynamic_url` (so sites can't fingerprint the extension by its ID). Don't lower it.
- Tab mode re-injects on `tabs.onUpdated` 'loading' (with `injectImmediately`, to avoid a full-colour flash) and again on 'complete'. `content.js` ignores repeat injection and repeat "on" messages, and `keepOnTop()` moves the overlay back to the end of `<html>` after parsing.
- Current defaults: palette DMG, pixelate images on (4px), font Pixelify, tab mode on.

## Testing

- Manual: load `extension/` unpacked. Serve the repo over HTTP (`python3 -m http.server`) and open `test/pages/*.html` from `http://localhost:8000/...` — the extension doesn't request file:// access. Real-site checks so far: LinkedIn, BBC News, eBay (home and search results).
- Automated checks during development used Playwright with headless Chrome (`--headless=new`, `--load-extension`) against `test/pages`, served over HTTP. A test copy of the manifest added `host_permissions: ["<all_urls>"]` so `executeScript` works without a gesture. The checks:
  - every pixel is one of the 4 palette colours;
  - the fixed header stays pinned;
  - a 40,000px page still renders;
  - toggling off leaves nothing behind;
  - pixelation marks (`layer` / `direct` / skipped icon);
  - pixel fonts load under `font-src 'none'` and icon fonts are untouched;
  - tab mode survives cross-origin navigation;
  - popup defaults.

  These scripts are not in the repo yet; adding them under `test/e2e/` is a good next task.
- When testing, wait for the extension's default settings to be written before changing settings, or the test can race `onInstalled` and store partial settings.

## Backlog (see docs/SPEC.md for detail)

- v1: LCD dot grid (LCD-1), whole-page pixelation (LCD-2), pause pixelation while video plays (LCD-3), Bayer dither (PAL-5), SGB borders made with GB-SGB-Tooling (SGB-1..4, needs a spike on how to inset the page), snapshot and share (SHR-1), boot animation (SHR-2/3), more palettes (PAL-6).
- Repo: CI workflow (lint, validate palette/border JSON, build zip on `v*` tags), `CONTRIBUTING.md`, issue templates, `CREDITS.md`.
- Store: listing assets (icons done; screenshots, 440×280 promo tile), privacy statement, permission justifications.
