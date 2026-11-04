// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// vncStore — the VNC connections, read and written by the webserver
// -----------------------------------------------------------------------------
// One DP per connection, unchanged since 0.1: `RemoteVnc_<id>` of type
// `RemoteVnc_Connection` (Struct: `name` String + `json` String, the whole
// connection serialised). Since 0.2 the page no longer writes them through
// the generic `/api/para` routes (wui-kit DpJsonStore): it calls this module's
// own routes (vncRoute.ts), which check the `edit` role and write here through
// the webserver's shared WinCC OA API (WsjServerGlobal.winccoa).
//
// - The password stays in the DP (same format), but no route ever answers it:
//   every read goes out through `publicConnection` (password removed,
//   `hasPassword` instead). Only the relay reads it (`readSecret`), to
//   authenticate to the VNC server itself (rfbBroker.ts).
// - An update without a `password` field keeps the stored one; a string
//   replaces it (empty = remove).
// - The GxP audit trail is kept: `AuditTrail_RemoteVnc` (`_AuditTrail` type),
//   one row per create / update / delete, item = the DP, itemtype
//   `VncConnection`, the password masked (`••••`), `lastConnectedAt` ignored —
//   the same rows DpJsonStore wrote from the browser, now with the verified
//   user and the client's address.
// - `lastConnectedAt` is stamped by the relay when a session opens (server
//   local time), no longer by the page (that would need the `edit` role).
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { WinccoaDpTypeNode, WinccoaElementType } from 'winccoa-manager';

export const CONN_TYPE = 'RemoteVnc_Connection';
export const DP_PREFIX = 'RemoteVnc_';
export const AUDIT_DP = 'AuditTrail_RemoteVnc';
const AUDIT_TYPE = '_AuditTrail';
const AUDIT_ITEM_TYPE = 'VncConnection';
const AUDIT_LEAVES = ['time', 'username', 'uinum', 'batchid', 'item', 'itemtype', 'action', 'oldval', 'newval', 'reason', 'host'];
/** Fields left out of audit diffs/snapshots: stamps, and the DP name. */
const AUDIT_EXCLUDE = new Set(['lastConnectedAt', 'dp']);
const AUDIT_REDACT = new Set(['password']);
const MASK = '••••';
/** WinCC OA archive-config constants (as wui-kit's audit-trail.ts). */
const ARCHIVE_INFO = 45;
const ARCH_PROC_VALARCH = 15;

/** Connection ids are slugs (the vncProxy manager checks the same pattern). */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SLUG_MAX = 28;
const ID_RADIX = 36;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const DEFAULT_PORT = 5900;
const MAX_TEXT = 512;

/** A connection as stored in `RemoteVnc_<id>.json` (src/remote-vnc/types.ts#VncConnection). */
export interface StoredConnection {
  id: string;
  dp?: string;
  name: string;
  host: string;
  port: number;
  password: string;
  description: string;
  group: string;
  viewOnly: boolean;
  shared: boolean;
  connectTimeoutSec: number;
  autoReconnect: boolean;
  reconnectDelaySec: number;
  maxReconnectAttempts: number;
  favorite: boolean;
  lastConnectedAt: string;
}

/** What a route may answer: never the password. */
export type PublicConnection = Omit<StoredConnection, 'password'> & { hasPassword: boolean };

/** Who changed something, for the audit trail. */
export interface AuditActor {
  username: string;
  userId: number;
  host: string;
}

/** A refused write: `status` is the HTTP answer. */
export class StoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const DEFAULTS: Omit<StoredConnection, 'id'> = {
  name: '',
  host: '',
  port: DEFAULT_PORT,
  password: '',
  description: '',
  group: '',
  viewOnly: false,
  shared: true,
  connectTimeoutSec: 15,
  autoReconnect: true,
  reconnectDelaySec: 5,
  maxReconnectAttempts: 3,
  favorite: false,
  lastConnectedAt: ''
};

/* eslint-disable @typescript-eslint/no-explicit-any -- WsjServerGlobal.winccoa is untyped here */
function oa(): any {
  return WsjServerGlobal.winccoa;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// --- pure helpers (unit-tested) ------------------------------------------------

/** The connection without its password: the only shape a route answers. */
export function publicConnection(conn: StoredConnection): PublicConnection {
  const { password, ...rest } = conn;
  return { ...rest, hasPassword: typeof password === 'string' && password !== '' };
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : fallback;
}

function count(value: unknown, fallback: number, min: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.round(n) : fallback;
}

/**
 * The fields a client may set, coerced over `base` (defaults for a creation,
 * the stored connection for an update). `password` is applied only when the
 * body carries a string. Throws a 400 StoreError when name / host / port are
 * unusable.
 */
export function applyInput(base: StoredConnection, input: unknown): StoredConnection {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: StoredConnection = {
    ...base,
    name: text(body['name'], base.name).trim(),
    host: text(body['host'], base.host).trim(),
    port: body['port'] === undefined ? base.port : Number(body['port']),
    description: text(body['description'], base.description),
    group: text(body['group'], base.group),
    viewOnly: body['viewOnly'] === undefined ? base.viewOnly : Boolean(body['viewOnly']),
    shared: body['shared'] === undefined ? base.shared : Boolean(body['shared']),
    favorite: body['favorite'] === undefined ? base.favorite : Boolean(body['favorite']),
    autoReconnect: body['autoReconnect'] === undefined ? base.autoReconnect : Boolean(body['autoReconnect']),
    connectTimeoutSec: count(body['connectTimeoutSec'], base.connectTimeoutSec, 1),
    reconnectDelaySec: count(body['reconnectDelaySec'], base.reconnectDelaySec, 1),
    maxReconnectAttempts: count(body['maxReconnectAttempts'], base.maxReconnectAttempts, 0)
  };
  if (typeof body['password'] === 'string') out.password = body['password'].slice(0, MAX_TEXT);
  if (out.name === '') throw new StoreError(400, 'invalid', 'name is required');
  if (out.host === '' || /\s/.test(out.host)) throw new StoreError(400, 'invalid', 'host is required (no spaces)');
  if (!Number.isInteger(out.port) || out.port < MIN_PORT || out.port > MAX_PORT) {
    throw new StoreError(400, 'invalid', `port must be ${MIN_PORT}..${MAX_PORT}`);
  }
  return out;
}

/** A stored record read back, completed with the defaults (records older than a field). */
export function normalizeStored(id: string, raw: unknown): StoredConnection {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Partial<StoredConnection>;
  return { ...DEFAULTS, ...record, id, dp: DP_PREFIX + id, password: typeof record.password === 'string' ? record.password : '' };
}

/** A new id from the connection's label, as DpJsonStore made them (`<slug>-<base36 time>`). */
export function newId(label: string, now = Date.now()): string {
  const slug =
    label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, SLUG_MAX) || 'vnc';
  return `${slug}-${now.toString(ID_RADIX)}`;
}

function snapshotFields(conn: StoredConnection): string[] {
  return Object.keys(conn).filter((key) => !AUDIT_EXCLUDE.has(key));
}

function auditValue(key: string, value: unknown): unknown {
  if (!AUDIT_REDACT.has(key)) return value;
  return value ? MASK : '';
}

/** JSON of the audited fields, the password masked. */
export function auditSnapshot(conn: StoredConnection): string {
  const out: Record<string, unknown> = {};
  for (const key of snapshotFields(conn)) out[key] = auditValue(key, (conn as unknown as Record<string, unknown>)[key]);
  return JSON.stringify(out);
}

/** The changed audited fields, `{ old, new }` JSON, or null when nothing audited changed. */
export function auditDiff(before: StoredConnection, after: StoredConnection): { old: string; new: string } | null {
  const oldObj: Record<string, unknown> = {};
  const newObj: Record<string, unknown> = {};
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  let changed = false;
  for (const key of new Set([...snapshotFields(before), ...snapshotFields(after)])) {
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    changed = true;
    oldObj[key] = auditValue(key, b[key]);
    newObj[key] = auditValue(key, a[key]);
  }
  return changed ? { old: JSON.stringify(oldObj), new: JSON.stringify(newObj) } : null;
}

/** Local `YYYY-MM-DDTHH:mm` (the format the page has always written). */
export function localStamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// --- DP access ------------------------------------------------------------------

function bareName(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}

function firstValue(raw: unknown): unknown {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw ? (raw as { value: unknown }).value : raw;
  return Array.isArray(value) ? value[0] : value;
}

function parseJson(raw: unknown): unknown {
  const value = firstValue(raw);
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

let typeReady: Promise<void> | null = null;

/** Create the `RemoteVnc_Connection` type on first need (as DpJsonStore did over PARA). */
function ensureType(): Promise<void> {
  typeReady ??= (async () => {
    const winccoa = oa();
    if ((winccoa.dpTypes(CONN_TYPE) as string[]).includes(CONN_TYPE)) return;
    const type = new WinccoaDpTypeNode(CONN_TYPE, WinccoaElementType.Struct, '', [
      new WinccoaDpTypeNode('name', WinccoaElementType.String),
      new WinccoaDpTypeNode('json', WinccoaElementType.String)
    ]);
    if (!(await winccoa.dpTypeCreate(type))) throw new Error(`creating the type ${CONN_TYPE} was refused`);
  })().catch((error: unknown) => {
    typeReady = null;
    throw error;
  });
  return typeReady;
}

function dpExists(id: string): boolean {
  return Boolean(oa().dpExists(`${DP_PREFIX}${id}.json`));
}

/** Both leaves, in one write; the JSON is the whole record, as DpJsonStore wrote it. */
async function write(conn: StoredConnection): Promise<void> {
  const dp = DP_PREFIX + conn.id;
  await oa().dpSetWait([`${dp}.name`, `${dp}.json`], [conn.name, JSON.stringify({ ...conn, dp })]);
}

/** Every connection, sorted by name (the password inside — callers map through publicConnection). */
export async function listConnections(): Promise<StoredConnection[]> {
  const winccoa = oa();
  if (!(winccoa.dpTypes(CONN_TYPE) as string[]).includes(CONN_TYPE)) return [];
  const names = ((winccoa.dpNames(`${DP_PREFIX}*`, CONN_TYPE) as string[]) ?? []).map(bareName);
  if (names.length === 0) return [];
  const values = (await winccoa.dpGet(names.map((name) => `${name}.json`))) as unknown[];
  const out: StoredConnection[] = [];
  for (const [i, name] of names.entries()) {
    const raw = parseJson(values[i]);
    if (raw) out.push(normalizeStored(name.slice(DP_PREFIX.length), raw));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One connection, or null when the id is invalid or unknown. */
export async function getConnection(id: string): Promise<StoredConnection | null> {
  if (!ID_RE.test(id) || !dpExists(id)) return null;
  const raw = parseJson(await oa().dpGet(`${DP_PREFIX}${id}.json`));
  return raw ? normalizeStored(id, raw) : null;
}

/** The stored VNC password of a connection ('' when none) — for the relay only. */
export async function readSecret(id: string): Promise<string> {
  return (await getConnection(id))?.password ?? '';
}

async function existing(id: string): Promise<StoredConnection> {
  const conn = await getConnection(id);
  if (!conn) throw new StoreError(404, 'not-found', `unknown connection: ${id}`);
  return conn;
}

export async function createConnection(input: unknown, actor: AuditActor): Promise<StoredConnection> {
  const draft = applyInput({ ...DEFAULTS, id: '' }, input);
  // The creation stamps nothing: a stamp comes from a session.
  draft.lastConnectedAt = '';
  await ensureType();
  const now = Date.now();
  let id = newId(draft.name || draft.host, now);
  for (let n = 1; dpExists(id); n += 1) id = newId(draft.name || draft.host, now + n);
  const created: StoredConnection = { ...draft, id, dp: DP_PREFIX + id };
  if (!(await oa().dpCreate(DP_PREFIX + id, CONN_TYPE))) throw new StoreError(500, 'write-failed', `creating ${DP_PREFIX}${id} was refused`);
  await write(created);
  void audit(actor, { action: 'CREATE', item: created.dp ?? '', newval: auditSnapshot(created) });
  return created;
}

export async function updateConnection(id: string, input: unknown, actor: AuditActor): Promise<StoredConnection> {
  const before = await existing(id);
  const after = applyInput(before, input);
  await write(after);
  const diff = auditDiff(before, after);
  if (diff) void audit(actor, { action: 'UPDATE', item: after.dp ?? '', oldval: diff.old, newval: diff.new });
  return after;
}

export async function setFavorite(id: string, favorite: boolean, actor: AuditActor): Promise<StoredConnection> {
  return updateConnection(id, { favorite }, actor);
}

export async function deleteConnection(id: string, actor: AuditActor): Promise<void> {
  const before = await existing(id);
  if (!(await oa().dpDelete(DP_PREFIX + id))) throw new StoreError(500, 'write-failed', `deleting ${DP_PREFIX}${id} was refused`);
  void audit(actor, { action: 'DELETE', item: before.dp ?? '', oldval: auditSnapshot(before) });
}

/** Stamp `lastConnectedAt` (a session opened). Best-effort, never audited, never throws. */
export async function stampLastConnected(id: string): Promise<void> {
  try {
    const conn = await getConnection(id);
    if (conn) await write({ ...conn, lastConnectedAt: localStamp() });
  } catch (error) {
    console.warn('[vnc] stamping %s failed: %s', id, (error as Error)?.message ?? error);
  }
}

// --- audit trail ------------------------------------------------------------------

let auditReady: Promise<boolean> | null = null;
let lastAuditTime = 0;

/** The audit DP, created (and archived, when an active NGA group exists) on first need. */
function ensureAuditDp(): Promise<boolean> {
  auditReady ??= (async () => {
    const winccoa = oa();
    if (winccoa.dpExists(AUDIT_DP)) return true;
    if (!(await winccoa.dpCreate(AUDIT_DP, AUDIT_TYPE))) return false;
    await enableArchive();
    return true;
  })().catch((error: unknown) => {
    auditReady = null;
    console.warn('[vnc] audit DP %s unavailable: %s', AUDIT_DP, (error as Error)?.message ?? error);
    return false;
  });
  return auditReady;
}

/** Best-effort NGA value archiving of every leaf, with the first active non-alert group. */
async function enableArchive(): Promise<void> {
  try {
    const winccoa = oa();
    const groups = ((winccoa.dpNames('*', '_NGA_Group') as string[]) ?? []).map(bareName).filter((g) => g !== '' && !g.endsWith('_2'));
    if (groups.length === 0) return;
    const actives = (await winccoa.dpGet(groups.map((g) => `${g}.active`))) as unknown[];
    const alerts = (await winccoa.dpGet(groups.map((g) => `${g}.isAlert`))) as unknown[];
    const group = groups.find((_g, i) => Boolean(firstValue(actives[i])) && !firstValue(alerts[i]));
    if (!group) return;
    for (const leaf of AUDIT_LEAVES) {
      const dpe = `${AUDIT_DP}.${leaf}`;
      // eslint-disable-next-line no-await-in-loop -- sequential, like the kit
      await winccoa.dpSetWait(
        [`${dpe}:_archive.._type`, `${dpe}:_archive.1._type`, `${dpe}:_archive.1._class`, `${dpe}:_archive.._archive`],
        [ARCHIVE_INFO, ARCH_PROC_VALARCH, group, true]
      );
    }
  } catch (error) {
    console.warn('[vnc] audit archiving not enabled: %s', (error as Error)?.message ?? error);
  }
}

/** One audit row; best-effort: a failed audit write never fails the change it traces. */
export async function audit(
  actor: AuditActor,
  record: { action: string; item: string; oldval?: string; newval?: string }
): Promise<void> {
  try {
    if (!(await ensureAuditDp())) return;
    // Strictly increasing source times: each row stays its own row in the viewer.
    lastAuditTime = Math.max(Date.now(), lastAuditTime + 1);
    const values: unknown[] = [
      new Date(lastAuditTime),
      actor.username,
      actor.userId, // -1 when the caller is not identified (0 would read as root)
      0,
      record.item,
      AUDIT_ITEM_TYPE,
      record.action,
      record.oldval ?? '',
      record.newval ?? '',
      '',
      actor.host
    ];
    await oa().dpSetWait(
      AUDIT_LEAVES.map((leaf) => `${AUDIT_DP}.${leaf}`),
      values
    );
  } catch (error) {
    console.warn('[vnc] audit row not written: %s', (error as Error)?.message ?? error);
  }
}
