// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Preview stub for @wincc-oa/wui-i18n-shared/localize-multilang.js — resolves
// MultiLangStrings against `globalThis.__previewLocale` (default fr, like the
// documented demo backend). `localizeDir` returns a plain string (the real
// reactive directive is only needed for live language switching).

function order() {
  return [globalThis.__previewLocale ?? 'fr.utf8', 'en_US.utf8', 'fr.utf8', 'de.utf8'];
}

export function localize(ml) {
  if (ml == null) return '';
  if (typeof ml === 'string') return ml;
  for (const key of order()) {
    if (ml[key] != null) return ml[key];
  }
  const first = Object.values(ml)[0];
  return first == null ? '' : String(first);
}

export function localizeDir(ml) {
  return localize(ml);
}
