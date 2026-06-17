// P2 page policy: which chrome regions to drop from a given page during
// normalization. The everyday optimized check strips the repeated chrome
// (navbar, footer, left-nav) so each is checked roughly once, with the daily
// full check as the comprehensive backstop.
//
// Reference pages (chrome kept, so each configured/computed region is still
// checked at least once):
//   - the en docs landing (`docs/index.html`) keeps its left-nav — a superset
//     of the whole docs tree, so the toc-generation code and every tree target
//     are exercised once site-wide;
//   - each locale homepage keeps the navbar + footer — the only chrome carrying
//     hand-authored (configured) URLs, which are caught nowhere else.

const EN_DOCS_LANDING = 'docs/index.html';
const ALL = ['navbar', 'footer', 'leftnav'];

// Is `relPath` (forward-slash, relative to the normalized root) a locale
// homepage — the en home (`index.html`) or a `<locale>/index.html`?
function isLocaleHome(relPath, locales) {
  if (relPath === 'index.html') return true;
  const m = /^([^/]+)\/index\.html$/.exec(relPath);
  return m !== null && locales.has(m[1]);
}

// Return the set of chrome regions to drop from the page at `relPath`, given the
// set of non-default `locales` (e.g. {'es','fr',...}; the default English locale
// lives at the root and needs no entry).
export function regionsToDrop(relPath, locales) {
  const drop = new Set(ALL);
  if (relPath === EN_DOCS_LANDING) drop.delete('leftnav');
  if (isLocaleHome(relPath, locales)) {
    drop.delete('navbar');
    drop.delete('footer');
  }
  return drop;
}

// Derive the non-default locales from a built site's top-level directories: a
// directory is a locale if it mirrors the section structure (has both an
// `index.html` and a `docs/` subdirectory). The default English locale lives at
// the root and is intentionally excluded.
export function detectLocales(srcDir, { readdirSync, existsSync }, join) {
  const locales = new Set();
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(srcDir, entry.name);
    if (existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'docs'))) {
      locales.add(entry.name);
    }
  }
  return locales;
}
