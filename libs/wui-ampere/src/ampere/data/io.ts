// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import / export + normalisation for Ampère networks.
 *
 * `parseNetworks` accepts a bare array, the export envelope
 * (`{ kind, version, networks }`) or a single network object, and coerces every
 * record (nodes, edges, measurements) against the blank defaults — so importing
 * one or several networks works from any of these shapes. {@link normalizeNetwork}
 * is reused by the AI assistant to sanitise a model it proposes before it is
 * loaded into the editor.
 */
import { JSON_INDENT, download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';
import { SYMBOLS, type SymbolId } from '../symbols/catalog.js';
import {
  ROTATIONS,
  blankMeasurement,
  blankNetwork,
  type Edge,
  type Measurement,
  type Network,
  type Node,
  type Rotation
} from '../types.js';

const KIND = 'ampere-networks';
const SLUG_MAX = 40;

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, SLUG_MAX) || 'reseau'
  );
}

function envelope(networks: Network[]): string {
  return JSON.stringify({ kind: KIND, version: 1, networks }, null, JSON_INDENT);
}

/** Download the whole catalogue as a JSON file. */
export function exportJson(networks: Network[]): void {
  download(`ampere-networks-${timestampSlug()}.json`, envelope(networks), 'application/json');
}

/** Download a single network as a JSON file (same envelope as the catalogue). */
export function exportNetwork(network: Network): void {
  download(`ampere-${slug(network.name)}.json`, envelope([network]), 'application/json');
}

/** Parse imported JSON into a normalised network list. Throws when none is found. */
export function parseNetworks(text: string): Network[] {
  const raw: unknown = JSON.parse(text);
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['networks'])) list = obj['networks'];
    else if ('nodes' in obj || 'name' in obj) list = [obj];
  }
  if (!Array.isArray(list)) {
    throw new TypeError('Format invalide : aucun réseau trouvé.');
  }
  return list.map((item) => normalizeNetwork(item as Record<string, unknown>));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asSymbol(value: unknown): SymbolId | null {
  return typeof value === 'string' && value in SYMBOLS ? (value as SymbolId) : null;
}

function asRotation(value: unknown): Rotation {
  const n = asNumber(value, 0);
  return (ROTATIONS.find((r) => r === n) ?? 0);
}

function normalizeNode(item: Record<string, unknown>, index: number): Node | null {
  const symbol = asSymbol(item['symbol']);
  if (!symbol) return null;
  return {
    id: asString(item['id']) || `n-${index}`,
    symbol,
    label: asString(item['label']),
    labelDx: asNumber(item['labelDx'], 0),
    labelDy: asNumber(item['labelDy'], 0),
    x: asNumber(item['x'], 0),
    y: asNumber(item['y'], 0),
    rotation: asRotation(item['rotation']),
    dp: asString(item['dp']),
    closedValue: asNumber(item['closedValue'], 1),
    source: Boolean(item['source'])
  };
}

function normalizeEdge(item: Record<string, unknown>, index: number, portsById: Map<string, Set<string>>): Edge | null {
  const from = item['from'] as Record<string, unknown> | undefined;
  const to = item['to'] as Record<string, unknown> | undefined;
  if (!from || !to) return null;
  const fromNode = asString(from['nodeId']);
  const toNode = asString(to['nodeId']);
  const fromPort = asString(from['port']);
  const toPort = asString(to['port']);
  // Drop edges that reference an unknown node or a port the symbol does not have.
  if (!portsById.get(fromNode)?.has(fromPort) || !portsById.get(toNode)?.has(toPort)) return null;
  return {
    id: asString(item['id']) || `e-${index}`,
    from: { nodeId: fromNode, port: fromPort },
    to: { nodeId: toNode, port: toPort }
  };
}

function normalizeMeasurement(item: Record<string, unknown>, index: number): Measurement {
  const base = blankMeasurement();
  return {
    ...base,
    id: asString(item['id']) || `m-${index}`,
    dp: asString(item['dp']),
    label: asString(item['label']),
    unit: asString(item['unit']) || base.unit,
    decimals: asNumber(item['decimals'], base.decimals),
    nodeId: asString(item['nodeId']),
    x: asNumber(item['x'], 0),
    y: asNumber(item['y'], 0)
  };
}

/** Coerce an arbitrary object into a valid {@link Network} (drops bad nodes/edges). */
export function normalizeNetwork(item: Record<string, unknown>): Network {
  const base = blankNetwork();
  const rawNodes = Array.isArray(item['nodes']) ? item['nodes'] : [];
  const nodes = rawNodes
    .map((n, i) => normalizeNode(n as Record<string, unknown>, i))
    .filter((n): n is Node => n != null);

  const portsById = new Map<string, Set<string>>(
    nodes.map((n) => [n.id, new Set(Object.keys(SYMBOLS[n.symbol].ports))])
  );
  const rawEdges = Array.isArray(item['edges']) ? item['edges'] : [];
  const edges = rawEdges
    .map((e, i) => normalizeEdge(e as Record<string, unknown>, i, portsById))
    .filter((e): e is Edge => e != null);

  const rawMeas = Array.isArray(item['measurements']) ? item['measurements'] : [];
  const measurements = rawMeas.map((m, i) => normalizeMeasurement(m as Record<string, unknown>, i));

  return {
    ...base,
    id: asString(item['id']),
    name: asString(item['name']),
    description: asString(item['description']),
    updatedAt: asString(item['updatedAt']),
    nodes,
    edges,
    measurements
  };
}
