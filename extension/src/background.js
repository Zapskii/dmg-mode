importScripts('settings.js');

const DEFAULTS = self.DMG_DEFAULTS;

// ---------- settings ----------

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...DEFAULTS, ...(settings || {}) } });
});

// ---------- per-tab state (session storage survives service-worker restarts) ----------

const key = (tabId) => `on:${tabId}`;

async function isOn(tabId) {
  const r = await chrome.storage.session.get(key(tabId));
  return !!r[key(tabId)];
}

async function setOn(tabId, on) {
  if (on) await chrome.storage.session.set({ [key(tabId)]: true });
  else await chrome.storage.session.remove(key(tabId));
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#306230' }).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' }).catch(() => {});
}

// ---------- apply / remove ----------

async function apply(tabId, on) {
  if (on) {
    // content.js guards against double injection.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'dmg:set', on: true });
  } else {
    // If the script was never injected (or the page navigated) there is nothing to remove.
    await chrome.tabs.sendMessage(tabId, { type: 'dmg:set', on: false }).catch(() => {});
  }
  await setOn(tabId, on);
}

async function toggle(tabId) {
  const next = !(await isOn(tabId));
  try {
    await apply(tabId, next);
    return { ok: true, on: next };
  } catch (e) {
    // Restricted page (chrome://, Web Store, PDF viewer) or no permission.
    await setOn(tabId, false);
    return { ok: false, on: false, error: String(e && e.message || e) };
  }
}

// ---------- triggers ----------

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'toggle-dmg' && tab && tab.id != null) await toggle(tab.id);
});

// ---------- font bytes ----------
//
// Content scripts get font bytes from here, not by fetching a chrome-extension
// URL themselves. With use_dynamic_url, Chrome redirects that fetch through the
// static origin and logs "Unsafe attempt to load URL ..." on some sites
// (YouTube) even though it succeeds. The worker has no page frame, so no
// warning — and the fonts no longer need to be web-accessible at all.

const FONT_FILE = /^(pixelify-sans|press-start-2p)\.woff2$/;

const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  // Chunked: spreading a whole font into one call overflows the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

function sendFont(msg, sendResponse) {
  if (!FONT_FILE.test(msg.file || '')) { sendResponse({}); return; }
  fetch(chrome.runtime.getURL(`assets/fonts/${msg.file}`))
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((buf) => sendResponse({ b64: toBase64(buf) }))
    .catch(() => sendResponse({}));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only this extension may drive tabs; never act on a message without our id.
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg.type === 'dmg:font') { sendFont(msg, sendResponse); return true; }
  if (!Number.isInteger(msg.tabId)) { sendResponse({ ok: false, on: false }); return; }
  (async () => {
    if (msg.type === 'popup:toggle') sendResponse(await toggle(msg.tabId));
    else if (msg.type === 'popup:state') sendResponse({ on: await isOn(msg.tabId) });
    else if (msg.type === 'popup:apply-site') {
      // Popup just turned on "remember for this site": make sure the page matches.
      if (!(await isOn(msg.tabId))) sendResponse(await toggle(msg.tabId));
      else sendResponse({ ok: true, on: true });
    }
  })();
  return true; // async response
});

// ---------- navigation: follow the tab, per-site auto-apply ----------
//
// Both need the optional *://*/* host permission: activeTab access ends
// when the tab navigates, so without it a new page can't be touched.

const hasAllSites = () => chrome.permissions.contains({ origins: self.DMG_HOSTS });

async function followsTab() {
  const { settings } = await chrome.storage.sync.get('settings');
  return !!(settings && settings.followTab) && (await hasAllSites());
}

async function siteRemembered(url) {
  let origin;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    origin = u.origin;
  } catch { return false; }
  const { sites = {} } = await chrome.storage.local.get('sites');
  return !!(sites[origin] && sites[origin].enabled) && (await hasAllSites());
}

// Inject into the new document. `early` runs as soon as the document exists so
// the page doesn't flash in full colour; content.js ignores a repeat injection.
async function reapply(tabId, early) {
  await chrome.scripting.executeScript({
    target: { tabId }, files: ['src/content.js'], injectImmediately: early
  });
  await chrome.tabs.sendMessage(tabId, { type: 'dmg:set', on: true });
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'loading' && info.status !== 'complete') return;
  const early = info.status === 'loading';
  const url = tab.url || '';
  const on = await isOn(tabId);

  // Tab mode: the tab stays on as it browses, until the user turns it off.
  if (on && (await followsTab())) {
    if (!self.dmgIsRestricted(url)) {
      try { await reapply(tabId, early); } catch { /* not ready yet; 'complete' retries */ }
    }
    return; // stay on, even across restricted pages like the new-tab page
  }

  // Page mode: a new document has no injected script, so the tab is off.
  if (early) {
    if (on) await setOn(tabId, false);
    return;
  }

  // Per-site memory: switch on when a remembered site finishes loading.
  if (!self.dmgIsRestricted(url) && (await siteRemembered(url))) {
    try { await apply(tabId, true); } catch { /* page refused injection */ }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(key(tabId));
});
