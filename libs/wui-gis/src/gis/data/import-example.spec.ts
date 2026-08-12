// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TEMPORARY reproduction: does importing a shipped `gisSim` example keep its network?
 * Runs the page's own import path (`parseImport` → `normalizeSite`) on the real files.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseImport } from './io.js';

const FILES = [
  ['../../../../../backend/managers/gisSim/examples/gis-dubai-metro.json', 13, 13],
  ['../../../../../backend/managers/gisSim/examples/gis-france-nucleaire.json', 27, 19]
] as const;

describe('importing a gisSim example', () => {
  for (const [relative, assets, connections] of FILES) {
    it(`keeps the network of ${relative.split('/').pop()}`, () => {
      const text = readFileSync(new URL(relative, import.meta.url), 'utf8');
      const result = parseImport(text, 'example');
      expect(result.format).toBe('json');
      expect(result.sites).toHaveLength(1);
      const { site, report } = result.sites[0]!;
      // eslint-disable-next-line no-console
      console.log(
        `${site.name}: ${site.assets.length} assets, ${site.connections.length} connections, ` +
          `${site.routes.length} routes, ${site.layers.length} layers | dropped ` +
          `${report.droppedAssets} assets / ${report.droppedConnections} connections+routes+layers`
      );
      expect(site.assets).toHaveLength(assets);
      expect(site.connections).toHaveLength(connections);
      expect(site.connections.every((link) => link.dp !== '')).toBe(true);
      expect(site.connections.every((link) => link.readings.length > 0)).toBe(true);
    });
  }
});
