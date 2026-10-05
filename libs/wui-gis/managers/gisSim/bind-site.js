#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * gisSim — write the simulator's bindings into an exported GIS site.
 *
 * The manager deliberately never writes to a site (a binding is the page's business), so
 * this is the other half: it takes a site exported from `/gis` — native JSON,
 * `{ kind: 'gis-sites', version, sites: [...] }` — and fills in, for every asset and every
 * connection, the `dp` and the `readings` of the family its kind and its links put it in.
 * Import the result back into the page and everything reads live.
 *
 * It uses the SAME catalogue as the manager (`families.js`), which is the point: the names
 * it writes are the names the manager drives, and neither can drift from the other.
 *
 *   node bind-site.js <site.json> [--out <file.json>] [--system System1:] [--force]
 *
 *   --out     where to write (default: alongside the input, suffixed `-bound`)
 *   --system  system prefix of the bindings, `--system ''` for none (default `System1:`)
 *   --force   rebind objects that already carry bindings (default: only fill what is empty)
 *
 * Nothing else in the file is touched: positions, zones, layers, routes and notes come out
 * exactly as they went in.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const fam = require('./families.js');

/** The page keeps at most 8 readings per object (`normalize.ts`). */
const MAX_READINGS = 8;

function fail(message) {
  console.error(`bind-site: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { force: false, system: fam.SYSTEM, input: '', out: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--force') args.force = true;
    else if (arg === '--system') args.system = argv[++index] ?? '';
    else if (arg === '--out') args.out = argv[++index] ?? '';
    else if (arg.startsWith('--')) fail(`option inconnue : ${arg}`);
    else args.input = arg;
  }
  if (!args.input) fail('usage: node bind-site.js <site.json> [--out f] [--system s] [--force]');
  if (!args.out) {
    const parsed = path.parse(args.input);
    args.out = path.join(parsed.dir, `${parsed.name}-bound${parsed.ext || '.json'}`);
  }
  return args;
}

/** The sites of a file: the native envelope, a bare array, or a single site. */
function sitesOf(data) {
  if (Array.isArray(data?.sites)) return data.sites;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.assets)) return [data];
  fail('fichier non reconnu : ni { kind: "gis-sites", sites: [...] }, ni un site.');
  return [];
}

/**
 * Bind one asset or one connection.
 *
 * `dp` is filled when empty. The readings are REPLACED by the family's when the object
 * carries none that is bound — the usual case for a site drafted by hand or by the
 * assistant, where the readings are captions waiting for a datapoint. When some are already
 * bound, only the empty ones are filled (matched by id) and the family's missing ones are
 * appended, so a hand-tuned site keeps its shape.
 */
function bind(item, stem, family, options) {
  if (options.force || !String(item.dp ?? '').trim()) {
    item.dp = fam.primaryDp(stem, options.system);
  }
  const suggested = fam.readingsOf(family, stem, options.system);
  const current = Array.isArray(item.readings) ? item.readings : [];
  const alreadyBound = current.filter((reading) =>
    String(reading?.dp ?? '').trim()
  );
  if (options.force || alreadyBound.length === 0) {
    item.readings = suggested;
    return;
  }
  for (const reading of current) {
    if (String(reading.dp ?? '').trim()) continue;
    const match = suggested.find((candidate) => candidate.id === reading.id);
    if (match) reading.dp = match.dp;
  }
  for (const candidate of suggested) {
    if (current.length >= MAX_READINGS) break;
    if (!current.some((reading) => reading.id === candidate.id))
      current.push(candidate);
  }
  item.readings = current;
}

function bindSite(site, options) {
  const connections = Array.isArray(site.connections) ? site.connections : [];
  const report = [];
  for (const asset of site.assets ?? []) {
    if (!asset?.id) continue;
    const resolved = fam.familyOfAsset(asset, connections);
    bind(asset, fam.assetStem(asset.id), fam.ASSET_FAMILIES[resolved.name], options);
    report.push(`  ${asset.id} → ${resolved.name} (${resolved.reason})`);
  }
  for (const link of connections) {
    if (!link?.id) continue;
    const resolved = fam.familyOfLink(link);
    bind(link, fam.linkStem(link.id), fam.LINK_FAMILIES[resolved.name], options);
    report.push(`  ${link.id} ⇢ ${resolved.name} (${resolved.reason})`);
  }
  return report;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let data;
  try {
    data = JSON.parse(readFileSync(options.input, 'utf8'));
  } catch (error) {
    fail(`lecture de ${options.input} : ${error.message}`);
  }
  const sites = sitesOf(data);
  for (const site of sites) {
    console.log(`${site.name || site.id || 'site'} :`);
    for (const line of bindSite(site, options)) console.log(line);
  }
  writeFileSync(options.out, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  const objects = sites.reduce(
    (total, site) =>
      total + (site.assets?.length ?? 0) + (site.connections?.length ?? 0),
    0
  );
  console.log(`\n${objects} objet(s) lié(s) dans ${sites.length} site(s) → ${options.out}`);
}

main();
