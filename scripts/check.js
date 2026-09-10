// npm run check — verifies every local asset referenced by js/data.js and index.html exists on disk.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

(async () => {
  const data = await import('../js/data.js');
  const refs = new Set();
  const add = (p) => { if (typeof p === 'string' && /^assets\//.test(p)) refs.add(p); };
  const walk = (v) => { if (!v) return; if (typeof v === 'string') add(v); else if (Array.isArray(v)) v.forEach(walk); else if (typeof v === 'object') Object.values(v).forEach(walk); };
  walk(data.site); walk(data.companies); walk(data.lalapoker); walk(data.ideas);
  walk({ cover: data.book.cover, back: data.book.back, pdf: data.book.pdf });
  for (let i = 0; i < data.book.pages; i++) add(data.book.pageSrc(i));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) add(m[1]);
  for (const m of html.matchAll(/(?:src|href)="\.?\/?(vendor\/[^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/"\.\/(vendor\/[^"]+\.js)"/g)) refs.add(m[1]);
  refs.add('css/style.css'); refs.add('js/main.js'); refs.add('js/scene.js'); refs.add('js/book.js'); refs.add('js/gallery.js');
  const missing = [...refs].filter((r) => !fs.existsSync(path.join(ROOT, r)));
  console.log(`checked ${refs.size} referenced files`);
  if (missing.length) { console.error('MISSING:\n  ' + missing.join('\n  ')); process.exit(1); }
  console.log('all assets present ✓');
})();
