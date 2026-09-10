// Boot: renders every section from js/data.js, wires the 3D scenes, flipbook, gallery, and page motion.
import { site, hero, companies, lalapoker, book, ideas, citycrafters } from './data.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const html = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reducedMotion) html.classList.add('motion-off');

// Modules are loaded defensively: if one fails, the rest of the page still works.
async function load(path) { try { return await import(path); } catch (err) { console.error(`[portfolio] failed to load ${path}`, err); return null; } }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const scrollTo = (target) => { const el = typeof target === 'string' ? $(target) : target; if (el) el.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' }); };

let openGallery = () => {};

/* ------------------------------------------------------------------ toolkit marquee */
function renderToolkit() {
  const track = $('#toolkit-marquee .marquee__track');
  const items = [...site.toolkit, ...site.toolkit]; // duplicated so the loop is seamless
  track.innerHTML = items.map((t) => `<b>${esc(t)}</b>`).join('');
}

/* ------------------------------------------------------------------ career campaign */
const list = $('#company-list');
const panel = $('#company-content');
const dialog = $('#detail');
const detail = $('#detail-content');
let currentCompany = 0;

function renderCompanies() {
  $('#work-chapters').textContent = `CHAPTERS 01—${String(companies.length).padStart(2, '0')}`;
  companies.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'tab'; b.id = `company-${i}`; b.setAttribute('aria-controls', 'company-content');
    b.innerHTML = `<span>${String(i + 1).padStart(2, '0')}</span>${esc(c.name)}`;
    b.addEventListener('click', () => selectCompany(i));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) return;
      e.preventDefault();
      const n = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + companies.length) % companies.length;
      selectCompany(n); list.children[n].focus();
    });
    list.appendChild(b);
  });
  selectCompany(0, true);
}

// An image with fit:'contain' (logos, posters) is shown whole over a blurred copy of itself instead of being cropped.
const pic = (im, attrs = '') => im.fit === 'contain'
  ? `<span class="media-contain"><img class="media-contain__bg" src="${im.src}" alt="" aria-hidden="true" ${attrs}><img src="${im.src}" alt="${esc(im.alt)}" ${attrs}></span>`
  : `<img src="${im.src}" alt="${esc(im.alt)}" ${attrs}>`;

function projectCard(c, p, n) {
  const first = p.images[0];
  const media = first
    ? `<div class="project__media">${pic(first, 'loading="lazy" decoding="async"')}${(p.videos && p.videos.length) ? `<span class="project__count">▶ ${p.videos.length} VIDEO${p.videos.length > 1 ? 'S' : ''} · ${p.images.length} IMAGES</span>` : p.images.length > 1 ? `<span class="project__count">${p.images.length} IMAGES</span>` : ''}</div>`
    : `<div class="project__media project__media--empty"><span>${String(n + 1).padStart(2, '0')}</span></div>`;
  return `<button class="project" type="button" data-project="${n}" aria-haspopup="dialog">${media}<span class="arrow">↗</span><div class="project__body"><span class="tag">${esc(p.tag)}</span><h4>${esc(p.title)}</h4><p>${esc(p.hook)}</p></div></button>`;
}

function selectCompany(i, silent = false) {
  currentCompany = i;
  const c = companies[i];
  [...list.children].forEach((b, n) => { b.setAttribute('aria-selected', i === n); b.tabIndex = i === n ? 0 : -1; });
  panel.setAttribute('aria-labelledby', `company-${i}`);
  const cover = c.cover
    ? `<div class="company-cover"><img src="${c.cover}" alt="" loading="lazy" decoding="async"></div>`
    : `<div class="company-cover company-cover--empty"><span class="cover-glyph">${String(i + 1).padStart(2, '0')}</span></div>`;
  panel.innerHTML = `${cover}<div class="company-body">
    <div class="company-head"><h3>${esc(c.name)}</h3><span class="date">${esc(c.period)}</span></div>
    <div class="tag">${esc(c.role)}</div>
    <p class="company-description">${esc(c.description)}</p>
    <div class="project-grid">${c.projects.map((p, n) => projectCard(c, p, n)).join('')}</div>
    <div class="company-foot"><span>${esc(c.foot)}</span>${c.site ? `<a href="${c.site}" target="_blank" rel="noopener">${esc(c.name)} ↗</a>` : ''}</div>
  </div>`;
  $$('[data-project]', panel).forEach((b) => b.addEventListener('click', () => openProject(c, c.projects[Number(b.dataset.project)], b)));
  attachTilt($$('.project', panel));
  if (!silent && window.gsap && !reducedMotion) {
    gsap.fromTo(panel.querySelectorAll('.company-body > *, .company-cover'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .5, stagger: .05, ease: 'power3.out', overwrite: true });
  }
}

let lastOpener = null;
function openProject(c, p, opener) {
  lastOpener = opener || null;
  const hero = p.images[0];
  const media = hero
    ? `<button class="detail-hero" type="button" aria-label="Open image gallery">${pic(hero)}</button>`
    : `<div class="detail-hero detail-hero--empty"><span>${esc(p.tag.split('/')[0].trim().slice(0, 2).toUpperCase())}</span></div>`;
  const strip = p.images.length > 1
    ? `<div class="detail-strip" aria-label="Image gallery">${p.images.map((im, k) => `<button type="button" data-k="${k}" aria-label="Open image ${k + 1}">${pic(im, 'loading="lazy"')}</button>`).join('')}</div>` : '';
  const videos = (p.videos && p.videos.length)
    ? `<h3>Watch</h3><div class="detail-videos">${p.videos.map((v) => `<figure class="detail-video${v.portrait ? ' detail-video--portrait' : ''}"><video controls preload="none" playsinline poster="${v.poster || ''}" aria-label="${esc(v.alt)}"><source src="${v.src}" type="video/mp4">Your browser can’t play this video.</video><figcaption>${esc(v.alt)}${v.href ? ` <a href="${v.href}" target="_blank" rel="noopener">Watch on ${esc(v.source || 'source')} ↗</a>` : ''}</figcaption></figure>`).join('')}</div>` : '';
  const links = [
    ...p.links.map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${esc(l.label)}</a>`),
    p.google ? `<a class="google" href="${p.google}" target="_blank" rel="noopener">More images on Google ↗</a>` : '',
  ].join('');
  detail.innerHTML = `${media}<div class="detail-body">
    <div class="detail-label">${esc(c.name.toUpperCase())} / ${esc(p.tag)}</div>
    <h2 id="detail-title">${esc(p.title)}</h2>
    <p class="hook">${esc(p.hook)}</p>
    ${strip}
    ${videos}
    <h3>My contribution</h3><p>${esc(p.contribution)}</p>
    <h3>The design challenge</h3><p>${esc(p.challenge)}</p>
    <h3>Project outcome / status</h3><p>${esc(p.outcome)}</p>
    <div class="detail-links">${links}</div>
  </div>`;
  const open = (k) => openGallery(p.images, k, { title: p.title, google: p.google });
  $('.detail-hero', detail)?.addEventListener('click', () => open(0));
  $$('.detail-strip button', detail).forEach((b) => b.addEventListener('click', () => open(Number(b.dataset.k))));
  dialog.showModal();
  dialog.scrollTop = 0;
}

function setupDialog() {
  $('.close', dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { $$('video', dialog).forEach((v) => v.pause()); lastOpener?.focus(); });
}

/* ------------------------------------------------------------------ tilt (pointer-driven, user-triggered motion) */
function attachTilt(cards) {
  if (reducedMotion || !matchMedia('(hover:hover)').matches) return;
  cards.forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      card.style.setProperty('--ry', `${x * 8}deg`); card.style.setProperty('--rx', `${-y * 8}deg`);
    });
    card.addEventListener('pointerleave', () => { card.style.setProperty('--ry', '0deg'); card.style.setProperty('--rx', '0deg'); });
  });
}

/* ------------------------------------------------------------------ City Crafters spotlight */
const cityCompany = companies.find((c) => c.id === 'city-crafters');
let cityScene = null;
let cityIndex = -1;
let citySwitchTimer = 0;

function renderCityCrafters() {
  const cc = citycrafters;
  $('#city-eyebrow').textContent = cc.eyebrow;
  $('#city-title').innerHTML = `${esc(cc.headline[0])} <span>${esc(cc.headline[1])}</span>`;
  $('#city-intro').textContent = cc.intro;
  $('#city-stats').innerHTML = cc.stats.map((s) => `<div><dt>${esc(s.value)}</dt><dd>${esc(s.label)}</dd></div>`).join('');
  $('#city-roles').innerHTML = cc.roles.map((r) => `<article class="role-card"><h3>${esc(r.title)}</h3><p class="lead">${esc(r.lead)}</p><ul>${r.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></article>`).join('');
  const tabs = $('#city-tabs');
  tabs.innerHTML = cc.showcase.map((s, i) => `<button type="button" role="tab" id="city-tab-${i}" aria-controls="city-feature"><span>${String(i + 1).padStart(2, '0')}</span>${esc(s.label)}</button>`).join('');
  $$('button', tabs).forEach((b, i) => {
    b.addEventListener('click', () => selectShowcase(i));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + cc.showcase.length) % cc.showcase.length;
      selectShowcase(n); tabs.children[n].focus();
    });
  });
  selectShowcase(0, { instant: true });
}

function selectShowcase(i, { instant = false, fromScene = false } = {}) {
  if (i === cityIndex && !instant) return;
  cityIndex = i;
  const cc = citycrafters, s = cc.showcase[i];
  const project = cityCompany.projects.find((p) => p.id === s.project);
  const tabs = $('#city-tabs');
  [...tabs.children].forEach((b, n) => { b.setAttribute('aria-selected', i === n); b.tabIndex = i === n ? 0 : -1; });
  $('#city-feature').setAttribute('aria-labelledby', `city-tab-${i}`);
  if (cityScene) cityScene.focus(i);
  const render = () => {
    const m = s.media;
    const media = m.type === 'video'
      ? `<video ${reducedMotion ? '' : 'autoplay muted loop'} playsinline controls preload="metadata" poster="${m.poster}" aria-label="${esc(m.alt)}"><source src="${m.src}" type="video/mp4"></video>`
      : `<button type="button" aria-label="Open image gallery: ${esc(project.title)}"><img src="${m.src}" alt="${esc(m.alt)}" loading="lazy" decoding="async"></button>`;
    const links = [
      `<button class="primary" type="button" data-open-project>Open the case study <span>↗</span></button>`,
      ...project.links.map((l) => `<a class="ghost" href="${l.href}" target="_blank" rel="noopener">${esc(l.label)}</a>`),
    ].join('');
    $('#city-feature').innerHTML = `<div class="city-feature__media">${media}<span class="city-feature__badge">${String(i + 1).padStart(2, '0')} / ${String(cc.showcase.length).padStart(2, '0')}</span></div>
      <div class="city-feature__copy">
        <div class="eyebrow">${esc(s.kicker)}</div>
        <h3>${esc(project.title)}</h3>
        <p class="hook">${esc(project.hook)}</p>
        <h4>What I did</h4>
        <ul class="did">${s.did.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
        <dl class="numbers">${s.numbers.map((n) => `<div><dt>${esc(n.value)}</dt><dd>${esc(n.label)}</dd></div>`).join('')}</dl>
        <div class="city-feature__links">${links}</div>
      </div>`;
    $('[data-open-project]', $('#city-feature')).addEventListener('click', (e) => openProject(cityCompany, project, e.currentTarget));
    $('.city-feature__media button', $('#city-feature'))?.addEventListener('click', () => openGallery(project.images, Math.max(0, project.images.findIndex((im) => im.src === m.src)), { title: project.title, google: project.google }));
  };
  const feature = $('#city-feature');
  clearTimeout(citySwitchTimer);
  if (instant || reducedMotion) { render(); feature.classList.remove('is-switching'); return; }
  feature.classList.add('is-switching');
  citySwitchTimer = setTimeout(() => { render(); feature.classList.remove('is-switching'); }, 220);
  if (fromScene) $('#city-feature').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function initCityScene() {
  const mod = await load('./cityscene.js');
  try {
    cityScene = mod?.initCityScene?.({ canvas: $('#city-scene'), reducedMotion, onFocus: (i) => selectShowcase(i, { fromScene: true }) }) || null;
  } catch (err) { console.error('[portfolio] city scene failed', err); cityScene = null; }
  if (!cityScene) { $('#city-scene').hidden = true; $('#city-fallback').hidden = false; }
  else if (cityIndex >= 0) cityScene.focus(cityIndex);
  return cityScene;
}

/* ------------------------------------------------------------------ Lala Poker */
function renderPoker() {
  $('#poker-sub').textContent = lalapoker.sub;
  $('#poker-features').innerHTML = lalapoker.features.map((f) => `<li>${esc(f)}</li>`).join('');
  $('#poker-stats').innerHTML = lalapoker.stats.map((s) => `<div><dt>${esc(s.value)}</dt><dd>${esc(s.label)}</dd></div>`).join('');
  $('#poker-links').innerHTML = lalapoker.links.map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('');
  const rail = $('#poker-rail');
  rail.innerHTML = lalapoker.screenshots.map((s, k) => `<button type="button" data-k="${k}" aria-label="Screenshot: ${esc(s.alt)}"><img src="${s.src}" alt="" loading="lazy" decoding="async"><span>${esc(s.alt)}</span></button>`).join('');
  const open = (k) => openGallery(lalapoker.screenshots, k, { title: 'Lala Poker', google: lalapoker.google });
  $$('button', rail).forEach((b) => b.addEventListener('click', () => { if (!rail.dataset.dragged) open(Number(b.dataset.k)); }));
  $('#poker-gallery-btn').addEventListener('click', () => open(0));
  // drag to scroll
  let down = false, startX = 0, startLeft = 0;
  rail.addEventListener('pointerdown', (e) => { down = true; startX = e.clientX; startLeft = rail.scrollLeft; delete rail.dataset.dragged; });
  rail.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - startX; if (Math.abs(dx) > 6) { rail.dataset.dragged = '1'; rail.classList.add('is-dragging'); rail.scrollLeft = startLeft - dx; } });
  const up = () => { down = false; rail.classList.remove('is-dragging'); setTimeout(() => delete rail.dataset.dragged, 50); };
  rail.addEventListener('pointerup', up); rail.addEventListener('pointercancel', up); rail.addEventListener('pointerleave', up);
  rail.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') rail.scrollBy({ left: 300, behavior: 'smooth' }); if (e.key === 'ArrowLeft') rail.scrollBy({ left: -300, behavior: 'smooth' }); });
}

/* ------------------------------------------------------------------ the book */
let flip = null;
function renderBookAside() {
  $('#book-title-ar').textContent = book.titleAr;
  $('#book-subtitle-ar').textContent = book.subtitleAr;
  $('#book-author-ar').textContent = book.authorAr;
  $('#book-badge').lastChild.textContent = book.badge;
  $('#book-blurb').textContent = book.blurb;
  $('#book-open-pdf').href = book.pdf; $('#book-download').href = book.pdf;
  const toc = $('#book-toc');
  toc.innerHTML = book.toc.map(([t, pg]) => `<li data-page="${pg}" tabindex="0" role="button" title="Open page ${pg}"><span>${esc(t)}</span><b>${pg}</b></li>`).join('');
  toc.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) jumpToPage(Number(li.dataset.page)); });
  toc.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const li = e.target.closest('li'); if (li) { e.preventDefault(); jumpToPage(Number(li.dataset.page)); } } });
}
function jumpToPage(printed) {
  // In this PDF the 0-based page index equals the printed folio (index 0 is the cover, index 3 shows "3").
  const idx = Math.min(book.pages - 1, Math.max(0, printed));
  if (flip) { flip.goTo(idx); scrollTo('#flipbook'); }
  else window.open(`${book.pdf}#page=${idx + 1}`, '_blank', 'noopener');
}

/* ------------------------------------------------------------------ ideas / instagram */
function renderIdeas() {
  $('#review-title').innerHTML = `${esc(ideas.review.title[0])}<br>Okay. <em>But how?</em>`;
  $('#review-text').textContent = ideas.review.text;
  $('#ig-handle').textContent = site.instagramHandle; $('#ig-followers').textContent = `${site.instagramFollowers} followers`;
  $('#ig-link').href = site.instagram;
  $('#ig-highlights').innerHTML = ideas.highlights.map((h) => `<figure><img src="${h.src}" alt="" loading="lazy"><figcaption>${esc(h.label)}</figcaption></figure>`).join('');
  $('#reels-grid').innerHTML = ideas.reels.map((r) => `<a class="reel${r.landscape ? ' reel--landscape' : ''}" href="${r.href}" target="_blank" rel="noopener" aria-label="${esc(r.en)} (Instagram)">${r.landscape ? `<img class="reel__bg" src="${r.src}" alt="" aria-hidden="true" loading="lazy">` : ''}<img src="${r.src}" alt="" loading="lazy" decoding="async"><span class="reel__play" aria-hidden="true">▶</span><div class="reel__meta"><b lang="ar" dir="rtl">${esc(r.ar)}</b><small>${esc(r.en)} · ${esc(r.date)}</small></div></a>`).join('');
}

/* ------------------------------------------------------------------ hero scene */
async function initScene() {
  const stage = $('.scene-stage');
  const fallback = $('#scene-fallback'), fbSpots = $('#scene-fallback-hotspots');
  const showFallback = () => {
    $('#scene').hidden = true; fallback.hidden = false; fbSpots.hidden = false;
    fbSpots.innerHTML = hero.hotspots.map((h) => `<button class="hotspot fallback-spot--${h.id}" type="button" data-target="${h.target}"><span class="hotspot__dot">${h.number}</span><b class="hotspot__label">${esc(h.label)} <i>↗</i></b></button>`).join('');
    $$('button', fbSpots).forEach((b) => b.addEventListener('click', () => scrollTo(b.dataset.target)));
  };
  // Small-screen legend: the in-scene labels are hidden there, so the markers get a row of buttons instead.
  const legend = $('#scene-legend');
  legend.innerHTML = hero.hotspots.map((h) => `<button type="button" data-target="${h.target}"><span>${h.number}</span>${esc(h.label)}</button>`).join('');
  $$('button', legend).forEach((b) => b.addEventListener('click', () => scrollTo(b.dataset.target)));
  const mod = await load('./scene.js');
  let controller = null;
  try {
    controller = mod?.initStudioScene?.({ canvas: $('#scene'), labelLayer: $('#scene-labels'), hotspots: hero.hotspots, reducedMotion }) || null;
  } catch (err) { console.error('[portfolio] studio scene failed', err); }
  if (!controller) showFallback();
  else {
    // The scene hides its text labels on narrow canvases (adds `is-compact` to the label layer); mirror that
    // on the wrapper so the legend row appears exactly when the labels disappear.
    const labelLayer = $('#scene-labels'), wrap = $('#studio-canvas');
    const sync = () => wrap.classList.toggle('is-compact', labelLayer.classList.contains('is-compact'));
    new MutationObserver(sync).observe(labelLayer, { attributes: true, attributeFilter: ['class'] });
    sync();
  }
  if (controller && window.gsap && window.ScrollTrigger && !reducedMotion) {
    // The one scroll-driven effect: the studio recedes as you leave the hero.
    gsap.to(stage, { scale: .9, y: 60, opacity: .35, ease: 'none', scrollTrigger: { trigger: '#studio', start: 'bottom 80%', end: 'bottom 10%', scrub: true } });
  }
  return controller;
}

async function initPoker(mod) {
  let controller = null;
  try { controller = mod?.initPokerScene?.({ canvas: $('#poker-scene'), reducedMotion }) || null; } catch (err) { console.error('[portfolio] poker scene failed', err); }
  if (!controller) { $('#poker-scene').hidden = true; $('#poker-fallback').hidden = false; }
  return controller;
}

async function initFlipbook() {
  const mod = await load('./book.js');
  const container = $('#flipbook');
  try {
    flip = mod?.initBook?.({ container, pageCount: book.pages, pageSrc: book.pageSrc, cover: book.cover, back: book.back, pdfUrl: book.pdf, reducedMotion }) || null;
  } catch (err) { console.error('[portfolio] flipbook failed', err); }
  if (!flip) {
    container.innerHTML = `<a class="book-static" href="${book.pdf}" target="_blank" rel="noopener"><img src="${book.cover}" alt="Book cover" style="max-width:360px;margin:auto;border-radius:4px;box-shadow:0 30px 60px -30px #000"></a>`;
  }
}

/* ------------------------------------------------------------------ page motion (GSAP) */
function heroIntro() {
  html.classList.add('hero-ready');
  if (!window.gsap || reducedMotion) return;
  const lines = $$('h1 .line > span');
  gsap.set(lines, { y: '110%' });
  const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
  tl.to(lines, { y: 0, duration: 1.1, stagger: .12 }, .15)
    .from(['.intro .eyebrow', '.intro-sub', '.intro-actions', '.intro-bottom'], { opacity: 0, y: 14, duration: .8, stagger: .08 }, .35)
    .from(['.scene-top', '.scene-bottom'], { opacity: 0, duration: .8 }, .6);
}

function setupReveals() {
  if (!window.gsap || !window.ScrollTrigger || reducedMotion) { $$('.reveal').forEach((el) => el.classList.add('is-in')); return; }
  gsap.registerPlugin(ScrollTrigger);
  $$('.reveal').forEach((el) => ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => el.classList.add('is-in') }));
}

function setupNav() {
  const header = $('.site-header');
  const links = $$('.site-nav a');
  const sections = ['studio', 'work', 'citycrafters', 'lalapoker', 'book', 'ideas'].map((id) => document.getElementById(id));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.dataset.nav === en.target.id)); });
  }, { rootMargin: '-40% 0px -55% 0px' });
  sections.forEach((s) => s && io.observe(s));
  let ticking = false;
  addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { header.classList.toggle('is-compact', scrollY > 80); ticking = false; }); }, { passive: true });
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => { const t = $(a.getAttribute('href')); if (t) { e.preventDefault(); scrollTo(t); history.replaceState(null, '', a.getAttribute('href')); } }));
}

/* ------------------------------------------------------------------ contact: one email, wired everywhere */
function setupContact() {
  const subject = encodeURIComponent('Let’s build something');
  $$('[data-mailto]').forEach((a) => {
    const withSubject = a.getAttribute('href').includes('subject=');
    a.href = `mailto:${site.email}${withSubject ? `?subject=${subject}` : ''}`;
    if (a.hasAttribute('title')) a.title = site.email;
  });
  $$('[data-email-text]').forEach((a) => { a.textContent = site.email; });
  const copy = $('[data-copy-email]');
  if (!copy) return;
  const label = copy.textContent;
  copy.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(site.email); ok = true; }
    catch { // clipboard API unavailable (http, old browser): fall back to a selection copy
      const ta = document.createElement('textarea'); ta.value = site.email; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
    }
    copy.textContent = ok ? 'Copied ✓' : site.email; copy.classList.toggle('is-copied', ok);
    setTimeout(() => { copy.textContent = label; copy.classList.remove('is-copied'); }, 2200);
  });
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  renderToolkit();
  renderCompanies();
  setupDialog();
  renderCityCrafters();
  renderPoker();
  renderBookAside();
  renderIdeas();
  setupNav();
  setupContact();

  const galleryMod = await load('./gallery.js');
  if (galleryMod?.openGallery) openGallery = galleryMod.openGallery;
  else openGallery = (images, k = 0) => window.open(images[k]?.src, '_blank', 'noopener');

  // Wait for GSAP (deferred classic scripts) before choreographing the intro.
  if (!window.gsap && document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
  setupReveals();

  const sceneMod = await load('./scene.js');
  window.__portfolio = { scene: null, poker: null, flip: null };
  const studio = await initScene();
  window.__portfolio.scene = studio;
  heroIntro();
  window.__portfolio.poker = await initPoker(sceneMod);
  window.__portfolio.city = await initCityScene();
  await initFlipbook();
  window.__portfolio.flip = flip;
}

boot().catch((err) => console.error('[portfolio] boot failed', err));
