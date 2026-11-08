# Chrome Web Store listing copy

Paste-ready text for the developer console. Assets live in `store/`:
`screenshot-1280x800.png` (plus optional mockups), `promo-tile-440x280.png`,
`logo-300x300.png`, `large-tile-1400x560.png`; the 128px icon is
`extension/assets/icon-128.png`.

> "Game Boy" and "Nintendo" are deliberately absent from this copy: they must
> not appear in store text or screenshots. The README can name the look
> descriptively; the listing says "classic handheld LCD".

## Basics

- **Name:** DMG Mode
- **Summary (132 chars max):** Redraw any web page in four shades, like a classic handheld LCD. Free, offline, no tracking.
- **Category:** Functionality & UI
- **Language:** English (United Kingdom)
- **Pricing:** Free

## Description

```
DMG Mode redraws the page you are reading in four shades—green, grey or black
and white—like a classic handheld LCD.

Text, images, video and backgrounds all snap to the same four-colour palette,
so the whole page stays readable. Optional extras give it a chunkier look:
image pixelation, bundled pixel fonts, and an invert mode for dark sites.

• Three palettes: DMG, Pocket and greyscale
• Brightness, contrast and invert controls
• Pixel fonts (Pixelify Sans, Press Start 2P), bundled under the SIL Open Font
  License
• Optional image and background pixelation
• Stay on as a tab browses, or remember individual sites
• Keyboard shortcut: Alt+Shift+G

No network requests, no remote code, no analytics. Free and open source (MIT),
with original palettes under CC BY 4.0.
```

## Single purpose

```
DMG Mode applies a four-shade monochrome filter to web pages so they look like a
classic handheld LCD screen.
```

## Permission justifications

- **`activeTab`:** "Used only when the user turns the effect on, to inject the overlay into the tab they are viewing. Access ends when they switch away."
- **`scripting`:** "Injects and removes the content script that draws the colour overlay and pixelation. No other script is executed."
- **`storage`:** "Stores the user's palette and effect settings, per-tab on/off state, and the sites they choose to remember. Nothing leaves the browser."
- **`*://*/*` (optional host permission):** "Optional, requested only when the user enables 'Stay on as this tab browses' or 'Remember for this site'. Needed to re-apply the effect after a navigation without another click. It is never used to read, collect or transmit page data."

## Privacy practices tab

- **Does the extension collect user data?** No.
- **Remote code:** No. All JavaScript, fonts and palettes are bundled in the package.
- **Data use certification:** None of the listed data types are collected, sold or transferred.
- **Privacy policy URL:** only required if data is declared; if the console insists, use a short page on the project site stating that DMG Mode collects nothing, makes no network requests, and stores settings only in `chrome.storage`.

## Developer account

- Register at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole); one-time US$5 fee. Version 0.1.1 is ready to upload.
- The **public contact email** is a separate verified field on the dashboard's Account page — it is not the Google sign-in address and it is shown on the listing. Use a Zapski address, not a personal one.
- Choose **Non-Trader** unless the extension becomes commercial: trader verification can publish a postal address and phone number drawn from the Google Payments profile.
- Set the publisher/account name to Zapski.

## Microsoft Edge Add-ons

Same package, separate store. Registration is free.

1. Sign in at [Partner Center](https://partner.microsoft.com/dashboard) → **Account settings → Programs → Microsoft Edge → Get started**. Use an individual account and publisher display name **Zapski**; the account type cannot be changed later.
2. Create the extension and upload `dist/dmg-mode-<version>.zip` — the Chromium manifest works unchanged. If validation complains about `minimum_chrome_version`, current Edge is well past Chromium 130, so the field can be dropped for this copy.
3. **Availability:** Public, choose markets.
4. **Properties:** category, website, support contact — the support URL must be publicly reachable, as with Chrome.
5. **Privacy:** same single purpose, permission justifications, remote-code **No** and data-usage answers as above.
6. **Store listing:** description, logo `store/logo-300x300.png` (min 128×128), small tile `store/promo-tile-440x280.png`, large tile `store/large-tile-1400x560.png`, and up to six screenshots at 1280×800 or 640×480.
7. **Notes for certification** → **Publish**. Certification can take up to 7 business days.

Updates need a version bump and a new upload. The first submission is manual; later ones can use Partner Center's Publish API from CI.

## Pre-submission checklist

- [ ] `extension/manifest.json` version bumped for this upload
- [ ] `./build.sh`, upload `dist/dmg-mode-<version>.zip`
- [ ] Repo is public (the listing and README both point at the source)
- [ ] Try the packaged zip once: Turn on, tab mode, palette switch, toggle off

The screenshot is the real rendering pipeline (the bundled `content.js` applied
to a demo page at 1280×800), not a mock-up. Regenerate it if the default
palette, pixel size or fonts change.
