#!/usr/bin/env node
/**
 * docs:embed checker (issue #14) — the "docs don't rot" mechanism.
 *
 * Every runnable code snippet in README.md / docs/*.md / docs/design/*.md is generated FROM an example file in
 * examples/*.ts, never hand-copied. This script enforces that: it extracts the marked region from
 * each `examples/*.ts` file and the fenced code block each markdown `<!-- docs:embed <anchor> -->`
 * marker introduces, normalizes both, and fails (naming the anchor + files) on any mismatch.
 *
 * ── Convention ──────────────────────────────────────────────────────────────────────────────────
 *
 * In a markdown file (README.md, any docs/*.md, or docs/design/*.md — the canonical API
 * reference's runnable snippets are checked too; fences without a marker, e.g. type-signature
 * listings, are exempt):
 *
 *   <!-- docs:embed my-anchor -->
 *   ```ts
 *   ...code...
 *   ```
 *
 * The HTML comment must be the last non-blank line before the fence; the fence must open with
 * ```ts or ```typescript.
 *
 * In an examples/*.ts file, exactly one line (ignoring surrounding whitespace) must read:
 *
 *   // docs:embed my-anchor
 *
 * Everything strictly after that line, to the end of the file, is the embedded region — UNLESS the
 * file also contains a matching close marker:
 *
 *   // docs:embed-end my-anchor
 *
 * in which case the region is everything strictly between the two markers. The close marker lets an
 * example carry setup/skip-guard/runner plumbing (imports, availability checks, `main().catch(...)`)
 * that the docs snippet doesn't need to show.
 *
 * Every markdown anchor must have exactly one matching example anchor (across all example files);
 * every example file must declare exactly one start marker. Anchors are otherwise free-form strings
 * (no spaces).
 *
 * ── Normalization ───────────────────────────────────────────────────────────────────────────────
 *
 * Before comparing, both the markdown fence body and the example's extracted region are normalized
 * identically:
 *
 *   1. Drop marker lines themselves (the extracted example region never includes its own
 *      `// docs:embed[-end] ...` lines, but this is a no-op safety net).
 *   2. Drop single-line `import ... ;` statements. Examples resolve imports against local sources
 *      (`../src/index.js`) so `tsc` can check them without a build step; docs show the public
 *      package import (`@rift-vs/rift`). The two are allowed to differ — only the *behavior* below
 *      the imports has to match verbatim. KNOWN LIMITATION: because the doc's `@rift-vs/rift` import
 *      line is dropped here and `typecheck:examples` only checks the example's `../src` import, a
 *      doc snippet that imported a NON-EXISTENT public symbol would escape both gates. Keep the
 *      imported names in every doc snippet to real root exports (see `src/index.ts`).
 *   3. Strip trailing whitespace from every line.
 *   4. Trim leading/trailing blank lines.
 *   5. Dedent: remove the common leading-whitespace prefix shared by every remaining non-blank line
 *      (an example's marked region is usually indented, being inside a function body; a markdown
 *      fence is flush-left).
 *
 * The two normalized strings must then be byte-identical.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const START_RE = /^\s*\/\/\s*docs:embed\s+(\S+)\s*$/;
const END_RE = /^\s*\/\/\s*docs:embed-end\s+(\S+)\s*$/;
const MD_MARKER_RE = /^\s*<!--\s*docs:embed\s+(\S+)\s*-->\s*$/;
const FENCE_OPEN_RE = /^\s*```(ts|typescript)\s*$/;
const FENCE_CLOSE_RE = /^\s*```\s*$/;
const IMPORT_LINE_RE = /^\s*import\s.+;\s*$/;

function fail(message) {
  failures.push(message);
}

const failures = [];

// ── extract example regions ────────────────────────────────────────────────────────────────────

function listExampleFiles() {
  const dir = join(ROOT, 'examples');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f));
}

/** anchor -> { file, lines: string[] } */
function extractExampleRegions() {
  const regions = new Map();

  for (const file of listExampleFiles()) {
    const rel = file.slice(ROOT.length + 1);
    const lines = readFileSync(file, 'utf8').split('\n');

    const starts = [];
    for (let i = 0; i < lines.length; i++) {
      const m = START_RE.exec(lines[i]);
      if (m) starts.push({ index: i, anchor: m[1] });
    }

    if (starts.length === 0) {
      fail(`${rel}: no "// docs:embed <anchor>" marker found — every examples/*.ts file must declare one`);
      continue;
    }
    if (starts.length > 1) {
      fail(
        `${rel}: multiple "// docs:embed" start markers found (${starts
          .map((s) => s.anchor)
          .join(', ')}) — exactly one per file is supported`
      );
      continue;
    }

    const { index: startIndex, anchor } = starts[0];

    let endIndex = lines.length;
    for (let i = startIndex + 1; i < lines.length; i++) {
      const m = END_RE.exec(lines[i]);
      if (m) {
        if (m[1] !== anchor) {
          fail(`${rel}: "docs:embed-end ${m[1]}" does not match the open anchor "${anchor}"`);
        }
        endIndex = i;
        break;
      }
    }

    if (regions.has(anchor)) {
      fail(`Duplicate docs:embed anchor "${anchor}": ${regions.get(anchor).file} and ${rel}`);
      continue;
    }

    regions.set(anchor, { file: rel, lines: lines.slice(startIndex + 1, endIndex) });
  }

  return regions;
}

// ── extract markdown fenced blocks ─────────────────────────────────────────────────────────────

function listMarkdownFiles() {
  const files = [join(ROOT, 'README.md')];
  const docsDir = join(ROOT, 'docs');
  for (const f of readdirSync(docsDir)) {
    if (f.endsWith('.md')) files.push(join(docsDir, f));
  }
  const designDir = join(docsDir, 'design');
  for (const f of readdirSync(designDir)) {
    if (f.endsWith('.md')) files.push(join(designDir, f));
  }
  return files;
}

/** { anchor, file, lineNo, lines }[] */
function extractMarkdownBlocks() {
  const blocks = [];

  for (const file of listMarkdownFiles()) {
    const rel = file.slice(ROOT.length + 1);
    const lines = readFileSync(file, 'utf8').split('\n');

    for (let i = 0; i < lines.length; i++) {
      const m = MD_MARKER_RE.exec(lines[i]);
      if (!m) continue;
      const anchor = m[1];

      // The next non-blank line must be a fence open.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j >= lines.length || !FENCE_OPEN_RE.test(lines[j])) {
        fail(`${rel}:${i + 1}: "docs:embed ${anchor}" is not immediately followed by a \`\`\`ts fence`);
        continue;
      }

      let k = j + 1;
      const body = [];
      while (k < lines.length && !FENCE_CLOSE_RE.test(lines[k])) {
        body.push(lines[k]);
        k++;
      }
      if (k >= lines.length) {
        fail(`${rel}:${j + 1}: unterminated fenced code block for anchor "${anchor}"`);
        continue;
      }

      blocks.push({ anchor, file: rel, lineNo: i + 1, lines: body });
    }
  }

  return blocks;
}

// ── normalization ───────────────────────────────────────────────────────────────────────────────

function normalize(lines) {
  let out = lines.filter((l) => !START_RE.test(l) && !END_RE.test(l) && !IMPORT_LINE_RE.test(l));
  out = out.map((l) => l.replace(/\s+$/, ''));
  while (out.length > 0 && out[0].trim() === '') out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  const indents = out.filter((l) => l.trim() !== '').map((l) => /^(\s*)/.exec(l)[1].length);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  out = out.map((l) => l.slice(minIndent));
  return out.join('\n');
}

function firstDiffLine(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return `  line ${i + 1}:\n    doc:     ${JSON.stringify(la[i] ?? '<missing>')}\n    example: ${JSON.stringify(lb[i] ?? '<missing>')}`;
    }
  }
  return '  (no textual diff found — this should not happen)';
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────

const exampleRegions = extractExampleRegions();
const markdownBlocks = extractMarkdownBlocks();

if (markdownBlocks.length === 0) {
  fail('no `<!-- docs:embed ... -->` blocks found in README.md/docs/**/*.md — did the docs restructure regress?');
}

const usedAnchors = new Set();

for (const block of markdownBlocks) {
  usedAnchors.add(block.anchor);
  const region = exampleRegions.get(block.anchor);
  if (region === undefined) {
    fail(`${block.file}:${block.lineNo}: docs:embed "${block.anchor}" has no matching examples/*.ts file`);
    continue;
  }
  const docNormalized = normalize(block.lines);
  const exampleNormalized = normalize(region.lines);
  if (docNormalized !== exampleNormalized) {
    fail(
      `${block.file}:${block.lineNo}: docs:embed "${block.anchor}" does not match ${region.file}\n` +
        firstDiffLine(docNormalized, exampleNormalized)
    );
  }
}

// Orphan examples (no doc references them) are a smell — the anti-rot mechanism only bites in one
// direction (doc -> example), so this is a warning, not a failure.
for (const anchor of exampleRegions.keys()) {
  if (!usedAnchors.has(anchor)) {
    console.warn(`warning: examples/*.ts declares "docs:embed ${anchor}" but no markdown file embeds it`);
  }
}

if (failures.length > 0) {
  console.error(`docs:check failed — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`✗ ${f}\n`);
  process.exit(1);
}

console.log(`docs:check passed — ${markdownBlocks.length} embedded snippet(s) match their examples/*.ts source.`);
