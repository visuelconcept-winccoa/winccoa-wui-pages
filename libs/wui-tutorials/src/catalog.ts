// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The tutorials page's catalog: the tutorials grouped by the module that declares them, and
 * whether the logged-in user may play each one.
 */
import type { Tutorial } from './guide/tutorial.js';

export interface TutorialGroup {
  /** The module's page id. */
  module: string;
  tutorials: Tutorial[];
}

/** The tutorials by module, in the order the modules first appear (the site's selection), each module's in its own order. */
export function groupByModule(tutorials: readonly Tutorial[]): TutorialGroup[] {
  const groups = new Map<string, TutorialGroup>();
  for (const tutorial of tutorials) {
    const group = groups.get(tutorial.module) ?? { module: tutorial.module, tutorials: [] };
    group.tutorials.push(tutorial);
    groups.set(tutorial.module, group);
  }
  return [...groups.values()];
}

/**
 * The user may play it: it names no role, or the user holds one of them. `granted`: each role
 * known so far (`<module>/<role>` → held); a role not known yet does not forbid.
 */
export function allowed(tutorial: Tutorial, granted: ReadonlyMap<string, boolean>): boolean {
  const roles = tutorial.roles ?? [];
  if (roles.length === 0) return true;
  return roles.some((role) => granted.get(role) !== false);
}
