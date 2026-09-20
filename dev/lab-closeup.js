// Close-up of the lab bay at 2x pixel density, plus the reduced-motion still frame.  node dev/lab-closeup.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 }); await page.waitForTimeout(5000);
  const r = await page.evaluate(() => { const c = document.getElementById('scene').getBoundingClientRect(); return { x: c.x, y: c.y, width: c.width, height: c.height }; });
  await page.screenshot({ path: 'dev/shots/lab-closeup.png', clip: { x: r.x, y: r.y + r.height * 0.1, width: r.width * 0.5, height: r.height * 0.5 } });
  await page.close();
  const still = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await still.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 }); await still.waitForTimeout(2500);
  await still.locator('.scene-stage').screenshot({ path: 'dev/shots/lab-still.png' });
  await browser.close();
  console.log('closeup + still frame written');
})().catch((e) => { console.error(e); process.exit(1); });
