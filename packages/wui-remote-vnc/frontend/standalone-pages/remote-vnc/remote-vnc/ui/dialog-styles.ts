/** Remote-VNC dialog styles: shared core + this page's panel width. */
import { css, type CSSResult } from 'lit';
import { dialogCore } from '../../_vendor/wui-kit/ui/dialog-styles.js';

export function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 640px;
    }
    .subhead {
      font-weight: 600;
      margin: 1rem 0 0.5rem;
      color: var(--theme-color-soft-text);
    }
  `;
}
