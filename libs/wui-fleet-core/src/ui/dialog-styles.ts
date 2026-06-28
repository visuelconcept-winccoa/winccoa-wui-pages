// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Fleet-core dialog styles: shared kit core + panel width (used by mf-stop-causes). */
import { css, type CSSResult } from 'lit';
import { dialogCore } from '@visuelconcept/wui-kit/ui/dialog-styles.js';

export function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 640px;
    }
  `;
}
