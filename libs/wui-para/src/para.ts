/**
 * PARA page - browse and modify datapoints.
 *
 * A master-detail parametrization view inspired by the WinCC OA PARA module:
 * the left panel (wui-para-nav) is a Type -> DP -> branches tree, the right
 * panel (wui-para-detail) shows the selected datapoint's elements with live
 * values and inline editing (dpSet). New datapoint types can be created via a
 * dialog that calls the webserver.js PARA extension.
 *
 * This file is built as a separate entry point and loaded at runtime via
 * dynamic import. Dependencies (lit, etc.) are resolved via import maps.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import './para/para-create-type-dialog.js';
import type { DpDialogMode } from './para/para-dp-dialog.js';
import './para/para-dp-dialog.js';
import './para/para-detail.js';
import './para/para-nav.js';

export class WuiPara extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .split {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      wui-para-nav {
        width: 22rem;
        flex-shrink: 0;
      }
      wui-para-detail {
        flex: 1;
        min-width: 0;
      }
    `
  ];

  @state() private selectedDp: string | null = null;
  @state() private selectedType: string | null = null;
  @state() private selectedKey: string | null = null;
  @state() private showCreateDialog = false;
  @state() private dpDialog: { mode: DpDialogMode; typeName: string; dp: string } | null = null;
  @state() private reloadToken = 0;

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: {
              'en_US.utf8': 'Parametrization (PARA)',
              'de_AT.utf8': 'Parametrierung (PARA)'
            }
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>

      <div class="split">
        <wui-para-nav
          .selected=${this.selectedKey}
          .reloadToken=${this.reloadToken}
          @wui:select=${this.onSelect}
          @wui:create=${this.onCreate}
          @wui:dpaction=${this.onDpAction}
        ></wui-para-nav>
        <wui-para-detail .dp=${this.selectedDp} .dpType=${this.selectedType}></wui-para-detail>
      </div>

      ${this.showCreateDialog
        ? html`<wui-para-create-type-dialog @wui:done=${this.onCreateDone}></wui-para-create-type-dialog>`
        : nothing}
      ${this.dpDialog
        ? html`<wui-para-dp-dialog
            .mode=${this.dpDialog.mode}
            .dpType=${this.dpDialog.typeName}
            .dp=${this.dpDialog.dp}
            @wui:done=${this.onDpDialogDone}
          ></wui-para-dp-dialog>`
        : nothing}
    `;
  }

  private onSelect(event: CustomEvent<{ kind: 'type' | 'dp' | 'element'; path: string }>): void {
    const { kind, path } = event.detail;
    if (kind === 'type') {
      this.selectedType = path;
      this.selectedDp = null;
      this.selectedKey = `type:${path}`;
    } else {
      this.selectedDp = path;
      this.selectedType = null;
      this.selectedKey = `path:${path}`;
    }
  }

  private onCreate(): void {
    this.showCreateDialog = true;
  }

  private onCreateDone(event: CustomEvent<{ created: boolean }>): void {
    this.showCreateDialog = false;
    if (event.detail.created) {
      this.reloadToken += 1;
    }
  }

  private onDpAction(event: CustomEvent<{ mode: DpDialogMode; typeName: string; dp: string }>): void {
    const { mode, typeName, dp } = event.detail;
    this.dpDialog = { mode, typeName, dp };
  }

  private onDpDialogDone(event: CustomEvent<{ changed: boolean }>): void {
    const removed = this.dpDialog?.mode === 'create' ? null : this.dpDialog?.dp;
    this.dpDialog = null;
    if (event.detail.changed) {
      // Clear a selection that points at a now-renamed/deleted datapoint.
      if (removed != null && this.selectedDp === removed) {
        this.selectedDp = null;
        this.selectedKey = null;
      }
      this.reloadToken += 1;
    }
  }
}

if (!customElements.get('wui-para')) {
  customElements.define('wui-para', WuiPara);
}
