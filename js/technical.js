// Under the hood (technical.html): contents rail, figures that draw on first sight, header behaviour, contact wiring.
import { site } from './data.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const html = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
html.classList.add('js');
if (reducedMotion) html.classList.add('motion-off');

/* ---- header compacts after the cover ---- */
const header = $('.site-header');
let ticking = false;
addEventListener('scroll', () => {
  if (ticking) return; ticking = true;
  requestAnimationFrame(() => { header.classList.toggle('is-compact', scrollY > 80); ticking = false; });
}, { passive: true });

/* ---- in-page links (contents, rail, figure references) ---- */
$$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const target = $(a.getAttribute('href'));
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
  history.replaceState(null, '', a.getAttribute('href'));
}));

/* ---- rail: mark the dossier currently being read ---- */
const railLinks = $$('#rail a[href^="#"]');
if (railLinks.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      railLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${en.target.id}`));
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  $$('section.dossier').forEach((s) => io.observe(s));
}

/* ---- figures: strokes draw on the first time a drawing scrolls into view ---- */
const figs = $$('figure.fig');
figs.forEach((f) => {
  $$('svg :is(path, line, polyline, polygon, circle, ellipse, rect)', f).forEach((el) => {
    if (el.classList.contains('d') || el.closest('marker')) return; // dashed strokes keep their own pattern
    el.setAttribute('pathLength', '1');
  });
});
if (reducedMotion) figs.forEach((f) => f.classList.add('is-in'));
else {
  const fo = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); fo.unobserve(en.target); } });
  }, { threshold: .18 });
  figs.forEach((f) => fo.observe(f));
}

/* ---- contact: one email, wired everywhere (same behaviour as the studio page) ---- */
const subject = encodeURIComponent('Let’s build something');
$$('[data-mailto]').forEach((a) => {
  const withSubject = a.getAttribute('href').includes('subject=');
  a.href = `mailto:${site.email}${withSubject ? `?subject=${subject}` : ''}`;
  if (a.hasAttribute('title')) a.title = site.email;
});
$$('[data-email-text]').forEach((a) => { a.textContent = site.email; });
const copy = $('[data-copy-email]');
if (copy) {
  const label = copy.textContent;
  copy.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(site.email); ok = true; }
    catch {
      const ta = document.createElement('textarea'); ta.value = site.email; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
    }
    copy.textContent = ok ? 'Copied' : site.email; copy.classList.toggle('is-copied', ok);
    setTimeout(() => { copy.textContent = label; copy.classList.remove('is-copied'); }, 2200);
  });
}
