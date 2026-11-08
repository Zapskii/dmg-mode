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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
// Both need the optional <all_urls> host permission: activeTab access ends
// when the tab navigates, so without it a new page can't be touched.

const hasAllSites = () => chrome.permissions.contains({ origins: ['<all_urls>'] });

async function followsTab() {
  const { settings } = await chrome.storage.sync.get('settings');
  return !!(settings && settings.followTab) && (await hasAllSites());
}

async function siteRemembered(url) {
  let origin;
  try { origin = new URL(url).origin; } catch { return false; }
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
