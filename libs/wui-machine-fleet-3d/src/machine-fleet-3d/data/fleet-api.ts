// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read-only calls to this module's own backend for the ateliers
 * (`/api/ai/fleet/…`, backend/aiRoute.ts + backend/fleetAteliers.ts), used by
 * the embeddable `<wui-fleet-3d-view>` and by host modules that let their user
 * pick an atelier. The webserver reads the `MachineFleet3D_Config` datapoints
 * and checks the module's `view` role: the browser never reads those datapoints
 * for this. Every request carries the logged-in user's WebUI token
 * (`Authorization: Bearer`), which the backend verifies to know who calls
 * (backend/fleetGuard.ts); without a shell (`wui dev`, tests) none is sent and
 * the mock answers anyway.
 *
 * Why under `/api/ai`: a wui-toolkit module has ONE backend mount, and this
 * module's has been `/api/ai` (the AI assistant bridge other modules call) since
 * its first release — the fleet routes live under it, in their own `/fleet`
 * segment.
 */
import { TokenService } from '@wincc-oa/wui-iam-data/token-service.js';
import { container } from 'tsyringe';

import type { Atelier, StopCause } from '../types.js';

export const FLEET_API = '/api/ai/fleet';

/** One atelier as the listing gives it: enough for a picker. */
export interface AtelierSummary {
  id: string;
  name: string;
  machineCount: number;
}

/** What `GET /api/ai/fleet/workshops/:id` answers: the atelier and the stop-cause catalog. */
export interface AtelierPayload {
  atelier: Atelier;
  stopCauses: StopCause[];
}

/** How a call ended, in the terms the element shows. */
export type FleetOutcome<T> =
  | { kind: 'ok'; body: T }
  /** 403 from the route: the caller lacks the module's `view` role. */
  | { kind: 'forbidden' }
  /** 404 from the route: unknown atelier. */
  | { kind: 'not-found' }
  /** No usable answer: backend not deployed / not restarted, network down, 5xx. */
  | { kind: 'unavailable'; message: string };

function authHeaders(): Record<string, string> {
  try {
    const token = container.resolve(TokenService).getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function jsonOf(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One GET to `/api/ai/fleet<path>`; never throws (an abort comes back as `unavailable`). */
export async function fleetCall<T>(path: string, signal?: AbortSignal): Promise<FleetOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(`${FLEET_API}${path}`, { cache: 'no-store', headers: authHeaders(), signal });
  } catch (error) {
    return { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) };
  }
  const body = await jsonOf(res);
  if (res.ok && body?.['ok'] === true) return { kind: 'ok', body: body as T };
  // A 403/404 counts only when the route answered it (JSON `{ ok: false }`): an
  // HTML 404 means the backend module is not mounted.
  if (body?.['ok'] === false && res.status === 403) return { kind: 'forbidden' };
  if (body?.['ok'] === false && res.status === 404) return { kind: 'not-found' };
  const message = typeof body?.['message'] === 'string' ? body['message'] : `HTTP ${res.status}`;
  return { kind: 'unavailable', message };
}

/** The ateliers (id, name, machine count), sorted by name — for a host's picker. */
export function listAteliers(signal?: AbortSignal): Promise<FleetOutcome<{ ateliers: AtelierSummary[] }>> {
  return fleetCall<{ ateliers: AtelierSummary[] }>('/workshops', signal);
}

/** One atelier, in full, with the stop-cause catalog its machines' causes resolve against. */
export function fetchAtelier(id: string, signal?: AbortSignal): Promise<FleetOutcome<AtelierPayload>> {
  return fleetCall<AtelierPayload>(`/workshops/${encodeURIComponent(id)}`, signal);
}
