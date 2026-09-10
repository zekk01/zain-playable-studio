# Zain Kassem — The Playable Studio (3D variant) — Design Spec

**Date:** 2026-09-10 · **Runs on:** localhost:3000 via `npm start` (zero-dependency Node static server)

## Goal
A 3D, animated variant of https://zain-playable-studio.zainkassem00.chatgpt.site that captures attention on first load,
keeps all of the original's content and voice, adds LalaPoker as a project, adds real imagery for every project
(scraped from app stores / City Crafters / Instagram / archives) plus a "Search on Google Images" link per project,
and embeds the Arabic game-design book as a previewable flipbook, described as the only book about game design in Arabic.

## Content sources (already gathered into /assets)
- Original site copy, palette (bg #151616, panel #1c1d1d, ink #f2f1ec, muted #a0a29e, accent #f3a65a), fonts (Space Grotesk + DM Sans).
- Career data (7 companies, 12 projects) from the original app.js; enriched with CV facts.
- LalaPoker: App Store (LALAGAMING LLC, v3.8, Casino, 4.6★/54 ratings, iOS + Android + WebGL at lalapoker.com):
  15 in-game screenshots, icon, key art. Modes: Texas Hold'em, Omaha, Sit & Go, multi-table tournaments, Blackjack, Roulette, Lottery, Quests, VIP.
- City Crafters site imagery (Chronicles of Scimitars logo, Pit Protocol logo, pixel studio frames), HXR hologram photos
  (used for Hologram Cloud + holographic pipeline), Instagram reel thumbnails (12) + highlights, Nirah concept art (Wayback 2021).
- Book: 91 pages rendered to JPEG (assets/book/pages/p00..p90.jpg), cover.jpg, back.jpg, full PDF.

## Architecture
Static site, ES modules, no build step.
```
index.html            all sections, semantic markup, dialogs
css/style.css         tokens, layout, components, animations, responsive, reduced-motion
js/data.js            single source of truth: companies → projects (images, google query, links), book, ideas/reels, socials
js/main.js            boot: renders career/ideas from data, nav, scroll reveal (GSAP ScrollTrigger), tilt cards, dialogs
js/scene.js           Three.js "Playable Studio" hero scene (module, exports initStudioScene)
js/book.js            3D flipbook for the field manual (module, exports initBook)
js/gallery.js         image lightbox with keyboard nav (module, exports openGallery)
vendor via node_modules: three@0.170 (importmap), gsap@3.13 (+ScrollTrigger)
server.js             static server on :3000
```

## Sections (top → bottom)
1. **Header** — brand mark ZK✳, nav (Studio / Work / LalaPoker / Book / Ideas), "Let's talk".
2. **Hero: The Playable Studio (3D)** — full-bleed Three.js scene: a low-poly isometric studio room (desk, three monitors
   with glowing screens, bookshelf, VR headset, racing wheel, floating book, poker chips + cards for LalaPoker, plants, lamp).
   Camera drifts with mouse parallax; objects idle-animate (screen flicker, floating book bob, chips spin). 3D hotspots
   (CSS2D labels) — 01 The workbench → #work, 02 The field manual → #book, 03 Behind the ideas → #ideas, 04 LalaPoker → #lalapoker.
   Left column: original h1 "I build worlds. And the rules that make them work." with staggered text reveal.
   Fallback: if WebGL unavailable or reduced motion → static studio.png with hotspots.
3. **Toolkit strip** — marquee of tools (Unreal, Unity, C++/C#, Systems design, Creative direction) that scrolls slowly.
4. **Career Campaign** — company tabs (now 8 chapters incl. Lala Gaming) → project cards (3D tilt on hover, image thumbnail).
   Click → detail dialog: hero image, gallery strip, "My contribution / Design challenge / Outcome", links (store, site), and
   a "More images on Google ↗" button (Google Images query).
5. **LalaPoker spotlight** — dedicated section: floating 3D card fan + chip stack (Three.js mini scene or CSS 3D),
   description, feature chips, store badges, screenshot carousel (15 shots), "Play in browser" link.
6. **The Book** — "من الفكرة إلى اللاعب — مختصر تصميم الألعاب". Badge: "The only book about game design in Arabic".
   3D flipbook (CSS 3D page turn, RTL order: pages turn right-to-left), page counter, keyboard ← →, "Open full PDF" and
   "Download" buttons. Table of contents highlights (from PDF TOC).
7. **Beyond the Build** — Instagram reels grid (12 thumbnails with titles, link to profile), highlights row, the Design Review card.
8. **Footer** — CTA, LinkedIn, Instagram, both CVs, back to top.

## Motion
- GSAP ScrollTrigger reveals (fade+rise, staggered), hero text split reveal, marquee, tilt cards (pointer-driven transform),
  3D scene idle loops. All disabled under `prefers-reduced-motion` (scene shows a still frame).

## Data model (js/data.js)
```js
{ id, name, period, role, description, foot, cover, projects:[{ id, title, tag, hook, contribution, challenge, outcome,
  images:[{src, alt}], google:'query', links:[{label, href}] }] }
```

## Assumptions (flag to user)
- LalaPoker role text: "Game design & Unity development" — the CV doesn't mention LalaPoker; copy is written from the store listing.
- "Only book about game design in Arabic" is presented as the author's claim (user request).
- Nirah Studios' site is offline; one archived concept image (2021) is used.
- Instagram thumbnails are the public-profile grid thumbnails (640px) — good enough for cards, not hero art.

## Testing
- `npm run check`: verifies every asset path referenced in data.js exists, and all HTML-referenced files exist.
- Playwright smoke: load on desktop (1440) + mobile (400), no console errors, screenshots, hotspots navigate, book flips, gallery opens.
