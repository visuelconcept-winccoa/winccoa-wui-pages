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
  DeviceDraft,
  DeviceStateUpdate,
  EngPlan,
  EngType,
  LiveSnapshot,
  ModelTemplate,
  OpcUaBrowseNode,
  S7PlusBrowseNode,
  SignalRole,
  TagAccess,
  Workspace
} from '@visuelconcept/wui-eng-core';
import type {
  BookDeletion,
  BookRefresh,
  BrowseRequest,
  ConnectionProvision,
  ConnectionSecurity,
  DeviceSaveResult,
  EngConnection,
  EngConfigOptions,
  EngDriver,
  EngGateway,
  EngRole,
  EngS7PlusConnection,
  EngS7PlusProject,
  EngS7PlusStation,
  IngestRequest,
  LiveScope,
  S7InventoryResult,
  S7PlusManagerHealth,
  S7PlusWalkRequest,
  TestReadResult,
  WalkRequest
} from './gateway.js';
import { walkIntoBook as runWalk, walkS7PlusIntoBook as runS7PlusWalk } from './walk.js';

const BASE = '/api/eng';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  return sendJson<T>('PUT', path, body);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return sendJson<T>('POST', path, body);
}

async function sendJson<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    // Surface the backend's own reason when it sent one (a validation refusal says
    // WHAT is wrong; "HTTP 400" does not).
    const reason = await res
      .clone()
      .json()
      .then((payload: { error?: string }) => payload?.error)
      .catch(() => undefined);
    throw new Error(reason ?? `${method} ${path} → HTTP ${res.status}`);
  }
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

  async deviceStates(): Promise<DeviceStateUpdate[]> {
    const { states } = await getJson<{ states: DeviceStateUpdate[] }>('/devices/state');
    return states;
  }

  /**
   * A creation POSTs to the COLLECTION (`/devices`) and an update to the ITEM
   * (`/devices/<id>`) — an empty id would produce `/devices/`, which Express (with
   * its default non-strict routing) hands to the collection handler. The server
   * derives the id of a creation, so concurrent creations of the same name cannot
   * overwrite each other.
   */
  async saveDevice(id: string, draft: DeviceDraft): Promise<DeviceSaveResult> {
    const path = id === '' ? '/devices' : `/devices/${encodeURIComponent(id)}`;
    const { devices, connectionProvision, connectionSecurity } = await postJson<{
      devices: Device[];
      connectionProvision?: ConnectionProvision;
      connectionSecurity?: ConnectionSecurity;
    }>(path, { device: draft });
    return {
      devices,
      ...(connectionProvision === undefined ? {} : { connectionProvision }),
      ...(connectionSecurity === undefined ? {} : { connectionSecurity })
    };
  }

  async deleteDevice(id: string): Promise<Device[]> {
    const res = await fetch(`${BASE}/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE /devices/${id} → HTTP ${res.status}`);
    const { devices } = (await res.json()) as { devices: Device[] };
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

  async refreshBook(bookId: string): Promise<BookRefresh> {
    return postJson<BookRefresh>(`/books/${encodeURIComponent(bookId)}/refresh`, {});
  }

  async ingestBook(request: IngestRequest): Promise<{ book: AddressBook; books: AddressBook[] }> {
    return postJson<{ book: AddressBook; books: AddressBook[] }>('/books/ingest', request);
  }

  async s7Inventory(
    bookId: string,
    target: { deviceId?: string; host?: string; rack?: number; slot?: number }
  ): Promise<S7InventoryResult> {
    return postJson<S7InventoryResult>(`/books/${encodeURIComponent(bookId)}/s7-inventory`, target);
  }

  /**
   * Read off `/health`, which already reports both managers separately — one
   * round-trip instead of a dedicated probe, and it cannot disagree with what the
   * backend says about itself.
   */
  async listS7Connections(): Promise<EngConnection[]> {
    const { connections } = await getJson<{ connections: EngConnection[] }>('/s7/connections');
    return connections;
  }

  async s7BrowseHealth(): Promise<{ reachable: boolean }> {
    const health = await getJson<{ s7Browse?: { reachable?: boolean } }>('/health');
    return { reachable: health.s7Browse?.reachable === true };
  }

  async createBook(request: {
    bookId: string;
    name?: string;
    interface?: AddressBook['interface'];
  }): Promise<{ book: AddressBook; books: AddressBook[] }> {
    return postJson<{ book: AddressBook; books: AddressBook[] }>('/books', request);
  }

  async browseLevel(connection: string, nodeId?: string): Promise<OpcUaBrowseNode[]> {
    const { nodes } = await postJson<{ nodes: OpcUaBrowseNode[] }>('/browse/level', {
      connection,
      ...(nodeId === undefined ? {} : { nodeId })
    });
    return nodes;
  }

  /**
   * Run the walk HERE, level by level, then store the finished book.
   *
   * The alternative (`browseBook`, one server-side call) is still there and still
   * correct; this path exists because it is the only one that can report progress and
   * be cancelled. The walker is the core's either way.
   */
  async walkIntoBook(request: WalkRequest): Promise<BookRefresh> {
    const previous = await this.getBook(request.bookId);
    const { book, delta } = await runWalk({ browseLevel: (connection, nodeId) => this.browseLevel(connection, nodeId) }, previous, request);
    const stored = await putJson<{ book: AddressBook }>(`/books/${encodeURIComponent(request.bookId)}`, { book });
    return { book: stored.book, rebrowsed: true, ...(delta === undefined ? {} : { delta }) };
  }

  async saveBookExcluded(bookId: string, excluded: Record<string, boolean>): Promise<AddressBook> {
    const { book } = await postJson<{ book: AddressBook }>(`/books/${encodeURIComponent(bookId)}/exclude`, { excluded });
    return book;
  }

  async deleteBook(bookId: string): Promise<BookDeletion> {
    const res = await fetch(`${BASE}/books/${encodeURIComponent(bookId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE /books/${bookId} → HTTP ${res.status}`);
    return (await res.json()) as BookDeletion;
  }

  async listConnections(): Promise<EngConnection[]> {
    const { connections } = await getJson<{ connections: EngConnection[] }>('/connections');
    return connections;
  }

  async listDrivers(): Promise<EngDriver[]> {
    const { drivers } = await getJson<{ drivers: EngDriver[] }>('/drivers');
    return drivers;
  }

  async searchDps(pattern: string, type?: string): Promise<{ dps: string[]; truncated: boolean }> {
    const query = new URLSearchParams({ pattern: pattern === '' ? '*' : pattern });
    if (type !== undefined && type !== '') query.set('type', type);
    const result = await getJson<{ dps?: string[]; truncated?: boolean }>(`/dps?${query.toString()}`);
    return { dps: result.dps ?? [], truncated: result.truncated === true };
  }

  async listDpTypes(): Promise<string[]> {
    const { types } = await getJson<{ types?: string[] }>('/dptypes');
    return types ?? [];
  }

  async readDpType(typeName: string): Promise<EngType> {
    const { type } = await getJson<{ type: EngType }>(`/dptypes/${encodeURIComponent(typeName)}`);
    return type;
  }

  async listConfigOptions(): Promise<EngConfigOptions> {
    const options = await getJson<EngConfigOptions>('/config-options');
    return {
      alarmClasses: options.alarmClasses ?? [],
      archiveGroups: options.archiveGroups ?? [],
      subscriptions: options.subscriptions ?? [],
      pollGroups: options.pollGroups ?? []
    };
  }

  async browseBook(request: BrowseRequest): Promise<BookRefresh> {
    return postJson<BookRefresh>('/books/browse', request);
  }

  // --- S7Plus ---------------------------------------------------------------
  // Every one of these lands in the dedicated `s7plusBrowse` manager through the
  // backend (see backend/routes/engS7PlusBrowse.ts); the page never talks to the
  // driver, and this stays a transport.

  async s7plusHealth(): Promise<S7PlusManagerHealth> {
    const { manager } = await getJson<{ manager: S7PlusManagerHealth }>('/s7plus/health');
    return manager;
  }

  async listS7PlusConnections(): Promise<EngS7PlusConnection[]> {
    const { connections } = await getJson<{ connections: EngS7PlusConnection[] }>('/s7plus/connections');
    return connections;
  }

  async listS7PlusProjects(connection: string): Promise<EngS7PlusProject[]> {
    const { projects } = await postJson<{ projects: EngS7PlusProject[] }>('/s7plus/projects', { connection });
    return projects;
  }

  async listS7PlusStations(connection: string, project: string): Promise<EngS7PlusStation[]> {
    const { stations } = await postJson<{ stations: EngS7PlusStation[] }>('/s7plus/stations', { connection, project });
    return stations;
  }

  async browseS7PlusLevel(connection: string, item?: string, hmiVisibleOnly?: boolean): Promise<S7PlusBrowseNode[]> {
    const { nodes } = await postJson<{ nodes: S7PlusBrowseNode[] }>('/s7plus/level', {
      connection,
      ...(item === undefined ? {} : { item }),
      ...(hmiVisibleOnly === undefined ? {} : { hmiVisibleOnly })
    });
    return nodes;
  }

  /**
   * Run the S7Plus walk HERE, level by level, then store the finished book — the
   * same reasoning as {@link walkIntoBook}: only a client-driven walk can report
   * progress and be cancelled, and a station of a real PLC takes minutes.
   */
  async walkS7PlusIntoBook(request: S7PlusWalkRequest): Promise<BookRefresh> {
    const previous = await this.getBook(request.bookId);
    const { book, delta } = await runS7PlusWalk(
      { browseLevel: (connection, item, hmiVisibleOnly) => this.browseS7PlusLevel(connection, item, hmiVisibleOnly) },
      previous,
      request
    );
    const stored = await putJson<{ book: AddressBook }>(`/books/${encodeURIComponent(request.bookId)}`, { book });
    return { book: stored.book, rebrowsed: true, ...(delta === undefined ? {} : { delta }) };
  }

  async saveBookRoles(bookId: string, roles: Record<string, SignalRole | ''>): Promise<void> {
    await postJson(`/books/${encodeURIComponent(bookId)}/roles`, { roles });
  }

  async saveBookAccess(bookId: string, access: Record<string, TagAccess | ''>): Promise<void> {
    await postJson(`/books/${encodeURIComponent(bookId)}/access`, { access });
  }

  async listModels(): Promise<ModelTemplate[]> {
    const { models } = await getJson<{ models: ModelTemplate[] }>('/models');
    return models;
  }

  async saveModel(model: ModelTemplate): Promise<ModelTemplate> {
    const { model: stored } = await postJson<{ model: ModelTemplate }>('/models', { model });
    return stored;
  }

  async deleteModel(id: string): Promise<void> {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE /models/${id} → HTTP ${res.status}`);
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

  async checkin(plan: EngPlan, dryRun: boolean, recreate = false): Promise<ApplyReport> {
    return postJson<ApplyReport>('/checkin', { plan, dryRun, recreate });
  }

  async testRead(dpes: string[]): Promise<TestReadResult[]> {
    const { results } = await postJson<{ results: TestReadResult[] }>('/test-read', { dpes });
    return results;
  }
}
