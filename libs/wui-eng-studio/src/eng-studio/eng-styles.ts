// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Layout styles for the Engineering Studio page (theme tokens in eng-theme). */
import { css } from 'lit';
import { engTheme } from './eng-theme.js';

export const engStudioStyles = [
  engTheme,
  css`
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.9rem;
      background: var(--eng-surface);
      border-bottom: 1px solid var(--eng-border);
      flex-shrink: 0;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .logo {
      font-size: 1.5rem;
    }
    .title-main {
      font-weight: 700;
    }
    .title-sub {
      font-size: 0.72rem;
      color: var(--eng-soft);
    }
    .demo-banner {
      font-size: 0.72rem;
      color: var(--eng-warn);
      border: 1px dashed var(--eng-warn);
      border-radius: var(--eng-radius);
      padding: 0.15rem 0.5rem;
    }
    .spacer {
      flex: 1;
    }
    .steps {
      display: flex;
      gap: 0.25rem;
    }
    .step {
      padding: 0.35rem 0.7rem;
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      background: transparent;
      color: var(--eng-soft);
    }
    .step.active {
      background: var(--eng-surface-2);
      color: var(--eng-text);
      border-color: var(--eng-primary);
    }
    .notice {
      padding: 0.35rem 0.9rem;
      background: var(--eng-surface-2);
      border-bottom: 1px solid var(--eng-border);
      font-size: 0.8rem;
      color: var(--eng-soft);
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
      text-align: left;
    }
    .device:hover {
      background: var(--eng-surface-2);
    }
    .device.selected {
      background: var(--eng-surface-2);
      border-left-color: var(--eng-primary);
    }
    .device-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chip.proto,
    .chip.mode,
    .chip.acc {
      font-size: 0.66rem;
      padding: 0.05rem 0.35rem;
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
      padding: 0.6rem 0.9rem;
      border-bottom: 1px solid var(--eng-border);
      flex-shrink: 0;
    }
    .panel-head h2 {
      margin: 0;
      font-size: 1rem;
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
    /* panel 1 */
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
      font-size: 0.72rem;
      max-width: 9rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    /* role qualification */
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
    select.filter {
      background: var(--eng-bg);
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      color: var(--eng-text);
      padding: 0.2rem 0.4rem;
      font: inherit;
    }
    .cb-col {
      width: 1.6rem;
      text-align: center;
    }
    .cb-col input {
      accent-color: var(--eng-primary);
      cursor: pointer;
    }
    .chip.role {
      font-weight: 600;
    }
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
    .card {
      background: var(--eng-surface);
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      padding: 0.75rem;
    }
    .card.warnings,
    .card.report {
      margin: 0 0.9rem 0.9rem;
    }
    .card-title {
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
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
    .warn-text {
      color: var(--eng-warn);
      font-size: 0.8rem;
      padding: 0 0.9rem;
    }
    .card.warnings ul {
      margin: 0;
      padding-left: 1.1rem;
      color: var(--eng-warn);
      font-size: 0.8rem;
    }
    /* panel 2 */
    .split2 {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 22rem 1fr;
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
      min-width: 0;
      background: var(--eng-bg);
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      color: var(--eng-text);
      padding: 0.2rem 0.4rem;
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
    .gen-row .filter {
      flex: 1;
      min-width: 0;
    }
    .gen-btn {
      margin-top: 0.35rem;
      width: 100%;
      justify-content: center;
    }
    /* Online OPC UA browse form (Devices panel). */
    .browse-row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.5rem;
      margin-bottom: 0.4rem;
    }
    .browse-row label {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      font-size: 0.7rem;
      color: var(--eng-soft);
    }
    .browse-row input,
    .browse-row select {
      background: var(--eng-bg);
      color: var(--eng-text);
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      padding: 0.2rem 0.4rem;
      font-size: 0.78rem;
      font-family: inherit;
      min-width: 11rem;
    }
    .gen-hint,
    .gen-warnings {
      font-size: 0.72rem;
      margin: 0.4rem 0 0;
    }
    .warn-inline {
      color: var(--eng-warn);
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
    table.grid {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    table.grid th,
    table.grid td {
      text-align: left;
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--eng-border);
      white-space: nowrap;
    }
    table.grid th {
      position: sticky;
      top: 0;
      background: var(--eng-surface-2);
      color: var(--eng-soft);
      font-weight: 600;
      z-index: 1;
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
    .soft {
      color: var(--eng-soft);
    }
    table.grid.compact td {
      padding: 0.2rem 0.5rem;
    }
    /* panel 3 */
    .diff-summary {
      display: flex;
      gap: 0.4rem;
      padding: 0.6rem 0.9rem;
    }
    .conflict-row {
      background: color-mix(in srgb, var(--eng-alarm) 12%, transparent);
    }
    .report {
      margin-top: 0.5rem;
    }
  `
];
