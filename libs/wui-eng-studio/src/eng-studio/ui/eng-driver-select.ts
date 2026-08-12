// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The driver picker — shared by the device declaration form and the catalogue
 * creation form, because both state the same thing: WHICH driver the addresses
 * built from this connection are written to.
 *
 * It is a picker rather than a free number field because `driverNumber` is the
 * WinCC OA manager number every `_address` write of the equipment lands on: a
 * wrong one binds the datapoint to another driver, silently, and the check-in's
 * auto-detection only covers OPC UA (the only `_Driver<n>.DT` value whose mapping
 * is verified). So the project's own drivers are offered, WITH their state —
 * a stopped driver is a legitimate choice (an equipment is normally declared
 * before its driver is started), not something to hide.
 *
 * Three cases it has to keep working, hence the shape below:
 *   * the list is empty (no runtime, no permission) → a plain number field, so a
 *     declaration is never blocked by a diagnosis the page could not make;
 *   * the stored value is not in the list (the driver was removed, or the value
 *     predates this picker) → it is offered as its own option, so editing an
 *     equipment never silently drops it;
 *   * the operator knows a number the list does not have → the select is
 *     `editable`, so a number can be typed instead of chosen.
 *
 * A rendering function, not an element: it is four lines of markup over the
 * caller's own draft, and an element would need the draft plumbed through
 * properties and events for no gain.
 */
import { html, nothing, type TemplateResult } from 'lit';
import type { EngDriver } from '../data/gateway.js';
import { MSG, fmt, t, type Lang, type Ml } from '../i18n.js';

/** Value of the "not stated" option — an empty string clears `driverNumber`. */
const UNSET = '';

export interface DriverSelectOptions {
  /** The project's drivers, as the gateway reported them (may be empty). */
  drivers: EngDriver[];
  /** Current value of the draft ('' / undefined = not stated). */
  value: number | string | undefined;
  lang: Lang;
  disabled?: boolean;
  /** Receives the raw text: '' clears, anything else is the manager number. */
  onChange: (value: string) => void;
}

/**
 * Human label of one driver: `2 — MODBUS · running`.
 *
 * THREE states, not two: `running === undefined` means the backend could not read
 * the running set, and printing "stopped" there would call a live driver down.
 */
export function driverLabel(driver: EngDriver, lang: Lang): string {
  const type = driver.type === '' ? t(MSG.driverTypeUnknown, lang) : driver.type;
  return fmt(t(driverState(driver), lang), { n: driver.number, type });
}

/** The one of the three state sentences this driver's `running` actually supports. */
function driverState(driver: EngDriver): Ml {
  if (driver.running === undefined) return MSG.driverStateUnknown;
  return driver.running ? MSG.driverRunning : MSG.driverStopped;
}

/** The `ix-select` (or the fallback number field) plus its hint. */
export function renderDriverSelect(options: DriverSelectOptions): TemplateResult {
  const { drivers, lang, onChange } = options;
  const current = options.value === undefined || options.value === null ? UNSET : String(options.value);
  if (drivers.length === 0) {
    // A native field, not an `ix-number-input`: the latter renders an unset value as
    // `0`, and "driver 0" is a claim nobody made — the whole point of this control is
    // to state a driver number, or to state nothing.
    return html`
      <input
        class="filter mono"
        type="number"
        min="1"
        placeholder=${t(MSG.driverFree, lang)}
        ?disabled=${options.disabled === true}
        .value=${current}
        @input=${(event: Event) => onChange((event.target as HTMLInputElement).value)}
      />
    `;
  }
  // A value the list does not carry is offered as its own option rather than
  // dropped — editing an equipment must never lose what was declared before.
  const unlisted = current !== UNSET && !drivers.some((driver) => String(driver.number) === current);
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
      ${drivers.map(
        (driver) => html`<ix-select-item value=${String(driver.number)} label=${driverLabel(driver, lang)}></ix-select-item>`
      )}
      ${unlisted ? html`<ix-select-item value=${current} label=${current}></ix-select-item>` : nothing}
    </ix-select>
  `;
}

/** `ix-select` reports `string | string[]`; a single-mode select means the first. */
function firstOf(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? UNSET) : value;
}

/**
 * Advisory shown under the picker: the chosen driver's type does not match the
 * protocol. Not blocking — the DT strings of most drivers are unverified (only
 * `OPCUAC` is), so this reports a suspicion, it does not refuse a declaration.
 */
export function driverMismatchHint(
  drivers: EngDriver[],
  value: number | string | undefined,
  protocol: string,
  lang: Lang
): string | null {
  const current = value === undefined || value === null ? UNSET : String(value);
  const driver = drivers.find((candidate) => String(candidate.number) === current);
  if (!driver || driver.mode === undefined || driver.mode === protocol) return null;
  return fmt(t(MSG.driverMismatch, lang), { n: driver.number, type: driver.type, protocol });
}
