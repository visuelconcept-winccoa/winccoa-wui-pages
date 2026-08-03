// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared styles for the studio. Uses the runtime's `--theme-*` custom
 * properties WITH dark fallbacks, so the page themes correctly inside the
 * WinCC OA shell AND renders standalone (demo / screenshots) with no runtime.
 */
import { css } from 'lit';

export const engTheme = css`
  :host {
    --eng-bg: var(--theme-color-1, #14161c);
    --eng-surface: var(--theme-color-2, #1c1f27);
    --eng-surface-2: var(--theme-color-3, #232732);
    --eng-border: var(--theme-color-soft-bdr, #333a48);
    --eng-text: var(--theme-color-std-text, #e6e9ef);
    --eng-soft: var(--theme-color-soft-text, #97a0b4);
    --eng-primary: var(--theme-color-primary, #00a3a3);
    --eng-primary-contrast: var(--theme-color-primary--contrast, #06121a);
    --eng-success: var(--theme-color-success, #37b26b);
    --eng-warn: var(--theme-color-warning, #d9a441);
    --eng-alarm: var(--theme-color-alarm, #e5604d);
    --eng-radius: var(--theme-default-border-radius, 4px);

    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--eng-bg);
    color: var(--eng-text);
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
  }
  * {
    box-sizing: border-box;
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--eng-border);
    border-radius: var(--eng-radius);
    background: var(--eng-surface-2);
    color: var(--eng-text);
    white-space: nowrap;
  }
  .btn:hover {
    border-color: var(--eng-primary);
  }
  .btn.primary {
    background: var(--eng-primary);
    color: var(--eng-primary-contrast);
    border-color: var(--eng-primary);
    font-weight: 600;
  }
  .btn.danger {
    border-color: var(--eng-alarm);
    color: var(--eng-alarm);
  }
  .btn.danger:hover {
    background: var(--eng-alarm);
    color: var(--eng-bg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    font-size: 0.72rem;
    border: 1px solid var(--eng-border);
    color: var(--eng-soft);
    white-space: nowrap;
  }
  .chip.new {
    color: var(--eng-success);
    border-color: var(--eng-success);
  }
  .chip.update {
    color: var(--eng-warn);
    border-color: var(--eng-warn);
  }
  .chip.delete,
  .chip.conflict {
    color: var(--eng-alarm);
    border-color: var(--eng-alarm);
  }
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
  code {
    font-family: 'Cascadia Code', 'Consolas', monospace;
    font-size: 0.8em;
    color: var(--eng-soft);
  }
  .mono {
    font-family: 'Cascadia Code', 'Consolas', monospace;
  }
`;
