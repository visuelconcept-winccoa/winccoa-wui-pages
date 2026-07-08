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

/** One OPC UA server connection (`_OPCUAServer`). */
export interface Connection {
  /** Bare server name (no system prefix, no leading underscore) — used in the address reference. */
  name: string;
  /** Full datapoint path (may be system-qualified, e.g. `System1:_Simulator1`) — used to browse/read. */
  dp: string;
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
  /** OPC UA client driver (manager) number; auto-detected when omitted. */
  managerNumber?: number;
}

/** Editable config of an existing connection (password is never read back). */
export interface ConnectionConfig {
  endpoint: string;
  user: string;
  securityPolicy: SecurityPolicy;
  messageMode: MessageMode;
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

/** Read an existing connection's editable config (by DP path), to pre-fill the edit form. */
export async function readConnection(dp: string): Promise<ConnectionConfig> {
  const data = await postJson<{ config: ConnectionConfig }>(`${BASE}/connection/read`, { dp });
  return data.config;
}

/** Update an existing connection's config in place. */
export async function updateConnection(dp: string, cfg: NewConnection): Promise<{ connection: Connection; warnings: string[] }> {
  const data = await postJson<{ connection: Connection; warnings?: string[] }>(`${BASE}/connection/update`, { dp, ...cfg });
  return { connection: data.connection, warnings: data.warnings ?? [] };
}

/** Manager numbers of the OPC UA client drivers currently running. */
export async function listDrivers(): Promise<number[]> {
  const data = await getJson<{ drivers: number[] }>(`${BASE}/drivers`);
  return data.drivers ?? [];
}

/** Existing (non-internal) datapoint types, for "reuse an existing DPType". */
export async function listDpTypes(): Promise<string[]> {
  const data = await getJson<{ types: string[] }>(`${BASE}/dptypes`);
  return data.types ?? [];
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
