// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tunnel import / export / duplication — thin domain wrappers over the shared
 * `wui-kit` IO primitives. Exports are human-readable JSON snapshots of the
 * persisted config (live telemetry stripped, like the store does). Imports
 * are validated structurally (tubes/segments/equipment arrays, required
 * scalar fields) so a foreign file fails fast instead of half-loading.
 */
import { JSON_INDENT, download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';
import { projectTunnel } from './hades-store.js';
import { ALL_PROFILES } from './compliance.js';
import type { RegulatoryProfileId, Tunnel } from '../types.js';

/** Download the tunnel as `hades-<id>-<date>.json`. */
export function exportTunnel(tunnel: Tunnel): void {
  const snapshot = projectTunnel(tunnel);
  // The backing DP is target-specific — a snapshot must re-import anywhere.
  delete snapshot.dp;
  download(`hades-${tunnel.id || 'tunnel'}-${timestampSlug()}.json`, JSON.stringify(snapshot, null, JSON_INDENT), 'application/json');
}

/**
 * Parse an exported tunnel file. Throws (with the reason) on structural
 * mismatch; the caller shows the message and aborts the import.
 */
export function parseTunnel(text: string): Tunnel {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('not a JSON object');
  const t = raw as Partial<Tunnel>;
  if (typeof t.name !== 'string' || t.name === '') throw new Error('missing "name"');
  if (!Array.isArray(t.tubes) || t.tubes.length === 0) throw new Error('missing "tubes"');
  for (const tube of t.tubes) {
    if (typeof tube.id !== 'string' || !Array.isArray(tube.segments)) throw new Error('malformed tube');
  }
  if (!Array.isArray(t.equipment)) throw new Error('missing "equipment"');
  if (!Array.isArray(t.modes)) throw new Error('missing "modes"');
  const profile: RegulatoryProfileId = ALL_PROFILES.includes(t.profile as RegulatoryProfileId)
    ? (t.profile as RegulatoryProfileId)
    : 'eu-2004-54';
  return {
    id: '',
    name: t.name,
    profile,
    trafficPerLane: typeof t.trafficPerLane === 'number' ? t.trafficPerLane : 2000,
    tubes: t.tubes,
    equipment: t.equipment,
    modes: t.modes
  };
}

/** In-memory copy of a tunnel, ready for `createTunnel` (new DP, same content). */
export function duplicateTunnel(tunnel: Tunnel, copySuffix: string): Tunnel {
  const copy = structuredClone(projectTunnel(tunnel));
  delete copy.dp;
  copy.id = '';
  copy.name = `${tunnel.name} ${copySuffix}`;
  return copy;
}

/** Read a picked file as text (import flow). */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('unreadable file'));
    reader.readAsText(file);
  });
}
