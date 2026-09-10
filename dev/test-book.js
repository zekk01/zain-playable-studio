// Playwright checks for js/book.js via dev/harness-book.html.
// Usage: cd D:/Portfolio && PORT=3202 node server.js   (in another shell)   then   PORT=3202 node dev/test-book.js
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));

const PORT = process.env.PORT || 3202;
const BASE = `http://localhost:${PORT}/dev/harness-book.html`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
const check = (name, ok, info = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  — ${info}` : ''}`);
  if (!ok) failures++;
};

// Sample the sheet stacks every ~40 ms while a jump runs. Returns one row per sample:
// flatL / flatR = settled, visible sheets on the left (unturned) / right (turned) stack; fly = sheets in flight;
// flyImg = flying sheets whose visible faces carry an <img src>; c = data-turns.
const sampleRiffle = (page, target, ms) => page.evaluate(([target, ms]) => new Promise((res) => {
  const rows = [];
  const t0 = performance.now();
  window.__book.goTo(target);
  const tick = () => {
    const sheets = [...document.querySelectorAll('.flipbook__sheet')];
    const row = { t: Math.round(performance.now() - t0), flatL: 0, flatR: 0, fly: 0, flyImg: 0 };
    for (const s of sheets) {
      const hidden = s.classList.contains('is-hidden');
      const turning = s.classList.contains('is-turning');
      const turned = /rotateY\((180|175)deg\)/.test(s.style.transform);
      if (turning) { row.fly++; if (s.querySelectorAll('.flipbook__face img[src]').length) row.flyImg++; continue; }
      if (hidden) continue;
      if (turned) row.flatR++; else row.flatL++;
    }
    rows.push(row);
    if (performance.now() - t0 < ms) setTimeout(tick, 40); else res(rows);
  };
  tick();
}), [target, ms]);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const fpsByViewport = {};

  for (const vp of [{ w: 1440, h: 900, tag: 'desktop' }, { w: 400, h: 800, tag: 'mobile' }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: vp.tag === 'mobile' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await page.waitForFunction(() => document.querySelectorAll('.flipbook__face.is-loaded img').length >= 1, null, { timeout: 15000 }).catch(() => {});
    await sleep(400);

    const counter = () => page.$eval('.flipbook__counter-en', (n) => n.textContent.trim());
    const shot = (name) => page.locator('.flipbook').screenshot({ path: path.join(SHOTS, `book-${vp.tag}-${name}.png`) });
    // Fast viewport clip for mid-animation captures (element screenshots can take longer than a turn).
    const shotFast = async (name) => {
      const bb = await page.locator('.flipbook__stage').boundingBox();
      const y = Math.max(0, bb.y), h = Math.min(bb.height + 8, vp.h - y);
      await page.screenshot({ path: path.join(SHOTS, `book-${vp.tag}-${name}.png`), clip: { x: bb.x, y, width: bb.width, height: h } });
    };
    const srcCount = () => page.$$eval('.flipbook__face img[src]', (ns) => ns.length);
    const mode = await page.$eval('.flipbook', (n) => (n.classList.contains('flipbook--single') ? 'single' : 'spread'));
    check(`${vp.tag}: mode`, mode === (vp.tag === 'mobile' ? 'single' : 'spread'), mode);
    // Expected counter text for a state: spread shows the visible pair, single shows one page.
    // Numbering follows the printed folios: the cover is unnumbered, page index i is folio i; the total stays the PDF page count (91).
    const lbl = (spread, single) => (mode === 'spread' ? spread : single);
    const LAST = lbl('pages 89–90 / 91', 'page 90 / 91');

    check(`${vp.tag}: initial counter`, (await counter()) === 'Cover', await counter());
    check(`${vp.tag}: lazy imgs at start`, (await srcCount()) <= (mode === 'spread' ? 14 : 7), `${await srcCount()} img[src]`);
    await shot('0-closed');

    // Keyboard: hover the book, ArrowLeft = next.
    await page.hover('.flipbook__stage');
    await page.keyboard.press('ArrowLeft');
    await sleep(300);
    await shotFast('mid-turn');
    const midTurn = await page.evaluate(() => {
      const s = document.querySelector('.flipbook__sheet[data-sheet="0"]');
      const m = getComputedStyle(s).transform;
      return { turning: s.classList.contains('is-turning'), fwd: s.classList.contains('is-fwd'), hidden: s.classList.contains('is-hidden'), m: m.slice(0, 30) };
    });
    check(`${vp.tag}: sheet visible mid-turn`, midTurn.turning && midTurn.fwd && !midTurn.hidden && /^matrix3d\((?!1,)/.test(midTurn.m), JSON.stringify(midTurn));
    await sleep(800);
    await shot('1-turn');
    check(`${vp.tag}: ArrowLeft once`, (await counter()) === lbl('pages 1–2 / 91', 'page 1 / 91'), await counter());
    const arText = await page.$eval('.flipbook__counter-ar', (n) => n.textContent.trim());
    check(`${vp.tag}: Arabic counter`, arText === lbl('ص 1–2 / 91', 'ص 1 / 91'), arText);
    const live = await page.evaluate(() => {
      const c = document.querySelector('.flipbook__counter');
      return { ar: c.querySelector('.flipbook__counter-ar').getAttribute('aria-hidden'), en: c.querySelector('.flipbook__counter-en').getAttribute('aria-hidden'), sr: c.querySelector('.flipbook__sr').textContent.trim(), vt: document.querySelector('.flipbook__range').getAttribute('aria-valuetext') };
    });
    check(`${vp.tag}: live region announces one plain sentence`, live.ar === 'true' && live.en === 'true' && live.sr === lbl('pages 1 to 2 of 91', 'page 1 of 91') && live.vt === live.sr, JSON.stringify(live));
    const noStuckClasses = await page.$$eval('.flipbook__sheet', (ns) => ns.filter((n) => /is-fwd|is-bwd|is-turning/.test(n.className)).length);
    check(`${vp.tag}: direction classes cleared after the turn`, noStuckClasses === 0, `${noStuckClasses} sheets still flagged`);
    await page.keyboard.press('ArrowLeft'); await sleep(950);
    await page.keyboard.press('ArrowLeft'); await sleep(1000);
    const after3 = await counter();
    check(`${vp.tag}: ArrowLeft x3`, after3 === lbl('pages 5–6 / 91', 'page 3 / 91'), after3);
    await page.keyboard.press('ArrowLeft'); await sleep(950);
    await page.keyboard.press('ArrowLeft'); await sleep(1000);
    check(`${vp.tag}: 5 turns`, (await counter()) === lbl('pages 9–10 / 91', 'page 5 / 91'), await counter());
    await shot('5-turns');
    const afterFive = await srcCount();
    check(`${vp.tag}: lazy imgs after 5 turns`, afterFive === (mode === 'spread' ? 14 : 7), `${afterFive} img[src]`);

    // The visible faces must carry the right pages, and the folio printed on them must match the counter.
    if (mode === 'spread') {
      const faces = await page.evaluate(() => ({
        left: document.querySelector('.flipbook__sheet[data-sheet="5"] .flipbook__face--front img').getAttribute('src'),
        right: document.querySelector('.flipbook__sheet[data-sheet="4"] .flipbook__face--back img').getAttribute('src'),
        leftHidden: document.querySelector('.flipbook__sheet[data-sheet="5"]').classList.contains('is-hidden'),
        rightTurned: /rotateY\(180deg\)/.test(document.querySelector('.flipbook__sheet[data-sheet="4"]').style.transform),
      }));
      check(`${vp.tag}: left panel = p10, right panel = p09 (counter says 9–10)`, /p10\.jpg$/.test(faces.left) && /p09\.jpg$/.test(faces.right) && !faces.leftHidden && faces.rightTurned, JSON.stringify(faces));
    } else {
      const src = await page.$eval('.flipbook__sheet[data-sheet="5"] .flipbook__face--front img', (n) => n.getAttribute('src'));
      check(`${vp.tag}: visible page = p05 (counter says 5)`, /p05\.jpg$/.test(src), src);
    }

    // prev
    await page.keyboard.press('ArrowRight'); await sleep(1000);
    check(`${vp.tag}: ArrowRight (prev)`, (await counter()) === lbl('pages 7–8 / 91', 'page 4 / 91'), await counter());

    // goTo(40) — sampled: the landing stack must never be emptied to the table, and flying sheets carry images.
    const rows = await sampleRiffle(page, 40, 1700);
    const inFlight = rows.filter((r) => r.fly > 0);
    const minFlatR = Math.min(...inFlight.map((r) => r.flatR));
    const minFlatL = Math.min(...inFlight.map((r) => r.flatL));
    const blankFlights = inFlight.filter((r) => r.flyImg < r.fly).length;
    const leadMs = inFlight.length ? inFlight[0].t : -1;
    if (mode === 'spread') check(`${vp.tag}: goTo(40) riffle keeps both stacks populated`, inFlight.length > 5 && minFlatR >= 1 && minFlatL >= 1, `samples in flight ${inFlight.length}, min flat right ${minFlatR}, min flat left ${minFlatL}`);
    else check(`${vp.tag}: goTo(40) riffle keeps the page stack populated`, inFlight.length > 5 && minFlatL >= 1, `samples in flight ${inFlight.length}, min flat ${minFlatL}`);
    check(`${vp.tag}: flying sheets carry their images`, blankFlights === 0 && leadMs >= 0 && leadMs <= 400, `${blankFlights} samples with blank flyers, motion began at ${leadMs} ms`);
    await sleep(2600 - 1700);
    check(`${vp.tag}: goTo(40)`, (await counter()) === lbl('pages 39–40 / 91', 'page 40 / 91'), await counter());
    const at40 = await page.evaluate((m) => {
      const q = (sel) => document.querySelector(sel);
      if (m === 'spread') return { left: q('.flipbook__sheet[data-sheet="20"] .flipbook__face--front img').getAttribute('src'), right: q('.flipbook__sheet[data-sheet="19"] .flipbook__face--back img').getAttribute('src'), srcs: document.querySelectorAll('.flipbook__face img[src]').length, turning: document.querySelectorAll('.flipbook__sheet.is-turning').length, range: q('.flipbook__range').value, vt: q('.flipbook__range').getAttribute('aria-valuetext') };
      return { left: q('.flipbook__sheet[data-sheet="40"] .flipbook__face--front img').getAttribute('src'), srcs: document.querySelectorAll('.flipbook__face img[src]').length, turning: document.querySelectorAll('.flipbook__sheet.is-turning').length, range: q('.flipbook__range').value, vt: q('.flipbook__range').getAttribute('aria-valuetext') };
    }, mode);
    check(`${vp.tag}: goTo(40) shows p40`, /p40\.jpg$/.test(at40.left) && (mode === 'single' || /p39\.jpg$/.test(at40.right)) && at40.turning === 0, JSON.stringify(at40));
    check(`${vp.tag}: scrubber value/valuetext at 40`, at40.range === '40' && at40.vt === lbl('pages 39 to 40 of 91', 'page 40 of 91'), `${at40.range} / ${at40.vt}`);
    check(`${vp.tag}: lazy imgs at 40 (flight images dropped after landing)`, at40.srcs === (mode === 'spread' ? 14 : 7), `${at40.srcs} img[src]`);
    await shot('goto-40');

    // Mid-riffle screenshots: forward and backward jumps, captured while several sheets are in the air.
    await page.evaluate(() => window.__book.goTo(70)); await sleep(520); await shotFast('riffle-fwd-mid'); await sleep(1600);
    const bwdRows = await sampleRiffle(page, 40, 1700);
    const bwdFlight = bwdRows.filter((r) => r.fly > 0);
    if (mode === 'spread') check(`${vp.tag}: backward riffle keeps both stacks populated`, bwdFlight.length > 5 && Math.min(...bwdFlight.map((r) => r.flatL)) >= 1 && Math.min(...bwdFlight.map((r) => r.flatR)) >= 1, JSON.stringify(bwdFlight.map((r) => [r.t, r.flatL, r.flatR, r.fly]).filter((_, i) => i % 5 === 0)));
    else check(`${vp.tag}: backward riffle keeps the page stack populated`, bwdFlight.length > 5 && Math.min(...bwdFlight.map((r) => r.flatL)) >= 1, JSON.stringify(bwdFlight.map((r) => [r.t, r.flatL, r.fly]).filter((_, i) => i % 5 === 0)));
    await sleep(900);
    await page.evaluate(() => window.__book.goTo(10)); await sleep(520); await shotFast('riffle-bwd-mid'); await sleep(1600);
    check(`${vp.tag}: back at 10 after the riffles`, (await counter()) === lbl('pages 9–10 / 91', 'page 10 / 91'), await counter());
    await page.evaluate(() => window.__book.goTo(40)); await sleep(2400);

    // Clicking the left half = next, right half = prev — and a mouse click must not paint the keyboard focus ring.
    const box = await page.locator('.flipbook__book').boundingBox();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5); await sleep(1000);
    check(`${vp.tag}: click left half = next`, (await counter()) === lbl('pages 41–42 / 91', 'page 41 / 91'), await counter());
    const ring = await page.evaluate(() => {
      const root = document.querySelector('.flipbook');
      return { active: document.activeElement === root, fv: root.matches(':focus-visible'), mouse: root.classList.contains('is-mouse-focus'), outline: getComputedStyle(document.querySelector('.flipbook__stage')).outlineStyle };
    });
    check(`${vp.tag}: click focuses the region without a focus ring`, ring.active && ring.outline === 'none', JSON.stringify(ring));
    await shot('after-click');
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.5); await sleep(1000);
    check(`${vp.tag}: click right half = prev`, (await counter()) === lbl('pages 39–40 / 91', 'page 40 / 91'), await counter());
    await page.keyboard.press('ArrowLeft'); await sleep(60);
    const ringKb = await page.evaluate(() => ({ mouse: document.querySelector('.flipbook').classList.contains('is-mouse-focus'), outline: getComputedStyle(document.querySelector('.flipbook__stage')).outlineStyle }));
    check(`${vp.tag}: a key press restores the focus ring`, !ringKb.mouse && ringKb.outline === 'solid', JSON.stringify(ringKb));
    await sleep(1000);
    await page.keyboard.press('ArrowRight'); await sleep(1000);

    // Slider scrub → page 60
    await page.$eval('.flipbook__range', (r) => { r.value = '60'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(2400);
    check(`${vp.tag}: slider → 60`, (await counter()) === lbl('pages 59–60 / 91', 'page 60 / 91'), await counter());

    // Home / End (root has focus from the click on the book).
    await page.keyboard.press('Home'); await sleep(2400);
    check(`${vp.tag}: Home`, (await counter()) === 'Cover', await counter());
    await page.keyboard.press('End'); await sleep(2600);
    check(`${vp.tag}: End`, (await counter()) === LAST, await counter());
    const endState = await page.evaluate(() => ({ nextDisabled: document.querySelector('.flipbook__btn--next').disabled, open: document.querySelector('.flipbook').classList.contains('is-open'), turns: document.querySelector('.flipbook').dataset.turns }));
    check(`${vp.tag}: End disables next`, endState.nextDisabled, JSON.stringify(endState));
    await shot('end');
    await page.evaluate(() => window.__book.next()); await sleep(200);
    check(`${vp.tag}: next() at end is a no-op`, (await counter()) === LAST, await counter());

    // Hover affordance at the end: the left half has nothing to turn → no peek, no pointer cursor; right half still can.
    const bookBox = await page.locator('.flipbook__book').boundingBox();
    await page.mouse.move(bookBox.x + bookBox.width * 0.25, bookBox.y + bookBox.height * 0.5); await sleep(80);
    const peekEnd = await page.evaluate(() => {
      const book = document.querySelector('.flipbook__book');
      const top = [...document.querySelectorAll('.flipbook__sheet')].find((s) => !s.classList.contains('is-hidden') && /rotateY\(0deg\)|rotateY\(5deg\)/.test(s.style.transform));
      return { cursor: getComputedStyle(book).cursor, inert: book.classList.contains('is-inert'), xf: top ? top.style.transform : '' };
    });
    check(`${vp.tag}: no peek / pointer on the unturnable left half at the end`, peekEnd.cursor === 'default' && peekEnd.inert && !/rotateY\(5deg\)/.test(peekEnd.xf), JSON.stringify(peekEnd));
    await page.mouse.move(bookBox.x + bookBox.width * 0.75, bookBox.y + bookBox.height * 0.5); await sleep(80);
    const peekRight = await page.evaluate(() => {
      const book = document.querySelector('.flipbook__book');
      return { cursor: getComputedStyle(book).cursor, inert: book.classList.contains('is-inert'), peek: [...document.querySelectorAll('.flipbook__sheet')].some((s) => /rotateY\(175deg\)/.test(s.style.transform)) };
    });
    check(`${vp.tag}: right half still turns back at the end`, peekRight.cursor === 'pointer' && !peekRight.inert && (mode === 'single' || peekRight.peek), JSON.stringify(peekRight));
    // Peek is suspended while a sheet is in flight (a landing sheet must meet a flat stack).
    if (mode === 'spread') {
      await page.evaluate(() => window.__book.prev()); await sleep(200);
      const peekBusy = await page.evaluate(() => ({ turning: document.querySelectorAll('.flipbook__sheet.is-turning').length, peek: [...document.querySelectorAll('.flipbook__sheet')].some((s) => /rotateY\((175|5)deg\)/.test(s.style.transform)) }));
      check(`${vp.tag}: no peek while a sheet is in flight`, peekBusy.turning === 1 && !peekBusy.peek, JSON.stringify(peekBusy));
      await sleep(900);
      const peekAfter = await page.evaluate(() => [...document.querySelectorAll('.flipbook__sheet')].some((s) => /rotateY\(175deg\)/.test(s.style.transform)));
      check(`${vp.tag}: peek returns once the sheet has landed`, peekAfter, String(peekAfter));
      await page.evaluate(() => window.__book.next()); await sleep(1100);
    }

    // Buttons
    await page.click('.flipbook__btn--prev'); await sleep(1000);
    check(`${vp.tag}: prev button`, (await counter()) === lbl('pages 87–88 / 91', 'page 89 / 91'), await counter());
    await page.click('.flipbook__btn--next'); await sleep(1000);
    check(`${vp.tag}: next button`, (await counter()) === LAST, await counter());

    // No horizontal page overflow (also mid-turn).
    await page.keyboard.press('ArrowRight'); await sleep(300);
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(`${vp.tag}: no horizontal overflow mid-turn`, overflow.sw <= overflow.iw, JSON.stringify(overflow));
    await sleep(800);

    // ── Keyboard focus survives a button becoming disabled (was: focus dropped to <body>, arrows dead). ──
    // one step before the end: spread c=44 (page 88), single c=89 (page 89)
    await page.evaluate((p) => window.__book.goTo(p), mode === 'spread' ? 88 : 89); await sleep(1400);
    // Mouse-clicking Next into the disabled state parks focus on the region without painting the ring …
    await page.click('.flipbook__btn--next'); await sleep(1100);
    const parkedMouse = await page.evaluate(() => ({ active: document.activeElement === document.querySelector('.flipbook'), outline: getComputedStyle(document.querySelector('.flipbook__stage')).outlineStyle, counter: document.querySelector('.flipbook__counter-en').textContent.trim() }));
    check(`${vp.tag}: mouse-clicking Next to the end parks focus without a ring`, parkedMouse.active && parkedMouse.outline === 'none' && parkedMouse.counter === LAST, JSON.stringify(parkedMouse));
    await page.evaluate((p) => window.__book.goTo(p), mode === 'spread' ? 88 : 89); await sleep(1400);
    // … while reaching it by keyboard keeps the ring.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Tab');   // from <body>: first tabbable is the region, then Next
    await page.keyboard.press('Tab');
    const tabbed = await page.evaluate(() => document.activeElement.className);
    if (!/flipbook__btn--next/.test(tabbed)) await page.focus('.flipbook__btn--next');
    await page.keyboard.press('Enter'); await sleep(1100);
    const focusEnd = await page.evaluate(() => ({ active: document.activeElement === document.querySelector('.flipbook') ? 'ROOT' : document.activeElement.tagName, nextDisabled: document.querySelector('.flipbook__btn--next').disabled, counter: document.querySelector('.flipbook__counter-en').textContent.trim(), outline: getComputedStyle(document.querySelector('.flipbook__stage')).outlineStyle }));
    check(`${vp.tag}: Enter on Next at the end parks focus on the region`, focusEnd.active === 'ROOT' && focusEnd.nextDisabled && focusEnd.counter === LAST, JSON.stringify(focusEnd));
    check(`${vp.tag}: keyboard-parked focus keeps the ring`, focusEnd.outline === 'solid', JSON.stringify(focusEnd));
    await page.keyboard.press('ArrowRight'); await sleep(1100);
    check(`${vp.tag}: ArrowRight still works after Next was disabled`, (await counter()) === lbl('pages 87–88 / 91', 'page 89 / 91'), await counter());
    await page.evaluate(() => window.__book.goTo(1)); await sleep(2600);
    await page.focus('.flipbook__btn--prev');
    await page.keyboard.press('Enter'); await sleep(1100);
    const focusStart = await page.evaluate(() => ({ active: document.activeElement === document.querySelector('.flipbook') ? 'ROOT' : document.activeElement.tagName, prevDisabled: document.querySelector('.flipbook__btn--prev').disabled, counter: document.querySelector('.flipbook__counter-en').textContent.trim() }));
    check(`${vp.tag}: Enter on Prev at the start parks focus on the region`, focusStart.active === 'ROOT' && focusStart.prevDisabled && focusStart.counter === 'Cover', JSON.stringify(focusStart));
    await page.keyboard.press('ArrowLeft'); await sleep(1100);
    check(`${vp.tag}: ArrowLeft still works after Prev was disabled`, (await counter()) === lbl('pages 1–2 / 91', 'page 1 / 91'), await counter());

    // ── Home/End need focus inside the region; arrows still work on hover alone. ──
    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    const bookNow = await page.locator('.flipbook__book').boundingBox();   // fresh: the page may have scrolled for the button clicks
    await page.mouse.move(bookNow.x + bookNow.width * 0.5, bookNow.y + bookNow.height * 0.5); await sleep(60);
    const beforeEnd = await counter();
    await page.keyboard.press('End'); await sleep(400);
    const hoverEnd = await page.evaluate(() => ({ active: document.activeElement.tagName, page: document.querySelector('.flipbook').dataset.page }));
    check(`${vp.tag}: End on hover alone is ignored`, (await counter()) === beforeEnd && hoverEnd.active === 'BODY', `${beforeEnd} → ${await counter()} ${JSON.stringify(hoverEnd)}`);
    // The ignored End scrolled the page (its default), which moves the book out from under the pointer: re-hover it.
    await page.evaluate(() => window.scrollTo(0, 0));
    const bookAgain = await page.locator('.flipbook__book').boundingBox();
    await page.mouse.move(bookAgain.x + bookAgain.width * 0.5, bookAgain.y + bookAgain.height * 0.5); await sleep(60);
    await page.keyboard.press('ArrowLeft'); await sleep(1100);
    check(`${vp.tag}: ArrowLeft on hover alone still turns`, (await counter()) === lbl('pages 3–4 / 91', 'page 2 / 91'), await counter());
    await page.focus('.flipbook');
    await page.keyboard.press('End'); await sleep(2600);
    check(`${vp.tag}: End with focus jumps to the last page`, (await counter()) === LAST, await counter());
    await page.keyboard.press('Home'); await sleep(2600);
    check(`${vp.tag}: Home with focus`, (await counter()) === 'Cover', await counter());

    // ── TOC integration: goTo(printedFolio) lands on the page carrying that folio. ──
    await page.click('#toc button[data-page="22"]'); await sleep(2600);
    const toc22 = await page.evaluate((m) => {
      const root = document.querySelector('.flipbook');
      const sel = m === 'spread' ? '.flipbook__sheet[data-sheet="11"] .flipbook__face--front img' : '.flipbook__sheet[data-sheet="22"] .flipbook__face--front img';
      return { page: root.dataset.page, counter: document.querySelector('.flipbook__counter-en').textContent.trim(), left: document.querySelector(sel).getAttribute('src') };
    }, mode);
    check(`${vp.tag}: TOC "Mechanics 22" → folio 22 on the left panel`, toc22.page === '22' && /p22\.jpg$/.test(toc22.left) && toc22.counter === lbl('pages 21–22 / 91', 'page 22 / 91'), JSON.stringify(toc22));
    await shot('toc-22');
    await page.evaluate(() => window.__book.goTo(0)); await sleep(2600);

    // Touch swipe (mobile): the swipe follows the paper — swipe RIGHT = next, swipe LEFT = prev.
    if (vp.tag === 'mobile') {
      const b = await page.locator('.flipbook__book').boundingBox();
      const swipe = (dir) => page.evaluate(({ x, y, dir }) => {
        const st = document.querySelector('.flipbook__stage');
        const opts = (dx) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y, button: 0 });
        st.dispatchEvent(new PointerEvent('pointerdown', opts(0)));
        st.dispatchEvent(new PointerEvent('pointermove', opts(40 * dir)));
        st.dispatchEvent(new PointerEvent('pointerup', opts(90 * dir)));
      }, { x: b.x + b.width * 0.5, y: b.y + b.height * 0.5, dir });
      const before = await counter();
      await swipe(+1); await sleep(1000);
      check('mobile: swipe right = next', before === 'Cover' && (await counter()) === 'page 1 / 91', `${before} → ${await counter()}`);
      await swipe(+1); await sleep(1000);
      check('mobile: second swipe right', (await counter()) === 'page 2 / 91', await counter());
      await swipe(-1); await sleep(1000);
      check('mobile: swipe left = prev', (await counter()) === 'page 1 / 91', await counter());

      // Single-page mode: the landed sheet's blank back fades out instead of popping away at the container edge.
      await page.evaluate(() => window.__book.next());
      await sleep(120);
      const fadeAnim = await page.evaluate(() => {
        const s = document.querySelector('.flipbook__sheet.is-turning');
        const back = s && s.querySelector('.flipbook__face--back');
        return { fwd: !!s && s.classList.contains('is-fwd'), anim: back ? back.getAnimations().map((a) => a.animationName).join(',') : '' };
      });
      check('mobile: back face runs the fade-out during a forward turn', fadeAnim.fwd && /fb-back-out/.test(fadeAnim.anim), JSON.stringify(fadeAnim));
      await sleep(730);   // ≈ 850 ms into the 900 ms turn
      const tail = await page.evaluate(() => {
        const s = document.querySelector('.flipbook__sheet.is-turning');
        const back = s && s.querySelector('.flipbook__face--back');
        return { turning: !!s, opacity: back ? Number(getComputedStyle(back).opacity) : -1 };
      });
      await shotFast('land-850');
      check('mobile: back face is nearly transparent as the sheet lands', !tail.turning || tail.opacity < 0.3, JSON.stringify(tail));
      await sleep(300);
      await page.evaluate(() => window.__book.prev());
      await sleep(120);
      const fadeIn = await page.evaluate(() => {
        const s = document.querySelector('.flipbook__sheet.is-turning');
        const back = s && s.querySelector('.flipbook__face--back');
        return { bwd: !!s && s.classList.contains('is-bwd'), anim: back ? back.getAnimations().map((a) => a.animationName).join(',') : '' };
      });
      check('mobile: back face runs the fade-in during a backward turn', fadeIn.bwd && /fb-back-in/.test(fadeIn.anim), JSON.stringify(fadeIn));
      await sleep(1000);
      // A backward riffle in single mode must not show slivers of waiting sheets at the right edge.
      await page.evaluate(() => window.__book.goTo(30)); await sleep(2400);
      const waitingVisible = await page.evaluate(() => new Promise((res) => {
        window.__book.goTo(20);
        setTimeout(() => {
          const bad = [...document.querySelectorAll('.flipbook__sheet')].filter((s) => !s.classList.contains('is-turning') && !s.classList.contains('is-hidden') && /rotateY\(180deg\)/.test(s.style.transform)).length;
          res(bad);
        }, 40);
      }));
      check('mobile: waiting turned sheets stay hidden until they move', waitingVisible === 0, `${waitingVisible} visible`);
      await sleep(2200);
    }

    // FPS during a turn.
    await page.evaluate(() => window.__book.goTo(20)); await sleep(2400);
    const fps = await page.evaluate(() => new Promise((res) => {
      let frames = 0; const t0 = performance.now();
      window.__book.next();
      const tick = () => { frames++; const dt = performance.now() - t0; if (dt < 900) requestAnimationFrame(tick); else res(Math.round(frames / (dt / 1000))); };
      requestAnimationFrame(tick);
    }));
    fpsByViewport[vp.tag] = fps;
    check(`${vp.tag}: fps during turn`, fps >= 50, `${fps} fps`);
    await sleep(300);

    // Accessibility bits.
    const a11y = await page.evaluate(() => {
      const root = document.querySelector('.flipbook');
      const faces = [...document.querySelectorAll('.flipbook__face img')];
      return { tabindex: root.getAttribute('tabindex'), role: root.getAttribute('role'), live: document.querySelector('.flipbook__counter').getAttribute('aria-live'), pdf: document.querySelector('.flipbook__link--primary').getAttribute('target'), dl: document.querySelector('a[download]') !== null, lastAlt: faces[faces.length - 1].getAttribute('alt'), p22Alt: faces[22].getAttribute('alt'), arFont: getComputedStyle(document.querySelector('.flipbook__counter-ar')).fontFamily.split(',')[0].trim() };
    });
    check(`${vp.tag}: a11y attributes`, a11y.tabindex === '0' && a11y.role === 'region' && a11y.live === 'polite' && a11y.pdf === '_blank' && a11y.dl, JSON.stringify(a11y));
    if (mode === 'spread') {
      const wide = await page.evaluate(() => {
        const mid = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return Math.round(r.top + r.height / 2); };   // items are centre-aligned in the row
        return { narrow: document.querySelector('.flipbook').classList.contains('flipbook--narrow'), hint: getComputedStyle(document.querySelector('.flipbook__hint')).display, mids: [mid('.flipbook__nav'), mid('.flipbook__hint'), mid('.flipbook__scrub'), mid('.flipbook__links')] };
      });
      check(`${vp.tag}: wide container → one row of controls`, !wide.narrow && wide.hint !== 'none' && Math.max(...wide.mids) - Math.min(...wide.mids) <= 1, JSON.stringify(wide));
    }
    check(`${vp.tag}: alt texts use folios (last page is a page, not "Back cover")`, a11y.lastAlt === 'Page 90 of 91' && a11y.p22Alt === 'Page 22 of 91', `${a11y.lastAlt} / ${a11y.p22Alt}`);
    check(`${vp.tag}: Arabic counter uses an Arabic-capable face first`, /system-ui/.test(a11y.arFont), a11y.arFont);

    // Reduced motion: transitions are 0 ms, and the loading placeholder does not shimmer.
    await page.goto(`${BASE}?rm=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await page.hover('.flipbook__stage');
    await page.keyboard.press('ArrowLeft');
    await sleep(60);
    const rm = await page.evaluate(() => {
      const s = document.querySelector('.flipbook__sheet[data-sheet="0"]');
      const cs = getComputedStyle(s);
      return { counter: document.querySelector('.flipbook__counter-en').textContent.trim(), dur: cs.transitionDuration, transform: cs.transform };
    });
    check(`${vp.tag}: reduced motion is instant`, rm.dur === '0s' && rm.counter === lbl('pages 1–2 / 91', 'page 1 / 91') && /matrix3d/.test(rm.transform), JSON.stringify(rm));
    await page.evaluate(() => window.__book.goTo(40)); await sleep(30);
    const rmJump = await page.evaluate(() => ({ counter: document.querySelector('.flipbook__counter-en').textContent.trim(), turning: document.querySelectorAll('.flipbook__sheet.is-turning').length, page: document.querySelector('.flipbook').dataset.page }));
    check(`${vp.tag}: reduced motion goTo() lands at once, no lead wait`, rmJump.page === '40' && rmJump.turning === 0 && rmJump.counter === lbl('pages 39–40 / 91', 'page 40 / 91'), JSON.stringify(rmJump));
    await page.route('**/assets/book/pages/*.jpg', (route) => setTimeout(() => route.continue().catch(() => {}), 1500));
    await page.evaluate(() => window.__book.goTo(70)); await sleep(250);
    const rmShimmer = await page.evaluate(() => ({
      loading: document.querySelectorAll('.flipbook__face.is-loading').length,
      shimmer: document.getAnimations().filter((a) => a.animationName === 'fb-shimmer').length,
      running: document.getAnimations().filter((a) => a.playState === 'running').length,
    }));
    await shot('reduced-slownet');
    check(`${vp.tag}: reduced motion → static placeholder, no shimmer sweep`, rmShimmer.loading > 0 && rmShimmer.shimmer === 0 && rmShimmer.running === 0, JSON.stringify(rmShimmer));
    await page.unroute('**/assets/book/pages/*.jpg');
    await sleep(1800);

    // Slow network: the riffle lead is capped, so a jump still starts moving within LEAD_MS + a frame.
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await sleep(300);
    await page.route('**/assets/book/pages/*.jpg', (route) => setTimeout(() => route.continue().catch(() => {}), 1500));
    const slowRows = await sampleRiffle(page, 40, 900);
    const slowStart = slowRows.find((r) => r.fly > 0);
    check(`${vp.tag}: slow network → riffle starts within the lead cap`, !!slowStart && slowStart.t <= 420, slowStart ? `${slowStart.t} ms` : 'never started');
    await page.unroute('**/assets/book/pages/*.jpg');
    await sleep(2200);

    // destroy()
    const destroyed = await page.evaluate(() => {
      window.__book.destroy();
      const root = document.querySelector('.flipbook');
      return { children: root.children.length, style: !!document.getElementById('flipbook-style'), tabindex: root.getAttribute('tabindex'), cls: root.className };
    });
    await page.keyboard.press('ArrowLeft'); await sleep(50);
    check(`${vp.tag}: destroy() cleans up`, destroyed.children === 0 && !destroyed.style && destroyed.tabindex === null && destroyed.cls === 'flipbook', JSON.stringify(destroyed));
    // destroy() mid-riffle must not leave a timer or listener that fires later.
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await sleep(300);
    const midDestroy = await page.evaluate(() => new Promise((res) => {
      window.__book.goTo(40);
      setTimeout(() => {
        window.__book.destroy();
        setTimeout(() => res({ children: document.querySelector('.flipbook').children.length, turning: document.querySelectorAll('.flipbook__sheet').length }), 1200);
      }, 100);
    }));
    check(`${vp.tag}: destroy() mid-riffle leaves nothing behind`, midDestroy.children === 0 && midDestroy.turning === 0, JSON.stringify(midDestroy));

    check(`${vp.tag}: zero console errors/warnings`, errors.length === 0, errors.slice(0, 5).join(' | '));
    await ctx.close();
  }

  // ── Narrow spread: a 900 px viewport gives an 852 px container → spread mode, but too narrow for one row of chrome:
  //    nav + links share the first row, the scrubber takes the second, nothing is orphaned. ──
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await sleep(500);
    await page.evaluate(() => window.__book.goTo(4)); await sleep(2000);
    const nr = await page.evaluate(() => {
      const root = document.querySelector('.flipbook');
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const controls = r('.flipbook__controls'), nav = r('.flipbook__nav'), scrub = r('.flipbook__scrub'), links = r('.flipbook__links');
      return { cw: root.clientWidth, spread: root.classList.contains('flipbook--spread'), narrow: root.classList.contains('flipbook--narrow'), hintHidden: getComputedStyle(document.querySelector('.flipbook__hint')).display === 'none', navTop: Math.round(nav.top), linksTop: Math.round(links.top), scrubTop: Math.round(scrub.top), linksRight: Math.round(links.right), ctrlRight: Math.round(controls.right - 15), scrubW: Math.round(scrub.width), inner: Math.round(controls.width - 30) };
    });
    check('narrow spread: spread mode at an 852px container', nr.spread && nr.cw === 852 && nr.narrow, JSON.stringify(nr));
    check('narrow spread: nav + links on row one, full-width scrubber on row two', nr.hintHidden && nr.navTop === nr.linksTop && nr.scrubTop > nr.navTop && Math.abs(nr.linksRight - nr.ctrlRight) <= 1 && Math.abs(nr.scrubW - nr.inner) <= 1, JSON.stringify(nr));
    // widen → one row again; shrink below 760 → single + compact
    await page.setViewportSize({ width: 1100, height: 900 }); await sleep(300);
    const wideAgain = await page.evaluate(() => ({ narrow: document.querySelector('.flipbook').classList.contains('flipbook--narrow'), hint: getComputedStyle(document.querySelector('.flipbook__hint')).display }));
    check('narrow spread: class clears when the container widens', !wideAgain.narrow && wideAgain.hint !== 'none', JSON.stringify(wideAgain));
    // A mode switch during a riffle must cancel the pending lead/timers cleanly and keep the page.
    await page.evaluate(() => window.__book.goTo(40)); await sleep(150);
    await page.setViewportSize({ width: 700, height: 900 }); await sleep(600);
    const single = await page.evaluate(() => { const c = document.querySelector('.flipbook').classList; return { single: c.contains('flipbook--single'), narrow: c.contains('flipbook--narrow'), page: document.querySelector('.flipbook').dataset.page, counter: document.querySelector('.flipbook__counter-en').textContent.trim() }; });
    check('narrow spread: shrinking to single mode mid-riffle keeps the page and drops the narrow class', single.single && !single.narrow && single.page === '40' && single.counter === 'page 40 / 91', JSON.stringify(single));
    await page.setViewportSize({ width: 900, height: 900 }); await sleep(400);
    await page.locator('.flipbook').screenshot({ path: path.join(SHOTS, 'book-narrow-controls.png') });
    check('narrow spread: zero console errors/warnings', errors.length === 0, errors.slice(0, 5).join(' | '));
    await ctx.close();
  }

  // ── Tablet: a 768 px viewport gives a 720 px container → single mode, and the controls must follow the container mode. ──
  {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await sleep(500);
    await page.evaluate(() => window.__book.goTo(2)); await sleep(1400);
    const tab = await page.evaluate(() => {
      const root = document.querySelector('.flipbook');
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const controls = r('.flipbook__controls'), nav = r('.flipbook__nav'), scrub = r('.flipbook__scrub'), links = r('.flipbook__links');
      return { cw: root.clientWidth, single: root.classList.contains('flipbook--single'), hintHidden: getComputedStyle(document.querySelector('.flipbook__hint')).display === 'none', navW: Math.round(nav.width), scrubW: Math.round(scrub.width), linksW: Math.round(links.width), ctrlW: Math.round(controls.width), rows: [nav.top, scrub.top, links.top].map(Math.round), counter: document.querySelector('.flipbook__counter-en').textContent.trim() };
    });
    const inner = tab.ctrlW - 26;   // 12px padding + 1px border each side
    check('tablet: single mode at a 720px container', tab.single && tab.cw === 720 && tab.counter === 'page 2 / 91', JSON.stringify(tab));
    check('tablet: controls use the compact layout (three full-width rows, hint hidden)', tab.hintHidden && Math.abs(tab.navW - inner) <= 1 && Math.abs(tab.scrubW - inner) <= 1 && Math.abs(tab.linksW - inner) <= 1 && tab.rows[0] < tab.rows[1] && tab.rows[1] < tab.rows[2], JSON.stringify(tab));
    await page.locator('.flipbook').screenshot({ path: path.join(SHOTS, 'book-tablet-controls.png') });
    check('tablet: zero console errors/warnings', errors.length === 0, errors.slice(0, 5).join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  fps=${JSON.stringify(fpsByViewport)}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
