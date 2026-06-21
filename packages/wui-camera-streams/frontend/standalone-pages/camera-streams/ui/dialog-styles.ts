/** Camera-streams dialog styles: shared core + this page's panel width. */
import { css, type CSSResult } from 'lit';
import { dialogCore } from '../_kit/ui/dialog-styles.js';

export function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 640px;
    }
  `;
}
