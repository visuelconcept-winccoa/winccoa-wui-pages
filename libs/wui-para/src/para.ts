// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA page - model datapoint types and manage their instances.
 *
 * Two tabs under a shared header:
 *   - "Modèle (Types)"      -> wui-para-type-editor: an ergonomic, nested tree
 *                              editor to create/change/delete datapoint types.
 *   - "Instances & valeurs" -> the master-detail browser: wui-para-nav (Type ->
 *                              DP -> element tree) + wui-para-detail (live values
 *                              & config attributes, inline dpSet); datapoints are
 *                              created/renamed/deleted through wui-para-dp-dialog.
 *
 * An embedded AI assistant (wui-para-ai-assistant) sits in the header. It is
 * proposal-only (no MCP tools): it suggests datapoint-type models and can load a
 * proposal straight into the model editor for the user to review and save — the
 * user always validates. All mutations go through the webserver.js PARA extension.
 *
 * This file is built as a separate entry point and loaded at runtime via dynamic
 * import. Dependencies (lit, etc.) are resolved via import maps.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import './para/para-ai-assistant.js';
import type { TypeProposal } from './para/para-ai-context.js';
import { exportDpl, importDpl, pickDplFile } from './para/para-dpl.js';
import './para/para-dpl-dialog.js';
import './para/para-detail.js';
import type { DpDialogMode } from './para/para-dp-dialog.js';
import './para/para-dp-dialog.js';
import './para/para-nav.js';
import './para/para-type-editor.js';
import './para/para-archive.js';
import './para/para-alarm.js';
import {
  MSG,
  dplExportFailedMsg,
  dplExportedMsg,
  dplImportFailedMsg,
  dplImportedMsg,
  localize,
  localizeDir,
  ml
} from './para/i18n.js';

/** Tab indices (match the ix-tab-item order). */
const TAB_MODEL = 0;
const TAB_INSTANCES = 1;
const TAB_ARCHIVE = 2;
const TAB_ALARM = 3;

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
      .topbar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .topbar wui-context-generator {
        flex: 1;
        min-width: 0;
      }
      .topbar wui-para-ai-assistant {
        flex-shrink: 0;
        padding-right: 0.75rem;
      }
      .dpl-bar {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        flex-shrink: 0;
      }
      .dpl-msg {
        font-size: 0.75rem;
        max-width: 18rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dpl-msg.ok {
        color: var(--theme-color-success);
      }
      .dpl-msg.err {
        color: var(--theme-color-alarm);
      }
      ix-tabs {
        flex-shrink: 0;
        padding: 0 0.5rem;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
      }
      .tab-body {
        flex: 1;
        min-height: 0;
        display: flex;
      }
      .tab-body > * {
        flex: 1;
        min-width: 0;
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
      .hidden {
        display: none !important;
      }
    `
  ];

  @state() private activeTab = TAB_MODEL;
  @state() private selectedDp: string | null = null;
  @state() private selectedType: string | null = null;
  /** Owning DP-type of the selected DP/element (drives the detail value enumeration). */
  @state() private selectedOwnerType: string | null = null;
  @state() private selectedKey: string | null = null;
  @state() private dpDialog: { mode: DpDialogMode; typeName: string; dp: string } | null = null;
  @state() private reloadToken = 0;
  /** Type currently loaded in the model editor (for the assistant context). */
  @state() private modelTypeName: string | null = null;
  /** A model the assistant proposed, pushed into the editor as an unsaved draft. */
  @state() private editorProposal: TypeProposal | null = null;
  /** DPL export selection reported by the instances tree (DPL buttons live in the header). */
  @state() private dplSel: { dpts: string[]; dps: string[] } = { dpts: [], dps: [] };
  @state() private dplBusy = false;
  @state() private dplMsg = '';
  @state() private dplOk = false;
  @state() private dplDialogOpen = false;

  /** Application-Security grant for DPL import (open until groups are assigned). */
  @state() private roleDplImport = true;

  private roleSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles (docs/wui-app-security/INTEGRATION.md).
    // Declaration lives in the module's own app-security.roles.json fragment.
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$('para', 'dpl-import').subscribe((granted) => (this.roleDplImport = granted));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      ${this.renderTopbar()}
      <ix-tabs .selected=${this.activeTab} @selectedChange=${(e: CustomEvent<number>) => (this.activeTab = e.detail)}>
        <ix-tab-item>${localizeDir(MSG.page.tabModel)}</ix-tab-item>
        <ix-tab-item>${localizeDir(MSG.page.tabInstances)}</ix-tab-item>
        <ix-tab-item>${localizeDir(MSG.page.tabArchive)}</ix-tab-item>
        <ix-tab-item>${localizeDir(MSG.page.tabAlarm)}</ix-tab-item>
      </ix-tabs>
      ${this.renderTabBody()}
      ${this.dpDialog
        ? html`<wui-para-dp-dialog
            .mode=${this.dpDialog.mode}
            .dpType=${this.dpDialog.typeName}
            .dp=${this.dpDialog.dp}
            @wui:done=${this.onDpDialogDone}
          ></wui-para-dp-dialog>`
        : nothing}
      ${this.dplDialogOpen
        ? html`<wui-para-dpl-dialog
            .typeCount=${this.dplSel.dpts.length}
            .dpCount=${this.dplSel.dps.length}
            @wui:export=${this.onExportConfirm}
            @wui:cancel=${this.onExportCancel}
          ></wui-para-dpl-dialog>`
        : nothing}
    `;
  }

  private renderTopbar(): TemplateResult {
    return html`
      <div class="topbar">
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
        <div class="dpl-bar">
          ${this.dplMsg === '' ? nothing : html`<span class="dpl-msg ${this.dplOk ? 'ok' : 'err'}">${this.dplMsg}</span>`}
          ${this.roleDplImport
            ? html`<ix-button outline icon="upload" ?disabled=${this.dplBusy} @click=${this.doImport}>${localizeDir(MSG.page.importDpl)}</ix-button>`
            : nothing}
          <ix-button
            variant="primary"
            icon="download"
            ?disabled=${this.dplBusy || this.dplSelCount() === 0}
            .loading=${this.dplBusy}
            title=${localize(MSG.page.exportTitle)}
            @click=${this.openExportDialog}
          >
            ${localizeDir(MSG.page.exportDpl)}${this.dplSelCount() > 0 ? ` (${this.dplSelCount()})` : ''}
          </ix-button>
        </div>
        <wui-para-ai-assistant
          .contextSummary=${this.contextSummary()}
          @wui:applytype=${this.onApplyType}
        ></wui-para-ai-assistant>
      </div>
    `;
  }

  private renderTabBody(): TemplateResult {
    return html`
      <div class="tab-body">
        <wui-para-type-editor
          class=${this.activeTab === TAB_MODEL ? '' : 'hidden'}
          .reloadToken=${this.reloadToken}
          .incomingProposal=${this.editorProposal}
          @wui:typeschanged=${this.onTypesChanged}
          @wui:typeselected=${this.onTypeSelected}
        ></wui-para-type-editor>

        <div class="split ${this.activeTab === TAB_INSTANCES ? '' : 'hidden'}">
          <wui-para-nav
            .selected=${this.selectedKey}
            .reloadToken=${this.reloadToken}
            @wui:select=${this.onSelect}
            @wui:dpaction=${this.onDpAction}
            @wui:datachanged=${this.onTypesChanged}
            @wui:exportselection=${this.onExportSelection}
          ></wui-para-nav>
          <wui-para-detail
            .dp=${this.selectedDp}
            .dpType=${this.selectedType}
            .ownerType=${this.selectedOwnerType}
          ></wui-para-detail>
        </div>

        <wui-para-archive
          class=${this.activeTab === TAB_ARCHIVE ? '' : 'hidden'}
          .reloadToken=${this.reloadToken}
        ></wui-para-archive>

        <wui-para-alarm
          class=${this.activeTab === TAB_ALARM ? '' : 'hidden'}
          .reloadToken=${this.reloadToken}
        ></wui-para-alarm>
      </div>
    `;
  }

  /** Short description of the current selection, fed to the AI assistant. */
  private contextSummary(): string {
    if (this.activeTab === TAB_MODEL) {
      return this.modelTypeName == null
        ? localize(MSG.page.ctxModelNone)
        : localize(
            ml(
              `« Model » tab. Type being edited: ${this.modelTypeName}.`,
              `Onglet « Modèle ». Type en cours d'édition : ${this.modelTypeName}.`,
              `„Modell“-Tab. Bearbeiteter Typ: ${this.modelTypeName}.`
            )
          );
    }
    const parts = [localize(MSG.page.ctxInstances)];
    if (this.selectedType != null) {
      parts.push(
        localize(
          ml(`Selected type: ${this.selectedType}.`, `Type sélectionné : ${this.selectedType}.`, `Ausgewählter Typ: ${this.selectedType}.`)
        )
      );
    }
    if (this.selectedDp != null) {
      parts.push(
        localize(
          ml(
            `Selected datapoint/element: ${this.selectedDp}.`,
            `Datapoint/élément sélectionné : ${this.selectedDp}.`,
            `Ausgewählter Datenpunkt/Element: ${this.selectedDp}.`
          )
        )
      );
    }
    return parts.join(' ');
  }

  private onSelect(event: CustomEvent<{ kind: 'type' | 'dp' | 'element'; path: string; type?: string }>): void {
    const { kind, path, type } = event.detail;
    if (kind === 'type') {
      this.selectedType = path;
      this.selectedDp = null;
      this.selectedOwnerType = null;
      this.selectedKey = `type:${path}`;
    } else {
      this.selectedDp = path;
      this.selectedType = null;
      this.selectedOwnerType = type != null && type !== '' ? type : null;
      this.selectedKey = `path:${path}`;
    }
  }

  private onApplyType(event: CustomEvent<TypeProposal>): void {
    // A fresh object reference each time -> the editor (re)loads it as a draft.
    this.editorProposal = event.detail;
    this.activeTab = TAB_MODEL;
  }

  private onTypeSelected(event: CustomEvent<{ typeName: string | null }>): void {
    this.modelTypeName = event.detail.typeName;
  }

  private onTypesChanged(): void {
    // A type was created/changed/deleted: refresh the instances tree too.
    this.reloadToken += 1;
  }

  // ---- DPL import/export (header buttons; selection comes from the nav tree) ----

  private dplSelCount(): number {
    return this.dplSel.dpts.length + this.dplSel.dps.length;
  }

  private onExportSelection(event: CustomEvent<{ dpts: string[]; dps: string[] }>): void {
    this.dplSel = event.detail;
  }

  private openExportDialog(): void {
    if (this.dplSelCount() > 0) {
      this.dplDialogOpen = true;
    }
  }

  private onExportCancel(): void {
    this.dplDialogOpen = false;
  }

  private onExportConfirm(event: CustomEvent<{ filter: string }>): void {
    this.dplDialogOpen = false;
    void this.doExport(event.detail.filter);
  }

  private async doExport(filter: string): Promise<void> {
    if (this.dplSelCount() === 0) {
      return;
    }
    this.dplBusy = true;
    this.dplMsg = '';
    try {
      const result = await exportDpl({ dpts: this.dplSel.dpts, dps: this.dplSel.dps, filter });
      this.setDplMsg(
        result.ok ? dplExportedMsg(result.count ?? this.dplSelCount()) : result.error ?? dplExportFailedMsg(),
        result.ok === true
      );
    } finally {
      this.dplBusy = false;
    }
  }

  private async doImport(): Promise<void> {
    const file = await pickDplFile();
    if (file == null) {
      return;
    }
    this.dplBusy = true;
    this.dplMsg = '';
    try {
      const result = await importDpl(file);
      this.setDplMsg(
        result.ok ? result.message ?? dplImportedMsg(file.name) : result.error ?? dplImportFailedMsg(),
        result.ok === true
      );
      if (result.ok) {
        // Data changed broadly: refresh the tree + detail panel.
        this.reloadToken += 1;
      }
    } finally {
      this.dplBusy = false;
    }
  }

  private setDplMsg(message: string, ok: boolean): void {
    this.dplMsg = message;
    this.dplOk = ok;
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
