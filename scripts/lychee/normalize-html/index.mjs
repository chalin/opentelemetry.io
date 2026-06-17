#!/usr/bin/env node
// Normalize built `public/` HTML for link checking.
//
// P1 (always on): strip the href/src of every link on or inside a
// `data-proofer-ignore` element — the lossless, element-level equivalent of
// htmltest's `IgnoreTagAttribute` skip, so the checker never enqueues them.
//
// P2 (opt-in via `drop`): remove repeated Docsy chrome — the navbar, footer, and
// left-side nav — so each is checked roughly once across the site instead of on
// every page (see scripts/lychee/normalize-html/policy.mjs for which pages keep
// which regions). A dropped region's whole subtree is removed (links *and*
// bytes), unless one of its element ids is the target of a same-page `#fragment`
// link, in which case the element is kept but all its hrefs are stripped — so a
// fragment target is never orphaned.
//
// The transform is surgical: it walks the tag stream and copies bytes verbatim,
// only stripping attributes or eliding whole chrome subtrees. It does not
// re-serialize the document.
//
// Usage:
//   node scripts/lychee/normalize-html/index.mjs <src-dir> <out-dir>
// Mirrors the directory tree of <src-dir> into <out-dir>, normalizing `.html`
// files and hard-linking (or copying) everything else.
//
// cSpell:ignore proofer

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  linkSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { regionsToDrop, detectLocales } from './policy.mjs';

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const RAWTEXT = new Set(['script', 'style']);

// Remove every href/src attribute from a single start-tag's text, leaving all
// other attributes (including `data-proofer-ignore`) intact.
function dropLinkAttrs(tag) {
  return tag.replace(/\s+(?:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

// Collect the set of same-page fragment ids targeted by an `<a href="#id">`
// hyperlink (the `#` is dropped; empty fragments are ignored). Only `<a>`
// anchors count: those are the same-page links lychee checks. Non-hyperlink
// `href="#id"` uses such as SVG sprite refs (`<use href="#icon">`) are ignored,
// so they don't spuriously protect a chrome region from being dropped.
function sameDocFragments(html) {
  const refs = new Set();
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"#([^"]*)"|'#([^']*)'|#([^\s">]+))/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const frag = m[1] ?? m[2] ?? m[3];
    if (frag) refs.add(frag);
  }
  return refs;
}

// Extract a start tag's `id` attribute value, or null.
function idOf(attrs) {
  const m = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

// Does a start tag (tag name + attrs) open a chrome region that should be
// dropped, given the requested `drop` set? Matches Docsy's calibrated selectors.
function dropRegionOf(tag, attrs, drop) {
  if (
    drop.has('leftnav') &&
    tag === 'nav' &&
    /\bid\s*=\s*["']td-section-nav["']/i.test(attrs)
  )
    return true;
  if (
    drop.has('navbar') &&
    tag === 'nav' &&
    /\bclass\s*=\s*["'][^"']*\btd-navbar\b/i.test(attrs)
  )
    return true;
  if (
    drop.has('footer') &&
    tag === 'footer' &&
    /\bclass\s*=\s*["'][^"']*\btd-footer\b/i.test(attrs)
  )
    return true;
  return false;
}

// Normalize one HTML document. P1 (data-proofer-ignore href stripping) always
// applies; P2 chrome dropping applies for each region named in `opts.drop`.
export function normalizeHtml(html, opts = {}) {
  const drop = opts.drop || new Set();
  const fragments = drop.size ? sameDocFragments(html) : null;

  let out = '';
  // While inside a candidate drop region we buffer its (href-stripped) output so
  // we can either discard it (drop) or flush it (keep) once we see its ids.
  let buf = null;
  let bufIds = null;
  let bufRootIndex = -1;
  const append = (s) => {
    if (buf !== null) buf += s;
    else out += s;
  };

  let pos = 0;
  const stack = []; // { tag, ignored, dropRoot }
  let ignoreDepth = 0;
  const tagRe =
    /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/)?>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    append(html.slice(pos, m.index));
    pos = tagRe.lastIndex;

    if (m[0].startsWith('<!--')) {
      append(m[0]);
      continue;
    }

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/';

    if (closing) {
      let matchIndex = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          matchIndex = i;
          break;
        }
      }
      if (matchIndex === -1) {
        append(m[0]);
        continue;
      }
      const closingDropRoot = buf !== null && matchIndex === bufRootIndex;
      append(m[0]);
      for (let j = stack.length - 1; j >= matchIndex; j--) {
        if (stack[j].ignored) ignoreDepth--;
      }
      stack.length = matchIndex;
      if (closingDropRoot) {
        // Drop the region unless one of its ids anchors a same-page fragment, in
        // which case keep the (already href-stripped) subtree to preserve it.
        let anchored = false;
        for (const id of bufIds) {
          if (fragments.has(id)) {
            anchored = true;
            break;
          }
        }
        if (anchored) out += buf;
        buf = null;
        bufIds = null;
        bufRootIndex = -1;
      }
      continue;
    }

    const hasIgnore = /(?:^|\s)data-proofer-ignore(?:[\s=]|$)/i.test(attrs);
    const startsDrop = buf === null && dropRegionOf(tag, attrs, drop);
    if (startsDrop) {
      buf = '';
      bufIds = new Set();
      bufRootIndex = stack.length;
    }
    // Inside a drop region every link is elided (so a kept fallback is still
    // unchecked); elsewhere only data-proofer-ignore links are stripped.
    const strip = buf !== null || hasIgnore || ignoreDepth > 0;
    if (buf !== null) {
      const id = idOf(attrs);
      if (id) bufIds.add(id);
    }
    append(strip ? dropLinkAttrs(m[0]) : m[0]);

    if (VOID.has(tag) || selfClose) continue;
    if (RAWTEXT.has(tag)) {
      const lower = html.toLowerCase();
      const close = lower.indexOf(`</${tag}`, tagRe.lastIndex);
      const end = close === -1 ? html.length : html.indexOf('>', close);
      const next = end === -1 ? html.length : end + 1;
      append(html.slice(pos, next));
      pos = next;
      tagRe.lastIndex = next;
      continue;
    }
    stack.push({ tag, ignored: hasIgnore });
    if (hasIgnore) ignoreDepth++;
  }
  append(html.slice(pos));
  return out;
}

// P1-only alias: strip data-proofer-ignore links, drop no chrome.
export const stripIgnoredLinks = (html) => normalizeHtml(html);

// Mirror `srcDir` into a fresh `outDir`: normalize `.html` files, hard-link
// everything else. Hard links keep the ~200 MB of assets near-free (lychee
// still needs them on disk to verify internal links/images resolve) while only
// the rewritten HTML actually costs bytes. Falls back to a copy across devices.
//
// With `opts.drop`, P2 chrome dropping is applied per page: `opts.locales` (the
// non-default locale prefixes) is detected from the tree when not supplied.
export function normalizeTree(srcDir, outDir, opts = {}) {
  const dropChrome = !!opts.drop;
  const locales =
    opts.locales ??
    (dropChrome
      ? detectLocales(srcDir, { readdirSync, existsSync }, path.join)
      : new Set());
  let htmlFiles = 0;
  let linkedFiles = 0;
  let copiedFiles = 0;
  rmSync(outDir, { recursive: true, force: true });
  const walk = (src, out, rel) => {
    mkdirSync(out, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name);
      const to = path.join(out, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(from, to, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const drop = dropChrome ? regionsToDrop(relPath, locales) : undefined;
        writeFileSync(to, normalizeHtml(readFileSync(from, 'utf8'), { drop }));
        htmlFiles++;
      } else if (entry.isFile()) {
        try {
          linkSync(from, to);
          linkedFiles++;
        } catch {
          copyFileSync(from, to);
          copiedFiles++;
        }
      }
    }
  };
  walk(srcDir, outDir, '');
  return { htmlFiles, linkedFiles, copiedFiles };
}

function mainCLI() {
  const args = process.argv.slice(2);
  const drop = args.includes('--drop-chrome');
  const [srcDir, outDir] = args.filter((a) => !a.startsWith('--'));
  if (!srcDir || !outDir) {
    console.error(
      'Usage: node scripts/lychee/normalize-html/index.mjs [--drop-chrome] <src-dir> <out-dir>',
    );
    process.exit(2);
  }
  const start = performance.now();
  const { htmlFiles, linkedFiles, copiedFiles } = normalizeTree(
    srcDir,
    outDir,
    {
      drop,
    },
  );
  const secs = ((performance.now() - start) / 1000).toFixed(1);
  console.error(
    `Normalized ${htmlFiles} HTML file(s) into ${outDir} ` +
      `(${linkedFiles} linked, ${copiedFiles} copied${drop ? ', chrome dropped' : ''}) ` +
      `in ${secs}s.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) mainCLI();
