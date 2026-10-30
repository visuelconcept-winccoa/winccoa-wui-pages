// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// fleetAteliers — the ateliers of Machine Fleet, read by the webserver
// -----------------------------------------------------------------------------
// One DP per atelier, as the page writes them (wui-fleet-core FleetStore):
// `MachineFleet3D_<id>` of type `MachineFleet3D_Config` (Struct: `name` String +
// `json` String, the whole atelier serialised). The stop-cause catalog is the
// single DP `MachineFleet3D_StopCauses` (`json`: an array).
//
// READ ONLY, for hosts that embed one atelier (<wui-fleet-3d-view>, the
// listing a host's picker shows): the browser of a host never reads these DPs
// itself. Mounted under `/api/ai/fleet` (aiRoute.ts) behind the module's `view`
// role. Nothing here creates a type or a DP: an absent type is an empty list.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';

export const CONFIG_TYPE = 'MachineFleet3D_Config';
export const DP_PREFIX = 'MachineFleet3D_';
export const STOPCAUSE_DP = 'MachineFleet3D_StopCauses';
/** Atelier ids are slugs (FleetStore.slug, or an id chosen at creation) — never a wildcard. */
export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;

/** One atelier in the listing: what a picker needs, nothing of the layout. */
export interface AtelierSummary {
  id: string;
  name: string;
  machineCount: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- WsjServerGlobal.winccoa is untyped here */
function oa(): any {
  return WsjServerGlobal.winccoa;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// --- pure helpers (unit-tested) ------------------------------------------------

/** `System1:MachineFleet3D_a.` → `MachineFleet3D_a`. */
export function bareName(name: string): string {
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  return local.endsWith('.') ? local.slice(0, -1) : local;
}

/** The string a dpGet answered (raw, `[raw]` or `{ value }`), '' when there is none. */
function textOf(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.length > 0 ? textOf(raw[0]) : '';
  if (raw && typeof raw === 'object' && 'value' in raw) return textOf((raw as { value: unknown }).value);
  return '';
}

/** A JSON object stored in a String element, or null (empty, invalid, not an object). */
export function parseObject(raw: unknown): Record<string, unknown> | null {
  const text = textOf(raw).trim();
  if (!text.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A JSON array stored in a String element, or [] (empty, invalid, not an array). */
export function parseArray(raw: unknown): unknown[] {
  const text = textOf(raw).trim();
  if (!text.startsWith('[')) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** The listing entry of a stored atelier — the id is the DP's, as the page does. */
export function atelierSummary(id: string, atelier: Record<string, unknown>): AtelierSummary {
  const name = typeof atelier['name'] === 'string' && atelier['name'].trim() !== '' ? atelier['name'] : id;
  const machines = atelier['machines'];
  return { id, name, machineCount: Array.isArray(machines) ? machines.length : 0 };
}

// --- reads ---------------------------------------------------------------------

function typeExists(): boolean {
  return ((oa().dpTypes(CONFIG_TYPE) as string[]) ?? []).includes(CONFIG_TYPE);
}

/** The DP names of the ateliers (only DPs of the config type: the other `MachineFleet3D_*` DPs are not ateliers). */
function atelierDps(pattern: string): string[] {
  if (!typeExists()) return [];
  return ((oa().dpNames(pattern, CONFIG_TYPE) as string[]) ?? []).map(bareName);
}

/** Every atelier, summarised, sorted by name. */
export async function listAtelierSummaries(): Promise<AtelierSummary[]> {
  const names = atelierDps(`${DP_PREFIX}*`);
  if (names.length === 0) return [];
  const values = (await oa().dpGet(names.map((dp) => `${dp}.json`))) as unknown[];
  const out: AtelierSummary[] = [];
  for (const [i, dp] of names.entries()) {
    const atelier = parseObject(values[i]);
    if (atelier) out.push(atelierSummary(dp.slice(DP_PREFIX.length), atelier));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One atelier in full (id and dp set from the DP, as the page reads it), or null. */
export async function readAtelier(id: string): Promise<Record<string, unknown> | null> {
  if (!ID_RE.test(id)) return null;
  const dp = `${DP_PREFIX}${id}`;
  if (!atelierDps(dp).includes(dp)) return null;
  const atelier = parseObject(await oa().dpGet(`${dp}.json`));
  return atelier ? { ...atelier, id, dp } : null;
}

/** The stop-cause catalog ([] when the DP does not exist yet). */
export async function readStopCauses(): Promise<unknown[]> {
  if (!oa().dpExists(STOPCAUSE_DP)) return [];
  return parseArray(await oa().dpGet(`${STOPCAUSE_DP}.json`));
}

// --- HTTP ----------------------------------------------------------------------

function unavailable(res: Response, error: unknown): void {
  const message = (error as Error)?.message ?? String(error);
  console.warn('fleetAteliers:', message);
  res.status(HTTP_UNAVAILABLE).json({ ok: false, error: 'unavailable', message });
}

/** The read-only atelier routes (see aiRoute.ts for their mount and role). */
export class FleetController {
  /** GET /fleet/ateliers -> { ok, ateliers: [{ id, name, machineCount }] } */
  public list = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ ok: true, ateliers: await listAtelierSummaries() });
    } catch (error) {
      unavailable(res, error);
    }
  };

  /** GET /fleet/ateliers/:id -> { ok, atelier, stopCauses } | 404 */
  public get = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params?.['id'] ?? '');
    try {
      const atelier = await readAtelier(id);
      if (!atelier) {
        res.status(HTTP_NOT_FOUND).json({ ok: false, error: 'not-found', message: `unknown atelier: ${id}` });
        return;
      }
      res.json({ ok: true, atelier, stopCauses: await readStopCauses() });
    } catch (error) {
      unavailable(res, error);
    }
  };
}
