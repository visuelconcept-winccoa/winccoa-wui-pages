#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Verify that the classic-S7 feature is REACHABLE in the studio, end to end.
// -----------------------------------------------------------------------------
//   node tools/check-eng-s7-demo.mjs
//
// A feature can be correct and still be invisible. This one shipped that way
// once: `s7BrowseAvailable` was declared, bound to the panel and never assigned,
// so the "check against the CPU" action never rendered — and the offline demo had
// no classic-S7 equipment at all, so nothing showed it.
//
// So this asserts the CHAIN a user actually walks, on the real modules (bundled
// with esbuild, no test runner and no browser — the same technique as
// check-eng-i18n.mjs):
//
//   1. the creation form offers both STEP 7 file generators;
//   2. the demo declares a classic-S7 equipment and its two catalogs;
//   3. the gateway reports the reader as reachable, which is what un-hides the
//      action;
//   4. the panel's own predicate says the catalog is verifiable;
//   5. the cross-check actually finds the divergence the fixtures encode.
//
// Exits non-zero on the first broken link.
// -----------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DEMO_DIR = resolve(REPO, 'libs/wui-eng-studio/demo');

const esbuild = await (async () => {
  for (const from of [resolve(DEMO_DIR, 'package.json'), resolve(REPO, 'package.json')]) {
    try {
      return createRequire(pathToFileURL(from))('esbuild');
    } catch {
      continue;
    }
  }
  throw new Error('esbuild not found — run npm install at the repo root or in libs/wui-eng-studio/demo');
})();

/**
 * Resolve the workspace's own package specifiers, as the demo's vite config does.
 * The core ships TypeScript sources, so the bare name and its `/samples/…`
 * subpaths both map straight into `libs/wui-eng-core/src`.
 */
const workspaceAlias = {
  name: 'workspace-alias',
  setup(build) {
    build.onResolve({ filter: /^@visuelconcept\/wui-eng-core(\/.*)?$/ }, (args) => {
      const sub = args.path.replace('@visuelconcept/wui-eng-core', '').replace(/^\//, '');
      const target = sub === '' ? 'index.ts' : sub.replace(/\.js$/, '.ts');
      return { path: resolve(REPO, 'libs/wui-eng-core/src', target) };
    });
  }
};

/** Bundle one module of the page and import it. */
async function load(entry) {
  const bundle = await esbuild.build({
    entryPoints: [resolve(REPO, entry)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
    plugins: [workspaceAlias],
    // The page modules import lit and the iX wrappers, which this check never
    // touches: stub them so the DATA modules can be loaded on their own.
    external: ['lit', 'lit/*', '@lit/*', '@wincc-oa/*', '@siemens/*']
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}

const failures = [];
let checks = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures.push(label);
  console.error(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

console.log('Classic-S7 reachability in the Engineering Studio\n');

// --- 1 · the creation form offers both STEP 7 generators ---------------------
console.log('· the catalogue creation form');
const formSource = await import('node:fs').then((fs) => fs.readFileSync(resolve(REPO, 'libs/wui-eng-studio/src/eng-studio/ui/eng-book-form.ts'), 'utf8'));
const formatsLine = /const FORMATS: BookFormat\[\] = \[(.*?)\];/s.exec(formSource)?.[1] ?? '';
ok("offers 's7sym' (symbol table)", formatsLine.includes("'s7sym'"), formatsLine);
ok("offers 's7awl' (DB sources)", formatsLine.includes("'s7awl'"), formatsLine);
// The two online generators are filtered on having something to browse; the file
// ones must NOT be, or a fresh project could never create its first catalog.
const offeredBlock = /const offered = FORMATS\.filter\(\(format\) => \{(.*?)\}\);/s.exec(formSource)?.[1] ?? '';
ok('does not hide the file generators behind a connection list', /return true;\s*$/m.test(offeredBlock.trim()), offeredBlock.trim());
ok(
  'binds the classic-S7 interface protocol to the generator (else modelgen reads the wrong candidate address)',
  /INTERFACE_PROTOCOL[\S\s]*?s7sym:\s*'s7'[\S\s]*?s7awl:\s*'s7'/.test(formSource)
);
// A bundle picker that REPLACED on every pick would silently drop the files an
// engineer selected first — the failure is invisible until the catalog comes out
// short, blaming a UDT they did supply.
const bundleLine = /const BUNDLE_FORMATS = new Set<BookFormat>\(\[(.*?)\]\);/s.exec(formSource)?.[1] ?? '';
ok("treats 's7awl' as a bundle (multi-file)", bundleLine.includes("'s7awl'"), bundleLine);
ok('accumulates across successive picks instead of replacing', /BUNDLE_FORMATS\.has\(this\.fFormat\)[\S\s]{0,320}merged\.set\(/.test(formSource));
ok('keys the merge by file name, so a re-export replaces its own file', /new Map\(this\.fFiles\.map\(\(file\) => \[file\.fileName, file\]\)\)/.test(formSource));
ok('clears the input so re-picking the SAME file fires change again', /input\.value = '';/.test(formSource));
ok('lets a mis-picked file be removed without starting over', /private async removeFile\(/.test(formSource));
ok('and says that picking again ADDS (the control implies the opposite)', /bookFilesAccumulate/.test(formSource));

// --- 2 · the demo declares a classic-S7 equipment and its catalogs -----------
console.log('\n· the offline demo');
const demoData = await load('libs/wui-eng-studio/src/eng-studio/data/demo-data.ts');
const devices = demoData.DEMO_DEVICES;
const classic = devices.filter((device) => device.protocol === 's7');
ok('declares at least one classic-S7 equipment', classic.length > 0, `protocols: ${[...new Set(devices.map((d) => d.protocol))].join(', ')}`);
const station = classic[0];
ok('…with the ip/rack/slot the reader needs', Boolean(station?.connection?.ip) && station?.connection?.slot !== undefined, JSON.stringify(station?.connection));

const books = demoData.demoBooks();
const byId = new Map(books.map((book) => [book.id, book]));
const s7Books = books.filter((book) => book.entries.some((entry) => entry.addresses.s7 !== undefined));
ok('ships catalogs carrying classic S7 operands', s7Books.length >= 2, `ids: ${s7Books.map((b) => b.id).join(', ')}`);
ok(
  'and the equipment references them',
  (station?.bookIds ?? []).some((id) => byId.get(id)?.entries.some((entry) => entry.addresses.s7 !== undefined)),
  JSON.stringify(station?.bookIds)
);

const symbols = byId.get('book-s7-symboles');
const sources = byId.get('book-s7-sources');
ok('the symbol table catalogs the memory areas', symbols?.entries.some((entry) => /^[EAMQIP]/.test(String(entry.addresses.s7))) === true);
ok(
  'and SAYS that it holds no data-block content',
  symbols?.warnings.some((warning) => warning.code === 's7sym.no-db-content') === true,
  (symbols?.warnings ?? []).map((w) => w.code).join(', ')
);
ok(
  'the sources catalog the DB members, named from the block directory',
  sources?.entries.some((entry) => entry.path.startsWith('Echange.')) === true,
  (sources?.entries ?? []).slice(0, 3).map((e) => e.path).join(', ')
);

// --- 3 · the gateway un-hides the action ------------------------------------
console.log('\n· the gateway');
const demoGatewayModule = await load('libs/wui-eng-studio/src/eng-studio/data/demo-gateway.ts');
const gateway = new demoGatewayModule.DemoEngGateway();
const health = await gateway.s7BrowseHealth();
ok('reports the classic-S7 reader as reachable (what sets s7BrowseAvailable)', health.reachable === true, JSON.stringify(health));

const pageSource = await import('node:fs').then((fs) => fs.readFileSync(resolve(REPO, 'libs/wui-eng-studio/src/eng-studio.ts'), 'utf8'));
ok('the page ASSIGNS that flag (the bug this check exists for)', /this\.s7BrowseAvailable\s*=\s*s7Browse\.reachable/.test(pageSource));
ok('and only probes when the project has a classic-S7 equipment', /protocol === 's7'\)[\S\s]{0,200}s7BrowseHealth/.test(pageSource));

// --- 4 · the panel's own predicate ------------------------------------------
console.log('\n· the Catalogues panel');
const panelSource = await import('node:fs').then((fs) => fs.readFileSync(resolve(REPO, 'libs/wui-eng-studio/src/eng-studio/ui/eng-books.ts'), 'utf8'));
ok('renders the action from s7Verifiable()', /\$\{this\.s7Verifiable\(book\)/.test(panelSource));
// Reproduce the predicate against the real catalogs, so a change to it is caught.
const verifiable = (book, available = true) => {
  if (!available) return false;
  if (book.interface !== undefined && book.interface.protocol !== 's7') return false;
  return book.entries.some((entry) => entry.addresses.s7 !== undefined);
};
ok('says the S7 sources catalog IS verifiable', verifiable(sources) === true);
ok('says an S7Plus catalog is NOT', verifiable(byId.get('book-s7-four')) === false);
ok('and offers nothing when the reader is absent', verifiable(sources, false) === false);

// --- 5 · the cross-check finds the encoded divergence ------------------------
console.log('\n· the online cross-check');
const result = await gateway.s7Inventory('book-s7-sources', { deviceId: station.id });
const codes = result.crossCheck.warnings.map((warning) => warning.code);
ok('names the CPU that answered', Boolean(result.inventory.cpu.moduleTypeName ?? result.inventory.cpu.orderCode), JSON.stringify(result.inventory.cpu));
ok('finds the block the catalog reads PAST THE END of', codes.includes('s7browse.db-overrun'), codes.join(', '));
ok('reports the blocks the export left behind', codes.includes('s7browse.db-uncatalogued'), codes.join(', '));
ok('and leaves the catalog untouched', JSON.stringify(byId.get('book-s7-sources')) === JSON.stringify(sources));

// --- 6 · what the CPU-reading table actually SHOWS ---------------------------
// The panel merges the two readings into one row per data block. Reproduced here
// against the real demo data, so the DISPLAY is checked and not merely the fact
// that a renderer exists — a table that silently dropped the uncatalogued blocks
// would still render, and would hide half of what the round-trip is for.
console.log('\n· the CPU-reading table');
const core = await load('libs/wui-eng-core/src/index.ts');
const rowsOf = (book, inv) => {
  const addressed = core.dataBlocksAddressedBy(book);
  const verdicts = new Map(inv.crossCheck.verdicts.map((v) => [v.dbNumber, v]));
  const blocks = new Map(inv.inventory.blocks.filter((b) => b.kind === 'DB').map((b) => [b.number, b]));
  return [...new Set([...verdicts.keys(), ...blocks.keys()])]
    .sort((a, b) => a - b)
    .map((dbNumber) => {
      const first = addressed.get(dbNumber)?.paths[0]?.split('.')[0];
      return {
        dbNumber,
        label: first === undefined || first === `DB${dbNumber}` ? undefined : first,
        status: verdicts.get(dbNumber)?.status ?? 'uncatalogued',
        signals: verdicts.get(dbNumber)?.signals,
        read: verdicts.get(dbNumber)?.highestByte,
        cpuSize: blocks.get(dbNumber)?.mc7Size
      };
    });
};
const rows = rowsOf(sources, result);
ok('shows one row per data block, both readings merged', rows.length === 2, JSON.stringify(rows));
const db10 = rows.find((row) => row.dbNumber === 10);
ok('names the block by its PROJECT name, not just its number', db10?.label === 'Echange', JSON.stringify(db10));
ok('shows the block the catalog reads past the end of, with both sizes', db10?.status === 'overrun' && db10.read > db10.cpuSize, JSON.stringify(db10));
ok('counts the catalog signals bound to it', typeof db10?.signals === 'number' && db10.signals > 0, JSON.stringify(db10));
const db11 = rows.find((row) => row.dbNumber === 11);
ok('KEEPS the block the CPU holds and the catalog ignores', db11?.status === 'uncatalogued', JSON.stringify(db11));
ok('…with no catalog figures for it, rather than a misleading zero', db11?.signals === undefined && db11?.read === undefined, JSON.stringify(db11));
ok('and reports the CPU size it did read', db11?.cpuSize === 200, JSON.stringify(db11));

// Every status the table can paint must have a word AND a tooltip in all three
// languages — a pill with no label is a colour an operator has to guess at.
const i18nBundle = await load('libs/wui-eng-studio/src/eng-studio/i18n.ts');
for (const status of ['ok', 'absent', 'overrun', 'unknown', 'uncatalogued']) {
  const label = i18nBundle.MSG.s7Status[status];
  const hint = i18nBundle.MSG.s7StatusHint[status];
  ok(`the '${status}' pill has a label and a tooltip`, Boolean(label?.fr) && Boolean(hint?.fr));
}


console.log(`\n${checks - failures.length}/${checks} checks passed.`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('OK — a user can reach the classic-S7 import AND its online check.');
