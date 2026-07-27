// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
// Harness stub: the page dispatches RouterEvent on navigation; the harness
// main.ts listens for 'harness:route' on window to swap the networkid attribute.
export class RouterEvent extends CustomEvent<{ path: string }> {
  constructor(public readonly path: string) {
    super('harness:route', { detail: { path }, bubbles: true, composed: true });
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('harness:route', { detail: { path } })));
  }
}
