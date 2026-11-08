// DMG Mode content script. Injected on demand by the service worker.
// Draws the page in 4 palette shades with one SVG filter, applied as a
// backdrop-filter on a fixed, click-through overlay the size of the viewport.
//
// Why not `filter` on <html>: Chrome rasterises the whole element for a filter,
// and on very tall pages (an eBay search page is ~20,000px, ~40,000 device px
// at 2x) it gives up and the filter receives an empty image, so the page turns
// solid green. A backdrop filter only ever processes what is on screen, so page
// length doesn't matter. It also leaves page layout untouched, and fixed
// elements and iframes underneath are recoloured too.

(() => {
  if (window.__dmgMode) return; // already injected into this document
  window.__dmgMode = true;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_ID = 'dmg-mode-svg';
  const STYLE_ID = 'dmg-mode-style';
  const FILTER_ID = 'dmg-mode-filter';
  const PIXEL_ID = 'dmg-mode-pixelate';
  const OVERLAY_ID = 'dmg-mode-overlay';

  let enabled = false;
  let settings = null;

  const hexToRgb = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  };

  // Brightness/contrast/invert as one linear transfer: out = slope * in + intercept.
  // Values arrive from storage, so clamp them rather than trusting the popup.
  const clamp = (v) => (Number.isFinite(+v) ? Math.max(-50, Math.min(50, +v)) : 0);
  const linear = (s) => {
    const k = (100 + clamp(s.contrast)) / 100;           // contrast factor around mid-grey
    const b = clamp(s.brightness) / 100;                 // shift
    const slope = s.invert ? -k : k;
    const intercept = (s.invert ? 0.5 * (1 + k) : 0.5 * (1 - k)) + b;
    return { slope: +slope.toFixed(4), intercept: +intercept.toFixed(4) };
  };

  function buildFilter(s) {
    const rgb = s.colors.map(hexToRgb);                  // darkest first
    const table = (ch) => rgb.map((c) => c[ch]).join(' ');
    const { slope, intercept } = linear(s);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = SVG_ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';

    // Built with DOM calls, not innerHTML, so pages with Trusted Types CSP are fine.
    const el = (tag, attrs, children = []) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      children.forEach((c) => n.appendChild(c));
      return n;
    };
    const lin = (ch) => el(ch, { type: 'linear', slope, intercept });
    const disc = (ch, values) => el(ch, { type: 'discrete', tableValues: values });
    const lum = '0.2126 0.7152 0.0722 0 0 ';

    svg.appendChild(el('filter', {
      id: FILTER_ID, 'color-interpolation-filters': 'sRGB', x: 0, y: 0, width: '100%', height: '100%'
    }, [
      // 1. brightness / contrast / invert
      el('feComponentTransfer', {}, [lin('feFuncR'), lin('feFuncG'), lin('feFuncB')]),
      // 2. luminance into all three channels
      el('feColorMatrix', { type: 'matrix', values: lum + lum + lum + '0 0 0 1 0' }),
      // 3. snap each channel to the palette (channels are equal, so pixels land on exact colours)
      el('feComponentTransfer', {}, [
        disc('feFuncR', table(0)), disc('feFuncG', table(1)), disc('feFuncB', table(2)),
        disc('feFuncA', '1')
      ])
    ]));

    // Image pixelation: sample one pixel per block, then grow each sample into a
    // square. Applied per element, so blocks line up with each image's corner.
    const px = Math.round(+s.pixelSize);
    const size = Math.max(2, Math.min(12, Number.isFinite(px) ? px : 4));
    // A dilated dot is (dot + 2 * radius) wide, so pick dot and radius that make
    // blocks exactly `size` px: overlapping blocks would leave 1px seams.
    const dot = size % 2 === 0 ? 2 : 1;
    const radius = (size - dot) / 2;
    const at = radius;
    svg.appendChild(el('filter', {
      id: PIXEL_ID, 'color-interpolation-filters': 'sRGB', x: 0, y: 0, width: '100%', height: '100%'
    }, [
      el('feFlood', { x: at, y: at, width: dot, height: dot }),
      el('feComposite', { width: size, height: size }),
      el('feTile', { result: 'grid' }),
      el('feComposite', { in: 'SourceGraphic', in2: 'grid', operator: 'in' }),
      el('feMorphology', { operator: 'dilate', radius })
    ]));
    return svg;
  }

  function render() {
    remove();
    if (!enabled || !settings) { bgStop(); return; }
    const root = document.documentElement;
    root.appendChild(buildFilter(settings));

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `#${OVERLAY_ID}{position:fixed !important;inset:0 !important;`
      + `z-index:2147483647 !important;pointer-events:none !important;display:block !important;`
      + `margin:0 !important;padding:0 !important;border:0 !important;background:none !important;`
      + `backdrop-filter:url(#${FILTER_ID}) !important;}`
      + (settings.pixelImages ? `img,video,canvas{filter:url(#${PIXEL_ID}) !important;}` + bgRules() : '')
      + fontRules(settings.font);
    (document.head || root).appendChild(style);
    if (FONTS[settings.font]) loadFont(settings.font);

    // Last child of <html>, so it stacks above the page at the same z-index.
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('aria-hidden', 'true');
    root.appendChild(overlay);

    if (settings.pixelImages) bgStart(); else bgStop();
  }

  function remove() {
    document.getElementById(SVG_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(OVERLAY_ID)?.remove();
  }

  // ---------- pixel font ----------
  //
  // Fonts are bundled (OFL) and registered with the FontFace API from the
  // content script, so a page's font-src CSP can't block them. `sizeAdjust`
  // scales a font's glyphs so text takes roughly the same space as before.

  const FONTS = {
    'pixelify': { family: 'DMG Pixelify', file: 'pixelify-sans.woff2', sizeAdjust: '100%' },
    'press-start': { family: 'DMG Press Start', file: 'press-start-2p.woff2', sizeAdjust: '68%' }
  };
  const loadedFonts = new Map();

  function loadFont(id) {
    const f = FONTS[id];
    if (loadedFonts.has(id)) return loadedFonts.get(id);
    const p = fetch(chrome.runtime.getURL(`assets/fonts/${f.file}`))
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const face = new FontFace(f.family, buf, { sizeAdjust: f.sizeAdjust, display: 'block' });
        document.fonts.add(face);
        return face.load();
      })
      .catch(() => loadedFonts.delete(id)); // retry on next render
    loadedFonts.set(id, p);
    return p;
  }

  // Leave icon fonts alone: they draw icons from ligatures or private-use
  // characters, and a pixel font would turn them into words or boxes.
  const ICON_EXCLUDES = [
    'i', '[class*="icon" i]', '[class*="fa-"]', '[class^="fa"]', '[class*="material-"]',
    '[class*="glyph" i]', '[class*="symbol" i]', '[data-icon]', '[aria-hidden="true"]'
  ].map((s) => `:not(${s})`).join('');

  function fontRules(id) {
    const f = FONTS[id];
    if (!f) return '';
    return `body,body *${ICON_EXCLUDES}{font-family:"${f.family}",monospace !important;`
      + `-webkit-font-smoothing:none !important;font-synthesis:none !important;`
      + `font-variant-ligatures:none !important;font-feature-settings:normal !important;}`
      + `#${OVERLAY_ID}{font-family:initial !important;}`;
  }

  // ---------- CSS background images ----------
  //
  // Two cases:
  //  - "direct": the element has no content of its own (a decorative div), so
  //    the pixel filter goes straight on it.
  //  - "layer":  the element has text or children on top of its background (a
  //    hero banner). Filtering it would pixelate the text too, so its background
  //    moves to a ::before layer behind the content and only that layer is
  //    filtered. The original values travel in --dmg-bg-* custom properties.

  const ATTR = 'data-dmg-bg';
  const POS_ATTR = 'data-dmg-pos';
  const MIN_SIZE = 24; // skip icon sprites, thin strips and other tiny backgrounds
  const SKIP_TAGS = new Set(['SELECT', 'INPUT', 'BUTTON', 'TEXTAREA', 'OPTION']);
  const BG_PROPS = ['image', 'size', 'position', 'repeat', 'origin', 'clip'];
  let observer = null;
  let scanTimer = null;

  function bgRules() {
    const sel = `[${ATTR}="layer"]`;
    const vars = BG_PROPS.map((p) => `background-${p}:var(--dmg-bg-${p}) !important;`).join('');
    return `[${ATTR}="direct"]{filter:url(#${PIXEL_ID}) !important;}`
      + `${sel}{isolation:isolate !important;background-image:none !important;}`
      + `${sel}[${POS_ATTR}]{position:relative !important;}`
      + `${sel}::before{content:"" !important;position:absolute !important;inset:0 !important;`
      + `z-index:-1 !important;pointer-events:none !important;border-radius:inherit !important;`
      + `${vars}filter:url(#${PIXEL_ID}) !important;}`;
  }

  const hasUrl = (v) => !!v && v.includes('url(');

  function hasOwnContent(el) {
    if (el.children.length) return true;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }

  function mark(el) {
    const cs = getComputedStyle(el);
    if (!hasUrl(cs.backgroundImage)) return;
    // Form controls use background images for arrows and checkmarks.
    if (SKIP_TAGS.has(el.tagName)) return;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) return;

    if (!hasOwnContent(el)) { el.setAttribute(ATTR, 'direct'); return; }

    // The site already uses ::before here; leave it alone rather than break it.
    if (getComputedStyle(el, '::before').content !== 'none') return;

    for (const p of BG_PROPS) el.style.setProperty(`--dmg-bg-${p}`, cs.getPropertyValue(`background-${p}`));
    if (cs.position === 'static') el.setAttribute(POS_ATTR, '');
    el.setAttribute(ATTR, 'layer');
  }

  function scan() {
    scanTimer = null;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (el.id === OVERLAY_ID) continue;
      const state = el.getAttribute(ATTR);
      if (!state) { mark(el); continue; }
      // Carousels swap inline background images; keep the layer in sync.
      if (state === 'layer' && hasUrl(el.style.backgroundImage)
          && el.style.backgroundImage !== el.style.getPropertyValue('--dmg-bg-image')) {
        el.style.setProperty('--dmg-bg-image', el.style.backgroundImage);
      }
    }
  }

  const scheduleScan = () => { if (!scanTimer) scanTimer = setTimeout(scan, 400); };

  function bgStart() {
    scan();
    if (observer) return;
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
    });
  }

  function bgStop() {
    observer?.disconnect();
    observer = null;
    clearTimeout(scanTimer);
    scanTimer = null;
    for (const el of document.querySelectorAll(`[${ATTR}]`)) {
      el.removeAttribute(ATTR);
      el.removeAttribute(POS_ATTR);
      for (const p of BG_PROPS) el.style.removeProperty(`--dmg-bg-${p}`);
      if (!el.getAttribute('style')) el.removeAttribute('style');
    }
  }

  // Minimal fallbacks so a missing or partial settings object can't break render().
  const FALLBACK = { colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'], brightness: 0, contrast: 0 };
  const HEX = /^#[0-9a-f]{6}$/i;
  const withFallback = (s) => {
    const m = { ...FALLBACK, ...(s || {}) };
    if (!Array.isArray(m.colors) || m.colors.length !== 4 || !m.colors.every((c) => HEX.test(c))) {
      m.colors = FALLBACK.colors; // synced values are untrusted
    }
    return m;
  };

  async function loadSettings() {
    const { settings: s } = await chrome.storage.sync.get('settings');
    settings = withFallback(s);
  }

  function safeRender() {
    try { render(); } catch (e) { console.warn('[DMG Mode]', e); }
  }

  // When injected early (tab mode), the parser adds <head>/<body> after the
  // overlay; move it back to the end so it stays on top.
  function keepOnTop() {
    const o = document.getElementById(OVERLAY_ID);
    if (o && o !== document.documentElement.lastElementChild) document.documentElement.appendChild(o);
  }
  document.addEventListener('DOMContentLoaded', keepOnTop);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'dmg:set') return;
    // Already on in this document (tab mode re-applies on 'loading' and 'complete').
    if (msg.on && enabled) { keepOnTop(); sendResponse({ on: true }); return; }
    enabled = !!msg.on;
    loadSettings().catch(() => {}).then(() => { safeRender(); sendResponse({ on: enabled }); });
    return true;
  });

  // Popup changes apply live.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      settings = withFallback(changes.settings.newValue);
      if (enabled) safeRender();
    }
  });
})();
