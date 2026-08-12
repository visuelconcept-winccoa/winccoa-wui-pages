// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared base styles of the Engineering Studio — the Siemens iX design system.
 *
 * Three layers, in this order:
 *   1. {@link IXCoreStyles} — the iX core stylesheet, inlined into the shadow root
 *      so typography, the reset and the utility classes are the ones every other
 *      page of the suite uses;
 *   2. the `--eng-*` aliases below, each mapped onto the iX theme token that
 *      carries the same MEANING (surface, soft border, weak text, alarm…) — the
 *      page never states a colour of its own;
 *   3. the primitives the studio's dense screens need and iX has no component for
 *      (a pill inside a table cell, a monospace address, a sticky grid header).
 *
 * The `--theme-*` tokens are defined at DOCUMENT level by the iX theme (the shell
 * applies it; the offline demo loads it in `demo/main.ts`) and inherit into the
 * shadow root. The dark fallbacks are kept deliberately: they are what renders
 * during the very first paint, and they document which token each alias means.
 *
 * WHY hand-written pills and tables rather than `ix-chip` / `ix-table` here: the
 * signal grid draws one row per DPE — thousands on a real project, each with two
 * to four status pills. That is tens of thousands of Stencil components, and the
 * page's whole point is bulk editing. So: iX components everywhere the count is
 * bounded (chrome, forms, actions, cards, messages), iX-shaped CSS inside the
 * grids. The pill geometry below is iX's own (1.25 rem tall, `border-radius:
 * 100px`, read from `pill.css`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { css } from 'lit';

/** The `--eng-*` aliases + the primitives, WITHOUT the iX core stylesheet. */
export const engTokens = css`
  :host {
    --eng-bg: var(--theme-color-1, #14161c);
    --eng-surface: var(--theme-color-2, #1c1f27);
    --eng-surface-2: var(--theme-color-3, #232732);
    --eng-surface-3: var(--theme-color-4, #2b303d);
    --eng-border: var(--theme-color-soft-bdr, #333a48);
    --eng-text: var(--theme-color-std-text, #e6e9ef);
    --eng-soft: var(--theme-color-soft-text, #97a0b4);
    --eng-weak: var(--theme-color-weak-text, #7b8598);
    --eng-hover: var(--theme-color-ghost--hover, rgba(255, 255, 255, 0.08));
    --eng-selected: var(--theme-color-ghost--selected, rgba(0, 163, 163, 0.16));
    --eng-primary: var(--theme-color-primary, #00a3a3);
    --eng-primary-contrast: var(--theme-color-primary--contrast, #06121a);
    --eng-success: var(--theme-color-success, #37b26b);
    --eng-warn: var(--theme-color-warning, #d9a441);
    --eng-alarm: var(--theme-color-alarm, #e5604d);
    --eng-radius: var(--theme-default-border-radius, 4px);
    /* iX input geometry, so the few native controls left match an ix-input. */
    --eng-field-bg: var(--theme-input--background, #14161c);
    --eng-field-bdr: var(--theme-input--border-color, #4c5566);
    --eng-field-bdr-hover: var(--theme-input--border-color--hover, #6b7688);

    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--eng-bg);
    color: var(--eng-text);
    font-size: 0.875rem;
  }
  * {
    box-sizing: border-box;
  }

  /* --- typography helpers -------------------------------------------------- */
  code,
  .mono {
    font-family: 'Cascadia Code', 'Consolas', monospace;
  }
  code {
    font-size: 0.8em;
    color: var(--eng-soft);
  }
  .soft {
    color: var(--eng-soft);
  }
  .weak {
    color: var(--eng-weak);
  }
  .small {
    font-size: 0.75rem;
  }

  /* --- pills (iX geometry, inside dense grids) ----------------------------- */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    height: 1.25rem;
    padding: 0 0.5rem;
    border: 1px solid var(--eng-border);
    border-radius: 100px;
    background: var(--theme-chip-outline--background, transparent);
    font-size: 0.6875rem;
    line-height: 1;
    color: var(--eng-soft);
    white-space: nowrap;
  }
  .chip.new,
  .chip.success {
    color: var(--eng-success);
    border-color: var(--eng-success);
  }
  .chip.update,
  .chip.warning {
    color: var(--eng-warn);
    border-color: var(--eng-warn);
  }
  .chip.delete,
  .chip.conflict {
    color: var(--eng-alarm);
    border-color: var(--eng-alarm);
  }
  .chip.primary {
    color: var(--eng-primary);
    border-color: var(--eng-primary);
  }
  .chip.proto,
  .chip.mode,
  .chip.acc {
    font-size: 0.6875rem;
    padding: 0 0.375rem;
  }
  /* Access provenance: an ASSUMED access is not evidence — make it visible. */
  .chip.acc-assumed {
    color: var(--eng-warn);
    border-color: var(--eng-warn);
  }
  .chip.acc-manual {
    color: var(--eng-primary);
    border-color: var(--eng-primary);
  }
  .chip.role {
    font-weight: 600;
  }
  /* Role colours: the four semantic tokens where the meaning matches, and three
     hues iX has no token for (a measure is not a state, and neither is an alarm). */
  .chip.role-measure {
    color: #4aa3f0;
    border-color: #4aa3f0;
  }
  .chip.role-setpoint {
    color: #9b8cf0;
    border-color: #9b8cf0;
  }
  .chip.role-command {
    color: var(--eng-primary);
    border-color: var(--eng-primary);
  }
  .chip.role-state {
    color: var(--eng-soft);
    border-color: var(--eng-border);
  }
  .chip.role-alarm {
    color: var(--eng-alarm);
    border-color: var(--eng-alarm);
  }
  .chip.role-counter {
    color: var(--eng-success);
    border-color: var(--eng-success);
  }
  .chip.role-parameter {
    color: #c0a080;
    border-color: #c0a080;
  }
  .chip.role-unknown {
    color: var(--eng-warn);
    border-color: var(--eng-warn);
    border-style: dashed;
  }

  /* --- connection state dot ------------------------------------------------ */
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }
  .dot.connected {
    background: var(--eng-success);
  }
  .dot.disconnected {
    background: var(--eng-alarm);
  }
  .dot.unknown {
    background: var(--eng-soft);
  }

  /* --- connection state LED + badge ---------------------------------------
     A LIT lamp for the two states the project actually read, and a HOLLOW one for
     the unknown state: it must not look like an answer, so it is the only variant
     with no glow and no fill. */
  .led {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
    border: 1px solid transparent;
  }
  .led.connected {
    background: var(--eng-success);
    border-color: var(--eng-success);
    box-shadow: 0 0 6px var(--eng-success);
  }
  .led.disconnected {
    background: var(--eng-alarm);
    border-color: var(--eng-alarm);
    box-shadow: 0 0 6px var(--eng-alarm);
  }
  .led.unknown {
    background: transparent;
    border-color: var(--eng-soft);
    border-style: dashed;
  }
  .state-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--eng-border);
    border-radius: 999px;
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .state-badge.connected {
    color: var(--eng-success);
    border-color: var(--eng-success);
  }
  .state-badge.disconnected {
    color: var(--eng-alarm);
    border-color: var(--eng-alarm);
  }
  .state-badge.unknown {
    color: var(--eng-soft);
    border-style: dashed;
  }

  /* --- cards (ix-card is for selectable tiles; these are plain sections) --- */
  .card {
    background: var(--eng-surface);
    border: 1px solid var(--eng-border);
    border-radius: var(--eng-radius);
    padding: 0.75rem;
  }
  .card-title {
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
  .empty {
    padding: 2rem;
    color: var(--eng-soft);
    text-align: center;
  }
  .empty.small {
    padding: 1rem;
    font-size: 0.8rem;
  }
  .empty.success {
    color: var(--eng-success);
  }
  .spacer {
    flex: 1;
  }

  /* --- key/value table of a detail card ----------------------------------- */
  table.kv {
    width: 100%;
    border-collapse: collapse;
  }
  table.kv td {
    padding: 0.2rem 0.35rem;
    border-bottom: 1px solid var(--eng-border);
    vertical-align: top;
  }
  table.kv td:first-child {
    color: var(--eng-soft);
    width: 9rem;
  }

  /* --- the dense signal / diff grid --------------------------------------- */
  table.grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    background: var(--theme-table--background, transparent);
  }
  table.grid th,
  table.grid td {
    text-align: left;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--theme-table-data-cell--border-color, var(--eng-border));
    white-space: nowrap;
  }
  table.grid th {
    position: sticky;
    top: 0;
    background: var(--theme-table-header-cell--background, var(--eng-surface-2));
    color: var(--eng-soft);
    font-weight: 600;
    z-index: 1;
  }
  table.grid tbody tr:hover td {
    background: var(--theme-table-data-row--background--hover, var(--eng-hover));
  }
  table.grid.compact td {
    padding: 0.2rem 0.5rem;
  }

  /* --- warnings ----------------------------------------------------------- */
  .warn-text,
  .warn-inline {
    color: var(--eng-warn);
  }
  .warn-text {
    font-size: 0.8rem;
  }
  .card.warnings ul {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--eng-warn);
    font-size: 0.8rem;
  }

  /* --- form rows (label + iX control) ------------------------------------- */
  .form-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.4rem;
    font-size: 0.8rem;
  }
  .form-row > span:first-child {
    width: 12rem;
    flex-shrink: 0;
    color: var(--eng-soft);
  }
  .form-row ix-input,
  .form-row ix-number-input,
  .form-row ix-select {
    flex: 1;
    min-width: 0;
    max-width: 22rem;
  }
  .form-hint {
    font-size: 0.75rem;
    color: var(--eng-soft);
    margin-bottom: 0.5rem;
  }
  .form-hint.danger {
    color: var(--eng-alarm);
    border: 1px solid var(--eng-alarm);
    border-radius: var(--eng-radius);
    padding: 0.4rem 0.6rem;
    margin-bottom: 0;
  }
  .box-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
  }
  .box {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
    max-width: 22rem;
  }
  /* Ellipsis has to live on the TEXT, not on the flex label — otherwise a long
     name pushes its pills out of the box instead of being truncated. */
  .box-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* --- the few native controls left (one per grid ROW: see the header) ---- */
  input.filter,
  select.filter,
  textarea.filter {
    min-width: 0;
    background: var(--eng-field-bg);
    border: 1px solid var(--eng-field-bdr);
    border-radius: var(--eng-radius);
    color: var(--eng-text);
    padding: 0.25rem 0.4rem;
    font: inherit;
    font-size: 0.8125rem;
  }
  input.filter:hover,
  select.filter:hover,
  textarea.filter:hover {
    border-color: var(--eng-field-bdr-hover);
  }
  input.filter:focus-visible,
  select.filter:focus-visible,
  textarea.filter:focus-visible {
    outline: 1px solid var(--eng-primary);
    outline-offset: -1px;
    border-color: var(--eng-primary);
  }
  input[type='checkbox'] {
    accent-color: var(--eng-primary);
    cursor: pointer;
  }
`;

/** iX core stylesheet + the studio's own base — what every element extends. */
export const engTheme = [IXCoreStyles, engTokens];
