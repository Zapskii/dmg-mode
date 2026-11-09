// Shared defaults. Loaded by the service worker (importScripts) and the popup (<script>).
// Content scripts never load this: they read the resolved settings from storage.
// Host patterns requested for tab mode and per-site memory. Enumerated instead
// of <all_urls> so the extension asks only for the schemes it uses: Chrome's
// `*` scheme covers http and https, not file.
self.DMG_HOSTS = ['*://*/*'];

self.DMG_DEFAULTS = {
  version: 1,
  palette: 'dmg',
  // Resolved palette colours, darkest first. Stored with the settings so the
  // content script never needs to fetch palette files.
  colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  brightness: 0, // -50..50
  contrast: 0,   // -50..50
  invert: false,
  pixelImages: true,  // pixelate images, video, canvas and CSS backgrounds; text stays sharp
  pixelSize: 4,       // block size in CSS px, 2..12
  font: 'pixelify',   // 'off' | 'pixelify' | 'press-start' (see content.js FONTS)
  // Stay on as a tab browses. Needs the optional host permission, which the
  // popup asks for the first time the user presses "Turn on".
  followTab: true
};

// Pages where the browser never allows extensions to run. Web pages only: the
// extension doesn't ask for file:// access, so local files count as restricted.
// Firefox's list is its extensions.webextensions.restrictedDomains default.
self.dmgIsRestricted = function (url) {
  if (!url) return true;
  if (!/^https?:/.test(url)) return true;
  return /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url)
    || /^https:\/\/((discovery\.)?addons\.mozilla\.org|(accounts-static|addons|content)\.cdn\.mozilla\.net|((api|oauth|profile)\.)?accounts\.firefox\.com|install\.mozilla\.org|support\.mozilla\.org|sync\.services\.mozilla\.com)\//.test(url);
};
