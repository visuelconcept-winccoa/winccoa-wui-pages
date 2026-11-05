// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings pages a site adds to the Machine Fleet (#282 of winccoa-fra-msp-stma): pages of the menu
 * marked `"fleetSettings": true`, usually hidden from the menu, each opened from a button of the fleet
 * overview. Machine Fleet knows nothing of them but their menu entry. Pure functions, tested by
 * settings-pages.spec.ts.
 */

/** A settings page: where it lives, its title in each language (en, fr, de) and its icon. */
export interface FleetSettingsPage {
  path: string;
  title: { en: string; fr: string; de: string };
  icon: string;
}

/** The deployed menu, read by the overview. */
export const MENU_URL = '/data/dashboard-wc/menuconfig.json';

/** A menu title in one language: the first key of that language ("fr", "fr.utf8", "fr_FR.utf8"…). */
function titleIn(title: Record<string, unknown>, lang: string): string {
  const key = Object.keys(title).find((k) => k.toLowerCase().startsWith(lang));
  return key ? String(title[key] ?? '') : '';
}

/** The settings pages of a menu (`{ entries: [...] }`, children walked too), in menu order. */
export function settingsPages(menu: unknown): FleetSettingsPage[] {
  const out: FleetSettingsPage[] = [];
  const walk = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const entry = e as Record<string, unknown>;
      if (entry['fleetSettings'] === true && typeof entry['path'] === 'string' && entry['path'] !== '') {
        const raw = entry['title'];
        const title = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const en = titleIn(title, 'en') || (typeof raw === 'string' ? raw : '') || String(entry['path']);
        out.push({
          path: String(entry['path']),
          title: { en, fr: titleIn(title, 'fr') || en, de: titleIn(title, 'de') || en },
          icon: typeof entry['icon'] === 'string' && entry['icon'] !== '' ? String(entry['icon']) : 'cogwheel'
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
