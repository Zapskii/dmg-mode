# DMG Mode — Browser Extension Spec

## Overview

DMG Mode is a free, open-source Chrome extension that makes any web page look like it is running on an original handheld LCD. One click or one shortcut switches it on, and it switches off just as fast.

**What it does:** it snaps every pixel on the page to a 4-shade palette (pea-green DMG, Pocket grey or greyscale). Optional extras are an LCD dot grid, chunky pixelation, Bayer dither and an SGB-style decorative border. A snapshot button makes the result easy to share.

**Goals**

- Instant, reliable effect on most mainstream sites, with no page reload
- Fun enough that people screenshot and share it; the snapshot feature is the growth engine
- A small, readable codebase that the gbdev community can extend with palettes and borders
- Zero data collection

**Non-goals (launch)**

- Firefox, Safari or mobile browsers
- Paid tiers, accounts or a sync service
- Pixel-perfect emulation of real LCD response; the look is approximate by design
- Changing page layout, fonts or content (only how it is drawn)

**Decisions locked in**

| Decision | Choice | Consequence |
| --- | --- | --- |
| Licence model | Open source | Public GitHub repo; community palettes and borders arrive as pull requests |
| Pricing | Free | No payment code; every feature ships to everyone; optional donate link |
| Pixelation | Approximate | Viewport-aligned SVG block filter; slight shimmer on scroll is accepted |
| Browsers at launch | Chrome only | Chrome MV3 APIs used freely; Edge and Brave work via the Chrome Web Store |

## Scope and phasing

The work ships in three releases. The MVP proves the core palette effect is fast and reliable, v1 adds the effects people will share, and Later is a backlog ordered by user demand.

| MVP — first store release | v1 — the shareable release | Later — backlog |
| --- | --- | --- |
| 4-shade palette filter | LCD dot grid | Custom palette share codes |
| DMG, Pocket, greyscale | Whole-page pixelation | Custom border upload |
| Brightness, contrast, invert | Bayer dither | Per-site presets |
| Toolbar toggle + shortcut | SGB borders (6 to 10) | Element exclusions |
| Popup with live settings | Snapshot and share | Chiptune sounds, pixel font |
| Per-site memory | Boot animation | Firefox port |
| Pixelate images | Palette and border packs | |
| *Gate: MVP criteria pass* | *Gate: perf + inset spikes* | *Order set by user demand* |

v1 starts only once the MVP acceptance criteria pass and the performance and border-inset spikes are done (see Risks).

## Functional requirements

Each requirement has an ID for issues and PRs. The phase column says when it ships: MVP, v1 or Later.

### Palette rendering

| ID | Requirement | Phase |
| --- | --- | --- |
| PAL-1 | Every visible pixel (text, images, video, canvas, CSS backgrounds, SVG) is drawn in exactly 4 palette colours | MVP |
| PAL-2 | Built-in palettes: DMG pea-green (`#0f380f`, `#306230`, `#8bac0f`, `#9bbc0f` as the starting point), Pocket grey, pure greyscale | MVP |
| PAL-3 | Brightness and contrast sliders, applied before quantisation | MVP |
| PAL-4 | Invert toggle so dark-mode sites map to sensible shades | MVP |
| PAL-5 | Optional 4x4 Bayer ordered dither before quantisation | v1 |
| PAL-6 | Extra palettes loaded from the repo's `palettes/` folder (e.g. Light teal, 4-colour tints, a red joke palette) | v1 |
| PAL-7 | User-defined palette: 4 hex inputs, saved locally, exportable as a short share code | Later |

### Controls and settings

| ID | Requirement | Phase |
| --- | --- | --- |
| CTL-1 | Toolbar button opens the popup, which has a large on/off button (Chrome can't both toggle and open a popup from one click) | MVP |
| CTL-2 | Keyboard shortcut (default `Alt+Shift+G`, rebindable in `chrome://extensions/shortcuts`) | MVP |
| CTL-3 | Popup: on/off, palette picker, sliders, effect toggles; changes apply live | MVP |
| CTL-4 | Settings persist globally and sync; per-site memory only auto-enables the effect ("remember for this site") | MVP |
| CTL-5 | Toolbar icon reflects state (on/off) for the active tab | MVP |
| CTL-6 | Clear "can't run on this page" state on restricted pages (`chrome://`, Web Store, PDF viewer) | MVP |
| CTL-7 | Effect is removed cleanly on toggle-off: no leftover elements, styles or layout shift | MVP |
| CTL-8 | Per-site presets for heavy sites (YouTube, Reddit, GitHub) and per-element exclusions | Later |

### LCD effects

| ID | Requirement | Phase |
| --- | --- | --- |
| LCD-5 | Pixelate images: `img`, `video`, `canvas` and CSS background images, 2–12 px blocks, text stays sharp | MVP (shipped) |
| LCD-1 | Dot-matrix grid overlay; adjustable cell size (2–6 px) and opacity; never blocks clicks | v1 |
| LCD-2 | Approximate whole-page pixelation with a 2–8 px block slider; off by default | v1 |
| LCD-3 | Pixelation auto-pauses while a `<video>` is playing | v1 |
| LCD-4 | Optional ghosting on scroll and a subtle screen vignette | Later |

### SGB borders

| ID | Requirement | Phase |
| --- | --- | --- |
| SGB-1 | Decorative frame around the viewport; page content is inset so the border never covers it | v1 |
| SGB-2 | Ship 6–10 original borders made with GB-SGB-Tooling, exported as PNG | v1 |
| SGB-3 | "Authentic ratio" mode letterboxes content to 10:9 inside the frame | v1 |
| SGB-4 | Load extra borders from the repo's `borders/` folder | v1 |
| SGB-5 | Users can upload their own border PNG (stored locally) | Later |

### Sharing and delight

| ID | Requirement | Phase |
| --- | --- | --- |
| SHR-1 | Snapshot button: capture visible tab, composite the border, add a small "DMG Mode" watermark, download or copy to clipboard | v1 |
| SHR-2 | Boot animation on first toggle per tab: original logo drops in, optional "ding" (sound off by default) | v1 |
| SHR-3 | Watermark and boot animation can each be turned off | v1 |
| SHR-4 | Optional chiptune UI sounds and pixel-font swap | Later |

## Technical design

The whole effect is one SVG filter applied as a `backdrop-filter` on a fixed, click-through overlay the size of the viewport, injected on demand. No canvas re-rendering of the page and no build step are needed for the MVP.

### Components

- **Service worker (`background.js`):** handles the keyboard command and popup toggle requests, tracks per-tab on/off state in `storage.session`, injects the content script with `chrome.scripting`, shows an "ON" badge, and auto-applies on remembered sites. In v1 it also runs `captureVisibleTab` for snapshots.
- **Content script (`content.js`):** builds the SVG filters and the overlay; marks CSS background images for pixelation; listens to `chrome.storage.onChanged` so popup changes apply live; removes everything cleanly on toggle-off.
- **Popup (`popup.html/js`):** the toolbar button opens it. It has the on/off button and all settings, and writes settings to storage. It never talks to the page directly.
- **Offscreen document (`offscreen.html`, v1):** composites a snapshot with its border and watermark on a canvas and puts it on the clipboard.

### Repo layout

```
dmg-mode/
  extension/            # everything that ships; load unpacked in chrome://extensions
    manifest.json
    src/
      background.js     # service worker
      content.js        # SVG filter, overlay, pixelation, pixel fonts
      settings.js       # shared defaults + dmgIsRestricted()
      popup/            # popup.html, popup.css, popup.js
    palettes/           # *.json, one per palette + index.json
    assets/             # icons, OFL pixel fonts + licence texts
  docs/SPEC.md
  test/pages/           # local fixture pages (fixture.html, fonts.html)
  build.sh              # zips extension/ into dist/
  .github/workflows/release.yml   # planned (CI), not yet present
```

### Filter pipeline

The filter is injected once into the page as a zero-size inline `<svg>`. A `<div id="dmg-mode-overlay">` with `position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; backdrop-filter: url(#dmg-mode-filter)` is appended as the last child of `<html>`. The filter must use `color-interpolation-filters="sRGB"` or the shades come out wrong, and table values must be full-precision `n / 255` (rounding to 4 decimals put every colour 1 step off).

1. **Brightness / contrast** (`feComponentTransfer`, `type="linear"`): slope and intercept from the sliders; invert flips the slope.
2. **Dither** (v1, optional): a 4x4 Bayer tile via `feImage` + `feTile`, added to the image with `feComposite operator="arithmetic"`.
3. **Luminance** (`feColorMatrix`): each of R, G, B becomes `0.2126R + 0.7152G + 0.0722B`.
4. **Quantise to palette** (`feComponentTransfer`, `type="discrete"`): each channel's `tableValues` = that channel of the 4 palette colours, darkest first. Because the channels all hold the same luminance, every pixel lands on an exact palette colour.
5. **Whole-page pixelate** (v1, optional): the block trick below, applied to the backdrop instead of to images.

Example quantise step for the DMG palette:

```
<feComponentTransfer>
  <feFuncR type="discrete" tableValues="0.059 0.188 0.545 0.608"/>
  <feFuncG type="discrete" tableValues="0.220 0.384 0.675 0.737"/>
  <feFuncB type="discrete" tableValues="0.059 0.188 0.059 0.059"/>
</feComponentTransfer>
```

**Why a backdrop overlay, not `filter` on `<html>`:** the first build filtered the root element. Chrome rasterises a filtered element whole, and on very tall pages it gives up and the filter receives an empty image. An eBay search page is about 20,000px (about 40,000 device px at 2x), and it showed as a plain green screen. A backdrop filter only processes what is on screen, so page length doesn't matter. Page layout is never touched, and fixed elements and iframes underneath are recoloured too.

**Known gap:** elements in the browser's top layer (fullscreen video, modal `<dialog>`s) render above the overlay and keep their normal colours.

### Overlays

- **Palette overlay:** described above. It is always the topmost layer, so everything below, including the grid and border, is snapped to the palette.
- **Image pixelation (shipped in MVP):** a second SVG filter (`dmg-mode-pixelate`) samples one dot per block with `feFlood` + `feTile` + `feComposite`, then grows each dot into a square with `feMorphology dilate`. Dot and radius are chosen so blocks are exactly the chosen size; overlapping blocks left 1px seams. The filter is applied per element to `img`, `video` and `canvas`, so blocks line up with each image's corner and don't shimmer on scroll.
- **CSS background images:** a throttled scan (plus a `MutationObserver` for lazy-loaded content) finds elements whose computed `background-image` has a `url()`. It skips form controls and anything under 24px in either direction. An element with no content of its own gets the pixel filter directly. An element with text on top (a hero banner) has its background moved to a filtered `::before` layer behind the content, so the text stays sharp; elements that already use `::before` are skipped.
- **Grid (v1):** a fixed `pointer-events: none` div with `repeating-linear-gradient` lines, placed under the palette overlay so its lines are recoloured too.
- **Border (v1):** a fixed full-viewport image frame. The page is inset by padding the root and scaling content to fit the frame's inner window. The exact inset method (`zoom` vs `transform` vs padding) needs a spike: see Risks.

### Permissions

| Permission | Why | When requested |
| --- | --- | --- |
| `activeTab` | Inject into and capture the tab the user clicked on | Install |
| `scripting` | `executeScript` / `insertCSS` | Install |
| `storage` | Settings and per-site overrides | Install |
| `offscreen` | Snapshot compositing and clipboard (v1) | Install (v1) |
| `*://*/*` (optional host permission, http/https only) | Auto-apply on sites marked "remember for this site" without a click | Only when the user first turns on a per-site override |

No `tabs`, `history`, `webRequest` or remote code.

### Storage schema

Global settings live in `chrome.storage.sync` (small, syncs across the user's Chrome installs). Per-site overrides and custom borders live in `chrome.storage.local`, because sync has a ~100 KB total quota.

```
// storage.sync
{
  "version": 1,
  "palette": "dmg",
  "brightness": 0, "contrast": 0, "invert": false,
  "dither": false,
  "grid": { "on": false, "size": 3, "opacity": 0.25 },
  "pixelate": { "on": false, "block": 3 },
  "border": { "id": null, "authenticRatio": false },
  "boot": { "animation": true, "sound": false },
  "watermark": true
}

// storage.local
{
  "sites": { "https://www.youtube.com": { "enabled": true, "palette": "pocket" } },
  "customBorders": []
}
```

The `version` field allows settings migrations in later releases.

## Non-functional requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-1 | Speed | Toggle on or off takes effect in under 100 ms on a typical page |
| NFR-2 | Scrolling | Palette-only mode scrolls without visible jank on a mid-range laptop; target 60 fps on text-heavy sites |
| NFR-3 | Heavy effects | Pixelation and dither may cost frames; they are off by default, and pixelation pauses during video playback |
| NFR-4 | Footprint | No work at all on tabs where the effect is off; nothing is injected until first use |
| NFR-5 | Package size | Under 2 MB zipped including bundled borders |
| NFR-6 | Privacy | No analytics, no network requests, no remote code; everything runs locally |
| NFR-7 | Accessibility | Off is always one click or one shortcut away; popup controls are keyboard-operable and labelled; low-contrast warning shown in the popup |
| NFR-8 | Robustness | The page must never break: no layout changes when off, and no errors thrown into the page's console |
| NFR-9 | Compatibility | Chrome stable and the previous release (MV3); also loads in Edge and Brave without changes |
| NFR-10 | Maintainability | Plain JavaScript modules, no framework, no build step for the MVP |

## Open source and repo

The code is MIT-licensed, and community art (palettes, borders) is CC-BY 4.0, so anyone can remix it with credit.

- **Repo:** public GitHub repo `dmg-mode`. The README has a before/after GIF, install-from-store and load-unpacked instructions, and a short privacy statement ("collects nothing; read the source").
- **Contributions:** `CONTRIBUTING.md` explains how to add a palette or border, the code style, and that all art must be original (no ripped borders or logos).
- **Issues:** templates for bug reports (site URL, Chrome version, screenshot) and for palette/border proposals.
- **CI** (`.github/workflows/release.yml`): on every PR, lint the code and validate every palette and border file against its schema. On a `v*` tag, build the store zip and attach it to a GitHub Release.
- **Versioning:** semver; the `manifest.json` version matches the git tag.

### Palette file format

File `palettes/dmg.json`, colours darkest first:

```
{
  "id": "dmg",
  "name": "DMG pea-green",
  "colors": ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  "author": "Zapski",
  "license": "CC-BY-4.0"
}
```

CI rules: unique `id`, exactly 4 valid hex colours, and luminance strictly increasing.

### Border file format

`borders/<id>.png` plus `borders/<id>.json`:

```
{
  "id": "classic-console",
  "name": "Classic console",
  "size": [256, 224],
  "window": { "x": 48, "y": 40, "w": 160, "h": 144 },
  "author": "Zapski",
  "license": "CC-BY-4.0",
  "tool": "GB-SGB-Tooling"
}
```

The PNG is 256×224 (scaled up with nearest-neighbour), and `window` marks the transparent inner area where the page shows through. CI checks that the image dimensions match `size` and that `window` lies inside it.

## Branding, legal and launch

The product is called **DMG Mode** and uses no third-party trademarks in its name, icon, logo or store listing.

### Trademark and content rules

- No "Game Boy", "Nintendo" or console logos in the name, icon, boot animation or screenshots. Describe it as "inspired by classic handheld LCDs".
- "DMG" is a hardware model code, used here as a descriptive word; the boot logo and wordmark are original.
- Every border, font and sound is original or openly licensed, with credits listed in `CREDITS.md`.
- Store screenshots use original or own sites (e.g. retro.zapski.com), not third-party brands.

### Chrome Web Store checklist

- [ ] Developer account registered (one-off fee)
- [ ] Icons: 16, 32, 48, 128 px
- [ ] At least one 1280×800 screenshot (aim for 3–5 before/after shots)
- [ ] 440×280 small promo tile
- [ ] Short description (max 132 characters) and full description
- [ ] Privacy practices form: no data collected; privacy policy URL
- [ ] Single-purpose statement: "Restyles web pages with a retro handheld LCD look"
- [ ] Justification for each permission (see the Permissions table)
- [ ] Store zip built by CI from the tagged release

### Distribution and launch

- **Landing page:** retro.zapski.com/dmg-mode with a live before/after demo, the palette and border galleries, an install button and a GitHub link. It doubles as a link-earning SEO page for Zapski Retro.
- **Launch posts:** r/Gameboy, r/retrogaming, the gbdev community Discord and Product Hunt, each led by a GIF of the boot animation and a toggle.
- **Ongoing:** a "border of the month" from community PRs keeps people coming back to the repo.
- **Support link:** an optional donate link in the popup footer and README.

## Risks, testing and acceptance

The biggest unknowns are scroll performance and how to inset the page for borders, so both get a spike before v1 work starts.

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Very tall pages exceed Chrome's filter limits (plain green screen) | High | Resolved: palette filter moved to a viewport-sized backdrop overlay; tested on eBay search results and a 40,000px fixture |
| Many per-image pixel filters slow scrolling on image-heavy pages | Medium | Pixelate images is off by default; test on eBay and YouTube; add auto-pause for playing video (LCD-3) |
| Border inset breaks some layouts | Medium | Spike `zoom` vs `transform` vs padding; fall back to an overlay-only border that covers the page edges |
| Moving a background to `::before` shifts an absolutely positioned descendant | Low | Only set `position: relative` when the element is static; skip elements that already use `::before`; collect broken-site reports |
| Top-layer elements (fullscreen video, modal dialogs) aren't recoloured | Low | Accepted for launch; document in README |
| Chrome Web Store rejects on permissions | Medium | Minimal install permissions; `<all_urls>` only as an optional permission with a clear justification |
| Trademark complaint | Medium | Original naming and art only (see Branding) |

### Test plan

- **Manual site matrix** (each release): Google search, Wikipedia, YouTube (playing video), Reddit, GitHub, BBC News, X, a Google Docs page, a dark-mode site, a site with sticky headers, and retro.zapski.com.
- **Fixture pages** in `test/pages/`: a gradient strip, photos, fixed and sticky elements, a canvas animation, and an iframe.
- **Automated:** Puppeteer loads the unpacked extension, toggles it on each fixture page and takes screenshots. A check samples pixels and confirms each one is one of the 4 palette colours.
- **Performance:** a Chrome DevTools performance trace while scrolling Wikipedia and Reddit, with and without the effect.

### MVP acceptance criteria

- [ ] `Alt+Shift+G` toggles the effect on the active tab; the popup's on/off button does the same
- [ ] With DMG, Pocket or greyscale chosen, sampled pixels on every fixture page are only that palette's 4 colours
- [ ] Very tall pages (40,000px fixture, eBay search results) render correctly, not as a plain green screen
- [ ] Fixed and sticky headers stay in place with the effect on
- [ ] Popup changes (palette, sliders, invert, pixelate images) apply live without a reload
- [ ] Pixelate images: blocks are exactly the chosen size with no seams; text on banner images stays sharp
- [ ] Settings survive a browser restart; "remember for this site" auto-applies on the next visit after the optional permission is granted
- [ ] Restricted pages show the "can't run here" state with no errors
- [ ] Toggling off leaves no injected elements, attributes, styles or console errors
- [ ] No network requests are made by the extension (checked in DevTools)
