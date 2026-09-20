// Software-GL fps probe for the hero scene (same launch flags as the e2e suite).  node dev/fps-probe.js [label]
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 }); await page.waitForTimeout(4500);
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(Math.round(n / 2)); }; requestAnimationFrame(tick); })));
  const st = await page.evaluate(() => { const s = window.__portfolio.scene.stats(); return { triangles: s.triangles, calls: s.calls }; });
  console.log(process.argv[2] || 'scene', 'rAF fps:', runs.join(' / '), JSON.stringify(st));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
