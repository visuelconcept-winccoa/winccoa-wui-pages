/** Report-builder dialog styles: shared core + this page's panel width. */
import { css, type CSSResult } from 'lit';
import { dialogCore } from '../../wui-kit/ui/dialog-styles.js';

export function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 880px;
    }
  `;
}
