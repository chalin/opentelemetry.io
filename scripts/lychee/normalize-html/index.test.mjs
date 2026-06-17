// Unit tests for the data-proofer-ignore HTML normalizer (P1): strip the
// href/src of links on or inside a `data-proofer-ignore` element so the checker
// never enqueues them — the lossless, element-level equivalent of htmltest's
// attribute skip.
//
// cSpell:ignore proofer opentelemetry

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { stripIgnoredLinks, normalizeHtml, normalizeTree } from './index.mjs';
import { regionsToDrop } from './policy.mjs';
import {
  findAllHrefs,
  findIgnoredHrefs,
} from '../data-proofer-ignore-to-lychee/index.mjs';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('stripIgnoredLinks()', () => {
  test('strips the href of an anchor carrying the attribute', () => {
    const html =
      '<a data-proofer-ignore href="https://github.com/o/r/commit/abc">c</a>';
    const out = stripIgnoredLinks(html);
    assert.equal(findAllHrefs(out).length, 0, 'no checkable links remain');
    assert.match(out, /data-proofer-ignore/, 'keeps the marker attribute');
    assert.match(out, />c<\/a>/, 'keeps the anchor text');
  });

  test('strips the href of a void element carrying the attribute', () => {
    const html =
      '<link rel="canonical" href="http://localhost/x/" data-proofer-ignore>';
    const out = stripIgnoredLinks(html);
    assert.equal(findAllHrefs(out).length, 0, 'canonical href is stripped');
    assert.match(out, /rel="canonical"/, 'keeps the other attributes');
  });

  test('strips href and src of descendants of an ignored container', () => {
    const html =
      '<div data-proofer-ignore><a href="u1"><img src="u2"></a></div>';
    const out = stripIgnoredLinks(html);
    assert.equal(findAllHrefs(out).length, 0, 'all nested links are stripped');
  });

  test('leaves links outside any ignored element untouched', () => {
    const html = '<a href="kept">k</a><div data-proofer-ignore></div>';
    const out = stripIgnoredLinks(html);
    assert.deepEqual(
      findAllHrefs(out),
      ['kept'],
      'checkable link is preserved',
    );
  });

  test('strips only the ignored link in a mixed document', () => {
    const html =
      '<a href="keep1">a</a>' +
      '<span data-proofer-ignore><a href="drop">b</a></span>' +
      '<a href="keep2">c</a>';
    const out = stripIgnoredLinks(html);
    assert.deepEqual(findAllHrefs(out), ['keep1', 'keep2']);
  });

  test('resumes checking after the ignored region closes', () => {
    const html =
      '<div data-proofer-ignore><a href="drop">x</a></div><a href="keep">y</a>';
    const out = stripIgnoredLinks(html);
    assert.deepEqual(findAllHrefs(out), ['keep']);
  });

  test('is idempotent', () => {
    const html =
      '<div data-proofer-ignore><a href="u1">x</a></div><a href="keep">y</a>';
    const once = stripIgnoredLinks(html);
    assert.equal(stripIgnoredLinks(once), once);
  });

  test('preserves non-link attributes and surrounding text verbatim', () => {
    const html =
      'before <a class="c" data-proofer-ignore href="u" title="t">x</a> after';
    const out = stripIgnoredLinks(html);
    assert.match(out, /^before /, 'leading text is preserved');
    assert.match(out, / after$/, 'trailing text is preserved');
    assert.match(out, /class="c"/, 'class attribute is preserved');
    assert.match(out, /title="t"/, 'title attribute is preserved');
  });

  test('parity oracle: stripped set equals original minus ignored', () => {
    const html = `
      <html><head>
        <link rel="canonical" href="http://localhost/p/" data-proofer-ignore>
      </head><body>
        <a href="https://example.com/keep">keep</a>
        <div class="td-page-meta" data-proofer-ignore>
          <a href="https://github.com/o/r/commit/deadbeef">last modified</a>
          <a href="https://github.com/o/r/compare/a...b">changes</a>
        </div>
        <nav><a href="/docs/keep/">nav-keep</a></nav>
        <p>See <a href="https://example.org/also-keep">also</a>.</p>
      </body></html>`;
    const ignored = new Set(findIgnoredHrefs(html));
    const checkable = findAllHrefs(html).filter((u) => !ignored.has(u));
    const out = stripIgnoredLinks(html);
    assert.deepEqual(
      findAllHrefs(out).sort(),
      [...checkable].sort(),
      'exactly the non-ignored links survive',
    );
  });
});

describe('normalizeTree()', () => {
  test('mirrors the tree, normalizing HTML and linking other files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'normalize-tree-'));
    const src = path.join(root, 'src');
    const out = path.join(root, 'out');
    mkdirSync(path.join(src, 'sub'), { recursive: true });
    writeFileSync(
      path.join(src, 'page.html'),
      '<a href="keep">k</a><span data-proofer-ignore><a href="drop">d</a></span>',
    );
    writeFileSync(path.join(src, 'sub', 'data.json'), '{"href":"untouched"}');

    const stats = normalizeTree(src, out);

    assert.equal(stats.htmlFiles, 1, 'one HTML file is normalized');
    assert.equal(stats.linkedFiles, 1, 'one non-HTML file is hard-linked');
    assert.deepEqual(
      findAllHrefs(readFileSync(path.join(out, 'page.html'), 'utf8')),
      ['keep'],
      'the HTML output has its ignored link stripped',
    );
    assert.equal(
      readFileSync(path.join(out, 'sub', 'data.json'), 'utf8'),
      '{"href":"untouched"}',
      'the non-HTML file is mirrored byte-for-byte',
    );
  });

  test('hard-links non-HTML files instead of copying them', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'normalize-link-'));
    const src = path.join(root, 'src');
    const out = path.join(root, 'out');
    mkdirSync(src, { recursive: true });
    const asset = path.join(src, 'logo.svg');
    writeFileSync(asset, '<svg></svg>');

    normalizeTree(src, out);

    assert.equal(
      statSync(path.join(out, 'logo.svg')).ino,
      statSync(asset).ino,
      'the mirrored asset shares the source inode (a hard link, not a copy)',
    );
  });

  test('removes stale output from a previous run', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'normalize-stale-'));
    const src = path.join(root, 'src');
    const out = path.join(root, 'out');
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, 'page.html'), '<a href="keep">k</a>');
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'deleted.html'), '<a href="gone">g</a>');

    normalizeTree(src, out);

    assert.equal(
      existsSync(path.join(out, 'deleted.html')),
      false,
      'output left over from a prior run is cleared',
    );
  });
});

// --- P2: structural chrome dedup ----------------------------------------------

const NAVBAR =
  '<nav class="td-navbar js-navbar-scroll"><a href="/about/">a</a></nav>';
const FOOTER =
  '<footer class="td-footer row"><a href="https://x.example/t">t</a></footer>';
const LEFTNAV =
  '<nav class="td-sidebar-nav" id="td-section-nav"><a href="/docs/a/">a</a></nav>';

describe('normalizeHtml() chrome dropping (P2)', () => {
  test('with no options, behaves exactly like P1 (drops nothing structural)', () => {
    const html = `${NAVBAR}<main><a href="/keep/">k</a></main>${FOOTER}`;
    assert.equal(
      normalizeHtml(html),
      html,
      'identical to input when no drop set',
    );
    assert.equal(stripIgnoredLinks(html), html, 'alias matches');
  });

  test('drops the left-nav subtree when asked', () => {
    const html = `<main><a href="/keep/">k</a></main>${LEFTNAV}`;
    const out = normalizeHtml(html, { drop: new Set(['leftnav']) });
    assert.doesNotMatch(out, /td-section-nav/, 'left-nav element is gone');
    assert.deepEqual(
      findAllHrefs(out),
      ['/keep/'],
      'only content link remains',
    );
  });

  test('drops the navbar subtree when asked', () => {
    const html = `${NAVBAR}<main><a href="/keep/">k</a></main>`;
    const out = normalizeHtml(html, { drop: new Set(['navbar']) });
    assert.doesNotMatch(out, /td-navbar/, 'navbar element is gone');
    assert.deepEqual(findAllHrefs(out), ['/keep/']);
  });

  test('drops the footer subtree when asked', () => {
    const html = `<main><a href="/keep/">k</a></main>${FOOTER}`;
    const out = normalizeHtml(html, { drop: new Set(['footer']) });
    assert.doesNotMatch(out, /td-footer/, 'footer element is gone');
    assert.deepEqual(findAllHrefs(out), ['/keep/']);
  });

  test('keeps a region that is not in the drop set', () => {
    const html = `${NAVBAR}<main><a href="/keep/">k</a></main>${FOOTER}`;
    const out = normalizeHtml(html, { drop: new Set(['leftnav']) });
    assert.match(out, /td-navbar/, 'navbar kept (not requested)');
    assert.match(out, /td-footer/, 'footer kept (not requested)');
  });

  test('drops a chrome region containing a nested same-name element', () => {
    const html =
      '<nav class="td-navbar"><a href="/about/">a</a>' +
      '<nav class="td-navbar-lang"><a href="/es/">es</a></nav></nav>' +
      '<main><a href="/keep/">k</a></main>';
    const out = normalizeHtml(html, { drop: new Set(['navbar']) });
    assert.doesNotMatch(
      out,
      /td-navbar/,
      'whole navbar (incl. nested nav) gone',
    );
    assert.deepEqual(
      findAllHrefs(out),
      ['/keep/'],
      'checking resumes after it',
    );
  });

  test('still strips data-proofer-ignore links in surviving regions', () => {
    const html =
      '<main><a href="/keep/">k</a>' +
      '<span data-proofer-ignore><a href="/drop/">d</a></span></main>' +
      LEFTNAV;
    const out = normalizeHtml(html, { drop: new Set(['leftnav']) });
    assert.deepEqual(
      findAllHrefs(out),
      ['/keep/'],
      'P1 still applies alongside P2',
    );
  });

  test('fragment guard: keeps (href-strips) a region whose id a same-page #fragment targets', () => {
    const html =
      '<a href="#anchored">jump</a>' +
      '<footer class="td-footer"><span id="anchored">x</span>' +
      '<a href="https://x.example/e">e</a></footer>';
    const out = normalizeHtml(html, { drop: new Set(['footer']) });
    assert.match(out, /id="anchored"/, 'fragment target id is preserved');
    assert.match(out, /td-footer/, 'element kept rather than dropped');
    assert.deepEqual(
      findAllHrefs(out).sort(),
      ['#anchored'],
      'the in-region link is href-stripped, the fragment link survives',
    );
  });

  test('fragment guard: SVG sprite refs (<use href="#icon">) do not protect a region', () => {
    const html =
      '<svg><use href="#sun-fill" /></svg>' +
      '<nav class="td-navbar"><svg><symbol id="sun-fill"></symbol></svg>' +
      '<a href="https://x.example/e">e</a></nav>';
    const out = normalizeHtml(html, { drop: new Set(['navbar']) });
    assert.doesNotMatch(
      out,
      /td-navbar/,
      'navbar is dropped despite the <use> ref',
    );
    assert.deepEqual(
      findAllHrefs(out).sort(),
      ['#sun-fill'],
      'only the SVG sprite ref remains; the navbar and its links are gone',
    );
  });
});

describe('regionsToDrop() page policy (P2)', () => {
  const locales = new Set([
    'bn',
    'es',
    'fr',
    'ja',
    'pl',
    'pt',
    'ro',
    'uk',
    'zh',
  ]);

  test('the en docs landing keeps its left-nav (the one tree reference)', () => {
    assert.deepEqual([...regionsToDrop('docs/index.html', locales)].sort(), [
      'footer',
      'navbar',
    ]);
  });

  test('the en home keeps navbar + footer (the configured-chrome reference)', () => {
    assert.deepEqual([...regionsToDrop('index.html', locales)], ['leftnav']);
  });

  test('a locale home keeps navbar + footer', () => {
    assert.deepEqual([...regionsToDrop('es/index.html', locales)], ['leftnav']);
  });

  test('an ordinary docs page drops all chrome', () => {
    assert.deepEqual(
      [...regionsToDrop('docs/concepts/index.html', locales)].sort(),
      ['footer', 'leftnav', 'navbar'],
    );
    assert.deepEqual(
      [...regionsToDrop('es/docs/concepts/index.html', locales)].sort(),
      ['footer', 'leftnav', 'navbar'],
    );
  });
});

describe('normalizeTree() applies the page policy (P2)', () => {
  test('keeps chrome on reference pages and drops it elsewhere', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'normalize-p2-'));
    const src = path.join(root, 'src');
    const out = path.join(root, 'out');
    mkdirSync(path.join(src, 'docs', 'sub'), { recursive: true });
    mkdirSync(path.join(src, 'es', 'docs'), { recursive: true });

    const page = (body) => `<body>${NAVBAR}${body}${FOOTER}</body>`;
    writeFileSync(path.join(src, 'index.html'), page('<main>home</main>'));
    writeFileSync(
      path.join(src, 'docs', 'index.html'),
      page(`<main>docs</main>${LEFTNAV}`),
    );
    writeFileSync(
      path.join(src, 'docs', 'sub', 'index.html'),
      page(`<main>sub</main>${LEFTNAV}`),
    );
    writeFileSync(
      path.join(src, 'es', 'index.html'),
      page('<main>inicio</main>'),
    );
    writeFileSync(
      path.join(src, 'es', 'docs', 'index.html'),
      page(`<main>docs</main>${LEFTNAV}`),
    );

    normalizeTree(src, out, { drop: true, locales: new Set(['es']) });

    const read = (...p) => readFileSync(path.join(out, ...p), 'utf8');
    // en home: chrome reference -> navbar + footer kept, no left-nav present.
    assert.match(read('index.html'), /td-navbar/, 'en home keeps navbar');
    assert.match(read('index.html'), /td-footer/, 'en home keeps footer');
    // en docs landing: left-nav reference -> kept; navbar/footer dropped.
    assert.match(
      read('docs', 'index.html'),
      /td-section-nav/,
      'docs landing keeps left-nav',
    );
    assert.doesNotMatch(
      read('docs', 'index.html'),
      /td-navbar/,
      'docs landing drops navbar',
    );
    // ordinary docs page: everything dropped.
    assert.doesNotMatch(
      read('docs', 'sub', 'index.html'),
      /td-section-nav/,
      'sub drops left-nav',
    );
    assert.doesNotMatch(
      read('docs', 'sub', 'index.html'),
      /td-navbar/,
      'sub drops navbar',
    );
    // es home: chrome reference for its locale.
    assert.match(read('es', 'index.html'), /td-navbar/, 'es home keeps navbar');
    // es docs landing is NOT the one tree reference -> left-nav dropped.
    assert.doesNotMatch(
      read('es', 'docs', 'index.html'),
      /td-section-nav/,
      'es docs drops left-nav',
    );
  });
});

describe('normalizeTree() in place (CI throwaway tree)', () => {
  test('rewrites HTML files in the source dir and leaves assets untouched', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'normalize-inplace-'));
    const src = path.join(root, 'public');
    mkdirSync(path.join(src, 'sub'), { recursive: true });
    const pagePath = path.join(src, 'page.html');
    writeFileSync(
      pagePath,
      '<a href="keep">k</a><span data-proofer-ignore><a href="drop">d</a></span>',
    );
    const assetPath = path.join(src, 'sub', 'logo.svg');
    writeFileSync(assetPath, '<svg></svg>');
    const assetIno = statSync(assetPath).ino;

    const stats = normalizeTree(src, src, { inPlace: true });

    assert.equal(stats.htmlFiles, 1, 'one HTML file is normalized');
    assert.equal(stats.linkedFiles, 0, 'no files are hard-linked in place');
    assert.equal(stats.copiedFiles, 0, 'no files are copied in place');
    assert.deepEqual(
      findAllHrefs(readFileSync(pagePath, 'utf8')),
      ['keep'],
      'the HTML file is rewritten in place with its ignored link stripped',
    );
    assert.equal(
      statSync(assetPath).ino,
      assetIno,
      'the asset file is left exactly as it was (same inode, never rewritten)',
    );
  });

  test('applies the P2 page policy in place', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'normalize-inplace-p2-'));
    const src = path.join(root, 'public');
    mkdirSync(path.join(src, 'docs', 'sub'), { recursive: true });
    const page = (body) => `<body>${NAVBAR}${body}${FOOTER}</body>`;
    writeFileSync(path.join(src, 'index.html'), page('<main>home</main>'));
    writeFileSync(
      path.join(src, 'docs', 'sub', 'index.html'),
      page(`<main>sub</main>${LEFTNAV}`),
    );

    normalizeTree(src, src, { inPlace: true, drop: true, locales: new Set() });

    const read = (...p) => readFileSync(path.join(src, ...p), 'utf8');
    assert.match(read('index.html'), /td-navbar/, 'en home keeps navbar');
    assert.doesNotMatch(
      read('docs', 'sub', 'index.html'),
      /td-navbar/,
      'an ordinary page drops its navbar in place',
    );
  });
});
