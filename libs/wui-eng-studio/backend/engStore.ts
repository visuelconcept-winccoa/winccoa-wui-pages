// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// EngStore — persistence of the Engineering Studio's engineering data.
// -----------------------------------------------------------------------------
// Devices, address books, workspaces and the operator's role overrides are
// ENGINEERING data, not runtime data: they are stored as JSON FILES, not in
// datapoints.
//
// Why files rather than the DP-JSON page-store pattern used elsewhere in the
// suite (mosaic, app-security…):
//   * an address book can hold thousands of entries (a TIA project, a large OPC
//     UA server) — a DP string element is the wrong container for that;
//   * engineering data must be diff-able, backup-able and reviewable outside the
//     project (a workspace is meant to be versioned, cf. NOTES);
//   * it keeps the store usable and testable without any WinCC OA runtime.
//
// Layout (under the store root):
//   devices.json                  Device[]
//   books/<bookId>.json           AddressBook  (roles included, see NOTES)
//   books/<bookId>.roles.json     Record<entryPath, SignalRole>  (manual overrides)
//   books/<bookId>.access.json    Record<entryPath, TagAccess>   (manual overrides)
//   books/<bookId>.excluded.json  Record<entryPath, true>        (signals hidden by hand)
//   workspaces/<name>.json        Workspace
//
// The three override files sit BESIDE the book rather than inside it because the
// book is a *reading* of a source that gets re-read (a re-browse, a re-ingest): an
// override written into it would be erased by the next refresh.
//
// The root is $ENG_STUDIO_STORE, else <WINCCOA_PROJ>/data/eng-studio, else
// ./data/eng-studio. Ids are sanitised so a request can never escape the root.
// -----------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Resolve the store root once (env → OA project → cwd). */
function storeRoot(): string {
  const explicit = process.env['ENG_STUDIO_STORE'];
  if (explicit && explicit.trim() !== '') return resolve(explicit);
  const project = process.env['WINCCOA_PROJ'];
  if (project && project.trim() !== '') return resolve(project, 'data/eng-studio');
  return resolve(process.cwd(), 'data/eng-studio');
}

/** Keep only a safe file-name fragment (no traversal, no separators). */
export function safeId(id: string): string {
  const base = String(id ?? '').replaceAll(/[^A-Za-z0-9._-]/g, '_');
  const trimmed = base.replaceAll(/^\.+/g, '');
  if (trimmed === '') throw new Error('invalid identifier');
  return trimmed;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/** Atomic-ish write: temp file + rename, so a crash never leaves a half file. */
function writeJson(file: string, value: unknown): void {
  ensureDir(dirname(file));
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (error) {
    console.warn(`engStore: unreadable ${file}:`, (error as Error)?.message ?? error);
    return fallback;
  }
}

/**
 * File-backed store. Generic over the domain shapes so this module stays free of
 * `@visuelconcept/wui-eng-core` typing at build time (the controller supplies the
 * types) — the store only moves JSON.
 */
export class EngStore {
  /** Suffixes of the OVERRIDE files, which are not books (see the layout above). */
  private static readonly OVERRIDE_SUFFIXES = ['.roles.json', '.access.json', '.excluded.json'];

  private readonly root: string;

  constructor(root: string = storeRoot()) {
    this.root = root;
  }

  /** Absolute store root (exposed for diagnostics/health). */
  public path(): string {
    return this.root;
  }

  // --- devices --------------------------------------------------------------

  public listDevices<T>(): T[] {
    return readJson<T[]>(join(this.root, 'devices.json'), []);
  }

  public saveDevices<T>(devices: T[]): void {
    writeJson(join(this.root, 'devices.json'), devices);
  }

  // --- books ----------------------------------------------------------------

  private bookFile(bookId: string): string {
    return join(this.root, 'books', `${safeId(bookId)}.json`);
  }

  private rolesFile(bookId: string): string {
    return join(this.root, 'books', `${safeId(bookId)}.roles.json`);
  }

  private accessFile(bookId: string): string {
    return join(this.root, 'books', `${safeId(bookId)}.access.json`);
  }

  private excludedFile(bookId: string): string {
    return join(this.root, 'books', `${safeId(bookId)}.excluded.json`);
  }

  public listBookIds(): string[] {
    const dir = join(this.root, 'books');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json') && !EngStore.OVERRIDE_SUFFIXES.some((suffix) => name.endsWith(suffix)))
      .map((name) => name.slice(0, -'.json'.length));
  }

  public readBook<T>(bookId: string): T | null {
    return readJson<T | null>(this.bookFile(bookId), null);
  }

  public saveBook<T extends { id: string }>(book: T): void {
    writeJson(this.bookFile(book.id), book);
  }

  public deleteBook(bookId: string): void {
    for (const file of [this.bookFile(bookId), this.rolesFile(bookId), this.accessFile(bookId), this.excludedFile(bookId)]) {
      if (existsSync(file)) unlinkSync(file);
    }
  }

  /** Manual role overrides of a book (entry path → role). */
  public readRoles(bookId: string): Record<string, string> {
    return readJson<Record<string, string>>(this.rolesFile(bookId), {});
  }

  /** Merge overrides into the stored ones (an empty role clears an override). */
  public saveRoles(bookId: string, roles: Record<string, string>): Record<string, string> {
    const merged = { ...this.readRoles(bookId), ...roles };
    for (const [path, role] of Object.entries(roles)) {
      if (role === '') delete merged[path];
    }
    writeJson(this.rolesFile(bookId), merged);
    return merged;
  }

  /** Manual ACCESS overrides of a book (entry path → 'r' | 'w' | 'rw'). */
  public readAccess(bookId: string): Record<string, string> {
    return readJson<Record<string, string>>(this.accessFile(bookId), {});
  }

  /** Merge access overrides into the stored ones (an empty value clears one). */
  public saveAccess(bookId: string, access: Record<string, string>): Record<string, string> {
    const merged = { ...this.readAccess(bookId), ...access };
    for (const [path, mode] of Object.entries(access)) {
      if (mode === '') delete merged[path];
    }
    writeJson(this.accessFile(bookId), merged);
    return merged;
  }

  /**
   * Entry paths the operator has HIDDEN by hand (`{path: true}`).
   *
   * A map rather than a list so a single path can be un-hidden by sending `false` —
   * the same merge semantics as the role and access overrides, and the reason this
   * is stored apart from the book: a re-browse must not undo the operator's
   * judgement, and hiding a signal must stay reversible.
   */
  public readExcluded(bookId: string): Record<string, boolean> {
    return readJson<Record<string, boolean>>(this.excludedFile(bookId), {});
  }

  /** Merge exclusions (`false` clears one); returns the merged set. */
  public saveExcluded(bookId: string, excluded: Record<string, boolean>): Record<string, boolean> {
    const merged = { ...this.readExcluded(bookId) };
    for (const [path, hidden] of Object.entries(excluded)) {
      if (hidden) merged[path] = true;
      else delete merged[path];
    }
    writeJson(this.excludedFile(bookId), merged);
    return merged;
  }

  // --- model templates ------------------------------------------------------

  private modelFile(id: string): string {
    return join(this.root, 'models', `${safeId(id)}.json`);
  }

  /**
   * Reusable models (a type's structure + how its leaves reach a catalog).
   *
   * Their own directory, not a field of a workspace: a template outlives the
   * workspace it was first generated into — that is the whole point of authoring one
   * house-standard type and applying it to machine after machine.
   */
  public listModelIds(): string[] {
    const dir = join(this.root, 'models');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length));
  }

  public readModel<T>(id: string): T | null {
    return readJson<T | null>(this.modelFile(id), null);
  }

  public saveModel<T extends { id: string }>(model: T): void {
    writeJson(this.modelFile(model.id), model);
  }

  public deleteModel(id: string): void {
    const file = this.modelFile(id);
    if (existsSync(file)) unlinkSync(file);
  }

  // --- workspaces -----------------------------------------------------------

  private workspaceFile(name: string): string {
    return join(this.root, 'workspaces', `${safeId(name)}.json`);
  }

  public listWorkspaceNames(): string[] {
    const dir = join(this.root, 'workspaces');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length));
  }

  public readWorkspace<T>(name: string): T | null {
    return readJson<T | null>(this.workspaceFile(name), null);
  }

  public saveWorkspace<T extends { name: string }>(workspace: T): void {
    writeJson(this.workspaceFile(workspace.name), workspace);
  }
}
