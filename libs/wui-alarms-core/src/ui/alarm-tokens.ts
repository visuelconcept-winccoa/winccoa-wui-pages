// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Severity presentation, shared by every part of the alarm view.
 *
 * The band colours are iX theme tokens behind `--wui-alarm-severity-*` custom
 * properties, so a host can re-map a band without touching the components. The
 * per-alarm colour that WinCC OA returns (`Alarm.color`) always wins where an
 * individual alarm is drawn: the project configured it, we display it.
 */
import { css } from 'lit';
import type { Severity } from '../types.js';

/** `--wui-alarm-severity-<n>` defaults + the pill / tint helpers. */
export function severityTokens(): ReturnType<typeof css> {
  return css`
    :host {
      --wui-alarm-severity-1: var(--theme-color-alarm);
      --wui-alarm-severity-2: var(--theme-color-warning);
      --wui-alarm-severity-3: var(--theme-color-information);
      --wui-alarm-severity-4: var(--theme-color-soft-text);
    }
    .pill {
      display: inline-block;
      border-radius: 0.125rem;
      padding: 0 0.25rem;
      font-size: 0.625rem;
      font-weight: 700;
      line-height: 1.4;
      color: var(--theme-color-1);
      white-space: nowrap;
    }
    .sev-1 {
      background: var(--wui-alarm-severity-1);
    }
    .sev-2 {
      background: var(--wui-alarm-severity-2);
    }
    .sev-3 {
      background: var(--wui-alarm-severity-3);
    }
    .sev-4 {
      background: var(--wui-alarm-severity-4);
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .mono {
      font-family: var(--theme-font-family-monospace, ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
    }
    .grow {
      flex: 1;
    }
    .ell {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
}

/** The CSS colour of a severity band (for inline styles). */
export function severityVar(severity: Severity): string {
  return `var(--wui-alarm-severity-${severity})`;
}

/** The colour to draw one alarm with: the project's own, else its band. */
export function alarmColor(alarm: { color: string; severity: Severity }): string {
  return alarm.color === '' ? severityVar(alarm.severity) : alarm.color;
}
