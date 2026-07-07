// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Process Monitor — standalone WinCC OA WebUI page.
 *
 * Operator features, modelled on the `winccoa_projectmanager` HTML app
 * (`proj.html`) but rebuilt natively (Lit + iX):
 *  - **Console**: live pmon manager list with start/stop/restart + restart-all,
 *    plus add/remove of pmon configuration entries (config/progs, role
 *    'edit-managers'), with **one tab per connected server**
 *    (distributed/redundant systems) — sourced from the per-system
 *    `ProcessMonitor_Node` datapoints.
 *  - **Project upload**: deploy a ZIP into the project across ALL connected
 *    servers (optional folder purge, 7-Zip extraction into non-protected folders,
 *    config.env, optional restart) — DPL import is NOT here.
 * Plus a **History** tab. Every project import and manager restart is traced to a
 * GxP `_AuditTrail` datapoint (`AuditTrail_ProcessMonitor`, with the session user)
 * and an operations-log datapoint, both ensured at page init.
 *
 * Backend: `/api/process-monitor` (customer-webserver) → MSA vRPC → the
 * `processMonitor` JS manager (per-system agent + aggregator) → pmon.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import { canEditFleet, canEditFleet$ } from '@visuelconcept/wui-kit/data/permissions.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import { MSG, confirmControlMsg, confirmRemoveMsg, localize, localizeDir, ml, serverLabel } from './process-monitor/i18n.js';
import { addManager, controlManager, listInstances, removeManager, restartAll } from './process-monitor/data/api.js';
import { ensureStores, loadHistory, traceOperation } from './process-monitor/data/stores.js';
import type { DeployResult, HistoryEntry, Instance, ManagerSpec } from './process-monitor/types.js';
import './process-monitor/ui/pm-console.js';
import './process-monitor/ui/pm-manager-dialog.js';
import './process-monitor/ui/pm-upload.js';
import './process-monitor/ui/pm-history.js';

type Tab = 'console' | 'upload' | 'history';

/** Application-Security module id of this page. */
const MODULE_ID = 'process-monitor';
type ControlIntent = { action: 'start' | 'stop' | 'restart'; index: number; name: string };
type RemoveIntent = { index: number; name: string };
const REFRESH_MS = 5000;

export class WuiProcessMonitor extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private tab: Tab = 'console';
  @state() private instances: Instance[] = [];
  /** Active node tab, keyed by the node DP (unique per computer, vs. per system). */
  @state() private activeDp = '';
  @state() private history: HistoryEntry[] = [];
  @state() private lastUpdate = '';
  @state() private canEdit = canEditFleet();
  /** Application-Security grants (open until the admin assigns groups). */
  @state() private roleControl = true;
  @state() private roleDeploy = true;
  @state() private roleEditManagers = true;
  @state() private restartAllPending = false;
  @state() private controlPending: ControlIntent | null = null;
  @state() private addDialogOpen = false;
  @state() private removePending: RemoveIntent | null = null;

  private permSub = new Subscription();
  private timer: ReturnType<typeof globalThis.setInterval> | undefined;

  /** The instance whose tab is active (defaults to the first node). */
  private get active(): Instance | undefined {
    return this.instances.find((i) => i.dp === this.activeDp) ?? this.instances[0];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.permSub = canEditFleet$().subscribe((allowed) => (this.canEdit = allowed));
    // Application Security: declare this module's roles and follow the grants
    // (the same rules are ENFORCED server-side on /api/process-monitor).
    registerModuleRoles({
      module: MODULE_ID,
      title: ml('Process Monitor', 'Moniteur de processus', 'Prozessmonitor'),
      roles: [
        { id: 'view', label: ml('View', 'Consulter', 'Ansehen') },
        { id: 'control', label: ml('Control managers', 'Piloter les managers', 'Manager steuern') },
        { id: 'edit-managers', label: ml('Edit manager configuration', 'Éditer la configuration des managers', 'Manager-Konfiguration bearbeiten') },
        { id: 'deploy', label: ml('Deploy projects', 'Déployer des projets', 'Projekte deployen') }
      ]
    });
    this.permSub.add(hasRole$(MODULE_ID, 'control').subscribe((granted) => (this.roleControl = granted)));
    this.permSub.add(hasRole$(MODULE_ID, 'edit-managers').subscribe((granted) => (this.roleEditManagers = granted)));
    this.permSub.add(hasRole$(MODULE_ID, 'deploy').subscribe((granted) => (this.roleDeploy = granted)));
    void ensureStores();
    void this.refreshInstances();
    void this.refreshHistory();
    this.timer = globalThis.setInterval(() => {
      if (this.tab === 'console') void this.refreshInstances();
    }, REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.permSub.unsubscribe();
    globalThis.clearInterval(this.timer);
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Process Monitor', fr: 'Moniteur de processus', 'de_AT.utf8': 'Prozessmonitor' }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          <div class="tabs">
            ${this.tabBtn('console', MSG.tabs.console)}
            ${this.tabBtn('upload', MSG.tabs.upload)}
            ${this.tabBtn('history', MSG.tabs.history)}
          </div>

          ${this.tab === 'console' ? this.renderConsole() : nothing}
          ${this.tab === 'upload'
            ? html`<pm-upload
                .canEdit=${this.canEdit && this.roleDeploy}
                .servers=${this.instances.map((i) => ({ system: i.system, hostname: i.hostname }))}
                @wui:deployed=${(e: CustomEvent<DeployDetail>) => void this.onDeployed(e.detail)}
              ></pm-upload>`
            : nothing}
          ${this.tab === 'history'
            ? html`<pm-history .entries=${this.history} @wui:refreshhistory=${() => void this.refreshHistory()}></pm-history>`
            : nothing}
        </div>
      </div>
      ${this.renderDialogs()}
    `;
  }

  private renderConsole(): TemplateResult {
    const active = this.active;
    return html`
      ${this.instances.length > 1 ? this.renderServerTabs() : nothing}
      <pm-console
        .managers=${active?.managers ?? []}
        .canEdit=${this.canEdit && this.roleControl}
        .canConfig=${this.canEdit && this.roleEditManagers}
        .lastUpdate=${this.lastUpdate}
        @wui:refresh=${() => void this.refreshInstances()}
        @wui:restartall=${() => (this.restartAllPending = true)}
        @wui:control=${(e: CustomEvent<ControlIntent>) => (this.controlPending = e.detail)}
        @wui:addmanager=${() => (this.addDialogOpen = true)}
        @wui:removemanager=${(e: CustomEvent<RemoveIntent>) => (this.removePending = e.detail)}
      ></pm-console>
    `;
  }

  private renderServerTabs(): TemplateResult {
    const current = this.active?.dp ?? '';
    return html`<div class="server-tabs">
      ${this.instances.map(
        (i) => html`<button
          class="server-tab ${i.dp === current ? 'active' : ''}"
          @click=${() => (this.activeDp = i.dp)}
        >
          <ix-icon name="network-device" size="16"></ix-icon>${serverLabel(i)}
          <span class="count">${i.managers.length}</span>
        </button>`
      )}
    </div>`;
  }

  private renderDialogs(): TemplateResult {
    return html`
      ${this.restartAllPending
        ? html`<wui-confirm-dialog
            message=${localize(MSG.console.confirmRestartAll)}
            @wui:confirm=${() => void this.onRestartAll()}
            @wui:cancel=${() => (this.restartAllPending = false)}
          ></wui-confirm-dialog>`
        : nothing}
      ${this.controlPending
        ? html`<wui-confirm-dialog
            message=${confirmControlMsg(this.controlPending.action, this.controlPending.name)}
            @wui:confirm=${() => void this.onControlConfirm()}
            @wui:cancel=${() => (this.controlPending = null)}
          ></wui-confirm-dialog>`
        : nothing}
      ${this.addDialogOpen
        ? html`<pm-manager-dialog
            @wui:save=${(e: CustomEvent<ManagerSpec>) => void this.onAddManager(e.detail)}
            @wui:cancel=${() => (this.addDialogOpen = false)}
          ></pm-manager-dialog>`
        : nothing}
      ${this.removePending
        ? html`<wui-confirm-dialog
            message=${confirmRemoveMsg(this.removePending.name, this.removePending.index)}
            @wui:confirm=${() => void this.onRemoveConfirm()}
            @wui:cancel=${() => (this.removePending = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  private tabBtn(tab: Tab, label: typeof MSG.tabs.console): TemplateResult {
    return html`<ix-button variant=${this.tab === tab ? 'primary' : 'secondary'} @click=${() => (this.tab = tab)}>
      ${localizeDir(label)}
    </ix-button>`;
  }

  private async refreshInstances(): Promise<void> {
    try {
      this.instances = await listInstances();
      if (!this.instances.some((i) => i.dp === this.activeDp)) {
        this.activeDp = this.instances[0]?.dp ?? '';
      }
      this.lastUpdate = new Date().toLocaleTimeString();
    } catch {
      // leave the previous list; transient pmon/webserver hiccup
    }
  }

  private async refreshHistory(): Promise<void> {
    try {
      this.history = await loadHistory();
    } catch {
      this.history = [];
    }
  }

  private async onControlConfirm(): Promise<void> {
    const d = this.controlPending;
    this.controlPending = null;
    if (d) await this.onControl(d);
  }

  private async onControl(d: ControlIntent): Promise<void> {
    const target = this.active;
    const label = nodeLabel(target);
    let ok = false;
    try {
      const res = await controlManager(target?.dp ?? '', d.action, d.index);
      ok = res.ok !== false;
    } catch {
      ok = false;
    }
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'manager',
        detail: `${d.name} — ${d.action}`,
        status: ok ? 'success' : 'failed',
        host: hostName(),
        system: label
      },
      { action: d.action.toUpperCase(), item: d.name, newval: d.action, reason: label }
    );
    await this.refreshInstances();
    void this.refreshHistory();
  }

  private async onAddManager(spec: ManagerSpec): Promise<void> {
    this.addDialogOpen = false;
    const target = this.active;
    const label = nodeLabel(target);
    let ok = false;
    try {
      const res = await addManager(target?.dp ?? '', spec);
      ok = res.ok !== false;
    } catch {
      ok = false;
    }
    const parts = [spec.startMode, spec.options, spec.index === undefined ? '' : `#${spec.index}`].filter(Boolean);
    const detail = `${spec.name} — add (${parts.join(', ')})`;
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'manager',
        detail,
        status: ok ? 'success' : 'failed',
        host: hostName(),
        system: label
      },
      { action: 'ADD', item: spec.name, newval: JSON.stringify(spec), reason: label }
    );
    await this.refreshInstances();
    void this.refreshHistory();
  }

  private async onRemoveConfirm(): Promise<void> {
    const d = this.removePending;
    this.removePending = null;
    if (!d) return;
    const target = this.active;
    const label = nodeLabel(target);
    let ok = false;
    try {
      const res = await removeManager(target?.dp ?? '', d.index);
      ok = res.ok !== false;
    } catch {
      ok = false;
    }
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'manager',
        detail: `${d.name} — remove (#${d.index})`,
        status: ok ? 'success' : 'failed',
        host: hostName(),
        system: label
      },
      { action: 'REMOVE', item: d.name, oldval: `#${d.index}`, reason: label }
    );
    await this.refreshInstances();
    void this.refreshHistory();
  }

  private async onRestartAll(): Promise<void> {
    this.restartAllPending = false;
    const target = this.active;
    const label = nodeLabel(target);
    let ok = false;
    try {
      const res = await restartAll(target?.dp ?? '');
      ok = res.ok !== false;
    } catch {
      ok = false;
    }
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'restart-all',
        detail: 'all managers',
        status: ok ? 'success' : 'failed',
        host: hostName(),
        system: label
      },
      { action: 'RESTART_ALL', item: 'project', reason: label }
    );
    await this.refreshInstances();
    void this.refreshHistory();
  }

  private async onDeployed(d: DeployDetail): Promise<void> {
    const cleared = d.clearFolders.length > 0 ? ` [cleared: ${d.clearFolders.join(', ')}]` : '';
    const servers = (d.result.results ?? []).map((r) => `${r.hostname || r.system || 'local'}${r.ok ? '' : ' (FAILED)'}`).join(', ');
    const skipped = [...new Set((d.result.results ?? []).flatMap((r) => r.skipped ?? []))];
    const skippedNote = skipped.length > 0 ? ` [skipped: ${skipped.join(', ')}]` : '';
    const restartNote = d.restart ? ' [restart]' : '';
    const serversNote = servers ? ` → ${servers}` : '';
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'deploy',
        detail: `${d.fileName}${cleared}${skippedNote}${restartNote}${serversNote}`,
        status: d.result.ok ? 'success' : 'failed',
        host: hostName(),
        system: servers
      },
      {
        action: 'IMPORT',
        item: d.fileName,
        newval: JSON.stringify({ clearFolders: d.clearFolders, restart: d.restart, ok: d.result.ok, results: d.result.results })
      }
    );
    await this.refreshInstances();
    void this.refreshHistory();
  }
}

interface DeployDetail {
  fileName: string;
  clearFolders: string[];
  restart: boolean;
  result: DeployResult;
}

function hostName(): string {
  return globalThis.location?.hostname ?? '';
}

/** Strip the trailing ':' from a WinCC OA system name for display/logging. */
function cleanSystem(system: string): string {
  return system.endsWith(':') ? system.slice(0, -1) : system;
}

/** Human label of a node (computer) for tracing — hostname, else system, else 'local'. */
function nodeLabel(instance?: Instance): string {
  return instance?.hostname || cleanSystem(instance?.system ?? '') || 'local';
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
    }
    .tabs {
      display: flex;
      gap: 0.4rem;
      padding: 0.5rem 0;
    }
    .server-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding-bottom: 0.6rem;
    }
    .server-tab {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.7rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 999px;
      background: var(--theme-color-1);
      color: var(--theme-color-text);
      cursor: pointer;
      font-size: 0.85rem;
    }
    .server-tab.active {
      background: var(--theme-color-primary, #00b3b3);
      border-color: var(--theme-color-primary, #00b3b3);
      color: var(--theme-color-primary-contrast, #fff);
    }
    .server-tab .count {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.02rem 0.4rem;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.25);
    }
  `;
}

if (!customElements.get('wui-process-monitor')) {
  customElements.define('wui-process-monitor', WuiProcessMonitor);
}
