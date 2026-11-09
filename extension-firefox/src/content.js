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
  // Direct references to the nodes we own. Never look them up by id: a page can
  // ship an element with the same id and hijack remove()/keepOnTop().
  let svgEl = null;
  let styleEl = null;
  let overlayEl = null;

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
        // Chrome filters the opaque backdrop. Firefox filters page elements, whose
        // transparent areas must stay transparent: snap alpha to 0 or 1 so edges
        // don't blend into off-palette colours.
        disc('feFuncA', GECKO ? '0 1' : '1')
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
    if (!enabled || !settings) { watchStop(); return; }
    const root = document.documentElement;
    svgEl = buildFilter(settings);
    root.appendChild(svgEl);

    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = (GECKO ? '' : `#${OVERLAY_ID}{position:fixed !important;inset:0 !important;`
      + `z-index:2147483647 !important;pointer-events:none !important;display:block !important;`
      + `margin:0 !important;padding:0 !important;border:0 !important;background:none !important;`
      + `backdrop-filter:url(#${FILTER_ID}) !important;}`)
      + (settings.pixelImages ? `img,video,canvas{filter:url(#${PIXEL_ID}) !important;}` + bgRules() : '')
      + (GECKO ? geckoRules(settings) : '')
      + fontRules(settings.font);
    (document.head || root).appendChild(styleEl);
    if (FONTS[settings.font]) loadFont(settings.font);

    if (!GECKO) {
      // Last child of <html>, so it stacks above the page at the same z-index.
      overlayEl = document.createElement('div');
      overlayEl.id = OVERLAY_ID;
      overlayEl.setAttribute('aria-hidden', 'true');
      root.appendChild(overlayEl);
    }

    if (!settings.pixelImages) clearBg();
    // Firefox always needs the scan: it finds fixed elements to filter separately.
    if (settings.pixelImages || GECKO) watchStart(); else watchStop();
  }

  // ---------- Firefox: filter elements, not the backdrop ----------
  //
  // Firefox ignores backdrop-filter:url() and filter:url() on <html>, and a
  // filter on <body> unpins every position:fixed element inside it (a filter
  // makes its element the containing block). So in Firefox the palette filter
  // goes on each child of <body> instead. Where a child contains a fixed
  // element, we step down past it (marking it P_ATTR) and filter its children,
  // so each fixed element ends up filtered on its own and stays pinned.
  // <html>, <body> and P elements aren't filtered, so their own background
  // colour is mapped to the palette in JS (PBG_ATTR + --dmg-pbg).
  // Known gaps: text, background images and box-shadows painted directly by
  // P elements stay in colour; fixed elements in shadow roots aren't found; a
  // site's own `filter` on a filtered element is replaced.

  const GECKO = chrome.runtime.getURL('').startsWith('moz-extension:');
  const P_ATTR = 'data-dmg-p';
  const PBG_ATTR = 'data-dmg-pbg';
  let pEls = new Set();
  let origBg = new WeakMap(); // background colour before we recoloured it

  function geckoRules(s) {
    // Plain CSS for <body>'s children, so content the parser adds before the
    // first scan is never shown in full colour.
    const kids = `:is(body,[${P_ATTR}])>`;
    const not = `:not([${P_ATTR}])`;
    return `${kids}*${not}{filter:url(#${FILTER_ID}) !important;}`
      + `[${PBG_ATTR}]{background-color:var(--dmg-pbg) !important;}`
      // An element can only have one filter property: chain both when it needs both.
      + (s.pixelImages ? `${kids}:is(img,video,canvas,[${ATTR}="direct"])${not}`
        + `{filter:url(#${PIXEL_ID}) url(#${FILTER_ID}) !important;}` : '');
  }

  // JS copy of the palette filter for one colour. A 1px canvas parses any CSS
  // colour syntax (getComputedStyle can return oklch() and friends).
  let pxCtx = null;
  function toPalette(css, s) {
    pxCtx ||= new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    pxCtx.clearRect(0, 0, 1, 1);
    pxCtx.fillStyle = '#0000';
    pxCtx.fillStyle = css;
    pxCtx.fillRect(0, 0, 1, 1);
    const d = pxCtx.getImageData(0, 0, 1, 1).data;
    if (d[3] === 0) return null; // transparent: nothing of its own to paint
    // ponytail: alpha ignored (treated as opaque); blend with the parent if translucent backgrounds look wrong.
    const { slope, intercept } = linear(s);
    const [r, g, b] = [d[0], d[1], d[2]].map((v) => Math.max(0, Math.min(1, slope * v / 255 + intercept)));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return s.colors[Math.min(3, Math.floor(l * 4))]; // same bands as feFuncX type=discrete
  }

  function setPbg(el, colour) {
    if (!colour) {
      if (el.hasAttribute(PBG_ATTR)) { el.removeAttribute(PBG_ATTR); el.style.removeProperty('--dmg-pbg'); }
      return;
    }
    // Only write on change: a style write triggers the MutationObserver again.
    if (el.style.getPropertyValue('--dmg-pbg') !== colour) el.style.setProperty('--dmg-pbg', colour);
    if (!el.hasAttribute(PBG_ATTR)) el.setAttribute(PBG_ATTR, '');
  }

  // `fixed`: fixed elements, which must not sit inside a filtered ancestor.
  // `contents`: display:contents elements in document order. They have no box,
  // so a filter on one does nothing: when one would get the filter (its parent
  // is unfiltered), step past it too. Elsewhere an ancestor's filter covers it.
  function geckoMark(fixed, contents) {
    const body = document.body;
    if (!body) return;
    const next = new Set();
    for (const e of fixed) {
      for (let a = e.parentElement; a && a !== body; a = a.parentElement) next.add(a);
    }
    for (const e of contents) if (e.parentElement === body || next.has(e.parentElement)) next.add(e);
    for (const el of pEls) if (!next.has(el)) { el.removeAttribute(P_ATTR); setPbg(el, null); }
    for (const el of next) if (!el.hasAttribute(P_ATTR)) el.setAttribute(P_ATTR, '');
    pEls = next;

    const own = (el) => {
      if (!origBg.has(el)) origBg.set(el, getComputedStyle(el).backgroundColor);
      return toPalette(origBg.get(el), settings);
    };
    const html = document.documentElement;
    // The page canvas shows <html>'s background, else <body>'s, else white.
    setPbg(html, own(html) || own(body) || toPalette('#fff', settings));
    for (const el of [body, ...next]) setPbg(el, own(el));
  }

  // A fractional scroll offset (scroll anchoring, smooth scrolling) makes
  // Firefox resample the filtered elements, blending edges into off-palette
  // colours. Once scrolling stops, round the page offset to a whole device
  // pixel, too small a move to see. Inner scrolling boxes aren't handled.
  let snapTimer = null;
  function snapScroll() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      const dpr = devicePixelRatio || 1;
      const x = Math.round(scrollX * dpr) / dpr;
      const y = Math.round(scrollY * dpr) / dpr;
      if (x !== scrollX || y !== scrollY) scrollTo({ left: x, top: y, behavior: 'instant' });
    }, 150);
  }

  function geckoClear() {
    for (const el of document.querySelectorAll(`[${P_ATTR}],[${PBG_ATTR}]`)) {
      el.removeAttribute(P_ATTR);
      setPbg(el, null);
      if (!el.getAttribute('style')) el.removeAttribute('style');
    }
    pEls = new Set();
    origBg = new WeakMap();
    removeEventListener('scroll', snapScroll);
    clearTimeout(snapTimer);
  }

  // Some sites (eBay) clear unknown children of <html> while they load, which
  // takes our filter and style with them. Seen in Firefox tab mode, where we
  // inject before the page's own scripts run.
  const detached = () => enabled && !!svgEl && !(svgEl.isConnected && styleEl.isConnected);

  function remove() {
    svgEl?.remove();
    styleEl?.remove();
    overlayEl?.remove();
    svgEl = styleEl = overlayEl = null;
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
    // Bytes arrive from the worker: fetching the chrome-extension URL here makes
    // Chrome log "Unsafe attempt to load URL ..." on some sites (YouTube).
    const p = new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'dmg:font', file: f.file }, (res) => {
        if (chrome.runtime.lastError || !res || !res.b64) { reject(new Error('font')); return; }
        const bin = atob(res.b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const face = new FontFace(f.family, buf, { sizeAdjust: f.sizeAdjust, display: 'block' });
        document.fonts.add(face);
        resolve(face.load());
      });
    }).catch(() => loadedFonts.delete(id)); // retry on next render
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

  // ponytail: full-page walk with getComputedStyle on every DOM change (throttled
  // to 400ms; ~65ms on eBay search in Firefox). Walk only mutated subtrees if it shows up in profiles.
  function scan() {
    scanTimer = null;
    if (detached()) { safeRender(); return; } // render() starts a fresh scan
    const fixed = [];
    const contents = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (el === overlayEl) continue;
      if (GECKO) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') fixed.push(el);
        else if (cs.display === 'contents') contents.push(el);
      }
      if (!settings.pixelImages) continue;
      const state = el.getAttribute(ATTR);
      if (!state) { mark(el); continue; }
      // Carousels swap inline background images; keep the layer in sync.
      if (state === 'layer' && hasUrl(el.style.backgroundImage)
          && el.style.backgroundImage !== el.style.getPropertyValue('--dmg-bg-image')) {
        el.style.setProperty('--dmg-bg-image', el.style.backgroundImage);
      }
    }
    if (GECKO) geckoMark(fixed, contents);
  }

  const scheduleScan = () => { if (!scanTimer) scanTimer = setTimeout(scan, 400); };

  function watchStart() {
    scan();
    if (GECKO) { addEventListener('scroll', snapScroll, { passive: true }); snapScroll(); }
    if (observer) return;
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
    });
  }

  function watchStop() {
    observer?.disconnect();
    observer = null;
    clearTimeout(scanTimer);
    scanTimer = null;
    clearBg();
    if (GECKO) geckoClear();
  }

  function clearBg() {
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
    if (overlayEl && overlayEl !== document.documentElement.lastElementChild) {
      document.documentElement.appendChild(overlayEl);
    }
  }
  document.addEventListener('DOMContentLoaded', keepOnTop);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (msg.type !== 'dmg:set') return;
    // Already on in this document (tab mode re-applies on 'loading' and 'complete').
    if (msg.on && enabled) {
      if (detached()) safeRender(); else keepOnTop();
      sendResponse({ on: true });
      return;
    }
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
