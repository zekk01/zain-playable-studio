/**
 * @file book.js — CSS-3D right-to-left (Arabic) flipbook. Zero dependencies (no GSAP, no Three).
 *
 * @example
 *   import { initBook } from './book.js';
 *   const fb = initBook({
 *     container: document.querySelector('.flipbook'),   // empty <div class="flipbook">
 *     pageCount: 91,                                    // p00 … p90 (0-based)
 *     pageSrc: (i) => `assets/book/pages/p${String(i).padStart(2, '0')}.jpg`,
 *     cover: 'assets/book/cover.jpg',                   // optional hi-res source for page 0
 *     back: 'assets/book/back.jpg',                     // optional hi-res source for page N-1
 *     pdfUrl: 'assets/book/Game-Design-Booklet.pdf',
 *     reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
 *   });
 *   fb.next(); fb.prev(); fb.goTo(40); fb.destroy();
 *
 * @typedef {Object} FlipbookController
 * @property {() => void}          next     Turn one sheet forward (RTL: the left page swings over to the right).
 * @property {() => void}          prev     Turn one sheet back.
 * @property {(page:number) => void} goTo   Jump to a 0-based page index (sheets in between riffle with a 60 ms stagger).
 * @property {() => void}          destroy  Remove DOM, listeners, timers and (when last instance) the injected <style>.
 *
 * ── RTL mechanics, from first principles ─────────────────────────────────────────────────────────
 * Hold a closed Arabic book: the spine is on the RIGHT, the free edge on the LEFT. Lay it on a table
 * with the spine on the centre line of a two-page spread and the closed front cover occupies the LEFT
 * panel. To open it you lift the cover by its LEFT (free) edge and swing it over to the RIGHT, rotating
 * about the spine. Now the inside of the cover (page 1) faces you on the RIGHT panel and page 2 is
 * exposed on the LEFT panel. Reading continues right → left, and every further turn lifts the LEFT page.
 *
 * Therefore each physical SHEET k (k = 0 … ceil(N/2)-1) is:  front face = page 2k  (seen on the LEFT
 * panel while unturned), back face = page 2k+1 (seen on the RIGHT panel once turned). "next" rotates
 * the top-most unturned sheet 0° → +180° about its RIGHT edge (transform-origin: right center) so it
 * lands on the right-hand stack; "prev" rotates the top-most turned sheet 180° → 0°. In CSS a positive
 * rotateY lifts the element's left edge toward the viewer, which is exactly a page rising off the table.
 *
 * State = c, the number of turned sheets. c = 0 is the closed book (only the cover, on the left panel);
 * the spread at c shows page 2c-1 on the right and page 2c on the left. With an odd page count the last
 * sheet has a blank back, so the end state is c = ceil(N/2)-1 — the back cover (page N-1) is the last
 * page on the left and the reader never lands on a blank page. With an even count the last sheet can
 * turn fully, closing the book from behind with the back cover on the right panel.
 *
 * Counter: page numbers are FOLIOS, i.e. the number printed on the page itself. The cover is unnumbered and
 * page index i carries folio i (p01.jpg is printed "1", p22.jpg "22"); the total stays the PDF's page count N
 * ("page X / N", CONTRACTS.md): closed = "Cover", after one turn = "pages 1–2 / 91", the last spread of a
 * 91-page book = "pages 89–90 / 91"; single-page mode shows "page 22 / 91". The Arabic and English counters
 * are decorative for assistive tech; the aria-live region carries one plain sentence ("pages 39 to 40 of 91").
 * The scrubber value and data-page stay the 0-based index of the LEFT page (the one about to be turned), so
 * goTo(printedFolio) lands on that page. goTo(p) turns ceil(p/2) sheets, so both pages of a spread map to
 * the same state.
 *
 * Riffle (goTo): up to MAX_ANIM sheets fly with a stagger; the rest snap. Sheets in flight keep their depth
 * slot (so the stack they land on sits beneath them) but do not count toward visibility, so the landing
 * stack is never emptied to the table mid-riffle. In-flight sheets also carry their images (low fetch
 * priority) and the riffle waits, at most LEAD_MS, for the first sheet's faces to decode before moving.
 *
 * Keyboard: ← next, → prev while the region is focused or hovered; Home/End only while focused, so a
 * pointer resting on the book never hijacks page scrolling. When Next/Prev becomes disabled while it has
 * focus, focus is parked on the region so the arrow keys keep working. A pointer press focuses the region
 * too (for Home/End) but without the keyboard focus ring.
 *
 * Touch: a swipe follows the paper — swipe RIGHT drags the left page over the spine (= next, like Apple
 * Books / Kindle in RTL), swipe LEFT brings it back (= prev). Taps: left half = next, right half = prev.
 *
 * Mobile (< 760 px): one sheet per page (front = page, back = blank paper). The page peels off to the
 * right, exposing the next page beneath, exactly like riffling a real book one page at a time.
 *
 * Note on CONTRACTS.md "page N-1 is the back cover": only an even page count can close from behind on a
 * true back cover; with an odd count (these assets: 91) page N-1 is the last left-hand page and is labelled
 * as such — the reader never lands on the blank back of the final sheet.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 */

const RATIO = 419.52 / 595.32;      // page width / height
const STYLE_ID = 'flipbook-style';
const SINGLE_BP = 760;              // container narrower than this → single-page mode
const NARROW_BP = 960;              // spread mode below this → two-row controls (nav + links, scrubber beneath)
const MAX_BOOK_W = 1100;            // spread max width
const TURN_MS = 900;                // one sheet turn
const SETTLE_MS = 420;              // stack settle / hover peek
const STAGGER_MS = 60;              // goTo riffle stagger
const MAX_ANIM = 10;                // riffle at most this many sheets on a long jump; the rest snap
const LEAD_MS = 220;                // a riffle waits at most this long for its first sheet's faces to decode
const LOAD_WINDOW = 3;              // sheets around c that carry <img src> (plus anything in flight)
const VIS_WINDOW = 3;               // sheets around c that are rendered at all
const SHEET_Z = 0.4;                // px of depth between stacked sheets (keeps depth sorting honest)
const EDGE_PX = 0.45;               // visual paper-block thickness per stacked sheet
const PEEK_DEG = 5;                 // hover affordance: top sheet lifts by this angle
const WARM_MAX = 16;                // preloaded Image() objects kept alive

let instances = 0;

const CSS = `
.flipbook{--fb-page-w:0px;--fb-page-h:0px;--fb-persp:2400px;--fb-shift:0px;--fb-shadow-sx:1;--fb-edge-l:0px;--fb-edge-r:0px;
  --fb-dur:${TURN_MS}ms;--fb-settle:${SETTLE_MS}ms;--fb-ease:cubic-bezier(.4,0,.2,1);--fb-paper:#f4f1ea;--fb-paper-dim:#e4e0d6;
  position:relative;display:block;overflow-x:clip;outline:none;color:var(--ink,#f2f1ec);
  font-family:'DM Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-tap-highlight-color:transparent}
.flipbook.is-reduced{--fb-dur:0ms;--fb-settle:0ms}
@media (prefers-reduced-motion:reduce){.flipbook{--fb-dur:0ms;--fb-settle:0ms}}
/* reduced motion: the loading placeholder is a still sheen, not a sweeping shimmer */
.flipbook.is-reduced .flipbook__face.is-loading::before{animation:none;transform:none;width:100%;
  background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.28),rgba(255,255,255,0))}
@media (prefers-reduced-motion:reduce){.flipbook .flipbook__face.is-loading::before{animation:none;transform:none;width:100%;
  background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.28),rgba(255,255,255,0))}}
/* while re-laying out, size-dependent chrome snaps; in-flight sheet turns are left alone */
.flipbook.is-resizing .flipbook__book,.flipbook.is-resizing .flipbook__shadow,.flipbook.is-resizing .flipbook__edge,
.flipbook.is-resizing .flipbook__face::after{transition:none!important}
.flipbook__sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ── stage ── */
.flipbook__stage{position:relative;height:calc(var(--fb-page-h) + 76px);perspective:var(--fb-persp);perspective-origin:50% 38%;
  touch-action:pan-y;user-select:none;-webkit-user-select:none;border-radius:12px}
/* keyboard focus ring only: a pointer press focuses the region (for Home/End) without painting it, and the next
   key press paints it again — gated by a class rather than :focus-visible, which browsers do not re-evaluate on keydown */
.flipbook:focus:not(.is-mouse-focus) .flipbook__stage{outline:2px solid rgba(243,166,90,.55);outline-offset:-3px}
.flipbook__glow{position:absolute;inset:-8% -4%;pointer-events:none;
  background:radial-gradient(55% 50% at 50% 46%,rgba(243,166,90,.075),rgba(243,166,90,0) 72%)}
.flipbook__shadow{position:absolute;left:50%;top:calc(var(--fb-page-h) * .5 + 14px);width:calc(var(--fb-page-w) * 2 + 56px);height:calc(var(--fb-page-h) * .62);
  margin-left:calc(var(--fb-page-w) * -1 - 28px);border-radius:50%;pointer-events:none;opacity:.85;
  background:radial-gradient(closest-side,rgba(0,0,0,.62),rgba(0,0,0,.3) 52%,rgba(0,0,0,0));filter:blur(22px);
  transform:translate3d(var(--fb-shift),0,0) scaleX(var(--fb-shadow-sx));transition:transform var(--fb-dur) var(--fb-ease)}
.flipbook--single .flipbook__shadow{width:calc(var(--fb-page-w) + 56px);margin-left:calc(var(--fb-page-w) * -.5 - 28px)}

/* ── book (3D context) ── */
.flipbook__book{position:absolute;top:14px;left:50%;width:calc(var(--fb-page-w) * 2);height:var(--fb-page-h);margin-left:calc(var(--fb-page-w) * -1);
  transform-style:preserve-3d;transform:translate3d(var(--fb-shift),0,0) rotateX(8deg);transition:transform var(--fb-dur) var(--fb-ease);cursor:pointer}
.flipbook__book.is-inert{cursor:default}   /* the hovered half has nothing left to turn */
.flipbook--single .flipbook__book{width:var(--fb-page-w);margin-left:calc(var(--fb-page-w) * -.5);transform:none}

/* paper block (the stacked page edges that are not rendered as real sheets) */
.flipbook__edge{position:absolute;top:1px;bottom:1px;width:0;pointer-events:none;transform:translateZ(-4px);
  background:linear-gradient(to bottom,rgba(0,0,0,.10),rgba(0,0,0,0) 22%,rgba(0,0,0,0) 78%,rgba(0,0,0,.14)),
             repeating-linear-gradient(90deg,#efebe2 0,#efebe2 1px,#cfc9bc 1px,#cfc9bc 2px);
  transition:width var(--fb-dur) var(--fb-ease)}
.flipbook__edge--left{right:100%;width:var(--fb-edge-l);border-radius:2px 0 0 2px}
.flipbook__edge--right{left:100%;width:var(--fb-edge-r);border-radius:0 2px 2px 0}
.flipbook--single .flipbook__edge--right{display:none}

/* ── sheets ── */
.flipbook__sheet{position:absolute;left:0;top:0;width:var(--fb-page-w);height:var(--fb-page-h);transform-origin:100% 50%;
  transform-style:preserve-3d;transition:transform var(--fb-settle) var(--fb-ease);will-change:transform}
.flipbook__sheet.is-turning{transition-duration:var(--fb-dur)}
.flipbook__sheet.is-hidden{visibility:hidden}
.flipbook__face{position:absolute;inset:0;overflow:hidden;background:var(--fb-paper);
  backface-visibility:hidden;-webkit-backface-visibility:hidden}
.flipbook__face--front{transform:rotateY(0deg);border-radius:3px 0 0 3px}
.flipbook__face--back{transform:rotateY(180deg);border-radius:0 3px 3px 0}
.flipbook__face img{position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:cover;opacity:0;
  transition:opacity 260ms ease;pointer-events:none;-webkit-user-drag:none}
.flipbook__face.is-loaded img{opacity:1}
.flipbook__face.is-loading{background:var(--fb-paper-dim)}
.flipbook__face.is-loading::before{content:'';position:absolute;top:0;bottom:0;left:0;width:55%;
  background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.6),rgba(255,255,255,0));
  transform:translateX(-100%);animation:fb-shimmer 1.5s ease-in-out infinite}
@keyframes fb-shimmer{to{transform:translateX(285%)}}

/* binding gutter on inner pages while the book is open */
.flipbook__face::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity var(--fb-dur) var(--fb-ease)}
.flipbook__face--front::after{background:linear-gradient(to left,rgba(0,0,0,.18),rgba(0,0,0,.05) 4%,rgba(0,0,0,0) 10%)}
.flipbook__face--back::after{background:linear-gradient(to right,rgba(0,0,0,.18),rgba(0,0,0,.05) 4%,rgba(0,0,0,0) 10%)}
.flipbook.is-open .flipbook__face:not(.is-cover)::after{opacity:1}

/* turn shading: crease on the moving sheet, cast shadow on the pages it reveals / lands on */
.flipbook__shade{position:absolute;inset:0;pointer-events:none;opacity:0}
.flipbook__face--front .flipbook__shade{background:linear-gradient(to left,rgba(0,0,0,.42),rgba(0,0,0,.14) 22%,rgba(0,0,0,0) 48%,rgba(255,255,255,.10) 80%,rgba(255,255,255,0))}
.flipbook__face--back .flipbook__shade{background:linear-gradient(to right,rgba(0,0,0,.42),rgba(0,0,0,.14) 22%,rgba(0,0,0,0) 48%,rgba(255,255,255,.10) 80%,rgba(255,255,255,0))}
.flipbook__sheet.is-under-out .flipbook__face--front .flipbook__shade,
.flipbook__sheet.is-under-in .flipbook__face--front .flipbook__shade{background:linear-gradient(to left,rgba(0,0,0,.38),rgba(0,0,0,.12) 30%,rgba(0,0,0,0) 62%)}
.flipbook__sheet.is-under-out .flipbook__face--back .flipbook__shade,
.flipbook__sheet.is-under-in .flipbook__face--back .flipbook__shade{background:linear-gradient(to right,rgba(0,0,0,.38),rgba(0,0,0,.12) 30%,rgba(0,0,0,0) 62%)}
.flipbook__sheet.is-turning .flipbook__shade{animation:fb-shade var(--fb-dur) var(--fb-ease) both}
.flipbook__sheet.is-under-out .flipbook__shade{animation:fb-cast-out var(--fb-dur) var(--fb-ease) both}
.flipbook__sheet.is-under-in .flipbook__shade{animation:fb-cast-in var(--fb-dur) var(--fb-ease) both}
@keyframes fb-shade{0%{opacity:0}40%{opacity:1}60%{opacity:1}100%{opacity:0}}
@keyframes fb-cast-out{0%{opacity:.9}60%{opacity:0}100%{opacity:0}}
@keyframes fb-cast-in{0%{opacity:0}45%{opacity:0}90%{opacity:.85}100%{opacity:.85}}

/* single-page mode: a turned sheet lands outside the page, where only a sliver of its blank back would remain
   visible inside the container until it is hidden — fade that back face out over the tail of the turn (and in on the way back) */
.flipbook--single .flipbook__sheet.is-turning.is-fwd .flipbook__face--back{animation:fb-back-out var(--fb-dur) var(--fb-ease) both}
.flipbook--single .flipbook__sheet.is-turning.is-bwd .flipbook__face--back{animation:fb-back-in var(--fb-dur) var(--fb-ease) both}
@keyframes fb-back-out{0%,60%{opacity:1}100%{opacity:0}}
@keyframes fb-back-in{0%{opacity:0}18%,100%{opacity:1}}

/* ── controls ── */
.flipbook__controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;margin-top:6px;padding:12px 14px;
  background:var(--panel,#1c1d1d);border:1px solid var(--line,#353636);border-radius:14px}
.flipbook__nav{display:flex;align-items:center;gap:10px}
.flipbook__btn,.flipbook__link{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 15px;
  border-radius:999px;border:1px solid var(--line,#353636);background:transparent;color:var(--ink,#f2f1ec);text-decoration:none;
  font:500 13px/1 'DM Sans',ui-sans-serif,system-ui,sans-serif;letter-spacing:.01em;cursor:pointer;white-space:nowrap;
  transition:border-color .2s ease,color .2s ease,background-color .2s ease,transform .2s ease}
.flipbook__btn:hover,.flipbook__link:hover{border-color:var(--accent,#f3a65a);color:var(--accent,#f3a65a)}
.flipbook__btn:active{transform:scale(.97)}
.flipbook__btn:focus-visible,.flipbook__link:focus-visible,.flipbook__range:focus-visible{outline:2px solid var(--accent,#f3a65a);outline-offset:2px}
.flipbook__btn[disabled]{opacity:.32;cursor:default;pointer-events:none}
.flipbook__btn b{font-weight:500;font-size:15px;line-height:1;transform:translateY(-.5px)}
.flipbook__counter{display:flex;flex-direction:column;align-items:center;min-width:118px;line-height:1.15;text-align:center}
.flipbook__counter-ar{font:600 15px/1.2 system-ui,-apple-system,'Segoe UI',Tahoma,'Noto Sans Arabic','DM Sans',sans-serif;font-variant-numeric:tabular-nums;color:var(--ink,#f2f1ec)}
.flipbook__counter-en{margin-top:3px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted,#a0a29e);font-variant-numeric:tabular-nums}
.flipbook__hint{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#a0a29e);opacity:.8;white-space:nowrap}
.flipbook__scrub{flex:1 1 200px;display:flex;align-items:center;min-width:150px}
.flipbook__range{-webkit-appearance:none;appearance:none;width:100%;height:24px;margin:0;background:transparent;cursor:pointer;border-radius:4px}
.flipbook__range::-webkit-slider-runnable-track{height:2px;border-radius:2px;background:var(--line,#353636)}
.flipbook__range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-6px;border-radius:50%;background:var(--accent,#f3a65a);
  border:2px solid var(--panel,#1c1d1d);box-shadow:0 0 0 1px var(--accent,#f3a65a);transition:transform .15s ease}
.flipbook__range:hover::-webkit-slider-thumb{transform:scale(1.15)}
.flipbook__range::-moz-range-track{height:2px;border-radius:2px;background:var(--line,#353636)}
.flipbook__range::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:var(--accent,#f3a65a);border:2px solid var(--panel,#1c1d1d);box-shadow:0 0 0 1px var(--accent,#f3a65a)}
.flipbook__links{display:flex;gap:8px;margin-left:auto}
.flipbook__link--primary{border-color:var(--accent,#f3a65a);color:var(--accent,#f3a65a)}
.flipbook__link--primary:hover{background:var(--accent,#f3a65a);color:var(--bg,#151616)}
/* chrome layout follows the container, not the viewport: spread containers too narrow for one row keep
   nav + links together on the first row with the scrubber beneath; single mode stacks all three */
.flipbook--narrow .flipbook__hint{display:none}
.flipbook--narrow .flipbook__scrub{order:3;flex-basis:100%}
.flipbook--single .flipbook__controls{gap:10px 12px;padding:12px}
.flipbook--single .flipbook__nav{width:100%;justify-content:space-between}
.flipbook--single .flipbook__hint{display:none}
.flipbook--single .flipbook__scrub{order:2;flex-basis:100%}
.flipbook--single .flipbook__links{order:3;margin-left:0;width:100%}
.flipbook--single .flipbook__link{flex:1}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const el = (tag, className, attrs) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
  return node;
};

/**
 * Build a right-to-left CSS-3D flipbook inside `container`.
 * @param {{container:HTMLElement, pageCount:number, pageSrc:(i:number)=>string, cover?:string, back?:string, pdfUrl?:string, reducedMotion?:boolean}} opts
 * @returns {FlipbookController}
 */
export function initBook({ container, pageCount, pageSrc, cover, back, pdfUrl, reducedMotion = false }) {
  if (!container || !(container instanceof HTMLElement)) throw new TypeError('initBook: container must be an element');
  const N = Math.max(1, pageCount | 0);
  if (typeof pageSrc !== 'function') throw new TypeError('initBook: pageSrc must be a function');
  const reduced = !!reducedMotion;

  injectStyle();
  instances++;

  /* ── faces: one per page. `cover`/`back` are optional hi-res sources for the two cover pages. ── */
  // Only an even page count lets the last page close the book from behind as a true back cover;
  // with an odd count it is the final left-hand page and is treated like any inner page.
  const hasBackCover = N > 1 && N % 2 === 0;
  const T = N;   // counter total = the PDF's page count ("page X / N" per CONTRACTS.md); page numbers are folios (index i = folio i)
  const faces = [];
  for (let i = 0; i < N; i++) {
    const isBack = hasBackCover && i === N - 1;
    faces.push({
      src: (i === 0 && cover) ? cover : (i === N - 1 && back) ? back : pageSrc(i),
      page: i,
      alt: i === 0 ? 'Front cover' : isBack ? 'Back cover' : `Page ${i} of ${T}`,
      cover: i === 0 || isBack,
    });
  }
  const BLANK = { src: null, page: null, alt: '', cover: false };

  /* ── DOM ── */
  const root = container;
  root.classList.add('flipbook');
  if (reduced) root.classList.add('is-reduced');
  const hadTabIndex = root.hasAttribute('tabindex');
  if (!hadTabIndex) root.tabIndex = 0;
  const hadRole = root.hasAttribute('role');
  if (!hadRole) root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'flipbook');
  const hadLabel = root.hasAttribute('aria-label');
  if (!hadLabel) root.setAttribute('aria-label', 'Book preview, reads right to left');
  const uid = `fb${Math.random().toString(36).slice(2, 8)}`;

  const hint = el('p', 'flipbook__sr', { id: `${uid}-hint` });
  hint.textContent = 'Use the left and right arrow keys to turn pages. Home and End jump to the first and last page.';
  root.setAttribute('aria-describedby', hint.id);

  const stage = el('div', 'flipbook__stage', { 'aria-hidden': 'true' });
  const glow = el('div', 'flipbook__glow');
  const shadow = el('div', 'flipbook__shadow');
  const bookEl = el('div', 'flipbook__book');
  const edgeL = el('div', 'flipbook__edge flipbook__edge--left');
  const edgeR = el('div', 'flipbook__edge flipbook__edge--right');
  bookEl.append(edgeL, edgeR);
  stage.append(glow, shadow, bookEl);

  const controls = el('div', 'flipbook__controls', { dir: 'ltr' });   // layout stays fixed even inside an RTL section
  const nav = el('div', 'flipbook__nav');
  const btnNext = el('button', 'flipbook__btn flipbook__btn--next', { type: 'button', 'aria-label': 'Next page (turns left, Arabic reads right to left)', title: 'Next page  ←' });
  btnNext.innerHTML = '<b aria-hidden="true">←</b><span>Next</span>';
  const btnPrev = el('button', 'flipbook__btn flipbook__btn--prev', { type: 'button', 'aria-label': 'Previous page', title: 'Previous page  →' });
  btnPrev.innerHTML = '<span>Prev</span><b aria-hidden="true">→</b>';
  // The two visible counters are decorative for assistive tech; the live region announces one plain sentence.
  const counter = el('div', 'flipbook__counter', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  const counterAr = el('span', 'flipbook__counter-ar', { lang: 'ar', dir: 'rtl', 'aria-hidden': 'true' });
  const counterEn = el('span', 'flipbook__counter-en', { 'aria-hidden': 'true' });
  const counterSr = el('span', 'flipbook__sr');
  counter.append(counterAr, counterEn, counterSr);
  nav.append(btnNext, counter, btnPrev);

  const hintVisible = el('span', 'flipbook__hint', { 'aria-hidden': 'true' });
  hintVisible.textContent = 'Reads right → left';

  const scrub = el('label', 'flipbook__scrub');
  const scrubLabel = el('span', 'flipbook__sr');
  scrubLabel.textContent = 'Scrub through pages';
  const range = el('input', 'flipbook__range', { type: 'range', min: '0', max: String(N - 1), step: '1', value: '0', dir: 'rtl' });
  scrub.append(scrubLabel, range);

  const links = el('div', 'flipbook__links');
  if (pdfUrl) {
    const open = el('a', 'flipbook__link flipbook__link--primary', { href: pdfUrl, target: '_blank', rel: 'noopener' });
    open.textContent = 'Open full PDF ↗';
    const dl = el('a', 'flipbook__link', { href: pdfUrl, download: '' });
    dl.textContent = 'Download ↓';
    links.append(open, dl);
  }
  controls.append(nav, hintVisible, scrub, links);
  root.append(hint, stage, controls);

  /* ── state ── */
  const st = {
    mode: null,          // 'spread' | 'single'
    c: 0,                // number of turned sheets (target / logical state)
    cMax: 0,
    sheets: [],
    pageW: 0,
    pageH: 0,
    hoverSide: '',       // '' | 'left' | 'right'  (mouse only, spread only)
    hovered: false,
    busy: false,         // any sheet in flight or scheduled
    destroyed: false,
  };
  const pending = new Map();     // sheet → timeout id (scheduled riffle flips; 0 while the riffle lead runs)
  const casts = new Set();       // sheets carrying an is-under-* class
  const warm = new Map();        // preloaded Image() objects
  const timers = new Set();

  /* ── sheet construction ── */
  function makeFace(side, face) {
    const node = el('div', `flipbook__face flipbook__face--${side}`);
    if (face.cover) node.classList.add('is-cover');
    let img = null;
    if (face.src) {
      img = el('img', '', { alt: face.alt, 'data-src': face.src, decoding: 'async', draggable: 'false' });
      img.addEventListener('load', () => { if (img.getAttribute('src')) { node.classList.add('is-loaded'); node.classList.remove('is-loading'); } });
      img.addEventListener('error', () => { if (img.getAttribute('src')) node.classList.remove('is-loading'); });
      node.appendChild(img);
    } else {
      node.classList.add('is-blank', 'is-loaded');
    }
    node.appendChild(el('i', 'flipbook__shade'));
    return { el: node, img, src: face.src, page: face.page };
  }

  function makeSheet(k, frontFace, backFace) {
    const node = el('div', 'flipbook__sheet', { 'data-sheet': String(k) });
    const front = makeFace('front', frontFace);
    const backF = makeFace('back', backFace);
    node.append(front.el, backF.el);
    bookEl.appendChild(node);
    const sheet = { k, el: node, front, back: backF, turned: false, turning: false, rank: 0, vrank: 0, timer: 0 };
    node.addEventListener('transitionend', (e) => {
      if (e.target === node && e.propertyName === 'transform' && sheet.turning) finish(sheet);
    });
    return sheet;
  }

  function buildSheets(mode) {
    const list = [];
    if (mode === 'spread') {
      for (let f = 0; f < faces.length; f += 2) list.push(makeSheet(list.length, faces[f], faces[f + 1] || BLANK));
    } else {
      for (let f = 0; f < faces.length; f++) list.push(makeSheet(list.length, faces[f], BLANK));
    }
    return list;
  }

  /* ── page ↔ turns ── */
  // 0-based indices of the pages on show, in reading order (right panel first, then left).
  function visiblePages() {
    const { sheets, c, mode } = st;
    if (!sheets.length) return [0];
    if (mode === 'single') {
      const s = sheets[Math.min(c, sheets.length - 1)];
      return [s.front.page == null ? N - 1 : s.front.page];
    }
    const out = [];
    if (c > 0 && sheets[c - 1].back.page != null) out.push(sheets[c - 1].back.page);
    if (c < sheets.length && sheets[c].front.page != null) out.push(sheets[c].front.page);
    return out.length ? out : [N - 1];
  }
  // The "current" page is the left one — the page about to be turned — so both pages of a spread map to one state.
  const currentPage = () => { const v = visiblePages(); return v[v.length - 1]; };
  const pageToTurns = (p) => (st.mode === 'single' ? p : Math.ceil(p / 2));
  const clampPage = (p) => Math.max(0, Math.min(N - 1, p | 0));

  /* ── rendering ── */
  // Hover affordance: the top settled sheet under the pointer lifts slightly — only if that side can still
  // turn, and never while a sheet is in flight (a landing sheet must meet a flat stack, not a tilted one).
  function peekFor(s) {
    if (st.mode !== 'spread' || !st.hoverSide || st.busy || s.vrank !== 0) return 0;
    if (!s.turned && st.hoverSide === 'left' && st.c < st.cMax) return PEEK_DEG;
    if (s.turned && st.hoverSide === 'right' && st.c > 0) return -PEEK_DEG;
    return 0;
  }
  const xf = (s) => `translateZ(${-(s.rank * SHEET_Z)}px) rotateY(${(s.turned ? 180 : 0) + peekFor(s)}deg)`;

  // `priority` ('low') marks images that are only needed while a sheet is in flight, so the spread the
  // reader lands on wins the network.
  function setLoaded(face, want, priority) {
    if (!face.img) return;
    const has = face.img.hasAttribute('src');
    if (want && !has) {
      face.el.classList.add('is-loading');
      if (priority) face.img.setAttribute('fetchpriority', priority); else face.img.removeAttribute('fetchpriority');
      face.img.src = face.src;
      if (face.img.complete && face.img.naturalWidth) { face.el.classList.add('is-loaded'); face.el.classList.remove('is-loading'); }
    } else if (!want && has) {
      face.img.removeAttribute('src');
      face.el.classList.remove('is-loaded', 'is-loading');
    }
  }

  // Counter text for the pages on show (0-based indices in reading order). Folio i = index i; covers are unnumbered.
  function labelFor(shown) {
    if (shown.length === 1) {
      const i = shown[0];
      if (faces[i] && faces[i].cover) {
        return i === 0 ? { ar: 'الغلاف', en: 'Cover', sr: 'Front cover' } : { ar: 'الغلاف الخلفي', en: 'Back cover', sr: 'Back cover' };
      }
      return { ar: `ص ${i} / ${T}`, en: `page ${i} / ${T}`, sr: `page ${i} of ${T}` };
    }
    const lo = Math.min(shown[0], shown[1]), hi = Math.max(shown[0], shown[1]);
    return { ar: `ص ${lo}–${hi} / ${T}`, en: `pages ${lo}–${hi} / ${T}`, sr: `pages ${lo} to ${hi} of ${T}` };
  }

  function warmUp(sheet) {
    if (!sheet) return;
    for (const f of [sheet.front, sheet.back]) {
      if (!f.src || warm.has(f.src)) continue;
      const im = new Image();
      im.decoding = 'async';
      im.src = f.src;
      warm.set(f.src, im);
      if (warm.size > WARM_MAX) warm.delete(warm.keys().next().value);
    }
  }

  let lastAnnounced = -1;
  function render() {
    if (st.destroyed) return;
    const { sheets, c, mode } = st;
    const n = sheets.length;
    // Two ranks per stack. `rank` (depth) counts every sheet on the stack, in-flight ones included, so the
    // sheets a flying page lands on already sit beneath it. `vrank` (visibility) counts settled sheets only:
    // a riffle can have several sheets in the air at once, and they must not push the stack they are landing
    // on out of the render window — that is what left the table showing through mid-riffle.
    let li = 0, lv = 0, ri = 0, rv = 0, left = 0, right = 0, busy = false;
    for (let k = 0; k < n; k++) {
      const s = sheets[k];
      if (s.turning || pending.has(s)) busy = true;
      if (s.turned) { right++; continue; }
      left++;
      s.rank = li++;
      s.vrank = s.turning ? -1 : lv++;
    }
    for (let k = n - 1; k >= 0; k--) {
      const s = sheets[k];
      if (!s.turned) continue;
      s.rank = ri++;
      s.vrank = s.turning ? -1 : rv++;
    }
    st.busy = busy;

    for (let k = 0; k < n; k++) {
      const s = sheets[k];
      const scheduled = pending.has(s);
      // Render the top few settled sheets of each stack plus anything in flight or scheduled. Single mode has
      // no right-hand stack: a turned sheet waiting its turn back stays hidden until it actually moves.
      let vis = s.vrank >= 0 && s.vrank <= VIS_WINDOW && !(mode === 'single' && s.turned);
      vis = vis || s.turning || (scheduled && !(mode === 'single' && s.turned));
      s.el.classList.toggle('is-hidden', !vis);
      if (!s.turning) {
        s.el.style.transform = xf(s);
        s.el.style.zIndex = String(s.turned ? k + 1 : n - k);
      }
      if (Math.abs(k - c) <= LOAD_WINDOW) { setLoaded(s.front, true); setLoaded(s.back, true); }
    }
    // Second pass, after the destination window has claimed the network: sheets that only matter while in
    // flight ride along at low priority, and drop their images again once they have landed.
    for (let k = 0; k < n; k++) {
      const s = sheets[k];
      if (Math.abs(k - c) <= LOAD_WINDOW) continue;
      const keep = s.turning || pending.has(s);
      setLoaded(s.front, keep, 'low');
      setLoaded(s.back, keep, 'low');
    }
    warmUp(sheets[c + LOAD_WINDOW + 1]);
    warmUp(sheets[c - LOAD_WINDOW - 1]);

    // Paper block per side follows the sheets actually lying there (a flying sheet counts for its destination),
    // so the strip grows with the riffle instead of jumping ahead of it.
    const per = mode === 'spread' ? EDGE_PX : EDGE_PX / 2;
    root.style.setProperty('--fb-edge-l', `${Math.max(0, left - 1) * per}px`);
    root.style.setProperty('--fb-edge-r', `${Math.max(0, right - 1) * per}px`);

    const closed = mode === 'spread' && (c === 0 || c === n);
    const shift = mode !== 'spread' ? 0 : c === 0 ? st.pageW / 2 : c === n ? -st.pageW / 2 : 0;
    root.style.setProperty('--fb-shift', `${shift}px`);
    root.style.setProperty('--fb-shadow-sx', closed ? '0.56' : '1');
    root.classList.toggle('is-open', c > 0 && c < n);

    const shown = visiblePages();
    const p = shown[shown.length - 1];
    root.dataset.page = String(p);
    root.dataset.turns = String(c);
    if (p !== lastAnnounced) {
      lastAnnounced = p;
      const t = labelFor(shown);
      counterAr.textContent = t.ar;
      counterEn.textContent = t.en;
      counterSr.textContent = t.sr;
      range.value = String(p);
      range.setAttribute('aria-valuetext', t.sr);
    }
    // Cursor honesty: no pointer on a half that has nothing left to turn.
    const inert = st.hoverSide === 'left' ? c >= st.cMax : st.hoverSide === 'right' ? c <= 0 : false;
    bookEl.classList.toggle('is-inert', inert);
    // Disabling a focused button drops focus to <body>, stranding keyboard users (arrow keys are gated on focus
    // or hover). Park focus on the region first so ← → Home End keep working and the live counter stays in context.
    const nextOff = c >= st.cMax, prevOff = c <= 0;
    const active = document.activeElement;
    if ((nextOff && active === btnNext) || (prevOff && active === btnPrev)) {
      // A button reached by mouse carries no focus ring; keep it that way when its focus moves to the region.
      let byKeyboard = true;
      try { byKeyboard = active.matches(':focus-visible'); } catch (_) { /* older engines: assume keyboard */ }
      root.classList.toggle('is-mouse-focus', !byKeyboard);
      root.focus({ preventScroll: true, focusVisible: byKeyboard });
    }
    btnNext.disabled = nextOff;
    btnPrev.disabled = prevOff;
  }

  /* ── turning ── */
  function finish(s) {
    if (s.timer) { clearTimeout(s.timer); timers.delete(s.timer); s.timer = 0; }
    s.turning = false;
    s.el.classList.remove('is-turning', 'is-fwd', 'is-bwd');
    for (const cs of casts) cs.el.classList.remove('is-under-in', 'is-under-out');
    casts.clear();
    render();
  }

  // Fallback for a missed transitionend (throttled tab, devtools slow-motion): only finish once the
  // transform transition has really stopped, otherwise check again shortly.
  function finishLater(s) {
    s.timer = 0;
    const anims = typeof s.el.getAnimations === 'function' ? s.el.getAnimations() : [];
    if (anims.some((a) => a.playState === 'running')) {
      s.timer = setTimeout(() => { timers.delete(s.timer); finishLater(s); }, 150);
      timers.add(s.timer);
      return;
    }
    finish(s);
  }

  function flip(s, need) {
    if (s.timer) { clearTimeout(s.timer); timers.delete(s.timer); s.timer = 0; }
    s.turned = need;
    s.el.classList.remove('is-hidden', 'is-under-in', 'is-under-out');
    casts.delete(s);
    if (reduced) { s.turning = false; return; }          // render() applies the final transform instantly
    s.turning = true;
    s.el.classList.add('is-turning', need ? 'is-fwd' : 'is-bwd');
    s.el.classList.remove(need ? 'is-bwd' : 'is-fwd');
    s.el.style.zIndex = String(st.sheets.length + 10);
    s.el.style.transform = `translateZ(0px) rotateY(${need ? 180 : 0}deg)`;
    s.timer = setTimeout(() => { timers.delete(s.timer); finishLater(s); }, TURN_MS + 80);
    timers.add(s.timer);
  }

  function snap(s, need) {
    if (s.timer) { clearTimeout(s.timer); timers.delete(s.timer); s.timer = 0; }
    s.turned = need;
    s.turning = false;
    s.el.classList.remove('is-turning', 'is-fwd', 'is-bwd');
    s.el.style.transition = 'none';
    s.el.style.transform = `translateZ(0px) rotateY(${need ? 180 : 0}deg)`;
    void s.el.offsetWidth;
    s.el.style.transition = '';
  }

  function cast(s, forward) {
    const out = st.sheets[forward ? s.k + 1 : s.k - 1];
    const inn = st.sheets[forward ? s.k - 1 : s.k + 1];
    if (out && !out.turning) { out.el.classList.add('is-under-out'); casts.add(out); }
    if (inn && !inn.turning) { inn.el.classList.add('is-under-in'); casts.add(inn); }
  }

  let lead = null;            // cancel hook for a riffle waiting on its first sheet's images
  let gen = 0;                // bumps on every setTurns/rebuild so a stale lead can never start a riffle

  // Run `cb` once every image in `faceList` has loaded (or failed), or after `maxMs` — whichever comes first.
  // Returns a cancel function; listeners and the timer are released either way.
  function afterLoad(faceList, maxMs, cb) {
    const imgs = faceList.map((f) => f.img).filter((im) => im && im.getAttribute('src') && !(im.complete && im.naturalWidth));
    if (!imgs.length) { cb(); return null; }
    let outstanding = imgs.length, timer = 0, done = false;
    const one = () => { if (--outstanding <= 0) fire(); };
    const stop = () => {
      if (done) return;
      done = true;
      for (const im of imgs) { im.removeEventListener('load', one); im.removeEventListener('error', one); }
      if (timer) { clearTimeout(timer); timers.delete(timer); timer = 0; }
    };
    const fire = () => { if (done) return; stop(); if (lead === stop) lead = null; cb(); };
    for (const im of imgs) { im.addEventListener('load', one); im.addEventListener('error', one); }
    timer = setTimeout(() => { timers.delete(timer); timer = 0; fire(); }, maxMs);
    timers.add(timer);
    return stop;
  }
  const cancelPending = () => {
    if (lead) { const stop = lead; lead = null; stop(); }
    for (const [, t] of pending) if (t) { clearTimeout(t); timers.delete(t); }
    pending.clear();
    gen++;
  };

  function setTurns(target) {
    if (st.destroyed) return;
    target = Math.max(0, Math.min(st.cMax, target | 0));
    st.c = target;
    cancelPending();

    const fwd = [], bwd = [];
    for (const s of st.sheets) {
      const need = s.k < target;
      if (s.turned !== need) (need ? fwd : bwd).push(s);
    }
    bwd.reverse();
    const list = fwd.concat(bwd);
    if (!list.length) { render(); return; }

    let anim = list;
    if (list.length > MAX_ANIM) {
      for (const s of list.slice(0, list.length - MAX_ANIM)) snap(s, s.k < target);
      anim = list.slice(-MAX_ANIM);
    }
    const stagger = anim.length > 1 ? Math.min(STAGGER_MS, 1200 / anim.length) : 0;
    const run = gen;
    const start = () => {
      if (st.destroyed || run !== gen) return;
      anim.forEach((s, i) => {
        pending.delete(s);
        if (i === 0 || reduced) { flip(s, s.k < target); return; }
        const t = setTimeout(() => { pending.delete(s); timers.delete(t); flip(s, s.k < target); render(); }, i * stagger);
        pending.set(s, t);
        timers.add(t);
      });
      if (list.length === 1 && !reduced) cast(list[0], list[0].k < target);
      render();
    };
    if (anim.length === 1 || reduced) { start(); return; }
    // Riffle: mark every sheet as scheduled so render() hands them their images now, then give the first
    // sheet's faces a moment to decode so the riffle does not open on blank paper.
    for (const s of anim) pending.set(s, 0);
    render();
    lead = afterLoad([anim[0].front, anim[0].back], LEAD_MS, start);
  }

  /* ── layout ── */
  function rebuild(page) {
    cancelPending();
    for (const s of st.sheets) { if (s.timer) { clearTimeout(s.timer); timers.delete(s.timer); } s.el.remove(); }
    casts.clear();
    st.sheets = buildSheets(st.mode);
    const last = st.sheets[st.sheets.length - 1];
    st.cMax = st.sheets.length - (last && last.back.src ? 0 : 1);
    st.c = Math.min(st.cMax, pageToTurns(page));
    for (const s of st.sheets) s.turned = s.k < st.c;
    lastAnnounced = -1;
  }

  function layout() {
    if (st.destroyed) return;
    const cw = root.clientWidth;
    if (!cw) return;
    const mode = cw < SINGLE_BP ? 'single' : 'spread';
    const vh = window.innerHeight || 900;
    let pageW;
    if (mode === 'spread') pageW = Math.floor(Math.min(cw, MAX_BOOK_W, vh * 0.8 * RATIO * 2) / 2);
    else pageW = Math.floor(Math.min(cw * 0.9, 480, vh * 0.72 * RATIO));
    const pageH = Math.round(pageW / RATIO);
    const modeChanged = mode !== st.mode;
    root.classList.toggle('flipbook--narrow', mode === 'spread' && cw < NARROW_BP);
    if (!modeChanged && pageW === st.pageW && pageH === st.pageH) return;   // e.g. mobile address bar: nothing to do
    const page = st.sheets.length ? currentPage() : 0;                       // read with the old mode's sheets
    st.mode = mode;
    st.pageW = pageW;
    st.pageH = pageH;
    root.classList.add('is-resizing');
    root.classList.toggle('flipbook--spread', mode === 'spread');
    root.classList.toggle('flipbook--single', mode === 'single');
    root.style.setProperty('--fb-page-w', `${pageW}px`);
    root.style.setProperty('--fb-page-h', `${pageH}px`);
    root.style.setProperty('--fb-persp', `${Math.round(pageW * (mode === 'spread' ? 5 : 4.2))}px`);
    if (modeChanged) rebuild(page);
    render();
    void root.offsetWidth;
    root.classList.remove('is-resizing');
  }

  /* ── input ── */
  // Arrow keys work while the book is focused OR merely hovered (a light affordance for mouse users);
  // Home/End only with focus inside the region, so a pointer resting on the book never hijacks page scrolling.
  const onKey = (e) => {
    if (st.destroyed) return;
    const focused = root.contains(document.activeElement);
    if (focused) root.classList.remove('is-mouse-focus');   // keyboard is back: let the focus ring show
    if (!focused && !st.hovered) return;
    const t = e.target;
    if (t === range || (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowLeft': api.next(); break;
      case 'ArrowRight': api.prev(); break;
      case 'Home': if (!focused) return; api.goTo(0); break;
      case 'End': if (!focused) return; api.goTo(N - 1); break;
      default: return;
    }
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  const onEnter = (e) => { if (e.pointerType !== 'touch') st.hovered = true; };
  const onLeave = () => { st.hovered = false; if (st.hoverSide) { st.hoverSide = ''; render(); } };
  const onFocusOut = (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('is-mouse-focus'); };
  root.addEventListener('pointerenter', onEnter);
  root.addEventListener('pointerleave', onLeave);
  root.addEventListener('focusout', onFocusOut);

  const bookCenterX = () => { const r = bookEl.getBoundingClientRect(); return r.left + r.width / 2; };
  const onMove = (e) => {
    if (e.pointerType === 'touch') return;       // side drives the peek (spread only) and the cursor (both modes)
    const over = e.target instanceof Element && e.target.closest('.flipbook__book');
    const side = over ? (e.clientX < bookCenterX() ? 'left' : 'right') : '';
    if (side !== st.hoverSide) { st.hoverSide = side; render(); }
  };
  stage.addEventListener('pointermove', onMove);

  let press = null;
  const onDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    // Focus the region so Home/End work after a click, but as a pointer interaction: no keyboard focus ring
    // (the class gates the CSS; `focusVisible:false` covers browsers that honour the option).
    root.classList.add('is-mouse-focus');
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true, focusVisible: false });
  };
  const onUp = (e) => {
    if (!press || press.id !== e.pointerId) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    press = null;
    // A swipe follows the paper: dragging rightward carries the left page over the spine (= next).
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { dx > 0 ? api.next() : api.prev(); return; }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      if (!(e.target instanceof Element) || !e.target.closest('.flipbook__book')) return;
      e.clientX < bookCenterX() ? api.next() : api.prev();
    }
  };
  const onCancel = () => { press = null; };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onCancel);

  const onNextClick = () => api.next();
  const onPrevClick = () => api.prev();
  const onRange = () => api.goTo(Number(range.value));
  btnNext.addEventListener('click', onNextClick);
  btnPrev.addEventListener('click', onPrevClick);
  range.addEventListener('input', onRange);

  let raf = 0;
  const scheduleLayout = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; layout(); }); };
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(scheduleLayout); ro.observe(root); }
  window.addEventListener('resize', scheduleLayout);

  /* ── public API ── */
  const api = {
    next() { setTurns(st.c + 1); },
    prev() { setTurns(st.c - 1); },
    goTo(page) { setTurns(pageToTurns(clampPage(page))); },
    destroy() {
      if (st.destroyed) return;
      st.destroyed = true;
      cancelPending();
      for (const t of timers) clearTimeout(t);
      timers.clear(); casts.clear(); warm.clear();
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', scheduleLayout);
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('focusout', onFocusOut);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onCancel);
      btnNext.removeEventListener('click', onNextClick);
      btnPrev.removeEventListener('click', onPrevClick);
      range.removeEventListener('input', onRange);
      root.replaceChildren();
      root.classList.remove('flipbook--spread', 'flipbook--single', 'flipbook--narrow', 'is-open', 'is-reduced', 'is-resizing', 'is-mouse-focus');
      for (const p of ['--fb-page-w', '--fb-page-h', '--fb-persp', '--fb-edge-l', '--fb-edge-r', '--fb-shift', '--fb-shadow-sx']) root.style.removeProperty(p);
      delete root.dataset.page; delete root.dataset.turns;
      root.removeAttribute('aria-roledescription'); root.removeAttribute('aria-describedby');
      if (!hadTabIndex) root.removeAttribute('tabindex');
      if (!hadRole) root.removeAttribute('role');
      if (!hadLabel) root.removeAttribute('aria-label');
      instances = Math.max(0, instances - 1);
      if (!instances) { const s = document.getElementById(STYLE_ID); if (s) s.remove(); }
    },
  };

  layout();
  return api;
}

export default initBook;
