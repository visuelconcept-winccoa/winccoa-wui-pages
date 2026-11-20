// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** A PARA write goes through the guarded writes only when a page set them and they answer. */
import { describe, expect, it } from 'vitest';
import { routedWriteUrl } from './write-routing.js';

describe('guarded writes', () => {
  it('moves a PARA write under the guarded writes when they answer', () => {
    expect(routedWriteUrl('/api/para/dp/set', '/api/fleet', true)).toBe('/api/fleet/dp/set');
  });

  it('keeps PARA when no page set them, or when they do not answer', () => {
    expect(routedWriteUrl('/api/para/dp/set', null, true)).toBe('/api/para/dp/set');
    expect(routedWriteUrl('/api/para/dp/set', '/api/fleet', false)).toBe('/api/para/dp/set');
  });

  it('leaves a non-PARA URL as it is', () => {
    expect(routedWriteUrl('/api/other/x', '/api/fleet', true)).toBe('/api/other/x');
  });
});
