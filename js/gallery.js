/**
 * gallery.js — image lightbox built on a native <dialog>.
 *
 * @module gallery
 *
 * @example
 *   import { openGallery } from './gallery.js';
 *   openGallery(project.images, 2, { title: project.title, google: project.google });
 *
 * @function openGallery
 * @param {Array<{src: string, alt?: string}>} images   Images to show (at least one). Extra keys are ignored.
 * @param {number} [startIndex=0]                        0-based index to open on (clamped into range).
 * @param {Object} [options]
 * @param {string} [options.title='']                    Optional title rendered above the caption (also names the dialog).
 * @param {string} [options.google='']                   Optional URL; renders "More images on Google ↗" (target _blank, rel noopener).
 * @returns {void}
 *
 * Behaviour
 * - Builds ONE <dialog id="lightbox" class="lightbox"> on first use (appended to <body>) and injects ONE scoped
 *   <style id="lightbox-style"> into <head>; every later call re-uses both.
 * - Layout: dark blurred overlay (blur 10px, rgba(8,11,9,.85)); the picture centred at up to 86vh × 92vw;
 *   a caption bar with optional title, the alt text, an "i / n" counter and the optional Google link; round
 *   44px prev/next buttons (hidden for a single image); a close button top-right; a 64px thumbnail strip
 *   (scrollable, current thumb outlined in accent; wraps under 560px; hidden for a single image).
 * - Motion: open = fade + scale .96→1 over 250ms; nav = 200ms crossfade while the frame morphs between aspect
 *   ratios; close = 180ms fade. Everything collapses to instant when prefers-reduced-motion is set.
 * - Input: ← / → step, Home / End jump, Esc closes, click on the backdrop closes, swipe or drag on the stage
 *   steps (a drag never closes), thumbnail click jumps.
 * - Loading: the requested image is fetched first (fetchpriority high); the thumbnail strip and the two
 *   neighbours are only requested once it has landed (thumbs are lazy + fetchpriority low), so a slow
 *   connection spends its bandwidth on the picture the visitor asked for. Every image load can be cancelled,
 *   so rapid navigation never leaves a slot half-loaded or a promise dangling.
 * - Accessibility: focus is trapped inside the dialog (roving tabindex on thumbs, Tab wraps) and restored to the
 *   opener on close; changes are announced through a polite live region; page scroll is locked while open
 *   without layout shift (scrollbar-gutter: stable, padding fallback for older engines).
 * - A failed image shows an "Image unavailable" panel instead of a broken-image icon.
 *
 * @function closeGallery   Closes the lightbox if it is open (animated). Safe to call at any time.
 * @function destroyGallery Closes, removes the dialog and its <style>, and drops every listener.
 *
 * No dependencies (no GSAP, no Three). Plain ES module — no build step.
 */

const ID = 'lightbox';
const STYLE_ID = 'lightbox-style';
const OPEN_MS = 250;
const CLOSE_MS = 180;
const FADE_MS = 200;
const SPINNER_DELAY_MS = 150;
const SWIPE_PX = 44;
const THUMBS_FALLBACK_MS = 1200;   // hydrate the thumb strip anyway if the first image is this slow
const EASE = 'cubic-bezier(.2, .7, .2, 1)';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wrap = (i, n) => ((i % n) + n) % n;

/* ---------------------------------------------------------------- markup */

const ICON_CHEV = (dir) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${dir < 0 ? 'M14.5 5.5 8 12l6.5 6.5' : 'M9.5 5.5 16 12l-6.5 6.5'}"/></svg>`;
const ICON_X = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ICON_BROKEN = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15.5l4.5-4.5 4 4 3-3 6.5 6.5"/><circle cx="16" cy="9.5" r="1.3"/></svg>`;

const MARKUP = `
<div class="lightbox__frame" tabindex="-1">
  <button type="button" class="lightbox__close" aria-label="Close gallery">${ICON_X}</button>
  <div class="lightbox__body">
  <div class="lightbox__stage">
    <div class="lightbox__pic">
      <img class="lightbox__img" alt="" draggable="false" decoding="async" fetchpriority="high" aria-hidden="true">
      <img class="lightbox__img" alt="" draggable="false" decoding="async" fetchpriority="high" aria-hidden="true">
      <div class="lightbox__spin" aria-hidden="true"></div>
      <div class="lightbox__error" role="status" hidden>${ICON_BROKEN}<span class="lightbox__error-title">Image unavailable</span><span class="lightbox__error-sub">The file could not be loaded</span></div>
    </div>
    <button type="button" class="lightbox__nav lightbox__nav--prev" aria-label="Previous image">${ICON_CHEV(-1)}</button>
    <button type="button" class="lightbox__nav lightbox__nav--next" aria-label="Next image">${ICON_CHEV(1)}</button>
  </div>
  <div class="lightbox__caption">
    <div class="lightbox__text">
      <p class="lightbox__title" hidden></p>
      <p class="lightbox__alt"></p>
    </div>
    <div class="lightbox__meta">
      <span class="lightbox__counter" aria-hidden="true"></span>
      <a class="lightbox__google" target="_blank" rel="noopener noreferrer" hidden>More images on Google&nbsp;↗</a>
    </div>
  </div>
  </div>
  <div class="lightbox__thumbs" role="group" aria-label="Thumbnails"></div>
  <span class="lightbox__sr" aria-live="polite" aria-atomic="true"></span>
</div>`;

/* ---------------------------------------------------------------- styles (scoped to .lightbox) */
/* (Named STYLE_TEXT on purpose: a module-scope `CSS` would shadow window.CSS, which lockScroll() needs.) */

const STYLE_TEXT = `
.lightbox {
  --lb-accent: var(--accent, #f3a65a);
  --lb-ink: var(--ink, #f2f1ec);
  --lb-muted: var(--muted, #a0a29e);
  --lb-line: var(--line, #353636);
  --lb-panel: var(--panel, #1c1d1d);
  --lb-display: 'Space Grotesk', 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --lb-body: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --lb-w: 480px;
  --lb-h: 360px;
  position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none;
  margin: 0; padding: 0; border: 0; box-sizing: border-box; overflow: hidden;
  background: rgba(8, 11, 9, .85);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  color: var(--lb-ink); font-family: var(--lb-body); font-size: 14px; line-height: 1.45;
  -webkit-font-smoothing: antialiased; overscroll-behavior: contain; z-index: 9999;
}
.lightbox::backdrop { background: transparent; }
.lightbox [hidden] { display: none !important; }
.lightbox * { box-sizing: border-box; }
.lightbox__frame {
  position: absolute; inset: 0; outline: none;
  display: grid; grid-template-rows: minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr);
  padding: 72px 24px max(20px, env(safe-area-inset-bottom));
}
.lightbox__body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; min-width: 0; }
.lightbox__sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* buttons */
.lightbox__close, .lightbox__nav {
  -webkit-appearance: none; appearance: none; width: 44px; height: 44px; padding: 0; margin: 0;
  display: grid; place-items: center; border-radius: 50%; cursor: pointer;
  color: var(--lb-ink); background: rgba(28, 29, 29, .82); border: 1px solid rgba(255, 255, 255, .14);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .3); line-height: 0;
  transition: background-color .16s ease, color .16s ease, border-color .16s ease, transform .16s ease;
}
.lightbox__close:hover, .lightbox__nav:hover { background: var(--lb-accent); border-color: var(--lb-accent); color: #151616; }
.lightbox__close:active, .lightbox__nav:active { transform: scale(.94); }
.lightbox__close:focus-visible, .lightbox__nav:focus-visible, .lightbox__google:focus-visible { outline: 2px solid var(--lb-accent); outline-offset: 3px; }
.lightbox__close { position: absolute; top: 16px; right: 24px; z-index: 3; }
.lightbox__nav { position: absolute; top: 50%; margin-top: -22px; z-index: 2; }
.lightbox__nav--prev { left: 0; }
.lightbox__nav--next { right: 0; }

/* stage + picture */
.lightbox__stage {
  position: relative; display: flex; align-items: center; justify-content: center;
  flex: 0 1 auto; min-height: 0; width: 100%; padding: 0 64px; touch-action: none;
}
.lightbox__pic {
  position: relative; width: var(--lb-w); height: var(--lb-h); max-width: 100%;
  border-radius: 4px; overflow: hidden; flex: none;
  transition: width .2s ease, height .2s ease, box-shadow .3s ease;
}
.lightbox__pic.is-ready { box-shadow: 0 0 0 1px rgba(255, 255, 255, .06), 0 28px 70px rgba(0, 0, 0, .5); }
.lightbox__img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block;
  opacity: 0; transition: opacity ${FADE_MS}ms ease; pointer-events: none;
  user-select: none; -webkit-user-select: none; -webkit-user-drag: none;
}
.lightbox__img.is-on { opacity: 1; z-index: 2; }
.lightbox__img.is-off { opacity: 1; z-index: 1; transition: none; }
.lightbox__img.is-reset { transition: none !important; }
.lightbox__spin {
  position: absolute; left: 50%; top: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px;
  border-radius: 50%; border: 2px solid rgba(255, 255, 255, .12); border-top-color: var(--lb-accent); z-index: 3;
  opacity: 0; transition: opacity .15s ease; pointer-events: none;
}
.lightbox__spin.is-on { opacity: 1; animation: lb-spin .8s linear infinite; }
@keyframes lb-spin { to { transform: rotate(360deg); } }
.lightbox__error {
  position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: var(--lb-panel); border: 1px solid var(--lb-line); border-radius: 4px; color: var(--lb-muted); text-align: center; padding: 16px;
}
.lightbox__error svg { color: var(--lb-accent); opacity: .9; margin-bottom: 4px; }
.lightbox__error-title { font: 500 12px/1 var(--lb-display); letter-spacing: .16em; text-transform: uppercase; color: var(--lb-ink); }
.lightbox__error-sub { font: 400 13px/1.3 var(--lb-body); color: var(--lb-muted); }

/* caption */
.lightbox__caption {
  flex: none; width: clamp(280px, var(--lb-w), 100%); min-height: 58px;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 28px;
  padding: 14px 0 0; transition: width .2s ease;
}
.lightbox__text { flex: 1 1 auto; min-width: 0; }
.lightbox__title { margin: 0 0 3px; font: 500 15px/1.3 var(--lb-display); color: var(--lb-ink); letter-spacing: .005em; }
.lightbox__alt { margin: 0; font: 400 14px/1.45 var(--lb-body); color: var(--lb-muted); }
.lightbox__meta { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 7px; padding-top: 3px; }
.lightbox__counter { font: 500 12px/1 var(--lb-display); letter-spacing: .16em; color: var(--lb-accent); font-variant-numeric: tabular-nums; white-space: nowrap; }
.lightbox__google {
  font: 400 13px/1.2 var(--lb-body); color: var(--lb-muted); white-space: nowrap; border-radius: 2px;
  text-decoration: underline; text-decoration-color: rgba(255, 255, 255, .2); text-underline-offset: 3px;
  transition: color .16s ease, text-decoration-color .16s ease;
}
.lightbox__google:hover { color: var(--lb-ink); text-decoration-color: var(--lb-accent); }

/* thumbnails */
.lightbox__thumbs {
  position: relative; justify-self: center; max-width: 100%; margin-top: 14px; padding: 4px;
  display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden; touch-action: pan-x;
  scrollbar-width: thin; scrollbar-color: var(--lb-line) transparent; overscroll-behavior-x: contain;
}
.lightbox__thumbs::-webkit-scrollbar { height: 6px; }
.lightbox__thumbs::-webkit-scrollbar-thumb { background: var(--lb-line); border-radius: 3px; }
.lightbox__thumbs::-webkit-scrollbar-track { background: transparent; }
.lightbox__thumb {
  -webkit-appearance: none; appearance: none; flex: 0 0 auto; width: 86px; height: 64px; padding: 0; margin: 0;
  border: 0; border-radius: 4px; overflow: hidden; cursor: pointer; background: var(--lb-panel);
  outline: 2px solid transparent; outline-offset: 2px; opacity: .5;
  transition: opacity .16s ease, outline-color .16s ease;
}
.lightbox__thumb img { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.lightbox__thumb:hover { opacity: .85; }
.lightbox__thumb[aria-current="true"] { opacity: 1; outline-color: var(--lb-accent); }
.lightbox__thumb:focus-visible { outline-color: var(--lb-ink); opacity: 1; }
.lightbox__thumb.is-broken img { visibility: hidden; }
.lightbox__thumb.is-broken { background: repeating-linear-gradient(135deg, var(--lb-panel) 0 6px, var(--lb-line) 6px 7px); }

/* narrow screens: nav sits on the picture's bottom corners, thumbs wrap */
@media (max-width: 759px) {
  .lightbox__frame { padding: 64px 16px max(16px, env(safe-area-inset-bottom)); }
  .lightbox__close { top: 12px; right: 16px; width: 40px; height: 40px; }
  .lightbox__stage { padding: 0; }
  .lightbox__nav { top: auto; margin-top: 0; width: 40px; height: 40px; bottom: calc(50% - var(--lb-h) / 2 + 10px); transition: background-color .16s ease, color .16s ease, border-color .16s ease, transform .16s ease, left .2s ease, right .2s ease, bottom .2s ease; }
  .lightbox__nav--prev { left: calc(50% - var(--lb-w) / 2 + 10px); }
  .lightbox__nav--next { right: calc(50% - var(--lb-w) / 2 + 10px); }
  .lightbox__caption { flex-wrap: wrap; gap: 8px 16px; min-height: 0; padding-top: 12px; }
  .lightbox__meta { flex: 1 0 100%; flex-direction: row; align-items: baseline; justify-content: space-between; gap: 14px; padding-top: 2px; }
}
@media (max-width: 559px) {
  .lightbox__thumbs { flex-wrap: wrap; justify-content: center; overflow: visible; max-height: 36vh; margin-top: 12px; }
  .lightbox__thumb { width: 64px; height: 48px; }
}
@media (max-height: 520px) {
  .lightbox__thumbs { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .lightbox, .lightbox * { transition: none !important; animation: none !important; }
}
`;

/* ---------------------------------------------------------------- module state */

let ui = null;      // built once: DOM references + per-instance flags
let state = null;   // per-open state; null when closed
let scrollLock = null;
const inflight = new WeakMap();   // <img> slot → cancel() for the load() currently running on it

/** Cancel the load running on a slot (its promise settles with false) so no listener or promise dangles. */
function cancelLoad(img) {
  const cancel = inflight.get(img);
  if (cancel) cancel();
}

/** Take a slot out of service: cancel its load, hide it instantly, drop its bitmap. */
function clearSlot(img) {
  cancelLoad(img);
  resetSlot(img);
  img.removeAttribute('src');
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
}

function build() {
  if (ui) return ui;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    document.head.appendChild(style);
  }
  const dialog = document.createElement('dialog');
  dialog.id = ID;
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Image gallery');
  dialog.innerHTML = MARKUP;
  (document.body || document.documentElement).appendChild(dialog);

  const $ = (sel) => dialog.querySelector(sel);
  ui = {
    dialog,
    frame: $('.lightbox__frame'),
    body: $('.lightbox__body'),
    stage: $('.lightbox__stage'),
    caption: $('.lightbox__caption'),
    pic: $('.lightbox__pic'),
    imgs: [...dialog.querySelectorAll('.lightbox__img')],
    cur: 0,               // index of the visible slot in ui.imgs
    spin: $('.lightbox__spin'),
    error: $('.lightbox__error'),
    prev: $('.lightbox__nav--prev'),
    next: $('.lightbox__nav--next'),
    close: $('.lightbox__close'),
    title: $('.lightbox__title'),
    alt: $('.lightbox__alt'),
    counter: $('.lightbox__counter'),
    google: $('.lightbox__google'),
    thumbs: $('.lightbox__thumbs'),
    sr: $('.lightbox__sr'),
    closing: false,
    closeAnims: [],
    last: null,           // [naturalW, naturalH, modest] of the picture currently sized
    dropTimer: 0,
    spinTimer: 0,
    refitRaf: 0,
    downOutside: false,
    swipe: null,
  };

  ui.close.addEventListener('click', close);
  ui.prev.addEventListener('click', () => step(-1));
  ui.next.addEventListener('click', () => step(1));
  ui.thumbs.addEventListener('click', (e) => {
    const b = e.target.closest('.lightbox__thumb');
    if (b) go(Number(b.dataset.i));
  });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('close', onClosed);
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('pointerdown', (e) => { ui.downOutside = isOutside(e.target); });
  dialog.addEventListener('click', (e) => {
    const outside = ui.downOutside && isOutside(e.target);
    ui.downOutside = false;
    if (outside) close();
  });
  ui.stage.addEventListener('pointerdown', onSwipeStart);
  ui.stage.addEventListener('pointermove', onSwipeMove);
  ui.stage.addEventListener('pointerup', onSwipeEnd);
  ui.stage.addEventListener('pointercancel', onSwipeEnd);
  return ui;
}

const OUTSIDE_SEL = '.lightbox__pic, .lightbox__caption, .lightbox__thumbs, button, a';
function isOutside(target) {
  return !(target instanceof Element) || !target.closest(OUTSIDE_SEL);
}

/* ---------------------------------------------------------------- public API */

export function openGallery(images, startIndex = 0, { title = '', google = '' } = {}) {
  const list = (Array.isArray(images) ? images : [])
    .filter((im) => im && typeof im.src === 'string' && im.src)
    .map((im) => ({ src: im.src, alt: typeof im.alt === 'string' ? im.alt : '' }));
  if (!list.length) return;

  const u = build();
  if (u.closing) {                              // re-opened mid close: abort the exit animation
    u.closeAnims.forEach((a) => a.cancel());
    u.closeAnims = [];
    u.closing = false;
  }
  const wasOpen = u.dialog.open;
  const opener = wasOpen && state ? state.opener
    : (document.activeElement instanceof HTMLElement && !u.dialog.contains(document.activeElement) ? document.activeElement : null);
  if (state) teardown();
  clearTimeout(u.dropTimer);

  state = { images: list, index: 0, title, google, opener, token: 0, preloaded: new Set(), ro: null, thumbsHydrated: false, thumbTimer: 0 };
  renderChrome();
  u.imgs.forEach(clearSlot);
  u.pic.classList.remove('is-ready');
  u.pic.style.transform = '';
  u.error.hidden = true;
  u.last = null;

  if (!wasOpen) {
    lockScroll();
    if (typeof u.dialog.showModal === 'function') u.dialog.showModal();
    else u.dialog.setAttribute('open', '');
    instant(() => size(4, 3));                   // placeholder box until the first image decodes (no morph on open)
    if (!reduced()) {
      u.dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS, easing: EASE });
      u.frame.animate([{ transform: 'scale(.96)' }, { transform: 'scale(1)' }], { duration: OPEN_MS, easing: EASE });
    }
    u.frame.focus({ preventScroll: true });
  }

  if (typeof ResizeObserver === 'function') {
    state.ro = new ResizeObserver(() => scheduleRefit());
    state.ro.observe(u.body);
    state.ro.observe(u.caption);
  } else {
    window.addEventListener('resize', scheduleRefit);
  }

  // The thumb strip waits for the first picture (bandwidth goes to what was asked for) — but never for long.
  state.thumbTimer = setTimeout(hydrateThumbs, THUMBS_FALLBACK_MS);

  const n = list.length;
  go(Math.min(Math.max(0, Number(startIndex) || 0), n - 1));
}

export function closeGallery() {
  if (ui && ui.dialog.open) close();
}

export function destroyGallery() {
  if (!ui) return;
  const u = ui;
  const s = state;
  u.closeAnims.forEach((a) => a.cancel());
  if (s) teardown();
  state = null;
  clearTimeout(u.dropTimer);
  u.imgs.forEach(cancelLoad);
  unlockScroll();
  if (u.dialog.open) u.dialog.close();           // its async 'close' event is ignored: onClosed checks e.target against the live dialog
  u.dialog.remove();
  document.getElementById(STYLE_ID)?.remove();
  ui = null;
  const opener = s && s.opener;
  if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
}

export default openGallery;

/* ---------------------------------------------------------------- rendering */

function renderChrome() {
  const { images, title, google } = state;
  const n = images.length;
  ui.dialog.setAttribute('aria-label', title ? `${title} — image gallery` : 'Image gallery');
  ui.title.textContent = title;
  ui.title.hidden = !title;
  if (google) { ui.google.href = google; ui.google.hidden = false; }
  else { ui.google.removeAttribute('href'); ui.google.hidden = true; }
  ui.prev.hidden = ui.next.hidden = n < 2;
  ui.thumbs.hidden = n < 2;
  ui.thumbs.replaceChildren(...images.map((im, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lightbox__thumb';
    b.dataset.i = String(i);
    b.tabIndex = -1;
    b.setAttribute('aria-label', `Image ${i + 1} of ${n}${im.alt ? ': ' + im.alt : ''}`);
    const t = document.createElement('img');
    t.dataset.src = im.src;                      // assigned by hydrateThumbs() once the first picture has landed
    t.alt = '';
    t.loading = 'lazy';
    t.decoding = 'async';
    t.setAttribute('fetchpriority', 'low');
    t.draggable = false;
    t.addEventListener('error', () => b.classList.add('is-broken'), { once: true });
    b.append(t);
    return b;
  }));
  ui.thumbs.scrollLeft = 0;
}

/** Give every thumbnail its src (once per open). Called after the first image settles, or by the fallback timer. */
function hydrateThumbs() {
  if (!state || state.thumbsHydrated) return;
  state.thumbsHydrated = true;
  clearTimeout(state.thumbTimer);
  state.thumbTimer = 0;
  for (const t of ui.thumbs.querySelectorAll('img[data-src]')) {
    t.src = t.dataset.src;
    delete t.dataset.src;
  }
}

function paint() {
  const { images, index } = state;
  const n = images.length;
  const im = images[index];
  ui.counter.textContent = `${index + 1} / ${n}`;
  ui.alt.textContent = im.alt;
  ui.alt.hidden = !im.alt;
  ui.sr.textContent = `Image ${index + 1} of ${n}${im.alt ? ': ' + im.alt : ''}`;
  for (let k = 0; k < ui.thumbs.children.length; k++) {
    const b = ui.thumbs.children[k];
    const on = k === index;
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    b.tabIndex = on ? 0 : -1;
  }
  revealThumb(index);
}

function revealThumb(i) {
  const strip = ui.thumbs;
  const t = strip.children[i];
  if (!t || strip.hidden || strip.scrollWidth <= strip.clientWidth) return;
  const left = t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2;
  strip.scrollTo({ left: Math.max(0, left), behavior: reduced() ? 'auto' : 'smooth' });
}

function preload(i) {
  const { images, preloaded } = state;
  if (images.length < 2) return;
  const src = images[wrap(i, images.length)].src;
  if (preloaded.has(src)) return;
  preloaded.add(src);
  const im = new Image();
  im.decoding = 'async';
  im.src = src;
}

/* ---------------------------------------------------------------- navigation */

function step(delta) {
  if (state) go(state.index + delta);
}

async function go(i) {
  const s = state;
  if (!s) return;
  const n = s.images.length;
  s.index = wrap(i, n);
  const token = ++s.token;
  paint();

  clearTimeout(ui.dropTimer);                    // the hidden slot is ours now: swap()'s pending drop must not strip it mid-load
  const slot = ui.imgs[1 - ui.cur];
  if (slot.classList.contains('is-off')) resetSlot(slot);   // was the outgoing layer: start it from transparent again
  const { src, alt } = s.images[s.index];
  slot.alt = '';                                 // set once decoded: Chrome paints alt text + a border while loading
  clearTimeout(ui.spinTimer);
  ui.spinTimer = setTimeout(() => ui.spin.classList.add('is-on'), SPINNER_DELAY_MS);

  const ok = await load(slot, src);
  if (state !== s || token !== s.token) return;   // superseded by a later go() or by close()

  clearTimeout(ui.spinTimer);
  ui.spin.classList.remove('is-on');
  hydrateThumbs();                               // the picture has settled: now let the strip and the neighbours load
  preload(s.index - 1);
  preload(s.index + 1);
  if (ok) {
    slot.alt = alt;
    size(slot.naturalWidth, slot.naturalHeight);
    ui.error.hidden = true;
    ui.pic.classList.add('is-ready');
  } else {
    size(4, 3, true);
    ui.pic.classList.remove('is-ready');
    ui.error.hidden = false;
    if (!reduced()) ui.error.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease' });
  }
  swap(slot);
}

/**
 * Load `src` into a slot and resolve true once it is decoded (false on error). Always settles: the load/error
 * events drive it (decode() alone never settles in Chromium if the src is removed mid-flight), and any load
 * still running on the same slot is cancelled first, so listeners never pile up.
 */
function load(img, src) {
  cancelLoad(img);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (inflight.get(img) === cancel) inflight.delete(img);
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      resolve(ok);
    };
    const cancel = () => finish(false);
    const onError = () => finish(false);
    let decoding = false;
    const onLoad = () => {
      if (settled || decoding) return;
      decoding = true;
      if (typeof img.decode !== 'function') { finish(img.naturalWidth > 0); return; }
      img.decode().then(() => finish(true), () => finish(img.complete && img.naturalWidth > 0));
    };
    inflight.set(img, cancel);
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    img.src = src;
    if (img.complete && img.naturalWidth > 0) onLoad();   // memory-cached or same src: no need to wait for the queued event
  });
}

function swap(incoming) {
  const outgoing = ui.imgs[ui.cur];
  if (outgoing === incoming) return;
  incoming.classList.add('is-on');
  incoming.removeAttribute('aria-hidden');
  outgoing.classList.remove('is-on');
  outgoing.classList.add('is-off');           // stays opaque under the incoming layer: no brightness dip
  outgoing.setAttribute('aria-hidden', 'true');
  ui.cur = 1 - ui.cur;
  clearTimeout(ui.dropTimer);
  ui.dropTimer = setTimeout(() => {              // cancelled by go() if the slot is re-used before the fade ends
    ui.dropTimer = 0;
    if (outgoing.classList.contains('is-on') || inflight.has(outgoing)) return;
    resetSlot(outgoing);
    outgoing.removeAttribute('src');
    outgoing.alt = '';
  }, FADE_MS + 60);
}

/** Return a slot to opacity 0 without playing the fade (forces one reflow while transitions are off). */
function resetSlot(slot) {
  slot.classList.add('is-reset');
  slot.classList.remove('is-off', 'is-on');
  void slot.offsetWidth;
  slot.classList.remove('is-reset');
}

/* ---------------------------------------------------------------- sizing */

function size(nw, nh, modest = false) {
  const cs = getComputedStyle(ui.stage);
  const availW = ui.body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = ui.body.clientHeight - ui.caption.offsetHeight;   // picture + caption centre together
  let maxW = Math.min(availW, window.innerWidth * 0.92);
  let maxH = Math.min(availH, window.innerHeight * 0.86);
  if (modest) { maxW = Math.min(maxW, 520); maxH = Math.min(maxH, 390); }
  const sc = Math.min(maxW / nw, maxH / nh);
  const w = Math.max(1, Math.round(nw * sc));
  const h = Math.max(1, Math.round(nh * sc));
  ui.last = [nw, nh, modest];
  const st = ui.dialog.style;
  if (st.getPropertyValue('--lb-w') !== `${w}px`) st.setProperty('--lb-w', `${w}px`);
  if (st.getPropertyValue('--lb-h') !== `${h}px`) st.setProperty('--lb-h', `${h}px`);
}

/** Run fn with the picture/caption size transitions switched off (one forced reflow), then restore them. */
function instant(fn) {
  const els = [ui.pic, ui.caption];
  els.forEach((el) => { el.style.transition = 'none'; });
  fn();
  void ui.pic.offsetWidth;
  els.forEach((el) => { el.style.transition = ''; });
}

function scheduleRefit() {
  if (!ui || ui.refitRaf) return;
  ui.refitRaf = requestAnimationFrame(() => {
    ui.refitRaf = 0;
    if (state && ui.last && ui.dialog.open) size(...ui.last);
  });
}

/* ---------------------------------------------------------------- input */

function onKey(e) {
  if (!state) return;
  switch (e.key) {
    case 'ArrowLeft': e.preventDefault(); step(-1); break;
    case 'ArrowRight': e.preventDefault(); step(1); break;
    case 'Home': e.preventDefault(); go(0); break;
    case 'End': e.preventDefault(); go(state.images.length - 1); break;
    case 'Tab': trapTab(e); break;
    default: break;
  }
}

function focusables() {
  return [...ui.dialog.querySelectorAll('button, a[href], [tabindex]')].filter((el) =>
    el !== ui.frame && el.tabIndex >= 0 && !el.disabled && !el.closest('[hidden]') && el.getClientRects().length > 0);
}

function trapTab(e) {
  const list = focusables();
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  const inside = ui.dialog.contains(active) && active !== ui.frame;
  if (e.shiftKey) {
    if (!inside || active === first) { e.preventDefault(); last.focus(); }
  } else if (!inside && active !== ui.frame) {
    e.preventDefault(); first.focus();
  } else if (active === last) {
    e.preventDefault(); first.focus();
  }
}

function onSwipeStart(e) {
  if (!state || e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return;
  ui.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, moved: false };
  try { ui.stage.setPointerCapture(e.pointerId); } catch { /* not capturable — swipe still works while inside */ }
}

function onSwipeMove(e) {
  const sw = ui.swipe;
  if (!sw || e.pointerId !== sw.id) return;
  sw.dx = e.clientX - sw.x;
  const dy = e.clientY - sw.y;
  if (!sw.moved && Math.abs(sw.dx) > 6 && Math.abs(sw.dx) > Math.abs(dy)) sw.moved = true;
  if (sw.moved && state.images.length > 1 && !reduced()) ui.pic.style.transform = `translateX(${(sw.dx * 0.35).toFixed(1)}px)`;
}

function onSwipeEnd(e) {
  const sw = ui.swipe;
  if (!sw || e.pointerId !== sw.id) return;
  ui.swipe = null;
  const from = ui.pic.style.transform;
  ui.pic.style.transform = '';
  if (from && !reduced()) ui.pic.animate([{ transform: from }, { transform: 'none' }], { duration: 200, easing: EASE });
  if (sw.moved) ui.downOutside = false;          // a drag is a gesture, not a backdrop click: the trailing mouse 'click' must not close
  if (sw.moved && Math.abs(sw.dx) > SWIPE_PX && state && state.images.length > 1) step(sw.dx < 0 ? 1 : -1);
}

/* ---------------------------------------------------------------- open / close plumbing */

function close() {
  const d = ui.dialog;
  if (!d.open || ui.closing) return;
  ui.closing = true;
  const finish = () => {
    ui.closing = false;
    ui.closeAnims.forEach((a) => a.cancel());   // 'forwards' fill must not leak into the next open
    ui.closeAnims = [];
    if (d.open) d.close();
  };
  if (reduced()) { finish(); return; }
  const a = d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS, easing: 'ease-out', fill: 'forwards' });
  const b = ui.frame.animate([{ transform: 'scale(1)' }, { transform: 'scale(.98)' }], { duration: CLOSE_MS, easing: 'ease-out', fill: 'forwards' });
  ui.closeAnims = [a, b];
  a.finished.then(finish, () => { /* cancelled by a re-open — nothing to do */ });
}

function onClosed(e) {
  // The native 'close' event is queued, so it can arrive after a destroy (stale dialog) or after a
  // synchronous re-open (dialog already open again). Only tear down the dialog it belongs to, and only if
  // it is still closed.
  if (!ui || e.target !== ui.dialog || ui.dialog.open) return;
  const s = state;
  if (s) teardown();
  state = null;
  ui.closing = false;
  ui.closeAnims.forEach((a) => a.cancel());
  ui.closeAnims = [];
  clearTimeout(ui.dropTimer);
  ui.imgs.forEach(clearSlot);
  ui.pic.classList.remove('is-ready');
  ui.pic.style.transform = '';
  ui.spin.classList.remove('is-on');
  ui.error.hidden = true;
  ui.sr.textContent = '';
  unlockScroll();
  const opener = s && s.opener;
  if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
}

function teardown() {
  state.token++;                                 // invalidate any in-flight load
  if (state.ro) state.ro.disconnect();
  clearTimeout(state.thumbTimer);
  window.removeEventListener('resize', scheduleRefit);
  clearTimeout(ui.spinTimer);
  if (ui.refitRaf) { cancelAnimationFrame(ui.refitRaf); ui.refitRaf = 0; }
  ui.swipe = null;
  ui.downOutside = false;
}

/**
 * Lock page scroll without layout shift. Hiding overflow removes a classic scrollbar (Windows, Linux, macOS
 * with "always show"), which would widen the viewport by its width and shift everything, fixed header included.
 * `scrollbar-gutter: stable` keeps that space reserved; older engines fall back to matching padding on <html>.
 */
function lockScroll() {
  if (scrollLock) return;
  const html = document.documentElement;
  const gutter = window.innerWidth - html.clientWidth;
  scrollLock = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter, pad: html.style.paddingRight };
  if (gutter > 0) {
    const css = globalThis.CSS;
    if (css && typeof css.supports === 'function' && css.supports('scrollbar-gutter', 'stable')) html.style.scrollbarGutter = 'stable';
    else html.style.paddingRight = `${gutter}px`;
  }
  html.style.overflow = 'hidden';
}

function unlockScroll() {
  if (!scrollLock) return;
  const html = document.documentElement;
  html.style.overflow = scrollLock.overflow;
  html.style.scrollbarGutter = scrollLock.gutter;
  html.style.paddingRight = scrollLock.pad;
  scrollLock = null;
}
