// Full-page integration test. Run with the server up on :3000 →  node dev/e2e.js
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const fs = require('fs');
fs.mkdirSync('dev/shots', { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['tablet', { width: 768, height: 1024 }], ['mobile', { width: 400, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [], warnings = [], failed = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    page.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(3500);

    // hero scene (brought into view first: on phones the studio sits below the intro copy)
    await page.evaluate(() => document.querySelector('.scene-stage').scrollIntoView({ block: 'center' })); await page.waitForTimeout(600);
    const hero = await page.evaluate(() => {
      const c = document.getElementById('scene'); const fb = document.getElementById('scene-fallback');
      const labels = [...document.querySelectorAll('#scene-labels .hotspot')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.dataset.target, x: r.x, y: r.y, w: r.width, vis: getComputedStyle(b).opacity !== '0' }; });
      return { canvasHidden: c.hidden, fallbackShown: !fb.hidden, labels, sceneCtrl: !!(window.__portfolio && window.__portfolio.scene) };
    });
    check(`${name}: 3D studio scene initialised (not fallback)`, hero.sceneCtrl && !hero.fallbackShown, JSON.stringify({ fallback: hero.fallbackShown }));
    check(`${name}: 6 hotspot labels rendered`, hero.labels.length === 6, JSON.stringify(hero.labels.map((l) => l.t)));
    check(`${name}: studio page links to Under the hood (nav + hero)`, await page.evaluate(() => !!document.querySelector('.site-nav a[href="technical.html"]') && !!document.querySelector('.intro-actions a[href="technical.html"]')));
    const inView = hero.labels.filter((l) => l.x >= 0 && l.x + l.w <= vp.width && l.y >= 0 && l.y <= vp.height).length;
    check(`${name}: hotspot labels inside viewport`, inView === hero.labels.length, `${inView}/${hero.labels.length}`);
    await page.screenshot({ path: `dev/shots/e2e-${name}-hero.png` });

    // hotspot click scrolls to target
    if (hero.labels.length) {
      const before = await page.evaluate(() => scrollY);
      await page.click('#scene-labels .hotspot[data-target="#book"]');
      await page.waitForTimeout(1200);
      const after = await page.evaluate(() => scrollY);
      check(`${name}: clicking a hotspot scrolls to its section`, after > before + 200, `${before} → ${after}`);
      await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(400);
    }

    // fps of hero scene
    const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(Math.round(n / 2)); }; requestAnimationFrame(tick); }));
    // Headless runs use SwiftShader (software GL), so this is a jank smoke floor, not a performance target; real GPUs run at vsync.
    check(`${name}: page runs ≥ 15 fps with the scene visible (software GL floor)`, fps >= 15, `${fps} fps`);

    // career: tabs + dialog + gallery
    await page.click('#company-list button:nth-child(2)'); await page.waitForTimeout(500);
    const tab2 = await page.evaluate(() => document.querySelector('#company-content h3')?.textContent);
    check(`${name}: company tab switches`, tab2 === 'Lala Gaming', tab2);
    await page.click('.project'); await page.waitForTimeout(500);
    check(`${name}: project dialog opens`, await page.evaluate(() => document.getElementById('detail').open));
    const hasGoogle = await page.evaluate(() => !!document.querySelector('#detail .google'));
    check(`${name}: dialog has a Google Images link`, hasGoogle);
    const techHref = await page.evaluate(() => document.querySelector('#detail .detail-links a.tech')?.getAttribute('href') || '');
    check(`${name}: dialog links to the technical breakdown`, techHref === 'technical.html#lala-poker', techHref);
    await page.click('#detail .detail-hero'); await page.waitForTimeout(600);
    const lb = await page.evaluate(() => { const d = document.getElementById('lightbox'); return { open: !!(d && d.open), counter: d ? (d.textContent.match(/\d+\s*\/\s*\d+/) || [''])[0] : '' }; });
    check(`${name}: lightbox opens from the dialog hero`, lb.open, lb.counter);
    await page.screenshot({ path: `dev/shots/e2e-${name}-lightbox.png` });
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
    const lb2 = await page.evaluate(() => (document.getElementById('lightbox').textContent.match(/\d+\s*\/\s*\d+/) || [''])[0]);
    check(`${name}: lightbox arrow key advances`, lb2 !== lb.counter, `${lb.counter} → ${lb2}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    check(`${name}: Escape closes the lightbox`, await page.evaluate(() => !document.getElementById('lightbox').open));
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    check(`${name}: second Escape closes the project dialog`, await page.evaluate(() => !document.getElementById('detail').open));
    await page.evaluate(() => { const d = document.getElementById('detail'); if (d.open) d.close(); const l = document.getElementById('lightbox'); if (l && l.open) l.close(); });
    await page.waitForTimeout(300);

    // City Crafters spotlight
    await page.evaluate(() => document.getElementById('citycrafters').scrollIntoView()); await page.waitForTimeout(1800);
    const city = await page.evaluate(() => ({ ctrl: !!(window.__portfolio && window.__portfolio.city), fallback: !document.getElementById('city-fallback').hidden, tabs: document.querySelectorAll('#city-tabs button').length, stats: document.querySelectorAll('#city-stats div').length, roles: document.querySelectorAll('.role-card').length, title: document.querySelector('#city-feature h3')?.textContent }));
    check(`${name}: City Crafters 3D turntable initialised`, city.ctrl && !city.fallback);
    check(`${name}: City Crafters section renders tabs, stats, roles`, city.tabs === 4 && city.stats === 4 && city.roles === 2, JSON.stringify(city));
    await page.click('#city-tabs button:nth-child(3)'); await page.waitForTimeout(900);
    const cityTitle = await page.evaluate(() => document.querySelector('#city-feature h3')?.textContent);
    check(`${name}: City Crafters tab switches the feature panel`, cityTitle === 'Unseen Blade', cityTitle);
    await page.screenshot({ path: `dev/shots/e2e-${name}-city.png` });
    await page.click('#city-feature [data-open-project]'); await page.waitForTimeout(500);
    check(`${name}: "Open the case study" opens the project dialog`, await page.evaluate(() => document.getElementById('detail').open && document.getElementById('detail-title')?.textContent === 'Unseen Blade'));
    await page.evaluate(() => document.getElementById('detail').close()); await page.waitForTimeout(300);

    // poker scene
    await page.evaluate(() => document.getElementById('lalapoker').scrollIntoView()); await page.waitForTimeout(1500);
    const poker = await page.evaluate(() => ({ ctrl: !!(window.__portfolio && window.__portfolio.poker), fallback: !document.getElementById('poker-fallback').hidden, rail: document.querySelectorAll('#poker-rail button').length }));
    check(`${name}: poker 3D scene initialised`, poker.ctrl && !poker.fallback);
    check(`${name}: screenshot rail has 15 shots`, poker.rail === 15, String(poker.rail));
    await page.screenshot({ path: `dev/shots/e2e-${name}-poker.png` });
    await page.click('#poker-rail button:nth-child(3)'); await page.waitForTimeout(500);
    const lb3 = await page.evaluate(() => { const d = document.getElementById('lightbox'); return d && d.open ? (d.textContent.match(/\d+\s*\/\s*\d+/) || [''])[0] : ''; });
    check(`${name}: rail click opens lightbox at the 3rd shot`, /^3\s*\/\s*15$/.test(lb3), lb3);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.evaluate(() => { const l = document.getElementById('lightbox'); if (l && l.open) l.close(); });

    // flipbook
    await page.evaluate(() => document.getElementById('book').scrollIntoView()); await page.waitForTimeout(1500);
    const fb0 = await page.evaluate(() => ({ ctrl: !!(window.__portfolio && window.__portfolio.flip), sheets: document.querySelectorAll('#flipbook .flipbook__sheet').length, counter: (document.querySelector('#flipbook')?.textContent.match(/\d+\s*\/\s*91/) || [''])[0], imgs: [...document.querySelectorAll('#flipbook img')].filter((i) => i.getAttribute('src')).length }));
    check(`${name}: flipbook initialised with sheets`, fb0.ctrl && fb0.sheets > 20, JSON.stringify(fb0));
    check(`${name}: flipbook lazy-loads (≤ 20 images with src)`, fb0.imgs > 0 && fb0.imgs <= 20, String(fb0.imgs));
    await page.screenshot({ path: `dev/shots/e2e-${name}-book-closed.png` });
    await page.evaluate(() => window.__portfolio.flip.next()); await page.waitForTimeout(1200);
    await page.evaluate(() => window.__portfolio.flip.next()); await page.waitForTimeout(1200);
    const fb1 = await page.evaluate(() => (document.querySelector('#flipbook')?.textContent.match(/\d+\s*\/\s*91/) || [''])[0]);
    check(`${name}: flipbook next() advances the counter`, fb1 && fb1 !== fb0.counter, `${fb0.counter} → ${fb1}`);
    await page.screenshot({ path: `dev/shots/e2e-${name}-book-open.png` });
    await page.click('#book-toc li:nth-child(5)'); await page.waitForTimeout(2500);
    const fb2 = await page.evaluate(() => (document.querySelector('#flipbook')?.textContent.match(/\d+\s*\/\s*91/) || [''])[0]);
    check(`${name}: TOC click jumps the flipbook`, fb2 && fb2 !== fb1, `${fb1} → ${fb2}`);

    // side quests
    await page.evaluate(() => document.getElementById('side-quests').scrollIntoView()); await page.waitForTimeout(800);
    const side = await page.evaluate(() => ({ cards: document.querySelectorAll('.side-card').length, tabs: document.querySelectorAll('#company-list button').length, chapters: document.getElementById('work-chapters').textContent }));
    check(`${name}: DR3 and Gaya live in the side-quests section, not the campaign`, side.cards === 2 && side.tabs === 6 && /06$/.test(side.chapters), JSON.stringify(side));
    await page.click('.side-card [data-side]'); await page.waitForTimeout(500);
    check(`${name}: side-quest card opens its case study`, await page.evaluate(() => document.getElementById('detail').open && /Wi-Fi/.test(document.getElementById('detail-title')?.textContent || '')));
    await page.evaluate(() => document.getElementById('detail').close()); await page.waitForTimeout(300);

    // ideas
    await page.evaluate(() => document.getElementById('ideas').scrollIntoView()); await page.waitForTimeout(1000);
    const reels = await page.evaluate(() => document.querySelectorAll('.reel').length);
    check(`${name}: 12 reels rendered`, reels === 12, String(reels));
    await page.screenshot({ path: `dev/shots/e2e-${name}-ideas.png` });
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(600);
    await page.screenshot({ path: `dev/shots/e2e-${name}-full.png`, fullPage: true });

    // horizontal overflow
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${name}: no horizontal page overflow`, overflow <= 0, `${overflow}px`);

    check(`${name}: zero console errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
    check(`${name}: zero failed requests`, failed.length === 0, failed.slice(0, 5).join(' | '));
    if (warnings.length) console.log(`${name}: warnings (${warnings.length}):`, warnings.slice(0, 5));
    await ctx.close();
  }
  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
