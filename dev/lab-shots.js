// Hero studio screenshots + scene stats at three widths, for reviewing the lab bay.  node dev/lab-shots.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['tablet', { width: 768, height: 1024 }], ['mobile', { width: 400, height: 800 }]]) {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => document.querySelector('.scene-stage').scrollIntoView({ block: 'center' })); await page.waitForTimeout(700);
    const info = await page.evaluate(() => {
      const s = window.__portfolio?.scene; const st = s?.stats?.();
      const labels = [...document.querySelectorAll('#scene-labels .hotspot')].map((b) => { const r = b.getBoundingClientRect(); return `${b.dataset.id}@${Math.round(r.x)},${Math.round(r.y)}`; });
      const c = document.getElementById('scene').getBoundingClientRect();
      return { stats: st && { triangles: st.triangles, calls: st.calls, fps: st.fps }, canvas: `${Math.round(c.width)}x${Math.round(c.height)}`, labels };
    });
    console.log(name, JSON.stringify(info), errors.length ? 'ERRORS: ' + errors.slice(0, 3).join(' | ') : 'no errors');
    await page.locator('.scene-stage').screenshot({ path: `dev/shots/lab-${name}-stage.png` });
    if (name === 'desktop') await page.screenshot({ path: 'dev/shots/lab-desktop-hero.png' });
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
