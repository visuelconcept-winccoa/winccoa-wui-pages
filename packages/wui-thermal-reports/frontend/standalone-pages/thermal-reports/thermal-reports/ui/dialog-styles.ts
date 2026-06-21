/** Thermal-report dialog styles: shared core + this page's panel width. */
import { css, type CSSResult } from 'lit';
import { dialogCore } from '../../_vendor/wui-kit/ui/dialog-styles.js';

export function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 820px;
    }
  `;
}
