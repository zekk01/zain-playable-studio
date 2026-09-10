// Playwright test for js/cityscene.js via dev/harness-cityscene.html.
// Usage: node dev/test-cityscene.js   (starts its own static server on PORT, default 3201, if none is listening)
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3201;
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MAX_TRIS = 40000, MAX_CALLS = 150, MIN_FPS = 15; // fps floor is for SwiftShader (software GL); real GPUs run at vsync
const results = { ok: true, viewports: {}, fps: null, tris: null, calls: null, errors: [] };
const fail = (msg) => { results.ok = false; results.errors.push(msg); console.log('  FAIL', msg); };
const pass = (msg) => console.log('  ok  ', msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ping() { return new Promise((res) => { http.get(BASE + '/dev/harness-cityscene.html', (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)); }); }
async function ensureServer() {
  if (await ping()) return null;
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { await sleep(100); if (await ping()) return child; }
  throw new Error('server did not start');
}

/** Ratio of pixels of a PNG (already clipped to the stage) that differ from the page background. */
async function coverage(page, png, bg = [0x15, 0x16, 0x16]) {
  return page.evaluate(async ({ b64, bg }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) n++;
    return n / (d.length / 4);
  }, { b64: png.toString('base64'), bg });
}

const attachConsole = (page, errors, warnings) => {
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push(t); else if (m.type() === 'warning') warnings.push(t); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
};
const stageRect = (page) => page.$eval('#stage', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const stats = (page) => page.evaluate(() => window.__city.ctl.stats());
const shot = (page, rect, name) => page.screenshot({ path: path.join(SHOTS, name), clip: rect });

/** Index of the diorama nearest the horizontal centre; the one directly behind it projects there too, so ties go to the front-most (smallest depth). */
function nearestToCentre(st, rect) {
  const cx = rect.width / 2;
  let best = -1;
  st.dioramas.forEach((d, k) => {
    if (best < 0) { best = k; return; }
    const b = st.dioramas[best], dd = Math.abs(d.x - cx) - Math.abs(b.x - cx);
    if (dd < -3 || (Math.abs(dd) <= 3 && d.depth < b.depth)) best = k;
  });
  return best;
}
/** The focused diorama must be the one whose projected anchor is nearest the horizontal centre, front-most, lit and facing the camera. */
function checkCentred(name, st, rect, i) {
  const cx = rect.width / 2;
  const dists = st.dioramas.map((d) => Math.abs(d.x - cx));
  const nearest = nearestToCentre(st, rect);
  const d = st.dioramas[i];
  const frontMost = st.dioramas.every((o) => o.depth >= d.depth);
  const facing = Math.abs(((st.angle + i * Math.PI / 2 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.02;
  if (nearest !== i || st.focused !== i || st.tweening || !facing || !frontMost || d.lit < 0.9) fail(`${name}: focus(${i}) → nearest=${nearest} focused=${st.focused} tweening=${st.tweening} facing=${facing} frontMost=${frontMost} lit=${d.lit} |dx|=${dists.map((v) => v.toFixed(0)).join('/')}`);
  else pass(`focus(${i}) "${d.id}" centred: |x-centre| = ${dists[i].toFixed(1)}px (others ${dists.filter((_, k) => k !== i).map((v) => v.toFixed(0)).join('/')}), front-most, lit ${d.lit}, facing camera`);
}

async function testViewport(browser, name, viewport) {
  console.log(`\n== ${name} (${viewport.width}x${viewport.height})`);
  const R = results.viewports[name] = {};
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [], warnings = [];
  attachConsole(page, errors, warnings);

  await page.goto(`${BASE}/dev/harness-cityscene.html?rm=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__city && window.__city.ready, null, { timeout: 10000 }).catch(() => fail(`${name}: scene did not initialise (WebGL?)`));
  // The stage rect is re-measured before every pixel comparison: page chrome above the stage may reflow (e.g. the
  // toolbar wrapping), and a stale rect would compare live readout pixels instead of the canvas.
  let rect = await stageRect(page);
  const fresh = async () => (rect = await stageRect(page));
  R.stage = rect;
  await sleep(550);
  await shot(page, rect, `city-${name}-intro.png`);                       // intro mid-frame (pedestals still rising)
  await sleep(2100);

  // idle: coverage + budget
  const idle = await shot(page, await fresh(), `city-${name}-idle.png`);
  const cov = await coverage(page, idle);
  R.coverage = +cov.toFixed(3);
  if (cov < 0.08) fail(`${name}: canvas coverage ${cov.toFixed(3)} too low`); else pass(`canvas has non-transparent pixels (${(cov * 100).toFixed(1)}% of the stage)`);
  let st = await stats(page);
  R.triangles = st.triangles; R.calls = st.calls; R.memory = st.memory;
  console.log(`  ${st.triangles} tris · ${st.calls} draw calls · memory ${st.memory.geometries} geometries / ${st.memory.textures} textures`);
  if (st.triangles > MAX_TRIS) fail(`${name}: ${st.triangles} triangles > ${MAX_TRIS}`); else pass(`triangles ${st.triangles} ≤ ${MAX_TRIS}`);
  if (st.calls > MAX_CALLS) fail(`${name}: ${st.calls} draw calls > ${MAX_CALLS}`); else pass(`draw calls ${st.calls} ≤ ${MAX_CALLS}`);
  const fallback = await page.$eval('#city-fallback', (el) => getComputedStyle(el).display);
  if (fallback !== 'none') fail(`${name}: [hidden] fallback image still paints (${fallback})`); else pass('[hidden] fallback image is suppressed while the scene is live');

  // fps over 2 s (page rAF count)
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 >= 2000) res(Math.round(n * 1000 / (performance.now() - t0))); else requestAnimationFrame(f); })(); }));
  R.fps = fps;
  if (fps < MIN_FPS) fail(`${name}: low fps ${fps}`); else pass(`fps over 2 s: ${fps} (module meter ${(await stats(page)).fps})`);

  // picking hits real geometry: with the pit in front, the visible swordsman of the BACK diorama must be his own click
  // (nearest mesh wins, not a front hit volume), and the empty sky above the dioramas must show no pointer cursor.
  await fresh();
  // (pointer parallax re-aims the camera as the mouse travels, so aim, let the lerp settle, then re-project the anchor)
  const aim = async (i) => { const a = (await stats(page)).dioramas[i]; await page.mouse.move(rect.x + a.x, rect.y + a.y); await sleep(900); const b = (await stats(page)).dioramas[i]; await page.mouse.move(rect.x + b.x, rect.y + b.y); await sleep(200); return b; };
  const back = await aim(2);
  const backCursor = await page.$eval('#city', (el) => el.style.cursor);
  const logBefore0 = await page.evaluate(() => window.__city.focusLog.length);
  await page.mouse.click(rect.x + back.x, rect.y + back.y); await sleep(250);
  const log0 = await page.evaluate(() => window.__city.focusLog.map((e) => e.i));
  if (backCursor !== 'pointer' || log0.length !== logBefore0 + 1 || log0[log0.length - 1] !== 2) fail(`${name}: back diorama (2) at (${back.x.toFixed(0)},${back.y.toFixed(0)}) behind the pit: cursor=${JSON.stringify(backCursor)} onFocus log ${JSON.stringify(log0)}`);
  else pass(`clicking the visible back diorama (2) behind the front pedestal fires onFocus(2), not the front's index`);
  const sky = [];
  for (const fx of [0.3, 0.5, 0.7]) { await page.mouse.move(rect.x + rect.width * fx, rect.y + 5); await sleep(120); sky.push(await page.$eval('#city', (el) => el.style.cursor)); }
  if (sky.some((c) => c !== '')) fail(`${name}: pointer cursor over empty sky: ${JSON.stringify(sky)}`); else pass('no pointer cursor over the empty sky above the dioramas');
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await sleep(1300);

  // focus(1..3): centred + facing after 1.2 s
  for (const i of [1, 2, 3]) {
    await page.evaluate((k) => window.__city.focus(k), i);
    await sleep(1200);
    await shot(page, await fresh(), `city-${name}-f${i}.png`);
    st = await stats(page);
    checkCentred(name, st, rect, i);
  }
  R.afterFocus3 = st.dioramas;

  // hover → pointer cursor; click on diorama 2 (now on a side) → onFocus(2)
  const d2 = await aim(2);
  const inside = d2.x > 0 && d2.x < rect.width && d2.y > 0 && d2.y < rect.height;
  if (!inside) fail(`${name}: diorama 2 anchor (${d2.x.toFixed(0)},${d2.y.toFixed(0)}) is outside the ${rect.width}x${rect.height} stage`);
  const px = rect.x + d2.x, py = rect.y + d2.y;
  const cursorOn = await page.$eval('#city', (el) => el.style.cursor);
  const logBefore = await page.evaluate(() => window.__city.focusLog.length);
  await page.mouse.click(px, py);
  await sleep(250);
  const log = await page.evaluate(() => window.__city.focusLog.map((e) => e.i));
  if (log.length !== logBefore + 1 || log[log.length - 1] !== 2) fail(`${name}: click at diorama 2 (${d2.x.toFixed(0)},${d2.y.toFixed(0)}) → onFocus log ${JSON.stringify(log)}`);
  else pass(`click at diorama 2's projected position (${d2.x.toFixed(0)},${d2.y.toFixed(0)}) fired onFocus(2)`);
  await page.mouse.move(rect.x + 4, rect.y + 4); await sleep(200);
  const cursorOff = await page.$eval('#city', (el) => el.style.cursor);
  if (cursorOn !== 'pointer' || cursorOff !== '') fail(`${name}: hover cursor on=${JSON.stringify(cursorOn)} off=${JSON.stringify(cursorOff)}`); else pass('hovering a diorama shows a pointer cursor (and clears off it)');
  await page.mouse.move(viewport.width / 2, viewport.height / 2); // neutral parallax
  await sleep(1200);
  st = await stats(page);
  checkCentred(name, st, rect, 2);
  // a click on empty stage must not fire
  const logBefore2 = await page.evaluate(() => window.__city.focusLog.length);
  await page.mouse.click(rect.x + 6, rect.y + 6); await sleep(150);
  const logAfter2 = await page.evaluate(() => window.__city.focusLog.length);
  if (logAfter2 !== logBefore2) fail(`${name}: clicking empty stage fired onFocus`); else pass('clicking empty stage does not fire onFocus');

  // pause()/resume(): the renderer frame counter must stop, then continue
  const f1 = await page.evaluate(() => { window.__city.ctl.pause(); return window.__city.ctl.stats().frame; });
  await sleep(400);
  const f2 = await page.evaluate(() => window.__city.ctl.stats().frame);
  await page.evaluate(() => window.__city.ctl.resume());
  await sleep(400);
  const f3 = await page.evaluate(() => window.__city.ctl.stats().frame);
  if (f2 !== f1 || f3 <= f2) fail(`${name}: pause/resume frames ${f1}/${f2}/${f3}`); else pass(`pause() stops the loop (frame ${f1}→${f2}), resume() restarts it (→${f3})`);

  // IntersectionObserver: stage off-screen → paused; back → running
  await page.evaluate(() => document.querySelector('.tail').scrollIntoView({ block: 'end' }));
  await sleep(500);
  const g1 = await page.evaluate(() => window.__city.ctl.stats().frame);
  await sleep(400);
  const g2 = await page.evaluate(() => window.__city.ctl.stats().frame);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  const g3 = await page.evaluate(() => window.__city.ctl.stats().frame);
  if (g2 !== g1 || g3 <= g2) fail(`${name}: IntersectionObserver frames ${g1}/${g2}/${g3}`); else pass('loop pauses while the stage is off-screen and resumes when it re-enters');

  // resize: shrink the viewport → drawing buffer follows
  await page.setViewportSize({ width: viewport.width - 100, height: viewport.height });
  await sleep(400);
  const cw = await page.$eval('#city', (el) => ({ buf: el.width, css: el.clientWidth }));
  if (cw.buf !== cw.css) fail(`${name}: canvas buffer ${cw.buf} != css width ${cw.css} after resize`); else pass(`ResizeObserver resizes the drawing buffer (${cw.buf}px)`);
  await page.setViewportSize(viewport);
  await sleep(300);

  // destroy → re-init ×3: no errors, GPU memory back to 0
  const errsBefore = errors.length;
  const mems = [];
  for (let k = 0; k < 3; k++) {
    const mem = await page.evaluate(() => { const c = window.__city.ctl; window.__city.destroy(); const m = c.stats().memory; window.__city.init(false); return m; });
    mems.push(mem);
    await sleep(500);
  }
  const leak = mems.find((m) => m.geometries || m.textures);
  if (leak || errors.length !== errsBefore) fail(`${name}: destroy/re-init ×3 → memory ${JSON.stringify(mems)}, new errors ${errors.slice(errsBefore).join(' | ')}`);
  else pass(`destroy() → re-init ×3 with no errors; renderer.info.memory back to 0 geometries / 0 textures each time`);
  await sleep(2000);
  const again = await coverage(page, await page.screenshot({ clip: await fresh() }));
  if (again < 0.08) fail(`${name}: re-init renders nothing (coverage ${again.toFixed(3)})`); else pass(`re-initialised scene renders (${(again * 100).toFixed(1)}% coverage)`);

  // reducedMotion: a single still frame (identical pixels 700 ms apart), diorama 0 in front; focus() jumps instantly
  await page.evaluate(() => window.__city.reinit(true));
  await sleep(600);
  await fresh();
  const rmA = await shot(page, rect, `city-${name}-reduced.png`);
  await sleep(700);
  const rmB = await page.screenshot({ clip: rect });
  const rmSt = await stats(page);
  const rmCov = await coverage(page, rmA);
  if (!rmA.equals(rmB)) fail(`${name}: reducedMotion frames differ 700 ms apart`);
  else if (rmCov < 0.08 || nearestToCentre(rmSt, rect) !== 0) fail(`${name}: reducedMotion still frame cov=${rmCov.toFixed(3)} nearest=${nearestToCentre(rmSt, rect)}`);
  else pass(`reducedMotion: identical pixels 700 ms apart, diorama 0 in front (coverage ${(rmCov * 100).toFixed(1)}%)`);
  await page.evaluate(() => window.__city.focus(2));
  await sleep(250);
  const rmC = await page.screenshot({ clip: rect });
  const rmSt2 = await stats(page);
  if (rmC.equals(rmB) || nearestToCentre(rmSt2, rect) !== 2 || rmSt2.tweening) fail(`${name}: reducedMotion focus(2) did not jump instantly (nearest=${nearestToCentre(rmSt2, rect)})`);
  else pass('reducedMotion focus(2) jumps instantly and renders one frame');
  await sleep(700);
  const rmD = await page.screenshot({ clip: rect });
  if (!rmC.equals(rmD)) fail(`${name}: reducedMotion kept rendering after focus()`); else pass('reducedMotion stays still after the focus() frame');

  // final destroy: memory released
  const memEnd = await page.evaluate(() => { const c = window.__city.ctl; window.__city.destroy(); return c.stats().memory; });
  if (memEnd.geometries || memEnd.textures) fail(`${name}: destroy() leaked ${JSON.stringify(memEnd)}`); else pass('destroy() releases all geometries and textures');

  R.errors = errors; R.warnings = warnings;
  if (errors.length) fail(`${name}: console errors: ${errors.join(' | ')}`); else pass('zero console errors');
  if (warnings.length) fail(`${name}: console warnings: ${warnings.join(' | ')}`); else pass('zero console warnings');
  await ctx.close();
}

(async () => {
  const server = await ensureServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  try {
    await testViewport(browser, '1440', { width: 1440, height: 900 });
    await testViewport(browser, '1024', { width: 1024, height: 600 });
    await testViewport(browser, '400', { width: 400, height: 800 });
  } catch (e) { fail('exception: ' + (e.stack || e.message)); }
  await browser.close();
  if (server) server.kill();
  const vps = Object.values(results.viewports).filter((v) => v.fps);
  results.fps = Math.round(vps.reduce((a, v) => a + v.fps, 0) / Math.max(1, vps.length));
  results.tris = Math.max(...vps.map((v) => v.triangles || 0));
  results.calls = Math.max(...vps.map((v) => v.calls || 0));
  fs.writeFileSync(path.join(SHOTS, 'cityscene-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.ok ? 'ALL PASSED' : 'FAILURES: ' + results.errors.length}  (avg fps ${results.fps}, ${results.tris} tris, ${results.calls} calls)`);
  process.exit(results.ok ? 0 : 1);
})();
