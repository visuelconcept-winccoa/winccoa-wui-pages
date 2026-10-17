// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Edit-permission gate for the Machine Fleet 3D page.
 *
 * Backed by the connected user's publish permission, surfaced by
 * `WuiUserService.canPublish`. When the user lacks it, the UI turns edit
 * affordances into view-only (eye icon) and disables every "Enregistrer" /
 * "Appliquer" / "Créer" action across the dialogs.
 *
 * `canPublish` is loaded asynchronously (from `etm.user.settings.get`, fetched
 * by the runtime on connect), so consumers should subscribe to {@link canEditFleet$}
 * and re-render when it emits, rather than reading the value once.
 */
import { WuiUserService } from '@wincc-oa/wui-iam-data/user-service.js';
import { type Observable, map, of, startWith } from 'rxjs';
import { container } from 'tsyringe';

/** Resolve the user service, or null when unavailable (isolated dev / no DI). */
function userService(): WuiUserService | null {
  try {
    return container.resolve(WuiUserService);
  } catch {
    return null;
  }
}

/**
 * Current edit permission. `true` when the connected user may publish/edit; also
 * `true` when the user service is unavailable (isolated dev), matching the page's
 * offline-tolerant behaviour. May be `false` until the user settings have loaded.
 */
export function canEditFleet(): boolean {
  const svc = userService();
  return svc ? svc.canPublish === true : true;
}

/**
 * Emits the edit-permission flag, re-emitting when the user settings load so the
 * UI can unlock once `canPublish` becomes known.
 */
export function canEditFleet$(): Observable<boolean> {
  const svc = userService();
  if (!svc) return of(true);
  return svc.user$.pipe(
    map(() => svc.canPublish === true),
    startWith(svc.canPublish === true)
  );
}

/**
 * Current WinCC OA WRITE permission of the connected user (`dpSet`), as carried
 * by the WebUI login token (`WuiUserService.canWrite`). `true` when the user
 * service is unavailable (isolated dev), like {@link canEditFleet}.
 *
 * This is the right that gates writing a datapoint from the browser — e.g.
 * acknowledging an alarm (`<dpe>:_alert_hdl.._ack`) or a command widget. A user
 * without it gets "User is not permitted to use dpSet" from the runtime, so a UI
 * should hide the affordance rather than let the write fail.
 */
export function canWriteDatapoints(): boolean {
  const svc = userService();
  return svc ? svc.canWrite === true : true;
}

/**
 * Emits the write-permission flag, re-emitting when the user settings load so a
 * view can settle once the token is known.
 */
export function canWriteDatapoints$(): Observable<boolean> {
  const svc = userService();
  if (!svc) return of(true);
  return svc.user$.pipe(
    map(() => svc.canWrite === true),
    startWith(svc.canWrite === true)
  );
}
