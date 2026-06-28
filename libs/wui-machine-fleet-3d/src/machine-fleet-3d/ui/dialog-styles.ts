// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Fleet dialog styles: shared core + this page's panel width and KPI extras. */
import { css, type CSSResult } from 'lit';
import { dialogCore } from '@visuelconcept/wui-kit/ui/dialog-styles.js';

export function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 640px;
    }
    .subhead {
      margin: 0.5rem 0;
    }
    .kpi-head {
      display: flex;
      align-items: center;
      margin: 0.25rem 0 0.5rem;
    }
    .kpi-head .spacer,
    .kpi-card-head .spacer {
      flex: 1;
    }
    .kpi-card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.6rem;
      margin-bottom: 0.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
    }
    .kpi-card-head {
      display: flex;
      align-items: center;
    }
    .kpi-card-title {
      font-weight: 600;
    }
  `;
}
