/**
 * @file scene.js — Three.js scenes for "The Playable Studio" (Zain Kassem portfolio).
 *
 * Exports two factory functions. Both return the same controller shape, or `null` when a
 * WebGL context cannot be created (the caller then shows a static fallback image).
 *
 * @example
 *   import { initStudioScene, initPokerScene } from './scene.js';
 *   const studio = initStudioScene({ canvas, labelLayer, hotspots, reducedMotion });
 *   const poker  = initPokerScene({ canvas: pokerCanvas, reducedMotion });
 *   studio?.destroy();
 *
 * `initStudioScene({ canvas, labelLayer, hotspots, reducedMotion })`
 *   A low-poly isometric game-designer studio built entirely from primitives with procedural
 *   CanvasTextures (no external assets): open corner room, desk with three glowing monitors
 *   (scrolling code + a tiny game view), chair, a lab bay (bench, robotic arm, reactor ring, holotable
 *   building a holographic world), breathing lamp, floating open book,
 *   side table with poker chips and cards, framed art, plants, VR headset, racing wheel, sofa,
 *   drifting dust. Hotspot DOM labels are created inside `labelLayer` and projected to screen
 *   space every frame:
 *     <button class="hotspot" data-target="#work">
 *       <span class="hotspot__dot">01</span><b class="hotspot__label">The workbench <i>↗</i></b>
 *     </button>
 *   Anchors: 'work' → above the monitors, 'book' → the floating book, 'ideas' → above the hologram,
 *   'lalapoker' → the chips. Labels are hidden (opacity 0) while their anchor is behind the
 *   camera or outside the canvas. Clicking a label smooth-scrolls to `data-target`.
 *   Each button also carries `aria-label="01 The workbench"` so its accessible name does not
 *   depend on the visual text.
 *
 *   Label layout (page-CSS agnostic):
 *   - Labels are kept fully inside the canvas and de-overlapped every frame (a small AABB
 *     separation pass, pushed apart vertically first, then smoothed over ~150 ms so parallax
 *     never makes them jitter).
 *   - Compact mode: when the canvas is narrower than 560 CSS px the text pill
 *     (`.hotspot__label`) collapses to `display:none` and only the numbered dot stays on the
 *     anchor; the pill re-appears while the button is hovered (mouse) or focused (keyboard).
 *     Hooks for page CSS: `labelLayer.classList` gets `is-compact`, each button `hotspot--compact`.
 *
 * `initPokerScene({ canvas, reducedMotion })`
 *   A fanned hand (A♠ K♥ Q♦ J♣ 10♠) floating over a gold/black/orange chip stack, slow
 *   auto-orbit, amber spot.
 *
 * Controller: `{ destroy(), pause(), resume(), resize(), stats() }`
 *   - destroy(): stops the loop, disconnects observers/listeners, disposes every geometry,
 *     material, texture and the renderer, and removes the labels it created. Re-init on the
 *     same canvas afterwards is supported.
 *   - pause()/resume(): user-level pause. The loop also auto-pauses while the canvas is not
 *     intersecting the viewport or the document is hidden.
 *   - resize(): re-measures the canvas (also driven automatically by a ResizeObserver).
 *   - stats(): `{ triangles, calls, fps, memory:{geometries,textures} }` for diagnostics.
 *
 * Fallback guard: author CSS such as `img { display:block }` outranks the UA `[hidden]` rule, so a
 * `<img hidden>` fallback that shares the canvas's parent would paint over the live scene. While a
 * scene is alive, `[hidden]` siblings of its canvas that still render are forced to
 * `display:none` (inline); removing their `hidden` attribute, or `destroy()`, restores them.
 *
 * Behaviour rules (see docs/CONTRACTS.md): transparent clear colour, DPR ≤ 2, ≤ 60k triangles,
 * soft shadows received by the floor only, pointer parallax orbit ±6° (lerped), intro rise/scale
 * over 1.6 s with a self-contained tween helper (no GSAP), and `reducedMotion === true` renders a
 * single still frame with hotspots positioned but no animation or parallax. Static meshes that
 * share a material are merged into one draw call per (group, material, shadow-flags) bucket.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createDioramaSet } from './cityscene.js';

/* ───────────────────────────── palette / constants ───────────────────────────── */

const C = {
  bg: 0x151616, panel: 0x1c1d1d, line: 0x353636, ink: 0xf2f1ec, muted: 0xa0a29e,
  accent: 0xf3a65a, teal: 0x3ec6c0, wood: 0x6b4a2e, concrete: 0x2a2b2a,
};
const HEX = {
  bg: '#151616', panel: '#1c1d1d', line: '#353636', ink: '#f2f1ec', muted: '#a0a29e',
  accent: '#f3a65a', teal: '#3ec6c0',
};
const FONT_DISPLAY = "'Space Grotesk','DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif";
const FONT_BODY = "'DM Sans','Space Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif";
/** Arabic strings (book pages): Tajawal is loaded by the page; the rest is a fallback stack. */
const FONT_ARABIC = "'Tajawal','Space Grotesk','DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif";
const MAX_DPR = 2;
const GOLD = '#dcb96a';
const DEG = Math.PI / 180;

/* ───────────────────────────── tiny tween helper ───────────────────────────── */

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Frame-rate independent lerp factor: `k` per 60 fps frame. */
const damp = (k, dt) => 1 - Math.pow(1 - k, dt * 60);

/** Minimal time-based tween list, advanced by the scene's own RAF loop (so it pauses with it). */
class Tweens {
  constructor() { this.list = []; }
  /** @param {{delay?:number,duration?:number,ease?:(t:number)=>number,onUpdate:(e:number,p:number)=>void,onComplete?:()=>void}} o */
  add(o) {
    const tw = { t: -(o.delay || 0), duration: o.duration || 1, ease: o.ease || easeOutCubic, onUpdate: o.onUpdate, onComplete: o.onComplete };
    this.list.push(tw);
    return tw;
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      if (tw.t < 0) continue;
      const p = Math.min(1, tw.t / tw.duration);
      tw.onUpdate(tw.ease(p), p);
      if (p >= 1) { this.list.splice(i, 1); tw.onComplete?.(); }
    }
  }
  /** Jump every tween to its end state (used for reducedMotion). */
  finish() { const l = this.list.slice(); this.list.length = 0; for (const tw of l) { tw.onUpdate(1, 1); tw.onComplete?.(); } }
  clear() { this.list.length = 0; }
}

/* ───────────────────────────── small utilities ───────────────────────────── */

/** Deterministic PRNG so the room looks identical on every load. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d') };
}

/** Wraps a 2D canvas in a CanvasTexture (sRGB, clamped). `draw(ctx,w,h,state,extra)` can be re-run via `userData.redraw()`. */
function canvasTexture(w, h, draw, opts = {}) {
  const { c, ctx } = makeCanvas(w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = opts.wrap || THREE.ClampToEdgeWrapping;
  tex.anisotropy = opts.anisotropy || 1;
  tex.generateMipmaps = opts.mipmaps !== false;
  tex.minFilter = opts.mipmaps === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  const state = opts.state || {};
  tex.userData.redraw = (extra) => { draw(ctx, w, h, state, extra); tex.needsUpdate = true; };
  tex.userData.usesText = !!opts.usesText;
  tex.userData.redraw();
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Standard material factory with sane low-poly defaults. */
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

/** Re-draws text-bearing textures once web fonts have loaded (textures drawn before that use fallbacks). */
function redrawWhenFontsReady(rig, textures) {
  if (!document.fonts?.ready) return;
  document.fonts.ready.then(() => {
    if (rig.destroyed) return;
    for (const t of textures) t.userData.redraw?.();
    rig.onFontsReady?.();
    rig.requestFrame?.();
  }).catch(() => {});
}

/**
 * Fallback guard. Author CSS like `img { display:block }` beats the UA `[hidden] { display:none }`
 * rule, so a `<img hidden>` fallback sharing the canvas's parent would still paint over the live
 * scene. Force such siblings to `display:none` while the scene is alive. If the page later removes
 * their `hidden` attribute (to show the fallback on purpose) the inline style is lifted at once.
 * Returns a restore function for destroy().
 */
function suppressHiddenSiblings(canvas) {
  const parent = canvas.parentElement;
  const held = new Map(); // el → previous inline display
  const release = (el) => { if (!held.has(el)) return; el.style.display = held.get(el); held.delete(el); };
  let mo = null;
  if (parent && typeof getComputedStyle === 'function') {
    for (const el of parent.children) {
      if (el === canvas || !el.hasAttribute('hidden')) continue;
      if (getComputedStyle(el).display === 'none') continue;
      held.set(el, el.style.display);
      el.style.display = 'none';
    }
    if (held.size && typeof MutationObserver === 'function') {
      mo = new MutationObserver((recs) => { for (const r of recs) if (!r.target.hasAttribute('hidden')) release(r.target); });
      for (const el of held.keys()) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    }
  }
  return () => { mo?.disconnect(); mo = null; for (const el of Array.from(held.keys())) release(el); };
}

/* ───────────────────────────── shared renderer rig ───────────────────────────── */

/**
 * Creates the renderer + camera + loop + observers shared by both scenes.
 * Returns null when a WebGL context cannot be created.
 */
function createRig({ canvas, reducedMotion, shadows }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance', stencil: false });
  } catch (e) {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }
  const restoreSiblings = suppressHiddenSiblings(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
  const clock = new THREE.Clock(false);
  const tweens = new Tweens();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const size = { w: 1, h: 1 };
  const fpsMeter = { frames: 0, t: 0, fps: 0 };

  const rig = {
    renderer, scene, camera, tweens, pointer, size, reducedMotion: !!reducedMotion,
    time: 0,
    onFrame: null,   // (dt, t) => void — scene animation
    onResize: null,  // (w, h) => void — camera fit
    onDispose: null, // () => void — scene-specific cleanup (labels etc.)
    destroyed: false,
  };

  /* ---- state that gates the loop ---- */
  let raf = 0, userPaused = false, intersecting = true, hidden = document.hidden, needsFrame = false;
  const running = () => !rig.destroyed && !userPaused && intersecting && !hidden;

  function renderOnce() {
    if (rig.destroyed) return;
    rig.onFrame?.(0, rig.time);
    renderer.render(scene, camera);
  }

  function tick() {
    raf = 0;
    if (!running()) return;
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 1 / 20);   // animation never jumps more than 50 ms, but the fps meter below counts real time
    rig.time += dt;
    tweens.update(dt);
    // pointer parallax lerp (0.06 per frame @60fps)
    const k = damp(0.06, dt);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    rig.onFrame?.(dt, rig.time);
    renderer.render(scene, camera);
    fpsMeter.frames++; fpsMeter.t += rawDt;
    if (fpsMeter.t >= 1) { fpsMeter.fps = fpsMeter.frames / fpsMeter.t; fpsMeter.frames = 0; fpsMeter.t = 0; }
    raf = requestAnimationFrame(tick);
  }

  function syncLoop() {
    if (rig.reducedMotion) { if (needsFrame && running()) { needsFrame = false; renderOnce(); } return; }
    if (running()) { if (!raf) { clock.start(); clock.getDelta(); raf = requestAnimationFrame(tick); } }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  /** Ask for one more frame (only matters in reducedMotion; the live loop renders anyway). */
  rig.requestFrame = () => { needsFrame = true; syncLoop(); };

  /* ---- resize ---- */
  function resize() {
    if (rig.destroyed) return;
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 0;
    if (!w || !h) return;
    size.w = w; size.h = h;
    // DPR ≤ 2, and additionally bounded so the drawing buffer stays ≤ ~3.7 Mpx (keeps MSAA + shadows cheap on laptop GPUs)
    let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    dpr = Math.max(1, Math.min(dpr, Math.sqrt(3.7e6 / (w * h))));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    rig.onResize?.(w, h);
    camera.updateProjectionMatrix();
    if (rig.reducedMotion) rig.requestFrame();
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas.parentElement || canvas);

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) intersecting = e.isIntersecting;
    syncLoop();
  }, { threshold: 0 });
  io.observe(canvas);

  const onVis = () => { hidden = document.hidden; syncLoop(); };
  document.addEventListener('visibilitychange', onVis);

  /* ---- pointer parallax (window-relative, so it works when the canvas sits under text) ---- */
  const onPointer = (e) => {
    if (e.pointerType === 'touch') return;
    const W = window.innerWidth || 1, H = window.innerHeight || 1;
    pointer.tx = clamp((e.clientX / W) * 2 - 1, -1, 1);
    pointer.ty = clamp((e.clientY / H) * 2 - 1, -1, 1);
  };
  const onLeave = () => { pointer.tx = 0; pointer.ty = 0; };
  if (!rig.reducedMotion) {
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
  }

  /* ---- disposal ---- */
  function disposeMaterial(m, seen) {
    if (!m || seen.has(m)) return; seen.add(m);
    for (const key of ['map', 'emissiveMap', 'alphaMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'bumpMap', 'aoMap', 'lightMap']) {
      const t = m[key]; if (t && !seen.has(t)) { seen.add(t); t.dispose(); }
    }
    m.dispose();
  }
  function disposeScene() {
    const seen = new Set();
    scene.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      if (o.material) { Array.isArray(o.material) ? o.material.forEach((m) => disposeMaterial(m, seen)) : disposeMaterial(o.material, seen); }
      if (o.isLight && o.shadow) o.shadow.dispose();
    });
    scene.clear();
  }

  rig.start = () => {
    resize();
    if (rig.reducedMotion) tweens.finish();
    rig.onFrame?.(0, 0);
    if (rig.reducedMotion) needsFrame = true;
    syncLoop();
  };
  rig.controller = {
    destroy() {
      if (rig.destroyed) return;
      rig.destroyed = true;
      if (raf) cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      tweens.clear();
      rig.onDispose?.();
      restoreSiblings();
      disposeScene();
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.dispose();
      // Leave the (shared, persistent) GL context in its default pixel-store state so that a later
      // renderer created on the same canvas does not upload its placeholder 3D textures with FLIP_Y set.
      try { const gl = renderer.getContext(); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL); } catch (e) { /* context already lost */ }
    },
    pause() { userPaused = true; syncLoop(); },
    resume() { userPaused = false; if (rig.reducedMotion) needsFrame = true; syncLoop(); },
    resize,
    stats() { const r = renderer.info.render, m = renderer.info.memory; return { triangles: r.triangles, calls: r.calls, fps: Math.round(fpsMeter.fps), memory: { geometries: m.geometries, textures: m.textures } }; },
  };
  return rig;
}

/**
 * Computes the camera distance so that sets of world-space points fit inside the frustum.
 * `margin` < 1 leaves breathing room (0.8 → points reach 80% of the half-extent).
 * Each set: { points: Vector3[], h: boolean, v: boolean } — whether it constrains width/height.
 */
const _fitCam = new THREE.PerspectiveCamera();
const _q = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _back = new THREE.Vector3();
function fitDistance(camera, yaw, pitch, target, sets, margin) {
  _back.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  _fitCam.position.copy(target).add(_back); _fitCam.lookAt(target); _fitCam.updateMatrixWorld();
  const e = _fitCam.matrixWorld.elements;
  _right.set(e[0], e[1], e[2]); _up.set(e[4], e[5], e[6]); _back.set(e[8], e[9], e[10]);
  const tanV = Math.tan((camera.fov * DEG) / 2) * margin, tanH = tanV * camera.aspect;
  let d = 0;
  for (const s of sets) for (const p of s.points) {
    _q.copy(p).sub(target);
    const a = _q.dot(_right), b = _q.dot(_up), c = _q.dot(_back);
    if (s.h) d = Math.max(d, Math.abs(a) / tanH + c);
    if (s.v) d = Math.max(d, Math.abs(b) / tanV + c);
  }
  return d;
}
function boxCorners(minX, minY, minZ, maxX, maxY, maxZ) {
  const out = [];
  for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) out.push(new THREE.Vector3(x, y, z));
  return out;
}
/** Places `camera` on an orbit around `target` (yaw about Y, pitch above the horizon). */
function orbitCamera(camera, target, yaw, pitch, dist) {
  camera.position.set(
    target.x + dist * Math.sin(yaw) * Math.cos(pitch),
    target.y + dist * Math.sin(pitch),
    target.z + dist * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.lookAt(target);
}

/* ───────────────────────────── procedural textures ───────────────────────────── */

/* ---- monitor: scrolling code ---- */
function codeLine(r) {
  const indent = Math.floor(r() * 4) * (r() < 0.3 ? 0 : 1);
  const n = 1 + Math.floor(r() * 4);
  const tokens = [];
  for (let i = 0; i < n; i++) {
    const p = r();
    const col = p < 0.3 ? HEX.teal : p < 0.5 ? HEX.accent : p < 0.85 ? HEX.ink : HEX.muted;
    tokens.push({ w: 10 + Math.floor(r() * 46), col, a: col === HEX.ink ? 0.7 : 0.95 });
  }
  return { indent, tokens, blank: r() < 0.12 };
}
function drawCode(ctx, w, h, s) {
  ctx.fillStyle = '#0c1516'; ctx.fillRect(0, 0, w, h);
  const top = 16, lineH = 11, gutter = 24;
  ctx.fillStyle = rgba(HEX.ink, 0.03); ctx.fillRect(0, top, gutter, h - top);
  let y = top + 8 - s.scroll;
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, w, h - top); ctx.clip();
  for (let i = 0; i < s.lines.length; i++, y += lineH) {
    const ln = s.lines[i];
    if (y < top - lineH || y > h) continue;
    ctx.fillStyle = rgba(HEX.muted, 0.35); ctx.fillRect(8, y - 2, 9, 3);
    if (ln.blank) continue;
    let x = gutter + 6 + ln.indent * 10;
    for (const t of ln.tokens) {
      ctx.fillStyle = rgba(t.col, t.a); roundRect(ctx, x, y - 3, t.w, 5, 2); ctx.fill();
      x += t.w + 6;
    }
  }
  ctx.restore();
  // window chrome
  ctx.fillStyle = '#1c1d1d'; ctx.fillRect(0, 0, w, top);
  [HEX.accent, HEX.teal, HEX.muted].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(10 + i * 11, 8, 3, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = rgba(HEX.ink, 0.35); ctx.fillRect(w - 70, 6, 44, 4);
  // caret
  if (s.blink) { ctx.fillStyle = HEX.teal; ctx.fillRect(gutter + 6 + 30, h - 22, 5, 8); }
  // soft bottom fade
  const g = ctx.createLinearGradient(0, h - 40, 0, h); g.addColorStop(0, 'rgba(12,21,22,0)'); g.addColorStop(1, 'rgba(12,21,22,.85)');
  ctx.fillStyle = g; ctx.fillRect(0, h - 40, w, 40);
}
function screenCodeTexture(seed) {
  const r = rng(seed);
  const state = { r, lines: [], scroll: 0, blink: true, acc: 0 };
  for (let i = 0; i < 18; i++) state.lines.push(codeLine(r));
  const tex = canvasTexture(256, 160, drawCode, { state, mipmaps: false });
  tex.userData.tick = (dt) => {
    state.acc += dt;
    if (state.acc < 0.06) return false;
    state.acc = 0;
    state.scroll += 3;
    if (state.scroll >= 11) { state.scroll -= 11; state.lines.shift(); state.lines.push(codeLine(state.r)); }
    state.blink = Math.floor(rigClockNow() * 2) % 2 === 0;
    tex.userData.redraw();
    return true;
  };
  return tex;
}
const rigClockNow = () => performance.now() / 1000;

/* ---- monitor: tiny game view ---- */
function drawGame(ctx, w, h, s) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#08191b'); sky.addColorStop(1, '#2a5658');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  // sun
  const sx = w * 0.62, sy = h * 0.4;
  const halo = ctx.createRadialGradient(sx, sy, 4, sx, sy, 60); halo.addColorStop(0, rgba(HEX.accent, 0.9)); halo.addColorStop(1, rgba(HEX.accent, 0));
  ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = HEX.accent; ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2); ctx.fill();
  // mountains (two layers)
  const layer = (yBase, amp, col, off) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, yBase - amp * (0.5 + 0.5 * Math.sin(x * 0.045 + off)) - amp * 0.4 * Math.sin(x * 0.13 + off * 2));
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  };
  layer(h * 0.6, 26, '#1b2f31', 1.3);
  layer(h * 0.64, 18, '#101d1e', 4.1);
  // ground + perspective grid
  const horizon = h * 0.62;
  ctx.fillStyle = '#0d1a1b'; ctx.fillRect(0, horizon, w, h - horizon);
  ctx.strokeStyle = rgba(HEX.teal, 0.45); ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * 8, horizon); ctx.lineTo(w / 2 + i * 60, h); ctx.stroke(); }
  for (let k = 0; k < 7; k++) {
    const p = ((k + s.t * 0.9) % 7) / 7; const y = horizon + (h - horizon) * p * p;
    ctx.globalAlpha = 0.15 + p * 0.6; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // player marker
  const px = w / 2 + Math.sin(s.t * 1.3) * 22, py = h * 0.84 + Math.sin(s.t * 5) * 2;
  ctx.fillStyle = HEX.accent; roundRect(ctx, px - 6, py - 14, 12, 16, 3); ctx.fill();
  ctx.fillStyle = rgba(HEX.accent, 0.3); ctx.beginPath(); ctx.ellipse(px, py + 4, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
  // HUD
  ctx.fillStyle = rgba(HEX.ink, 0.15); roundRect(ctx, 8, 8, 70, 6, 3); ctx.fill();
  ctx.fillStyle = HEX.accent; roundRect(ctx, 8, 8, 52 + Math.sin(s.t) * 6, 6, 3); ctx.fill();
  ctx.fillStyle = rgba(HEX.ink, 0.15); roundRect(ctx, 8, 18, 70, 6, 3); ctx.fill();
  ctx.fillStyle = HEX.teal; roundRect(ctx, 8, 18, 40, 6, 3); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.45)'; roundRect(ctx, w - 48, 8, 40, 40, 4); ctx.fill();
  ctx.strokeStyle = rgba(HEX.teal, 0.7); ctx.strokeRect(w - 48.5, 8.5, 40, 40);
  ctx.fillStyle = HEX.accent; ctx.fillRect(w - 30 + Math.sin(s.t * 1.3) * 6, 26, 3, 3);
  ctx.fillStyle = HEX.teal; for (let i = 0; i < 4; i++) ctx.fillRect(w - 44 + ((i * 37) % 30), 12 + ((i * 23) % 30), 2, 2);
}
function screenGameTexture() {
  const state = { t: 0, acc: 0 };
  const tex = canvasTexture(256, 160, drawGame, { state, mipmaps: false });
  tex.userData.tick = (dt) => { state.t += dt; state.acc += dt; if (state.acc < 0.05) return false; state.acc = 0; tex.userData.redraw(); return true; };
  return tex;
}

/* ---- monitor: behaviour-tree / node graph ---- */
function drawGraph(ctx, w, h, s) {
  ctx.fillStyle = '#121a1b'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba(HEX.ink, 0.05); ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const N = s.nodes, active = Math.floor(s.t * 1.4) % N.length;
  // edges
  for (const [a, b] of s.edges) {
    const A = N[a], B = N[b];
    ctx.strokeStyle = b === active ? HEX.accent : rgba(HEX.muted, 0.5); ctx.lineWidth = b === active ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(A.x + A.w / 2, A.y + A.h); ctx.bezierCurveTo(A.x + A.w / 2, A.y + A.h + 14, B.x + B.w / 2, B.y - 14, B.x + B.w / 2, B.y); ctx.stroke();
  }
  // nodes
  N.forEach((n, i) => {
    ctx.fillStyle = i === active ? '#2a2b2b' : '#1c1d1d'; roundRect(ctx, n.x, n.y, n.w, n.h, 4); ctx.fill();
    ctx.strokeStyle = i === active ? HEX.accent : rgba(HEX.muted, 0.35); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = n.col; roundRect(ctx, n.x, n.y, n.w, 5, 2); ctx.fill();
    ctx.fillStyle = rgba(HEX.ink, 0.6); ctx.fillRect(n.x + 6, n.y + 11, n.w * 0.55, 3); ctx.fillRect(n.x + 6, n.y + 17, n.w * 0.35, 3);
  });
  // pulse travelling on the active edge
  const e = s.edges.find(([, b]) => b === active);
  if (e) {
    const A = N[e[0]], B = N[e[1]], p = (s.t * 1.4) % 1;
    const x = (A.x + A.w / 2) * (1 - p) + (B.x + B.w / 2) * p, y = (A.y + A.h) * (1 - p) + B.y * p;
    ctx.fillStyle = HEX.accent; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // side panel
  ctx.fillStyle = '#1c1d1d'; ctx.fillRect(w - 58, 0, 58, h);
  for (let i = 0; i < 9; i++) { ctx.fillStyle = i === 2 ? HEX.teal : rgba(HEX.ink, 0.25); roundRect(ctx, w - 50, 12 + i * 15, 42 - (i % 3) * 8, 5, 2); ctx.fill(); }
}
function screenGraphTexture() {
  const nodes = [
    { x: 78, y: 12, w: 44, h: 26, col: HEX.teal },
    { x: 30, y: 62, w: 44, h: 26, col: HEX.accent }, { x: 90, y: 62, w: 44, h: 26, col: HEX.accent }, { x: 150, y: 62, w: 40, h: 26, col: HEX.teal },
    { x: 14, y: 116, w: 40, h: 26, col: HEX.muted }, { x: 62, y: 116, w: 40, h: 26, col: HEX.teal }, { x: 112, y: 116, w: 40, h: 26, col: HEX.muted }, { x: 160, y: 116, w: 34, h: 26, col: HEX.accent },
  ];
  const edges = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 6], [3, 7]];
  const state = { t: 0, acc: 0, nodes, edges };
  const tex = canvasTexture(256, 160, drawGraph, { state, mipmaps: false });
  tex.userData.tick = (dt) => { state.t += dt; state.acc += dt; if (state.acc < 0.08) return false; state.acc = 0; tex.userData.redraw(); return true; };
  return tex;
}

/* ---- lab: holographic readout panels (teal line art on a transparent canvas; `tick` animates them) ---- */
function holoPanelTexture(kind, seed = 3) {
  const r = rng(seed);
  const state = { t: 0, acc: 0, bars: Array.from({ length: 8 }, () => 0.3 + r() * 0.7), heights: Array.from({ length: 40 }, (_, i) => 0.35 + 0.3 * Math.sin(i * 0.5) + 0.15 * Math.sin(i * 1.7 + 1)) };
  const draw = (ctx, w, h, s) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = rgba(HEX.teal, 0.9); ctx.lineWidth = 2; roundRect(ctx, 2, 2, w - 4, h - 4, 6); ctx.stroke();
    ctx.fillStyle = rgba(HEX.teal, 0.12); ctx.fillRect(2, 2, w - 4, 22);
    ctx.font = `600 13px ${FONT_DISPLAY}`; ctx.fillStyle = HEX.teal; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(kind === 'terrain' ? 'WORLD · ELEVATION' : 'WORLD · TILES', 12, 13);
    ctx.textAlign = 'right'; ctx.fillStyle = HEX.accent;
    ctx.fillText(kind === 'terrain' ? `SEED ${20260910 + Math.floor(s.t)}` : `${Math.round(55 + 30 * Math.sin(s.t * 0.7))}%`, w - 12, 13);
    ctx.textAlign = 'left';
    ctx.strokeStyle = rgba(HEX.teal, 0.14); ctx.lineWidth = 1;
    for (let x = 12; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, h - 8); ctx.stroke(); }
    for (let y = 30; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(w - 6, y); ctx.stroke(); }
    if (kind === 'terrain') {
      // a scrolling elevation profile with a filled area and a sweeping cursor
      const off = Math.floor(s.t * 6);
      ctx.beginPath(); ctx.moveTo(10, h - 12);
      for (let i = 0; i < 40; i++) ctx.lineTo(10 + (i / 39) * (w - 20), h - 12 - s.heights[(i + off) % 40] * (h - 60));
      ctx.lineTo(w - 10, h - 12); ctx.closePath();
      ctx.fillStyle = rgba(HEX.teal, 0.22); ctx.fill();
      ctx.strokeStyle = HEX.teal; ctx.lineWidth = 2; ctx.stroke();
      const mx = 10 + ((s.t * 0.15) % 1) * (w - 20);
      ctx.strokeStyle = rgba(HEX.accent, 0.9); ctx.beginPath(); ctx.moveTo(mx, 30); ctx.lineTo(mx, h - 10); ctx.stroke();
    } else {
      // hex tiles, a few lit in turn, and a row of bars
      const R = 13;
      for (let row = 0; row < 4; row++) for (let col = 0; col < 7; col++) {
        const cx = 24 + col * R * 1.8 + (row % 2) * R * 0.9, cy = 44 + row * R * 1.6;
        const lit = ((row * 7 + col * 3 + Math.floor(s.t * 1.5)) % 9) === 0;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; const px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        ctx.closePath();
        ctx.fillStyle = lit ? rgba(HEX.accent, 0.75) : rgba(HEX.teal, 0.14); ctx.fill();
        ctx.strokeStyle = rgba(HEX.teal, 0.7); ctx.lineWidth = 1; ctx.stroke();
      }
      for (let i = 0; i < 8; i++) { const bh = s.bars[i] * 22 * (0.7 + 0.3 * Math.sin(s.t * 2 + i)); ctx.fillStyle = rgba(i % 3 === 1 ? HEX.accent : HEX.teal, 0.8); ctx.fillRect(14 + i * 28, h - 12 - bh, 18, bh); }
    }
    const sy = 26 + ((s.t * 0.35) % 1) * (h - 32);
    ctx.fillStyle = rgba(HEX.teal, 0.18); ctx.fillRect(4, sy, w - 8, 3);
  };
  const tex = canvasTexture(256, 160, draw, { state, mipmaps: false, usesText: true });
  tex.userData.tick = (dt) => { state.t += dt; state.acc += dt; if (state.acc < 0.125) return false; state.acc = 0; tex.userData.redraw(); return true; };
  return tex;
}

/* ---- framed art ---- */
function grain(ctx, w, h, r, n = 500) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1.5, 1.5); }
}
function paintingTexture(kind, seed = 7) {
  const portrait = kind === 'peaks';
  const W = portrait ? 192 : 256, H = portrait ? 256 : 192;
  return canvasTexture(W, H, (ctx, w, h) => {
    const r = rng(seed);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    if (kind === 'sunset') { sky.addColorStop(0, '#1a1c22'); sky.addColorStop(0.45, '#c8642e'); sky.addColorStop(0.62, '#f3a65a'); sky.addColorStop(1, '#2a1a12'); }
    else if (kind === 'planet') { sky.addColorStop(0, '#07181c'); sky.addColorStop(0.7, '#1d5c5c'); sky.addColorStop(1, '#3ec6c0'); }
    else if (kind === 'island') { sky.addColorStop(0, '#26323a'); sky.addColorStop(0.55, '#a5b6b3'); sky.addColorStop(0.75, '#f3a65a'); sky.addColorStop(1, '#4a2c1c'); }
    else { sky.addColorStop(0, '#0f2426'); sky.addColorStop(0.5, '#2f7a78'); sky.addColorStop(1, '#0b1516'); }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (kind === 'sunset') {
      ctx.fillStyle = HEX.accent; ctx.beginPath(); ctx.arc(w * 0.55, h * 0.55, h * 0.16, 0, Math.PI * 2); ctx.fill();
      const ridge = (yb, amp, col, off) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += 8) ctx.lineTo(x, yb - amp * Math.abs(Math.sin(x * 0.03 + off)) - amp * 0.5 * Math.sin(x * 0.11 + off)); ctx.lineTo(w, h); ctx.fill(); };
      ridge(h * 0.62, 40, '#4a2418', 0.4); ridge(h * 0.75, 30, '#2a140e', 2.2); ridge(h * 0.9, 14, '#16100c', 5);
    } else if (kind === 'planet') {
      ctx.fillStyle = '#0b1c1f'; ctx.beginPath(); ctx.arc(w * 0.66, h * 0.32, h * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(HEX.teal, 0.8); ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(w * 0.66, h * 0.32, h * 0.46, h * 0.1, -0.35, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#071011'; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * 0.7); ctx.lineTo(w * 0.2, h * 0.5); ctx.lineTo(w * 0.35, h * 0.72); ctx.lineTo(w * 0.5, h * 0.6); ctx.lineTo(w * 0.75, h * 0.82); ctx.lineTo(w, h * 0.7); ctx.lineTo(w, h); ctx.fill();
      ctx.fillStyle = HEX.accent; ctx.fillRect(w * 0.49, h * 0.58, 3, 8);
    } else if (kind === 'island') {
      ctx.fillStyle = '#1f2a2c'; ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.42); ctx.lineTo(w * 0.7, h * 0.4); ctx.lineTo(w * 0.62, h * 0.62); ctx.lineTo(w * 0.5, h * 0.78); ctx.lineTo(w * 0.36, h * 0.6); ctx.fill();
      ctx.fillStyle = '#3f6b3c'; ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.42); ctx.lineTo(w * 0.7, h * 0.4); ctx.lineTo(w * 0.66, h * 0.46); ctx.lineTo(w * 0.34, h * 0.48); ctx.fill();
      ctx.fillStyle = HEX.accent; ctx.fillRect(w * 0.5, h * 0.3, 4, h * 0.12); ctx.fillStyle = '#f2f1ec'; ctx.beginPath(); ctx.arc(w * 0.52, h * 0.28, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      const ridge = (yb, amp, col, off) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += 8) ctx.lineTo(x, yb - amp * Math.abs(Math.sin(x * 0.04 + off)) - amp * 0.4 * Math.sin(x * 0.15 + off)); ctx.lineTo(w, h); ctx.fill(); };
      ridge(h * 0.55, 60, '#1b4a4a', 1); ridge(h * 0.7, 50, '#113436', 2.6); ridge(h * 0.86, 30, '#0a1f21', 4.2);
      ctx.fillStyle = HEX.accent; ctx.beginPath(); ctx.arc(w * 0.3, h * 0.28, 9, 0, Math.PI * 2); ctx.fill();
    }
    grain(ctx, w, h, r);
  });
}

/* ---- open book pages ---- */
function drawPage(ctx, w, h, s) {
  const paper = ctx.createLinearGradient(s.side === 'r' ? 0 : w, 0, s.side === 'r' ? w * 0.4 : w * 0.6, 0);
  paper.addColorStop(0, '#d9cfb9'); paper.addColorStop(1, '#f1e9d6');
  ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
  const r = rng(s.side === 'r' ? 11 : 23);
  const m = 22, right = w - m;
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  let y = 40;
  if (s.side === 'r') {
    ctx.fillStyle = HEX.accent; roundRect(ctx, m, 26, w - 2 * m, 74, 6); ctx.fill();
    ctx.fillStyle = HEX.panel; ctx.font = `bold 24px ${FONT_ARABIC}`; ctx.fillText('من الفكرة، إلى اللاعب', right - 10, 60);
    ctx.font = `15px ${FONT_ARABIC}`; ctx.fillText('مختصر تصميم الألعاب', right - 10, 86);
    y = 130;
  } else {
    ctx.fillStyle = HEX.teal; ctx.fillRect(right - 40, 30, 40, 3);
    ctx.fillStyle = HEX.panel; ctx.font = `bold 15px ${FONT_ARABIC}`; ctx.fillText('الميكانيكيات', right, 56);
    y = 78;
  }
  ctx.strokeStyle = rgba(HEX.panel, 0.55); ctx.lineWidth = 3; ctx.lineCap = 'round';
  const lines = (from, to) => {
    for (let yy = from; yy < to; ) {
      const last = r() < 0.22; const len = (w - 2 * m) * (last ? 0.3 + r() * 0.4 : 0.8 + r() * 0.2);
      ctx.beginPath(); ctx.moveTo(right, yy); ctx.lineTo(right - len, yy); ctx.stroke();
      yy += last ? 21 : 13;
    }
  };
  if (s.side === 'r') lines(y, h - 60);
  else { lines(y, 132); lines(216, h - 60); }
  if (s.side === 'l') {
    // small loop diagram
    const cx = w / 2, cy = 172; ctx.lineWidth = 2; ctx.strokeStyle = HEX.teal;
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0.2, Math.PI * 2 - 0.4); ctx.stroke();
    ctx.fillStyle = HEX.teal; ctx.beginPath(); ctx.moveTo(cx + 26, cy - 14); ctx.lineTo(cx + 32, cy - 2); ctx.lineTo(cx + 20, cy - 4); ctx.fill();
    [[-60, 0], [60, 0]].forEach(([dx]) => { ctx.fillStyle = HEX.accent; roundRect(ctx, cx + dx - 16, cy - 9, 32, 18, 4); ctx.fill(); });
    ctx.strokeStyle = rgba(HEX.panel, 0.5); ctx.beginPath(); ctx.moveTo(cx - 44, cy); ctx.lineTo(cx - 28, cy); ctx.moveTo(cx + 28, cy); ctx.lineTo(cx + 44, cy); ctx.stroke();
  }
  // RTL spread: the right-hand page carries the lower number
  ctx.direction = 'ltr'; ctx.textAlign = 'center'; ctx.fillStyle = rgba(HEX.panel, 0.45); ctx.font = `11px ${FONT_ARABIC}`;
  ctx.fillText(s.side === 'r' ? '٢٢' : '٢٣', w / 2, h - 18);
  // spine shadow
  const sh = ctx.createLinearGradient(s.side === 'r' ? 0 : w, 0, s.side === 'r' ? 40 : w - 40, 0);
  sh.addColorStop(0, 'rgba(60,40,20,.35)'); sh.addColorStop(1, 'rgba(60,40,20,0)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, w, h);
}
const bookPageTexture = (side) => canvasTexture(256, 352, drawPage, { state: { side }, usesText: true, anisotropy: 4 });

/* ---- playing cards ---- */
const SUIT = { s: { g: '♠', red: false }, h: { g: '♥', red: true }, d: { g: '♦', red: true }, c: { g: '♣', red: false } };
const RED = '#e5893a';
function drawCardFace(ctx, w, h, s) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 0, 0, w, h, 22); ctx.fillStyle = HEX.ink; ctx.fill();
  ctx.strokeStyle = rgba(HEX.panel, 0.18); ctx.lineWidth = 2; roundRect(ctx, 10, 10, w - 20, h - 20, 14); ctx.stroke();
  const suit = SUIT[s.suit], col = suit.red ? RED : HEX.panel;
  const corner = () => {
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${s.rank === '10' ? 34 : 40}px ${FONT_DISPLAY}`; ctx.fillText(s.rank, 34, 44);
    ctx.font = `30px ${FONT_BODY}`; ctx.fillText(suit.g, 34, 80);
  };
  corner();
  ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); corner(); ctx.restore();
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (s.rank === 'A') {
    ctx.strokeStyle = HEX.teal; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(w / 2, h / 2, 74, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = rgba(HEX.teal, 0.35); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(w / 2, h / 2, 86, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col; ctx.font = `120px ${FONT_BODY}`; ctx.fillText(suit.g, w / 2, h / 2 + 4);
  } else if (s.rank === '10') {
    ctx.font = `36px ${FONT_BODY}`;
    const cols = [86, 170], rows = [96, 152, 208, 264];
    for (const x of cols) for (const y of rows) ctx.fillText(suit.g, x, y);
    ctx.fillText(suit.g, w / 2, 124); ctx.fillText(suit.g, w / 2, 236);
  } else {
    // court card: glyph-only centre motif (no tinted panel — a panel edge peeking from behind the next
    // card in a fan reads as a stray box, whereas part of a crown reads as a court illustration)
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = col;
    if (s.rank === 'K') {
      ctx.beginPath(); ctx.moveTo(cx - 40, cy - 4); ctx.lineTo(cx - 40, cy - 40); ctx.lineTo(cx - 18, cy - 18); ctx.lineTo(cx, cy - 54); ctx.lineTo(cx + 18, cy - 18); ctx.lineTo(cx + 40, cy - 40); ctx.lineTo(cx + 40, cy - 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = HEX.teal; [cx - 40, cx, cx + 40].forEach((x, i) => { ctx.beginPath(); ctx.arc(x, cy - (i === 1 ? 58 : 44), 4, 0, Math.PI * 2); ctx.fill(); });
    } else if (s.rank === 'Q') {
      ctx.beginPath(); ctx.arc(cx, cy - 10, 38, Math.PI, 0); ctx.lineTo(cx + 38, cy + 2); ctx.lineTo(cx - 38, cy + 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = HEX.teal; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(cx + i * 17, cy - 44 + Math.abs(i) * 8, 3.5, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.beginPath(); ctx.moveTo(cx - 30, cy - 46); ctx.lineTo(cx + 30, cy - 46); ctx.lineTo(cx + 30, cy - 30); ctx.lineTo(cx - 8, cy - 30); ctx.lineTo(cx - 8, cy + 2); ctx.lineTo(cx - 30, cy + 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = HEX.teal; ctx.beginPath(); ctx.moveTo(cx + 12, cy - 22); ctx.lineTo(cx + 34, cy - 4); ctx.lineTo(cx + 12, cy + 2); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = rgba(HEX.teal, 0.8); roundRect(ctx, cx - 22, cy + 8, 44, 3, 1.5); ctx.fill();
    ctx.fillStyle = col; ctx.font = `bold 28px ${FONT_DISPLAY}`; ctx.fillText(s.rank, cx, cy + 32);
    ctx.font = `24px ${FONT_BODY}`; ctx.fillText(suit.g, cx, cy + 60);
  }
}
const cardFaceTexture = (rank, suit) => canvasTexture(256, 360, drawCardFace, { state: { rank, suit }, usesText: true, anisotropy: 4 });
function drawCardBack(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 0, 0, w, h, 22); ctx.fillStyle = HEX.panel; ctx.fill();
  ctx.save(); roundRect(ctx, 14, 14, w - 28, h - 28, 12); ctx.clip();
  ctx.fillStyle = '#202222'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba(HEX.teal, 0.28); ctx.lineWidth = 1.5;
  for (let d = -h; d < w + h; d += 18) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + h, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(d + h, 0); ctx.lineTo(d, h); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = HEX.accent; ctx.lineWidth = 2; roundRect(ctx, 14, 14, w - 28, h - 28, 12); ctx.stroke();
  ctx.fillStyle = HEX.panel; ctx.beginPath(); ctx.arc(w / 2, h / 2, 46, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = HEX.accent; ctx.beginPath(); ctx.arc(w / 2, h / 2, 46, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = HEX.accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `48px ${FONT_BODY}`; ctx.fillText('♠', w / 2, h / 2 + 3);
}
const cardBackTexture = () => canvasTexture(256, 360, drawCardBack, { usesText: true, anisotropy: 4 });

/* ---- poker chips: gold / black / orange (contract palette); the black chip keeps teal edge dashes ---- */
const chipPalette = () => [chipTextures(GOLD, HEX.panel), chipTextures(HEX.panel, HEX.teal), chipTextures(HEX.accent)];
function chipTextures(base, dash = HEX.ink) {
  const face = canvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2, R = w / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = base; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dash; ctx.lineWidth = R * 0.16; ctx.lineCap = 'butt';
    for (let k = 0; k < 8; k++) { const a0 = ((k + 0.25) / 8) * Math.PI * 2 - Math.PI / 2, a1 = ((k + 0.75) / 8) * Math.PI * 2 - Math.PI / 2; ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, a0, a1); ctx.stroke(); }
    ctx.strokeStyle = rgba(dash, 0.35); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R * 0.78, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(dash, 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.stroke();
    // symmetric emblem (cylinder cap UVs are mirrored, so no glyphs here): diamond + four dots
    ctx.fillStyle = dash; ctx.beginPath(); ctx.moveTo(cx, cy - R * 0.3); ctx.lineTo(cx + R * 0.19, cy); ctx.lineTo(cx, cy + R * 0.3); ctx.lineTo(cx - R * 0.19, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = base; ctx.beginPath(); ctx.moveTo(cx, cy - R * 0.14); ctx.lineTo(cx + R * 0.09, cy); ctx.lineTo(cx, cy + R * 0.14); ctx.lineTo(cx - R * 0.09, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(dash, 0.8); for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 0.44, cy + Math.sin(a) * R * 0.44, R * 0.035, 0, Math.PI * 2); ctx.fill(); }
  }, { anisotropy: 4 });
  const side = canvasTexture(512, 32, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = dash; for (let k = 0; k < 8; k++) ctx.fillRect(((k + 0.25) / 8) * w, 0, w / 16, h);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, 0, w, 3); ctx.fillRect(0, h - 3, w, 3);
  }, { mipmaps: true });
  return { face, side };
}

/* ---- soft contact shadow blob ---- */
const blobTexture = () => canvasTexture(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.6, 'rgba(0,0,0,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}, { mipmaps: false });
/* ───────────────────────────── hotspot labels ───────────────────────────── */

const COMPACT_W = 560; // canvas CSS width below which labels collapse to numbered dots
const LABEL_PAD = 4;   // keep-inside padding from the canvas edge (px)
const LABEL_GAP = 6;   // minimum breathing room between two labels (px)

function createLabels(labelLayer, hotspots, anchorFor, reducedMotion) {
  const labels = [];
  if (!labelLayer || !Array.isArray(hotspots)) return labels;
  for (const h of hotspots) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hotspot';
    btn.dataset.target = h.target; btn.dataset.id = h.id;
    btn.setAttribute('aria-label', `${h.number ?? ''} ${h.label ?? ''}`.trim());
    const dot = document.createElement('span'); dot.className = 'hotspot__dot'; dot.textContent = h.number;
    const lab = document.createElement('b'); lab.className = 'hotspot__label'; lab.textContent = `${h.label} `;
    const arrow = document.createElement('i'); arrow.innerHTML = '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="1em" height="1em" style="vertical-align:-.12em;flex:none" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>'; arrow.setAttribute('aria-hidden', 'true'); // SVG, not a glyph: ↗ renders as an emoji on phones
    lab.appendChild(arrow);
    btn.append(dot, lab);
    Object.assign(btn.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'auto', willChange: 'transform', opacity: '0' });
    btn.addEventListener('click', () => {
      if (h.target && !h.target.startsWith('#')) { location.assign(h.target); return; } // a marker can open another page
      const el = h.target ? document.querySelector(h.target) : null;
      el?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    });
    const L = {
      el: btn, lab, anchor: anchorFor(h.id), lastT: '', lastO: '0',
      w: 0, h: 0, measure: true,          // measured button box (re-measured on resize / fonts / mode change)
      ax: 0, ay: 0, tx: 0, ty: 0,         // projected anchor, solved target
      ox: 0, oy: 0, inside: false,        // smoothed offset from the anchor
      compact: false, hover: false, focus: false,
    };
    // Compact mode: the pill is hidden unless the button is hovered (mouse) or focused (keyboard).
    L.applyMode = () => {
      const d = (L.compact && !L.hover && !L.focus) ? 'none' : '';
      if (lab.style.display !== d) { lab.style.display = d; L.measure = true; }
    };
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') { L.hover = true; L.applyMode(); } });
    btn.addEventListener('pointerleave', () => { L.hover = false; L.applyMode(); });
    btn.addEventListener('focus', () => { L.focus = true; L.applyMode(); });
    btn.addEventListener('blur', () => { L.focus = false; L.applyMode(); });
    labelLayer.appendChild(btn);
    labels.push(L);
  }
  return labels;
}

const _lp = new THREE.Vector3();
/**
 * Projects every anchor, then keeps the buttons inside the canvas and pushes overlapping ones apart
 * (vertically when that is the cheaper move). The resulting offset is smoothed over time so parallax
 * never makes labels jitter; with dt = 0 (still frame) it is applied immediately.
 */
function updateLabels(labels, layer, camera, size, alpha, dt) {
  const n = labels.length;
  if (!n) return;
  const compact = size.w < COMPACT_W;
  if (layer && layer.__sceneCompact !== compact) { layer.__sceneCompact = compact; layer.classList.toggle('is-compact', compact); }
  for (const L of labels) {
    if (L.compact !== compact) { L.compact = compact; L.el.classList.toggle('hotspot--compact', compact); L.applyMode(); }
    L.anchor.getWorldPosition(_lp).project(camera);
    L.inside = _lp.z < 1 && _lp.x >= -1 && _lp.x <= 1 && _lp.y >= -1 && _lp.y <= 1;
    L.ax = ((_lp.x + 1) / 2) * size.w; L.ay = ((1 - _lp.y) / 2) * size.h;
    if (L.measure) { L.measure = false; L.w = L.el.offsetWidth || L.w; L.h = L.el.offsetHeight || L.h; }
    L.tx = L.ax; L.ty = L.ay;
  }
  const keepInside = () => {
    for (const L of labels) {
      if (!L.inside) continue;
      const hw = L.w / 2 + LABEL_PAD, hh = L.h / 2 + LABEL_PAD;
      if (size.w > 2 * hw) L.tx = clamp(L.tx, hw, size.w - hw);
      if (size.h > 2 * hh) L.ty = clamp(L.ty, hh, size.h - hh);
    }
  };
  keepInside();
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const A = labels[i]; if (!A.inside) continue;
      for (let j = i + 1; j < n; j++) {
        const B = labels[j]; if (!B.inside) continue;
        const px = (A.w + B.w) / 2 + LABEL_GAP - Math.abs(B.tx - A.tx);
        const py = (A.h + B.h) / 2 + LABEL_GAP - Math.abs(B.ty - A.ty);
        if (px <= 0 || py <= 0) continue;
        moved = true;
        // direction comes from the anchors (stable), magnitude from the current penetration
        if (py <= px) { const s = (Math.sign(B.ay - A.ay) || 1) * py / 2; A.ty -= s; B.ty += s; }
        else { const s = (Math.sign(B.ax - A.ax) || 1) * px / 2; A.tx -= s; B.tx += s; }
      }
    }
    if (!moved) break;
    keepInside();
  }
  const k = dt > 0 ? damp(0.22, dt) : 1;
  for (const L of labels) {
    const o = L.inside ? (alpha >= 1 ? '' : String(alpha.toFixed(3))) : '0';
    if (o !== L.lastO) { L.lastO = o; L.el.style.opacity = o; }
    if (!L.inside) continue;
    L.ox += (L.tx - L.ax - L.ox) * k; L.oy += (L.ty - L.ay - L.oy) * k;
    const x = L.ax + L.ox, y = L.ay + L.oy;
    const t = `translate(-50%,-50%) translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    if (t !== L.lastT) { L.lastT = t; L.el.style.transform = t; }
  }
}

/* ───────────────────────────── draw-call batching ───────────────────────────── */

/**
 * Merges direct-child meshes of every group that share (material, castShadow, receiveShadow) into a
 * single Mesh with one baked BufferGeometry. Groups are recursed so per-group intro/idle animation is
 * preserved; multi-material meshes, meshes with children and `userData.noMerge` meshes are left alone.
 * Must run before the first render (the replaced geometries are never uploaded). Geometries that no
 * remaining mesh references are disposed.
 */
function mergeStaticMeshes(root) {
  const dropped = new Set();
  const visit = (node) => {
    const buckets = new Map();
    for (const o of node.children.slice()) {
      if (o.isMesh) {
        if (Array.isArray(o.material) || o.children.length || o.userData.noMerge || !o.geometry?.attributes?.position) continue;
        const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}`;
        let list = buckets.get(key); if (!list) buckets.set(key, (list = []));
        list.push(o);
      } else if (!o.isLight && o.children.length && !o.userData.noMerge) visit(o); // noMerge groups (the embedded turntable) are pre-merged
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const parts = list.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!merged) continue;
      const first = list[0];
      const mesh = new THREE.Mesh(merged, first.material);
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      node.add(mesh);
      for (const m of list) { node.remove(m); dropped.add(m.geometry); }
    }
  };
  visit(root);
  const live = new Set();
  root.traverse((o) => { if (o.geometry) live.add(o.geometry); });
  for (const g of dropped) if (!live.has(g)) g.dispose();
}

/* ───────────────────────────── studio scene ───────────────────────────── */

const BOOK_COLORS =['#f3a65a', '#3ec6c0', '#c8553d', '#e9dcc0', '#8a9aa8', '#d9b26a', '#5f7a63', '#b9b0a2', '#f2f1ec', '#7c5cbf', '#2f6f6b'];

/**
 * Builds the studio room into `rig.scene`. Returns { anchors, update(dt,t), dispose() }.
 */
function buildStudio(rig) {
  const { scene, tweens, reducedMotion } = rig;
  const r = rng(20260910);

  /* ---- shared geometry ---- */
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    plane: new THREE.PlaneGeometry(1, 1),
    sphere: new THREE.SphereGeometry(1, 12, 9),
    cyl: (rad, h, seg = 20, rb = rad) => new THREE.CylinderGeometry(rad, rb, h, seg),
  };

  /* ---- materials ---- */
  const floorTex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3a3b3a'; ctx.fillRect(0, 0, w, h);
    const rr = rng(5);
    // per-tile tonal variation so the floor reads as stone, not a flat slab
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) { ctx.fillStyle = `rgba(${rr() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rr() * 0.05})`; ctx.fillRect((tx / 8) * w, (ty / 8) * h, w / 8, h / 8); }
    for (let i = 0; i < 1600; i++) { ctx.fillStyle = `rgba(255,255,255,${0.01 + rr() * 0.05})`; ctx.fillRect(rr() * w, rr() * h, 2, 2); }
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { const p = (i / 8) * w; ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke(); }
  }, { anisotropy: 4 });
  // concrete grain + faint formwork seams; tinted per wall through material.color
  const wallTex = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5a5b59'; ctx.fillRect(0, 0, w, h);
    const rr = rng(9);
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(${rr() < 0.55 ? '0,0,0' : '255,255,255'},${0.02 + rr() * 0.06})`; ctx.fillRect(rr() * w, rr() * h, 1 + rr() * 2, 1 + rr() * 2); }
    for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(0,0,0,${0.03 + rr() * 0.05})`; ctx.fillRect(rr() * w, rr() * h, 20 + rr() * 90, 8 + rr() * 30); }
    ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 2;
    for (const y of [h * 0.34, h * 0.67]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (const x of [w * 0.25, w * 0.5, w * 0.75]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; for (const y of [h * 0.34 + 2, h * 0.67 + 2]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }, { anisotropy: 4, wrap: THREE.RepeatWrapping });
  wallTex.repeat.set(2, 1);
  // woven rug with a double border (amber + teal) so it separates from the floor
  const rugTex = canvasTexture(512, 384, (ctx, w, h) => {
    ctx.fillStyle = '#413b35'; ctx.fillRect(0, 0, w, h);
    const rr = rng(13);
    for (let y = 0; y < h; y += 3) { ctx.fillStyle = `rgba(0,0,0,${0.05 + rr() * 0.08})`; ctx.fillRect(0, y, w, 1); }
    for (let i = 0; i < 1800; i++) { ctx.fillStyle = `rgba(255,255,255,${0.02 + rr() * 0.05})`; ctx.fillRect(rr() * w, rr() * h, 2, 1); }
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(243,166,90,.55)'; ctx.strokeRect(22, 22, w - 44, h - 44);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(62,198,192,.55)'; ctx.strokeRect(36, 36, w - 72, h - 72);
    ctx.strokeStyle = 'rgba(243,166,90,.35)'; ctx.strokeRect(46, 46, w - 92, h - 92);
    // quiet centre medallion: a single lozenge outline
    ctx.strokeStyle = 'rgba(243,166,90,.28)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2, h / 2 - 54); ctx.lineTo(w / 2 + 96, h / 2); ctx.lineTo(w / 2, h / 2 + 54); ctx.lineTo(w / 2 - 96, h / 2); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = 'rgba(62,198,192,.22)';
    ctx.beginPath(); ctx.moveTo(w / 2, h / 2 - 36); ctx.lineTo(w / 2 + 64, h / 2); ctx.lineTo(w / 2, h / 2 + 36); ctx.lineTo(w / 2 - 64, h / 2); ctx.closePath(); ctx.stroke();
  }, { anisotropy: 4 });
  const M = {
    floor: std(0xffffff, { map: floorTex, roughness: 0.92 }),
    slab: std(0x222323, { roughness: 1 }),
    wallBack: std(0x8e8f8c, { map: wallTex, roughness: 1 }),
    wallLeft: std(0x7c7d7a, { map: wallTex, roughness: 1 }),
    rug: std(0xffffff, { map: rugTex, roughness: 1 }),
    wood: std(C.wood, { roughness: 0.62 }),
    woodDark: std(0x4a3320, { roughness: 0.7 }),
    charcoal: std(0x232525, { roughness: 0.8 }),
    charcoal2: std(0x303232, { roughness: 0.85 }),
    black: std(0x111212, { roughness: 0.6 }),
    ink: std(C.ink, { roughness: 0.55 }),
    muted: std(C.muted, { roughness: 0.7 }),
    accent: std(C.accent, { roughness: 0.75 }),
    tealCloth: std(0x2f7f7b, { roughness: 0.9 }),
    brass: std(0xb08a4a, { roughness: 0.4, metalness: 0.6 }),
    green: std(0x3f6b3c, { roughness: 0.9 }),
    green2: std(0x5b8a4a, { roughness: 0.9 }),
    green3: std(0x2e5230, { roughness: 0.9 }),
    pot: std(0x2a2a2a, { roughness: 0.9 }),
    soil: std(0x1a1410, { roughness: 1 }),
    paper: std(0xefe6d3, { roughness: 0.9 }),
    led: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.accent, emissiveIntensity: 2.2, roughness: 1 }),
    ledTeal: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.teal, emissiveIntensity: 1.6, roughness: 1 }),
    bulb: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd08a, emissiveIntensity: 3, roughness: 1 }),
    // lab bay: brushed metal, glass, and additive "light" materials for the hologram
    metal: std(0x2b2e30, { roughness: 0.42, metalness: 0.75 }),
    metal2: std(0x474b4e, { roughness: 0.5, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: C.teal, transparent: true, opacity: 0.22, roughness: 0.15, metalness: 0.1, emissive: 0x0f4b49, emissiveIntensity: 0.8, depthWrite: false }),
    holoCone: new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    holoWire: new THREE.MeshBasicMaterial({ color: C.teal, wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    holoCore: new THREE.MeshBasicMaterial({ color: 0x0d4744, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
    holoLine: new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    holoAmberLine: new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    holoAmber: new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    holoRock: new THREE.MeshBasicMaterial({ color: 0x1d7f7a, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
    holoWater: new THREE.MeshBasicMaterial({ color: 0x2ea8c9, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    holoLand: new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    holoPeak: new THREE.MeshBasicMaterial({ color: 0xf2f1ec, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  const bookMats = BOOK_COLORS.map((c) => std(new THREE.Color(c), { roughness: 0.8 }));

  /* ---- helpers ---- */
  const intro = [];
  function group(x, y, z, delay, opts = {}) {
    const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
    intro.push({ g, delay, rise: opts.rise ?? 0.6, scale: opts.scale ?? true, base: y });
    return g;
  }
  function box(parent, mat, w, h, d, x, yb, z, o = {}) {
    const m = new THREE.Mesh(G.box, mat); m.scale.set(w, h, d); m.position.set(x, yb + h / 2, z);
    if (o.ry) m.rotation.y = o.ry; if (o.rx) m.rotation.x = o.rx; if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.cast !== false; parent.add(m); return m;
  }
  function cyl(parent, mat, rad, h, x, yb, z, seg = 20, rb = rad) {
    const m = new THREE.Mesh(G.cyl(rad, h, seg, rb), mat); m.position.set(x, yb + h / 2, z); m.castShadow = true; parent.add(m); return m;
  }
  function sphere(parent, mat, rad, x, y, z, sy = 1) {
    const m = new THREE.Mesh(G.sphere, mat); m.scale.set(rad, rad * sy, rad); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  }
  const anchors = {};
  const anchor = (id, parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); anchors[id] = o; return o; };
  const textTextures = [];

  /* ---- room (floor x −6.0…3.9, z −5.0…3.7: a metre was added on the left for the lab bay, the empty right side was trimmed) ---- */
  const room = group(0, 0, 0, 0, { rise: 1.4, scale: false });
  const floor = box(room, M.floor, 9.9, 0.35, 8.7, -1.05, -0.35, -0.65, { cast: false }); floor.receiveShadow = true;
  box(room, M.slab, 10.3, 0.12, 9.1, -1.05, -0.47, -0.65, { cast: false });
  const wallB = box(room, M.wallBack, 10.1, 4.4, 0.3, -1.15, 0, -5.05, { cast: false }); wallB.receiveShadow = true;
  const wallL = box(room, M.wallLeft, 0.3, 4.4, 8.9, -6.05, 0, -0.75, { cast: false }); wallL.receiveShadow = true;
  const rug = box(room, M.rug, 5.2, 0.03, 3.8, 0.4, 0, -0.2, { cast: false }); rug.receiveShadow = true;
  // wood slat feature panel on the back wall (right side) with a warm strip behind it
  for (let i = 0; i < 7; i++) box(room, M.woodDark, 0.09, 3.6, 0.08, 2.65 + i * 0.17, 0.3, -4.86, { cast: false });
  box(room, M.led, 0.04, 3.4, 0.04, 2.56, 0.4, -4.84, { cast: false });
  box(room, M.led, 0.04, 3.4, 0.04, 3.76, 0.4, -4.84, { cast: false });

  /* ---- framed art ---- */
  function frame(parent, x, y, z, w, h, kind, ry = 0, delay = 0.45) {
    const g = group(x, y, z, delay, { rise: 0.3 });
    g.rotation.y = ry;
    box(g, M.black, w + 0.1, h + 0.1, 0.05, 0, -h / 2 - 0.05, 0.025, { cast: false });
    const tex = paintingTexture(kind, kind.length * 13);
    const pm = new THREE.Mesh(G.plane, std(0xffffff, { map: tex, roughness: 0.9 }));
    pm.scale.set(w, h, 1); pm.position.set(0, 0, 0.055); g.add(pm);
    return g;
  }
  frame(room, -1.45, 3.35, -4.9, 1.05, 0.78, 'island', 0, 0.5);
  frame(room, 0.3, 3.4, -4.9, 1.35, 0.98, 'sunset', 0, 0.55);
  frame(room, 2.05, 3.35, -4.9, 1.05, 0.78, 'planet', 0, 0.6);
  frame(room, -5.9, 3.0, 1.0, 0.8, 1.05, 'peaks', Math.PI / 2, 0.55);
  frame(room, -5.9, 2.75, 2.75, 1.25, 0.85, 'sunset', Math.PI / 2, 0.6);

  /* ---- desk ---- */
  const desk = group(0.3, 0, -3.65, 0.12);
  box(desk, M.wood, 4.7, 0.1, 1.5, 0, 1.36, 0);
  box(desk, M.charcoal, 0.62, 1.36, 1.3, -1.7, 0, 0);
  box(desk, M.charcoal, 0.62, 1.36, 1.3, 1.7, 0, 0);
  for (const px of [-1.7, 1.7]) for (const py of [0.35, 0.75, 1.15]) box(desk, M.muted, 0.26, 0.02, 0.02, px, py, 0.66, { cast: false });
  box(desk, M.led, 4.3, 0.025, 0.03, 0, 1.33, 0.7, { cast: false });
  // keyboard, mouse, mug, notebook
  box(desk, M.charcoal2, 1.0, 0.035, 0.3, 0.05, 1.41, 0.4);
  box(desk, M.led, 0.94, 0.008, 0.015, 0.05, 1.445, 0.26, { cast: false });
  box(desk, M.charcoal2, 0.1, 0.045, 0.16, 0.85, 1.41, 0.42);
  box(desk, M.charcoal2, 0.28, 0.02, 0.36, -0.75, 1.41, 0.38);
  cyl(desk, M.ink, 0.07, 0.17, -1.15, 1.41, 0.3, 16);
  // speakers
  for (const sx of [-2.1, 2.1]) { box(desk, M.charcoal, 0.2, 0.32, 0.2, sx, 1.41, -0.25); const d = cyl(desk, M.ledTeal, 0.05, 0.02, sx, 1.55, -0.14, 12); d.rotation.x = Math.PI / 2; }
  // VR headset
  const vr = new THREE.Group(); vr.position.set(1.35, 1.6, 0.25); vr.rotation.y = -0.5; desk.add(vr);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 10, 28), M.ink); strap.rotation.x = Math.PI / 2; strap.castShadow = true; vr.add(strap);
  box(vr, M.ink, 0.3, 0.14, 0.14, 0, -0.07, 0.14);
  box(vr, M.black, 0.28, 0.1, 0.02, 0, -0.05, 0.215, { cast: false });
  box(vr, M.ledTeal, 0.2, 0.012, 0.012, 0, -0.03, 0.222, { cast: false });
  // monitors
  const screens = [];
  function monitor(x, yc, z, w, h, ry, tex, delay) {
    const g = group(desk.position.x + x, 1.46, desk.position.z + z, delay, { rise: 0.35 });
    g.rotation.y = ry;
    const bezel = box(g, M.charcoal, w + 0.06, h + 0.06, 0.05, 0, yc - h / 2 - 0.03 - 1.46, 0);
    bezel.castShadow = false;
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.38, roughness: 0.3, metalness: 0 });
    const s = new THREE.Mesh(G.plane, mat); s.scale.set(w, h, 1); s.position.set(0, yc - 1.46, 0.027); g.add(s);
    cyl(g, M.charcoal, 0.035, yc - h / 2 - 1.46 - 0.03, 0, 0.0, -0.02, 10);
    box(g, M.charcoal, 0.4, 0.025, 0.22, 0, 0, -0.02);
    screens.push({ mat, tex, phase: r() * 10 });
    return g;
  }
  monitor(0, 2.14, -0.15, 1.8, 1.0, 0, screenGameTexture(), 0.32);
  monitor(-1.72, 2.02, 0.08, 1.3, 0.76, 0.36, screenCodeTexture(3), 0.38);
  monitor(1.72, 2.02, 0.08, 1.3, 0.76, -0.36, screenGraphTexture(), 0.44);
  anchor('work', desk, 0, 3.0, -0.1);
  anchor('tech', desk, 2.05, 1.55, 0.55);   // the node-graph monitor: the technical breakdowns page
  // lamp
  const lamp = group(-1.7, 1.46, -3.95, 0.4, { rise: 0.4 });
  cyl(lamp, M.brass, 0.13, 0.03, 0, 0, 0, 20);
  cyl(lamp, M.brass, 0.018, 0.95, 0, 0.03, 0, 8);
  const arm = box(lamp, M.brass, 0.55, 0.025, 0.025, 0.22, 0.96, 0.1, { ry: -0.35 });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.24, 18, 1, true), new THREE.MeshStandardMaterial({ color: C.panel, roughness: 0.8, side: THREE.DoubleSide }));
  shade.position.set(0.5, 0.9, 0.2); shade.rotation.set(0.25, 0, 0.3); shade.castShadow = true; lamp.add(shade);
  const bulb = sphere(lamp, M.bulb, 0.045, 0.5, 0.82, 0.2); bulb.castShadow = false;
  const lampLight = new THREE.PointLight(C.accent, 9, 8, 2); lampLight.position.set(0.5, 0.78, 0.25); lamp.add(lampLight);
  arm.castShadow = false;

  /* ---- chair ---- */
  const chair = group(0.35, 0, -2.3, 0.3);
  chair.rotation.y = 0.28;
  cyl(chair, M.charcoal, 0.34, 0.05, 0, 0, 0, 20);
  for (let i = 0; i < 5; i++) { const b = box(chair, M.charcoal, 0.3, 0.04, 0.06, 0, 0.02, 0); b.rotation.y = (i / 5) * Math.PI * 2; b.position.x = Math.cos((i / 5) * Math.PI * 2) * 0.18; b.position.z = -Math.sin((i / 5) * Math.PI * 2) * 0.18; }
  cyl(chair, M.muted, 0.035, 0.42, 0, 0.05, 0, 10);
  box(chair, M.charcoal2, 0.62, 0.1, 0.6, 0, 0.47, 0);
  box(chair, M.charcoal2, 0.58, 0.74, 0.09, 0, 0.57, 0.28);
  box(chair, M.accent, 0.5, 0.06, 0.03, 0, 0.9, 0.325, { cast: false });
  for (const ax of [-0.33, 0.33]) box(chair, M.charcoal, 0.06, 0.05, 0.36, ax, 0.72, 0.05);

  /* ---- lab + workshop (left wall): bench with a robotic arm, readouts, a reactor ring, and a holotable building a world ---- */
  const lab = group(-5.9, 0, -2.3, 0.2);
  // bench: dark metal top on two cabinets, teal under-glow, pegboard behind it
  box(lab, M.metal, 0.8, 0.07, 2.9, 0.46, 1.15, -0.9);
  box(lab, M.charcoal, 0.72, 1.12, 1.1, 0.42, 0, -1.75);
  box(lab, M.charcoal, 0.72, 1.12, 1.1, 0.42, 0, -0.05);
  for (const bz of [-1.75, -0.05]) for (const by of [0.28, 0.62, 0.96]) box(lab, M.muted, 0.02, 0.02, 0.4, 0.79, by, bz, { cast: false });
  box(lab, M.ledTeal, 0.02, 0.02, 2.8, 0.85, 1.13, -0.9, { cast: false });
  box(lab, M.charcoal2, 0.04, 0.8, 2.9, 0.05, 1.25, -0.9, { cast: false });
  for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) box(lab, M.black, 0.02, 0.03, 0.03, 0.075, 1.35 + j * 0.25, -2.2 + i * 0.32, { cast: false });
  // hanging tools: two wrenches, a driver, a coil of cable
  box(lab, M.metal2, 0.03, 0.42, 0.06, 0.09, 1.42, -2.05); box(lab, M.metal2, 0.03, 0.09, 0.14, 0.09, 1.82, -2.05);
  box(lab, M.metal2, 0.03, 0.34, 0.05, 0.09, 1.46, -1.78); box(lab, M.metal2, 0.03, 0.08, 0.12, 0.09, 1.78, -1.78);
  cyl(lab, M.accent, 0.02, 0.3, 0.09, 1.42, -1.52, 8); cyl(lab, M.metal2, 0.008, 0.16, 0.09, 1.72, -1.52, 6);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 16), M.tealCloth); coil.position.set(0.1, 1.68, -0.5); coil.rotation.y = Math.PI / 2; coil.castShadow = true; lab.add(coil);
  // on the bench: vice, soldering station, parts tray, a workpiece (small drone chassis) and a tablet
  box(lab, M.metal2, 0.18, 0.1, 0.16, 0.5, 1.22, 0.3); box(lab, M.metal2, 0.06, 0.16, 0.2, 0.4, 1.22, 0.3); box(lab, M.metal2, 0.06, 0.16, 0.2, 0.6, 1.22, 0.3);
  cyl(lab, M.metal2, 0.022, 0.03, 0.62, 1.29, 0.3, 8); box(lab, M.metal2, 0.16, 0.012, 0.012, 0.62, 1.3, 0.3);
  cyl(lab, M.charcoal2, 0.07, 0.04, 0.3, 1.22, -0.55, 12); cyl(lab, M.metal2, 0.012, 0.22, 0.3, 1.26, -0.55, 6); box(lab, M.led, 0.03, 0.02, 0.03, 0.3, 1.48, -0.55, { cast: false });
  box(lab, M.charcoal2, 0.28, 0.03, 0.2, 0.62, 1.22, -0.2, { cast: false });
  for (let i = 0; i < 8; i++) cyl(lab, i % 3 ? M.metal2 : M.brass, 0.014, 0.05, 0.52 + (i % 4) * 0.06, 1.25, -0.26 + Math.floor(i / 4) * 0.1, 6);
  box(lab, M.charcoal2, 0.16, 0.05, 0.16, 0.48, 1.22, -0.95); for (const [ax, az] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]]) { box(lab, M.metal2, 0.14, 0.015, 0.02, 0.48 + ax, 1.25, -0.95 + az, { ry: ax * az > 0 ? 0.785 : -0.785 }); cyl(lab, M.ledTeal, 0.012, 0.01, 0.48 + ax * 1.5, 1.265, -0.95 + az * 1.5, 8); }
  const tabTex = holoPanelTexture('hex', 11); textTextures.push(tabTex);
  const tablet = new THREE.Mesh(G.plane, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tabTex, emissiveIntensity: 1.2, roughness: 0.6 }));
  tablet.scale.set(0.34, 0.22, 1); tablet.position.set(0.5, 1.232, -1.4); tablet.rotation.order = 'YXZ'; tablet.rotation.set(-Math.PI / 2, 0.22, 0); tablet.castShadow = false; lab.add(tablet);
  // readout screens above the bench
  const readouts = [screenGraphTexture(), holoPanelTexture('terrain', 5), screenCodeTexture(21)];
  readouts.forEach((tex, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.3, roughness: 0.8 });
    const m = new THREE.Mesh(G.plane, mat); m.scale.set(0.56, 0.34, 1); m.position.set(0.075, 2.3, -2.05 + i * 0.66); m.rotation.y = Math.PI / 2; m.castShadow = false; lab.add(m);
    box(lab, M.black, 0.02, 0.4, 0.62, 0.06, 2.1, -2.05 + i * 0.66, { cast: false });
    screens.push({ mat, tex, phase: r() * 10 });
  });
  // reactor ring on the wall: teal outer ring, amber inner ring, warm core, twelve ticks
  const reactor = new THREE.Group(); reactor.position.set(0.08, 3.1, -1.4); reactor.rotation.y = Math.PI / 2; lab.add(reactor);
  reactor.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 8, 28), M.ledTeal));
  reactor.add(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.018, 6, 24), M.led));
  const core = new THREE.Mesh(G.cyl(0.13, 0.05, 24), M.bulb); core.rotation.x = Math.PI / 2; reactor.add(core);
  for (let i = 0; i < 12; i++) { const tick = new THREE.Mesh(G.box, M.metal2); tick.scale.set(0.03, 0.09, 0.03); const a = (i / 12) * Math.PI * 2; tick.position.set(Math.cos(a) * 0.44, Math.sin(a) * 0.44, 0); tick.rotation.z = a - Math.PI / 2; reactor.add(tick); }
  // robotic arm: base on the bench, shoulder → elbow → wrist groups animated per frame, weld spark at the tip
  cyl(lab, M.metal2, 0.17, 0.06, 0.5, 1.22, -1.95, 20); cyl(lab, M.metal, 0.1, 0.12, 0.5, 1.28, -1.95, 16);
  const shoulder = new THREE.Group(); shoulder.position.set(0.5, 1.4, -1.95); lab.add(shoulder);
  sphere(shoulder, M.metal2, 0.11, 0, 0, 0);
  box(shoulder, M.metal, 0.11, 0.11, 0.7, 0, -0.055, 0.35);
  box(shoulder, M.ledTeal, 0.02, 0.02, 0.5, 0.062, -0.01, 0.35, { cast: false });
  const elbow = new THREE.Group(); elbow.position.set(0, 0, 0.7); shoulder.add(elbow);
  sphere(elbow, M.metal2, 0.085, 0, 0, 0);
  box(elbow, M.metal, 0.09, 0.09, 0.55, 0, -0.045, 0.275);
  const wrist = new THREE.Group(); wrist.position.set(0, 0, 0.55); elbow.add(wrist);
  sphere(wrist, M.metal2, 0.06, 0, 0, 0);
  box(wrist, M.charcoal, 0.06, 0.06, 0.18, 0, -0.03, 0.09);
  const tipRing = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 14), M.ledTeal); tipRing.position.set(0, 0, 0.13); wrist.add(tipRing);
  const spark = new THREE.Mesh(G.sphere, M.bulb); spark.scale.setScalar(0.001); spark.position.set(0, 0, 0.21); spark.castShadow = false; spark.userData.noMerge = true; wrist.add(spark);
  // holotable: charcoal pedestal, teal ring, glass top, amber emitters
  const holoBase = new THREE.Group(); holoBase.position.set(1.5, 0, 1.55); lab.add(holoBase);
  cyl(holoBase, M.charcoal, 0.6, 0.12, 0, 0, 0, 28, 0.66);
  cyl(holoBase, M.charcoal2, 0.42, 0.7, 0, 0.12, 0, 24, 0.5);
  cyl(holoBase, M.metal, 0.56, 0.1, 0, 0.82, 0, 28, 0.5);
  const tableRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.02, 6, 32), M.ledTeal); tableRing.position.y = 0.9; tableRing.rotation.x = Math.PI / 2; holoBase.add(tableRing);
  const glassTop = new THREE.Mesh(G.cyl(0.5, 0.03, 32), M.glass); glassTop.position.y = 0.935; glassTop.castShadow = false; holoBase.add(glassTop);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; box(holoBase, M.led, 0.04, 0.5, 0.04, Math.cos(a) * 0.46, 0.2, Math.sin(a) * 0.46, { cast: false }); }
  // the hologram: projection cone, an island that assembles itself tile by tile, a wireframe planet with two orbits, two readout panels
  const holo = new THREE.Group(); holo.position.set(1.5, 0.95, 1.55); holo.userData.noMerge = true; lab.add(holo);
  const cone = new THREE.Mesh(G.cyl(0.14, 0.5, 32, 0.48), M.holoCone); cone.position.y = 0.25; cone.castShadow = false; holo.add(cone);
  const island = new THREE.Group(); island.position.y = 0.42; holo.add(island);
  const cubeSpecs = { rock: [], water: [], land: [], peak: [] };
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const d = Math.hypot(i, j); if (d > 4.3) continue;
    const n = 0.5 + 0.5 * Math.sin(i * 0.9 + 1.3) * Math.cos(j * 0.8 - 0.4) - d * 0.06;
    const h = n > 0.62 ? 3 : n > 0.3 ? 2 : 1;
    for (let k = 0; k < h; k++) {
      const kind = k < h - 1 ? 'rock' : h === 1 ? 'water' : h === 2 ? 'land' : 'peak';
      cubeSpecs[kind].push({ x: i * 0.1, y: k * 0.1, z: j * 0.1, at: (d / 4.3) * 0.28 + k * 0.03 + r() * 0.04 });
    }
  }
  const islandMeshes = Object.entries(cubeSpecs).map(([kind, specs]) => {
    const mat = { rock: M.holoRock, water: M.holoWater, land: M.holoLand, peak: M.holoPeak }[kind];
    const im = new THREE.InstancedMesh(G.box, mat, specs.length); im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; island.add(im);
    return { im, specs };
  });
  const islandDummy = new THREE.Object3D();
  const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 2), M.holoWire); globe.position.y = 1.55; globe.castShadow = false; holo.add(globe);
  const globeCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), M.holoCore); globeCore.position.y = 1.55; globeCore.castShadow = false; holo.add(globeCore);
  const orbit1 = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.008, 5, 48), M.holoLine); orbit1.position.y = 1.55; orbit1.rotation.x = Math.PI / 2 - 0.35; orbit1.castShadow = false; holo.add(orbit1);
  const orbit2 = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.006, 5, 48), M.holoAmberLine); orbit2.position.y = 1.55; orbit2.rotation.set(Math.PI / 2 + 0.5, 0.6, 0); orbit2.castShadow = false; holo.add(orbit2);
  const moon = new THREE.Mesh(G.sphere, M.holoAmber); moon.scale.setScalar(0.035); moon.position.set(0.74, 0, 0); moon.castShadow = false; orbit2.add(moon);
  const panelTexA = holoPanelTexture('terrain', 3), panelTexB = holoPanelTexture('hex', 7); textTextures.push(panelTexA, panelTexB);
  const panels = [];
  for (const [tex, pz, ry] of [[panelTexA, -0.86, 0.3], [panelTexB, 0.86, 0.7]]) {
    const m = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.scale.set(0.62, 0.4, 1); m.position.set(0.15, 1.05, pz); m.rotation.y = Math.PI / 2 - ry; m.castShadow = false; holo.add(m);
    panels.push({ m, tex, base: 1.05 });
  }
  const holoLight = new THREE.PointLight(C.teal, 4.2, 5.5, 2); holoLight.position.set(1.5, 2.0, 1.55); lab.add(holoLight);
  anchor('ideas', lab, 1.5, 3.45, 1.55);

  /* ---- sofa + coffee table ---- */
  const sofa = group(0.55, 0, 2.15, 0.26);
  const sofaMat = std(0x4b4740, { roughness: 0.95 }), cushionMat = std(0x5a554c, { roughness: 1 }), seamMat = std(0x2c2926, { roughness: 1 });
  const pipingMat = std(0x2f7f7b, { roughness: 0.8 }), throwMat = std(0xd6c9ad, { roughness: 0.95 });
  box(sofa, sofaMat, 2.7, 0.4, 1.0, 0, 0.14, 0);
  for (const [lx, lz] of [[-1.25, -0.4], [1.25, -0.4], [-1.25, 0.4], [1.25, 0.4]]) box(sofa, M.woodDark, 0.06, 0.14, 0.06, lx, 0, lz);
  box(sofa, sofaMat, 2.7, 0.55, 0.26, 0, 0.5, 0.37);
  for (const ax of [-1.36, 1.36]) box(sofa, sofaMat, 0.28, 0.34, 1.0, ax, 0.54, 0);
  for (const cx of [-0.88, 0, 0.88]) {
    box(sofa, cushionMat, 0.84, 0.16, 0.9, cx, 0.54, -0.02);
    box(sofa, seamMat, 0.86, 0.012, 0.92, cx, 0.615, -0.02, { cast: false }); // seam line between cushions
    box(sofa, seamMat, 0.86, 0.012, 0.92, cx, 0.535, -0.02, { cast: false });
  }
  // teal piping along the seat front and backrest top, a folded cream throw over the right arm
  box(sofa, pipingMat, 2.7, 0.025, 0.025, 0, 0.53, 0.5, { cast: false });
  box(sofa, pipingMat, 2.7, 0.025, 0.025, 0, 1.04, 0.5, { cast: false });
  box(sofa, throwMat, 0.36, 0.05, 0.94, 1.36, 0.88, 0.02, { ry: 0.03 });
  box(sofa, throwMat, 0.05, 0.42, 0.86, 1.52, 0.5, 0.02, { rz: -0.04 });
  box(sofa, M.accent, 0.42, 0.34, 0.12, -0.85, 0.7, 0.16, { ry: 0.2, rz: 0.06 });
  box(sofa, M.tealCloth, 0.4, 0.32, 0.12, 0.9, 0.7, 0.16, { ry: -0.15 });
  /* ---- display table: a tabletop miniature of the City Crafters turntable (the four project dioramas) ---- */
  const table = group(0.45, 0, 0.5, 0.34);
  const tableTop = cyl(table, M.woodDark, 1.08, 0.05, 0, 0.40, 0, 56); tableTop.receiveShadow = true;   // round top
  cyl(table, M.black, 1.0, 0.03, 0, 0.37, 0, 56);                                                          // under-lip
  cyl(table, M.black, 0.09, 0.37, 0, 0, 0, 16);                                                            // pedestal leg
  cyl(table, M.black, 0.5, 0.03, 0, 0, 0, 32);                                                             // foot
  const MINI = 0.245;
  const mini = createDioramaSet();
  mini.group.userData.noMerge = true;                        // already merged inside cityscene.js; keep the room merger out of it
  mini.group.scale.setScalar(MINI); mini.group.position.set(0, 0.45 + 0.16 * MINI, 0); table.add(mini.group);
  const miniLight = new THREE.PointLight(C.accent, 1.6, 3.0, 2); miniLight.position.set(0, 1.2, 0); table.add(miniLight);
  anchor('citycrafters', table, -0.25, 1.75, -0.1);   // high enough that the label pill clears the miniature
  // floor lamp beside the sofa — the warm fill that lifts the front-left of the room
  const floorLamp = group(-1.35, 0, 2.55, 0.46, { rise: 0.5 });
  cyl(floorLamp, M.brass, 0.16, 0.03, 0, 0, 0, 20);
  cyl(floorLamp, M.brass, 0.018, 1.42, 0, 0.03, 0, 8);
  const flShade = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.32, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8d9bd, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xf3a65a, emissiveIntensity: 0.35 }));
  flShade.position.set(0, 1.42, 0); flShade.castShadow = false; floorLamp.add(flShade);
  const flBulb = sphere(floorLamp, M.bulb, 0.035, 0, 1.36, 0); flBulb.castShadow = false;
  const floorLight = new THREE.PointLight(0xffc27a, 5.5, 6.5, 2); floorLight.position.set(0, 1.3, 0); floorLamp.add(floorLight);

  /* ---- side table with poker chips + cards ---- */
  const side = group(2.7, 0, -1.2, 0.42);
  cyl(side, M.wood, 0.56, 0.06, 0, 0.88, 0, 28);
  cyl(side, M.charcoal, 0.05, 0.86, 0, 0.03, 0, 10);
  cyl(side, M.charcoal, 0.3, 0.035, 0, 0, 0, 24);
  const chipSets = chipPalette();
  const chipMats = chipSets.map((t) => [
    new THREE.MeshStandardMaterial({ map: t.side, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ map: t.face, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ map: t.face, roughness: 0.55 }),
  ]);
  const chipGeo = G.cyl(0.155, 0.04, 28);
  const stacks = [];
  function chipStack(x, z, n, seed) {
    const g = new THREE.Group(); g.position.set(x, 0.94, z); side.add(g);
    const rr = rng(seed);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(chipGeo, chipMats[i % 3]); m.position.set((rr() - 0.5) * 0.02, i * 0.04 + 0.02, (rr() - 0.5) * 0.02); m.rotation.y = rr() * Math.PI * 2; m.castShadow = true; g.add(m);
    }
    stacks.push(g); return g;
  }
  chipStack(-0.14, 0.02, 8, 1); chipStack(0.2, -0.22, 5, 2);
  const chipLoose = new THREE.Mesh(chipGeo, chipMats[2]); chipLoose.position.set(0.28, 0.96, 0.24); chipLoose.rotation.set(0.05, 0.4, 0); side.add(chipLoose);
  const cardGeo = new THREE.PlaneGeometry(0.34, 0.478);
  const studioCards = [['K', 'h'], ['A', 's'], ['Q', 'd']];
  studioCards.forEach(([rk, su], i) => {
    const tex = cardFaceTexture(rk, su); textTextures.push(tex);
    const m = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.6 }));
    m.rotation.set(-Math.PI / 2, 0, 0); m.rotateZ((i - 1) * 0.42); m.position.set(0.02 + (i - 1) * 0.11, 0.942 + i * 0.003, 0.22 + Math.abs(i - 1) * 0.02); m.castShadow = false; side.add(m);
  });
  const sideLight = new THREE.PointLight(C.accent, 1.6, 3, 2); sideLight.position.set(0, 1.9, 0); side.add(sideLight);
  anchor('lalapoker', side, -0.05, 1.55, 0);

  /* ---- floating book ---- */
  const book = group(1.95, 2.35, -0.35, 0.7, { rise: 0.9 });
  const pageR = bookPageTexture('r'), pageL = bookPageTexture('l'); textTextures.push(pageR, pageL);
  const PW = 0.62, PH = 0.86;
  const pageGeo = new THREE.PlaneGeometry(PW, PH);
  const pages = [];
  function page(tex, dir) {
    const pivot = new THREE.Group(); book.add(pivot);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7, roughness: 0.9 });
    const m = new THREE.Mesh(pageGeo, mat); m.rotation.x = -Math.PI / 2; m.position.x = dir * PW / 2; m.castShadow = false; pivot.add(m);
    const cover = box(pivot, M.charcoal, PW + 0.03, 0.025, PH + 0.04, dir * (PW / 2 + 0.015), -0.03, 0); cover.castShadow = true;
    pivot.rotation.z = -dir * 0.36; pivot.userData.dir = dir;
    pages.push(pivot);
  }
  page(pageR, 1); page(pageL, -1);
  box(book, M.accent, 0.05, 0.05, PH + 0.04, 0, -0.045, 0);
  const bookLight = new THREE.PointLight(C.accent, 3.6, 4.2, 2); bookLight.position.set(0, -0.25, 0); book.add(bookLight);
  anchor('book', book, 0, 0.62, 0);
  book.rotation.y = 0.35;

  /* ---- plants ---- */
  const plant1 = group(-4.55, 0, 2.95, 0.5);
  cyl(plant1, M.pot, 0.3, 0.55, 0, 0, 0, 16, 0.22); cyl(plant1, M.soil, 0.27, 0.03, 0, 0.53, 0, 16);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.85, 6), i % 2 ? M.green : M.green2);
    leaf.position.set(Math.cos(a) * 0.12, 0.9, Math.sin(a) * 0.12); leaf.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); leaf.castShadow = true; plant1.add(leaf);
  }
  const plant2 = group(3.35, 0, 0.6, 0.55);
  cyl(plant2, M.pot, 0.26, 0.4, 0, 0, 0, 16, 0.2);
  sphere(plant2, M.green3, 0.36, 0, 0.66, 0, 0.8); sphere(plant2, M.green, 0.22, 0.22, 0.85, 0.1, 0.9); sphere(plant2, M.green2, 0.18, -0.2, 0.9, -0.12);
  // small desk plant
  cyl(desk, M.pot, 0.09, 0.14, 2.05, 1.41, 0.35, 12); sphere(desk, M.green2, 0.13, 2.05, 1.65, 0.35, 0.85);

  /* ---- racing wheel rig ---- */
  const rigW = group(-4.75, 0, 1.45, 0.48);
  box(rigW, M.charcoal, 0.75, 0.74, 0.55, 0, 0, 0);
  box(rigW, M.led, 0.7, 0.02, 0.02, 0, 0.72, 0.28, { cast: false });
  box(rigW, M.black, 0.12, 0.22, 0.14, 0, 0.74, 0.02);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.035, 10, 28), M.charcoal2); wheel.position.set(0, 1.05, 0.12); wheel.rotation.x = -1.05; wheel.castShadow = true; rigW.add(wheel);
  const hub = cyl(rigW, M.black, 0.07, 0.04, 0, 1.03, 0.12, 12); hub.rotation.x = -1.05 + Math.PI / 2;
  for (let i = 0; i < 3; i++) { const s = box(rigW, M.black, 0.38, 0.03, 0.03, 0, 1.035, 0.12); s.rotation.set(-1.05, 0, (i / 3) * Math.PI); s.rotateY(0); }
  box(rigW, M.accent, 0.03, 0.03, 0.03, 0, 1.24, 0.06, { cast: false });
  for (let i = 0; i < 3; i++) box(rigW, M.charcoal2, 0.1, 0.14, 0.06, -0.15 + i * 0.15, 0, 0.36, { rx: -0.6 });

  /* ---- dust particles ---- */
  const N = 110;
  const pos = new Float32Array(N * 3), seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = -4.5 + r() * 9; pos[i * 3 + 1] = 0.2 + r() * 3.8; pos[i * 3 + 2] = -4.5 + r() * 9; seeds[i] = r() * 100; }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dustMat = new THREE.PointsMaterial({ color: C.accent, size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const dust = new THREE.Points(dustGeo, dustMat); scene.add(dust);

  /* ---- lights ---- */
  scene.add(new THREE.HemisphereLight(0x4f6266, 0x4a3524, 2.5));
  const key = new THREE.DirectionalLight(0xffd6ae, 3.6); key.position.set(6, 9, 5); key.target.position.set(0, 1, -1); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.05; key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight(C.teal, 1.4); rim.position.set(-5, 4, 8); rim.target.position.set(0, 1, 0); scene.add(rim, rim.target);
  const screenGlow = new THREE.PointLight(C.teal, 6.5, 6.5, 2); screenGlow.position.set(0.3, 2.0, -2.9); scene.add(screenGlow);

  /* ---- intro tweens ---- */
  for (const it of intro) {
    if (!reducedMotion) { it.g.position.y = it.base - it.rise; if (it.scale) it.g.scale.setScalar(0.001); it.g.visible = false; }
    tweens.add({
      delay: it.delay, duration: 1.0,
      onUpdate: (e) => { it.g.visible = true; it.g.position.y = it.base - it.rise * (1 - e); if (it.scale) it.g.scale.setScalar(Math.max(0.001, e)); },
    });
  }
  const state = { labelAlpha: 0, dolly: 1.1, dustAlpha: 0 };
  tweens.add({ delay: 1.05, duration: 0.55, onUpdate: (e) => { state.labelAlpha = e; } });
  tweens.add({ delay: 0, duration: 1.6, ease: easeInOutCubic, onUpdate: (e) => { state.dolly = 1.1 - 0.1 * e; } });
  tweens.add({ delay: 0.8, duration: 1.0, onUpdate: (e) => { dustMat.opacity = 0.55 * e; } });

  redrawWhenFontsReady(rig, textTextures);

  /* ---- draw-call batching: merge static siblings that share a material ---- */
  mergeStaticMeshes(scene);

  /* ---- per-frame ---- */
  function update(dt, t) {
    // screens: scroll + flicker
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      if (dt > 0) s.tex.userData.tick?.(dt);
      s.mat.emissiveIntensity = 1.38 + 0.06 * Math.sin(t * 17 + s.phase) * Math.sin(t * 5.3 + s.phase * 2);
    }
    // lamp breath
    lampLight.intensity = 9 + Math.sin(t * 1.25) * 1.1 + Math.sin(t * 4.9) * 0.3;
    floorLight.intensity = 5.5 + Math.sin(t * 0.9 + 1.7) * 0.35;
    // book bob / rotate / page flutter
    book.rotation.y = 0.35 + Math.sin(t * 0.35) * 0.35;
    const bob = Math.sin(t * 1.1) * 0.07;
    bookLight.intensity = 3.6 + Math.sin(t * 2.1) * 0.5;
    pages.forEach((p) => { p.rotation.z = -p.userData.dir * (0.36 + Math.sin(t * 2 + p.userData.dir) * 0.05); p.position.y = bob; });
    anchors.book.position.y = 0.62 + bob;
    // chips spin
    stacks[0].rotation.y = t * 0.45; stacks[1].rotation.y = -t * 0.3;
    // tabletop turntable: slow spin + the dioramas' own loops (pit crew, scan plane, echo rings, jet)
    if (dt > 0) { mini.group.rotation.y += dt * 0.12; mini.update(dt, t, rig.camera); }
    sideLight.intensity = 1.6 + Math.sin(t * 1.7) * 0.25;
    // lab: robotic arm sweep + weld spark, the hologram (island build cycle, planet, orbits, panels), its lights
    const sweep = Math.sin(t * 0.45), bend = Math.sin(t * 0.9 + 1.2);
    shoulder.rotation.y = sweep * 0.42;
    shoulder.rotation.x = -0.55 + bend * 0.2;
    elbow.rotation.x = 0.75 + bend * 0.45;
    wrist.rotation.x = -0.55 - bend * 0.35;
    const welding = bend > 0.9 && Math.sin(t * 57) > -0.2;
    spark.scale.setScalar(welding ? 0.03 + 0.03 * Math.abs(Math.sin(t * 91)) : 0.001);
    // the island assembles (tile by tile, from the centre out), holds, dissolves, and rebuilds on a 12 s cycle;
    // the phase is offset so a still frame (reduced motion, t = 0) shows it fully built
    const cycle = ((t / 12) + 0.55) % 1;
    // instance matrices only change while tiles are appearing or dissolving; the hold and gap phases skip the uploads
    const islandChanging = cycle < 0.36 || (cycle >= 0.72 && cycle < 0.9) || t < 0.5;
    for (const { im, specs } of (islandChanging ? islandMeshes : [])) {
      for (let i = 0; i < specs.length; i++) {
        const c = specs[i];
        let s;
        if (cycle < 0.34) s = clamp((cycle - c.at) / 0.045, 0, 1);
        else if (cycle < 0.72) s = 1;
        else if (cycle < 0.88) s = 1 - clamp((cycle - 0.72 - c.at * 0.4) / 0.04, 0, 1);
        else s = 0;
        const e = s >= 1 ? 1 : 1 - Math.pow(1 - s, 3);
        islandDummy.position.set(c.x, c.y + (1 - e) * 0.3, c.z);
        islandDummy.scale.setScalar(Math.max(0.001, e) * 0.094);
        islandDummy.updateMatrix();
        im.setMatrixAt(i, islandDummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    }
    island.rotation.y = t * 0.12;
    globe.rotation.y = t * 0.25; globeCore.rotation.y = -t * 0.1;
    if (dt > 0) { orbit1.rotateZ(dt * 0.35); orbit2.rotateZ(-dt * 0.5); }
    for (let i = 0; i < panels.length; i++) { const p = panels[i]; p.m.position.y = p.base + Math.sin(t * 0.9 + i * 2.1) * 0.04; if (dt > 0) p.tex.userData.tick(dt); }
    if (dt > 0) tabTex.userData.tick(dt);
    holoLight.intensity = 4.2 + Math.sin(t * 7.3) * 0.3 + Math.sin(t * 1.3) * 0.5;
    M.bulb.emissiveIntensity = 2.6 + Math.sin(t * 1.25) * 0.5;
    M.holoCone.opacity = 0.06 + Math.sin(t * 9.1) * 0.012 + Math.sin(t * 1.7) * 0.015;
    // dust drift
    if (dt > 0) {
      const p = dustGeo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        p[i * 3 + 1] += dt * 0.06; p[i * 3] += Math.sin(t * 0.5 + seeds[i]) * dt * 0.05; p[i * 3 + 2] += Math.cos(t * 0.4 + seeds[i]) * dt * 0.05;
        if (p[i * 3 + 1] > 4.1) p[i * 3 + 1] = 0.2;
      }
      dustGeo.attributes.position.needsUpdate = true;
    }
  }

  return { anchors, update, state, dispose() { /* geometries & materials are disposed via scene traversal */ } };
}

/**
 * Initialise the hero studio scene.
 * @param {{canvas:HTMLCanvasElement, labelLayer:HTMLElement, hotspots:Array<{id:string,number:string,label:string,target:string}>, reducedMotion?:boolean}} opts
 * @returns {{destroy():void, pause():void, resume():void, resize():void, stats():{triangles:number,calls:number,fps:number}}|null}
 */
export function initStudioScene({ canvas, labelLayer, hotspots = [], reducedMotion = false } = {}) {
  if (!canvas) return null;
  const rig = createRig({ canvas, reducedMotion, shadows: true });
  if (!rig) return null;
  const { scene, camera, pointer, size } = rig;
  rig.renderer.toneMappingExposure = 1.6;
  camera.fov = 35;

  const studio = buildStudio(rig);
  const fallback = new THREE.Object3D(); fallback.position.set(0, 1.5, -1); scene.add(fallback);
  const labels = createLabels(labelLayer, hotspots, (id) => studio.anchors[id] || fallback, reducedMotion);

  const cam = { yaw: 39 * DEG, pitch: 28 * DEG, dist: 22, target: new THREE.Vector3(-0.8, 1.35, -0.85) };
  // walls and furniture, but not the plinth or the empty front strip of floor: the camera sits closer and the room reads large
  const fitAll = { points: boxCorners(-5.7, 0.1, -5.2, 3.7, 3.8, 1.8), h: true, v: true };
  // "core" — lab, desk, book, side table — governs the horizontal fit on narrow canvases (sofa may crop)
  const fitCore = { points: boxCorners(-6.2, 0, -5.2, 3.6, 4.4, 0.6), h: true, v: false };
  const fitTall = { points: boxCorners(-6.2, -0.1, -5.2, 3.9, 3.9, 2.4), h: false, v: true };
  const remeasure = () => { for (const L of labels) L.measure = true; };
  rig.onResize = (w, h) => {
    const aspect = w / h;
    const narrow = aspect < 0.8;
    camera.fov = narrow ? 40 : 35;
    camera.updateProjectionMatrix();
    // choose the framing target first, then solve the distance for it
    cam.target.set(narrow ? -1.0 : -1.1, narrow ? 1.5 : 1.35, narrow ? -1.2 : -1.3);
    const margin = narrow ? 0.98 : aspect < 1.25 ? 0.96 : 0.97;
    cam.dist = fitDistance(camera, cam.yaw, cam.pitch, cam.target, narrow ? [fitTall, fitCore] : [fitAll], margin);
    remeasure();
  };
  rig.onFontsReady = remeasure;
  let measureClock = 0;
  rig.onFrame = (dt, t) => {
    studio.update(dt, t);
    const drift = reducedMotion ? 0 : Math.sin(t * 0.22) * 1.2 * DEG;
    const yaw = cam.yaw + pointer.x * 6 * DEG + drift;
    const pitch = cam.pitch - pointer.y * 3 * DEG;
    orbitCamera(camera, cam.target, yaw, pitch, cam.dist * studio.state.dolly);
    measureClock += dt;
    if (measureClock >= 1) { measureClock = 0; remeasure(); } // catches late font swaps / page CSS changes
    updateLabels(labels, labelLayer, camera, size, studio.state.labelAlpha, dt);
  };
  rig.onDispose = () => { for (const L of labels) L.el.remove(); labels.length = 0; };
  rig.start();
  return rig.controller;
}
/* ───────────────────────────── poker scene ───────────────────────────── */

/**
 * Initialise the LalaPoker mini scene: five fanned cards floating over a chip stack.
 * @param {{canvas:HTMLCanvasElement, reducedMotion?:boolean}} opts
 * @returns {{destroy():void, pause():void, resume():void, resize():void, stats():{triangles:number,calls:number,fps:number}}|null}
 */
export function initPokerScene({ canvas, reducedMotion = false } = {}) {
  if (!canvas) return null;
  const rig = createRig({ canvas, reducedMotion, shadows: false });
  if (!rig) return null;
  const { scene, camera, pointer, tweens } = rig;
  rig.renderer.toneMappingExposure = 1.05;
  const r = rng(4242);
  const textTextures = [];

  const world = new THREE.Group(); scene.add(world);

  /* ---- chip stack (9 chips) + a small side pile ---- */
  const sets = chipPalette();
  const chipMats = sets.map((t) => [
    new THREE.MeshStandardMaterial({ map: t.side, roughness: 0.5, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ map: t.face, roughness: 0.5, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ map: t.face, roughness: 0.5, metalness: 0.05 }),
  ]);
  sets.forEach((t) => textTextures.push(t.face));
  const CH = 0.085, CR = 0.52;
  const chipGeo = new THREE.CylinderGeometry(CR, CR, CH, 40);
  const stack = new THREE.Group(); world.add(stack);
  const chips = [];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(chipGeo, chipMats[i % 3]);
    m.position.set((r() - 0.5) * 0.05, CH / 2 + i * CH, (r() - 0.5) * 0.05); m.rotation.y = r() * Math.PI * 2;
    m.userData.spin = (r() - 0.5) * 0.3;
    stack.add(m); chips.push(m);
  }
  const pile = new THREE.Group(); pile.position.set(1.05, 0, 0.35); world.add(pile);
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(chipGeo, chipMats[(i + 1) % 3]); m.position.set((r() - 0.5) * 0.04, CH / 2 + i * CH, (r() - 0.5) * 0.04); m.rotation.y = r() * 6; pile.add(m); }
  const lean = new THREE.Mesh(chipGeo, chipMats[0]); lean.position.set(-1.0, 0.2, 0.45); lean.rotation.set(1.2, 0.3, 0.4); world.add(lean);
  // contact shadow
  const blob = blobTexture();
  const shadowMat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), shadowMat); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; shadow.scale.set(1.4, 1, 1); world.add(shadow);
  const shadowPile = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), shadowMat); shadowPile.rotation.x = -Math.PI / 2; shadowPile.position.set(1.05, 0.003, 0.35); world.add(shadowPile);
  const shadowCards = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6), shadowMat); shadowCards.rotation.x = -Math.PI / 2; shadowCards.position.set(0, 0.004, -0.1); world.add(shadowCards);

  /* ---- fanned hand ---- */
  const hand = [['A', 's'], ['K', 'h'], ['Q', 'd'], ['J', 'c'], ['10', 's']];
  const back = cardBackTexture(); textTextures.push(back);
  const cardGeo = new THREE.PlaneGeometry(0.78, 1.095);
  const backMat = new THREE.MeshStandardMaterial({ map: back, transparent: true, alphaTest: 0.5, roughness: 0.55, side: THREE.BackSide });
  const cards = [];
  const fan = new THREE.Group(); fan.position.set(0, 1.35, -0.05); world.add(fan);
  hand.forEach(([rk, su], i) => {
    const tex = cardFaceTexture(rk, su); textTextures.push(tex);
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.55 });
    const pivot = new THREE.Group(); fan.add(pivot);
    const card = new THREE.Group(); card.position.y = 0.62; pivot.add(card);
    card.add(new THREE.Mesh(cardGeo, faceMat));
    card.add(new THREE.Mesh(cardGeo, backMat));
    const a = (i - 2) * 13 * DEG;
    // z spacing (0.03 pivot + 0.03 card = 0.06 per card) must exceed the per-card x-tilt sway at the card top
    // (±0.02 rad × 1.17 ≈ ±0.023, i.e. ≤ 0.047 between neighbours) or the planes intersect and the lower
    // card pokes through the one on top of it.
    pivot.rotation.z = -a; pivot.position.z = i * 0.03;
    pivot.userData = { a, phase: r() * Math.PI * 2, i };
    cards.push(pivot);
  });
  fan.rotation.x = -0.28;

  /* ---- lights ---- */
  scene.add(new THREE.HemisphereLight(0x3d4b4f, 0x2a1c12, 0.9));
  const spot = new THREE.SpotLight(C.accent, 55, 14, 0.55, 0.8, 1.6); spot.position.set(2.2, 5.5, 3); spot.target.position.set(0, 0.8, 0); scene.add(spot, spot.target);
  const fill = new THREE.DirectionalLight(0xfff1e0, 1.1); fill.position.set(-3, 4, 4); scene.add(fill);
  const rim = new THREE.DirectionalLight(C.teal, 1.8); rim.position.set(-4, 2.5, -4); rim.target.position.set(0, 1, 0); scene.add(rim, rim.target);
  const under = new THREE.PointLight(C.teal, 1.2, 4, 2); under.position.set(0, 0.5, 1.4); scene.add(under);

  /* ---- camera ---- */
  const cam = { yaw: 0, pitch: 19 * DEG, dist: 7, target: new THREE.Vector3(0, 0.95, 0) };
  const fitAll = { points: boxCorners(-1.9, -0.05, -0.9, 1.9, 2.55, 0.9), h: true, v: true };
  rig.onResize = (w, h) => {
    const aspect = w / h;
    camera.fov = aspect < 1 ? 42 : 35; camera.updateProjectionMatrix();
    cam.dist = fitDistance(camera, cam.yaw, cam.pitch, cam.target, [fitAll], aspect < 1 ? 0.97 : 0.95);
  };

  /* ---- intro ---- */
  const state = { rise: reducedMotion ? 1 : 0, cardsIn: reducedMotion ? 1 : 0 };
  tweens.add({ delay: 0, duration: 1.0, onUpdate: (e) => { state.rise = e; } });
  tweens.add({ delay: 0.35, duration: 1.25, onUpdate: (e) => { state.cardsIn = e; } });

  redrawWhenFontsReady(rig, textTextures);

  rig.onFrame = (dt, t) => {
    const yaw = cam.yaw + (reducedMotion ? 0 : Math.sin(t * 0.21) * 26 * DEG) + pointer.x * 6 * DEG;
    const pitch = cam.pitch - pointer.y * 3 * DEG;
    orbitCamera(camera, cam.target, yaw, pitch, cam.dist);
    // chips settle + gentle spin
    stack.position.y = -(1 - state.rise) * 0.8;
    stack.scale.setScalar(0.2 + 0.8 * state.rise);
    pile.position.y = stack.position.y; pile.scale.copy(stack.scale); lean.scale.copy(stack.scale); lean.position.y = 0.2 * state.rise;
    shadowMat.opacity = state.rise;
    if (!reducedMotion) { stack.rotation.y = t * 0.25; pile.rotation.y = -t * 0.2; for (const c of chips) c.rotation.y += dt * c.userData.spin; }
    // cards: fan in + float with phase offsets
    const e = state.cardsIn;
    for (const p of cards) {
      const { a, phase, i } = p.userData;
      p.rotation.z = -a * e;
      p.position.y = (1 - e) * -0.6 + (reducedMotion ? 0 : Math.sin(t * 1.15 + phase) * 0.035 + Math.sin(t * 0.7 + phase * 1.7) * 0.015);
      p.rotation.x = reducedMotion ? 0 : Math.sin(t * 0.9 + phase) * 0.02;
      p.children[0].position.z = 0.03 * i;
    }
    fan.rotation.y = reducedMotion ? 0 : Math.sin(t * 0.5) * 0.05;
    fan.position.y = 1.35 + (1 - e) * 0.4;
    spot.intensity = 55 + Math.sin(t * 1.3) * 5;
  };
  rig.start();
  return rig.controller;
}
