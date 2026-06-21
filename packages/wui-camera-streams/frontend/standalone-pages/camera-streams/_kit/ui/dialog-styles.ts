/**
 * Shared modal-dialog styles (overlay + panel + form grid) for the standalone
 * pages' dialogs. `dialogCore()` is the page-agnostic core WITHOUT a fixed panel
 * width — each page composes it and appends its own `.panel { width: … }` (and
 * any page-specific extras), e.g.
 *
 *   export function dialogStyles(): CSSResult {
 *     return css`${dialogCore()} .panel { width: 640px; }`;
 *   }
 */
import { css, type CSSResult } from 'lit';

// eslint-disable-next-line max-lines-per-function -- single shared stylesheet literal
export function dialogCore(): CSSResult {
  return css`
    :host {
      color: var(--theme-color-std-text);
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .panel {
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      max-width: 96vw;
      max-height: 92vh;
      display: flex;
      flex-direction: column;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .panel-body {
      padding: 1rem;
      overflow-y: auto;
    }
    .panel-foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
    .grid3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .field > label {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .subhead {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      margin: 1rem 0 0.5rem;
      color: var(--theme-color-soft-text);
    }
    .subhead .grow {
      flex: 1;
    }
    .hint {
      font-size: 0.82rem;
      color: var(--theme-color-soft-text);
      margin: 0.25rem 0 0.5rem;
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.6rem 0.75rem;
      margin-bottom: 0.5rem;
      background: var(--theme-color-1);
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .card-title {
      font-weight: 600;
    }
    .spacer {
      flex: 1;
    }
    .row-actions {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
  `;
}
