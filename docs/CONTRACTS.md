# Module contracts (ES modules, no build step)

Import map in index.html:
```html
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
```
GSAP is loaded as classic scripts: /node_modules/gsap/dist/gsap.min.js and /node_modules/gsap/dist/ScrollTrigger.min.js (globals `gsap`, `ScrollTrigger`).

Design tokens (css/style.css `:root`): --bg #151616, --panel #1c1d1d, --line #353636, --ink #f2f1ec, --muted #a0a29e,
--accent #f3a65a, --accent-2 #3ec6c0 (teal screen glow), --glow rgba(243,166,90,.35). Fonts: 'Space Grotesk' (display), 'DM Sans' (body).
Scene palette: warm amber lamp light on dark charcoal room, teal + orange monitor glow, wood desk #6b4a2e, concrete walls #2a2b2a.

## js/scene.js
```js
export function initStudioScene({ canvas, labelLayer, hotspots, reducedMotion }) // → controller | null
// canvas: <canvas> already in DOM, fills its parent (position:absolute; inset:0).
// labelLayer: a <div> (position:absolute; inset:0; pointer-events:none) where the module places hotspot DOM labels.
// hotspots: [{ id, number:'01', label:'The workbench', target:'#work' }] — module decides 3D anchor points for each id:
//   'work' → desk/monitors, 'book' → floating book, 'ideas' → bookshelf/lamp, 'lalapoker' → poker chips + cards on the side table.
//   For each hotspot create: <button class="hotspot" data-target="#work"><span class="hotspot__dot">01</span><b class="hotspot__label">The workbench <i>↗</i></b></button>
//   with pointer-events:auto, positioned every frame by projecting the 3D anchor to screen space (CSS transform translate).
//   On click: document.querySelector(target)?.scrollIntoView({behavior:'smooth'}).
// reducedMotion: boolean — if true, render ONE frame (no idle animation, no parallax) but still position hotspots.
// Returns { destroy(), pause(), resume(), resize() } or null if WebGL is unavailable (caller shows a static fallback image).
// Requirements: transparent clear color (alpha:true) so the page background shows; DPR capped at 2; pause the RAF loop
// when the canvas is not intersecting the viewport; handle resize via ResizeObserver; no external assets (textures generated
// procedurally via CanvasTexture or plain materials); room built from primitives (Box/Cylinder/Plane), low-poly, isometric-ish
// camera (PerspectiveCamera ~35° fov looking down at ~30°), soft shadows optional (keep GPU cheap: ≤ 60k triangles).
// Idle animations: monitor screens flicker/scroll a procedural "code" texture, the book bobs and slowly rotates, poker chips
// spin, lamp light gently breathes, subtle dust particles. Mouse parallax: camera orbits ±6° following the pointer (lerped).
// Intro: on first frame, objects rise/scale in with staggered easing over ~1.6s (skip when reducedMotion).

export function initPokerScene({ canvas, reducedMotion }) // → controller | null
// Small standalone scene for the LalaPoker section: a fanned hand of 5 playing cards (procedural CanvasTexture faces: A♠ K♥ Q♦ J♣ 10♠
// in the orange/teal palette with dark backs) hovering over a stack of poker chips (cylinders, striped edges, gold/black/orange).
// Slow orbit + pointer parallax; cards gently float. Same controller shape and rules as above.
```

## js/book.js
```js
export function initBook({ container, pageCount, pageSrc, cover, back, pdfUrl, reducedMotion }) // → { next(), prev(), goTo(n), destroy() }
// container: an empty <div class="flipbook"> — module builds the whole DOM inside it:
//   .flipbook__stage (perspective) > .flipbook__book > .flipbook__sheet elements (each sheet has .flipbook__face--front and --back,
//   transform-style:preserve-3d, backface-visibility:hidden), plus .flipbook__controls (prev/next buttons, "page X / N" counter
//   with aria-live="polite", "Open full PDF ↗" link to pdfUrl, "Download" link with download attr).
// Reading direction is RTL (Arabic book): spine on the RIGHT. Closed book shows the front cover (pageSrc(0)) on the LEFT half
// of the spread's right… i.e. cover sits on the right side, free edge on the left. "Next" turns the LEFT-most sheet over to the RIGHT
// (rotateY from 0 → +180deg about the sheet's right edge). Keyboard: ArrowLeft = next, ArrowRight = prev (matches RTL), Home/End.
// Also: clicking the left half of the book = next, right half = prev; touch swipe. Turn duration 900ms, ease-in-out; reducedMotion → 0ms.
// Lazy load: only sheets within ±3 of the current spread have <img> src set; preload adjacent pages. Show a shimmer placeholder.
// Mobile (< 760px): single-page view (one sheet visible, still flipping). Page 0 is the cover, page N-1 is the back cover.
// pageSrc(i) returns the URL for 0-based page i. The module must not depend on GSAP or Three.
```

## js/gallery.js
```js
export function openGallery(images, startIndex = 0, { title = '', google = '' } = {}) // images: [{src, alt}]
// Creates (once) a <dialog class="lightbox"> appended to body. Shows the image with caption (alt), counter "3 / 9",
// prev/next buttons, keyboard ←/→/Esc, click-outside to close, thumbnail strip at the bottom, optional "More on Google ↗" link.
// Zoom-in open animation (scale .96 → 1, 250ms). Preloads neighbours. Traps focus while open. Returns nothing.
```

## js/cityscene.js  (City Crafters spotlight turntable)
```js
export function initCityScene({ canvas, reducedMotion, onFocus }) // → { focus(i), destroy(), pause(), resume(), resize() } | null
// canvas: <canvas> filling its parent (.city-stage, position:relative; ~520px tall on desktop, ~360px on phones; width up to 1440px).
// Four low-poly dioramas sit on pedestals evenly spaced on a slowly turning ring (turntable). Index order is fixed:
//   0 'pit'   Pit Protocol      — an F1-style race car (body, nose, front/rear wings, 4 wheels) in a pit box: checkered floor tile,
//                                 4 small crew figures (capsules) at the wheels; one wheel lifts off and a fresh one snaps on in a loop,
//                                 a wheel-gun spark flash; two VR-headset props on a rack; amber pit lights.
//   1 'holo'  Hologram Cloud    — a wireframe city block (EdgesGeometry of stacked boxes, teal LineBasicMaterial) floating above a
//                                 black glass table, with a scanning plane that sweeps up through it and rising particle motes; a small
//                                 solid "real" building fading into wireframe at the top.
//   2 'blade' Unseen Blade      — a dark pedestal, a kneeling/standing figure silhouette with a katana (thin box + guard + handle),
//                                 expanding echo-location rings (torus/ring geometries fading out) pulsing from the figure every ~1.6s,
//                                 a crimson accent (the game's icon red #d7261e) on the ring edges, moonlight blue rim.
//   3 'jet'   Target Destroyed  — a low-poly F-16 (fuselage, delta wings, tail) banking in a circle above the pedestal, 3 hostile drones
//                                 (small dark tetra/box with red lights) it chases, a missile with a fading trail every few seconds,
//                                 a green FLIR-style crosshair ring (#4cff8a) hovering over the current target. Gulf-sand pedestal.
// focus(i): eases the turntable (≈900ms, cubic) so diorama i faces the camera; the focused diorama gets full light + a soft amber
//   spot, the others dim to ~55%. Auto-idle: the ring drifts slowly (≈ 1 rev / 90s) whenever no focus() happened in the last 12s;
//   after focus(), hold still for 12s then resume drifting. Clicking/tapping a diorama (raycast on its group) calls onFocus(i) — the page
//   then calls focus(i) itself — and hovering shows a pointer cursor.
// Rules shared with scene.js: transparent clear (alpha:true), ACES tone mapping, DPR ≤ 2, ResizeObserver, IntersectionObserver +
//   visibilitychange pause the RAF, pointer parallax ±5° lerped, procedural textures only (CanvasTexture), ≤ 40k triangles, one
//   shadow-casting DirectionalLight with a 1024 map (pedestal tops receive), intro: pedestals rise + scale-in staggered (1.4s),
//   reducedMotion: single still frame with diorama 0 in front, no loops, focus(i) jumps instantly and renders one frame.
// destroy(): cancel RAF, disconnect observers/listeners, dispose geometries/materials/textures/renderer.
// Palette: bg transparent over #151616; amber #f3a65a, teal #3ec6c0, ink #f2f1ec, charcoal #1c1d1d; per-diorama accents above.
```
