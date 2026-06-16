#!/usr/bin/env node
// Normalize built `public/` HTML for link checking by stripping the href/src of
// every link on or inside a `data-proofer-ignore` element. This is the lossless,
// element-level equivalent of htmltest's `IgnoreTagAttribute` skip: the checker
// never sees those links, so it never enqueues them — no per-host `exclude`
// regexes, and the same rule covers any element an author marks.
//
// The transform is surgical: it walks the tag stream (the same ignore-tracking
// as the data-proofer-ignore scanner) and removes only the href/src attributes
// inside ignored regions, copying every other byte verbatim. It does not
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
  copyFileSync,
} from 'node:fs';
import path from 'node:path';

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

// Walk the tag stream, tracking how many open ancestors carry
// `data-proofer-ignore`; rewrite any start tag that carries it or is nested
// inside one to drop its href/src, and copy everything else byte-for-byte.
export function stripIgnoredLinks(html) {
  let out = '';
  let pos = 0;
  const stack = []; // { tag, ignored }
  let ignoreDepth = 0;
  const tagRe =
    /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/)?>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    out += html.slice(pos, m.index);
    pos = tagRe.lastIndex;

    if (m[0].startsWith('<!--')) {
      out += m[0];
      continue;
    }

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/';

    if (closing) {
      out += m[0];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          for (let j = stack.length - 1; j >= i; j--) {
            if (stack[j].ignored) ignoreDepth--;
          }
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const hasIgnore = /(?:^|\s)data-proofer-ignore(?:[\s=]|$)/i.test(attrs);
    out += hasIgnore || ignoreDepth > 0 ? dropLinkAttrs(m[0]) : m[0];

    if (VOID.has(tag) || selfClose) continue;
    if (RAWTEXT.has(tag)) {
      const lower = html.toLowerCase();
      const close = lower.indexOf(`</${tag}`, tagRe.lastIndex);
      const end = close === -1 ? html.length : html.indexOf('>', close);
      const next = end === -1 ? html.length : end + 1;
      out += html.slice(pos, next);
      pos = next;
      tagRe.lastIndex = next;
      continue;
    }
    stack.push({ tag, ignored: hasIgnore });
    if (hasIgnore) ignoreDepth++;
  }
  out += html.slice(pos);
  return out;
}

export function normalizeTree(srcDir, outDir) {
  let htmlFiles = 0;
  let otherFiles = 0;
  const walk = (src, out) => {
    mkdirSync(out, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name);
      const to = path.join(out, entry.name);
      if (entry.isDirectory()) {
        walk(from, to);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        writeFileSync(to, stripIgnoredLinks(readFileSync(from, 'utf8')));
        htmlFiles++;
      } else if (entry.isFile()) {
        copyFileSync(from, to);
        otherFiles++;
      }
    }
  };
  walk(srcDir, outDir);
  return { htmlFiles, otherFiles };
}

function mainCLI() {
  const [, , srcDir, outDir] = process.argv;
  if (!srcDir || !outDir) {
    console.error(
      'Usage: node scripts/lychee/normalize-html/index.mjs <src-dir> <out-dir>',
    );
    process.exit(2);
  }
  const { htmlFiles, otherFiles } = normalizeTree(srcDir, outDir);
  console.error(
    `Normalized ${htmlFiles} HTML file(s) into ${outDir} ` +
      `(${otherFiles} other file(s) copied).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) mainCLI();
