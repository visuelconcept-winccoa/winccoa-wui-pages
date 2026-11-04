// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { desEncryptBlock, vncAuthResponse } from './vncAuth';

const hex = (text: string): Buffer => Buffer.from(text, 'hex');

describe('vncAuth', () => {
  it('DES encrypts the FIPS 46 reference block', () => {
    expect(desEncryptBlock(hex('133457799BBCDFF1'), hex('0123456789ABCDEF')).toString('hex')).toBe('85e813540f0ab405');
  });

  it('answers a VNC challenge as noVNC does (mirrored key bits, two ECB blocks)', () => {
    // Reference computed with noVNC 1.4's core/des.js (RFB.genDES) for the same input.
    const challenge = hex('000102030405060708090a0b0c0d0e0f');
    expect(vncAuthResponse('password', challenge).toString('hex')).toBe('b866924125c8eebb9debc1db61c538e2');
  });

  it('ignores characters beyond the eighth, as VNC servers do', () => {
    const challenge = hex('ffeeddccbbaa99887766554433221100');
    expect(vncAuthResponse('password-and-more', challenge)).toEqual(vncAuthResponse('password', challenge));
  });

  it('refuses a challenge that is not 16 bytes', () => {
    expect(() => vncAuthResponse('x', Buffer.alloc(8))).toThrow(RangeError);
  });
});
