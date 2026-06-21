/** Mosaic dialog styles: shared core + this page's panel width and extras. */
import { css, type CSSResult } from 'lit';
import { dialogCore } from '@visuelconcept/wui-kit/ui/dialog-styles.js';

export function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 560px;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .panel-body {
      padding: 1rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .subhead {
      font-weight: 600;
      margin: 0.5rem 0 0.25rem;
      color: var(--theme-color-soft-text);
    }
    .hint {
      color: var(--theme-color-soft-text);
      font-size: 0.82rem;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0.2rem 0;
      font-size: 0.9rem;
    }
  `;
}
