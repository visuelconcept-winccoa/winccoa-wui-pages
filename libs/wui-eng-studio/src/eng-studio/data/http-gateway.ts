// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * HttpEngGateway — the live {@link EngGateway} over the `/api/eng/*` backend
 * (engController). Same-origin fetch; the backend runs against the shared
 * WinCC OA API. This is a thin transport; all engineering logic lives in
 * `@visuelconcept/wui-eng-core` (shared by the backend applier).
 */

import type {
  AddressBook,
  ApplyReport,
  Device,
  EngPlan,
  LiveSnapshot,
  SignalRole,
  Workspace
} from '@visuelconcept/wui-eng-core';
import type { EngGateway, EngRole, LiveScope, TestReadResult } from './gateway.js';

const BASE = '/api/eng';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export class HttpEngGateway implements EngGateway {
  readonly isDemo = false;

  async roles(): Promise<Set<EngRole>> {
    const { roles } = await getJson<{ roles: EngRole[] }>('/roles');
    return new Set(roles);
  }

  async listDevices(): Promise<Device[]> {
    const { devices } = await getJson<{ devices: Device[] }>('/devices');
    return devices;
  }

  async listBooks(): Promise<AddressBook[]> {
    const { books } = await getJson<{ books: AddressBook[] }>('/books');
    return books;
  }

  async getBook(bookId: string): Promise<AddressBook | null> {
    const { book } = await getJson<{ book: AddressBook | null }>(`/books/${encodeURIComponent(bookId)}`);
    return book;
  }

  async refreshBook(bookId: string): Promise<AddressBook> {
    const { book } = await postJson<{ book: AddressBook }>(`/books/${encodeURIComponent(bookId)}/refresh`, {});
    return book;
  }

  async saveBookRoles(bookId: string, roles: Record<string, SignalRole>): Promise<void> {
    await postJson(`/books/${encodeURIComponent(bookId)}/roles`, { roles });
  }

  async getWorkspace(): Promise<Workspace> {
    const { workspace } = await getJson<{ workspace: Workspace }>('/workspace');
    return workspace;
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    await postJson('/workspace', { workspace });
  }

  /**
   * POST (not GET) so the scope travels in the body: a DPE list is unbounded —
   * a real project checks out thousands of them, well past any URL length limit.
   */
  async liveSnapshot(scope: LiveScope = {}): Promise<LiveSnapshot> {
    const { snapshot } = await postJson<{ snapshot: LiveSnapshot }>('/live', scope);
    return snapshot;
  }

  async checkin(plan: EngPlan, dryRun: boolean): Promise<ApplyReport> {
    return postJson<ApplyReport>('/checkin', { plan, dryRun });
  }

  async testRead(dpes: string[]): Promise<TestReadResult[]> {
    const { results } = await postJson<{ results: TestReadResult[] }>('/test-read', { dpes });
    return results;
  }
}
