const DEFAULTS = self.DMG_DEFAULTS;
const HOSTS = self.DMG_HOSTS;
const HEX = /^#[0-9a-f]{6}$/i;
const safeColors = (c) => (Array.isArray(c) && c.length === 4 && c.every((x) => HEX.test(x)) ? c : DEFAULTS.colors);
const $ = (id) => document.getElementById(id);

let tab = null;
let settings = { ...DEFAULTS };
let palettes = [];
let allSites = false; // optional *://*/* permission granted?
let tabOn = false;

async function loadPalettes() {
  const index = await (await fetch('../../palettes/index.json')).json();
  palettes = await Promise.all(
    index.map(async (id) => (await fetch(`../../palettes/${id}.json`)).json())
  );
}

function renderSwatches(colors) {
  $('swatches').replaceChildren(...safeColors(colors).map((c) => {
    const i = document.createElement('i');
    i.style.background = c;
    return i;
  }));
}

function renderSettings() {
  $('palette').value = settings.palette;
  renderSwatches(settings.colors);
  for (const k of ['brightness', 'contrast']) {
    $(k).value = settings[k];
    $(`${k}-out`).textContent = settings[k];
  }
  $('invert').checked = !!settings.invert;
  $('pixel-images').checked = !!settings.pixelImages;
  $('pixel-size').value = settings.pixelSize ?? 4;
  $('pixel-size-out').textContent = `${settings.pixelSize ?? 4}px`;
  $('pixel-size-row').hidden = !settings.pixelImages;
  $('font').value = settings.font || 'off';
  renderFollow();
  $('low-contrast').hidden = settings.contrast > -30;
}

function renderFollow() {
  $('follow-tab').checked = !!settings.followTab;
  // On by default, but it only works once the browser's "all sites" access is granted.
  $('follow-hint').hidden = !(settings.followTab && !allSites);
}

function renderToggle(on) {
  tabOn = on;
  $('toggle').setAttribute('aria-pressed', String(on));
  $('toggle').textContent = on ? 'Turn off' : 'Turn on';
}

async function save(patch) {
  settings = { ...settings, ...patch };
  renderSettings();
  await chrome.storage.sync.set({ settings }); // content script re-renders live
}

const origin = () => { try { return new URL(tab.url).origin; } catch { return null; } };

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const [cmd] = (await chrome.commands.getAll()).filter((c) => c.name === 'toggle-dmg');
  $('shortcut').textContent = cmd && cmd.shortcut ? cmd.shortcut : '';

  await loadPalettes();
  $('palette').replaceChildren(...palettes.map((p) => new Option(p.name, p.id)));

  const stored = (await chrome.storage.sync.get('settings')).settings;
  settings = { ...DEFAULTS, ...(stored || {}) };
  settings.colors = safeColors(settings.colors); // synced values are untrusted
  renderSettings();

  allSites = await chrome.permissions.contains({ origins: HOSTS });
  renderFollow();

  if (!tab) return;
  const { on } = await chrome.runtime.sendMessage({ type: 'popup:state', tabId: tab.id });
  renderToggle(on);

  if (self.dmgIsRestricted(tab.url)) {
    $('restricted').hidden = false;
    // In tab mode the tab can be on while showing e.g. the new-tab page: keep
    // the on/off button usable so it can still be switched off from here.
    if (on) $('restricted').textContent = "Your browser doesn't let extensions run on this page. DMG Mode stays on for this tab and comes back on the next normal page.";
    else $('controls').classList.add('disabled');
    return;
  }

  const { sites = {} } = await chrome.storage.local.get('sites');
  const o = origin();
  $('remember').checked = !!(o && sites[o] && sites[o].enabled);
}

// ---------- events ----------

$('toggle').addEventListener('click', async () => {
  // First "Turn on" with tab mode enabled: ask for all-sites access now, while
  // we have the click (the browser only shows the prompt for a user gesture).
  if (!tabOn && settings.followTab && !allSites) {
    allSites = await chrome.permissions.request({ origins: HOSTS });
    if (!allSites) await save({ followTab: false }); // declined: plain page mode
    renderFollow();
  }
  const res = await chrome.runtime.sendMessage({ type: 'popup:toggle', tabId: tab.id });
  renderToggle(res.on);
  if (!res.ok) $('restricted').hidden = false;
});

$('palette').addEventListener('change', (e) => {
  const p = palettes.find((x) => x.id === e.target.value);
  if (p) save({ palette: p.id, colors: p.colors });
});

for (const k of ['brightness', 'contrast']) {
  $(k).addEventListener('input', (e) => save({ [k]: Number(e.target.value) }));
}

$('invert').addEventListener('change', (e) => save({ invert: e.target.checked }));
$('font').addEventListener('change', (e) => save({ font: e.target.value }));
$('pixel-images').addEventListener('change', (e) => save({ pixelImages: e.target.checked }));
$('pixel-size').addEventListener('input', (e) => save({ pixelSize: Number(e.target.value) }));

$('remember').addEventListener('change', async (e) => {
  const o = origin();
  if (!o) return;
  if (e.target.checked) {
    // Must run inside the click: the browser only shows the permission prompt for a user gesture.
    const granted = await chrome.permissions.request({ origins: HOSTS });
    if (!granted) { e.target.checked = false; return; }
  }
  const { sites = {} } = await chrome.storage.local.get('sites');
  if (e.target.checked) sites[o] = { enabled: true };
  else delete sites[o];
  await chrome.storage.local.set({ sites });
  if (e.target.checked) {
    const res = await chrome.runtime.sendMessage({ type: 'popup:apply-site', tabId: tab.id });
    renderToggle(res.on);
  }
});

$('follow-tab').addEventListener('change', async (e) => {
  if (e.target.checked && !allSites) {
    // Must run inside the click: the browser only shows the permission prompt for a user gesture.
    allSites = await chrome.permissions.request({ origins: HOSTS });
    if (!allSites) { e.target.checked = false; return; }
  }
  save({ followTab: e.target.checked });
});

$('reset').addEventListener('click', () => save({ ...DEFAULTS }));

init();
