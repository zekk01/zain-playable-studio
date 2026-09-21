// Technical breakdown page (technical.html). Run with the server up on :3000 →  node dev/test-technical.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const fs = require('fs');
fs.mkdirSync('dev/shots', { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const SECTIONS = ['pit-protocol', 'unseen-blade', 'target-destroyed', 'lala-poker', 'primal-echo', 'holographic-pipeline', 'abjadpolis'];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['tablet', { width: 768, height: 1024 }], ['mobile', { width: 400, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [], failed = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    page.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
    const resp = await page.goto('http://localhost:3000/technical.html', { waitUntil: 'networkidle', timeout: 60000 });
    check(`${name}: technical.html is served`, resp && resp.status() === 200, String(resp && resp.status()));
    await page.waitForTimeout(800);

    const doc = await page.evaluate((SECTIONS) => {
      const secs = [...document.querySelectorAll('section.dossier')].map((s) => s.id);
      const toc = [...document.querySelectorAll('#contents a[href^="#"]')].map((a) => a.getAttribute('href').slice(1));
      const tocResolves = toc.every((id) => !!document.getElementById(id));
      const perSection = SECTIONS.map((id) => {
        const s = document.getElementById(id);
        if (!s) return null;
        return {
          id,
          figures: s.querySelectorAll('figure.fig').length,
          figsOk: [...s.querySelectorAll('figure.fig')].every((f) => f.querySelector('svg[viewBox]') && /^Fig\s*\d+\.\d+/.test((f.querySelector('figcaption')?.textContent || '').trim())),
          specRows: s.querySelectorAll('dl.spec > div').length,
          ledger: !!s.querySelector('.ledger') && /I wrote/i.test(s.querySelector('.ledger')?.textContent || '') && /With others/i.test(s.querySelector('.ledger')?.textContent || ''),
          code: s.querySelectorAll('pre.code').length,
          h2: s.querySelector('h2')?.textContent.trim(),
        };
      });
      const texts = [...document.querySelectorAll('figure.fig svg text')].map((t) => t.getBoundingClientRect().height).filter((h) => h > 0);
      return { title: document.title, secs, toc, tocResolves, perSection, minText: texts.length ? Math.min(...texts) : 0, textCount: texts.length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        back: !!document.querySelector('a[href="index.html"], a[href="./"], a[href="/"]'),
        mailto: !!document.querySelector('a[href^="mailto:"]'),
        rail: !!document.querySelector('#rail'), railVisible: !!document.querySelector('#rail') && getComputedStyle(document.querySelector('#rail')).display !== 'none',
        glyphs: document.querySelectorAll('#contents svg').length };
    }, SECTIONS);

    check(`${name}: page title`, /under the hood/i.test(doc.title), doc.title);
    check(`${name}: seven dossiers in order`, JSON.stringify(doc.secs) === JSON.stringify(SECTIONS), JSON.stringify(doc.secs));
    check(`${name}: contents lists seven links that resolve`, doc.toc.length === 7 && doc.tocResolves, JSON.stringify(doc.toc));
    check(`${name}: contents has a drawn glyph per entry`, doc.glyphs >= 7, String(doc.glyphs));
    for (const s of doc.perSection) {
      if (!s) { check(`${name}: section missing`, false); continue; }
      check(`${name}: ${s.id} has ≥2 numbered SVG figures with captions`, s.figures >= 2 && s.figsOk, `${s.figures} figures`);
      check(`${name}: ${s.id} has a spec sheet (≥5 rows)`, s.specRows >= 5, String(s.specRows));
      check(`${name}: ${s.id} has an ownership ledger (I wrote / With others)`, s.ledger);
      check(`${name}: ${s.id} has a code sketch`, s.code >= 1, String(s.code));
    }
    check(`${name}: figure text stays legible (≥ 9px rendered)`, doc.minText >= 9, `min ${doc.minText.toFixed(1)}px over ${doc.textCount} labels`);
    check(`${name}: no horizontal page overflow`, doc.overflow <= 0, `${doc.overflow}px`);
    check(`${name}: header links back to the studio`, doc.back);
    check(`${name}: contact email wired`, doc.mailto);
    if (name === 'desktop') check(`${name}: sticky contents rail shown`, doc.rail && doc.railVisible);
    else check(`${name}: contents rail hidden on narrow screens`, !doc.railVisible);

    await page.screenshot({ path: `dev/shots/tech-${name}-top.png` });

    // contents link scrolls to its section
    const before = await page.evaluate(() => scrollY);
    try { await page.click('#contents a[href="#target-destroyed"]', { timeout: 5000 }); } catch { check(`${name}: contents link is clickable`, false); } await page.waitForTimeout(1200);
    const after = await page.evaluate(() => scrollY);
    check(`${name}: contents link scrolls to the section`, after > before + 300, `${before} → ${after}`);
    if (name === 'desktop') {
      await page.waitForTimeout(600);
      const active = await page.evaluate(() => document.querySelector('#rail a.is-active')?.getAttribute('href'));
      check(`${name}: rail marks the current section`, active === '#target-destroyed', String(active));
    }
    await page.screenshot({ path: `dev/shots/tech-${name}-section.png` });
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(400);
    await page.screenshot({ path: `dev/shots/tech-${name}-full.png`, fullPage: true });

    check(`${name}: zero console errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
    check(`${name}: zero failed requests`, failed.length === 0, failed.slice(0, 5).join(' | '));
    await ctx.close();
  }
  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
