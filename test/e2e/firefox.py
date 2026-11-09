#!/usr/bin/env python3
"""End-to-end checks for the Firefox build, driven by Selenium + geckodriver.

  python3 -m pip install selenium pillow
  python3 test/e2e/firefox.py               # fixture pages, served locally
  python3 test/e2e/firefox.py --real-sites  # also BBC News, eBay, the Guardian, LinkedIn

Playwright's Firefox can't load extensions, hence Selenium. The build under test
is a copy of extension/ with the merged Firefox manifest and host_permissions
added, so injection works without a toolbar click. Requires Firefox and Node
(for the manifest merge). No CI job: Firefox on GitHub's runners is a snap and
headless launches from it are flaky, so this is a local check.
"""
import io, json, os, shutil, subprocess, sys, tempfile, threading, time, zipfile
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from PIL import Image
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DMG = {(15, 56, 15), (48, 98, 48), (139, 172, 15), (155, 188, 15)}
UUID = '11111111-2222-3333-4444-555555555555'
fails = []

def check(ok, label):
    print(('  ok   ' if ok else '  FAIL ') + label)
    if not ok: fails.append(label)

# ---------- local server + test build ----------

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=REPO))
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
BASE = f'http://127.0.0.1:{PORT}/test/pages/'

tmp = tempfile.mkdtemp()
ext = f'{tmp}/extension'
shutil.copytree(f'{REPO}/extension', ext)
manifest = json.loads(subprocess.check_output(['node', f'{REPO}/test/firefox-manifest.js']))
manifest['host_permissions'] = ['<all_urls>']
open(f'{ext}/manifest.json', 'w').write(json.dumps(manifest))
xpi = f'{tmp}/dmg-mode.xpi'
with zipfile.ZipFile(xpi, 'w') as z:
    for name in os.listdir(ext):
        if name.startswith('.'): continue
        for root, _, files in os.walk(f'{ext}/{name}'):
            for f in files:
                if not f.startswith('.'):
                    z.write(os.path.join(root, f), os.path.relpath(os.path.join(root, f), ext))
    z.write(f'{ext}/manifest.json', 'manifest.json')

# Popup harness: popup.html with a stubbed chrome.* API, served next to popup.js
# so its relative paths and palettes fetch work.
SHIM = """<script>
const h = { store: { sync: {}, local: { sites: {} } }, calls: [], contains: false, request: false,
            tab: { id: 7, url: 'https://example.com/x' } };
window.__h = h;
const pick = (o, k) => (k in o ? { [k]: o[k] } : {});
window.chrome = {
  tabs: { query: () => Promise.resolve([h.tab]) },
  storage: {
    sync: { get: (k) => Promise.resolve(pick(h.store.sync, k)), set: (o) => { Object.assign(h.store.sync, o); return Promise.resolve(); } },
    local: { get: (k) => Promise.resolve(pick(h.store.local, k)), set: (o) => { Object.assign(h.store.local, o); return Promise.resolve(); } },
    onChanged: { addListener() {} },
  },
  commands: { getAll: () => Promise.resolve([{ name: 'toggle-dmg', shortcut: 'Alt+Shift+G' }]) },
  permissions: {
    contains: () => Promise.resolve(h.contains),
    request: (o) => { h.calls.push(o); h.contains = h.request; return Promise.resolve(h.request); },
  },
  runtime: {
    sendMessage: (m) => {
      if (m.type === 'popup:state') return Promise.resolve({ on: !!h.on });
      if (m.type === 'popup:toggle') { h.on = !h.on; return Promise.resolve({ ok: true, on: h.on }); }
      if (m.type === 'popup:apply-site') { h.on = true; return Promise.resolve({ ok: true, on: h.on }); }
      return Promise.resolve({});
    },
    onMessage: { addListener() {} },
  },
};
</script>"""
popup_html = open(f'{ext}/src/popup/popup.html').read()
open(f'{ext}/src/popup/harness.html', 'w').write(
    popup_html.replace('<script src="popup.js"></script>', SHIM + '<script src="popup.js"></script>'))

# Second server rooted at the temp dir, so the harness keeps popup.html's relative paths.
harness_srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=tmp))
threading.Thread(target=harness_srv.serve_forever, daemon=True).start()
HARNESS = f'http://127.0.0.1:{harness_srv.server_address[1]}/extension/'

# ---------- browser ----------

o = Options(); o.add_argument('-headless'); o.binary_location = '/Applications/Firefox.app/Contents/MacOS/firefox'
if not os.path.exists(o.binary_location): o.binary_location = shutil.which('firefox') or ''
o.set_preference('extensions.webextensions.uuids', json.dumps({'dmg-mode@zapski': UUID}))
d = webdriver.Firefox(options=o, service=Service(service_args=['--allow-system-access']))
d.set_window_size(1280, 800)

def shot():
    im = Image.open(io.BytesIO(d.get_screenshot_as_png())).convert('RGB')
    return {c for _, c in im.getcolors(1 << 22)}

def page(js, *args):
    """Run JS in the site tab after switching to the extension page and back."""
    site = d.current_window_handle
    d.switch_to.window(popup)
    r = d.execute_script(js, *args)
    d.switch_to.window(site)
    return r

def tab_id():
    url = d.current_url
    return [t[0] for t in page("return chrome.tabs.query({}).then(t=>t.map(x=>[x.id,x.url]))") if t[1] == url][0]

def toggle():
    return page("return chrome.runtime.sendMessage({type:'popup:toggle',tabId:arguments[0]})", tab_id())

def set_settings(patch):
    page("return chrome.storage.sync.get('settings').then(r=>chrome.storage.sync.set({settings:{...r.settings,...arguments[0]}}))", patch)
    time.sleep(1)

SNAP = "return document.documentElement.outerHTML.replace(/<canvas[^>]*>/g,'')"
FIXED = """return [...document.querySelectorAll('body *')].filter(e=>['fixed','sticky'].includes(getComputedStyle(e).position))
  .map(e=>Math.round(e.getBoundingClientRect().top))"""

try:
    d.install_addon(os.path.abspath(xpi), temporary=True); time.sleep(1)
    before = set(d.window_handles)
    with d.context(d.CONTEXT_CHROME):
        d.execute_script("gBrowser.addTab(arguments[0], {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()})",
                         f'moz-extension://{UUID}/src/popup/popup.html')
    time.sleep(1.5); popup = (set(d.window_handles) - before).pop()
    d.switch_to.window(popup)
    d.execute_script("return chrome.storage.sync.get('settings')")  # wait for onInstalled defaults
    d.switch_to.window([h for h in d.window_handles if h != popup][0])

    print('fixture.html')
    d.get(BASE + 'fixture.html'); time.sleep(1)
    d.execute_script("const w=document.createElement('div');w.innerHTML='<div id=nested style=\"position:fixed;bottom:0;left:0;right:0;height:30px;background:#fff\"></div>';document.body.appendChild(w)")
    time.sleep(0.3)
    clean = d.execute_script(SNAP)
    check(toggle() == {'ok': True, 'on': True}, 'toggle on')
    time.sleep(1.5); d.execute_script('scrollTo(0,700)'); time.sleep(1)
    check(shot() <= DMG, 'only palette colours')
    check(d.execute_script("return document.querySelector('.fixed').getBoundingClientRect().top") == 0, 'fixed header pinned')
    check(round(d.execute_script("return innerHeight-document.getElementById('nested').getBoundingClientRect().bottom")) == 0, 'nested fixed footer pinned')
    check(round(d.execute_script("return document.querySelector('.sticky').getBoundingClientRect().top")) == 48, 'sticky bar sticks at 48px')
    f = d.execute_script("return [getComputedStyle(document.querySelector('main > img')).filter, getComputedStyle(document.querySelector('main')).filter]")
    check('pixelate' in f[0] and 'dmg-mode-filter' in f[1], 'image pixelated inside a filtered <main>')
    d.execute_script("const i=document.querySelector('main > img').cloneNode(); i.id='top-img'; document.body.prepend(i)"); time.sleep(0.2)
    f = d.execute_script("return getComputedStyle(document.getElementById('top-img')).filter")
    check('pixelate' in f and 'dmg-mode-filter' in f, 'image directly in <body> gets both filters')
    d.execute_script("document.getElementById('top-img').remove()")
    marks = d.execute_script("return [...document.querySelectorAll('[data-dmg-bg]')].map(e=>e.className+':'+e.dataset.dmgBg)")
    check(sorted(marks) == ['bg-img deco:direct', 'bg-img hero:layer'], f'background marks {marks}')
    check(d.execute_script("return document.fonts.check('16px \"DMG Pixelify\"')"), 'pixel font loaded')

    set_settings({'invert': True})
    check(shot() <= DMG, 'live setting change re-renders on palette')
    set_settings({'invert': False, 'pixelImages': False})
    check(d.execute_script("return document.querySelectorAll('[data-dmg-bg]').length") == 0, 'pixelate off clears background marks')
    set_settings({'pixelImages': True})

    check(toggle() == {'ok': True, 'on': False}, 'toggle off'); time.sleep(1)
    check(d.execute_script(SNAP) == clean, 'toggle off leaves the DOM exactly as before')

    print('tall page')
    d.get('https://example.com/'); time.sleep(1)
    d.execute_script("document.body.innerHTML='<div style=\"height:40000px;background:repeating-linear-gradient(#000 0 50px,#fff 50px 100px)\"></div>'")
    toggle(); time.sleep(1); d.execute_script('scrollTo(0,30000)'); time.sleep(1)
    cs = shot(); check(cs <= DMG and len(cs) >= 2, f'renders at 30,000px ({len(cs)} colours)')
    toggle()

    print('tab mode across origins (127.0.0.1 -> localhost)')
    d.get(BASE + 'fixture.html'); time.sleep(1); toggle(); time.sleep(0.5)
    d.execute_script("location.href=arguments[0]", f'http://localhost:{PORT}/test/pages/fonts.html'); time.sleep(4)
    check(shot() <= DMG, f'still on after cross-origin navigation ({d.current_url})')

    print('fonts.html (font-src none)')
    check(d.execute_script("return document.fonts.check('16px \"DMG Pixelify\"')"), 'pixel font applied under strict CSP')
    fams = d.execute_script("return ['.fa-solid','.material-icons','.nav-icon'].map(s=>getComputedStyle(document.querySelector(s)).fontFamily)")
    check(not any('DMG' in x for x in fams), f'icon fonts untouched {fams}')

    if '--real-sites' in sys.argv:
        for url in ['https://www.bbc.co.uk/news', 'https://www.ebay.co.uk/sch/i.html?_nkw=handheld',
                    'https://www.theguardian.com/uk', 'https://www.linkedin.com/']:
            print(url)
            d.get(url); time.sleep(4); d.execute_script('scrollTo(0,1500)'); time.sleep(1.5)
            if not page("return chrome.runtime.sendMessage({type:'popup:state',tabId:arguments[0]})", tab_id())['on']:
                toggle()
            d.execute_script('scrollTo(0,1400)'); time.sleep(0.5)
            fixed_before = d.execute_script(FIXED); time.sleep(1.5)
            d.execute_script('scrollTo(0,1500)'); time.sleep(1.5)
            check(shot() <= DMG, 'only palette colours')
            check(fixed_before == d.execute_script(FIXED), 'fixed/sticky positions unchanged')

    print('popup harness')
    d.get(f'{HARNESS}src/popup/harness.html'); time.sleep(1.5)
    q = d.execute_script
    check(q("return document.getElementById('shortcut').textContent") == 'Alt+Shift+G', 'popup shows the shortcut')
    check(q("return document.getElementById('follow-tab').checked") is True, 'tab mode checked by default')
    check(q("return !document.getElementById('follow-hint').hidden"), 'hint shown while all-sites access is missing')
    q("document.getElementById('toggle').click()"); time.sleep(0.5)
    check(q("return JSON.stringify(__h.calls)") == '[{"origins":["*://*/*"]}]', 'prompt requested for *://*/* on Turn on')
    check(q("return __h.store.sync.settings.followTab") is False, 'tab mode turned off after a decline')
    check(q("return document.getElementById('toggle').textContent") == 'Turn off', 'page still turned on in page mode')
    q("__h.request = true")
    q("const c=document.getElementById('follow-tab'); c.checked=true; c.dispatchEvent(new Event('change'))"); time.sleep(0.5)
    check(q("return __h.store.sync.settings.followTab") is True, 'tab mode saved after ticking it (grant path)')
    q("const r=document.getElementById('remember'); r.checked=true; r.dispatchEvent(new Event('change'))"); time.sleep(0.5)
    check(q("return !!__h.store.local.sites['https://example.com']") is True, 'site remembered')
finally:
    d.quit()
    srv.shutdown()
    harness_srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print('\nFAILED: ' + '; '.join(fails) if fails else '\nALL PASSED')
sys.exit(1 if fails else 0)
