// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocketDataSource, socketUrl } from './socket-source.js';
import { matchesGlob, type DataSample } from './source.js';

/** A stand-in WebSocket: what the page sent, and a host's answers delivered on demand. */
class FakeSocket extends EventTarget {
  readonly sent: Record<string, unknown>[] = [];
  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }
  opened(): void {
    this.dispatchEvent(new Event('open'));
  }
  answer(message: object): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
  closed(): void {
    this.dispatchEvent(new Event('close'));
  }
}

function source() {
  const sockets: FakeSocket[] = [];
  const data = new SocketDataSource('ws://edge/wui-data', () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  return { data, sockets };
}

afterEach(() => vi.useRealTimers());

describe('glob patterns', () => {
  it('matches * and ? only — dots and brackets are literal', () => {
    expect(matchesGlob('PLC_1.*', 'PLC_1.Speed')).toBe(true);
    expect(matchesGlob('PLC_1.*', 'PLC_10.Speed')).toBe(false);
    expect(matchesGlob('PLC_?.Speed', 'PLC_2.Speed')).toBe(true);
    expect(matchesGlob('*', 'anything')).toBe(true);
    expect(matchesGlob('a[1]', 'a[1]')).toBe(true);
  });
});

describe('the socket URL', () => {
  it('is the page-relative path, ws or wss as the page', () => {
    expect(socketUrl('./wui-data', 'http://device:4380/')).toBe('ws://device:4380/wui-data');
    expect(socketUrl('./wui-data', 'https://device/app/index.html')).toBe('wss://device/app/wui-data');
  });
});

describe('the socket data source', () => {
  it('queues requests until the socket opens; names answer once', async () => {
    const { data, sockets } = source();
    const names = new Promise<string[]>((resolve) => data.names('PLC_1.*').subscribe(resolve));
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toEqual([]);
    sockets[0].opened();
    expect(sockets[0].sent).toEqual([{ op: 'names', id: 1, pattern: 'PLC_1.*' }]);
    sockets[0].answer({ id: 1, names: ['PLC_1.Running', 'PLC_1.Speed'] });
    expect(await names).toEqual(['PLC_1.Running', 'PLC_1.Speed']);
  });

  it('a watch keeps the order of its tags, merges partial updates, and unwatches when unsubscribed', () => {
    const { data, sockets } = source();
    const seen: DataSample[][] = [];
    const subscription = data.watch(['PLC_1.Speed', 'PLC_1.Running']).subscribe((samples) => seen.push(samples));
    sockets[0].opened();
    sockets[0].answer({ id: 1, samples: [{ tag: 'PLC_1.Running', value: true, quality: 'good' }] });
    sockets[0].answer({ id: 1, samples: [{ tag: 'PLC_1.Speed', value: 42, ts: '2026-11-24T10:00:00Z' }] });
    expect(seen).toEqual([
      [{ value: undefined }, { value: true, quality: 'good' }],
      [{ value: 42, ts: '2026-11-24T10:00:00Z' }, { value: true, quality: 'good' }]
    ]);
    subscription.unsubscribe();
    expect(sockets[0].sent.at(-1)).toEqual({ op: 'unwatch', id: 1 });
  });

  it('an error answers the request it names', async () => {
    const { data, sockets } = source();
    const failed = new Promise<Error>((resolve) => data.names('x').subscribe({ error: resolve }));
    sockets[0].opened();
    sockets[0].answer({ id: 1, error: 'no Databus' });
    expect((await failed).message).toBe('no Databus');
  });

  it('a dropped socket fails the names asked, and sends the watches again on a new one', () => {
    vi.useFakeTimers();
    const { data, sockets } = source();
    const errors: Error[] = [];
    data.names('*').subscribe({ error: (error: Error) => errors.push(error) });
    const seen: DataSample[][] = [];
    data.watch(['PLC_1.Speed']).subscribe((samples) => seen.push(samples));
    sockets[0].opened();
    sockets[0].closed();
    expect(errors.map((error) => error.message)).toEqual(['the data socket closed']);
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(2);
    sockets[1].opened();
    expect(sockets[1].sent).toEqual([{ op: 'watch', id: 2, tags: ['PLC_1.Speed'] }]);
    sockets[1].answer({ id: 2, samples: [{ tag: 'PLC_1.Speed', value: 7 }] });
    expect(seen.at(-1)).toEqual([{ value: 7 }]);
  });

  it('an empty watch answers at once, with nothing sent', () => {
    const { data, sockets } = source();
    const seen: DataSample[][] = [];
    data.watch([]).subscribe((samples) => seen.push(samples));
    expect(seen).toEqual([[]]);
    expect(sockets).toHaveLength(0);
  });
});
