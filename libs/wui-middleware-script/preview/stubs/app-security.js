// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Preview stub for @visuelconcept/wui-kit/data/app-security.js — every role is
// granted (override per role with `globalThis.__previewRoles = { edit: false }`
// to preview the locked UI).
import { of } from 'rxjs';

export function registerModuleRoles() {}

export function hasRole$(_module, role) {
  const grants = globalThis.__previewRoles ?? {};
  return of(grants[role] ?? true);
}
