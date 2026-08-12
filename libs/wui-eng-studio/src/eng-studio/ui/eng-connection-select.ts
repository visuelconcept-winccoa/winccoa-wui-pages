// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The OPC UA connection picker — the equipment's `server` parameter, chosen from the
 * project's OWN connections instead of typed from memory.
 *
 * It used to be a free-text field, and that is exactly how a device came to declare
 * `simu1` in a project whose connections are `Simulator1` and `test`. Nothing was
 * refused, nothing was reported: the addresses simply would not bind and the state
 * badge said "unknown" for a machine that was answering. The name is not decoration —
 * it is what every `_address.._reference` of the equipment carries and what the
 * connection state is read on, so it has to come from the project.
 *
 * Same three degradations as the driver picker (`eng-driver-select.ts`), for the same
 * reasons:
 *   * the list is empty (no runtime, no permission) → a plain text field, so a
 *     declaration is never blocked by a diagnosis the page could not make;
 *   * the stored value is not in the list → it is offered as its own option, so
 *     editing an equipment never silently drops what was declared before;
 *   * `editable`, so a connection the list does not carry can still be typed — a
 *     connection may legitimately be created after the equipment is declared.
 *
 * A rendering function rather than an element: it is a few lines of markup over the
 * caller's own draft (see the note at the top of `eng-driver-select.ts`).
 */
import { html, nothing, type TemplateResult } from 'lit';
import type { EngConnection } from '../data/gateway.js';
import { MSG, fmt, t, type Lang } from '../i18n.js';

/** Value of the "not stated" option. */
const UNSET = '';

export interface ConnectionSelectOptions {
  /** The project's OPC UA connections, as the gateway reported them (may be empty). */
  connections: EngConnection[];
  value: string | undefined;
  lang: Lang;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}

/**
 * Human label of a connection: its name, plus a suffix when it is NOT connected.
 *
 * A disconnected connection stays offered — it is a legitimate choice (a machine may
 * be off while it is being declared) — but choosing one blind is how a declaration
 * gets blamed later for a driver problem.
 */
export function connectionLabel(connection: EngConnection, lang: Lang): string {
  return connection.name + (connection.connected ? '' : t(MSG.disconnectedSuffix, lang));
}

export function renderConnectionSelect(options: ConnectionSelectOptions): TemplateResult {
  const { connections, lang, onChange } = options;
  const current = options.value === undefined || options.value === null ? UNSET : String(options.value);
  if (connections.length === 0) {
    return html`
      <ix-input
        placeholder=${options.placeholder ?? ''}
        ?disabled=${options.disabled === true}
        .value=${current}
        @valueChange=${(event: CustomEvent<string>) => onChange(String(event.detail))}
      ></ix-input>
    `;
  }
  const unlisted = current !== UNSET && !connections.some((connection) => connection.name === current);
  return html`
    <ix-select
      editable
      allow-clear
      i18n-placeholder=${t(MSG.paramUnset, lang)}
      i18n-placeholder-editable=${t(MSG.paramUnset, lang)}
      ?disabled=${options.disabled === true}
      .value=${current}
      @valueChange=${(event: CustomEvent<string | string[]>) => onChange(firstOf(event.detail))}
      @addItem=${(event: CustomEvent<string>) => onChange(String(event.detail).trim())}
    >
      ${connections.map(
        (connection) => html`<ix-select-item value=${connection.name} label=${connectionLabel(connection, lang)}></ix-select-item>`
      )}
      ${unlisted ? html`<ix-select-item value=${current} label=${current}></ix-select-item>` : nothing}
    </ix-select>
  `;
}

/**
 * Advisory when the declared connection is not one the project has.
 *
 * Stated rather than refused: the connection may be created afterwards, and a form
 * that blocks on it would stop a legitimate declaration. But it must be SAID, because
 * the consequences are silent — no state to read, and addresses that will not bind.
 * `null` when the page has no list to compare against: an empty registry is not
 * evidence that a name is wrong.
 */
export function unknownConnectionHint(connections: EngConnection[], value: string | undefined, lang: Lang): string | null {
  const current = String(value ?? '').trim();
  if (current === UNSET || connections.length === 0) return null;
  if (connections.some((connection) => connection.name === current)) return null;
  return fmt(t(MSG.serverUnknown, lang), { name: current, known: connections.map((connection) => connection.name).join(', ') });
}

/** `ix-select` reports `string | string[]`; a single-mode select means the first. */
function firstOf(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? UNSET) : value;
}
