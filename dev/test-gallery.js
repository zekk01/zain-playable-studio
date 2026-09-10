// Playwright check for js/gallery.js via dev/harness-gallery.html.
// Usage: node dev/test-gallery.js [port]   (starts server.js itself if nothing answers on the port)
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 3157;
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(ROOT, 'dev', 'shots');
const HARNESS = `${BASE}/dev/harness-gallery.html`;

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
function eq(name, actual, expected) { check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }

function ping() {
  return new Promise((resolve) => {
    const req = http.get(HARNESS, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}
async function ensureServer() {
  if (await ping()) return null;
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); if (await ping()) return child; }
  child.kill();
  throw new Error(`server did not start on ${PORT}`);
}

const SEL = {
  dialog: 'dialog#lightbox',
  counter: '#lightbox .lightbox__counter',
  prev: '#lightbox .lightbox__nav--prev',
  next: '#lightbox .lightbox__nav--next',
  close: '#lightbox .lightbox__close',
  thumbs: '#lightbox .lightbox__thumb',
  current: '#lightbox .lightbox__thumb[aria-current="true"]',
  google: '#lightbox .lightbox__google',
  error: '#lightbox .lightbox__error',
  imgOn: '#lightbox .lightbox__img.is-on',
};

async function makePage(browser, viewport, opts = {}) {
  const context = await browser.newContext({ viewport, hasTouch: !!opts.touch, reducedMotion: opts.reducedMotion || 'no-preference', deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    const loc = m.location() && m.location().url ? ` @ ${m.location().url}` : '';
    if (m.type() === 'error') errors.push(m.text() + loc); else if (m.type() === 'warning') warnings.push(m.text() + loc);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
  await page.goto(HARNESS, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return { page, context, errors, warnings };
}

const isOpen = (page) => page.$eval(SEL.dialog, (d) => d.open).catch(() => false);
const counter = (page) => page.$eval(SEL.counter, (el) => el.textContent.trim());
const focusedId = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);
const waitImage = (page) => page.waitForFunction((sel) => { const i = document.querySelector(sel); return i && i.complete && i.naturalWidth > 0; }, SEL.imgOn, { timeout: 8000 });
const settle = (page, ms = 320) => page.waitForTimeout(ms);

async function desktop(browser) {
  const { page, context, errors, warnings } = await makePage(browser, { width: 1440, height: 900 });
  const tag = 'desktop';

  const widthBefore = await page.evaluate(() => document.documentElement.clientWidth);
  const headerLeftBefore = await page.$eval('header', (h) => h.getBoundingClientRect().right);

  await page.click('#open-lala');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  check(`${tag}: dialog[open] after click`, await isOpen(page));
  await waitImage(page);
  await settle(page);
  eq(`${tag}: counter 1 / 9`, await counter(page), '1 / 9');
  eq(`${tag}: thumbnails count`, (await page.$$(SEL.thumbs)).length, 9);
  eq(`${tag}: current thumb is #1`, await page.$eval(SEL.current, (b) => b.dataset.i), '0');
  eq(`${tag}: nav visible`, await page.$eval(SEL.prev, (b) => !b.hidden && getComputedStyle(b).display !== 'none'), true);
  eq(`${tag}: no layout shift (html clientWidth)`, await page.evaluate(() => document.documentElement.clientWidth), widthBefore);
  eq(`${tag}: header does not shift`, await page.$eval('header', (h) => h.getBoundingClientRect().right), headerLeftBefore);
  eq(`${tag}: html overflow locked`, await page.evaluate(() => document.documentElement.style.overflow), 'hidden');

  // picture fits within the 86vh / 92vw budget and is not distorted
  const pic = await page.$eval('#lightbox .lightbox__pic', (p) => { const r = p.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  check(`${tag}: picture within 86vh × 92vw`, pic.w <= 1440 * 0.92 + 1 && pic.h <= 900 * 0.86 + 1, JSON.stringify(pic));
  check(`${tag}: picture keeps 4:3 aspect`, Math.abs(pic.w / pic.h - 792 / 594) < 0.01, (pic.w / pic.h).toFixed(3));
  await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-open.png') });

  await page.keyboard.press('ArrowRight');
  await settle(page);
  eq(`${tag}: ArrowRight → 2 / 9`, await counter(page), '2 / 9');
  eq(`${tag}: current thumb follows`, await page.$eval(SEL.current, (b) => b.dataset.i), '1');
  await page.keyboard.press('End');
  await settle(page);
  eq(`${tag}: End → 9 / 9`, await counter(page), '9 / 9');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  eq(`${tag}: wraps to 1 / 9`, await counter(page), '1 / 9');
  await page.keyboard.press('ArrowLeft');
  await settle(page);
  eq(`${tag}: ArrowLeft wraps to 9 / 9`, await counter(page), '9 / 9');
  await page.keyboard.press('Home');
  await settle(page);
  eq(`${tag}: Home → 1 / 9`, await counter(page), '1 / 9');

  // rapid navigation must settle on the last requested image without a broken state
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await settle(page, 700);
  eq(`${tag}: rapid nav settles on 7 / 9`, await counter(page), '7 / 9');
  eq(`${tag}: exactly one visible image slot`, (await page.$$(SEL.imgOn)).length, 1);
  eq(`${tag}: visible image is shot-07`, await page.$eval(SEL.imgOn, (i) => i.getAttribute('src')), 'assets/img/lalapoker/shot-07.jpg');

  // thumbnails jump
  await page.click(`${SEL.thumbs}[data-i="3"]`);
  await settle(page);
  eq(`${tag}: thumb click → 4 / 9`, await counter(page), '4 / 9');
  await page.click(SEL.next);
  await settle(page);
  eq(`${tag}: next button → 5 / 9`, await counter(page), '5 / 9');
  await page.click(SEL.prev);
  await settle(page);
  eq(`${tag}: prev button → 4 / 9`, await counter(page), '4 / 9');

  // focus trap: Tab cycles inside the dialog
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    seen.add(await page.evaluate(() => { const a = document.activeElement; return a.closest('#lightbox') ? a.className.split(' ')[0] : 'OUTSIDE:' + (a.id || a.tagName); }));
  }
  check(`${tag}: focus stays inside dialog`, ![...seen].some((s) => s.startsWith('OUTSIDE')), [...seen].join(', '));
  check(`${tag}: focus reaches close / nav / thumb`, seen.has('lightbox__close') && seen.has('lightbox__nav') && seen.has('lightbox__thumb'), [...seen].join(', '));
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  check(`${tag}: Shift+Tab stays inside`, await page.evaluate(() => !!document.activeElement.closest('#lightbox')));

  // mid-animation screenshot of the crossfade (documentation only)
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(90);
  await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-crossfade.png') });
  await settle(page);

  // Escape closes and returns focus
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });
  eq(`${tag}: Escape closes`, await isOpen(page), false);
  eq(`${tag}: focus returns to opener`, await focusedId(page), 'open-lala');
  eq(`${tag}: html overflow restored`, await page.evaluate(() => document.documentElement.style.overflow), '');
  eq(`${tag}: only one dialog in DOM`, (await page.$$('dialog#lightbox')).length, 1);
  eq(`${tag}: only one style injected`, (await page.$$('style#lightbox-style')).length, 1);

  // re-open a different gallery → the same dialog is re-used, google link present
  await page.click('#open-hxr');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await waitImage(page);
  await settle(page);
  eq(`${tag}: HXR counter 1 / 5`, await counter(page), '1 / 5');
  eq(`${tag}: HXR thumbnails count`, (await page.$$(SEL.thumbs)).length, 5);
  eq(`${tag}: title rendered`, await page.$eval('#lightbox .lightbox__title', (t) => t.textContent), 'Hologram Cloud');
  const link = await page.$eval(SEL.google, (a) => ({ hidden: a.hidden, target: a.target, rel: a.rel, href: a.href }));
  check(`${tag}: google link (target _blank, rel noopener)`, !link.hidden && link.target === '_blank' && /noopener/.test(link.rel) && /google\.com\/search/.test(link.href), JSON.stringify(link));
  const wide = await page.$eval('#lightbox .lightbox__pic', (p) => { const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  check(`${tag}: wide image fits`, wide.w <= 1440 * 0.92 + 1 && Math.abs(wide.w / wide.h - 1600 / 789) < 0.02, JSON.stringify(wide));
  await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-hxr.png') });

  // close via the × button → focus returns to the HXR opener
  await page.click(SEL.close);
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });
  eq(`${tag}: close button closes`, await isOpen(page), false);
  eq(`${tag}: focus returns to HXR opener`, await focusedId(page), 'open-hxr');

  // single image: nav + thumbs hidden, backdrop click closes
  await page.click('#open-single');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await waitImage(page);
  await settle(page);
  eq(`${tag}: single counter 1 / 1`, await counter(page), '1 / 1');
  eq(`${tag}: single hides prev`, await page.$eval(SEL.prev, (b) => getComputedStyle(b).display), 'none');
  eq(`${tag}: single hides next`, await page.$eval(SEL.next, (b) => getComputedStyle(b).display), 'none');
  eq(`${tag}: single hides thumbs`, await page.$eval('#lightbox .lightbox__thumbs', (t) => getComputedStyle(t).display), 'none');
  eq(`${tag}: single hides google link`, await page.$eval(SEL.google, (a) => getComputedStyle(a).display), 'none');
  const gapSingle = await page.evaluate(() => document.querySelector('#lightbox .lightbox__caption').getBoundingClientRect().top - document.querySelector('#lightbox .lightbox__pic').getBoundingClientRect().bottom);
  check(`${tag}: caption hugs the picture (single)`, gapSingle >= 0 && gapSingle <= 24, `${Math.round(gapSingle)}px`);
  const centred = await page.evaluate(() => { const b = document.querySelector('#lightbox .lightbox__body').getBoundingClientRect(); const p = document.querySelector('#lightbox .lightbox__pic').getBoundingClientRect(); const c = document.querySelector('#lightbox .lightbox__caption').getBoundingClientRect(); return Math.abs((p.top - b.top) - (b.bottom - c.bottom)); });
  check(`${tag}: picture + caption centred as a group`, centred <= 2, `${Math.round(centred)}px off`);
  await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-single.png') });
  await page.mouse.click(30, 450);
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });
  eq(`${tag}: backdrop click closes`, await isOpen(page), false);
  eq(`${tag}: focus returns to single opener`, await focusedId(page), 'open-single');

  // click on the picture itself must NOT close
  await page.click('#open-lala');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await waitImage(page);
  await settle(page);
  await page.click('#lightbox .lightbox__pic');
  await settle(page);
  eq(`${tag}: click on picture keeps it open`, await isOpen(page), true);
  // mouse drag on the picture steps (same code path as touch swipe)
  const box = await page.$eval('#lightbox .lightbox__pic', (p) => { const r = p.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x - i * 15, box.y + i, { steps: 1 });
  await page.mouse.up();
  await settle(page);
  eq(`${tag}: drag left → 2 / 9`, await counter(page), '2 / 9');
  eq(`${tag}: drag does not close`, await isOpen(page), true);

  // frame-rate sample while navigating (informational)
  const fps = await page.evaluate(async () => {
    const d = document.getElementById('lightbox');
    let frames = 0;
    const t0 = performance.now();
    const nav = setInterval(() => d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })), 120);
    await new Promise((res) => { const tick = () => { frames++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    clearInterval(nav);
    return Math.round(frames / ((performance.now() - t0) / 1000));
  });
  console.log(`INFO  ${tag}: sampled ${fps} fps while stepping through images (headless)`);
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });

  // error state
  await page.click('#open-broken');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await page.waitForFunction((sel) => !document.querySelector(sel).hidden, SEL.error, { timeout: 5000 });
  await settle(page);
  eq(`${tag}: broken image shows "Image unavailable"`, await page.$eval(SEL.error, (e) => e.textContent.includes('Image unavailable')), true);
  eq(`${tag}: broken counter 2 / 3`, await counter(page), '2 / 3');
  await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-error.png') });
  await page.keyboard.press('ArrowRight');
  await waitImage(page);
  await settle(page);
  eq(`${tag}: error panel hides after moving on`, await page.$eval(SEL.error, (e) => e.hidden), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });

  // the 404 for the deliberately broken image is expected; anything else is a failure
  const unexpected = errors.filter((e) => !/does-not-exist\.jpg/.test(e));
  eq(`${tag}: zero console errors`, unexpected.length, 0);
  if (unexpected.length) console.log(unexpected.join('\n'));
  eq(`${tag}: zero console warnings`, warnings.length, 0);
  if (warnings.length) console.log(warnings.join('\n'));
  await context.close();
  return fps;
}

async function mobile(browser) {
  const { page, context, errors, warnings } = await makePage(browser, { width: 400, height: 800 }, { touch: true });
  const tag = 'mobile';
  await page.tap('#open-lala');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await waitImage(page);
  await settle(page);
  eq(`${tag}: counter 1 / 9`, await counter(page), '1 / 9');
  eq(`${tag}: thumbnails count`, (await page.$$(SEL.thumbs)).length, 9);
  const pic = await page.$eval('#lightbox .lightbox__pic', (p) => { const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });
  check(`${tag}: picture within 92vw`, pic.w <= 400 * 0.92 + 1, JSON.stringify(pic));
  const nb = await page.$eval(SEL.next, (b) => b.getBoundingClientRect());
  const pb = await page.$eval(SEL.prev, (b) => b.getBoundingClientRect());
  check(`${tag}: nav buttons overlay picture bottom corners`, nb.bottom <= pic.bottom + 1 && nb.right <= pic.right + 1 && pb.left >= pic.x - 1 && pb.bottom <= pic.bottom + 1 && nb.y >= pic.y, JSON.stringify({ nb, pb }));
  const rows = await page.$$eval(SEL.thumbs, (ts) => new Set(ts.map((t) => Math.round(t.getBoundingClientRect().top))).size);
  check(`${tag}: thumbs wrap onto multiple rows`, rows > 1, `${rows} rows`);
  const gapMobile = await page.evaluate(() => document.querySelector('#lightbox .lightbox__caption').getBoundingClientRect().top - document.querySelector('#lightbox .lightbox__pic').getBoundingClientRect().bottom);
  check(`${tag}: caption hugs the picture`, gapMobile >= 0 && gapMobile <= 24, `${Math.round(gapMobile)}px`);
  eq(`${tag}: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(SHOTS, 'gallery-mobile-open.png') });

  await page.keyboard.press('ArrowRight');
  await settle(page);
  eq(`${tag}: ArrowRight → 2 / 9`, await counter(page), '2 / 9');
  await page.keyboard.press('End');
  await settle(page);
  eq(`${tag}: End → 9 / 9`, await counter(page), '9 / 9');

  // touch swipe (right → previous)
  const c = await page.$eval('#lightbox .lightbox__pic', (p) => { const r = p.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.evaluate(async ({ x, y }) => {
    const stage = document.querySelector('#lightbox .lightbox__stage');
    const ev = (type, cx) => stage.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y, bubbles: true, button: 0, buttons: 1 }));
    ev('pointerdown', x);
    for (let i = 1; i <= 8; i++) { ev('pointermove', x + i * 14); await new Promise((r) => setTimeout(r, 12)); }
    ev('pointerup', x + 112);
  }, c);
  await settle(page);
  eq(`${tag}: swipe right → 8 / 9`, await counter(page), '8 / 9');

  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });
  eq(`${tag}: Escape closes`, await isOpen(page), false);
  eq(`${tag}: focus returns to opener`, await focusedId(page), 'open-lala');

  await page.tap('#open-hxr');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await waitImage(page);
  await settle(page);
  await page.screenshot({ path: path.join(SHOTS, 'gallery-mobile-hxr.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });

  await page.tap('#open-single');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await waitImage(page);
  await settle(page);
  eq(`${tag}: single hides nav`, await page.$eval(SEL.next, (b) => getComputedStyle(b).display), 'none');
  await page.screenshot({ path: path.join(SHOTS, 'gallery-mobile-single.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });

  eq(`${tag}: zero console errors`, errors.length, 0);
  if (errors.length) console.log(errors.join('\n'));
  eq(`${tag}: zero console warnings`, warnings.length, 0);
  if (warnings.length) console.log(warnings.join('\n'));
  await context.close();
}

async function reducedMotion(browser) {
  const { page, context, errors } = await makePage(browser, { width: 1440, height: 900 }, { reducedMotion: 'reduce' });
  const tag = 'reduced-motion';
  await page.click('#open-lala');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  const anims = await page.$eval(SEL.dialog, (d) => d.getAnimations({ subtree: true }).length);
  eq(`${tag}: no animations on open`, anims, 0);
  eq(`${tag}: dialog fully opaque immediately`, await page.$eval(SEL.dialog, (d) => getComputedStyle(d).opacity), '1');
  await waitImage(page);
  eq(`${tag}: image visible without transition`, await page.$eval(SEL.imgOn, (i) => getComputedStyle(i).opacity), '1');
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });
  eq(`${tag}: Escape closes instantly`, await isOpen(page), false);
  eq(`${tag}: zero console errors`, errors.length, 0);
  await context.close();
}

async function edgeCases(browser) {
  const { page, context, errors, warnings } = await makePage(browser, { width: 1440, height: 900 });
  const tag = 'edge';
  const closed = () => page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });
  const call = (fn, ...args) => page.evaluate(async ([name, a]) => { const m = await import('/js/gallery.js'); m[name](...a); }, [fn, args]);

  // open animation actually runs (and a frame of it is captured)
  await page.click('#open-lala');
  const running = await page.$eval(SEL.dialog, (d) => d.getAnimations({ subtree: true }).some((a) => a.playState === 'running'));
  check(`${tag}: open animation running right after open`, running);
  await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-opening.png') });
  await waitImage(page);
  await settle(page, 400);

  // crossfade is a fade-over: while the incoming image fades in, the outgoing one is still opaque underneath
  await page.keyboard.press('ArrowRight');
  const mid = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 60));
    const imgs = [...document.querySelectorAll('#lightbox .lightbox__img')];
    return imgs.map((i) => ({ cls: i.className.replace('lightbox__img', '').trim(), op: Number(getComputedStyle(i).opacity), z: getComputedStyle(i).zIndex }));
  });
  const on = mid.find((m) => m.cls.includes('is-on'));
  const off = mid.find((m) => m.cls.includes('is-off'));
  check(`${tag}: fade-over (incoming above, outgoing opaque)`, !!on && !!off && off.op === 1 && Number(on.z) > Number(off.z), JSON.stringify(mid));
  await settle(page, 400);
  eq(`${tag}: outgoing slot dropped after fade`, (await page.$$('#lightbox .lightbox__img.is-off')).length, 0);

  // double Escape during the close animation, then re-open: no leftover 'forwards' fill
  await page.keyboard.press('Escape');
  await page.waitForTimeout(40);
  await page.keyboard.press('Escape');
  await closed();
  await settle(page, 300);
  await page.click('#open-lala');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await waitImage(page);
  await settle(page, 400);
  eq(`${tag}: re-open after double Escape is opaque`, await page.$eval(SEL.dialog, (d) => getComputedStyle(d).opacity), '1');
  eq(`${tag}: no lingering animations`, await page.$eval(SEL.dialog, (d) => d.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished').length), 0);
  eq(`${tag}: image visible after re-open`, await page.$eval(SEL.imgOn, (i) => getComputedStyle(i).opacity), '1');

  // switching galleries while open re-uses the open dialog
  await call('openGallery', [{ src: 'assets/img/hxr/holo-wireframe.jpg', alt: 'A' }, { src: 'assets/img/hxr/event.jpg', alt: 'B' }], 1, { title: 'Switched' });
  await waitImage(page);
  await settle(page);
  eq(`${tag}: switch while open → 2 / 2`, await counter(page), '2 / 2');
  eq(`${tag}: switch keeps dialog open`, await isOpen(page), true);
  eq(`${tag}: still one dialog`, (await page.$$('dialog#lightbox')).length, 1);
  check(`${tag}: focus still inside after switch`, await page.evaluate(() => !!document.activeElement.closest('#lightbox')));

  // 15 thumbs overflow the strip at 1440 → strip scrolls to keep the current one in view
  await call('openGallery', Array.from({ length: 15 }, (_, i) => ({ src: `assets/img/lalapoker/shot-${String(i + 1).padStart(2, '0')}.jpg`, alt: `Shot ${i + 1}` })), 0, { title: 'Lala Poker' });
  await waitImage(page);
  await settle(page);
  const before = await page.$eval('#lightbox .lightbox__thumbs', (t) => ({ sl: t.scrollLeft, over: t.scrollWidth > t.clientWidth }));
  await page.keyboard.press('End');
  await settle(page, 800);
  const after = await page.$eval('#lightbox .lightbox__thumbs', (t) => t.scrollLeft);
  check(`${tag}: thumb strip overflows and scrolls to current`, before.over && after > before.sl, JSON.stringify({ before, after }));
  check(`${tag}: current thumb fully visible after End`, await page.$eval(SEL.current, (b) => { const r = b.getBoundingClientRect(); const s = b.parentElement.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; }));
  await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-15.png') });

  // destroyGallery() removes everything, restores the page, and the module still works afterwards
  await call('destroyGallery');
  eq(`${tag}: destroy removes dialog`, (await page.$$('dialog#lightbox')).length, 0);
  eq(`${tag}: destroy removes style`, (await page.$$('style#lightbox-style')).length, 0);
  eq(`${tag}: destroy restores scroll`, await page.evaluate(() => document.documentElement.style.overflow), '');
  eq(`${tag}: destroy restores focus to opener`, await focusedId(page), 'open-lala');
  await page.click('#open-single');
  await page.waitForSelector(`${SEL.dialog}[open]`);
  await waitImage(page);
  eq(`${tag}: works again after destroy`, await counter(page), '1 / 1');
  await call('closeGallery');
  await closed();
  eq(`${tag}: closeGallery() closes`, await isOpen(page), false);

  eq(`${tag}: zero console errors`, errors.length, 0);
  if (errors.length) console.log(errors.join('\n'));
  eq(`${tag}: zero console warnings`, warnings.length, 0);
  if (warnings.length) console.log(warnings.join('\n'));
  await context.close();
}


/* ------------------------------------------------------------------ regression suite for the reviewed issues */

// 1. Real (classic) scrollbars: Playwright's headless default is --hide-scrollbars, which makes the gutter 0 and
//    hides any layout shift. Launch a second browser with scrollbars on, as a Windows/Linux visitor would have.
async function scrollbars() {
  const tag = 'scrollbars';
  const browser = await chromium.launch({ channel: 'msedge', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const { page, context, errors, warnings } = await makePage(browser, { width: 1440, height: 900 });
    // Note: while the gutter is reserved Chromium reports documentElement.clientWidth as the full viewport even
    // though nothing moved, so layout is judged by real boxes: body width, the fixed header, the h1.
    const metrics = () => page.evaluate(() => ({
      gutter: window.innerWidth - document.documentElement.clientWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.getBoundingClientRect().width,
      headerRight: document.querySelector('header').getBoundingClientRect().right,
      h1Left: document.querySelector('h1').getBoundingClientRect().left,
      sg: document.documentElement.style.scrollbarGutter,
      overflow: document.documentElement.style.overflow,
      supports: CSS.supports('scrollbar-gutter', 'stable'),
    }));
    const before = await metrics();
    check(`${tag}: page has a classic scrollbar (gutter > 0)`, before.gutter > 0, JSON.stringify(before));
    await page.click('#open-lala');
    await page.waitForSelector(`${SEL.dialog}[open]`);
    await waitImage(page);
    await settle(page);
    const open = await metrics();
    eq(`${tag}: overflow locked`, open.overflow, 'hidden');
    eq(`${tag}: scrollbar-gutter: stable applied while open`, open.sg, open.supports ? 'stable' : '');
    eq(`${tag}: body width unchanged while open`, open.bodyWidth, before.bodyWidth);
    eq(`${tag}: fixed header right edge unchanged while open`, open.headerRight, before.headerRight);
    eq(`${tag}: h1 left edge unchanged while open`, open.h1Left, before.h1Left);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-scrollbars-open.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });
    const after = await metrics();
    eq(`${tag}: overflow restored`, after.overflow, '');
    eq(`${tag}: scrollbar-gutter restored`, after.sg, '');
    eq(`${tag}: clientWidth restored`, after.clientWidth, before.clientWidth);
    eq(`${tag}: body width restored`, after.bodyWidth, before.bodyWidth);
    eq(`${tag}: header right edge restored`, after.headerRight, before.headerRight);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-scrollbars-closed.png') });
    eq(`${tag}: zero console errors`, errors.length, 0);
    if (errors.length) console.log(errors.join('\n'));
    eq(`${tag}: zero console warnings`, warnings.length, 0);
    await context.close();
  } finally {
    await browser.close();
  }
}

// 2-6. Behavioural regressions in the default browser.
async function fixes(browser) {
  const tag = 'fixes';
  const closedWait = (page) => page.waitForFunction((sel) => !document.querySelector(sel).open, SEL.dialog, { timeout: 3000 });
  const snapshot = (page) => page.evaluate(() => {
    const d = document.getElementById('lightbox');
    const on = d && d.querySelector('.lightbox__img.is-on');
    return {
      open: !!(d && d.open), dialogs: document.querySelectorAll('dialog#lightbox').length,
      overflow: document.documentElement.style.overflow,
      counter: d ? d.querySelector('.lightbox__counter').textContent.trim() : null,
      imgSrc: on ? on.getAttribute('src') : null, imgDone: !!(on && on.complete && on.naturalWidth > 0),
      spinner: !!(d && d.querySelector('.lightbox__spin').classList.contains('is-on')),
      error: d ? d.querySelector('.lightbox__error').hidden : null,
      sr: d ? d.querySelector('.lightbox__sr').textContent : null,
      onSlots: d ? d.querySelectorAll('.lightbox__img.is-on').length : 0,
      thumbsWithSrc: d ? d.querySelectorAll('.lightbox__thumb img[src]').length : 0,
      thumbsPending: d ? d.querySelectorAll('.lightbox__thumb img[data-src]').length : 0,
      role: d ? d.querySelector('.lightbox__thumbs').getAttribute('role') : null,
    };
  });

  // --- drop-timer race: two navigations within 260ms whose second target is still downloading -----------------
  {
    const { page, context, errors, warnings } = await makePage(browser, { width: 1440, height: 900 });
    const requests = [];
    page.on('request', (r) => { if (/shot-\d\d\.jpg/.test(r.url())) requests.push(r.url().replace(/.*\//, '')); });
    await page.route('**/shot-05.jpg*', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });

    // Open synchronously and read the DOM in the same task: on localhost a memory-cached first picture lands
    // within a few ms, so an async check could never prove what the strip looked like at open time.
    await page.focus('#open-lala');
    const early = await page.evaluate(async () => {
      const m = await import('/js/gallery.js');
      const lala = Array.from({ length: 9 }, (_, i) => ({ src: `assets/img/lalapoker/shot-${String(i + 1).padStart(2, '0')}.jpg`, alt: `Shot ${i + 1}` }));
      m.openGallery(lala, 0, { title: 'Lala Poker' });
      const d = document.getElementById('lightbox');
      return {
        thumbsWithSrc: d.querySelectorAll('.lightbox__thumb img[src]').length,
        thumbsPending: d.querySelectorAll('.lightbox__thumb img[data-src]').length,
        slotSrcs: [...d.querySelectorAll('.lightbox__img')].map((i) => i.getAttribute('src')),
        role: d.querySelector('.lightbox__thumbs').getAttribute('role'),
      };
    });
    await page.waitForSelector(`${SEL.dialog}[open]`);
    eq(`${tag}: thumbs have no src at open time`, early.thumbsWithSrc, 0);
    eq(`${tag}: thumbs hold data-src at open time`, early.thumbsPending, 9);
    check(`${tag}: only the requested picture has a src at open time`, early.slotSrcs.filter(Boolean).join() === 'assets/img/lalapoker/shot-01.jpg', JSON.stringify(early.slotSrcs));
    eq(`${tag}: role=group on the thumb strip`, early.role, 'group');
    await waitImage(page);
    eq(`${tag}: first network request is the requested picture`, requests[0], 'shot-01.jpg');
    await settle(page, 400);
    const hydrated = await snapshot(page);
    eq(`${tag}: thumbs hydrated after the first picture`, hydrated.thumbsWithSrc, 9);
    eq(`${tag}: fetchpriority=low on thumbs`, await page.$$eval('#lightbox .lightbox__thumb img', (ts) => ts.every((t) => t.getAttribute('fetchpriority') === 'low')), true);
    eq(`${tag}: fetchpriority=high on picture slots`, await page.$$eval('#lightbox .lightbox__img', (ts) => ts.every((t) => t.getAttribute('fetchpriority') === 'high')), true);

    // shot-02 is cached by now (neighbour preload) → ArrowRight swaps within ~10ms and arms the drop timer;
    // the thumb click 60ms later re-uses the outgoing slot for shot-05, which takes 1500ms to arrive.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(60);
    await page.click(`${SEL.thumbs}[data-i="4"]`);
    await page.waitForTimeout(400);                   // past the 260ms drop window, still loading
    const mid = await snapshot(page);
    eq(`${tag}: (mid-load) counter already 5 / 9`, mid.counter, '5 / 9');
    eq(`${tag}: (mid-load) spinner on`, mid.spinner, true);
    eq(`${tag}: (mid-load) loading slot keeps its src`, await page.$$eval('#lightbox .lightbox__img', (ts) => ts.map((t) => t.getAttribute('src') || '').some((s) => /shot-05/.test(s))), true);
    await page.waitForFunction(() => { const i = document.querySelector('#lightbox .lightbox__img.is-on'); return i && /shot-05/.test(i.getAttribute('src') || '') && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
    await settle(page, 350);
    const done = await snapshot(page);
    eq(`${tag}: (settled) counter 5 / 9`, done.counter, '5 / 9');
    eq(`${tag}: (settled) visible image is shot-05`, done.imgSrc, 'assets/img/lalapoker/shot-05.jpg');
    eq(`${tag}: (settled) image decoded`, done.imgDone, true);
    eq(`${tag}: (settled) spinner off`, done.spinner, false);
    eq(`${tag}: (settled) error hidden`, done.error, true);
    eq(`${tag}: (settled) exactly one visible slot`, done.onSlots, 1);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-drop-race.png') });

    // hammer: 12 navigations at 40ms onto slow + fast targets, must settle on the last one
    for (let i = 0; i < 12; i++) { await page.keyboard.press(i % 3 === 0 ? 'End' : 'ArrowRight'); await page.waitForTimeout(40); }
    await page.waitForTimeout(2500);
    const hammer = await snapshot(page);
    // sequence: End(9) → 1 → 2 → End(9) → 1 → 2 → End(9) → 1 → 2 → End(9) → 1 → 2
    eq(`${tag}: hammer settles on 2 / 9`, hammer.counter, '2 / 9');
    eq(`${tag}: hammer shows shot-02`, hammer.imgSrc, 'assets/img/lalapoker/shot-02.jpg');
    eq(`${tag}: hammer leaves no spinner`, hammer.spinner, false);
    eq(`${tag}: hammer leaves one visible slot`, hammer.onSlots, 1);

    // --- mouse drag started beside the picture must step, and must NOT close --------------------------------
    await page.keyboard.press('Home');
    await settle(page);
    const pic = await page.$eval('#lightbox .lightbox__pic', (p) => { const r = p.getBoundingClientRect(); return { left: r.left, y: r.y + r.height / 2 }; });
    await page.mouse.move(pic.left - 30, pic.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(pic.left - 30 - i * 12, pic.y + i, { steps: 1 });
    await page.mouse.up();
    await settle(page, 400);
    const dragged = await snapshot(page);
    eq(`${tag}: drag beside the picture keeps the dialog open`, dragged.open, true);
    eq(`${tag}: drag beside the picture steps to 2 / 9`, dragged.counter, '2 / 9');
    // a plain click in the same place (no movement) still closes
    await page.mouse.click(pic.left - 30, pic.y);
    await closedWait(page);
    eq(`${tag}: plain backdrop click still closes`, await isOpen(page), false);
    eq(`${tag}: focus back on opener after backdrop close`, await focusedId(page), 'open-lala');

    eq(`${tag}: zero console errors (race/drag)`, errors.length, 0);
    if (errors.length) console.log(errors.join('\n'));
    eq(`${tag}: zero console warnings (race/drag)`, warnings.length, 0);
    await context.close();
  }

  // --- queued native 'close' event vs. a synchronous re-open (reduced motion closes synchronously) ------------
  {
    const { page, context, errors } = await makePage(browser, { width: 1440, height: 900 }, { reducedMotion: 'reduce' });
    const two = [{ src: 'assets/img/hxr/holo-wireframe.jpg', alt: 'A' }, { src: 'assets/img/hxr/event.jpg', alt: 'B' }];
    await page.click('#open-lala');
    await page.waitForSelector(`${SEL.dialog}[open]`);
    await waitImage(page);
    await page.evaluate(async ([imgs]) => { const m = await import('/js/gallery.js'); m.closeGallery(); m.openGallery(imgs, 1, { title: 'Re-opened' }); }, [two]);
    await page.waitForTimeout(500);
    const a = await snapshot(page);
    eq(`${tag}: close→open same task: dialog open`, a.open, true);
    eq(`${tag}: close→open same task: scroll still locked`, a.overflow, 'hidden');
    eq(`${tag}: close→open same task: counter 2 / 2`, a.counter, '2 / 2');
    eq(`${tag}: close→open same task: image shown`, a.imgSrc, 'assets/img/hxr/event.jpg');
    check(`${tag}: close→open same task: live region announces`, /Image 2 of 2/.test(a.sr || ''), JSON.stringify(a.sr));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    eq(`${tag}: close→open same task: keyboard alive (1 / 2)`, await counter(page), '1 / 2');

    await page.evaluate(async ([imgs]) => { const m = await import('/js/gallery.js'); m.destroyGallery(); m.openGallery(imgs, 1, { title: 'After destroy' }); }, [two]);
    await page.waitForTimeout(500);
    const b = await snapshot(page);
    eq(`${tag}: destroy→open same task: one dialog`, b.dialogs, 1);
    eq(`${tag}: destroy→open same task: dialog open`, b.open, true);
    eq(`${tag}: destroy→open same task: scroll locked`, b.overflow, 'hidden');
    eq(`${tag}: destroy→open same task: counter 2 / 2`, b.counter, '2 / 2');
    eq(`${tag}: destroy→open same task: image shown`, b.imgSrc, 'assets/img/hxr/event.jpg');
    eq(`${tag}: destroy→open same task: one style`, (await page.$$('style#lightbox-style')).length, 1);
    await page.keyboard.press('Escape');
    await closedWait(page);
    eq(`${tag}: destroy→open: Escape still closes`, await isOpen(page), false);
    eq(`${tag}: destroy→open: scroll unlocked on close`, await page.evaluate(() => document.documentElement.style.overflow), '');
    eq(`${tag}: destroy→open: focus restored`, await focusedId(page), 'open-lala');
    eq(`${tag}: zero console errors (reopen)`, errors.length, 0);
    if (errors.length) console.log(errors.join('\n'));
    await context.close();
  }

  // --- slow first picture: the strip is hydrated by the fallback timer, not left blank ----------------------
  {
    const { page, context, errors } = await makePage(browser, { width: 1440, height: 900 });
    await page.route('**/shot-01.jpg*', async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
    await page.click('#open-lala');
    await page.waitForSelector(`${SEL.dialog}[open]`);
    await page.waitForTimeout(600);
    eq(`${tag}: slow hero: thumbs still pending at 600ms`, (await snapshot(page)).thumbsWithSrc, 0);
    await page.waitForTimeout(1000);
    eq(`${tag}: slow hero: thumbs hydrated by fallback (~1.2s)`, (await snapshot(page)).thumbsWithSrc, 9);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-desktop-slow-hero.png') });
    await waitImage(page);
    await settle(page);
    eq(`${tag}: slow hero: picture lands`, (await snapshot(page)).imgSrc, 'assets/img/lalapoker/shot-01.jpg');
    await page.keyboard.press('Escape');
    await closedWait(page);
    eq(`${tag}: zero console errors (slow hero)`, errors.length, 0);
    if (errors.length) console.log(errors.join('\n'));
    await context.close();
  }
}

(async () => {
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let fps = null;
  try {
    fps = await desktop(browser);
    await mobile(browser);
    await reducedMotion(browser);
    await edgeCases(browser);
    await fixes(browser);
    await scrollbars();
  } catch (e) {
    check('run completed without exception', false, e.stack || String(e));
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log(`\n${results.length - failures}/${results.length} checks passed${fps != null ? `, ~${fps} fps sampled` : ''}`);
  process.exit(failures ? 1 : 0);
})();
