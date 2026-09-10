/**
 * @file cityscene.js — "City Crafters spotlight turntable" (Zain Kassem portfolio).
 *
 * Four low-poly dioramas on pedestals ride a slowly turning ring. `focus(i)` swings diorama `i`
 * to the front (≈ 900 ms, cubic with a whisper of overshoot so the turntable feels physical),
 * lights it fully under a soft amber spot and dims the others to ~55 %. Built entirely from
 * primitives with procedural CanvasTextures — no external assets, imports only `three`.
 *
 * @example
 *   import { initCityScene } from './cityscene.js';
 *   const city = initCityScene({ canvas, reducedMotion, onFocus: (i) => { tabs[i].click(); city.focus(i); } });
 *   city?.focus(2);
 *   city?.destroy();
 *
 * `initCityScene({ canvas, reducedMotion, onFocus })` → controller | null (no WebGL)
 *   canvas        <canvas> filling its parent (.city-stage, position:relative).
 *   reducedMotion true → one still frame with diorama 0 in front, no loops, no parallax;
 *                 focus(i) then jumps instantly and renders exactly one more frame.
 *   onFocus(i)    called when a diorama is clicked/tapped (raycast on the diorama's real meshes — FX meshes that
 *                 fade or hide are tagged `userData.noPick` and skipped; nearest wins). The module does NOT call
 *                 focus(i) itself — the page decides.
 *
 * Dioramas (fixed index order):
 *   0 'pit'   Pit Protocol    — F1 car in a pit box on a checkered tile, four crew capsules, a wheel that
 *                               comes off and a fresh one snaps on in a loop, wheel-gun spark, VR rack, pit lights.
 *   1 'holo'  Hologram Cloud  — teal wireframe city block floating over a black glass table, a scan plane that
 *                               sweeps up through it, rising motes, one "real" building fading into wireframe.
 *   2 'blade' Unseen Blade    — kneeling swordsman silhouette with a katana on a dark pedestal, crimson
 *                               (#d7261e) echo-location rings pulsing out every ~1.6 s, moonlight-blue rim.
 *   3 'jet'   Target Destroyed— low-poly F-16 banking over a gulf-sand pedestal (crescent dunes, lit runway, hangar,
 *                               control tower) chasing three quad drones; a homing missile with a fading trail every
 *                               few seconds ends in a small hot burst (core + shock ring + sparks), FLIR-green crosshair.
 *
 * Controller: `{ focus(i), destroy(), pause(), resume(), resize(), stats() }`
 *   - focus(i): ease the ring so diorama i faces the camera; holds still for 12 s, then the ring resumes its
 *     idle drift (1 rev / 90 s). The diorama nearest the front is always the lit one, so the spot reads as a
 *     fixed stage light the turntable rotates through.
 *   - destroy(): stops the loop, disconnects observers/listeners, disposes every geometry, material, texture
 *     and the renderer (renderer.info.memory returns to 0/0). Re-init on the same canvas is supported.
 *   - pause()/resume(): user-level pause; the loop also auto-pauses off-screen / when the tab is hidden.
 *   - resize(): re-measure (also driven by a ResizeObserver).
 *   - stats(): `{ triangles, calls, frame, fps, memory:{geometries,textures}, focused, angle, tweening,
 *     dioramas:[{id,x,y,depth,lit}] }` — `frame` is the renderer's frame counter (proves the loop is paused) and
 *     `dioramas` holds each diorama's anchor projected to canvas CSS px (diagnostics / tests).
 *
 * Rules (docs/CONTRACTS.md): transparent clear (alpha:true), ACES tone mapping, DPR ≤ 2, ResizeObserver,
 * IntersectionObserver + visibilitychange pause, pointer parallax ±5° (lerped), ≤ 40k triangles, one
 * shadow-casting DirectionalLight (1024 map; pedestal tops + turntable receive), intro: pedestals rise +
 * scale in, staggered over 1.4 s. Static meshes that share a material are merged into one draw call per
 * (group, material, shadow-flags) bucket with a self-contained merge helper.
 */
import * as THREE from 'three';

/* ───────────────────────────── palette / constants ───────────────────────────── */

const C = {
  bg: 0x151616, panel: 0x1c1d1d, line: 0x353636, ink: 0xf2f1ec, muted: 0xa0a29e,
  accent: 0xf3a65a, teal: 0x3ec6c0, red: 0xd7261e, flir: 0x4cff8a, moon: 0x8fb4ff,
};
const HEX = { ink: '#f2f1ec', accent: '#f3a65a', teal: '#3ec6c0', panel: '#1c1d1d' };
const MAX_DPR = 2;
const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;

const RING_R = 2.6;          // ring radius: pedestal centres
const PED_R = 1.0;           // pedestal top radius
const PED_H = 0.45;          // pedestal height (content sits at y = PED_H)
const FOCUS_MS = 0.9;        // focus() ease duration (s)
const HOLD_S = 12;           // idle hold after a focus() before drifting again
const DRIFT = -(Math.PI * 2) / 90; // idle drift: 1 rev / 90 s (negative → 0,1,2,3 come to the front in order)
const DIORAMAS = ['pit', 'holo', 'blade', 'jet'];

/* ───────────────────────────── tiny tween helper ───────────────────────────── */

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Cubic ease-out with a small (~5 %) overshoot — the turntable settles like it has mass. */
const easeOutBackSoft = (t) => { const s = 0.9; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Frame-rate independent lerp factor: `k` per 60 fps frame. */
const damp = (k, dt) => 1 - Math.pow(1 - k, dt * 60);
/** Wraps an angle to [-π, π). */
const wrapAngle = (a) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

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

/** Deterministic PRNG so the dioramas look identical on every load. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d') };
}

/** Wraps a 2D canvas in a CanvasTexture (sRGB, clamped). */
function canvasTexture(w, h, draw, opts = {}) {
  const { c, ctx } = makeCanvas(w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = opts.wrap || THREE.ClampToEdgeWrapping;
  tex.anisotropy = opts.anisotropy || 1;
  tex.generateMipmaps = opts.mipmaps !== false;
  tex.minFilter = opts.mipmaps === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  draw(ctx, w, h);
  tex.needsUpdate = true;
  return tex;
}

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Standard material factory with sane low-poly defaults. */
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

/**
 * Fallback guard (same as scene.js): author CSS like `img { display:block }` beats the UA `[hidden]`
 * rule, so a `<img hidden>` fallback sharing the canvas's parent would paint over the live scene.
 * Force such siblings to `display:none` while the scene is alive; lift it if `hidden` is removed.
 */
function suppressHiddenSiblings(canvas) {
  const parent = canvas.parentElement;
  const held = new Map();
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

/* ───────────────────────────── renderer rig ───────────────────────────── */

/**
 * Creates the renderer + camera + loop + observers. Returns null when a WebGL context cannot be created.
 * Same conventions as scene.js: transparent clear, ACES, DPR ≤ 2, IO/visibility pause, pointer parallax.
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
  if (shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  const restoreSiblings = suppressHiddenSiblings(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  const clock = new THREE.Clock(false);
  const tweens = new Tweens();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const size = { w: 1, h: 1 };
  const fpsMeter = { frames: 0, t: 0, fps: 0 };

  const rig = {
    renderer, scene, camera, tweens, pointer, size, reducedMotion: !!reducedMotion,
    time: 0,
    onFrame: null,   // (dt, t) => void
    onResize: null,  // (w, h) => void
    onDispose: null, // () => void
    destroyed: false,
  };

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
    const dt = Math.min(clock.getDelta(), 1 / 20);
    rig.time += dt;
    tweens.update(dt);
    const k = damp(0.06, dt);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    rig.onFrame?.(dt, rig.time);
    renderer.render(scene, camera);
    fpsMeter.frames++; fpsMeter.t += dt;
    if (fpsMeter.t >= 1) { fpsMeter.fps = fpsMeter.frames / fpsMeter.t; fpsMeter.frames = 0; fpsMeter.t = 0; }
    raf = requestAnimationFrame(tick);
  }

  function syncLoop() {
    if (rig.reducedMotion) { if (needsFrame && running()) { needsFrame = false; renderOnce(); } return; }
    if (running()) { if (!raf) { clock.start(); clock.getDelta(); raf = requestAnimationFrame(tick); } }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  rig.requestFrame = () => { needsFrame = true; syncLoop(); };

  function resize() {
    if (rig.destroyed) return;
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 0;
    if (!w || !h) return;
    size.w = w; size.h = h;
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
      // Leave the (shared, persistent) GL context in its default pixel-store state for a later renderer on the same canvas.
      try { const gl = renderer.getContext(); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL); } catch (e) { /* context already lost */ }
    },
    pause() { userPaused = true; syncLoop(); },
    resume() { userPaused = false; if (rig.reducedMotion) needsFrame = true; syncLoop(); },
    resize,
    stats() { const r = renderer.info.render, m = renderer.info.memory; return { triangles: r.triangles, calls: r.calls, frame: r.frame, fps: Math.round(fpsMeter.fps), memory: { geometries: m.geometries, textures: m.textures } }; },
  };
  return rig;
}

/* ───────────────────────────── camera fitting ───────────────────────────── */

const _fitCam = new THREE.PerspectiveCamera();
const _q = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _back = new THREE.Vector3();
/** Camera distance so that sets of world points fit the frustum. Each set: { points, h, v } (constrains width / height). */
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
function orbitCamera(camera, target, yaw, pitch, dist) {
  camera.position.set(
    target.x + dist * Math.sin(yaw) * Math.cos(pitch),
    target.y + dist * Math.sin(pitch),
    target.z + dist * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.lookAt(target);
}

/* ───────────────────────────── geometry merging (self-contained) ───────────────────────────── */

/** Concatenates non-indexed position/normal/uv(/color) attributes into one BufferGeometry (temporaries disposed). */
function mergeGeometries(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0; for (const p of parts) count += p.attributes.position.count;
  const hasN = parts.every((p) => p.attributes.normal), hasUv = parts.every((p) => p.attributes.uv), hasC = parts.every((p) => p.attributes.color);
  const pos = new Float32Array(count * 3), nor = hasN ? new Float32Array(count * 3) : null, uv = hasUv ? new Float32Array(count * 2) : null, col = hasC ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const p of parts) {
    const n = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, n * 3), o * 3);
    if (nor) nor.set(p.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (uv) uv.set(p.attributes.uv.array.subarray(0, n * 2), o * 2);
    if (col) col.set(p.attributes.color.array.subarray(0, n * 3), o * 3);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nor) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); else g.computeVertexNormals();
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (let i = 0; i < parts.length; i++) if (parts[i] !== list[i]) parts[i].dispose();
  return g;
}

/** Merges the `position` attributes of line geometries into one (for a single LineSegments). */
function mergeLineGeometries(list) {
  let count = 0; for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) { const n = g.attributes.position.count; pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3); o += n; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

/**
 * Merges direct-child meshes of every group that share (material, castShadow, receiveShadow) into one
 * Mesh. Groups are recursed so per-group animation is preserved; multi-material meshes, meshes with
 * children and `userData.noMerge` meshes are left alone. Must run before the first render.
 */
function mergeStaticMeshes(root) {
  const dropped = new Set();
  const visit = (node) => {
    const buckets = new Map();
    for (const o of node.children.slice()) {
      if (o.isMesh) {
        if (Array.isArray(o.material) || o.children.length || o.userData.noMerge || !o.geometry?.attributes?.position) continue;
        const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.userData.noPick ? 1 : 0}`; // never merge FX parts into pickable geometry
        let list = buckets.get(key); if (!list) buckets.set(key, (list = []));
        list.push(o);
      } else if (!o.isLight && o.children.length) visit(o);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const parts = list.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
      const merged = mergeGeometries(parts);
      for (const p of parts) p.dispose();
      const first = list[0];
      const mesh = new THREE.Mesh(merged, first.material);
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      if (first.userData.noPick) mesh.userData.noPick = true; // keep hidden/fading parts out of the raycast list
      node.add(mesh);
      for (const m of list) { node.remove(m); dropped.add(m.geometry); }
    }
  };
  visit(root);
  const live = new Set();
  root.traverse((o) => { if (o.geometry) live.add(o.geometry); });
  for (const g of dropped) if (!live.has(g)) g.dispose();
}

/* ───────────────────────────── procedural textures ───────────────────────────── */

const checkerTexture = () => canvasTexture(256, 256, (ctx, w, h) => {
  const n = 8, s = w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { ctx.fillStyle = (x + y) % 2 ? '#e9e7e0' : '#1d1f1f'; ctx.fillRect(x * s, y * s, s, s); }
  // grime + a warm edge band so the tile reads as a used pit floor
  const r = rng(3);
  for (let i = 0; i < 700; i++) { ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.08})`; ctx.fillRect(r() * w, r() * h, 2 + r() * 4, 1 + r() * 2); }
  ctx.strokeStyle = rgba(HEX.accent, 0.9); ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
}, { anisotropy: 4 });

/** Gulf sand: darker/warmer than a beach so the amber spot models it instead of blowing it out; wind ripples + grain. */
const sandTexture = () => canvasTexture(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#967352'; ctx.fillRect(0, 0, w, h);
  const r = rng(11);
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(${r() < 0.55 ? '60,36,12' : '235,200,150'},${0.04 + r() * 0.08})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  ctx.strokeStyle = 'rgba(70,42,14,.26)'; ctx.lineWidth = 2.5;
  for (let i = 0; i < 11; i++) { ctx.beginPath(); for (let x = 0; x <= w; x += 8) { const y = 12 + i * 23 + Math.sin(x * 0.05 + i) * 6; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  ctx.strokeStyle = 'rgba(240,210,160,.10)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 11; i++) { ctx.beginPath(); for (let x = 0; x <= w; x += 8) { const y = 16 + i * 23 + Math.sin(x * 0.05 + i) * 6; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
}, { anisotropy: 4 });

/** Desert runway strip (v = along the strip): asphalt, centreline dashes, threshold combs, edge lines. */
const runwayTexture = () => canvasTexture(64, 256, (ctx, w, h) => {
  ctx.fillStyle = '#26282a'; ctx.fillRect(0, 0, w, h);
  const r = rng(23);
  for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '200,200,190'},${0.04 + r() * 0.08})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  ctx.fillStyle = 'rgba(232,226,208,.85)';
  for (let y = 34; y < h - 34; y += 16) ctx.fillRect(w / 2 - 1.5, y, 3, 8);
  for (const y0 of [6, h - 22]) for (let i = 0; i < 6; i++) ctx.fillRect(7 + i * 9, y0, 4, 16);
  ctx.fillRect(3, 0, 2, h); ctx.fillRect(w - 5, 0, 2, h);
}, { anisotropy: 4 });

const stoneTexture = () => canvasTexture(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#1b1d21'; ctx.fillRect(0, 0, w, h);
  const r = rng(17);
  for (let i = 0; i < 2200; i++) { ctx.fillStyle = `rgba(${r() < 0.55 ? '0,0,0' : '160,180,220'},${0.02 + r() * 0.06})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
  ctx.strokeStyle = 'rgba(143,180,255,.14)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.2, 0, Math.PI * 2); ctx.stroke();
}, { anisotropy: 4 });

/** Turntable top: concentric hairlines + amber index ticks between the pedestals. */
const discTexture = () => canvasTexture(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#202121'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const r = rng(5);
  for (let i = 0; i < 1800; i++) { ctx.fillStyle = `rgba(255,255,255,${0.01 + r() * 0.04})`; ctx.fillRect(r() * w, r() * h, 2, 2); }
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1.5;
  for (const k of [0.3, 0.5, 0.68, 0.86, 0.96]) { ctx.beginPath(); ctx.arc(cx, cy, (w / 2) * k, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = rgba(HEX.accent, 0.55); ctx.lineWidth = 4;
  for (let k = 0; k < 4; k++) { const a = (k + 0.5) * HALF_PI; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * w * 0.44, cy + Math.sin(a) * h * 0.44); ctx.lineTo(cx + Math.cos(a) * w * 0.485, cy + Math.sin(a) * h * 0.485); ctx.stroke(); }
  ctx.strokeStyle = rgba(HEX.teal, 0.35); ctx.lineWidth = 2;
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * w * 0.465, cy + Math.sin(a) * h * 0.465); ctx.lineTo(cx + Math.cos(a) * w * 0.485, cy + Math.sin(a) * h * 0.485); ctx.stroke(); }
}, { anisotropy: 4 });

/** Soft warm pool on the ground under the turntable (alpha fades to 0 → page background shows). */
const poolTexture = () => canvasTexture(256, 256, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(243,166,90,.22)'); g.addColorStop(0.45, 'rgba(243,166,90,.09)'); g.addColorStop(1, 'rgba(243,166,90,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}, { mipmaps: false });

/** Holo scan plane: bright square border, faint fill, scanlines. */
const scanTexture = () => canvasTexture(128, 128, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = rgba(HEX.teal, 0.16); ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = rgba(HEX.teal, 0.12); for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  ctx.strokeStyle = rgba(HEX.teal, 0.95); ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
}, { mipmaps: false });

/** Round soft sprite for point particles. */
const moteTexture = () => canvasTexture(32, 32, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}, { mipmaps: false });

/** Vertical alpha gradient (opaque at the bottom, transparent at the top) — the "real" building dissolving into wireframe. */
const fadeTexture = () => canvasTexture(4, 64, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#ffffff'); g.addColorStop(1, '#000000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}, { mipmaps: false, linear: true });

/* ───────────────────────────── build helpers ───────────────────────────── */

const _unitZ = new THREE.Vector3(0, 0, 1), _unitY = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();

/**
 * Marks a mesh whose transform is driven per frame so mergeStaticMeshes leaves it in the graph.
 * (Meshes that share a material with static siblings would otherwise be baked and detached.)
 */
const animated = (mesh) => { mesh.userData.noMerge = true; return mesh; };

/** Shared unit geometries (scaled per mesh; merged copies bake the scale in). */
function makeShared() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(1, 14, 10),
    plane: new THREE.PlaneGeometry(1, 1),
  };
}

/** Per-diorama registry so the whole diorama can be dimmed to ~55 % in one call. */
function registry() {
  const mats = [], lights = [];
  let last = -1;
  return {
    mat(m) { mats.push({ m, color: m.color.clone(), ei: m.emissiveIntensity ?? 0 }); return m; },
    light(l) { lights.push({ l, i: l.intensity }); return l; },
    apply(v) {
      if (Math.abs(v - last) < 0.002) return; last = v;
      const k = 0.55 + 0.45 * v, ke = 0.6 + 0.4 * v;
      for (const e of mats) { e.m.color.copy(e.color).multiplyScalar(k); if (e.m.emissive) e.m.emissiveIntensity = e.ei * ke; }
      for (const e of lights) e.l.intensity = e.i * (0.3 + 0.7 * v);
    },
  };
}

/** Flat polygon in the XZ plane, `thick` tall, centred on y = 0. Points are [x, z]. */
function flatXZ(points, thick) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, -thick / 2, 0);
  return g;
}

function makeBuilders(G) {
  function box(parent, mat, w, h, d, x, yb, z, o = {}) {
    const m = new THREE.Mesh(G.box, mat); m.scale.set(w, h, d); m.position.set(x, yb + h / 2, z);
    if (o.ry) m.rotation.y = o.ry; if (o.rx) m.rotation.x = o.rx; if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.cast !== false; parent.add(m); return m;
  }
  function cyl(parent, mat, rad, h, x, yb, z, seg = 20, rb = rad, o = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rb, h, seg), mat); m.position.set(x, yb + h / 2, z); m.castShadow = o.cast !== false; parent.add(m); return m;
  }
  function sphere(parent, mat, rad, x, y, z, sy = 1, sz = 1) {
    const m = new THREE.Mesh(G.sphere, mat); m.scale.set(rad, rad * sy, rad * sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  }
  /** Box "bone" between two points (thickness r), oriented along its length. */
  function limb(parent, mat, ax, ay, az, bx, by, bz, r) {
    _dir.set(bx - ax, by - ay, bz - az); const len = _dir.length(); _dir.normalize();
    const m = new THREE.Mesh(G.box, mat); m.scale.set(r, r, len); m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.quaternion.setFromUnitVectors(_unitZ, _dir); m.castShadow = true; parent.add(m); return m;
  }
  return { box, cyl, sphere, limb };
}

/* ───────────────────────────── pedestal ───────────────────────────── */

/**
 * Builds a pedestal into `g` (ring-local diorama group). Returns the content group whose origin is the
 * centre of the pedestal top — everything in a diorama must keep y ≥ 0 in that group so nothing clips.
 */
function pedestal(g, B, { top, side, plinth }) {
  const body = B.cyl(g, side, PED_R, PED_H - 0.02, 0, 0, 0, 40, PED_R + 0.04); body.receiveShadow = true;
  const cap = B.cyl(g, top, PED_R, 0.02, 0, PED_H - 0.02, 0, 40); cap.receiveShadow = true; cap.castShadow = false;
  const base = B.cyl(g, plinth, PED_R + 0.14, 0.07, 0, 0, 0, 40, PED_R + 0.18); base.receiveShadow = true;
  const c = new THREE.Group(); c.position.y = PED_H; g.add(c);
  return c;
}

/* ───────────────────────────── diorama 0: Pit Protocol ───────────────────────────── */

function buildPit(g, G, B, R) {
  const M = {
    top: R.mat(std(0x2a2b2b, { roughness: 0.9 })), side: R.mat(std(0x232424, { roughness: 0.9 })), plinth: R.mat(std(0x161717, { roughness: 1 })),
    tile: R.mat(std(0xffffff, { map: checkerTexture(), roughness: 0.8 })),
    amber: R.mat(std(C.accent, { roughness: 0.45, metalness: 0.1 })),
    ink: R.mat(std(0x1a1b1b, { roughness: 0.6 })),
    teal: R.mat(std(C.teal, { roughness: 0.5 })),
    charcoal: R.mat(std(0x3a3c3c, { roughness: 0.8 })),
    tire: R.mat(std(0x121313, { roughness: 0.95 })),
    rim: R.mat(std(0xc9c9c4, { roughness: 0.3, metalness: 0.75 })),
    rimFresh: R.mat(std(0x3ec6c0, { roughness: 0.3, metalness: 0.6 })),
    suit: R.mat(std(0x1f5e5c, { roughness: 0.9 })),
    helmet: R.mat(std(C.accent, { roughness: 0.35 })),
    visor: R.mat(std(0x111213, { roughness: 0.2, metalness: 0.4 })),
    lamp: R.mat(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.accent, emissiveIntensity: 2.4, roughness: 1 })),
    spark: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff0c8, emissiveIntensity: 4, roughness: 1 }),
    vr: R.mat(std(C.ink, { roughness: 0.6 })),
  };
  const c = pedestal(g, B, M);

  /* pit floor tile (1.38 square: its corners stay inside the r = 1 cap instead of overhanging it) */
  const tile = B.box(c, M.tile, 1.38, 0.03, 1.38, 0, 0, 0, { cast: false }); tile.receiveShadow = true;

  /* car (nose = +z), turned so its left flank and nose face the camera */
  const car = new THREE.Group(); car.position.set(0.02, 0.03, 0.04); car.rotation.y = 0.62; c.add(car);
  B.box(car, M.amber, 0.3, 0.13, 0.78, 0, 0.09, -0.05);                 // monocoque
  B.box(car, M.amber, 0.18, 0.1, 0.32, 0, 0.13, -0.3);                  // engine cover / airbox
  B.box(car, M.amber, 0.22, 0.08, 0.28, 0, 0.09, -0.5);                  // rear body
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.12, 0.52, 4), M.amber);
  nose.rotation.set(Math.PI / 2, Math.PI / 4, 0); nose.position.set(0, 0.125, 0.58); nose.castShadow = true; car.add(nose);
  for (const sx of [-1, 1]) {
    B.box(car, M.amber, 0.16, 0.11, 0.42, sx * 0.22, 0.06, -0.12);      // sidepods
    B.box(car, M.ink, 0.17, 0.04, 0.2, sx * 0.22, 0.13, -0.2);           // sidepod intake lips
    B.box(car, M.ink, 0.02, 0.09, 0.2, sx * 0.44, 0.02, 0.72);           // front wing endplates
    B.box(car, M.ink, 0.02, 0.17, 0.22, sx * 0.36, 0.17, -0.58);         // rear wing endplates
    B.box(car, M.charcoal, 0.03, 0.2, 0.04, sx * 0.1, 0.13, -0.56);      // rear wing pylons
    // suspension arms
    for (const wz of [0.44, -0.36]) { B.box(car, M.charcoal, 0.26, 0.014, 0.03, sx * 0.24, 0.14, wz, { cast: false }); B.box(car, M.charcoal, 0.26, 0.014, 0.03, sx * 0.24, 0.07, wz, { cast: false }); }
  }
  B.box(car, M.ink, 0.88, 0.02, 0.18, 0, 0.03, 0.72);                    // front wing
  B.box(car, M.teal, 0.88, 0.024, 0.03, 0, 0.032, 0.64);                 // teal stripe
  B.box(car, M.ink, 0.72, 0.025, 0.2, 0, 0.33, -0.58);                   // rear wing
  B.box(car, M.teal, 0.72, 0.028, 0.03, 0, 0.33, -0.49);
  B.box(car, M.ink, 0.16, 0.02, 0.18, 0, 0.155, 0.06, { cast: false });  // cockpit
  B.sphere(car, M.teal, 0.05, 0, 0.19, 0.05);                            // driver helmet
  B.box(car, M.charcoal, 0.03, 0.09, 0.03, 0, 0.16, 0.16, { cast: false }); // halo post

  /* wheels: three static (baked into two draw calls), one being changed (its own groups) */
  const tireGeo = new THREE.CylinderGeometry(0.155, 0.155, 0.13, 24), rimGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.135, 16);
  function wheel(parent, x, z, rimMat) {
    const grp = new THREE.Group(); grp.position.set(x, 0.155, z); parent.add(grp);
    const t = new THREE.Mesh(tireGeo, M.tire); t.rotation.z = HALF_PI; t.castShadow = true; grp.add(t);
    const r = new THREE.Mesh(rimGeo, rimMat); r.rotation.z = HALF_PI; grp.add(r);
    return grp;
  }
  for (const [x, z] of [[0.4, 0.44], [0.4, -0.36], [-0.4, -0.36]]) wheel(car, x, z, M.rim);
  // The changing wheel travels along EXIT (rearward-outboard, hugging the flank): the path stays inside the cap and
  // clears the gunman, who kneels front-outboard of the hub (not on the wheel's line) with the gun aimed at the nut.
  const WX = -0.4, WZ = 0.44, EXIT = { x: -0.6, z: -0.8 };
  const GX = -0.66, GZ = 0.57;
  const onPath = (o, s, y) => o.position.set(WX + EXIT.x * s, y, WZ + EXIT.z * s);
  let wheelOld = wheel(car, WX, WZ, M.rim);
  let wheelNew = wheel(car, WX, WZ, M.rimFresh); onPath(wheelNew, 0.8, 0.155); wheelNew.scale.setScalar(0.001);

  /* crew: four kneeling capsules; the one at the changing wheel holds the gun */
  function crew(parent, x, z, face, gun) {
    const f = new THREE.Group(); f.position.set(x, 0, z); f.rotation.y = face; parent.add(f);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 3, 8), M.suit); body.position.y = 0.15; body.castShadow = true; f.add(body);
    B.sphere(f, M.helmet, 0.055, 0, 0.32, 0.01);
    B.box(f, M.visor, 0.06, 0.025, 0.02, 0, 0.31, 0.055, { cast: false });
    B.box(f, M.suit, 0.05, 0.05, 0.12, -0.06, 0, 0.0); B.box(f, M.suit, 0.05, 0.05, 0.12, 0.06, 0, 0.0); // knees
    if (gun) {
      const gunGrp = new THREE.Group(); gunGrp.position.set(0, 0.17, 0.07); f.add(gunGrp);
      const barrel = B.cyl(gunGrp, M.charcoal, 0.022, 0.12, 0, 0, 0, 10); barrel.rotation.x = HALF_PI; barrel.position.set(0, 0, 0.06);
      B.box(gunGrp, M.charcoal, 0.05, 0.05, 0.08, 0, -0.02, 0);
      B.box(gunGrp, M.teal, 0.052, 0.012, 0.03, 0, 0.02, 0.02, { cast: false });
      f.userData.gun = gunGrp;
    }
    return f;
  }
  crew(car, 0.72, 0.44, -HALF_PI, false); crew(car, 0.72, -0.36, -HALF_PI, false); crew(car, -0.72, -0.36, HALF_PI, false);
  const gunman = crew(car, GX, GZ, Math.atan2(WX - GX, WZ - GZ), true);
  const spark = animated(new THREE.Mesh(G.sphere, M.spark)); spark.scale.setScalar(0.001); spark.position.set(WX - 0.1, 0.155, WZ); spark.userData.noPick = true; car.add(spark);
  const sparkLight = new THREE.PointLight(0xffd9a0, 0, 1.4, 2); sparkLight.position.copy(spark.position); car.add(sparkLight);

  /* pit gantry with three amber lamps */
  const gantry = new THREE.Group(); gantry.position.set(0, 0.03, -0.62); c.add(gantry);
  for (const sx of [-0.7, 0.7]) B.box(gantry, M.charcoal, 0.045, 1.08, 0.045, sx, 0, 0);
  B.box(gantry, M.charcoal, 1.48, 0.05, 0.07, 0, 1.06, 0);
  for (const sx of [-0.42, 0, 0.42]) B.box(gantry, M.lamp, 0.14, 0.035, 0.06, sx, 1.02, 0.01, { cast: false });
  const pitLight = R.light(new THREE.PointLight(C.accent, 3.2, 3.2, 2)); pitLight.position.set(0, 1.0, -0.35); c.add(pitLight);

  /* VR headset rack */
  const rack = new THREE.Group(); rack.position.set(0.66, 0.03, -0.2); rack.rotation.y = -0.4; c.add(rack);
  B.cyl(rack, M.charcoal, 0.09, 0.02, 0, 0, 0, 14);
  B.cyl(rack, M.charcoal, 0.018, 0.62, 0, 0.02, 0, 8);
  B.box(rack, M.charcoal, 0.4, 0.03, 0.03, 0, 0.6, 0);
  for (const sx of [-0.11, 0.11]) {
    B.box(rack, M.vr, 0.15, 0.07, 0.085, sx, 0.4, 0.02);
    B.box(rack, M.visor, 0.13, 0.04, 0.012, sx, 0.415, 0.065, { cast: false });
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.011, 6, 18), M.vr); strap.position.set(sx, 0.52, 0.0); strap.rotation.y = HALF_PI; rack.add(strap);
  }

  /* ---- animation: wheel change loop ---- */
  const P = 3.8;
  let cycle = -1;
  function update(dt, t, lit) {
    const k = Math.floor(t / P), tau = t - k * P;
    if (k !== cycle) { cycle = k; [wheelOld, wheelNew] = [wheelNew, wheelOld]; onPath(wheelOld, 0, 0.155); wheelOld.scale.setScalar(1); wheelNew.scale.setScalar(0.001); }
    let gun = 0;
    if (tau < 0.5) gun = 1;
    else if (tau < 1.0) { const e = easeOutCubic((tau - 0.5) / 0.5); onPath(wheelOld, 0.5 * e, 0.155 + 0.14 * Math.sin(e * Math.PI)); wheelOld.rotation.x = e * 1.2; }
    else if (tau < 1.3) { const e = (tau - 1.0) / 0.3; wheelOld.scale.setScalar(Math.max(0.001, 1 - e)); onPath(wheelOld, 0.5 + 0.2 * e, 0.155); }
    if (tau >= 1.05 && tau < 1.65) { const e = easeOutBackSoft((tau - 1.05) / 0.6); wheelNew.scale.setScalar(Math.max(0.001, Math.min(1, e * 1.4))); onPath(wheelNew, 0.8 * (1 - e), 0.155 + 0.1 * Math.sin(Math.min(1, e) * Math.PI)); wheelNew.rotation.x = (1 - e) * 2.0; }
    else if (tau >= 1.65 && tau < 2.15) { onPath(wheelNew, 0, 0.155); wheelNew.rotation.x = 0; gun = 1; }
    else if (tau >= 2.15) { onPath(wheelNew, 0, 0.155); }
    const flick = gun ? 0.55 + 0.45 * Math.abs(Math.sin(t * 61) * Math.sin(t * 23 + 1)) : 0;
    spark.scale.setScalar(Math.max(0.001, 0.05 * flick));
    sparkLight.intensity = 3.5 * flick * (0.3 + 0.7 * lit);
    gunman.userData.gun.position.z = 0.07 - (gun ? 0.01 * Math.abs(Math.sin(t * 40)) : 0);
    gunman.position.y = gun ? 0.006 * Math.abs(Math.sin(t * 40)) : 0;
    // idle: two crew glance up, lamps breathe
    M.lamp.emissiveIntensity = (2.4 + 0.3 * Math.sin(t * 2.3)) * (0.6 + 0.4 * lit);
    car.position.y = 0.03 + 0.002 * Math.sin(t * 30);
  }
  return { update, anchorY: PED_H + 0.7 };
}

/* ───────────────────────────── diorama 1: Hologram Cloud ───────────────────────────── */

function buildHolo(g, G, B, R) {
  const M = {
    top: R.mat(std(0x232526, { roughness: 0.85 })), side: R.mat(std(0x1f2122, { roughness: 0.9 })), plinth: R.mat(std(0x151617, { roughness: 1 })),
    glass: R.mat(std(0x0b0d0e, { roughness: 0.1, metalness: 0.55 })),
    base: R.mat(std(0x1a1c1c, { roughness: 0.7 })),
    puck: R.mat(new THREE.MeshStandardMaterial({ color: 0x0a2a2a, emissive: C.teal, emissiveIntensity: 1.4, roughness: 0.6 })),
    real: R.mat(new THREE.MeshStandardMaterial({ color: 0x1b6f6b, emissive: C.teal, emissiveIntensity: 0.35, roughness: 0.5, transparent: true, alphaMap: fadeTexture(), depthWrite: false })),
  };
  const c = pedestal(g, B, M);
  const r = rng(7);

  /* black glass table on a squat plinth (1.38 square: corners stay inside the r = 1 cap) */
  B.box(c, M.base, 1.08, 0.05, 1.08, 0, 0, 0, { cast: false });
  const table = B.box(c, M.glass, 1.38, 0.09, 1.38, 0, 0.05, 0); table.receiveShadow = true;
  const puck = B.cyl(c, M.puck, 0.13, 0.025, 0, 0.14, 0, 24, 0.13, { cast: false });
  const tealLine = new THREE.LineBasicMaterial({ color: C.teal, transparent: true, opacity: 0.9 });
  const gridLine = new THREE.LineBasicMaterial({ color: C.teal, transparent: true, opacity: 0.22 });
  R.mat(tealLine); R.mat(gridLine);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.38, 0.09, 1.38)), gridLine); edge.position.y = 0.095; c.add(edge);
  // table grid
  const gl = [];
  for (let i = 0; i <= 8; i++) { const p = -0.6 + (i / 8) * 1.2; gl.push(p, 0.145, -0.6, p, 0.145, 0.6, -0.6, 0.145, p, 0.6, 0.145, p); }
  const gridGeo = new THREE.BufferGeometry(); gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gl), 3));
  c.add(new THREE.LineSegments(gridGeo, gridLine));

  /* wireframe city block (one LineSegments) */
  const city = new THREE.Group(); city.position.y = 0.36; c.add(city);
  const lines = [];
  const rect = (x, y, z, w, d) => { const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x - w / 2, y, z - d / 2, x + w / 2, y, z - d / 2, x + w / 2, y, z - d / 2, x + w / 2, y, z + d / 2, x + w / 2, y, z + d / 2, x - w / 2, y, z + d / 2, x - w / 2, y, z + d / 2, x - w / 2, y, z - d / 2]), 3)); return g2; };
  const cells = 4, cell = 0.3;
  let real = null;
  for (let ix = 0; ix < cells; ix++) for (let iz = 0; iz < cells; iz++) {
    if ((ix === 1 && iz === 2) || (ix === 2 && iz === 1)) continue; // plaza
    const x = (ix - (cells - 1) / 2) * cell, z = (iz - (cells - 1) / 2) * cell;
    const w = 0.18 + r() * 0.08, d = 0.18 + r() * 0.08;
    const h = ix === 3 && iz === 3 ? 1.05 : 0.22 + r() * r() * 0.85;
    const bg = new THREE.BoxGeometry(w, h, d); bg.translate(x, h / 2, z);
    lines.push(new THREE.EdgesGeometry(bg)); bg.dispose();
    for (let fy = 0.16; fy < h - 0.06; fy += 0.16) lines.push(rect(x, fy, z, w, d));
    if (h > 0.6 && r() < 0.6) { const bg2 = new THREE.BoxGeometry(w * 0.55, 0.12, d * 0.55); bg2.translate(x, h + 0.06, z); lines.push(new THREE.EdgesGeometry(bg2)); bg2.dispose(); }
    if (ix === 3 && iz === 3) real = { x, z, w, d, h };
  }
  lines.push(rect(0, 0, 0, cells * cell + 0.06, cells * cell + 0.06));
  const cityGeo = mergeLineGeometries(lines); for (const l of lines) l.dispose();
  city.add(new THREE.LineSegments(cityGeo, tealLine));
  // invisible hit box so the wireframe block (lines, which the picker skips) is clickable like solid props
  const hit = new THREE.Mesh(G.box, new THREE.MeshBasicMaterial({ visible: false })); hit.scale.set(cells * cell + 0.1, 1.2, cells * cell + 0.1);
  hit.position.y = 0.6; hit.visible = false; hit.castShadow = false; city.add(animated(hit));
  // the "real" building: solid at the bottom, dissolving upward into its own wireframe
  const realMesh = new THREE.Mesh(new THREE.BoxGeometry(real.w, real.h, real.d), M.real); realMesh.position.set(real.x, real.h / 2, real.z); city.add(realMesh);

  /* scan plane + motes */
  const scan = animated(new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ map: scanTexture(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
  R.mat(scan.material); scan.rotation.x = -HALF_PI; scan.scale.setScalar(1.3); scan.userData.noPick = true; c.add(scan);
  const N = 70, pos = new Float32Array(N * 3), seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (r() - 0.5) * 1.2; pos[i * 3 + 1] = 0.16 + r() * 1.3; pos[i * 3 + 2] = (r() - 0.5) * 1.2; seeds[i] = r() * 10; }
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const moteMat = new THREE.PointsMaterial({ color: C.teal, size: 0.045, map: moteTexture(), sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  R.mat(moteMat);
  c.add(new THREE.Points(moteGeo, moteMat));
  const holoLight = R.light(new THREE.PointLight(C.teal, 2.6, 3.0, 2)); holoLight.position.set(0, 0.7, 0); c.add(holoLight);

  function update(dt, t, lit) {
    city.rotation.y = t * 0.12;
    city.position.y = 0.36 + Math.sin(t * 0.8) * 0.025;
    const p = (t % 2.8) / 2.8;
    scan.position.y = 0.15 + easeInOutCubic(p) * 1.35;
    scan.material.opacity = 0.9 * Math.sin(p * Math.PI) * (0.6 + 0.4 * lit);
    M.puck.emissiveIntensity = (1.4 + 0.4 * Math.sin(t * 3)) * (0.6 + 0.4 * lit);
    if (dt > 0) {
      const a = moteGeo.attributes.position.array;
      for (let i = 0; i < N; i++) { a[i * 3 + 1] += dt * (0.1 + 0.08 * Math.sin(seeds[i])); a[i * 3] += Math.sin(t * 0.7 + seeds[i]) * dt * 0.03; if (a[i * 3 + 1] > 1.55) a[i * 3 + 1] = 0.16; }
      moteGeo.attributes.position.needsUpdate = true;
    }
  }
  return { update, anchorY: PED_H + 0.75 };
}

/* ───────────────────────────── diorama 2: Unseen Blade ───────────────────────────── */

function buildBlade(g, G, B, R) {
  const M = {
    top: R.mat(std(0xffffff, { map: stoneTexture(), roughness: 0.75 })), side: R.mat(std(0x141618, { roughness: 0.85 })), plinth: R.mat(std(0x0f1012, { roughness: 1 })),
    cloth: R.mat(std(0x0e1013, { roughness: 0.5, metalness: 0.05 })),
    sash: R.mat(new THREE.MeshStandardMaterial({ color: C.red, emissive: C.red, emissiveIntensity: 0.35, roughness: 0.7 })),
    blade: R.mat(new THREE.MeshStandardMaterial({ color: 0xe9edf0, emissive: 0xaac4ff, emissiveIntensity: 0.45, roughness: 0.16, metalness: 0.9 })),
    guard: R.mat(std(0x8a6d3b, { roughness: 0.4, metalness: 0.6 })),
    handle: R.mat(std(0x25282b, { roughness: 0.8 })),
    eyes: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.red, emissiveIntensity: 3, roughness: 1 }),
    moon: R.mat(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xdde8ff, emissiveIntensity: 2.2, roughness: 1 })),
  };
  const c = pedestal(g, B, M);

  /* figure: kneeling on the right knee, left hand to the ground, katana out to the right */
  const fig = new THREE.Group(); fig.position.set(0.02, 0.0, 0.08); fig.rotation.y = -0.55; c.add(fig);
  const cl = M.cloth;
  B.box(fig, cl, 0.1, 0.3, 0.1, -0.13, 0, 0.17);                        // left shin (vertical, front)
  B.box(fig, cl, 0.09, 0.05, 0.2, -0.13, 0, 0.21);                       // left foot
  B.limb(fig, cl, -0.13, 0.36, 0.0, -0.13, 0.32, 0.2, 0.11);             // left thigh
  B.limb(fig, cl, 0.11, 0.38, -0.02, 0.11, 0.06, -0.1, 0.11);            // right thigh (down to the knee)
  B.box(fig, cl, 0.09, 0.08, 0.3, 0.11, 0, -0.24);                       // right shin (lying back)
  B.box(fig, cl, 0.08, 0.06, 0.09, 0.11, 0.03, -0.42);                   // right foot
  B.box(fig, cl, 0.27, 0.13, 0.17, 0, 0.32, 0.0);                        // hips
  const torso = animated(B.box(fig, cl, 0.29, 0.34, 0.18, 0, 0.44, 0.02)); torso.rotation.x = 0.16; // breathes
  const sash = B.box(fig, M.sash, 0.07, 0.4, 0.19, 0.0, 0.42, 0.03); sash.rotation.set(0.16, 0, 0.62);
  B.box(fig, M.sash, 0.3, 0.05, 0.19, 0, 0.42, 0.0);                     // belt
  B.sphere(fig, cl, 0.075, -0.17, 0.75, 0.02); B.sphere(fig, cl, 0.075, 0.17, 0.75, 0.02); // shoulders
  const head = new THREE.Group(); head.position.set(0, 0.9, 0.03); fig.add(head);
  B.sphere(head, cl, 0.1, 0, 0, 0);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.135, 0.22, 8), cl); hood.position.set(0, 0.08, -0.01); hood.castShadow = true; head.add(hood);
  for (const sx of [-0.035, 0.035]) B.box(head, M.eyes, 0.028, 0.012, 0.01, sx, 0.005, 0.098, { cast: false });
  B.box(head, cl, 0.12, 0.05, 0.03, 0, -0.035, 0.09, { cast: false });   // mask
  // left arm → ground
  B.limb(fig, cl, -0.19, 0.72, 0.02, -0.31, 0.44, 0.15, 0.075);
  B.limb(fig, cl, -0.31, 0.44, 0.15, -0.36, 0.06, 0.3, 0.07);
  B.sphere(fig, cl, 0.045, -0.36, 0.045, 0.31);
  // right arm → katana
  B.limb(fig, cl, 0.19, 0.72, 0.02, 0.37, 0.58, 0.1, 0.075);
  B.limb(fig, cl, 0.37, 0.58, 0.1, 0.52, 0.42, 0.22, 0.07);
  B.sphere(fig, cl, 0.05, 0.52, 0.42, 0.22);
  // katana (local +y = blade), oriented via a unit vector
  const kat = new THREE.Group(); kat.position.set(0.52, 0.42, 0.22); fig.add(kat);
  B.box(kat, M.handle, 0.035, 0.24, 0.035, 0, -0.24, 0);
  for (let i = 0; i < 4; i++) B.box(kat, M.sash, 0.037, 0.02, 0.037, 0, -0.22 + i * 0.055, 0, { cast: false });
  B.box(kat, M.guard, 0.1, 0.014, 0.06, 0, 0, 0);
  const seg1 = B.box(kat, M.blade, 0.034, 0.5, 0.008, 0, 0.01, 0);
  const seg2 = B.box(kat, M.blade, 0.03, 0.46, 0.007, 0, 0.5, 0); seg2.rotation.z = 0.05; seg2.position.x -= 0.012;
  seg1.castShadow = seg2.castShadow = true;
  kat.quaternion.setFromUnitVectors(_unitY, new THREE.Vector3(0.62, 0.72, 0.32).normalize());
  // scarf tails (animated per frame → kept out of the static merge)
  const scarf = new THREE.Group(); scarf.position.set(0.02, 0.86, -0.08); fig.add(scarf);
  const tail1 = animated(B.box(scarf, M.sash, 0.05, 0.025, 0.3, 0, 0, -0.15, { cast: false }));
  const tail2 = animated(B.box(scarf, M.sash, 0.04, 0.02, 0.24, 0.05, -0.02, -0.12, { cast: false }));

  /* echo-location rings: flat crimson bands + faint pale bands + a camera-facing torus */
  const ringMat = new THREE.MeshBasicMaterial({ color: C.red, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const paleMat = new THREE.MeshBasicMaterial({ color: C.moon, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  R.mat(ringMat); R.mat(paleMat);
  const bandGeo = new THREE.RingGeometry(0.93, 1.0, 64), paleGeo = new THREE.RingGeometry(0.74, 0.9, 64), torusGeo = new THREE.TorusGeometry(1, 0.008, 5, 56);
  const pulses = [];
  for (let j = 0; j < 3; j++) {
    const grp = new THREE.Group(); grp.position.set(0, 0.012, 0.05); c.add(grp);
    const band = animated(new THREE.Mesh(bandGeo, ringMat.clone())); band.rotation.x = -HALF_PI; grp.add(band);
    const pale = animated(new THREE.Mesh(paleGeo, paleMat.clone())); pale.rotation.x = -HALF_PI; grp.add(pale);
    const tor = animated(new THREE.Mesh(torusGeo, ringMat.clone())); tor.position.set(0, 0.55, 0); c.add(tor);
    R.mat(band.material); R.mat(pale.material); R.mat(tor.material);
    band.userData.noPick = pale.userData.noPick = tor.userData.noPick = true; // fading FX: never a click target
    pulses.push({ grp, band, pale, tor });
  }
  const pulseLight = new THREE.PointLight(C.red, 0, 2.4, 2); pulseLight.position.set(0, 0.35, 0.05); c.add(pulseLight);

  /* moon + moonlight rim */
  B.sphere(c, M.moon, 0.065, -0.72, 1.42, -0.62).castShadow = false;
  const moonLight = R.light(new THREE.PointLight(C.moon, 4.5, 5, 2)); moonLight.position.set(-0.7, 1.4, -0.55); c.add(moonLight);

  const PERIOD = 1.6, LIFE = 2.3;
  const _cam = new THREE.Vector3();
  function update(dt, t, lit, camera) {
    // breathing + scarf
    torso.position.y = 0.61 + Math.sin(t * 1.4) * 0.006;
    head.position.y = 0.9 + Math.sin(t * 1.4) * 0.008;
    tail1.rotation.y = Math.sin(t * 2.1) * 0.25; tail1.rotation.x = Math.sin(t * 1.7) * 0.15;
    tail2.rotation.y = Math.sin(t * 2.4 + 1) * 0.3; tail2.rotation.x = Math.sin(t * 1.9 + 0.5) * 0.18;
    kat.rotation.z = Math.sin(t * 0.9) * 0.02;
    // pulses
    const k = Math.floor(t / PERIOD), age0 = t - k * PERIOD;
    let newest = 0;
    camera.getWorldPosition(_cam);
    for (let j = 0; j < pulses.length; j++) {
      const P = pulses[j], age = age0 + j * PERIOD, p = age / LIFE;
      if (p >= 1) { P.band.material.opacity = 0; P.pale.material.opacity = 0; P.tor.material.opacity = 0; continue; }
      const s = 0.12 + easeOutCubic(p) * 0.95, fade = Math.pow(1 - p, 1.6) * (0.6 + 0.4 * lit);
      P.grp.scale.setScalar(s);
      P.band.material.opacity = 0.95 * fade; P.pale.material.opacity = 0.3 * fade;
      // grows to r = 1.1 (not more): the billboarded ring dips through the cap plane at its sides, and at 1.1 those
      // points stay inside the pedestal wall (r ≈ 0.95) for the 23° ± 2.5° parallax pitch range
      P.tor.scale.setScalar(0.1 + easeOutCubic(p) * 1.0); P.tor.material.opacity = 0.7 * fade;
      P.tor.lookAt(_cam);
      if (j === 0) newest = 1 - p;
    }
    pulseLight.intensity = 2.2 * newest * (0.3 + 0.7 * lit);
  }
  return { update, anchorY: PED_H + 0.65 };
}

/* ───────────────────────────── diorama 3: Target Destroyed ───────────────────────────── */

function buildJet(g, G, B, R) {
  const M = {
    top: R.mat(std(0xffffff, { map: sandTexture(), roughness: 0.95 })), side: R.mat(std(0x7d5f3c, { roughness: 0.95 })), plinth: R.mat(std(0x4a3a27, { roughness: 1 })),
    dune: R.mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 })),
    rock: R.mat(std(0x5a4b3a, { roughness: 1 })),
    asphalt: R.mat(std(0xffffff, { map: runwayTexture(), roughness: 0.9 })),
    concrete: R.mat(std(0x76766e, { roughness: 0.85 })),
    door: R.mat(std(0x1c1d1f, { roughness: 0.9 })),
    rwLight: R.mat(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffe0b0, emissiveIntensity: 2.4, roughness: 1 })),
    thrLight: R.mat(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.flir, emissiveIntensity: 2.2, roughness: 1 })),
    frame: R.mat(std(0x9ba4ab, { roughness: 0.55, metalness: 0.3 })),
    dark: R.mat(std(0x2c3033, { roughness: 0.6, metalness: 0.2 })),
    glass: R.mat(new THREE.MeshStandardMaterial({ color: 0x143c3d, emissive: C.teal, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.6 })),
    burner: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb057, emissiveIntensity: 3, roughness: 1 }),
    drone: R.mat(std(0x232529, { roughness: 0.5, metalness: 0.35 })),
    rotor: R.mat(new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.8, transparent: true, opacity: 0.55 })),
    redLight: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a2a, emissiveIntensity: 3.5, roughness: 1 }),
    missile: R.mat(std(0xd9dcdc, { roughness: 0.4, metalness: 0.4 })),
    flir: new THREE.MeshBasicMaterial({ color: C.flir }),
    burst: new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    shock: new THREE.MeshBasicMaterial({ color: 0xffb86a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  R.mat(M.flir);
  const c = pedestal(g, B, M);

  /* desert floor: three crescent dunes, a lit runway, an arched hangar and a control tower, a few rocks.
     Everything stays ≤ 0.96 from the centre — the dunes are rotated ellipses, checked as such — so nothing pokes out
     through the pedestal wall, and the tallest prop (tower mast, 0.61) sits well under the banking jet's inner wing
     (≥ 0.85 at that radius). */
  const duneLit = new THREE.Color(0xb48c58), duneShade = new THREE.Color(0x4e3620), _col = new THREE.Color();
  /** Hemisphere dune (a × h × b, yawed by `rot`), two-tone: the windward face keeps the lit sand, the lee face goes
      into shade with the split running along the crest — the shape reads from any angle, even under the spot. */
  function dune(x, z, a, b, h, rot, lee) {
    const geo = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, HALF_PI);
    const n = geo.attributes.position, colors = new Float32Array(n.count * 3), lx = Math.sin(lee), lz = Math.cos(lee);
    for (let i = 0; i < n.count; i++) {
      const px = n.getX(i), pz = n.getZ(i);
      const wx = px * Math.cos(rot) + pz * Math.sin(rot), wz = -px * Math.sin(rot) + pz * Math.cos(rot); // unit-sphere normal, yawed
      const k = smoothstep(0.0, 0.14, wx * lx + wz * lz);
      _col.copy(duneLit).lerp(duneShade, k).toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const m = new THREE.Mesh(geo, M.dune); m.scale.set(a, h, b); m.position.set(x, -0.02, z); m.rotation.y = rot; m.receiveShadow = true; c.add(m);
    return m;
  }
  // lee faces left-front (the key light comes from the right-front), so the split is visible from the camera
  const LEE = -1.25;
  dune(0.34, -0.58, 0.50, 0.24, 0.17, -0.50, LEE);    // back-right, the big one (max r 0.92)
  dune(0.62, 0.42, 0.36, 0.18, 0.12, 0.98, LEE);      // front-right (0.93)
  dune(-0.62, 0.30, 0.34, 0.20, 0.11, -1.12, LEE);    // front-left (0.89)
  for (const [x, z, sc] of [[-0.15, 0.38, 0.045], [0.06, 0.5, 0.03], [0.74, -0.42, 0.04], [-0.62, -0.62, 0.035], [0.18, 0.72, 0.028]]) B.sphere(c, M.rock, sc, x, sc * 0.4, z, 0.7, 0.8);

  /* runway (front-left → back-right) with amber edge lights and green threshold combs */
  const RW = { x: -0.08, z: 0.12, rot: -0.5, len: 1.1 };
  const rwDir = { x: Math.sin(RW.rot), z: Math.cos(RW.rot) }, rwPer = { x: Math.cos(RW.rot), z: -Math.sin(RW.rot) };
  const rwAt = (s, w) => [RW.x + rwDir.x * s + rwPer.x * w, RW.z + rwDir.z * s + rwPer.z * w];
  B.box(c, M.asphalt, 0.15, 0.008, RW.len, RW.x, 0, RW.z, { cast: false, ry: RW.rot }).receiveShadow = true;
  for (let i = 0; i <= 8; i++) for (const w of [-0.1, 0.1]) { const [x, z] = rwAt(-0.5 + i * 0.125, w); B.box(c, M.rwLight, 0.02, 0.018, 0.02, x, 0, z, { cast: false }); }
  for (const s of [-0.58, 0.58]) for (let i = 0; i < 4; i++) { const [x, z] = rwAt(s, -0.06 + i * 0.04); B.box(c, M.thrLight, 0.018, 0.018, 0.018, x, 0, z, { cast: false }); }
  // One point light plays two parts (every extra light costs per fragment on every lit material): a warm pool over the
  // runway lights while idle, and the hit flash — it jumps to the burst for 0.25 s, then returns to the runway.
  const flash = new THREE.PointLight(0xffb070, 0, 2.0, 2); flash.position.set(RW.x, 0.18, RW.z); c.add(flash);

  /* hangar: half-pipe arch with a dark door facing the runway, a lamp over the door */
  const hangar = new THREE.Group(); hangar.position.set(-0.4, 0, -0.35); hangar.rotation.y = RW.rot; c.add(hangar);
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 14, 1, false, HALF_PI, Math.PI), M.concrete); arch.rotation.x = HALF_PI; arch.castShadow = true; hangar.add(arch);
  const doorGeo = new THREE.CircleGeometry(0.16, 14, 0, Math.PI);
  const door = new THREE.Mesh(doorGeo, M.door); door.position.set(0, 0, 0.202); hangar.add(door);
  B.box(hangar, M.rwLight, 0.04, 0.02, 0.02, 0, 0.175, 0.205, { cast: false });
  B.box(hangar, M.door, 0.12, 0.012, 0.42, 0.21, 0, 0, { cast: false });   // service strip beside the hangar

  /* control tower: shaft, cab with a teal glass band, mast + red beacon */
  const tower = new THREE.Group(); tower.position.set(0.55, 0, -0.1); tower.rotation.y = 0.3; c.add(tower);
  B.cyl(tower, M.concrete, 0.05, 0.3, 0, 0, 0, 10, 0.07);
  B.box(tower, M.concrete, 0.17, 0.08, 0.17, 0, 0.3, 0);
  B.box(tower, M.glass, 0.176, 0.045, 0.176, 0, 0.38, 0);
  B.box(tower, M.concrete, 0.19, 0.02, 0.19, 0, 0.425, 0);
  B.cyl(tower, M.dark, 0.006, 0.14, 0, 0.445, 0, 6);
  B.box(tower, M.redLight, 0.026, 0.026, 0.026, 0, 0.585, 0, { cast: false });

  /* F-16 (nose = +z) */
  const jet = new THREE.Group(); jet.rotation.order = 'YXZ'; c.add(jet);
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.078, 0.82, 10), M.frame); fus.rotation.x = HALF_PI; fus.castShadow = true; jet.add(fus);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.27, 10), M.dark); cone.rotation.x = HALF_PI; cone.position.z = 0.545; cone.castShadow = true; jet.add(cone);
  B.sphere(jet, M.glass, 0.062, 0, 0.06, 0.2, 0.9, 2.4);
  B.box(jet, M.frame, 0.09, 0.06, 0.42, 0, 0.03, -0.16);                // spine
  B.box(jet, M.dark, 0.11, 0.075, 0.3, 0, -0.085, 0.04);                 // intake
  const wingR = new THREE.Mesh(flatXZ([[0.05, 0.14], [0.47, -0.3], [0.47, -0.38], [0.05, -0.36]], 0.022), M.frame); wingR.castShadow = true; jet.add(wingR);
  const wingL = new THREE.Mesh(flatXZ([[-0.05, 0.14], [-0.47, -0.3], [-0.47, -0.38], [-0.05, -0.36]], 0.022), M.frame); wingL.castShadow = true; jet.add(wingL);
  jet.add(new THREE.Mesh(flatXZ([[0.05, -0.32], [0.24, -0.46], [0.24, -0.51], [0.05, -0.51]], 0.018), M.frame));
  jet.add(new THREE.Mesh(flatXZ([[-0.05, -0.32], [-0.24, -0.46], [-0.24, -0.51], [-0.05, -0.51]], 0.018), M.frame));
  const fin = new THREE.Mesh(flatXZ([[0.04, -0.2], [0.34, -0.45], [0.34, -0.5], [0.04, -0.5]], 0.018), M.frame); fin.rotation.z = HALF_PI; fin.castShadow = true; jet.add(fin);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 10), M.dark); nozzle.rotation.x = HALF_PI; nozzle.position.z = -0.45; jet.add(nozzle);
  const burner = animated(B.sphere(jet, M.burner, 0.036, 0, 0, -0.52, 1, 2.2)); burner.castShadow = false;
  for (const sx of [-0.47, 0.47]) { const m = B.cyl(jet, M.dark, 0.013, 0.2, sx, -0.01, -0.28, 8); m.rotation.x = HALF_PI; }
  jet.scale.setScalar(0.92);

  /* drones (quads) */
  const drones = [];
  for (let k = 0; k < 3; k++) {
    const d = new THREE.Group(); c.add(d);
    B.box(d, M.drone, 0.075, 0.03, 0.075, 0, -0.015, 0);
    for (const a of [Math.PI / 4, -Math.PI / 4]) B.box(d, M.drone, 0.19, 0.012, 0.016, 0, -0.006, 0, { ry: a, cast: false });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) B.cyl(d, M.rotor, 0.04, 0.004, sx * 0.068, 0.002, sz * 0.068, 12, 0.04, { cast: false });
    B.sphere(d, M.redLight, 0.016, 0, 0.012, 0.03).castShadow = false;
    d.scale.setScalar(1.45);
    drones.push({ g: d, alive: 1, lead: 1.1 + k * 1.05, h: 1.06 + k * 0.14, jitter: k * 2.1, pos: new THREE.Vector3() });
  }

  /* missile + trail + hit burst */
  const missile = new THREE.Group(); c.add(missile); missile.visible = false;
  const mb = B.cyl(missile, M.missile, 0.012, 0.13, 0, 0, 0, 8); mb.rotation.x = HALF_PI; mb.castShadow = false;
  const mt = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 8), M.missile); mt.rotation.x = HALF_PI; mt.position.z = 0.085; missile.add(mt);
  B.sphere(missile, M.burner, 0.014, 0, 0, -0.075).castShadow = false;
  missile.traverse((o) => { if (o.isMesh) o.userData.noPick = true; }); // hidden between shots: never a click target
  const TRAIL = 18;
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(TRAIL * 3), trailCol = new Float32Array(TRAIL * 3);
  for (let i = 0; i < TRAIL; i++) { const f = 1 - i / (TRAIL - 1); trailCol[i * 3] = 1.0 * f; trailCol[i * 3 + 1] = 0.75 * f; trailCol[i * 3 + 2] = 0.45 * f; }
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const trail = new THREE.Line(trailGeo, trailMat); c.add(trail);
  // Burst = a hot core (r ≤ 0.13, 0.25 s), a thin camera-facing shock ring (r ≤ 0.2, 0.4 s), a fan of sparks under
  // gravity (0.55 s) and a point-light flash — a flash of an explosion, not a ball that competes with the jet.
  const burst = animated(new THREE.Mesh(G.sphere, M.burst)); burst.scale.setScalar(0.001); burst.userData.noPick = true; c.add(burst);
  const shock = animated(new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 4, 36), M.shock)); shock.scale.setScalar(0.001); shock.userData.noPick = true; c.add(shock);
  const SPARKS = 18, sparkPos = new Float32Array(SPARKS * 3), sparkVel = new Float32Array(SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffc27a, size: 0.05, map: moteTexture(), sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.visible = false; c.add(sparks);
  const sparkRng = rng(29);

  /* FLIR crosshair (faces the camera, hovers over the current target) */
  const cross = new THREE.Group(); c.add(cross);
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.0075, 5, 40), M.flir); ringM.castShadow = false; cross.add(ringM);
  for (let i = 0; i < 4; i++) { const a = i * HALF_PI; const tk = B.box(cross, M.flir, 0.06, 0.009, 0.009, Math.cos(a) * 0.2, 0, 0, { cast: false }); tk.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0); tk.rotation.z = a; }
  B.box(cross, M.flir, 0.02, 0.02, 0.009, 0, 0, 0, { cast: false });
  const crossPos = new THREE.Vector3(0, 1.0, 0.9);

  /* ---- animation ---- */
  const ORBIT = 0.68, DR = 0.9, SPEED = 0.85, CYCLE = 4.2;
  const state = { target: 0, phase: 'idle', cycle: -1, mpos: new THREE.Vector3(), mdir: new THREE.Vector3(), hitT: 0, hitPos: new THREE.Vector3() };
  const _cam = new THREE.Vector3(), _tmp = new THREE.Vector3(), _jetPos = new THREE.Vector3();
  const history = [];
  function update(dt, t, lit, camera) {
    const a = t * SPEED;
    camera.getWorldPosition(_cam);
    // jet: circle, bank inward, gentle porpoise
    const h = 1.02 + Math.sin(t * 0.9) * 0.05;
    _jetPos.set(Math.cos(a) * ORBIT, h, -Math.sin(a) * ORBIT);
    jet.position.copy(_jetPos);
    jet.rotation.set(-0.08 + Math.sin(t * 0.9) * 0.08, a + Math.PI, -0.62 + Math.sin(t * 1.7) * 0.06);
    burner.scale.set(0.036, 0.036, 0.036 * (2.0 + 0.6 * Math.abs(Math.sin(t * 37))));
    M.burner.emissiveIntensity = 3 * (0.6 + 0.4 * lit);
    // drones: ahead of the jet on a slightly wider orbit, jittering
    for (let k = 0; k < drones.length; k++) {
      const d = drones[k], aa = a + d.lead + Math.sin(t * 0.6 + d.jitter) * 0.12;
      d.pos.set(Math.cos(aa) * DR + Math.sin(t * 1.3 + d.jitter) * 0.05, d.h + Math.sin(t * 1.1 + d.jitter) * 0.06, -Math.sin(aa) * DR);
      d.g.position.copy(d.pos); d.g.rotation.y = aa + HALF_PI; d.g.rotation.z = Math.sin(t * 1.3 + d.jitter) * 0.2;
      if (d.alive < 1) { d.alive = Math.min(1, d.alive + dt * 1.2); d.g.scale.setScalar(Math.max(0.001, 1.45 * easeOutBackSoft(d.alive))); }
    }
    // missile cycle: launch → home → burst → respawn
    const k = Math.floor(t / CYCLE), tau = t - k * CYCLE;
    if (k !== state.cycle && dt > 0) { state.cycle = k; state.phase = 'flying'; state.mpos.copy(_jetPos); state.mdir.set(-Math.sin(a), 0, -Math.cos(a)); missile.visible = true; history.length = 0; trailMat.opacity = 0.9; }
    if (state.phase === 'flying') {
      const tgt = drones[state.target].pos;
      _tmp.copy(tgt).sub(state.mpos); const dist = _tmp.length(); _tmp.normalize();
      state.mdir.lerp(_tmp, damp(0.18, dt)).normalize();
      state.mpos.addScaledVector(state.mdir, dt * 2.3);
      missile.position.copy(state.mpos); missile.lookAt(_tmp.copy(state.mpos).add(state.mdir));
      history.unshift(state.mpos.x, state.mpos.y, state.mpos.z); if (history.length > TRAIL * 3) history.length = TRAIL * 3;
      if (dist < 0.07 || tau > 2.4) {
        state.phase = 'hit'; state.hitT = t; state.hitPos.copy(tgt); missile.visible = false;
        drones[state.target].alive = 0; drones[state.target].g.scale.setScalar(0.001); state.target = (state.target + 1) % drones.length;
        // seed the spark fan: outward directions, a little upward bias, the missile's momentum carried on
        for (let i = 0; i < SPARKS; i++) {
          const th = sparkRng() * Math.PI * 2, ph = (sparkRng() - 0.35) * 1.6, sp = 0.55 + sparkRng() * 0.9;
          sparkVel[i * 3] = Math.cos(th) * Math.cos(ph) * sp + state.mdir.x * 0.5; sparkVel[i * 3 + 1] = Math.sin(ph) * sp + 0.15; sparkVel[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * sp + state.mdir.z * 0.5;
          sparkPos[i * 3] = tgt.x; sparkPos[i * 3 + 1] = tgt.y; sparkPos[i * 3 + 2] = tgt.z;
        }
        sparks.visible = true; burst.position.copy(tgt); shock.position.copy(tgt); flash.position.copy(tgt);
      }
    }
    if (state.phase === 'hit') {
      const age = t - state.hitT, e = age / 0.55;
      if (e >= 1) { state.phase = 'idle'; burst.scale.setScalar(0.001); shock.scale.setScalar(0.001); M.burst.opacity = M.shock.opacity = 0; sparkMat.opacity = 0; sparks.visible = false; }
      else {
        const ec = Math.min(1, age / 0.25), er = Math.min(1, age / 0.4);
        burst.scale.setScalar(0.03 + easeOutCubic(ec) * 0.1); M.burst.opacity = Math.pow(1 - ec, 1.5);
        shock.scale.setScalar(0.03 + easeOutCubic(er) * 0.17); M.shock.opacity = 0.85 * Math.pow(1 - er, 1.6); shock.lookAt(_cam);
        if (ec < 1) { flash.position.copy(state.hitPos); flash.intensity = 6 * Math.pow(1 - ec, 2) * (0.4 + 0.6 * lit); }
        else { flash.position.set(RW.x, 0.18, RW.z); flash.intensity = 0; }
        sparkMat.opacity = Math.pow(1 - e, 1.2) * (0.7 + 0.3 * lit); sparkMat.size = 0.05 * (1 - 0.5 * e);
        if (dt > 0) {
          for (let i = 0; i < SPARKS; i++) { sparkVel[i * 3 + 1] -= dt * 1.8; sparkPos[i * 3] += sparkVel[i * 3] * dt; sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt; sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt; }
          sparkGeo.attributes.position.needsUpdate = true;
        }
      }
    }
    if (state.phase !== 'hit') { flash.position.set(RW.x, 0.18, RW.z); flash.intensity += (0.9 * (0.3 + 0.7 * lit) - flash.intensity) * (dt > 0 ? damp(0.08, dt) : 1); }
    if (state.phase !== 'flying') trailMat.opacity = Math.max(0, trailMat.opacity - dt * 1.6);
    // trail buffer: pad with the last known point
    const p = trailGeo.attributes.position.array;
    for (let i = 0; i < TRAIL; i++) { const j = Math.min(i * 3, Math.max(0, history.length - 3)); if (history.length) { p[i * 3] = history[j]; p[i * 3 + 1] = history[j + 1]; p[i * 3 + 2] = history[j + 2]; } else { p[i * 3] = _jetPos.x; p[i * 3 + 1] = _jetPos.y; p[i * 3 + 2] = _jetPos.z; } }
    trailGeo.attributes.position.needsUpdate = true;
    // crosshair follows the current target and faces the camera
    const tgtPos = drones[state.target].pos;
    crossPos.lerp(tgtPos, dt > 0 ? damp(0.12, dt) : 1);
    cross.position.copy(crossPos);
    cross.lookAt(_cam);
    cross.rotateZ(t * 0.7);
    const pulse = 1 + 0.06 * Math.sin(t * 6); cross.scale.setScalar(pulse);
    M.redLight.emissiveIntensity = (2.5 + 1.5 * Math.abs(Math.sin(t * 4))) * (0.6 + 0.4 * lit);
  }
  return { update, anchorY: PED_H + 0.9 };
}

/* ───────────────────────────── scene ───────────────────────────── */

/**
 * Initialise the City Crafters turntable.
 * @param {{canvas:HTMLCanvasElement, reducedMotion?:boolean, onFocus?:(i:number)=>void}} opts
 * @returns {{focus(i:number):void, destroy():void, pause():void, resume():void, resize():void, stats():object}|null}
 */
export function initCityScene({ canvas, reducedMotion = false, onFocus = null } = {}) {
  if (!canvas) return null;
  const rig = createRig({ canvas, reducedMotion, shadows: true });
  if (!rig) return null;
  const { scene, camera, pointer, size, tweens } = rig;
  rig.renderer.toneMappingExposure = 1.35;

  const G = makeShared();
  const B = makeBuilders(G);

  /* ---- turntable base ---- */
  const base = new THREE.Group(); scene.add(base);
  const discTop = std(0xffffff, { map: discTexture(), roughness: 0.9 });
  const discSide = std(0x181919, { roughness: 0.9 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(RING_R + 1.35, RING_R + 1.45, 0.16, 72), [discSide, discTop, discSide]);
  disc.position.y = -0.08; disc.receiveShadow = true; base.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RING_R + 1.4, 0.018, 5, 96), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.accent, emissiveIntensity: 1.1, roughness: 1 }));
  rim.rotation.x = HALF_PI; rim.position.y = 0.0; base.add(rim);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false }));
  pool.rotation.x = -HALF_PI; pool.position.y = -0.17; base.add(pool);

  /* ---- ring + dioramas ---- */
  const ring = new THREE.Group(); base.add(ring);
  const builders = [buildPit, buildHolo, buildBlade, buildJet];
  const dioramas = [];
  for (let i = 0; i < 4; i++) {
    const theta = i * HALF_PI;
    const g = new THREE.Group(); g.position.set(Math.sin(theta) * RING_R, 0, Math.cos(theta) * RING_R); g.rotation.y = theta; ring.add(g);
    const R = registry();
    const built = builders[i](g, G, B, R);
    dioramas.push({ id: DIORAMAS[i], g, theta, R, update: built.update, anchorY: built.anchorY, lit: i === 0 ? 1 : 0 });
  }
  mergeStaticMeshes(ring);
  // Pick list: every real mesh of every diorama (pedestal, props, figures — merged or not), tagged with its index,
  // so the raycast hits exactly what is visible and the nearest geometry wins (a back diorama's swordsman above a
  // front pedestal is his, empty sky is nobody's). Lines/points are skipped, and so are `userData.noPick` FX meshes
  // (faded rings, the hidden missile, the burst, the scan plane) — the raycaster itself ignores `.visible`, which is
  // exactly what the holo block's invisible hit box relies on.
  const pickables = [];
  dioramas.forEach((d, i) => d.g.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.userData.noPick) return;
    o.userData.pick = i;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    pickables.push(o);
  }));

  /* ---- lights ---- */
  scene.add(new THREE.HemisphereLight(0x35555c, 0x3a2717, 1.5));
  const key = new THREE.DirectionalLight(0xffd3a6, 2.4); key.position.set(4.5, 8.5, 6.5); key.target.position.set(0, 0.4, 0); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4.6, right: 4.6, top: 4.6, bottom: -4.6, near: 1, far: 30 });
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.04; key.shadow.radius = 3;
  const rimL = new THREE.DirectionalLight(C.teal, 2.0); rimL.position.set(-6, 4.5, -7); rimL.target.position.set(0, 0.8, 0); scene.add(rimL, rimL.target);
  const spot = new THREE.SpotLight(C.accent, 70, 13, 0.5, 0.75, 1.5); spot.position.set(1.4, 5.8, RING_R + 2.4); spot.target.position.set(0, 0.5, RING_R); scene.add(spot, spot.target);

  /* ---- camera ---- */
  // 23° pitch (not lower): the opposite pedestal sits straight behind the focused one, and this much tilt lifts its
  // content clear of the front diorama's tallest prop (the pit gantry) instead of stacking the two silhouettes.
  const cam = { yaw: 0, pitch: 23 * DEG, dist: 12, target: new THREE.Vector3(0, 0.45, 1.0) };
  // hull of what is actually there: the four pedestal volumes (front/right/back/left) + the turntable edge
  const vol = (cx, cz) => boxCorners(cx - 1.1, -0.05, cz - 1.1, cx + 1.1, 2.05, cz + 1.1);
  const hull = [...vol(0, RING_R), ...vol(RING_R, 0), ...vol(0, -RING_R), ...vol(-RING_R, 0), new THREE.Vector3(0, -0.2, RING_R + 1.45), new THREE.Vector3(-RING_R - 1.45, -0.1, 0), new THREE.Vector3(RING_R + 1.45, -0.1, 0)];
  const fitWide = { points: hull, h: true, v: true };
  const fitFrontH = { points: [...vol(0, RING_R), new THREE.Vector3(-RING_R - 0.3, 0.5, 0), new THREE.Vector3(RING_R + 0.3, 0.5, 0)], h: true, v: false };
  const fitFrontV = { points: [...vol(0, RING_R), ...vol(0, -RING_R), new THREE.Vector3(0, -0.2, RING_R + 1.45)], h: false, v: true };
  rig.onResize = (w, h) => {
    const aspect = w / h;
    const narrow = aspect < 1.6;
    camera.fov = narrow ? 36 : 30; camera.updateProjectionMatrix();
    cam.target.set(0, narrow ? 0.7 : 0.45, narrow ? 1.3 : 1.0);
    cam.dist = fitDistance(camera, cam.yaw, cam.pitch, cam.target, narrow ? [fitFrontH, fitFrontV] : [fitWide], narrow ? 0.96 : 0.95);
  };

  /* ---- turntable state ---- */
  const T = { angle: 0, from: 0, to: 0, t: 0, tweening: false, drift: 0, holdUntil: HOLD_S, focused: 0 };
  function focus(i) {
    i = Number(i);
    if (!Number.isInteger(i) || i < 0 || i > 3 || rig.destroyed) return;
    let delta = wrapAngle(-i * HALF_PI - T.angle);
    if (Math.abs(Math.abs(delta) - Math.PI) < 1e-4) delta = Math.PI;
    T.from = T.angle; T.to = T.angle + delta; T.t = 0; T.tweening = true; T.focused = i;
    T.holdUntil = rig.time + HOLD_S; T.drift = 0;
    if (rig.reducedMotion) { T.angle = T.to; T.tweening = false; rig.requestFrame(); }
  }

  /* ---- intro ---- */
  const state = { dolly: reducedMotion ? 1 : 1.1 };
  base.position.y = reducedMotion ? 0 : -0.5;
  tweens.add({ delay: 0, duration: 0.9, onUpdate: (e) => { base.position.y = -0.5 * (1 - e); } });
  dioramas.forEach((d, i) => {
    if (!reducedMotion) { d.g.position.y = -1.2; d.g.scale.setScalar(0.001); d.g.visible = false; }
    tweens.add({ delay: 0.12 + i * 0.14, duration: 0.86, ease: easeOutBackSoft, onUpdate: (e) => { d.g.visible = true; d.g.position.y = -1.2 * (1 - Math.min(1, e)); d.g.scale.setScalar(Math.max(0.001, e)); } });
  });
  tweens.add({ delay: 0, duration: 1.6, ease: easeInOutCubic, onUpdate: (e) => { state.dolly = 1.1 - 0.1 * e; } });

  /* ---- picking ---- */
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    return hits.length ? hits[0].object.userData.pick : -1;
  }
  const press = { x: 0, y: 0, t: 0, id: -1 };
  const hover = { x: 0, y: 0, dirty: false, cursor: '' };
  const setCursor = (v) => { if (hover.cursor !== v) { hover.cursor = v; canvas.style.cursor = v; } };
  const onDown = (e) => { press.x = e.clientX; press.y = e.clientY; press.t = performance.now(); press.id = e.pointerId; };
  const onUp = (e) => {
    if (e.pointerId !== press.id) return; press.id = -1;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8 || performance.now() - press.t > 700) return;
    const i = pick(e.clientX, e.clientY);
    if (i >= 0) onFocus?.(i);
  };
  const onMove = (e) => {
    hover.x = e.clientX; hover.y = e.clientY; hover.dirty = true;
    if (rig.reducedMotion) { setCursor(pick(e.clientX, e.clientY) >= 0 ? 'pointer' : ''); hover.dirty = false; }
  };
  const onOut = () => { hover.dirty = false; setCursor(''); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerleave', onOut);
  canvas.addEventListener('pointercancel', onOut);

  /* ---- per frame ---- */
  const _wp = new THREE.Vector3();
  rig.onFrame = (dt, t) => {
    // turntable: focus ease → hold → drift
    if (T.tweening) {
      T.t += dt; const p = Math.min(1, T.t / FOCUS_MS);
      T.angle = T.from + (T.to - T.from) * easeOutBackSoft(p);
      if (p >= 1) { T.tweening = false; T.angle = T.to; }
    } else if (!rig.reducedMotion) {
      const want = t > T.holdUntil ? DRIFT : 0;
      T.drift += (want - T.drift) * damp(0.015, dt);
      T.angle += T.drift * dt;
    }
    ring.rotation.y = T.angle;
    // lighting: the diorama nearest the front is lit, the rest dim to ~55 %
    for (const d of dioramas) {
      const off = Math.abs(wrapAngle(d.theta + T.angle));
      const lit = 1 - smoothstep(0.35, 1.35, off);
      d.lit += (lit - d.lit) * (dt > 0 ? damp(0.14, dt) : 1);
      d.R.apply(d.lit);
      d.update(dt, t, d.lit, camera);
    }
    // camera: parallax ±5° yaw, ±2.5° pitch
    const yaw = cam.yaw + pointer.x * 5 * DEG;
    const pitch = cam.pitch - pointer.y * 2.5 * DEG;
    orbitCamera(camera, cam.target, yaw, pitch, cam.dist * state.dolly);
    camera.updateMatrixWorld();
    spot.intensity = 70 + Math.sin(t * 1.1) * 4;
    if (hover.dirty && dt > 0) { hover.dirty = false; setCursor(pick(hover.x, hover.y) >= 0 ? 'pointer' : ''); }
  };
  rig.onDispose = () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onOut);
    canvas.removeEventListener('pointercancel', onOut);
    setCursor('');
  };

  rig.start();
  const baseStats = rig.controller.stats;
  return {
    ...rig.controller,
    focus,
    stats() {
      const s = baseStats();
      s.focused = T.focused; s.angle = T.angle; s.tweening = T.tweening;
      s.dioramas = dioramas.map((d) => {
        d.g.getWorldPosition(_wp); _wp.y += d.anchorY; _wp.project(camera);
        return { id: d.id, x: ((_wp.x + 1) / 2) * size.w, y: ((1 - _wp.y) / 2) * size.h, depth: _wp.z, lit: +d.lit.toFixed(3) };
      });
      return s;
    },
  };
}
