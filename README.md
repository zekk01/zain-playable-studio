# Zain Kassem — The Playable Studio (3D)

A 3D, animated variant of the portfolio at zain-playable-studio.zainkassem00.chatgpt.site. No build step.

**Live:** https://zekk01.github.io/zain-playable-studio/ (GitHub Pages, built from the `main` branch of this repo; every push republishes within a minute or two).

## Run it

```
npm start
```

Then open http://localhost:3000 (or double-click `start.bat`, which opens the browser for you).

Requires Node 18+. Three.js and GSAP are vendored in `vendor/` (copied from `node_modules`), so the site works offline and on any static host, including under a subpath such as GitHub Pages. Google Fonts are used when online and fall back to system fonts.

## Hosting

The site is fully static. Everything except `node_modules/` and `dev/shots/` can be uploaded as-is to GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any web server. `.nojekyll` is included for GitHub Pages.

## What's inside

| Path | What it is |
|---|---|
| `index.html` | The page: hero, career campaign, City Crafters spotlight, Lala Poker, the book, beyond the build, footer |
| `js/data.js` | **All content lives here.** Companies, projects, images, links, book, reels, the City Crafters spotlight, and the side quests (DR3 and Gaya Wallet, sister companies shown at the end). Edit this to change the site. |
| `js/scene.js` | Three.js studio scene (hero) and the poker card scene |
| `js/cityscene.js` | Three.js turntable of four City Crafters dioramas (pit lane, hologram tower, blind blade, jet) |
| `js/book.js` | Right-to-left 3D flipbook for the Arabic book |
| `js/gallery.js` | Image lightbox |
| `js/main.js` | Renders the page from data and wires everything |
| `css/style.css` | Styles, responsive rules, reduced-motion rules |
| `assets/book/` | The book PDF, cover, and 91 rendered pages |
| `assets/img/` | Project imagery gathered from the App Store, Google Play, citycrafters.ae, Instagram, and the Nirah site archive |
| `assets/cv/` | Both CVs |
| `server.js` | Zero-dependency static server |
| `scripts/check.js` | `npm run check` verifies every referenced asset exists |

## Adding images to a project

1. Drop the file into `assets/img/<company>/`.
2. In `js/data.js`, add `{ src: 'assets/img/<company>/<file>', alt: '...' }` to that project's `images` array. The first image becomes the card thumbnail and the dialog hero.
3. Run `npm run check`.

Every project also has a `google` field: a Google Images search URL shown as "More images on Google" in the project dialog.

## Testing

With the server running on port 3000:

```
npm run check        # every asset referenced by data.js and index.html exists
node dev/e2e.js      # Playwright integration suite: 81 checks across 1440 / 768 / 400 widths
```

The suite uses the globally installed Playwright with Microsoft Edge (`channel: 'msedge'`). Module harnesses for the scene, flipbook, and lightbox live in `dev/harness-*.html` with their own test scripts in `dev/test-*.js`. Screenshots land in `dev/shots/`.

## Notes and assumptions

- Lala Poker's role line ("Game design · Unity · Live-ops") and the 2023–2025 period are editorial assumptions; the CVs don't mention the game. Adjust in `js/data.js`.
- "The only book about game design in Arabic" is presented as the author's claim.
- Nirah Studios is now Feral Flame Studios; its chapter uses Primal Echo screenshots from feralflamestudios.com plus one early concept image from a 2021 Wayback Machine snapshot of the old site.
- Project imagery comes from: Google Play (AbjadPolis, Unseen Blade, Target Destroyed, Lala Poker), the App Store (Lala Poker), Steam (Chronicles of Scimitars: Rise of Baybars), swave.io, gayawallet.com, citycrafters.ae, and two City Crafters Instagram reels for Pit Protocol (downloaded to `assets/video/`).
- Only the DR3 Wi-Fi sensing project has no imagery yet; it shows a placeholder cover and relies on its Google Images link.
- Videos in a project dialog come from `videos: [{ src, poster, alt, href, source, portrait }]` in `js/data.js`; drop `.mp4` files into `assets/video/`.
