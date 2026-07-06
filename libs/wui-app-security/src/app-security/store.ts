// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Data access for the Application Security page.
 *
 * Reads every `AppSecurity_<module>` datapoint (declaration + assignments),
 * persists ONLY the `.assignments` element (the declaration belongs to the
 * providing module / the "Discover" seeding), and traces every assignment
 * change into a GxP audit trail (`AuditTrail_AppSecurity`). Falls back to an
 * in-memory catalog built from the static manifest when the backend is
 * unreachable (offline flag, like every page store).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import { AuditTrailWriter } from '@visuelconcept/wui-kit/data/audit-trail.js';
import {
  APP_SECURITY_TYPE,
  appSecurityDp,
  upsertModuleRoles,
  type AppModuleRoles,
  type AppRoleAssignments,
  type AppRoleDeclaration
} from '@visuelconcept/wui-kit/data/app-security.js';
import { MODULE_MANIFEST } from './manifest.js';

const DP_SET_URL = '/api/para/dp/set';
const GROUPS_URL = '/api/app-security/groups';

/** One module row of the catalog (declaration + current assignments). */
export interface ModuleEntry {
  module: string;
  dp: string;
  title: MultiLangString | null;
  roles: AppRoleDeclaration[];
  assignments: AppRoleAssignments;
}

/** An OA user group (admin picker). */
export interface OaGroup {
  id: number;
  name: string;
}

function extractString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = extractString(item);
      if (found) return found;
    }
    return '';
  }
  if (raw && typeof raw === 'object') return extractString((raw as { value?: unknown }).value);
  return '';
}

function parseDeclaration(json: string): { title: MultiLangString | null; roles: AppRoleDeclaration[] } {
  try {
    const parsed = JSON.parse(json) as { title?: MultiLangString; roles?: unknown };
    const roles = Array.isArray(parsed.roles)
      ? (parsed.roles as AppRoleDeclaration[]).filter((r) => r && typeof r.id === 'string')
      : [];
    return { title: parsed.title ?? null, roles };
  } catch {
    return { title: null, roles: [] };
  }
}

function parseAssignments(json: string): AppRoleAssignments {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const out: AppRoleAssignments = {};
    for (const [role, groups] of Object.entries(parsed)) {
      if (Array.isArray(groups)) out[role] = groups.map(String);
    }
    return out;
  } catch {
    return {};
  }
}

export class AppSecurityStore {
  /** True when running without a writable backend (in-memory fallback). */
  offline = false;

  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();
  private readonly audit = new AuditTrailWriter({ dpName: 'AuditTrail_AppSecurity', itemType: 'AppSecurity' });
  private memory: ModuleEntry[] | null = null;

  /** Every declared module, sorted by module id. */
  async list(): Promise<ModuleEntry[]> {
    const api = this.api;
    const dpe = this.dpe;
    if (this.offline || !api || !dpe) return this.mem();
    try {
      const names = await firstValueFrom(dpe.listDatapoints(APP_SECURITY_TYPE));
      const out: ModuleEntry[] = [];
      for (const dp of names) {
        const [moduleRaw, rolesRaw, assignRaw] = (await firstValueFrom(
          api.dpGet([`${dp}.module`, `${dp}.roles`, `${dp}.assignments`])
        )) as unknown[];
        const module = extractString(moduleRaw) || this.idFromDp(dp);
        const decl = parseDeclaration(extractString(rolesRaw));
        out.push({ module, dp, title: decl.title, roles: decl.roles, assignments: parseAssignments(extractString(assignRaw)) });
      }
      out.sort((a, b) => a.module.localeCompare(b.module));
      return out;
    } catch {
      this.offline = true;
      return this.mem();
    }
  }

  /** Persist one module's assignments (audited: one UPDATE row per save). */
  async saveAssignments(entry: ModuleEntry, next: AppRoleAssignments): Promise<boolean> {
    const oldJson = JSON.stringify(entry.assignments);
    const newJson = JSON.stringify(next);
    if (oldJson === newJson) return true;
    if (this.offline) {
      entry.assignments = next;
      return true;
    }
    try {
      const res = await fetch(DP_SET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dpeName: `${appSecurityDp(entry.module)}.assignments`, value: newJson })
      });
      if (!res.ok) return false;
      void this.audit.write({ action: 'UPDATE', item: appSecurityDp(entry.module), oldval: oldJson, newval: newJson });
      entry.assignments = next;
      return true;
    } catch {
      this.offline = true;
      entry.assignments = next;
      return true;
    }
  }

  /** Seed/refresh every manifest module's declaration. Returns how many succeeded. */
  async discover(manifest: AppModuleRoles[] = MODULE_MANIFEST): Promise<number> {
    let ok = 0;
    for (const decl of manifest) {
      if (await upsertModuleRoles(decl)) ok += 1;
    }
    if (ok === 0) this.offline = true;
    return ok;
  }

  /** OA group directory from the app-security backend (null when unreachable). */
  async groups(): Promise<OaGroup[] | null> {
    try {
      const res = await fetch(GROUPS_URL);
      if (!res.ok) return null;
      const body = (await res.json()) as { ok?: boolean; groups?: OaGroup[] };
      return body.ok !== false && Array.isArray(body.groups) ? body.groups : null;
    } catch {
      return null;
    }
  }

  // --- internals -------------------------------------------------------------

  private mem(): ModuleEntry[] {
    this.offline = true;
    this.memory ??= MODULE_MANIFEST.map((decl) => ({
      module: decl.module,
      dp: appSecurityDp(decl.module),
      title: decl.title,
      roles: decl.roles,
      assignments: {}
    }));
    return this.memory;
  }

  private idFromDp(dp: string): string {
    const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
    return bare.startsWith('AppSecurity_') ? bare.slice('AppSecurity_'.length) : bare;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  private resolveDpe(): WuiDpeService | null {
    try {
      return container.resolve<WuiDpeService>(WuiDpeService);
    } catch {
      return null;
    }
  }
}
