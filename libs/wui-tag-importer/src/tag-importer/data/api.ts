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

/** OPC UA message security policy (subset offered by the create form). */
export type SecurityPolicy = 'None' | 'Basic256Sha256' | 'Aes128_Sha256_RsaOaep' | 'Aes256_Sha256_RsaPss';
/** OPC UA message security mode. */
export type MessageMode = 'None' | 'Sign' | 'SignAndEncrypt';

/** Parameters to create a new OPC UA connection (`_OPCUAServer`). */
export interface NewConnection {
  /** Optional connection name; the backend auto-generates one when empty. */
  name?: string;
  /** Endpoint URL, e.g. `opc.tcp://host:4840`. */
  endpoint: string;
  securityPolicy?: SecurityPolicy;
  messageMode?: MessageMode;
  /** Optional user for username/password authentication. */
  user?: string;
  password?: string;
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

/** Create (and register) a new OPC UA connection; returns it + any non-fatal warnings. */
export async function createConnection(cfg: NewConnection): Promise<{ connection: Connection; warnings: string[] }> {
  const data = await postJson<{ connection: Connection; warnings?: string[] }>(`${BASE}/connection`, cfg);
  return { connection: data.connection, warnings: data.warnings ?? [] };
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
