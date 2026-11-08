// Shared defaults. Loaded by the service worker (importScripts) and the popup (<script>).
// Content scripts never load this: they read the resolved settings from storage.
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
  // Stay on as a tab browses. Needs the optional <all_urls> permission, which
  // the popup asks for the first time the user presses "Turn on".
  followTab: true
};

// Pages where Chrome never allows extensions to run.
self.dmgIsRestricted = function (url) {
  if (!url) return true;
  if (!/^(https?|file):/.test(url)) return true;
  return /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
};
