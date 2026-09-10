// Follow-up probes for the book review: focus ring, perf repeatability, aborted requests, touch swipe at 768, layer count.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const PORT = process.env.PORT || 3152;
const BASE = `http://localhost:${PORT}/dev/harness-book.html`;
const SHOTS = path.join(__dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (s) => { out.push(s); console.log(s); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const vp of [{ w: 1440, h: 900, tag: 'desk' }, { w: 768, h: 1024, tag: 'tab', touch: true }, { w: 400, h: 800, tag: 'mob', touch: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: !!vp.touch });
    const page = await ctx.newPage();
    const errors = [], failed = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => failed.push(`${r.failure() && r.failure().errorText} ${r.url().split('/').pop()}`));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await sleep(800);

    // focus ring: reach the region by Shift+Tab from the Next button
    await page.focus('.flipbook__btn--next');
    await page.keyboard.press('Shift+Tab');
    const ring = await page.evaluate(() => ({ active: document.activeElement === document.querySelector('.flipbook'), outline: getComputedStyle(document.querySelector('.flipbook__stage')).outlineStyle, mouseCls: document.querySelector('.flipbook').classList.contains('is-mouse-focus') }));
    log(`${vp.tag}: Shift+Tab to region → ${JSON.stringify(ring)}`);
    await page.locator('.flipbook').screenshot({ path: path.join(SHOTS, `review-book-${vp.tag}-focus-ring.png`) });
    // button focus ring
    await page.keyboard.press('Tab');
    const bring = await page.evaluate(() => ({ active: document.activeElement.className, outline: getComputedStyle(document.activeElement).outlineStyle, w: getComputedStyle(document.activeElement).outlineWidth }));
    log(`${vp.tag}: Tab to Next → ${JSON.stringify(bring)}`);

    // layers: how many elements carry will-change?
    const layers = await page.evaluate(() => ({ willChange: [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).willChange !== 'auto').length, hiddenSheets: document.querySelectorAll('.flipbook__sheet.is-hidden').length }));
    log(`${vp.tag}: will-change elements ${layers.willChange}, hidden sheets ${layers.hiddenSheets}`);

    // perf: 3 runs, single next() at a time every 1.1 s (realistic cadence), 3.3 s each
    await page.evaluate(() => window.__book.goTo(20)); await sleep(2600);
    for (let run = 0; run < 3; run++) {
      const perf = await page.evaluate(() => new Promise((res) => {
        const gaps = []; let frames = 0, last = performance.now(); const t0 = last; let n = 0; const calls = [];
        const iv = setInterval(() => { const a = performance.now(); (n++ % 2 ? window.__book.prev : window.__book.next)(); calls.push(+(performance.now() - a).toFixed(1)); }, 1100);
        const tick = () => { const now = performance.now(); gaps.push(now - last); last = now; frames++; if (now - t0 < 3300) requestAnimationFrame(tick); else { clearInterval(iv); const s = gaps.slice().sort((a, b) => a - b); res({ fps: Math.round(frames / ((now - t0) / 1000)), max: Math.round(Math.max(...gaps)), p95: Math.round(s[Math.floor(s.length * 0.95)]), over50: gaps.filter((g) => g > 50).length, calls }); } };
        requestAnimationFrame(tick);
      }));
      log(`${vp.tag}: perf run ${run + 1}: ${JSON.stringify(perf)}`);
      await sleep(1200);
    }
    // perf of a long riffle (goTo far away)
    const riffle = await page.evaluate(() => new Promise((res) => {
      const gaps = []; let last = performance.now(); const t0 = last;
      const a = performance.now(); window.__book.goTo(80); const call = +(performance.now() - a).toFixed(1);
      const tick = () => { const now = performance.now(); gaps.push(now - last); last = now; if (now - t0 < 2200) requestAnimationFrame(tick); else res({ call, max: Math.round(Math.max(...gaps)), over50: gaps.filter((g) => g > 50).length, over32: gaps.filter((g) => g > 32).length }); };
      requestAnimationFrame(tick);
    }));
    log(`${vp.tag}: riffle goTo(80) from 20: ${JSON.stringify(riffle)}`);
    await sleep(500);

    // touch swipe (tab/mob)
    if (vp.touch) {
      await page.evaluate(() => window.__book.goTo(10)); await sleep(2600);
      const b = await page.locator('.flipbook__book').boundingBox();
      const before = await page.evaluate(() => document.querySelector('.flipbook').dataset.page);
      const swipe = async (dir) => {
        const x0 = b.x + b.width * 0.5, y = b.y + b.height * 0.5;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
        for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dir * 15 * i, y }] }); await sleep(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      };
      await swipe(+1); await sleep(1200);
      const afterR = await page.evaluate(() => document.querySelector('.flipbook').dataset.page);
      await swipe(-1); await sleep(1200);
      const afterL = await page.evaluate(() => document.querySelector('.flipbook').dataset.page);
      log(`${vp.tag}: real touch swipe right: page ${before} → ${afterR}; swipe left → ${afterL}`);
      // tap left half = next, right half = prev
      await page.touchscreen.tap(b.x + b.width * 0.2, b.y + b.height * 0.5); await sleep(1200);
      const tapL = await page.evaluate(() => document.querySelector('.flipbook').dataset.page);
      await page.touchscreen.tap(b.x + b.width * 0.8, b.y + b.height * 0.5); await sleep(1200);
      const tapR = await page.evaluate(() => document.querySelector('.flipbook').dataset.page);
      log(`${vp.tag}: tap left → ${tapL}; tap right → ${tapR}`);
      // did the tap paint the focus ring?
      const tapRing = await page.evaluate(() => ({ active: document.activeElement === document.querySelector('.flipbook'), outline: getComputedStyle(document.querySelector('.flipbook__stage')).outlineStyle }));
      log(`${vp.tag}: after tap: ${JSON.stringify(tapRing)}`);
      // vertical scroll gesture over the book must not turn a page
      const b2 = await page.locator('.flipbook__book').boundingBox();
      const cdp = await page.context().newCDPSession(page);
      const x = b2.x + b2.width / 2, y0 = b2.y + b2.height * 0.6;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 4 * i, y: y0 - 20 * i }] }); await sleep(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
      await sleep(600);
      const afterScroll = await page.evaluate(() => ({ page: document.querySelector('.flipbook').dataset.page, scrollY: window.scrollY }));
      log(`${vp.tag}: vertical drag over book: page ${tapR} → ${afterScroll.page}, scrollY ${afterScroll.scrollY}`);
    }

    // mid-turn screenshots at 300/500/700 ms for visual judgement (fast clips)
    await page.evaluate(() => window.__book.goTo(30)); await sleep(2600);
    for (const t of [250, 480, 700]) {
      const bb = await page.locator('.flipbook__stage').boundingBox();
      await page.evaluate(() => window.__book.next());
      await sleep(t);
      await page.screenshot({ path: path.join(SHOTS, `review-book-${vp.tag}-mid-${t}.png`), clip: { x: bb.x, y: Math.max(0, bb.y), width: bb.width, height: Math.min(bb.height + 8, vp.h - Math.max(0, bb.y)) } });
      await sleep(1100);
      await page.evaluate(() => window.__book.prev()); await sleep(1100);
    }
    // controls close-up
    await page.locator('.flipbook__controls').screenshot({ path: path.join(SHOTS, `review-book-${vp.tag}-controls.png`) });

    log(`${vp.tag}: console errors/warnings: ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
    log(`${vp.tag}: failed requests: ${failed.length} ${failed.slice(0, 6).join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'shots', 'review-book-probe.log'), out.join('\n'));
})().catch((e) => { console.error(e); process.exit(2); });
