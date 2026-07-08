// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Client for the Tag Importer backend (`/api/tag-importer`, served by the
 * webserver over `WsjServerGlobal.winccoa`). Connections + live browse + apply.
 * NodeSet2 XML parsing happens entirely in the browser (see the nodeset
 * adapter) and never hits this API.
 */
import type { ApplyResult, ImportPlan } from '../core/plan.js';

const BASE = '/api/tag-importer';

/** One OPC UA server connection (`_OPCUAServer`), name without leading underscore. */
export interface Connection {
  name: string;
  connected: boolean;
}

/** One node from a browse level. */
export interface BrowseNode {
  displayName: string;
  nodeId: string;
  browsePath: string;
  nodeClass: string;
  dataType: string;
  valueRank: number;
  hasChildren: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function postJson<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** List the OPC UA server connections available for online browsing. */
export async function listConnections(): Promise<Connection[]> {
  const data = await getJson<{ connections: Connection[] }>(`${BASE}/connections`);
  return data.connections ?? [];
}

/** Browse one level (or `depth` levels) of a live server below `nodeId`. */
export async function browse(connection: string, nodeId?: string, depth = 1): Promise<BrowseNode[]> {
  const data = await postJson<{ nodes: BrowseNode[] }>(`${BASE}/browse`, { connection, nodeId, depth });
  return data.nodes ?? [];
}

/** Apply (or dry-run) an import plan. */
export function apply(plan: ImportPlan, dryRun: boolean): Promise<ApplyResult> {
  return postJson<ApplyResult>(`${BASE}/apply`, { plan, dryRun });
}
