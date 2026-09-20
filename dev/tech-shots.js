// Element screenshots of every figure and the cover of technical.html, for visual review.  node dev/tech-shots.js [width]
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const width = Number(process.argv[2] || 1440);
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto('http://localhost:3000/technical.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('.cover').screenshot({ path: `dev/shots/tech-${width}-cover.png` });
  await page.locator('#contents').screenshot({ path: `dev/shots/tech-${width}-contents.png` });
  await page.locator('#pit-protocol .dossier__head').screenshot({ path: `dev/shots/tech-${width}-head.png` });
  await page.locator('#pit-protocol .spec').screenshot({ path: `dev/shots/tech-${width}-spec.png` });
  await page.locator('#pit-protocol .sketch').screenshot({ path: `dev/shots/tech-${width}-sketch.png` });
  await page.locator('#pit-protocol .ledger').screenshot({ path: `dev/shots/tech-${width}-ledger.png` });
  const figs = await page.locator('figure.fig').all();
  for (const f of figs) { const id = await f.getAttribute('id'); await f.scrollIntoViewIfNeeded(); await f.screenshot({ path: `dev/shots/tech-${width}-${id}.png` }); }
  console.log(`${figs.length} figures shot at ${width}px`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
