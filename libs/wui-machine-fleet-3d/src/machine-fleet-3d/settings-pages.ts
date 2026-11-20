// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings pages a site adds to the Machine Fleet (#282 of winccoa-fra-msp-stma): pages of the menu
 * marked `"fleetSettings"`, usually hidden from the menu, listed under the overview's single
 * "Paramètres" button beside the module's own settings. Machine Fleet knows nothing of them but their
 * menu entry: `"fleetSettings": true`, or `{ "roles": ["<module>/<role>", …] }` to list the page only
 * for a user granted one of these Application-Security roles (the ones the page itself needs). Pure
 * functions, tested by settings-pages.spec.ts.
 */

/** An Application-Security role (`hasRole$(module, role)`). */
export interface FleetSettingsRole {
  module: string;
  role: string;
}

/** A settings page: where it lives, its title in each language (en, fr, de), its icon, who may see it. */
export interface FleetSettingsPage {
  path: string;
  title: { en: string; fr: string; de: string };
  icon: string;
  /** Any of these grants it; empty: every user of the fleet. */
  roles: FleetSettingsRole[];
}

/** The deployed menu, read by the overview. */
export const MENU_URL = '/data/dashboard-wc/menuconfig.json';

/** A menu title in one language: the first key of that language ("fr", "fr.utf8", "fr_FR.utf8"…). */
function titleIn(title: Record<string, unknown>, lang: string): string {
  const key = Object.keys(title).find((k) => k.toLowerCase().startsWith(lang));
  return key ? String(title[key] ?? '') : '';
}

/** The roles of a `fleetSettings` mark (`true`: none); `undefined` when the entry is not marked. */
function rolesOf(mark: unknown): FleetSettingsRole[] | undefined {
  if (mark === true) return [];
  if (!mark || typeof mark !== 'object') return undefined;
  const raw = (mark as { roles?: unknown }).roles;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => String(r).split('/'))
    .filter((parts) => parts.length === 2 && parts[0] !== '' && parts[1] !== '')
    .map(([module, role]) => ({ module, role }));
}

/** The settings pages of a menu (`{ entries: [...] }`, children walked too), in menu order. */
export function settingsPages(menu: unknown): FleetSettingsPage[] {
  const out: FleetSettingsPage[] = [];
  const walk = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const entry = e as Record<string, unknown>;
      const roles = rolesOf(entry['fleetSettings']);
      if (roles && typeof entry['path'] === 'string' && entry['path'] !== '') {
        const raw = entry['title'];
        const title = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const en = titleIn(title, 'en') || (typeof raw === 'string' ? raw : '') || String(entry['path']);
        out.push({
          path: String(entry['path']),
          title: { en, fr: titleIn(title, 'fr') || en, de: titleIn(title, 'de') || en },
          icon: typeof entry['icon'] === 'string' && entry['icon'] !== '' ? String(entry['icon']) : 'cogwheel',
          roles
        });
      }
      walk(entry['entries']);
      walk(entry['children']);
    }
  };
  walk(menu && typeof menu === 'object' ? (menu as { entries?: unknown }).entries : undefined);
  return out;
}

/** The settings pages of the deployed menu; [] when it cannot be read. */
export async function loadSettingsPages(): Promise<FleetSettingsPage[]> {
  try {
    const res = await fetch(MENU_URL);
    return res.ok ? settingsPages(await res.json()) : [];
  } catch {
    return [];
  }
}
