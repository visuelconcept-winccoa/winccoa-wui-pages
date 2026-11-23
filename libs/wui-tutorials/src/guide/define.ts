// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines an element unless it is already: the module's boot script and its page are two
 * bundles, each with its own copy of the guide's elements; the first one loaded defines them.
 */
export function defineOnce(tag: string, element: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, element);
}
