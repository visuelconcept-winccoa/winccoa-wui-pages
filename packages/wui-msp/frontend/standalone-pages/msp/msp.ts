/**
 * MSP — Standalone page (WinCC OA WebUI Runtime).
 *
 * Hosts the SPC (Statistical Process Control) multi-parameter dashboard demo.
 *
 * The dashboard is the self-contained prototype `dashboard_parameters.html`
 * (Chart.js control charts: X / moving-range, control & tolerance limits,
 * alarms, live streaming). It is a large vanilla-JS + Chart.js app with heavy
 * global `document`/`window` usage, so it is served as a static asset under
 * `data/dashboard-wc/msp/` and embedded here via an `<iframe>` to fully isolate
 * its globals and CSS from the iX app shell.
 *
 * For now it runs in **demo mode**: with no WinCC OA CTL data pushed in, the
 * prototype auto-loads its built-in demo dataset and starts the live stream —
 * NO datapoint connection. Replacing the demo data with live datapoints is a
 * later step.
 *
 * This file is built as a separate entry point (auto-discovered by build:pages)
 * and loaded at runtime via dynamic import; dependencies resolve via import maps.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';

/** URL of the embedded SPC dashboard prototype (static asset served by the backend). */
const SPC_DASHBOARD_URL = '/data/dashboard-wc/msp/dashboard_parameters.html';

export class WuiMsp extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'MSP',
                'fr': 'MSP',
                'de_AT.utf8': 'MSP'
              }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          <iframe
            class="spc-frame"
            src=${SPC_DASHBOARD_URL}
            title="SPC Parameters Dashboard"
            loading="lazy"
          ></iframe>
        </div>
      </div>
    `;
  }
}

if (!customElements.get('wui-msp')) {
  customElements.define('wui-msp', WuiMsp);
}

function pageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
    }
    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .body {
      display: flex;
      flex: 1;
      min-height: 0;
      padding: 0 1rem 1rem;
    }
    .spc-frame {
      flex: 1;
      width: 100%;
      height: 100%;
      border: none;
      border-radius: var(--theme-default-border-radius);
      background: #05080f;
    }
  `;
}
