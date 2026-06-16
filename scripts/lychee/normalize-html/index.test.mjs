// Unit tests for the data-proofer-ignore HTML normalizer (P1): strip the
// href/src of links on or inside a `data-proofer-ignore` element so the checker
// never enqueues them — the lossless, element-level equivalent of htmltest's
// attribute skip.
//
// cSpell:ignore proofer opentelemetry

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { stripIgnoredLinks, normalizeTree } from './index.mjs';
import {
  findAllHrefs,
  findIgnoredHrefs,
} from '../data-proofer-ignore-to-lychee/index.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
  test('mirrors the tree, normalizing HTML and copying other files', () => {
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
    assert.equal(stats.otherFiles, 1, 'one non-HTML file is copied');
    assert.deepEqual(
      findAllHrefs(readFileSync(path.join(out, 'page.html'), 'utf8')),
      ['keep'],
      'the HTML output has its ignored link stripped',
    );
    assert.equal(
      readFileSync(path.join(out, 'sub', 'data.json'), 'utf8'),
      '{"href":"untouched"}',
      'the non-HTML file is copied byte-for-byte',
    );
  });
});
