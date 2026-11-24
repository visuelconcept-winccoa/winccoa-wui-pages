// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tags a host serves over a WebSocket: an Industrial Edge app bridging the IE
 * Databus (wui-toolkit's edge server) — or any server speaking this protocol,
 * one JSON object per message:
 *
 *   page → host   { "op": "names", "id": 1, "pattern": "PLC_1.*" }
 *                 { "op": "watch", "id": 2, "tags": ["PLC_1.Speed", "PLC_1.Running"] }
 *                 { "op": "unwatch", "id": 2 }
 *   host → page   { "id": 1, "names": ["PLC_1.Running", "PLC_1.Speed"] }
 *                 { "id": 2, "samples": [{ "tag": "PLC_1.Speed", "value": 42, "ts": "…", "quality": "good" }] }
 *                 { "id": 1, "error": "…" }
 *
 * A watch answers at once with what the host knows, then each change; its samples
 * may name only some of the tags. One socket for the page, opened at the first
 * request; when it drops, it reopens after a pause and the watches are sent again.
 */
import { Observable } from 'rxjs';
import type { DataSample, DataSource } from './source.js';

interface Pending {
  names?: { next: (names: string[]) => void; error: (error: Error) => void };
  watch?: { tags: string[]; samples: Map<string, DataSample>; next: (samples: DataSample[]) => void; error: (error: Error) => void };
}

/** What the page needs of a WebSocket — the browser's, or a stand-in in tests. */
export type SocketFactory = (url: string) => WebSocket;

const RECONNECT_MS = 2000;

/** `./wui-data` or `/wui-data` → `ws(s)://<host>/<path>` of this page. */
export function socketUrl(path: string, base: string = globalThis.location?.href ?? 'http://localhost/'): string {
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export class SocketDataSource implements DataSource {
  readonly kind = 'socket';
  private socket: WebSocket | null = null;
  private open = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly queue: string[] = [];

  constructor(
    private readonly url: string,
    private readonly factory: SocketFactory = (address) => new WebSocket(address)
  ) {}

  names(pattern: string): Observable<string[]> {
    return new Observable<string[]>((subscriber) => {
      const id = this.nextId++;
      this.pending.set(id, {
        names: {
          next: (names) => {
            subscriber.next(names);
            subscriber.complete();
          },
          error: (error) => subscriber.error(error)
        }
      });
      this.send({ op: 'names', id, pattern });
      return () => this.pending.delete(id);
    });
  }

  watch(tags: string[]): Observable<DataSample[]> {
    return new Observable<DataSample[]>((subscriber) => {
      if (tags.length === 0) {
        subscriber.next([]);
        return undefined;
      }
      const id = this.nextId++;
      const samples = new Map<string, DataSample>();
      this.pending.set(id, {
        watch: {
          tags,
          samples,
          next: () => subscriber.next(tags.map((tag) => samples.get(tag) ?? { value: undefined })),
          error: (error) => subscriber.error(error)
        }
      });
      this.send({ op: 'watch', id, tags });
      return () => {
        this.pending.delete(id);
        if (this.open) this.send({ op: 'unwatch', id });
      };
    });
  }

  private send(message: object): void {
    const text = JSON.stringify(message);
    if (this.open && this.socket) this.socket.send(text);
    else this.queue.push(text);
    this.connect();
  }

  private connect(): void {
    if (this.socket) return;
    const socket = this.factory(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.open = true;
      for (const text of this.queue.splice(0)) socket.send(text);
    });
    socket.addEventListener('message', (event: MessageEvent) => this.receive(String(event.data)));
    socket.addEventListener('close', () => {
      this.open = false;
      this.socket = null;
      // The watches still subscribed are sent again on the next socket; a names request is lost: it fails.
      for (const [id, entry] of this.pending) {
        if (entry.names) {
          entry.names.error(new Error('the data socket closed'));
          this.pending.delete(id);
        }
      }
      const watches = [...this.pending].filter(([, entry]) => entry.watch);
      if (watches.length > 0) {
        setTimeout(() => {
          for (const [id, entry] of watches) if (this.pending.has(id)) this.send({ op: 'watch', id, tags: entry.watch!.tags });
        }, RECONNECT_MS);
      }
    });
  }

  private receive(text: string): void {
    let message: { id?: number; names?: string[]; samples?: (DataSample & { tag: string })[]; error?: string };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    const entry = message.id !== undefined ? this.pending.get(message.id) : undefined;
    if (!entry) return;
    if (message.error) {
      (entry.names ?? entry.watch)?.error(new Error(message.error));
      this.pending.delete(message.id!);
      return;
    }
    if (entry.names && message.names) {
      this.pending.delete(message.id!);
      entry.names.next(message.names);
      return;
    }
    if (entry.watch && message.samples) {
      for (const { tag, ...sample } of message.samples) entry.watch.samples.set(tag, sample);
      entry.watch.next([]);
    }
  }
}
