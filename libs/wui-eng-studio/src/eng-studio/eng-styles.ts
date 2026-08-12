// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layout of the Engineering Studio page. The iX core stylesheet, the `--eng-*`
 * token aliases and the primitives shared with the sub-elements live in
 * `eng-theme.ts`; this file only places the page's own regions.
 */
import { css } from 'lit';
import { engTheme } from './eng-theme.js';

export const engStudioStyles = [
  engTheme,
  css`
    /* --- top bar + tabs ---------------------------------------------------- */
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding-right: 0.9rem;
      border-bottom: 1px solid var(--eng-border);
      flex-shrink: 0;
    }
    .topbar wui-content-header {
      min-width: 0;
    }
    .lang-picker {
      width: 6.5rem;
      flex-shrink: 0;
    }
    ix-tabs {
      flex-shrink: 0;
      padding: 0 0.5rem;
      border-bottom: 1px solid var(--eng-border);
    }
    .notice {
      display: block;
      flex-shrink: 0;
      margin: 0.5rem 0.9rem 0;
    }
    .body {
      flex: 1;
      min-height: 0;
      display: flex;
    }
    .rail {
      width: 16rem;
      flex-shrink: 0;
      background: var(--eng-surface);
      border-right: 1px solid var(--eng-border);
      display: flex;
      flex-direction: column;
      overflow: auto;
    }
    .rail-head {
      padding: 0.6rem 0.75rem 0.35rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--eng-soft);
    }
    .device {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      width: 100%;
      padding: 0.5rem 0.75rem;
      border: none;
      border-left: 2px solid transparent;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .device:hover {
      background: var(--eng-hover);
    }
    .device.selected {
      background: var(--eng-selected);
      border-left-color: var(--eng-primary);
    }
    .device-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rail-foot {
      padding: 0.6rem 0.75rem;
      margin-top: auto;
    }
    .panel {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.5rem 0.9rem;
      border-bottom: 1px solid var(--eng-border);
      flex-shrink: 0;
    }
    .panel-head h2 {
      margin: 0;
      font-size: 1rem;
    }
    .empty-action {
      margin-top: 0.75rem;
    }

    /* --- panel 1: devices + books ------------------------------------------ */
    .panel-scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    .device-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      padding: 0.9rem;
    }
    .book-tabs {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.75rem 0.9rem 0.25rem;
    }
    .book-tabs-label {
      color: var(--eng-soft);
      font-size: 0.8rem;
    }
    .book-tab {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.55rem;
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      background: var(--eng-surface);
      color: var(--eng-soft);
      font: inherit;
      cursor: pointer;
    }
    .book-tab:hover {
      border-color: var(--eng-primary);
    }
    .book-tab.active {
      background: var(--eng-surface-2);
      color: var(--eng-text);
      border-color: var(--eng-primary);
    }
    .book-tab-name {
      font-weight: 600;
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .browser-books {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--eng-border);
    }
    .mini-tab {
      padding: 0.2rem 0.45rem;
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      background: transparent;
      color: var(--eng-soft);
      font: inherit;
      font-size: 0.72rem;
      max-width: 9rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .mini-tab.active {
      background: var(--eng-surface-2);
      color: var(--eng-text);
      border-color: var(--eng-primary);
    }
    .card.signals {
      margin: 0 0.9rem 0.9rem;
      padding: 0;
    }
    .signals-head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid var(--eng-border);
    }
    .signals-head .card-title {
      margin: 0;
    }
    .signals-head .filter {
      flex: 1;
      max-width: 22rem;
    }
    .signals-count {
      font-size: 0.75rem;
    }
    .signals-scroll {
      overflow: auto;
    }
    .addr-cell {
      white-space: normal;
    }
    .card.warnings,
    .card.report {
      margin: 0 0.9rem 0.9rem;
    }
    .warn-text {
      padding: 0 0.9rem;
    }
    .card.warnings .warn-text {
      padding: 0;
    }

    /* --- role qualification bar ------------------------------------------- */
    .role-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      border-bottom: 1px solid var(--eng-border);
      font-size: 0.8rem;
    }
    .role-filter {
      max-width: 12rem;
    }
    .cb-col {
      width: 1.6rem;
      text-align: center;
    }
    /* The role chip AS a button: click-to-edit (see renderRoleCell). It must still
       look exactly like the chip it replaces, so only the affordance is added. */
    .chip.role-tag {
      cursor: pointer;
      font: inherit;
      font-size: 0.6875rem;
      font-weight: 600;
    }
    .chip.role-tag:hover:not(:disabled) {
      background: var(--eng-hover);
    }
    .chip.role-tag:disabled {
      cursor: default;
    }
    /* The picker that replaces it, sized so the row height does not jump. */
    select.role-cell {
      max-width: 9rem;
      padding-top: 0;
      padding-bottom: 0;
      height: 1.4rem;
      font-size: 0.72rem;
    }
    /* Per-row "hide this signal": a bare glyph, because the grid has one per row and
       an ix-icon-button there would be thousands of Stencil components. */
    .row-hide {
      border: none;
      background: transparent;
      color: var(--eng-weak);
      font: inherit;
      cursor: pointer;
      padding: 0;
    }
    .row-hide:hover:not(:disabled) {
      color: var(--eng-alarm);
    }
    .row-hide:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    td.unit {
      color: var(--eng-primary);
      font-family: 'Cascadia Code', 'Consolas', monospace;
      font-size: 0.76rem;
    }
    .addr-line {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.05rem 0;
    }
    .addr-line code {
      color: var(--eng-text);
    }
    td.comment {
      white-space: normal;
      max-width: 18rem;
    }

    /* --- device / catalogue forms ----------------------------------------- */
    .eng-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.9rem;
      max-width: 46rem;
    }

    /* --- online browse form ----------------------------------------------- */
    .browse-row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.5rem;
      margin-bottom: 0.4rem;
    }
    .browse-row ix-input,
    .browse-row ix-select {
      min-width: 11rem;
    }

    /* --- panel 3: model (composer + generated grid) ----------------------- */
    .split2 {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 22rem 1fr;
    }
    /* The composition column carries a form AND the structure tree, so it takes the
       width the equipment rail and the old entries browser used to eat. */
    .split2.model {
      grid-template-columns: minmax(28rem, 38%) 1fr;
    }
    .composer {
      min-width: 0;
    }
    .composer-scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 0.6rem;
    }
    .composer .gen-row span {
      width: 7rem;
    }
    .browser {
      border-right: 1px solid var(--eng-border);
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--eng-surface);
    }
    .browser-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.6rem;
      border-bottom: 1px solid var(--eng-border);
      font-size: 0.8rem;
    }
    .filter {
      flex: 1;
    }
    .browser-list {
      flex: 1;
      overflow: auto;
      min-height: 0;
    }
    .book-entry {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.6rem;
      border-bottom: 1px solid var(--eng-border);
    }
    .be-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .be-path {
      font-size: 0.78rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .be-comment {
      font-size: 0.68rem;
      color: var(--eng-soft);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .browser-foot {
      padding: 0.35rem 0.6rem;
      border-top: 1px solid var(--eng-border);
      font-size: 0.72rem;
      color: var(--eng-soft);
    }
    .generator {
      border-top: 1px solid var(--eng-border);
      padding: 0.5rem 0.6rem 0.6rem;
      background: var(--eng-surface-2);
      flex-shrink: 0;
    }
    .gen-title {
      font-weight: 600;
      font-size: 0.8rem;
      margin-bottom: 0.4rem;
    }
    .gen-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.25rem;
      font-size: 0.75rem;
    }
    .gen-row span {
      color: var(--eng-soft);
      width: 6rem;
      flex-shrink: 0;
    }
    .gen-row ix-input,
    .gen-row ix-select,
    .gen-row .filter {
      flex: 1;
      min-width: 0;
    }
    .gen-btn {
      margin-top: 0.35rem;
      display: block;
    }
    /* Custom structure + mapping (generation form). */
    .gen-structure {
      margin: 0.35rem 0;
      padding: 0.4rem;
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      background: var(--eng-bg);
    }
    .gen-sub {
      font-size: 0.68rem;
      color: var(--eng-soft);
      margin-bottom: 0.25rem;
    }
    textarea.outline {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      background: var(--eng-field-bg);
      color: var(--eng-text);
      border: 1px solid var(--eng-field-bdr);
      border-radius: var(--eng-radius);
      padding: 0.3rem 0.4rem;
      font-family: 'Cascadia Code', 'Consolas', monospace;
      font-size: 0.72rem;
      line-height: 1.4;
    }
    .gen-map-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
      margin: 0.35rem 0 0.25rem;
      font-size: 0.7rem;
      color: var(--eng-soft);
    }
    .map-table {
      max-height: 14rem;
      overflow: auto;
    }
    .map-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.12rem 0;
      font-size: 0.72rem;
    }
    .map-leaf {
      flex: 0 0 9rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .map-row .filter {
      flex: 1;
      min-width: 0;
      font-size: 0.7rem;
    }
    .gen-hint,
    .gen-warnings {
      font-size: 0.72rem;
      margin: 0.4rem 0 0;
    }
    .gen-warnings {
      padding-left: 1rem;
      color: var(--eng-warn);
      max-height: 7rem;
      overflow: auto;
    }
    .grid-wrap {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
    }
    .grid-head-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--eng-border);
      font-size: 0.82rem;
    }
    .grid-scroll,
    .diff-scroll {
      flex: 1;
      overflow: auto;
      min-height: 0;
    }
    table.grid td.dpe {
      font-size: 0.76rem;
    }
    table.grid td.addr {
      max-width: 20rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    td.live {
      color: var(--eng-primary);
    }

    /* --- panel 4: control ------------------------------------------------- */
    .checkin-why {
      max-width: 34rem;
      text-align: right;
    }
    .diff-summary {
      display: flex;
      gap: 0.4rem;
      padding: 0.6rem 0.9rem;
    }
    .conflict-row {
      background: color-mix(in srgb, var(--eng-alarm) 12%, transparent);
    }
    /* The plan's own warnings, read BEFORE acting on the rows they talk about. */
    .plan-warnings {
      margin: 0 0.9rem 0.5rem;
    }
    /* Workspace housekeeping: the row picker and its one action. */
    .forget-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0 0.9rem 0.5rem;
    }
    .forget-bar .soft {
      max-width: 46rem;
    }
    table.grid th.pick,
    table.grid td.pick {
      width: 1.6rem;
      padding-right: 0;
    }
    .report {
      margin-top: 0.5rem;
    }
  `
];
