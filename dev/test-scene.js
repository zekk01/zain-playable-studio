// Playwright test for js/scene.js via dev/harness-scene.html (+ a read-only pass over index.html).
// Usage: node dev/test-scene.js  (starts its own static server on PORT, default 4711)
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 4711;
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MAX_CALLS = 170; // studio draw-call budget (was 261 before static batching)
const results = { ok: true, viewports: {}, index: {}, fps: null, errors: [] };
const fail = (msg) => { results.ok = false; results.errors.push(msg); console.log('  FAIL', msg); };
const pass = (msg) => console.log('  ok  ', msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ping() { return new Promise((res) => { http.get(BASE + '/dev/harness-scene.html', (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)); }); }
async function ensureServer() {
  if (await ping()) return null;
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { await sleep(100); if (await ping()) return child; }
  throw new Error('server did not start');
}

/** Ratio of pixels inside `rect` (CSS px, DPR 1) of a PNG screenshot that differ from the page bg. */
async function coverage(page, png, rect, bg = [0x15, 0x16, 0x16]) {
  return page.evaluate(async ({ b64, rect, bg }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) n++;
    return n / (d.length / 4);
  }, { b64: png.toString('base64'), rect, bg });
}

/** Reads every hotspot button: rect, opacity, pill display, aria-label. */
const readLabels = (page, layerSel) => page.$$eval(`${layerSel} .hotspot`, (els) => els.map((el) => {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  const pill = el.querySelector('.hotspot__label');
  return { id: el.dataset.id, target: el.dataset.target, x: r.x, y: r.y, w: r.width, h: r.height, opacity: cs.opacity, text: el.textContent.trim(), transform: el.style.transform, pill: pill ? getComputedStyle(pill).display : 'missing', aria: el.getAttribute('aria-label'), compact: el.classList.contains('hotspot--compact') };
}));
const overlapsOf = (labels) => {
  const out = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push([a.id, b.id]);
  }
  return out;
};
const attachConsole = (page, consoleErrors, consoleWarnings) => {
  page.on('console', (m) => {
    const t = m.text();
    if (/fonts\.g(oogleapis|static)\.com/.test(t)) return; // web fonts; offline runs must not count
    if (m.type() === 'error') consoleErrors.push(t); else if (m.type() === 'warning') consoleWarnings.push(t);
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
};

async function testViewport(browser, name, viewport) {
  console.log(`\n== harness ${name} (${viewport.width}x${viewport.height})`);
  const R = results.viewports[name] = {};
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors = [], consoleWarnings = [];
  attachConsole(page, consoleErrors, consoleWarnings);

  await page.goto(`${BASE}/dev/harness-scene.html?rm=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__scene && window.__scene.ready, null, { timeout: 10000 }).catch(() => fail(`${name}: scenes did not initialise (WebGL?)`));
  await sleep(2300); // intro (1.6s) + settle

  // fps over 2s (page rAF count, DPR 1) + module stats
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 >= 2000) res(Math.round(n * 1000 / (performance.now() - t0))); else requestAnimationFrame(f); })(); }));
  const stats = await page.evaluate(() => ({ studio: window.__scene.studio.stats(), poker: window.__scene.poker.stats() }));
  R.fps = fps; R.stats = stats;
  console.log(`  fps(page,2s)=${fps}  studio: ${stats.studio.triangles} tris / ${stats.studio.calls} calls / ${stats.studio.fps} fps   poker: ${stats.poker.triangles} tris / ${stats.poker.calls} calls`);
  if (stats.studio.triangles > 60000) fail(`${name}: studio triangles ${stats.studio.triangles} > 60k`); else pass(`triangles within budget`);
  if (stats.studio.calls > MAX_CALLS) fail(`${name}: studio draw calls ${stats.studio.calls} > ${MAX_CALLS}`); else pass(`draw calls ${stats.studio.calls} ≤ ${MAX_CALLS} (static batching)`);
  if (fps < 30) fail(`${name}: low fps ${fps}`); else pass(`fps ${fps}`);

  // fallback guard: the [hidden] <img> siblings must not paint over the live canvases
  const guard = await page.evaluate(() => {
    const fb = document.querySelector('#studio-fallback'), pf = document.querySelector('#poker-fallback');
    const cv = document.querySelector('#studio'); const r = cv.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { studio: getComputedStyle(fb).display, poker: getComputedStyle(pf).display, inline: fb.style.display, top: top && (top.closest('.hotspot') ? 'hotspot' : top.id) };
  });
  R.guard = guard;
  if (guard.studio !== 'none' || guard.poker !== 'none' || !['studio', 'hotspot'].includes(guard.top)) fail(`${name}: [hidden] fallback images still paint over the canvas ${JSON.stringify(guard)}`);
  else pass('[hidden] fallback images are suppressed while the scenes are live (canvas is the top element)');

  // hero screenshot + canvas coverage
  const heroRect = await page.$eval('#studio', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const shot = await page.screenshot({ path: path.join(SHOTS, `studio-${name}.png`) });
  const cov = await coverage(page, shot, heroRect);
  R.studioCoverage = +cov.toFixed(3);
  if (cov < 0.08) fail(`${name}: studio canvas coverage ${cov.toFixed(3)} too low`); else pass(`studio canvas non-transparent coverage ${(cov * 100).toFixed(1)}%`);

  // labels exist, are visible, inside the canvas, non-overlapping, and named
  const compactExpected = viewport.width < 560;
  const labels = await readLabels(page, '#labels');
  R.labels = labels;
  if (labels.length !== 4) fail(`${name}: expected 4 labels, got ${labels.length}`); else pass('4 hotspot labels created');
  for (const L of labels) {
    const inside = L.x >= heroRect.x && L.y >= heroRect.y && L.x + L.w <= heroRect.x + heroRect.width + 0.5 && L.y + L.h <= heroRect.y + heroRect.height + 0.5;
    const visible = parseFloat(L.opacity) > 0.9 && /translate3d/.test(L.transform);
    if (!inside || !visible) fail(`${name}: label ${L.id} inside=${inside} visible=${visible} (${L.x.toFixed(0)},${L.y.toFixed(0)} ${L.w.toFixed(0)}x${L.h.toFixed(0)} op=${L.opacity})`);
    else pass(`label ${L.id} "${L.text}" at ${L.x.toFixed(0)},${L.y.toFixed(0)} (${L.w.toFixed(0)}x${L.h.toFixed(0)})`);
    if (!/^\d\d .+/.test(L.aria || '')) fail(`${name}: label ${L.id} has no "01 Name" aria-label (${L.aria})`);
    if (L.compact !== compactExpected || (compactExpected ? L.pill !== 'none' : L.pill === 'none')) fail(`${name}: label ${L.id} compact=${L.compact} pill=${L.pill} (expected compact=${compactExpected})`);
  }
  pass(`labels carry aria-labels; compact mode ${compactExpected ? 'on (dots only)' : 'off (pills shown)'}`);
  const ov = overlapsOf(labels);
  R.overlaps = ov;
  if (ov.length) fail(`${name}: overlapping labels ${JSON.stringify(ov)}`); else pass('no two labels overlap');
  const layerCompact = await page.$eval('#labels', (el) => el.classList.contains('is-compact'));
  if (layerCompact !== compactExpected) fail(`${name}: labelLayer.is-compact=${layerCompact}`); else pass(`labelLayer ${compactExpected ? 'has' : 'lacks'} is-compact hook`);

  // DOM structure per contract
  const structure = await page.$eval('#labels .hotspot', (el) => el.matches('button.hotspot[data-target]') && !!el.querySelector('span.hotspot__dot') && !!el.querySelector('b.hotspot__label > i'));
  if (!structure) fail(`${name}: label DOM structure mismatch`); else pass('label DOM structure matches contract');

  // keyboard focus reaches labels; in compact mode focus reveals the pill (and blur hides it again)
  const focusable = await page.evaluate(() => { const b = document.querySelector('#labels .hotspot'); b.focus(); return document.activeElement === b; });
  if (!focusable) fail(`${name}: label not focusable`); else pass('labels are keyboard focusable');
  if (compactExpected) {
    await sleep(350);
    const shown = await readLabels(page, '#labels');
    const focused = shown[0];
    const ovFocus = overlapsOf(shown);
    if (focused.pill === 'none') fail(`${name}: focused compact label did not reveal its pill`);
    else if (ovFocus.length) fail(`${name}: revealed pill overlaps ${JSON.stringify(ovFocus)}`);
    else pass(`focus reveals the pill in compact mode (${focused.w.toFixed(0)}px wide, no overlap)`);
    await page.screenshot({ path: path.join(SHOTS, `studio-${name}-focus.png`) });
    await page.evaluate(() => document.activeElement.blur());
    await sleep(100);
    const hidden = (await readLabels(page, '#labels'))[0].pill === 'none';
    if (!hidden) fail(`${name}: pill stayed visible after blur`); else pass('blur hides the pill again');
  }

  // poker canvas (scroll into view so its loop resumes)
  await page.evaluate(() => document.querySelector('#poker-box').scrollIntoView({ block: 'center' }));
  await sleep(1800);
  const pokerRect = await page.$eval('#poker', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const pshot = await page.screenshot({ path: path.join(SHOTS, `poker-${name}.png`) });
  const pcov = await coverage(page, pshot, pokerRect, [0x1c, 0x1d, 0x1d]);
  R.pokerCoverage = +pcov.toFixed(3);
  if (pcov < 0.05) fail(`${name}: poker canvas coverage ${pcov.toFixed(3)} too low`); else pass(`poker canvas non-transparent coverage ${(pcov * 100).toFixed(1)}%`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);

  // click a hotspot → scrolls to target
  await page.click('#labels .hotspot[data-target="#work"]');
  await sleep(1500);
  const workTop = await page.$eval('#work', (el) => el.getBoundingClientRect().top);
  if (Math.abs(workTop) > 40) fail(`${name}: clicking hotspot did not scroll to #work (top=${workTop.toFixed(0)})`); else pass(`hotspot click scrolled to #work (top=${workTop.toFixed(0)})`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);

  // pause(): label transform must stop changing
  const t1 = await page.evaluate(() => { window.__scene.studio.pause(); return document.querySelector('#labels .hotspot').style.transform; });
  await sleep(400);
  const t2 = await page.evaluate(() => document.querySelector('#labels .hotspot').style.transform);
  if (t1 !== t2) fail(`${name}: pause() did not stop the loop`); else pass('pause() stops the loop');
  await page.evaluate(() => window.__scene.studio.resume());
  await sleep(300);
  const t3 = await page.evaluate(() => document.querySelector('#labels .hotspot').style.transform);
  if (t3 === t2) fail(`${name}: resume() did not restart the loop`); else pass('resume() restarts the loop');

  // destroy → re-init (fallback guard must be released in between)
  const errsBefore = consoleErrors.length;
  const released = await page.evaluate(() => { window.__scene.destroy(); const fb = document.querySelector('#studio-fallback'); return { inline: fb.style.display, display: getComputedStyle(fb).display }; });
  if (released.inline !== '') fail(`${name}: destroy() left inline display on the fallback (${released.inline})`); else pass(`destroy() restores the fallback image's inline style (page CSS shows it as ${released.display})`);
  const reOk = await page.evaluate(() => window.__scene.reinit(false));
  await sleep(2200);
  const labelCount = await page.$$eval('#labels .hotspot', (els) => els.length);
  const shot2 = await page.screenshot();
  const cov2 = await coverage(page, shot2, heroRect);
  const guard2 = await page.$eval('#studio-fallback', (el) => getComputedStyle(el).display);
  if (!reOk || labelCount !== 4 || cov2 < 0.08 || consoleErrors.length !== errsBefore || guard2 !== 'none') fail(`${name}: destroy()+re-init failed (ok=${reOk}, labels=${labelCount}, cov=${cov2.toFixed(3)}, fallback=${guard2})`);
  else pass(`destroy() then re-init works (labels=${labelCount}, coverage ${(cov2 * 100).toFixed(1)}%, fallback re-suppressed)`);

  // un-hiding the fallback on purpose lifts the guard at once (MutationObserver)
  const lifted = await page.evaluate(async () => { const fb = document.querySelector('#studio-fallback'); fb.hidden = false; await new Promise((r) => setTimeout(r, 50)); const d = getComputedStyle(fb).display; fb.hidden = true; fb.style.display = ''; return d; });
  if (lifted === 'none') fail(`${name}: removing [hidden] did not lift the guard`); else pass('removing the hidden attribute lifts the guard immediately');
  await page.evaluate(() => window.__scene.reinit(false));
  await sleep(500);

  // reducedMotion re-init: one still frame, labels positioned, no loop
  await page.evaluate(() => window.__scene.reinit(true));
  await sleep(700);
  const rm1 = await page.evaluate(() => ({ t: document.querySelector('#labels .hotspot').style.transform, op: getComputedStyle(document.querySelector('#labels .hotspot')).opacity, fps: window.__scene.studio.stats().fps }));
  await sleep(500);
  const rm2 = await page.evaluate(() => document.querySelector('#labels .hotspot').style.transform);
  const shot3 = await page.screenshot({ path: path.join(SHOTS, `studio-${name}-reduced.png`) });
  const cov3 = await coverage(page, shot3, heroRect);
  const rmLabels = await readLabels(page, '#labels');
  const rmOv = overlapsOf(rmLabels);
  if (!/translate3d/.test(rm1.t) || rm1.t !== rm2 || cov3 < 0.08 || parseFloat(rm1.op) < 0.9) fail(`${name}: reducedMotion re-init (transform=${!!rm1.t}, static=${rm1.t === rm2}, cov=${cov3.toFixed(3)}, op=${rm1.op})`);
  else pass(`reducedMotion renders a still frame with positioned labels (coverage ${(cov3 * 100).toFixed(1)}%)`);
  if (rmOv.length) fail(`${name}: reducedMotion labels overlap ${JSON.stringify(rmOv)}`); else pass('reducedMotion labels are de-overlapped on the single frame');
  await page.evaluate(() => window.__scene.reinit(false));
  await sleep(500);

  // resize handling: shrink the viewport and make sure labels move + canvas re-sizes
  await page.setViewportSize({ width: viewport.width - 120, height: viewport.height });
  await sleep(500);
  const cw = await page.$eval('#studio', (el) => el.width);
  if (cw !== viewport.width - 120) fail(`${name}: canvas width after resize ${cw} != ${viewport.width - 120}`); else pass('ResizeObserver resizes the drawing buffer');
  await page.setViewportSize(viewport);
  await sleep(300);

  // IntersectionObserver: scrolling the hero out of view must pause its loop; scrolling back resumes it
  await page.evaluate(() => document.querySelector('#lalapoker').scrollIntoView());
  await sleep(500);
  const io1 = await page.evaluate(() => document.querySelector('#labels .hotspot').style.transform);
  await sleep(400);
  const io2 = await page.evaluate(() => document.querySelector('#labels .hotspot').style.transform);
  if (io1 !== io2) fail(`${name}: loop kept running while the canvas was off-screen`); else pass('loop pauses while the canvas is off-screen');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  const io3 = await page.evaluate(() => document.querySelector('#labels .hotspot').style.transform);
  if (io3 === io2) fail(`${name}: loop did not resume after scrolling back`); else pass('loop resumes when the canvas re-enters the viewport');

  // destroy(): labels removed, GPU memory released
  const mem = await page.evaluate(() => { const s = window.__scene.studio, p = window.__scene.poker; window.__scene.destroy(); return { studio: s.stats().memory, poker: p.stats().memory }; });
  await sleep(200);
  const labelsAfter = await page.$$eval('#labels .hotspot', (els) => els.length);
  if (labelsAfter !== 0) fail(`${name}: destroy() left ${labelsAfter} labels`); else pass('destroy() removes labels');
  if (mem.studio.geometries || mem.studio.textures || mem.poker.geometries || mem.poker.textures) fail(`${name}: destroy() leaked GPU resources ${JSON.stringify(mem)}`); else pass('destroy() releases all geometries and textures');

  R.consoleErrors = consoleErrors; R.consoleWarnings = consoleWarnings;
  if (consoleErrors.length) fail(`${name}: console errors: ${consoleErrors.join(' | ')}`); else pass('zero console errors');
  if (consoleWarnings.length) fail(`${name}: console warnings: ${consoleWarnings.join(' | ')}`); else pass('zero console warnings');
  await ctx.close();
}

/** Harness pinned to the phone-sized stage index.html produces at 400px (352x335), for a like-for-like check. */
async function testSmallStage(browser) {
  console.log('\n== harness small stage (352x335 in a 400x800 viewport)');
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors = [], consoleWarnings = [];
  attachConsole(page, consoleErrors, consoleWarnings);
  await page.goto(`${BASE}/dev/harness-scene.html?rm=0&stage=352x335`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__scene && window.__scene.ready, null, { timeout: 10000 }).catch(() => fail('small stage: scenes did not initialise'));
  await sleep(2300);
  const labels = await readLabels(page, '#labels');
  const ov = overlapsOf(labels);
  const hero = await page.$eval('#hero', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const inside = labels.every((L) => L.x >= hero.x - 0.5 && L.y >= hero.y - 0.5 && L.x + L.w <= hero.x + hero.w + 0.5 && L.y + L.h <= hero.y + hero.h + 0.5);
  await page.screenshot({ path: path.join(SHOTS, 'studio-small-stage.png'), clip: { x: hero.x - 8, y: hero.y - 8, width: hero.w + 16, height: hero.h + 16 } });
  results.viewports.smallStage = { labels, overlaps: ov, inside };
  if (ov.length) fail(`small stage: overlapping labels ${JSON.stringify(ov)}`); else pass('no overlaps on a 352x335 stage');
  if (!inside) fail('small stage: labels leave the stage'); else pass('all labels stay inside the 352x335 stage');
  if (!labels.every((L) => L.pill === 'none')) fail('small stage: pills not collapsed'); else pass('pills collapsed to numbered dots');
  if (consoleErrors.length || consoleWarnings.length) fail(`small stage: console ${[...consoleErrors, ...consoleWarnings].join(' | ')}`); else pass('zero console errors/warnings');
  await ctx.close();
}

/** Read-only integration pass over the real page: the fallbacks must not paint, labels must not overlap. */
async function testIndex(browser, name, viewport) {
  console.log(`\n== index.html ${name} (${viewport.width}x${viewport.height})`);
  const R = results.index[name] = {};
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors = [], consoleWarnings = [];
  attachConsole(page, consoleErrors, consoleWarnings);
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__portfolio && window.__portfolio.scene, null, { timeout: 15000 }).catch(() => fail(`${name}: index scene did not initialise`));
  await sleep(2500);
  await page.evaluate(() => document.querySelector('.scene-stage').scrollIntoView({ block: 'center' }));
  await sleep(800);
  const probe = await page.evaluate(() => {
    const cv = document.querySelector('#scene'); const r = cv.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const fb = document.querySelector('#scene-fallback'), pf = document.querySelector('#poker-fallback');
    const s = window.__portfolio.scene.stats();
    return { stage: { x: r.x, y: r.y, w: r.width, h: r.height }, top: top && (top.closest('.hotspot') ? 'CANVAS#scene' : top.tagName + '#' + top.id), fallback: getComputedStyle(fb).display, pokerFallback: getComputedStyle(pf).display, calls: s.calls, triangles: s.triangles };
  });
  const labels = await readLabels(page, '#scene-labels');
  const ov = overlapsOf(labels);
  const st = probe.stage;
  const inside = labels.every((L) => L.x >= st.x - 0.5 && L.y >= st.y - 0.5 && L.x + L.w <= st.x + st.w + 0.5 && L.y + L.h <= st.y + st.h + 0.5);
  Object.assign(R, probe, { labels, overlaps: ov, inside });
  await page.screenshot({ path: path.join(SHOTS, `index-${name}-stage.png`), clip: { x: Math.max(0, st.x - 8), y: Math.max(0, st.y - 8), width: st.w + 16, height: st.h + 16 } });
  if (probe.top !== 'CANVAS#scene') fail(`${name}: element at the stage centre is ${probe.top}, not the canvas`); else pass('the WebGL canvas is the element at the stage centre');
  if (probe.fallback !== 'none') fail(`${name}: #scene-fallback still renders (${probe.fallback})`); else pass('#scene-fallback (studio.png) does not paint');
  if (probe.pokerFallback !== 'none') fail(`${name}: #poker-fallback still renders (${probe.pokerFallback})`); else pass('#poker-fallback (og.jpg) does not paint');
  if (labels.length !== 4) fail(`${name}: ${labels.length} labels`); else pass(`4 labels on a ${st.w.toFixed(0)}x${st.h.toFixed(0)} stage; compact=${labels[0].compact}`);
  if (ov.length) fail(`${name}: overlapping labels ${JSON.stringify(ov)}`); else pass('no overlapping labels on the real page');
  if (!inside) fail(`${name}: labels leave the stage`); else pass('labels stay inside the stage');
  // poker canvas really visible
  await page.evaluate(() => document.querySelector('.poker-visual').scrollIntoView({ block: 'center' }));
  await sleep(1800);
  const pk = await page.evaluate(() => { const cv = document.querySelector('#poker-scene'); const r = cv.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { top: top && (top.tagName + '#' + top.id), rect: { x: r.x, y: r.y, width: r.width, height: r.height } }; });
  const pshot = await page.screenshot({ path: path.join(SHOTS, `index-${name}-poker.png`), clip: { x: pk.rect.x, y: pk.rect.y, width: pk.rect.width, height: pk.rect.height } });
  R.pokerTop = pk.top;
  if (pk.top !== 'CANVAS#poker-scene') fail(`${name}: element at the poker centre is ${pk.top}`); else pass('the poker canvas is the element at its centre');
  if (consoleErrors.length) fail(`${name}: index console errors: ${consoleErrors.join(' | ')}`); else pass('zero console errors on index.html');
  if (consoleWarnings.length) fail(`${name}: index console warnings: ${consoleWarnings.join(' | ')}`); else pass('zero console warnings on index.html');
  await ctx.close();
}

(async () => {
  const server = await ensureServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });
  try {
    await testViewport(browser, '1440', { width: 1440, height: 900 });
    await testViewport(browser, '768', { width: 768, height: 1024 });
    await testViewport(browser, '400', { width: 400, height: 800 });
    await testSmallStage(browser);
    await testIndex(browser, '1440', { width: 1440, height: 900 });
    await testIndex(browser, '768', { width: 768, height: 1024 });
    await testIndex(browser, '400', { width: 400, height: 800 });
  } catch (e) { fail('exception: ' + (e.stack || e.message)); }
  await browser.close();
  if (server) server.kill();
  const vps = Object.values(results.viewports).filter((v) => v.fps);
  results.fps = Math.round(vps.reduce((a, v) => a + v.fps, 0) / Math.max(1, vps.length));
  fs.writeFileSync(path.join(__dirname, 'shots', 'scene-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.ok ? 'ALL PASSED' : 'FAILURES: ' + results.errors.length}  (avg fps ${results.fps})`);
  process.exit(results.ok ? 0 : 1);
})();
