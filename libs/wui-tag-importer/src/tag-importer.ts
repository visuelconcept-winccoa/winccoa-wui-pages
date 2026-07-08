// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tag Importer — standalone WinCC OA WebUI page.
 *
 * Imports device tags into WinCC OA datapoint types + datapoints, from two
 * sources behind one protocol-agnostic pipeline (extensible to other protocols):
 *  - an OPC UA **NodeSet2 XML** file (parsed in the browser): every ObjectType
 *    becomes a DPType and its repeated instances become datapoints (structure
 *    mutualisation);
 *  - a **live OPC UA server** (browsed via the backend): a selected instance's
 *    subtree becomes a DPType, the instance (+ optional siblings) become
 *    datapoints, and the OPC UA peripheral address configs are written too.
 *
 * The source adapters produce a protocol-neutral model (`core/model`); the
 * `DpTypeGenerator` (`core/generate`) turns it into a serializable ImportPlan
 * applying the HYBRID typeref policy; a dry-run preview always precedes the
 * write. Sensitive operations are gated by Application Security roles
 * ('import-file' / 'browse' / 'create'), ENFORCED server-side on /api/tag-importer.
 *
 * Backend: `/api/tag-importer` (customer-webserver) → WsjServerGlobal.winccoa
 * (dpTypeCreate / dpCreate / dpSetWait + OPC UA `Browse.GetBranch`). No manager.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import appSecurityRoles from './app-security.roles.json';
import type { TagModel } from './tag-importer/core/model.js';
import type { ApplyResult, ImportPlan } from './tag-importer/core/plan.js';
import { summarize } from './tag-importer/core/plan.js';
import { analyzeTypes, buildPlan, type GenerateOptions, type TypeDecision } from './tag-importer/core/generate.js';
import { DEFAULT_POLL_GROUP } from './tag-importer/core/opcua-mapping.js';
import { parseNodeSet } from './tag-importer/adapters/opcua-nodeset.js';
import { buildOnlineModel, type OnlineNodeRef } from './tag-importer/adapters/opcua-online.js';
import { apply as applyPlan, browse, listConnections, type Connection } from './tag-importer/data/api.js';
import { MSG, confirmApplyMsg, localize, localizeDir } from './tag-importer/i18n.js';
import './tag-importer/ui/ti-source.js';
import './tag-importer/ui/ti-browse-tree.js';
import './tag-importer/ui/ti-review.js';
import './tag-importer/ui/ti-result.js';

const MODULE_ID = 'tag-importer';
type Step = 'source' | 'select' | 'review' | 'result';
type Mode = 'file' | 'online' | '';

export class WuiTagImporter extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private step: Step = 'source';
  @state() private mode: Mode = '';
  @state() private connections: Connection[] = [];
  @state() private connection = '';
  @state() private model: TagModel | null = null;
  @state() private plan: ImportPlan | null = null;
  @state() private decisions: TypeDecision[] = [];
  @state() private typePrefix = '';
  @state() private hybrid = true;
  @state() private busy = false;
  @state() private error = '';
  @state() private confirmOpen = false;
  @state() private dryRunResult: ApplyResult | null = null;
  @state() private applyResult: ApplyResult | null = null;
  // online selection
  @state() private primary: OnlineNodeRef | null = null;
  @state() private parentNodeId = '';
  @state() private includeSiblings = false;
  // roles (open by default until an admin assigns groups)
  @state() private roleImportFile = true;
  @state() private roleBrowse = true;
  @state() private roleCreate = true;

  private readonly forceKeep = new Set<string>();
  private readonly forceInline = new Set<string>();
  private permSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.permSub.add(hasRole$(MODULE_ID, 'import-file').subscribe((g) => (this.roleImportFile = g)));
    this.permSub.add(hasRole$(MODULE_ID, 'browse').subscribe((g) => (this.roleBrowse = g)));
    this.permSub.add(hasRole$(MODULE_ID, 'create').subscribe((g) => (this.roleCreate = g)));
    void this.loadConnections();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.permSub.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Tag Importer', fr: 'Importateur de tags', 'de_AT.utf8': 'Tag-Import' }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          ${this.renderStepper()}
          ${this.error ? html`<ix-message-bar type="alert" @closed=${() => (this.error = '')}>${this.error}</ix-message-bar>` : nothing}
          <div class="step">${this.renderStep()}</div>
        </div>
      </div>
      ${this.confirmOpen && this.plan
        ? html`<wui-confirm-dialog
            message=${confirmApplyMsg(summarize(this.plan).typesNew, summarize(this.plan).dpsNew, this.plan.addresses.length)}
            @wui:confirm=${() => void this.onApplyConfirmed()}
            @wui:cancel=${() => (this.confirmOpen = false)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  private async loadConnections(): Promise<void> {
    try {
      this.connections = await listConnections();
    } catch {
      this.connections = [];
    }
  }

  private currentOptions(): GenerateOptions {
    return {
      typePrefix: this.typePrefix,
      hybrid: this.hybrid,
      forceKeep: this.forceKeep,
      forceInline: this.forceInline,
      connection: this.model?.source === 'opcua-online' ? this.connection : undefined,
      pollGroup: DEFAULT_POLL_GROUP
    };
  }

  private recompute(): void {
    // A regenerated plan invalidates any previous dry-run preview.
    this.dryRunResult = null;
    if (!this.model) {
      this.plan = null;
      this.decisions = [];
      return;
    }
    const opts = this.currentOptions();
    this.plan = buildPlan(this.model, opts);
    this.decisions = analyzeTypes(this.model, opts);
  }

  // --- step 1: source ---------------------------------------------------------

  private onMode(mode: Mode): void {
    this.mode = mode;
    this.error = '';
  }

  private onFile(detail: { name: string; text: string }): void {
    const { model, error } = parseNodeSet(detail.text);
    if (error || !model) {
      this.error = error ?? localize(MSG.file.parseError);
      return;
    }
    this.error = '';
    this.model = model;
    this.recompute();
    this.step = 'review';
  }

  private onConnection(name: string): void {
    this.connection = name;
    this.primary = null;
    this.parentNodeId = '';
    this.step = 'select';
  }

  // --- step 2: online selection ----------------------------------------------

  private onSelection(detail: { primary: OnlineNodeRef; parentNodeId: string }): void {
    this.primary = detail.primary;
    this.parentNodeId = detail.parentNodeId;
  }

  private async buildOnline(): Promise<void> {
    if (!this.primary) return;
    this.busy = true;
    this.error = '';
    try {
      const siblings = await this.resolveSiblings();
      this.model = await buildOnlineModel({ connection: this.connection, primary: this.primary, siblings });
      this.recompute();
      this.step = 'review';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  /** Same-level Object siblings of the primary instance (when the option is on). */
  private async resolveSiblings(): Promise<OnlineNodeRef[]> {
    if (!this.includeSiblings || !this.primary) return [];
    try {
      const nodes = await browse(this.connection, this.parentNodeId || undefined);
      return nodes
        .filter((n) => n.nodeId !== this.primary?.nodeId && !n.nodeClass.includes('Variable') && !n.nodeClass.includes('Method'))
        .map((n) => ({ nodeId: n.nodeId, displayName: n.displayName }));
    } catch {
      return [];
    }
  }

  // --- step 3: review ---------------------------------------------------------

  private onPrefix(value: string): void {
    this.typePrefix = value;
    this.recompute();
  }

  private onHybrid(value: boolean): void {
    this.hybrid = value;
    this.recompute();
  }

  private onTypeOverride(detail: { id: string; keep: boolean }): void {
    if (detail.keep) {
      this.forceKeep.add(detail.id);
      this.forceInline.delete(detail.id);
    } else {
      this.forceInline.add(detail.id);
      this.forceKeep.delete(detail.id);
    }
    this.recompute();
  }

  private async onDryRun(): Promise<void> {
    if (!this.plan) return;
    this.busy = true;
    this.error = '';
    try {
      this.dryRunResult = await applyPlan(this.plan, true);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  private async onApplyConfirmed(): Promise<void> {
    this.confirmOpen = false;
    if (!this.plan) return;
    this.busy = true;
    this.error = '';
    try {
      this.applyResult = await applyPlan(this.plan, false);
      this.step = 'result';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  private reset(): void {
    this.step = 'source';
    this.mode = '';
    this.model = null;
    this.plan = null;
    this.decisions = [];
    this.typePrefix = '';
    this.hybrid = true;
    this.forceKeep.clear();
    this.forceInline.clear();
    this.primary = null;
    this.parentNodeId = '';
    this.includeSiblings = false;
    this.dryRunResult = null;
    this.applyResult = null;
    this.error = '';
  }

  private renderStepper(): TemplateResult {
    const steps: { id: Step; label: typeof MSG.steps.source }[] = [
      { id: 'source', label: MSG.steps.source },
      { id: 'select', label: MSG.steps.select },
      { id: 'review', label: MSG.steps.review },
      { id: 'result', label: MSG.steps.apply }
    ];
    const order: Step[] = ['source', 'select', 'review', 'result'];
    const current = order.indexOf(this.step);
    return html`<div class="stepper">
      ${steps.map((s, i) => {
        // The "select" step only applies to the online source.
        const skipped = s.id === 'select' && this.mode !== 'online';
        return html`<div class="crumb ${order.indexOf(s.id) === current ? 'active' : ''} ${order.indexOf(s.id) < current ? 'done' : ''} ${skipped ? 'muted' : ''}">
          <span class="num">${i + 1}</span>${localizeDir(s.label)}
        </div>`;
      })}
    </div>`;
  }

  private renderStep(): TemplateResult {
    switch (this.step) {
      case 'source': {
        return html`<ti-source
          .mode=${this.mode}
          .connections=${this.connections}
          .connection=${this.connection}
          .busy=${this.busy}
          .canImportFile=${this.roleImportFile}
          .canBrowse=${this.roleBrowse}
          @wui:mode=${(e: CustomEvent<Mode>) => this.onMode(e.detail)}
          @wui:file=${(e: CustomEvent<{ name: string; text: string }>) => this.onFile(e.detail)}
          @wui:connection=${(e: CustomEvent<{ name: string }>) => this.onConnection(e.detail.name)}
        ></ti-source>`;
      }
      case 'select': {
        return html`
          <ti-browse-tree
            .connection=${this.connection}
            @wui:selection=${(e: CustomEvent<{ primary: OnlineNodeRef; parentNodeId: string }>) => this.onSelection(e.detail)}
          ></ti-browse-tree>
          <div class="select-footer">
            <label class="check">
              <input type="checkbox" .checked=${this.includeSiblings} @change=${(e: Event) => (this.includeSiblings = (e.target as HTMLInputElement).checked)} />
              <span>${localizeDir(MSG.online.alsoSiblings)}</span>
            </label>
            <div class="grow"></div>
            <ix-button variant="secondary" @click=${() => (this.step = 'source')}>${localizeDir(MSG.actions.back)}</ix-button>
            <ix-button variant="primary" ?disabled=${!this.primary || this.busy} @click=${() => void this.buildOnline()}>
              ${localizeDir(MSG.actions.next)}
            </ix-button>
          </div>
        `;
      }
      case 'review': {
        return html`<ti-review
          .plan=${this.plan}
          .decisions=${this.decisions}
          .typePrefix=${this.typePrefix}
          .hybrid=${this.hybrid}
          .online=${this.model?.source === 'opcua-online'}
          .busy=${this.busy}
          .canApply=${this.roleCreate}
          .dryRun=${this.dryRunResult}
          @wui:prefix=${(e: CustomEvent<string>) => this.onPrefix(e.detail)}
          @wui:hybrid=${(e: CustomEvent<boolean>) => this.onHybrid(e.detail)}
          @wui:typeoverride=${(e: CustomEvent<{ id: string; keep: boolean }>) => this.onTypeOverride(e.detail)}
          @wui:dryrun=${() => void this.onDryRun()}
          @wui:apply=${() => (this.confirmOpen = true)}
        ></ti-review>`;
      }
      case 'result': {
        return html`<ti-result .result=${this.applyResult} @wui:reset=${() => this.reset()}></ti-result>`;
      }
      default: {
        return html``;
      }
    }
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
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
      flex-direction: column;
      flex: 1;
      min-height: 0;
      padding: 0 1rem 1rem;
      overflow: auto;
      gap: 0.75rem;
    }
    .stepper {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0.5rem 0;
    }
    .crumb {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      opacity: 0.6;
    }
    .crumb.active {
      opacity: 1;
      font-weight: 600;
      color: var(--theme-color-primary);
    }
    .crumb.done {
      opacity: 0.9;
    }
    .crumb.muted {
      text-decoration: line-through;
      opacity: 0.35;
    }
    .crumb .num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.4rem;
      height: 1.4rem;
      border-radius: 999px;
      border: 1px solid currentColor;
      font-size: 0.72rem;
    }
    .step {
      flex: 1;
      min-height: 0;
    }
    .select-footer {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding-top: 0.75rem;
    }
    .select-footer .grow {
      flex: 1;
    }
    label.check {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
    }
  `;
}

if (!customElements.get('wui-tag-importer')) {
  customElements.define('wui-tag-importer', WuiTagImporter);
}
