// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The {@link EngWarning} primitive: the code/message/params contract, the English
 * rendering, and the tolerance that lets books written BEFORE this refactor
 * (`warnings: string[]`) still load from the engineering store.
 */
import { describe, expect, it } from 'vitest';
import { buildBookFromOpcUaBrowse, OPCUA_OBJECTS_FOLDER, type OpcUaBrowsePort } from './opcua/browse.js';
import { WARNING_CODES, asEngWarnings, formatMessage, formatWarning, warn } from './warnings.js';

describe('warn / formatWarning', () => {
  it('keeps the code, the template and the params separate', () => {
    const warning = warn('x.y', '{n} thing(s) in {where}', { n: 2, where: 'here' });
    expect(warning).toEqual({ code: 'x.y', message: '{n} thing(s) in {where}', params: { n: 2, where: 'here' } });
    expect(formatWarning(warning)).toBe('2 thing(s) in here');
  });

  it('omits an empty params object (keeps the stored JSON small)', () => {
    expect(warn('x.y', 'no values')).toEqual({ code: 'x.y', message: 'no values' });
    expect(warn('x.y', 'no values', {})).toEqual({ code: 'x.y', message: 'no values' });
  });

  it('leaves an unknown placeholder VISIBLE rather than blanking it', () => {
    // A missing value must be obvious in the UI, not silently swallowed.
    expect(formatMessage('{a} / {b}', { a: 1 })).toBe('1 / {b}');
  });
});

describe('asEngWarnings — reading stored data', () => {
  it('wraps a legacy string as a `legacy`-coded warning', () => {
    expect(asEngWarnings(['old message'])).toEqual([{ code: 'legacy', message: 'old message' }]);
  });

  it('passes a structured warning through, params included', () => {
    const warning = { code: 'a.b', message: '{n}', params: { n: 1 } };
    expect(asEngWarnings([warning])).toEqual([warning]);
  });

  it('accepts a mixed array (a book refreshed after the upgrade)', () => {
    expect(asEngWarnings(['legacy one', { code: 'a.b', message: 'new one' }])).toEqual([
      { code: 'legacy', message: 'legacy one' },
      { code: 'a.b', message: 'new one' }
    ]);
  });

  it('drops junk instead of throwing (the store is a file, not a contract)', () => {
    expect(asEngWarnings([null, 42, '', { nope: true }, 'kept'])).toEqual([{ code: 'legacy', message: 'kept' }]);
    expect(asEngWarnings(undefined)).toEqual([]);
    expect(asEngWarnings('not an array')).toEqual([]);
  });

  it('defaults a missing code rather than losing the message', () => {
    expect(asEngWarnings([{ message: 'orphan' }])).toEqual([{ code: 'legacy', message: 'orphan' }]);
  });
});

describe('every emitted warning is well-formed', () => {
  /** A walk that trips as many warnings as possible in one pass. */
  const noisyPort: OpcUaBrowsePort = {
    async browseLevel(_connection, nodeId) {
      if (nodeId === 'ns=2;i=bad') throw new Error('BadNodeIdUnknown');
      if (nodeId === OPCUA_OBJECTS_FOLDER) {
        return [
          { displayName: 'Bad', nodeId: 'ns=2;i=bad', nodeClass: 'Object' },
          { displayName: '', nodeId: 'ns=2;i=unnamed', nodeClass: 'Variable', dataType: 'Double' },
          { displayName: 'Reset', nodeId: 'ns=2;i=m', nodeClass: 'Method' },
          { displayName: 'Profil', nodeId: 'ns=2;s=p', nodeClass: 'Variable', dataType: 'Float', valueRank: 1 }
        ];
      }
      return [];
    }
  };

  it('carries a namespaced code and substitutes every placeholder', async () => {
    const book = await buildBookFromOpcUaBrowse(noisyPort, { bookId: 'b', connection: 'C' });
    expect(book.warnings.length).toBeGreaterThan(3);
    for (const warning of book.warnings) {
      expect(warning.code).toMatch(/^[a-z]+\.[a-z-]+$/);
      // No `{placeholder}` may survive the rendering: that would mean a value the
      // message asks for was never passed.
      expect(formatWarning(warning)).not.toMatch(/\{\w+\}/);
    }
  });

  it('uses the declared code constants (no free-form strings at the emit sites)', async () => {
    const declared = new Set(Object.values(WARNING_CODES).flatMap((group) => Object.values(group)));
    const book = await buildBookFromOpcUaBrowse(noisyPort, { bookId: 'b', connection: 'C' });
    for (const warning of book.warnings) expect(declared).toContain(warning.code);
  });
});
