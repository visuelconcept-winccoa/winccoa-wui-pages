// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extensions — what a module adds to the alarm view in CODE, where a profile
 * (plain JSON) cannot reach:
 *
 *  - `classify`: its own reading of each row — a level known from the alert
 *    class rather than from its priority, an origin, a work order (`extra`);
 *  - `keep`: which rows the module shows at all — its collection rules (a
 *    perimeter, a minimum severity, keywords), applied before any filter the
 *    operator sees;
 *  - `columns`: how an additional column is drawn, when its raw `extra` text is
 *    not enough (a badge, a link);
 *  - `filters`: additional filters it always offers;
 *  - `acknowledge`: an acknowledgement OVERRIDE for the alarms it owns — a
 *    dialog asking a cause and an action, then a write of its own (one
 *    `alertSet` on the server carrying the acknowledgement and the answers).
 *    The other alarms of the same selection keep the kit's acknowledgement.
 *
 * An extension is handed to a view directly (`.extensions=${[…]}`), or
 * registered once by id ({@link registerAlarmExtension}) and activated by a
 * profile (`"extensions": ["msp"]`) — the form a stored profile or a widget can
 * name.
 */
import type { TemplateResult } from 'lit';
import type { AlarmClassifier } from './mapping.js';
import type { AlarmFieldFilter } from './profile.js';
import type { Alarm } from './types.js';

/** What an acknowledgement did. */
export interface AckResult {
  ok: boolean;
  /** Why it failed, in the operator's language — shown as it is. */
  error?: string;
}

/** What an acknowledgement override is given besides the alarms. */
export interface AlarmAckContext {
  /** The view element — where a dialog may be anchored. */
  host: HTMLElement;
}

/** An acknowledgement override for the alarms a module owns. */
export interface AlarmAckHandler {
  /** True for the alarms this handler acknowledges. */
  applies(alarm: Alarm): boolean;
  /**
   * Acknowledge them. Resolve `null` when the operator cancelled (nothing was
   * written, nothing is reported); reject or resolve `ok: false` when the write
   * failed.
   */
  acknowledge(alarms: readonly Alarm[], context: AlarmAckContext): Promise<AckResult | null>;
  /**
   * True when the handler asks the operator itself (its own dialog): the view
   * then skips its confirmation for these alarms.
   */
  confirms?: boolean;
}

/** How an additional column is drawn. */
export interface AlarmColumnRenderer {
  /** The column id (a profile lists it by this id). */
  id: string;
  render(alarm: Alarm): TemplateResult | string;
}

export interface AlarmViewExtension {
  id: string;
  classify?: AlarmClassifier;
  /** False for a row the module does not show (after `classify`). */
  keep?: (alarm: Alarm) => boolean;
  columns?: readonly AlarmColumnRenderer[];
  filters?: readonly AlarmFieldFilter[];
  acknowledge?: AlarmAckHandler;
}

/**
 * The registry lives on `globalThis`, not in this module: the kit is copied into
 * several self-contained page bundles, and an extension registered by one bundle
 * must be found by the view of another.
 */
const REGISTRY_KEY = Symbol.for('wui-alarms-core.extensions');

function registry(): Map<string, AlarmViewExtension> {
  const holder = globalThis as unknown as Record<symbol, Map<string, AlarmViewExtension> | undefined>;
  holder[REGISTRY_KEY] ??= new Map<string, AlarmViewExtension>();
  return holder[REGISTRY_KEY];
}

/** Register an extension under its id (a second registration replaces the first). */
export function registerAlarmExtension(extension: AlarmViewExtension): void {
  registry().set(extension.id, extension);
}

/** The registered extensions among these ids, in order; unknown ids are skipped. */
export function registeredExtensions(ids: readonly string[]): AlarmViewExtension[] {
  const known = registry();
  return ids.map((id) => known.get(id)).filter((extension): extension is AlarmViewExtension => extension !== undefined);
}

/** The classifiers of a set of extensions folded into one (in order). */
export function combinedClassifier(extensions: readonly AlarmViewExtension[]): AlarmClassifier | undefined {
  const classifiers = extensions.map((extension) => extension.classify).filter((classify): classify is AlarmClassifier => !!classify);
  if (classifiers.length === 0) return undefined;
  return (alarm, alert) => classifiers.reduce((current, classify) => classify(current, alert), alarm);
}

/** The `keep` rules of a set of extensions: a row is shown when all of them keep it. */
export function combinedKeep(extensions: readonly AlarmViewExtension[]): ((alarm: Alarm) => boolean) | undefined {
  const rules = extensions.map((extension) => extension.keep).filter((keep): keep is (alarm: Alarm) => boolean => !!keep);
  if (rules.length === 0) return undefined;
  return (alarm) => rules.every((keep) => keep(alarm));
}

/** A stable number per function — how a view tells a NEW reading of the rows from the same one. */
const identities = new WeakMap<object, number>();
let nextIdentity = 1;

function identityOf(value: object): number {
  let id = identities.get(value);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(value, id);
  }
  return id;
}

/**
 * What the rows depend on in a set of extensions: their `classify` and `keep`
 * functions, by identity. An extension rebuilt with a new classifier (its model
 * changed) changes the key, and the view re-maps its snapshot.
 */
export function readingKey(extensions: readonly AlarmViewExtension[]): string {
  return extensions
    .map((extension) =>
      [extension.classify, extension.keep].map((fn) => (fn ? identityOf(fn) : 0)).join(':')
    )
    .join('|');
}

/**
 * A selection split between the acknowledgement overrides and the kit's own
 * acknowledgement: each alarm goes to the FIRST handler that claims it.
 */
export function partitionAck(
  alarms: readonly Alarm[],
  extensions: readonly AlarmViewExtension[]
): { handled: { handler: AlarmAckHandler; alarms: Alarm[] }[]; native: Alarm[] } {
  const handlers = extensions.map((extension) => extension.acknowledge).filter((handler): handler is AlarmAckHandler => !!handler);
  const handled = handlers.map((handler) => ({ handler, alarms: [] as Alarm[] }));
  const native: Alarm[] = [];
  for (const alarm of alarms) {
    const owner = handled.find((entry) => entry.handler.applies(alarm));
    if (owner) owner.alarms.push(alarm);
    else native.push(alarm);
  }
  return { handled: handled.filter((entry) => entry.alarms.length > 0), native };
}
