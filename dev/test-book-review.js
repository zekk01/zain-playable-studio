// Skeptical review checks for js/book.js via dev/harness-book.html (independent of the builder's dev/test-book.js).
// Usage: cd D:/Portfolio && PORT=3152 node server.js   (in another shell)   then   PORT=3152 node dev/test-book-review.js
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));

const PORT = process.env.PORT || 3152;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/dev/harness-book.html`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
const check = (name, ok, info = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  — ${info}` : ''}`);
  if (!ok) failures++;
};
const note = (s) => results.push(`NOTE  ${s}`);

const INIT_SCRIPT = () => {
  // rAF counter
  window.__raf = 0;
  const oraf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__raf++; return oraf(cb); };
  // listener net counts on document / window
  window.__listeners = { doc: 0, win: 0 };
  for (const [t, k] of [[document, 'doc'], [window, 'win']]) {
    const a = t.addEventListener.bind(t), r = t.removeEventListener.bind(t);
    t.addEventListener = (...x) => { window.__listeners[k]++; return a(...x); };
    t.removeEventListener = (...x) => { window.__listeners[k]--; return r(...x); };
  }
  // outstanding timers
  window.__timers = new Set();
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => { const id = st((...z) => { window.__timers.delete(id); if (typeof fn === 'function') fn(...z); }, ms, ...a); window.__timers.add(id); return id; };
  window.clearTimeout = (id) => { window.__timers.delete(id); return ct(id); };
};

// Full snapshot of the visible sheets, in DOM terms, plus what is physically on top of each panel.
const STATE = () => {
  const root = document.querySelector('.flipbook');
  const book = root.querySelector('.flipbook__book');
  const bb = book.getBoundingClientRect();
  const cx = bb.left + bb.width / 2;
  const stageR = root.querySelector('.flipbook__stage').getBoundingClientRect();
  const scx = stageR.left + stageR.width / 2;
  const sheets = [...root.querySelectorAll('.flipbook__sheet')];
  const vis = sheets.filter((s) => !s.classList.contains('is-hidden')).map((s) => {
    const r = s.getBoundingClientRect();
    const m = /rotateY\((-?[\d.]+)deg\)/.exec(s.style.transform);
    const f = s.querySelector('.flipbook__face--front img'), b = s.querySelector('.flipbook__face--back img');
    return { k: +s.dataset.sheet, rot: m ? +m[1] : null, cx: Math.round(r.left + r.width / 2 - cx), w: Math.round(r.width), front: f && f.getAttribute('src'), back: b && b.getAttribute('src'), z: s.style.zIndex, turning: s.classList.contains('is-turning'), cls: s.className.replace('flipbook__sheet', '').trim() };
  });
  const probe = (x) => {
    const e = document.elementFromPoint(x, bb.top + bb.height / 2);
    if (!e) return null;
    const face = e.closest('.flipbook__face');
    const sheet = e.closest('.flipbook__sheet');
    return face ? `${sheet.dataset.sheet}:${face.classList.contains('flipbook__face--front') ? 'front' : 'back'}:${(face.querySelector('img') || {}).getAttribute ? (face.querySelector('img') || { getAttribute: () => 'blank' }).getAttribute('src') : 'blank'}` : e.className;
  };
  const single = root.classList.contains('flipbook--single');
  const pageW = parseFloat(getComputedStyle(root).getPropertyValue('--fb-page-w'));
  return {
    mode: single ? 'single' : 'spread', pageW,
    cx: Math.round(cx), scx: Math.round(scx), bookLeft: Math.round(bb.left), bookW: Math.round(bb.width),
    c: +root.dataset.turns, page: root.dataset.page,
    counter: root.querySelector('.flipbook__counter-en').textContent.trim(),
    ar: root.querySelector('.flipbook__counter-ar').textContent.trim(),
    sr: root.querySelector('.flipbook__counter .flipbook__sr').textContent.trim(),
    imgs: root.querySelectorAll('.flipbook__face img[src]').length,
    loading: root.querySelectorAll('.flipbook__face.is-loading').length,
    vis,
    onLeft: single ? probe(cx) : probe(cx - pageW / 2),
    onRight: single ? null : probe(cx + pageW / 2),
    nextOff: root.querySelector('.flipbook__btn--next').disabled,
    prevOff: root.querySelector('.flipbook__btn--prev').disabled,
    shift: getComputedStyle(root).getPropertyValue('--fb-shift').trim(),
    open: root.classList.contains('is-open'),
    turningN: root.querySelectorAll('.flipbook__sheet.is-turning').length,
    stuck: root.querySelectorAll('.flipbook__sheet.is-under-in, .flipbook__sheet.is-under-out, .flipbook__sheet.is-fwd, .flipbook__sheet.is-bwd').length,
    rangeVal: root.querySelector('.flipbook__range').value,
  };
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  for (const vp of [{ w: 1440, h: 900, tag: 'desk' }, { w: 768, h: 1024, tag: 'tab', touch: true }, { w: 400, h: 800, tag: 'mob', touch: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: !!vp.touch });
    const page = await ctx.newPage();
    const errors = [], failedReq = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => failedReq.push(`FAILED ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400 && !/fonts\./.test(r.url())) failedReq.push(`${r.status()} ${r.url()}`); });
    await page.addInitScript(INIT_SCRIPT);

    const t0 = Date.now();
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await page.waitForFunction(() => document.querySelectorAll('.flipbook__face.is-loaded img').length >= 1, null, { timeout: 15000 }).catch(() => {});
    note(`${vp.tag}: harness ready in ${Date.now() - t0} ms`);
    await sleep(700);

    const state = () => page.evaluate(STATE);
    const shot = (name) => page.locator('.flipbook').screenshot({ path: path.join(SHOTS, `review-book-${vp.tag}-${name}.png`) });
    const shotFast = async (name) => {
      const bb = await page.locator('.flipbook__stage').boundingBox();
      const y = Math.max(0, bb.y), h = Math.min(bb.height + 8, vp.h - y);
      await page.screenshot({ path: path.join(SHOTS, `review-book-${vp.tag}-${name}.png`), clip: { x: bb.x, y, width: bb.width, height: h } });
    };
    await page.screenshot({ path: path.join(SHOTS, `review-book-${vp.tag}-fullpage.png`), fullPage: true });

    // ── 1. DOM contract ──
    const dom = await page.evaluate(() => {
      const root = document.querySelector('.flipbook');
      const stage = root.querySelector(':scope > .flipbook__stage');
      const book = stage && stage.querySelector(':scope > .flipbook__book');
      const sheets = book ? [...book.querySelectorAll(':scope > .flipbook__sheet')] : [];
      const s0 = sheets[0];
      const cs = s0 && getComputedStyle(s0);
      const ff = s0 && s0.querySelector('.flipbook__face--front'), fb = s0 && s0.querySelector('.flipbook__face--back');
      const controls = root.querySelector(':scope > .flipbook__controls');
      const pdfA = controls && [...controls.querySelectorAll('a')].find((a) => /Open full PDF/.test(a.textContent));
      const dlA = controls && controls.querySelector('a[download]');
      return {
        stage: !!stage, book: !!book, sheets: sheets.length,
        allHaveFaces: sheets.every((s) => s.querySelector(':scope > .flipbook__face--front') && s.querySelector(':scope > .flipbook__face--back')),
        persp: getComputedStyle(stage).perspective, ts: cs && cs.transformStyle, bookTs: getComputedStyle(book).transformStyle,
        bfvF: ff && getComputedStyle(ff).backfaceVisibility, bfvB: fb && getComputedStyle(fb).backfaceVisibility,
        origin: cs && cs.transformOrigin, sheetW: s0 && Math.round(s0.getBoundingClientRect().width),
        controls: !!controls, btns: controls ? controls.querySelectorAll('button').length : 0,
        nextLabel: root.querySelector('.flipbook__btn--next')?.textContent.trim(), prevLabel: root.querySelector('.flipbook__btn--prev')?.textContent.trim(),
        counterLive: controls && controls.querySelector('.flipbook__counter')?.getAttribute('aria-live'),
        counterText: controls && controls.querySelector('.flipbook__counter-en')?.textContent.trim(),
        pdf: pdfA && { href: pdfA.getAttribute('href'), target: pdfA.target, rel: pdfA.rel },
        dl: dlA && { href: dlA.getAttribute('href'), text: dlA.textContent.trim() },
        mode: root.classList.contains('flipbook--single') ? 'single' : 'spread',
        tabindex: root.getAttribute('tabindex'), role: root.getAttribute('role'), label: root.getAttribute('aria-label'),
        describedOk: !!document.getElementById(root.getAttribute('aria-describedby') || ''),
        styleTags: document.querySelectorAll('#flipbook-style').length,
        range: !!root.querySelector('input[type=range]'), rangeDir: root.querySelector('input[type=range]')?.getAttribute('dir'), rangeMax: root.querySelector('input[type=range]')?.max,
        fontBody: getComputedStyle(root).fontFamily.split(',')[0],
        cw: root.clientWidth, stageH: stage.getBoundingClientRect().height,
      };
    });
    check(`${vp.tag}: DOM: stage > book > sheets (front+back)`, dom.stage && dom.book && dom.sheets > 0 && dom.allHaveFaces, `sheets=${dom.sheets}`);
    check(`${vp.tag}: DOM: perspective on stage, preserve-3d on sheet+book, backface hidden on faces`, dom.persp !== 'none' && dom.ts === 'preserve-3d' && dom.bookTs === 'preserve-3d' && dom.bfvF === 'hidden' && dom.bfvB === 'hidden', JSON.stringify({ persp: dom.persp, ts: dom.ts, bookTs: dom.bookTs, bfv: [dom.bfvF, dom.bfvB] }));
    check(`${vp.tag}: DOM: sheet transform-origin is the right edge`, dom.origin === `${dom.sheetW}px ${Math.round(parseFloat(dom.origin.split(' ')[1]))}px` || /^\d+(\.\d+)?px/.test(dom.origin) && Math.round(parseFloat(dom.origin)) === dom.sheetW, `${dom.origin} vs sheetW ${dom.sheetW}`);
    check(`${vp.tag}: DOM: controls with 2 buttons, aria-live counter, PDF (_blank noopener) and download links`, dom.controls && dom.btns === 2 && dom.counterLive === 'polite' && dom.pdf && dom.pdf.target === '_blank' && /noopener/.test(dom.pdf.rel) && dom.pdf.href === 'assets/book/Game-Design-Booklet.pdf' && dom.dl && dom.dl.href === 'assets/book/Game-Design-Booklet.pdf', JSON.stringify({ btns: dom.btns, live: dom.counterLive, pdf: dom.pdf, dl: dom.dl }));
    check(`${vp.tag}: expected mode for container width ${dom.cw}`, dom.mode === (dom.cw < 760 ? 'single' : 'spread'), dom.mode);
    check(`${vp.tag}: sheet count`, dom.sheets === (dom.mode === 'spread' ? 46 : 91), String(dom.sheets));
    check(`${vp.tag}: region a11y (tabindex 0, role region, described-by resolves)`, dom.tabindex === '0' && dom.role === 'region' && dom.describedOk && !!dom.label, JSON.stringify({ t: dom.tabindex, r: dom.role, l: dom.label }));
    check(`${vp.tag}: one injected <style id=flipbook-style>`, dom.styleTags === 1, String(dom.styleTags));
    check(`${vp.tag}: RTL range scrubber (dir=rtl, max=N-1)`, dom.range && dom.rangeDir === 'rtl' && dom.rangeMax === '90', `${dom.rangeDir} ${dom.rangeMax}`);
    note(`${vp.tag}: counter text at closed = "${dom.counterText}" (contract literal: "page X / N")`);
    note(`${vp.tag}: button labels: [${dom.nextLabel}] [${dom.prevLabel}]; body font ${dom.fontBody}; stage h ${Math.round(dom.stageH)}`);

    // ── 2. closed state + page ORDER / DIRECTION ──
    const s0 = await state();
    await shot('closed');
    const cover0 = s0.vis.find((v) => v.k === 0);
    check(`${vp.tag}: closed: c=0, sheet 0 flat, cover.jpg on its front, prev disabled`, s0.c === 0 && cover0 && cover0.rot === 0 && cover0.front === 'assets/book/cover.jpg' && s0.prevOff && !s0.nextOff, JSON.stringify({ c: s0.c, cover0, prevOff: s0.prevOff }));
    if (s0.mode === 'spread') {
      check(`${vp.tag}: closed: cover on the LEFT panel of a spine-centred spread, book shifted so the cover is centred in the stage`, cover0.cx < 0 && Math.abs((s0.cx + cover0.cx) - s0.scx) <= 4, `cover cx rel book ${cover0.cx}, cover abs ${s0.cx + cover0.cx} vs stage ${s0.scx}, shift ${s0.shift}`);
      check(`${vp.tag}: closed: no turned sheet on the right / nothing on the right panel`, s0.vis.every((v) => v.rot === 0) && !/back:/.test(s0.onRight || ''), `right=${s0.onRight}`);
      check(`${vp.tag}: closed: lazy window = sheets 0..3 → 8 img[src]`, s0.imgs === 8, String(s0.imgs));
    } else {
      check(`${vp.tag}: closed (single): cover centred`, Math.abs(s0.cx - s0.scx) <= 4, `${s0.cx} vs ${s0.scx}`);
      check(`${vp.tag}: closed (single): lazy window = sheets 0..3 → 4 img[src]`, s0.imgs === 4, String(s0.imgs));
    }
    check(`${vp.tag}: closed: only the top ${'4'} sheets rendered, rest hidden`, s0.vis.length <= 4, `visible=${s0.vis.map((v) => v.k).join(',')}`);
    check(`${vp.tag}: closed: nothing shimmering after load`, s0.loading === 0, `${s0.loading} faces still is-loading`);

    // hover → then ArrowLeft = next
    const bookBox = await page.locator('.flipbook__book').boundingBox();
    await page.mouse.move(bookBox.x + bookBox.width * 0.5, bookBox.y + bookBox.height * 0.5);
    await sleep(80);
    await page.keyboard.press('ArrowLeft');
    await sleep(430); await shotFast('turn1-mid');
    await sleep(800);
    const s1 = await state();
    await shot('turn1');
    if (s1.mode === 'spread') {
      const sh0 = s1.vis.find((v) => v.k === 0), sh1 = s1.vis.find((v) => v.k === 1);
      check(`${vp.tag}: after 1 next: sheet 0 rotated 180 onto the RIGHT (back=p01), sheet 1 flat on the LEFT (front=p02)`, s1.c === 1 && sh0 && sh0.rot === 180 && sh0.cx > 0 && /p01\.jpg$/.test(sh0.back) && sh1 && sh1.rot === 0 && sh1.cx < 0 && /p02\.jpg$/.test(sh1.front), JSON.stringify({ c: s1.c, sh0, sh1 }));
      check(`${vp.tag}: after 1 next: elementFromPoint: right panel = 0:back(p01), left panel = 1:front(p02)`, /^0:back:.*p01\.jpg$/.test(s1.onRight || '') && /^1:front:.*p02\.jpg$/.test(s1.onLeft || ''), `L=${s1.onLeft} R=${s1.onRight}`);
      check(`${vp.tag}: after 1 next: spine now centred (shift 0), is-open`, s1.shift === '0px' && s1.open && Math.abs(s1.cx - s1.scx) <= 2, `shift=${s1.shift} open=${s1.open}`);
      check(`${vp.tag}: after 1 next: counter "pages 1–2 / 91" + ar + sr`, s1.counter === 'pages 1–2 / 91' && s1.ar === 'ص 1–2 / 91' && s1.sr === 'pages 1 to 2 of 91', `${s1.counter} | ${s1.ar} | ${s1.sr}`);
    } else {
      check(`${vp.tag}: after 1 next (single): page 1 on show, sheet 0 gone`, s1.c === 1 && /^1:front:.*p01\.jpg$/.test(s1.onLeft || '') && !s1.vis.some((v) => v.k === 0 && !v.turning), `L=${s1.onLeft} vis=${JSON.stringify(s1.vis)}`);
      check(`${vp.tag}: after 1 next (single): counter "page 1 / 91"`, s1.counter === 'page 1 / 91', s1.counter);
    }
    check(`${vp.tag}: after 1 next: turn finished, no stuck classes`, s1.turningN === 0 && s1.stuck === 0, `turning=${s1.turningN} stuck=${s1.stuck}`);

    await page.keyboard.press('ArrowLeft'); await sleep(1250);
    const s2 = await state();
    await shot('turn2');
    if (s2.mode === 'spread') {
      check(`${vp.tag}: after 2 next: left=p04 (sheet2 front), right=p03 (sheet1 back); sheet 0 beneath on right`, s2.c === 2 && /^2:front:.*p04\.jpg$/.test(s2.onLeft || '') && /^1:back:.*p03\.jpg$/.test(s2.onRight || ''), `L=${s2.onLeft} R=${s2.onRight}`);
      const zOk = s2.vis.filter((v) => v.rot === 180).sort((a, b) => a.k - b.k).every((v, i, arr) => i === 0 || +v.z > +arr[i - 1].z) && s2.vis.filter((v) => v.rot === 0).sort((a, b) => a.k - b.k).every((v, i, arr) => i === 0 || +v.z < +arr[i - 1].z);
      check(`${vp.tag}: after 2 next: z-index order consistent on both stacks`, zOk, JSON.stringify(s2.vis.map((v) => [v.k, v.rot, v.z])));
    } else {
      check(`${vp.tag}: after 2 next (single): page 2 on show`, s2.c === 2 && /^2:front:.*p02\.jpg$/.test(s2.onLeft || ''), `L=${s2.onLeft}`);
    }
    // prev
    await page.keyboard.press('ArrowRight'); await sleep(1250);
    const s3 = await state();
    check(`${vp.tag}: ArrowRight = prev → c=1`, s3.c === 1 && s3.turningN === 0, `c=${s3.c}`);

    // ── 3. rapid input stress: 6 quick ArrowLefts while turns are in flight ──
    for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowLeft'); await sleep(110); }
    await sleep(1500);
    const s4 = await state();
    await shot('after-spam');
    const consistent = s4.vis.every((v) => (v.k < s4.c ? v.rot === 180 || v.rot === 175 : v.rot === 0 || v.rot === 5));
    check(`${vp.tag}: 6 rapid nexts → c=7, settled, consistent rotations, images in window`, s4.c === 7 && s4.turningN === 0 && s4.stuck === 0 && consistent && s4.imgs === (s4.mode === 'spread' ? 14 : 7), JSON.stringify({ c: s4.c, turning: s4.turningN, stuck: s4.stuck, imgs: s4.imgs, vis: s4.vis.map((v) => [v.k, v.rot]) }));
    if (s4.mode === 'spread') check(`${vp.tag}: after spam: left=p14 right=p13`, /^7:front:.*p14\.jpg$/.test(s4.onLeft || '') && /^6:back:.*p13\.jpg$/.test(s4.onRight || ''), `L=${s4.onLeft} R=${s4.onRight}`);
    else check(`${vp.tag}: after spam: page 7 on show`, /^7:front:.*p07\.jpg$/.test(s4.onLeft || ''), `L=${s4.onLeft}`);
    // alternate next/prev quickly
    for (let i = 0; i < 4; i++) { await page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowLeft'); await sleep(90); }
    await sleep(1400);
    const s5 = await state();
    check(`${vp.tag}: rapid next/prev alternation returns to c=7 cleanly`, s5.c === 7 && s5.turningN === 0 && s5.stuck === 0 && s5.vis.every((v) => (v.k < 7 ? v.rot >= 175 : v.rot <= 5)), JSON.stringify({ c: s5.c, turning: s5.turningN, stuck: s5.stuck, vis: s5.vis.map((v) => [v.k, v.rot]) }));

    // ── 4. lazy window exactness at goTo(40) ──
    await page.evaluate(() => window.__book.goTo(40)); await sleep(2700);
    const lazy = await page.evaluate(() => {
      const root = document.querySelector('.flipbook'); const c = +root.dataset.turns; const bad = [];
      for (const s of root.querySelectorAll('.flipbook__sheet')) { const k = +s.dataset.sheet; const has = s.querySelectorAll('img[src]').length > 0; const want = Math.abs(k - c) <= 3; if (has !== want) bad.push(`${k}:${has ? 'has' : 'none'}`); }
      return { c, bad, imgs: root.querySelectorAll('.flipbook__face img[src]').length, loading: root.querySelectorAll('.flipbook__face.is-loading').length };
    });
    check(`${vp.tag}: goTo(40): only |k-c|≤3 sheets carry img[src]`, lazy.bad.length === 0 && lazy.imgs === (s0.mode === 'spread' ? 14 : 7), JSON.stringify(lazy));
    const s40 = await state();
    await shot('goto40');
    if (s40.mode === 'spread') check(`${vp.tag}: goTo(40): left=p40 right=p39, counter pages 39–40, range 40`, /^20:front:.*p40\.jpg$/.test(s40.onLeft || '') && /^19:back:.*p39\.jpg$/.test(s40.onRight || '') && s40.counter === 'pages 39–40 / 91' && s40.rangeVal === '40', `L=${s40.onLeft} R=${s40.onRight} ${s40.counter} range=${s40.rangeVal}`);
    else check(`${vp.tag}: goTo(40) single: p40, counter page 40`, /^40:front:.*p40\.jpg$/.test(s40.onLeft || '') && s40.counter === 'page 40 / 91' && s40.rangeVal === '40', `L=${s40.onLeft} ${s40.counter}`);
    check(`${vp.tag}: goTo(40): nothing still shimmering 2.7 s later`, s40.loading === 0, `${s40.loading} is-loading`);

    // goTo on the other page of the same spread must be a no-op
    if (s40.mode === 'spread') {
      await page.evaluate(() => window.__book.goTo(39)); await sleep(150);
      const s39 = await state();
      check(`${vp.tag}: goTo(39) is a no-op on the 39|40 spread`, s39.c === 20 && s39.turningN === 0, `c=${s39.c} turning=${s39.turningN}`);
    }
    // bad args
    const badArgs = await page.evaluate(async () => {
      const out = [];
      for (const v of [-5, 999, NaN, undefined, '12', 1.7]) { try { window.__book.goTo(v); await new Promise((r) => setTimeout(r, 30)); out.push(`${String(v)}→${document.querySelector('.flipbook').dataset.page}`); } catch (e) { out.push(`${String(v)}→THROW ${e.message}`); } }
      return out;
    });
    check(`${vp.tag}: goTo tolerates bad args (no throw)`, badArgs.every((s) => !/THROW/.test(s)), badArgs.join(' '));
    await sleep(2500);

    // ── 5. End / Home ──
    await page.evaluate(() => window.__book.goTo(90)); await sleep(2800);
    const sEnd = await state();
    await shot('end');
    if (sEnd.mode === 'spread') {
      check(`${vp.tag}: End: c=45 (capped), left=p90 (back.jpg), right=p89, next disabled, still open`, sEnd.c === 45 && /^45:front:assets\/book\/back\.jpg$/.test(sEnd.onLeft || '') && /^44:back:.*p89\.jpg$/.test(sEnd.onRight || '') && sEnd.nextOff && sEnd.open && sEnd.counter === 'pages 89–90 / 91', `L=${sEnd.onLeft} R=${sEnd.onRight} c=${sEnd.c} nextOff=${sEnd.nextOff} ${sEnd.counter}`);
    } else {
      check(`${vp.tag}: End (single): p90 shown, next disabled`, sEnd.c === 90 && /^90:front:assets\/book\/back\.jpg$/.test(sEnd.onLeft || '') && sEnd.nextOff && sEnd.counter === 'page 90 / 91', `L=${sEnd.onLeft} c=${sEnd.c} ${sEnd.counter}`);
    }
    check(`${vp.tag}: End: no stray is-loading/turning`, sEnd.loading === 0 && sEnd.turningN === 0, `loading=${sEnd.loading}`);
    await page.evaluate(() => window.__book.goTo(0)); await sleep(2800);
    const sHome = await state();
    check(`${vp.tag}: Home: back to Cover, prev disabled, all visible sheets flat`, sHome.c === 0 && sHome.prevOff && sHome.counter === 'Cover' && sHome.vis.every((v) => v.rot === 0 || v.rot === 5), `c=${sHome.c} ${sHome.counter} vis=${JSON.stringify(sHome.vis.map((v) => [v.k, v.rot]))}`);

    // ── 6. hover peek + cursor (spread only) ──
    if (sHome.mode === 'spread') {
      await page.evaluate(() => window.__book.goTo(10)); await sleep(2600);
      const bb = await page.locator('.flipbook__book').boundingBox();
      await page.mouse.move(bb.x + bb.width * 0.25, bb.y + bb.height * 0.5); await sleep(120);
      const pk = await page.evaluate(() => ({ peekL: [...document.querySelectorAll('.flipbook__sheet')].some((s) => /rotateY\(5deg\)/.test(s.style.transform)), cursor: getComputedStyle(document.querySelector('.flipbook__book')).cursor }));
      await page.mouse.move(bb.x + bb.width * 0.75, bb.y + bb.height * 0.5); await sleep(120);
      const pkR = await page.evaluate(() => ({ peekR: [...document.querySelectorAll('.flipbook__sheet')].some((s) => /rotateY\(175deg\)/.test(s.style.transform)), peekL: [...document.querySelectorAll('.flipbook__sheet')].some((s) => /rotateY\(5deg\)/.test(s.style.transform)) }));
      await page.mouse.move(5, 5); await sleep(200);
      const pkOff = await page.evaluate(() => [...document.querySelectorAll('.flipbook__sheet')].some((s) => /rotateY\((5|175)deg\)/.test(s.style.transform)));
      check(`${vp.tag}: hover peek: left lifts top-left sheet 5°, right lifts top-right −5°, leave resets`, pk.peekL && pk.cursor === 'pointer' && pkR.peekR && !pkR.peekL && !pkOff, JSON.stringify({ pk, pkR, pkOff }));
      await shotFast('peek-off');
    }

    // ── 7. keyboard gating: typing in a textarea elsewhere must not turn pages even while hovering ──
    const gate = await page.evaluate(() => {
      const ta = document.createElement('textarea'); ta.id = '__ta'; document.body.appendChild(ta); ta.focus();
      return document.activeElement === ta;
    });
    const bb2 = await page.locator('.flipbook__book').boundingBox();
    await page.mouse.move(bb2.x + bb2.width * 0.5, bb2.y + bb2.height * 0.5); await sleep(60);
    const cBefore = (await state()).c;
    await page.keyboard.press('ArrowLeft'); await sleep(300);
    const cAfter = (await state()).c;
    check(`${vp.tag}: ArrowLeft while typing in a textarea (book hovered) does not turn`, gate && cBefore === cAfter, `${cBefore}→${cAfter}`);
    await page.evaluate(() => document.getElementById('__ta').remove());

    // Tab order through the controls
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    const order = [];
    for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'body' : `${a.tagName.toLowerCase()}.${(a.className || '').toString().split(' ')[0] || a.id}`; })); }
    check(`${vp.tag}: tab order: region → Next → Prev → range → PDF → Download`, order.slice(0, 6).join(' > ') === 'div.flipbook > button.flipbook__btn > button.flipbook__btn > input.flipbook__range > a.flipbook__link > a.flipbook__link', order.join(' > '));
    // focus ring visible on the region after keyboard focus
    await page.evaluate(() => { document.activeElement.blur(); });
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => ({ active: document.activeElement === document.querySelector('.flipbook'), outline: getComputedStyle(document.querySelector('.flipbook__stage')).outlineStyle }));
    check(`${vp.tag}: keyboard focus on the region paints a visible ring`, ring.active && ring.outline === 'solid', JSON.stringify(ring));
    await shot('focus-ring');

    // ── 8. overflow (mid-turn) ──
    await page.evaluate(() => window.__book.next()); await sleep(350);
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bsw: document.body.scrollWidth }));
    check(`${vp.tag}: no horizontal overflow mid-turn`, ov.sw <= ov.iw && ov.bsw <= ov.iw, JSON.stringify(ov));
    await sleep(900);

    // ── 9. visibility toggle while a turn is in flight ──
    const vis = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__book.next();
      await sleep(100);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(1300);
      const midHidden = { turning: document.querySelectorAll('.flipbook__sheet.is-turning').length, c: document.querySelector('.flipbook').dataset.turns };
      delete document.hidden; delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(200);
      return { midHidden, after: { turning: document.querySelectorAll('.flipbook__sheet.is-turning').length, stuck: document.querySelectorAll('.flipbook__sheet.is-under-in,.flipbook__sheet.is-under-out').length } };
    });
    check(`${vp.tag}: turn completes even with document.hidden toggled`, vis.midHidden.turning === 0 && vis.after.turning === 0 && vis.after.stuck === 0, JSON.stringify(vis));

    // ── 10. fps / jank over 3 s of continuous turning ──
    await page.evaluate(() => window.__book.goTo(20)); await sleep(2600);
    const perf = await page.evaluate(() => new Promise((res) => {
      const gaps = []; let frames = 0, last = performance.now(); const t0 = last; let n = 0;
      const turns = [];
      const iv = setInterval(() => { const a = performance.now(); (n++ % 2 ? window.__book.prev : window.__book.next)(); turns.push(+(performance.now() - a).toFixed(2)); }, 700);
      const tick = () => { const now = performance.now(); gaps.push(now - last); last = now; frames++; if (now - t0 < 3000) requestAnimationFrame(tick); else { clearInterval(iv); const sorted = gaps.slice().sort((a, b) => a - b); res({ fps: Math.round(frames / ((now - t0) / 1000)), maxGap: Math.round(Math.max(...gaps)), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), over50: gaps.filter((g) => g > 50).length, turnCallMs: Math.max(...turns) }); } };
      requestAnimationFrame(tick);
    }));
    check(`${vp.tag}: fps ≥ 45 over 3 s of turning`, perf.fps >= 45, `${perf.fps} fps, max frame gap ${perf.maxGap} ms, p95 ${perf.p95} ms, frames>50ms: ${perf.over50}, slowest next()/prev() call ${perf.turnCallMs} ms`);
    check(`${vp.tag}: no frame gap > 100 ms during turning`, perf.maxGap <= 100, `max gap ${perf.maxGap} ms`);
    await sleep(1200);

    // ── 11. resize round trips ──
    const before = await state();
    const alt = vp.w >= 1000 ? { w: 1000, h: vp.h } : vp.w >= 700 ? { w: 1200, h: vp.h } : { w: 900, h: vp.h };
    await page.setViewportSize({ width: alt.w, height: alt.h }); await sleep(500);
    const mid = await state();
    await shot(`resized-${alt.w}`);
    await page.setViewportSize({ width: vp.w, height: vp.h }); await sleep(500);
    const back = await state();
    check(`${vp.tag}: resize to ${alt.w} and back: modes ${before.mode}→${mid.mode}→${back.mode}, page preserved`, back.mode === before.mode && back.page === before.page && back.turningN === 0, `page ${before.page}→${mid.page}→${back.page}, c ${before.c}→${mid.c}→${back.c}, pageW ${before.pageW}→${mid.pageW}→${back.pageW}`);
    if (mid.mode !== before.mode) note(`${vp.tag}: mode switch on resize kept page ${before.page} → ${mid.page} (mid) → ${back.page} (back)`);
    // resize during a turn must not snap it
    await page.evaluate(() => window.__book.next()); await sleep(200);
    await page.setViewportSize({ width: vp.w, height: vp.h - 60 }); await sleep(100);
    const midTurn = await page.evaluate(() => ({ turning: document.querySelectorAll('.flipbook__sheet.is-turning').length, resizing: document.querySelector('.flipbook').classList.contains('is-resizing') }));
    await page.setViewportSize({ width: vp.w, height: vp.h }); await sleep(1100);
    check(`${vp.tag}: height-only resize mid-turn leaves the turn in flight`, midTurn.turning === 1 && !midTurn.resizing, JSON.stringify(midTurn));

    // ── 12. destroy / init cycles: leaks ──
    const cyc = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const mod = await import('/js/book.js'); const data = await import('/js/data.js');
      const root = document.getElementById('book');
      const mk = () => mod.initBook({ container: root, pageCount: data.book.pages, pageSrc: data.book.pageSrc, cover: data.book.cover, back: data.book.back, pdfUrl: data.book.pdf, reducedMotion: false });
      const snap = () => ({ nodes: document.getElementsByTagName('*').length, doc: window.__listeners.doc, win: window.__listeners.win, style: document.querySelectorAll('#flipbook-style').length, timers: window.__timers.size });
      window.__book.next(); await sleep(120);            // destroy mid-turn
      window.__book.destroy();
      window.__book.destroy();                            // double destroy must be harmless
      await sleep(1300);
      const base = snap();
      const rootAttrs = { children: root.children.length, attrs: [...root.attributes].map((a) => `${a.name}=${a.value}`).join(' ') };
      const rafB = window.__raf; await sleep(600); const rafIdle = window.__raf - rafB;
      const rounds = [];
      for (let i = 0; i < 3; i++) {
        const b = mk(); await sleep(200); b.goTo(20); await sleep(400); b.next(); await sleep(120);
        window.dispatchEvent(new Event('resize')); await sleep(60);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        b.destroy(); await sleep(1400);
        rounds.push(snap());
      }
      const rafB2 = window.__raf; await sleep(600); const rafIdle2 = window.__raf - rafB2;
      // keydown after destroy must not throw / act
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      window.__book = mk(); await sleep(500);
      return { base, rootAttrs, rafIdle, rounds, rafIdle2, after: snap() };
    });
    check(`${vp.tag}: destroy: root emptied and attributes restored`, cyc.rootAttrs.children === 0 && cyc.rootAttrs.attrs === 'class="flipbook" id="book"', cyc.rootAttrs.attrs);
    check(`${vp.tag}: destroy: style tag removed by last destroy`, cyc.base.style === 0 && cyc.rounds.every((r) => r.style === 0), JSON.stringify(cyc.rounds.map((r) => r.style)));
    check(`${vp.tag}: 3× init/destroy: no DOM node leak`, cyc.rounds.every((r) => r.nodes === cyc.base.nodes), `${cyc.base.nodes} → ${cyc.rounds.map((r) => r.nodes).join(',')}`);
    check(`${vp.tag}: 3× init/destroy: document/window listeners balanced`, cyc.rounds.every((r) => r.doc === cyc.base.doc && r.win === cyc.base.win), `doc ${cyc.base.doc}→${cyc.rounds.map((r) => r.doc)} win ${cyc.base.win}→${cyc.rounds.map((r) => r.win)}`);
    check(`${vp.tag}: 3× init/destroy: no outstanding timers`, cyc.rounds.every((r) => r.timers <= cyc.base.timers), `${cyc.base.timers}→${cyc.rounds.map((r) => r.timers)}`);
    check(`${vp.tag}: no rAF running after destroy`, cyc.rafIdle === 0 && cyc.rafIdle2 === 0, `idle rAF calls ${cyc.rafIdle}/${cyc.rafIdle2}`);
    check(`${vp.tag}: re-init after cycles works`, cyc.after.style === 1 && cyc.after.nodes > cyc.base.nodes, JSON.stringify(cyc.after));

    // ── 13. reduced motion ──
    await page.goto(`${BASE}?rm=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await sleep(400);
    const rmA = await page.evaluate(() => {
      const root = document.querySelector('.flipbook');
      const s = root.querySelector('.flipbook__sheet[data-sheet="0"]');
      return { reduced: root.classList.contains('is-reduced'), sheetDur: getComputedStyle(s).transitionDuration, bookDur: getComputedStyle(root.querySelector('.flipbook__book')).transitionDuration, dur: getComputedStyle(root).getPropertyValue('--fb-dur').trim() };
    });
    await page.evaluate(() => window.__book.next());
    await sleep(40);
    const rmB = await state();
    await page.evaluate(() => window.__book.goTo(60)); await sleep(60);
    const rmC = await state();
    check(`${vp.tag}: reducedMotion: is-reduced, 0s transitions, next()/goTo() land instantly with no in-flight sheets`, rmA.reduced && rmA.sheetDur === '0s' && rmA.bookDur === '0s' && rmB.c === 1 && rmB.turningN === 0 && rmC.page === '60' && rmC.turningN === 0, JSON.stringify({ rmA, b: [rmB.c, rmB.turningN], c: [rmC.page, rmC.turningN] }));
    await shot('reduced-60');
    // shimmer under reduced motion: delay one image and inspect the pseudo animation
    await page.route('**/assets/book/pages/p8*.jpg', (route) => setTimeout(() => route.continue().catch(() => {}), 2000));
    await page.evaluate(() => window.__book.goTo(84)); await sleep(200);
    const rmShim = await page.evaluate(() => {
      const f = document.querySelector('.flipbook__face.is-loading');
      return f ? { anim: getComputedStyle(f, '::before').animationName, loading: true } : { loading: false };
    });
    check(`${vp.tag}: reducedMotion: loading placeholder is still (no shimmer keyframes)`, !rmShim.loading || rmShim.anim === 'none', JSON.stringify(rmShim));
    await page.unroute('**/assets/book/pages/p8*.jpg');
    await sleep(2300);

    // ── wrap up per viewport ──
    check(`${vp.tag}: zero console errors/warnings/pageerrors`, errors.length === 0, errors.slice(0, 5).join(' | '));
    check(`${vp.tag}: no failed/404 requests`, failedReq.length === 0, failedReq.slice(0, 5).join(' | '));
    await ctx.close();
  }

  // ── Edge cases in a fresh context (desktop) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bookReady);
    await sleep(300);
    // even page count → true back cover
    const even = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const mod = await import('/js/book.js'); const data = await import('/js/data.js');
      window.__book.destroy();
      const root = document.getElementById('book');
      const b = mod.initBook({ container: root, pageCount: 6, pageSrc: data.book.pageSrc, cover: data.book.cover, back: data.book.back, pdfUrl: data.book.pdf, reducedMotion: true });
      await sleep(100);
      const out = { sheets: root.querySelectorAll('.flipbook__sheet').length, altLast: root.querySelector('.flipbook__sheet[data-sheet="2"] .flipbook__face--back img').getAttribute('alt'), srcLast: root.querySelector('.flipbook__sheet[data-sheet="2"] .flipbook__face--back img').getAttribute('src') };
      b.goTo(5); await sleep(60);
      out.end = { c: root.dataset.turns, counter: root.querySelector('.flipbook__counter-en').textContent.trim(), nextOff: root.querySelector('.flipbook__btn--next').disabled, shift: getComputedStyle(root).getPropertyValue('--fb-shift').trim(), open: root.classList.contains('is-open') };
      b.goTo(2); await sleep(60);
      out.mid = { c: root.dataset.turns, counter: root.querySelector('.flipbook__counter-en').textContent.trim() };
      b.destroy();
      return out;
    });
    check(`even count (6): 3 sheets, last back = Back cover (back.jpg), End closes from behind (c=3, shifted left, next off)`, even.sheets === 3 && even.altLast === 'Back cover' && even.srcLast === 'assets/book/back.jpg' && even.end.c === '3' && even.end.counter === 'Back cover' && even.end.nextOff && even.end.shift.startsWith('-') && !even.end.open && even.mid.counter === 'pages 1–2 / 6', JSON.stringify(even));
    await page.locator('.flipbook').screenshot({ path: path.join(SHOTS, 'review-book-even-end.png') }).catch(() => {});

    // 404 images → placeholder cleared, no JS error
    const miss = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const mod = await import('/js/book.js');
      const root = document.getElementById('book');
      const b = mod.initBook({ container: root, pageCount: 8, pageSrc: (i) => `assets/book/pages/missing-${i}.jpg`, pdfUrl: '', reducedMotion: false });
      await sleep(1200);
      const out = { loading: root.querySelectorAll('.flipbook__face.is-loading').length, loaded: root.querySelectorAll('.flipbook__face.is-loaded').length, links: root.querySelectorAll('.flipbook__links a').length };
      b.next(); await sleep(1100);
      out.c = root.dataset.turns;
      b.destroy();
      return out;
    });
    check(`missing images: shimmer cleared on error, still turns, no links when pdfUrl empty`, miss.loading === 0 && miss.c === '1' && miss.links === 0, JSON.stringify(miss));
    // pageCount 1
    const one = await page.evaluate(async () => {
      const mod = await import('/js/book.js'); const data = await import('/js/data.js');
      const root = document.getElementById('book');
      try { const b = mod.initBook({ container: root, pageCount: 1, pageSrc: data.book.pageSrc, reducedMotion: true }); const out = { c: root.dataset.turns, counter: root.querySelector('.flipbook__counter-en').textContent.trim(), nextOff: root.querySelector('.flipbook__btn--next').disabled }; b.next(); b.goTo(5); out.c2 = root.dataset.turns; b.destroy(); return out; } catch (e) { return { throw: e.message }; }
    });
    check(`pageCount 1: no throw, next disabled`, !one.throw && one.nextOff && one.c2 === '0', JSON.stringify(one));
    // bad container
    const badC = await page.evaluate(async () => { const mod = await import('/js/book.js'); try { mod.initBook({ container: null, pageCount: 3, pageSrc: () => '' }); return 'no-throw'; } catch (e) { return e.constructor.name; } });
    check(`null container throws TypeError`, badC === 'TypeError', badC);
    const jsErrs = errors.filter((e) => !/404|Failed to load resource/.test(e));
    check(`edge cases: no JS errors (network 404s for the deliberate missing images excluded)`, jsErrs.length === 0, jsErrs.slice(0, 5).join(' | '));
    note(`edge cases: console lines total ${errors.length} (404s expected: ${errors.filter((e) => /404|Failed to load/.test(e)).length})`);
    await ctx.close();
  }

  // ── In-situ: index.html at 1440 and 1280 ──
  for (const w of [1440, 1280, 1024]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${ORIGIN}/`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForSelector('#flipbook .flipbook__stage', { timeout: 20000 });
      await sleep(1500);
      await page.evaluate(() => document.getElementById('book').scrollIntoView({ block: 'start' }));
      await sleep(1200);
      const insitu = await page.evaluate(() => { const r = document.getElementById('flipbook'); return { cw: r.clientWidth, mode: r.classList.contains('flipbook--single') ? 'single' : 'spread', narrow: r.classList.contains('flipbook--narrow'), pageW: getComputedStyle(r).getPropertyValue('--fb-page-w').trim(), label: r.getAttribute('aria-label') }; });
      note(`in-situ ${w}px: container ${insitu.cw}px → ${insitu.mode}${insitu.narrow ? ' (narrow controls)' : ''}, pageW ${insitu.pageW}; errors: ${errors.length ? errors.slice(0, 3).join(' | ') : 'none'}`);
      await page.locator('#book').screenshot({ path: path.join(SHOTS, `review-book-insitu-${w}.png`) });
    } catch (e) { note(`in-situ ${w}px: could not evaluate (${e.message.split('\n')[0]})`); }
    await ctx.close();
  }

  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'} (${results.filter((r) => !r.startsWith('NOTE')).length} checks)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
