// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Every iX icon this module names must actually exist.
 *
 * An unknown name is not an error anywhere — `ix-icon` renders a square with a cross, which
 * looks like a deliberate glyph until someone reports it. It has happened twice: `plugin` in
 * the assistant's progress list, and `network` on this page's own "draw a line" button. Both
 * were plausible names; neither is in `@siemens/ix-icons`.
 *
 * So the names are checked against the installed icon set rather than against memory. This is
 * a lint dressed as a test, and it belongs here because there is nowhere else it would run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * This file's own directory. `process.cwd()` is NOT it — vitest runs from the workspace root
 * even with `--root`, so a cwd-relative path silently scanned the wrong tree (and the test
 * failed to collect, which is at least loud).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `src/`, two levels up from `src/gis/icons.spec.ts`. */
const SRC = path.resolve(HERE, '..');

/** Walk up from this file until the installed icon set turns up. */
function iconDir(): string | null {
  let current = HERE;
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(
      current,
      'node_modules/@siemens/ix-icons/dist/ix-icons/svg'
    );
    if (existsSync(candidate)) return candidate;
    current = path.resolve(current, '..');
  }
  return null;
}

/** Every `.ts` file of the module, so a new component cannot escape the check. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const entryPath = path.join(root, entry);
    if (statSync(entryPath).isDirectory()) out.push(...sourceFiles(entryPath));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      out.push(entryPath);
  }
  return out;
}

/**
 * Icon names written as literals: `name="x"`, `icon="x"`, and the ternary form
 * `icon=${cond ? 'a' : 'b'}` the toggles use. A name built from a variable cannot be checked
 * here — `map/glyphs.ts` maps every asset kind to a literal precisely so that it can be.
 */
function iconNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/(?:name|icon)="([a-z][a-z\d-]*)"/g)) {
    names.add(match[1] as string);
  }
  for (const match of source.matchAll(
    /(?:name|icon)=\$\{[^}]*?'([a-z][a-z\d-]*)'\s*:\s*'([a-z][a-z\d-]*)'/g
  )) {
    names.add(match[1] as string);
    names.add(match[2] as string);
  }
  return [...names];
}

describe('every iX icon named by this module exists', () => {
  const dir = iconDir();

  it('finds the installed icon set (else this test proves nothing)', () => {
    expect(dir).not.toBeNull();
  });

  if (!dir) return;

  const known = new Set(
    readdirSync(dir)
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/\.svg$/, ''))
  );

  const used = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    for (const name of iconNames(readFileSync(file, 'utf8'))) {
      used.set(name, [...(used.get(name) ?? []), file]);
    }
  }

  it('names at least a dozen icons, so the sweep is not vacuous', () => {
    expect(used.size).toBeGreaterThan(12);
  });

  it('and every one of them is in @siemens/ix-icons', () => {
    const missing = [...used]
      .filter(([name]) => !known.has(name))
      .map(([name, files]) => `${name} (${files.join(', ')})`);
    expect(missing).toEqual([]);
  });

  // The glyph map is the one place a name is chosen per asset kind, so it is worth its own
  // assertion: an unknown kind there means a marker with a broken glyph, on the map.
  it('every asset-kind glyph resolves', async () => {
    const { assetIcon } = await import('./map/glyphs.js');
    const { ASSET_KINDS } = await import('./types.js');
    const broken = ASSET_KINDS.filter((kind) => !known.has(assetIcon(kind)));
    expect(broken).toEqual([]);
  });
});
