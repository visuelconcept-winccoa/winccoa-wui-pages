// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// rfbBroker — the relay authenticates to the VNC server for the browser
// -----------------------------------------------------------------------------
// Before 0.2 the relay was a dumb byte pipe and noVNC answered the VNC
// Authentication itself, so the browser had to hold the password. Now the relay
// runs the RFB handshake on BOTH sides (RFC 6143 §7.1–7.2) and only then pipes
// bytes:
//
//   browser (noVNC)            relay                      VNC server
//   ◀── "RFB 003.008\n" ───────┤                          │
//   ─── client version ───────▶│                          │
//   ◀── [1 type: None] ────────┤        ◀── server version ┤
//   ─── None ─────────────────▶│        ── our version ──▶│
//                              │        ◀── security types ┤
//                              │        ── VNC auth (2) ─▶│  (or None when offered
//                              │        ◀── challenge ─────┤   and no password is stored)
//                              │        ── DES response ─▶│
//                              │        ◀── SecurityResult ┤
//   ◀── SecurityResult OK ─────┤   (or failed + the reason: noVNC raises `securityfailure`)
//   ══ ClientInit / ServerInit / framebuffer: piped as is ══
//
// The password is read server-side (vncStore.readSecret) and never leaves the
// webserver. Supported server security types: None (1) and VNC Authentication
// (2) — the only ones a stored password alone can answer. A server that offers
// neither (VeNCrypt-only, RealVNC RA2-only, Apple ARD…) is refused with a clear
// reason; configure it to offer "VNC password" authentication.
//
// ByteQueue turns the push-style socket callbacks (TCP `data`, uWS `message`)
// into awaitable reads, so the handshake reads like the RFC.
// -----------------------------------------------------------------------------

import { vncAuthResponse } from './vncAuth';

const SEC_NONE = 1;
const SEC_VNC_AUTH = 2;
const VERSION_LENGTH = 12;
const CHALLENGE_LENGTH = 16;
/** Longest failure reason we accept from a server (it is shown to the user). */
const MAX_REASON = 4096;
/** What the relay tells the browser: RFB 3.8, the version noVNC prefers. */
const RELAY_VERSION = 'RFB 003.008\n';

/** An RFB protocol version, as the relay deals with it. */
export type RfbVersion = 3.3 | 3.7 | 3.8;

/** Awaitable reads over bytes pushed by socket callbacks. */
export class ByteQueue {
  private chunks: Buffer[] = [];
  private length = 0;
  private waiter: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;

  push(chunk: Buffer): void {
    if (this.failure) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
    this.flush();
  }

  /** Exactly `n` bytes, when they have arrived; rejects once the queue is closed. */
  read(n: number): Promise<Buffer> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.waiter) return Promise.reject(new Error('ByteQueue: one read at a time'));
    return new Promise((resolve, reject) => {
      this.waiter = { n, resolve, reject };
      this.flush();
    });
  }

  /** Fail the pending and any later read (the socket closed). */
  close(reason: Error): void {
    if (this.failure) return;
    this.failure = reason;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(reason);
  }

  /** The bytes received but not read yet; the queue then accepts no more. */
  drain(): Buffer {
    const rest = Buffer.concat(this.chunks);
    this.chunks = [];
    this.length = 0;
    this.close(new Error('drained'));
    return rest;
  }

  private flush(): void {
    const waiter = this.waiter;
    if (!waiter || this.length < waiter.n) return;
    const all = Buffer.concat(this.chunks);
    this.chunks = all.length > waiter.n ? [all.subarray(waiter.n)] : [];
    this.length = all.length - waiter.n;
    this.waiter = null;
    waiter.resolve(all.subarray(0, waiter.n));
  }
}

/** The RFB version a 12-byte ProtocolVersion message names, or null when unsupported. */
export function parseVersion(message: Buffer): RfbVersion | null {
  const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(message.toString('latin1'));
  if (!match) return null;
  const version = `${match[1]}.${match[2]}`;
  // Same table as noVNC 1.4 (rfb.js `_negotiateProtocolVersion`), the repeater excepted.
  if (version === '003.003' || version === '003.006') return 3.3;
  if (version === '003.007') return 3.7;
  if (['003.008', '003.889', '004.000', '004.001', '005.000'].includes(version)) return 3.8;
  return null;
}

function versionMessage(version: RfbVersion): Buffer {
  return Buffer.from(`RFB 003.00${Math.round((version % 1) * 10)}\n`, 'latin1');
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0);
  return out;
}

async function readReason(queue: ByteQueue): Promise<string> {
  const length = (await queue.read(4)).readUInt32BE(0);
  if (length === 0) return '';
  if (length > MAX_REASON) throw new Error('reason too long');
  return (await queue.read(length)).toString('utf8');
}

/** One side of the handshake: what to read from, what to write to. */
export interface RfbPeer {
  queue: ByteQueue;
  write(bytes: Buffer): void;
}

/** The outcome of the server side of the handshake. */
export type ServerOutcome = { ok: true; securityType: number } | { ok: false; reason: string };

/** Pick the security type to use among those the server offers. */
export function chooseSecurityType(offered: number[], password: string): number | null {
  if (password !== '' && offered.includes(SEC_VNC_AUTH)) return SEC_VNC_AUTH;
  if (offered.includes(SEC_NONE)) return SEC_NONE;
  // No password stored but the server insists: try an empty one (some servers
  // accept it); a refusal comes back as an authentication failure.
  if (offered.includes(SEC_VNC_AUTH)) return SEC_VNC_AUTH;
  return null;
}

/**
 * The relay, as an RFB client, authenticates to the VNC server. Resolves the
 * outcome; never rejects on a protocol refusal (only when the socket closes).
 */
export async function authenticateToServer(server: RfbPeer, password: string): Promise<ServerOutcome> {
  const version = parseVersion(await server.queue.read(VERSION_LENGTH));
  if (version === null) return { ok: false, reason: 'unsupported RFB version from the VNC server' };
  server.write(versionMessage(version));

  let type: number;
  if (version >= 3.7) {
    const count = (await server.queue.read(1))[0];
    if (count === 0) return { ok: false, reason: (await readReason(server.queue)) || 'the VNC server refused the connection' };
    const offered = [...(await server.queue.read(count))];
    const chosen = chooseSecurityType(offered, password);
    if (chosen === null) {
      return {
        ok: false,
        reason: `the VNC server offers no security type the relay supports (offered: ${offered.join(', ')}; supported: None, VNC password)`
      };
    }
    type = chosen;
    server.write(Buffer.from([type]));
  } else {
    type = (await server.queue.read(4)).readUInt32BE(0);
    if (type === 0) return { ok: false, reason: (await readReason(server.queue)) || 'the VNC server refused the connection' };
    if (type !== SEC_NONE && type !== SEC_VNC_AUTH) {
      return { ok: false, reason: `the VNC server requires security type ${type}; supported: None, VNC password` };
    }
  }

  if (type === SEC_VNC_AUTH) {
    const challenge = await server.queue.read(CHALLENGE_LENGTH);
    server.write(vncAuthResponse(password, challenge));
  }
  // SecurityResult: after VNC auth in every version, after None only from 3.8.
  if (type === SEC_VNC_AUTH || version === 3.8) {
    const result = (await server.queue.read(4)).readUInt32BE(0);
    if (result !== 0) {
      const reason = version === 3.8 ? await readReason(server.queue) : '';
      return { ok: false, reason: reason || 'VNC authentication failed (check the stored password)' };
    }
  }
  return { ok: true, securityType: type };
}

/**
 * The relay, as an RFB server, offers the browser security type None. Resolves
 * the version the browser chose; rejects when it speaks something else.
 */
export async function greetClient(client: RfbPeer): Promise<RfbVersion> {
  client.write(Buffer.from(RELAY_VERSION, 'latin1'));
  const version = parseVersion(await client.queue.read(VERSION_LENGTH));
  if (version === null) throw new Error('unsupported RFB version from the browser');
  if (version >= 3.7) {
    client.write(Buffer.from([1, SEC_NONE]));
    const choice = (await client.queue.read(1))[0];
    if (choice !== SEC_NONE) throw new Error(`the browser chose security type ${choice}`);
  } else {
    client.write(u32(SEC_NONE));
  }
  return version;
}

/** The outcome of a whole broker handshake. */
export type BrokerOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Both sides, concurrently; then the browser learns the result. After an `ok`
 * outcome, ClientInit and the rest are piped as is (drain both queues first).
 * On a refusal the browser gets the reason (RFB 3.8 SecurityResult), so noVNC
 * raises `securityfailure` with it — the caller then closes both sockets.
 */
export async function brokerHandshake(client: RfbPeer, server: RfbPeer, password: string): Promise<BrokerOutcome> {
  const [clientVersion, outcome] = await Promise.all([greetClient(client), authenticateToServer(server, password)]);
  if (outcome.ok) {
    // RFB 3.8: SecurityResult OK even for None; 3.3 / 3.7 send none for None.
    if (clientVersion === 3.8) client.write(u32(0));
    return { ok: true };
  }
  if (clientVersion === 3.8) {
    const reason = Buffer.from(outcome.reason, 'utf8');
    client.write(Buffer.concat([u32(1), u32(reason.length), reason]));
  }
  return { ok: false, reason: outcome.reason };
}
