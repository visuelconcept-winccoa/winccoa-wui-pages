#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// vendor-page.mjs <page> <libsRoot> <outStandalonePagesDir>
//
// Produces a SELF-CONTAINED standalone-pages frontend for one page lib, robust
// to ANY internal layout:
//   <out>/<page>.ts          thin entry shim: `import './<page>/<page>.js';`
//   <out>/<page>/...         the ENTIRE lib src/ copied verbatim
//   <out>/<page>/_vendor/<lib>/...   the transitive closure of every @visuelconcept
//                            file the page reaches — INCLUDING the relative-import
//                            siblings each vendored file pulls in within its own lib.
//
// Closure rule:
//   • page files  -> follow @visuelconcept/<lib>/<path> imports (cross-lib).
//   • vendored files -> follow @visuelconcept imports AND their own relative
//     imports (./x, ../y) so a vendored module's siblings come along.
// Every @visuelconcept import is then rewritten to a relative path; relative
// imports inside vendored files already resolve (siblings were copied alongside).
// -----------------------------------------------------------------------------
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const [page, libsRoot, outDir] = process.argv.slice(2);
if (!page || !libsRoot || !outDir) {
  console.error('Usage: node vendor-page.mjs <page> <libsRoot> <outStandalonePagesDir>');
  process.exit(1);
}

const pageSrc = join(libsRoot, `wui-${page}`, 'src');
const entrySrc = join(pageSrc, `${page}.ts`);
if (!existsSync(entrySrc)) { console.error(`entry not found: ${entrySrc}`); process.exit(1); }

const VC = /@visuelconcept\/(wui-[a-z0-9-]+)\/([^'"]+?)(?:\.js)?(['"])/g;          // cross-lib
const REL = /(?:from|import|export)\s*\(?\s*['"](\.\.?\/[^'"]+?)(?:\.js)?['"]/g;    // relative specifiers

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
function vcDeps(text) { const d = []; let m; VC.lastIndex = 0; while ((m = VC.exec(text)) !== null) d.push({ lib: m[1], path: m[2] }); return d; }
function relDeps(text) { const d = []; let m; REL.lastIndex = 0; while ((m = REL.exec(text)) !== null) d.push(m[1]); return d; }
// resolve a no-ext module path to an actual source file (.ts or dir/index.ts)
function resolveTs(base) {
  if (existsSync(`${base}.ts`)) return `${base}.ts`;
  if (existsSync(base) && statSync(base).isDirectory() && existsSync(join(base, 'index.ts'))) return join(base, 'index.ts');
  if (existsSync(base) && base.endsWith('.ts')) return base;
  return null;
}

// 1. copy the entire lib src into <out>/<page>/
const implRoot = join(outDir, page);
mkdirSync(implRoot, { recursive: true });
cpSync(pageSrc, implRoot, { recursive: true });

// 2. entry shim
writeFileSync(join(outDir, `${page}.ts`), `// Auto-generated entry shim (self-contained page module). Bundled into ${page}.js.\nimport './${page}/${page}.js';\nexport * from './${page}/${page}.js';\n`);

// 3. BFS closure
const vendorRoot = join(implRoot, '_vendor');
const seen = new Set();          // absolute source paths already vendored
const missing = [];
// queue items: { dst, src, lib }  (src/lib null for page files -> relatives NOT followed)
const queue = walk(implRoot).map((dst) => ({ dst, src: null, lib: null }));

function vendorFile(lib, srcFile) {
  const within = relative(join(libsRoot, lib, 'src'), srcFile).split(sep).join('/');
  const dst = join(vendorRoot, lib, within);
  if (!seen.has(srcFile)) {
    seen.add(srcFile);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(srcFile, dst);
    queue.push({ dst, src: srcFile, lib });
  }
  return dst;
}

while (queue.length) {
  const item = queue.shift();
  const text = readFileSync(item.dst, 'utf8');
  // cross-lib @visuelconcept imports (followed for ALL files)
  for (const { lib, path } of vcDeps(text)) {
    const srcFile = join(libsRoot, lib, 'src', `${path}.ts`);
    if (existsSync(srcFile)) vendorFile(lib, srcFile);
    else missing.push(`@visuelconcept/${lib}/${path}`);
  }
  // relative imports (followed only for VENDORED files, to pull their lib siblings)
  if (item.lib) {
    for (const spec of relDeps(text)) {
      const target = resolveTs(resolve(dirname(item.src), spec));
      if (!target) { missing.push(`${spec} (relative, from ${item.src})`); continue; }
      if (target.endsWith('.ts')) vendorFile(item.lib, target);
    }
  }
}

// 4. rewrite @visuelconcept imports to relative _vendor paths
let rewrites = 0;
for (const file of walk(implRoot)) {
  let changed = false;
  const text = readFileSync(file, 'utf8').replace(VC, (_w, lib, p, quote) => {
    let rel = relative(dirname(file), join(vendorRoot, lib, `${p}.js`)).split(sep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    changed = true; rewrites += 1;
    return `${rel}${quote}`;
  });
  if (changed) writeFileSync(file, text);
}

console.log(`[${page}] vendored ${seen.size} file(s) across ${new Set([...seen].map((s) => relative(libsRoot, s).split(sep)[0])).size} lib(s); ${rewrites} import(s) rewritten`);
if (missing.length) {
  console.warn(`[${page}] ! ${missing.length} unresolved import(s):`);
  for (const x of [...new Set(missing)]) console.warn(`    - ${x}`);
  process.exitCode = 2;
}
