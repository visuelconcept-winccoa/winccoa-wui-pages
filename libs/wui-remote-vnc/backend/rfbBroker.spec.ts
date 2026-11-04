// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// The relay's RFB handshake against scripted peers: a VNC server (3.3 / 3.8,
// None / VNC auth / unsupported types) and a noVNC-like browser.

import { describe, expect, it } from 'vitest';
import { ByteQueue, RfbPeer, brokerHandshake, chooseSecurityType, parseVersion } from './rfbBroker';
import { vncAuthResponse } from './vncAuth';

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const reason = (text: string): Buffer => Buffer.concat([u32(Buffer.byteLength(text)), Buffer.from(text)]);

/** A peer whose writes are recorded and whose incoming bytes the test pushes. */
function peer(): RfbPeer & { sent: Buffer[]; received(): Buffer } {
  const sent: Buffer[] = [];
  return { queue: new ByteQueue(), write: (b) => sent.push(Buffer.from(b)), sent, received: () => Buffer.concat(sent) };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The browser side as noVNC 1.4 plays it against a 3.8 server offering None. */
async function browser38(client: ReturnType<typeof peer>): Promise<void> {
  client.queue.push(Buffer.from('RFB 003.008\n'));
  await tick();
  client.queue.push(Buffer.from([1])); // chooses None
}

const CHALLENGE = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');

describe('rfbBroker', () => {
  it('parses the versions noVNC accepts', () => {
    expect(parseVersion(Buffer.from('RFB 003.008\n'))).toBe(3.8);
    expect(parseVersion(Buffer.from('RFB 003.007\n'))).toBe(3.7);
    expect(parseVersion(Buffer.from('RFB 003.003\n'))).toBe(3.3);
    expect(parseVersion(Buffer.from('RFB 005.000\n'))).toBe(3.8);
    expect(parseVersion(Buffer.from('RFB 000.000\n'))).toBeNull();
  });

  it('prefers VNC auth with a password, None without one', () => {
    expect(chooseSecurityType([1, 2], 'pw')).toBe(2);
    expect(chooseSecurityType([2, 1], '')).toBe(1);
    expect(chooseSecurityType([19, 2], '')).toBe(2);
    expect(chooseSecurityType([19, 30], 'pw')).toBeNull();
  });

  it('authenticates to a 3.8 server with the stored password and offers the browser None', async () => {
    const client = peer();
    const server = peer();
    const done = brokerHandshake(client, server, 'secret');
    server.queue.push(Buffer.from('RFB 003.008\n'));
    server.queue.push(Buffer.from([2, 19, 2])); // VeNCrypt, VNC auth
    server.queue.push(CHALLENGE);
    server.queue.push(u32(0)); // SecurityResult OK
    await browser38(client);
    expect(await done).toEqual({ ok: true });

    const toServer = server.received();
    expect(toServer.subarray(0, 12).toString()).toBe('RFB 003.008\n');
    expect(toServer[12]).toBe(2);
    expect(toServer.subarray(13)).toEqual(vncAuthResponse('secret', CHALLENGE));

    const toClient = client.received();
    expect(toClient.subarray(0, 12).toString()).toBe('RFB 003.008\n');
    expect([...toClient.subarray(12, 14)]).toEqual([1, 1]); // one type: None
    expect(toClient.subarray(14)).toEqual(u32(0)); // SecurityResult OK
    expect(toClient.toString('latin1')).not.toContain('secret');
  });

  it('passes the server refusal to the browser as a 3.8 SecurityResult with its reason', async () => {
    const client = peer();
    const server = peer();
    const done = brokerHandshake(client, server, 'wrong');
    server.queue.push(Buffer.from('RFB 003.008\n'));
    server.queue.push(Buffer.from([1, 2]));
    server.queue.push(CHALLENGE);
    server.queue.push(Buffer.concat([u32(1), reason('Authentication failure')]));
    await browser38(client);
    expect(await done).toEqual({ ok: false, reason: 'Authentication failure' });
    expect(client.received().subarray(14)).toEqual(Buffer.concat([u32(1), reason('Authentication failure')]));
  });

  it('refuses a server that offers no type a stored password can answer', async () => {
    const client = peer();
    const server = peer();
    const done = brokerHandshake(client, server, 'pw');
    server.queue.push(Buffer.from('RFB 003.008\n'));
    server.queue.push(Buffer.from([2, 19, 30]));
    await browser38(client);
    const outcome = await done;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.reason).toContain('offered: 19, 30');
  });

  it('speaks 3.3 to an old server (type chosen by the server, no result after None)', async () => {
    const client = peer();
    const server = peer();
    const done = brokerHandshake(client, server, '');
    server.queue.push(Buffer.from('RFB 003.003\n'));
    server.queue.push(u32(1)); // None
    await browser38(client);
    expect(await done).toEqual({ ok: true });
    expect(server.received().toString()).toBe('RFB 003.003\n');
  });

  it('keeps the bytes that follow the handshake for the pipe', async () => {
    const client = peer();
    const server = peer();
    const done = brokerHandshake(client, server, '');
    server.queue.push(Buffer.concat([Buffer.from('RFB 003.008\n'), Buffer.from([1, 1]), u32(0)]));
    await browser38(client);
    client.queue.push(Buffer.from([1])); // ClientInit (shared), sent right after the result
    expect(await done).toEqual({ ok: true });
    expect([...client.queue.drain()]).toEqual([1]);
  });

  it('fails when a socket closes mid-handshake', async () => {
    const client = peer();
    const server = peer();
    const done = brokerHandshake(client, server, '');
    server.queue.close(new Error('tcp closed'));
    await expect(done).rejects.toThrow('tcp closed');
  });
});
