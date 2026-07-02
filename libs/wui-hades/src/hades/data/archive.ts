// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NGA value-archiving of the DPEs bound to a tunnel's equipment (same
 * mechanism as the fleet pages, scoped to Hades): discover the active archive
 * groups (`_NGA_Group`), read a DPE's current archive config, and switch it
 * via the PARA `dp/set` REST route. Every actual change is GxP-traced into
 * `AuditTrail_Hades` (itemType `ArchiveConfig`). Archiving the bound measures
 * is what later enables the incident-replay timeline (phase 3).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { AuditTrailWriter } from '@visuelconcept/wui-kit/data/audit-trail.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import { HADES_AUDIT_DP } from './hades-store.js';

const DP_SET_URL = '/api/para/dp/set';
/** WinCC OA archive-config constants (CTRL DPCONFIG/DPATTR values). */
const ARCHIVE_INFO = 45; // DPCONFIG_DB_ARCHIVEINFO
const ARCH_PROC_VALARCH = 15; // DPATTR_ARCH_PROC_VALARCH (NGA value archive)

export interface ArchiveStatus {
  enabled: boolean;
  group: string;
}

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Coerce a (possibly array/object-wrapped) datapoint value to a scalar string. */
function scalarText(raw: unknown): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && typeof v === 'object' && 'value' in v) return scalarText((v as { value: unknown }).value);
  return v == null ? '' : String(v);
}

/** Interpret an `_archive.._archive` value (bool / 0-1 / "true") as a flag. */
function archiveFlag(raw: unknown): boolean {
  const v = scalarText(raw).toLowerCase();
  return v === 'true' || v === '1';
}

/** Strip the system prefix from a DP name (`System1:_NGA_G_EVENT` → `_NGA_G_EVENT`). */
function bareDpName(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}

export class ArchiveService {
  private readonly api = this.resolveApi();
  private readonly audit = new AuditTrailWriter({ dpName: HADES_AUDIT_DP, itemType: 'ArchiveConfig' });

  /** Discover the active, non-alert NGA archive groups (bare names, sorted). */
  async listArchiveGroups(): Promise<string[]> {
    const api = this.api;
    if (!api) return [];
    try {
      const names = (await firstValueFrom(api.dpNames('*', '_NGA_Group'))) as string[];
      const groups = names
        .map((n) => bareDpName(n))
        .filter((n) => n !== '' && !n.endsWith('_2'))
        .sort((a, b) => a.localeCompare(b));
      if (groups.length === 0) return [];
      const activeRaw = await firstValueFrom(api.dpGet(groups.map((g) => `${g}.active`)));
      const alertRaw = await firstValueFrom(api.dpGet(groups.map((g) => `${g}.isAlert`)));
      const actives = Array.isArray(activeRaw) ? activeRaw : [activeRaw];
      const alerts = Array.isArray(alertRaw) ? alertRaw : [alertRaw];
      return groups.filter((_, i) => archiveFlag(actives[i]) && !archiveFlag(alerts[i]));
    } catch {
      return [];
    }
  }

  /** Read a DPE's current archive status: enabled flag + assigned group. */
  async readArchiveStatus(dpe: string): Promise<ArchiveStatus> {
    const api = this.api;
    if (!api) return { enabled: false, group: '' };
    try {
      const raw = await firstValueFrom(api.dpGet([`${dpe}:_archive.._archive`, `${dpe}:_archive.1._class`]));
      const values = Array.isArray(raw) ? raw : [raw];
      return { enabled: archiveFlag(values[0]), group: bareDpName(scalarText(values[1])) };
    } catch {
      return { enabled: false, group: '' };
    }
  }

  /**
   * Enable or disable NGA value archiving on a DPE via the dp/set REST API.
   * When enabling, the procedure is set to value-archive and assigned to
   * `group` (a `_NGA_Group` name, e.g. `_NGA_G_EVENT`).
   */
  async setArchive(dpe: string, enabled: boolean, group: string): Promise<boolean> {
    const before = await this.readArchiveStatus(dpe);
    try {
      if (enabled) {
        await this.send(jsonPost({ dpeName: `${dpe}:_archive.._type`, value: ARCHIVE_INFO }));
        await this.send(jsonPost({ dpeName: `${dpe}:_archive.1._type`, value: ARCH_PROC_VALARCH }));
        await this.send(jsonPost({ dpeName: `${dpe}:_archive.1._class`, value: group }));
        await this.send(jsonPost({ dpeName: `${dpe}:_archive.._archive`, value: true }));
      } else {
        await this.send(jsonPost({ dpeName: `${dpe}:_archive.._archive`, value: false }));
      }
      const after = { enabled, group: enabled ? group : before.group };
      if (before.enabled !== after.enabled || before.group !== after.group) {
        void this.audit.write({
          action: 'UPDATE',
          item: dpe,
          oldval: JSON.stringify(before),
          newval: JSON.stringify(after)
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  private async send(init: RequestInit): Promise<void> {
    const res = await fetch(DP_SET_URL, init);
    if (!res.ok) throw new Error(`POST ${DP_SET_URL} → ${res.status}`);
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}
