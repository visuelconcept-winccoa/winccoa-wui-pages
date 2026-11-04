// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Links kept within the application: a route or a path of this server is accepted, anything
 * that would lead out of it is refused.
 */
import { describe, expect, it } from 'vitest';
import { appLinkHref } from './types.js';

describe('appLinkHref', () => {
  it('accepts a route or a path of the application', () => {
    expect(appLinkHref(' #/alarmes ')).toBe('#/alarmes');
    expect(appLinkHref('/data/dashboard-wc/index.html#/dashboard/3')).toBe('/data/dashboard-wc/index.html#/dashboard/3');
  });

  it('refuses an address out of the application', () => {
    for (const url of ['https://example.com', '//example.com/x', 'javascript:alert(1)', 'example.com', '#', '', '/\\example.com']) {
      expect(appLinkHref(url)).toBeUndefined();
    }
  });
});
