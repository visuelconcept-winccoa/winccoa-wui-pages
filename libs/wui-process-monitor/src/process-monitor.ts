// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Process Monitor — standalone WinCC OA WebUI page.
 *
 * Operator features, modelled on the `winccoa_projectmanager` HTML app
 * (`proj.html`) but rebuilt natively (Lit + iX):
 *  - **Console**: live pmon manager list with start/stop/restart + restart-all,
 *    plus add / edit (start mode, restart settings, options — issue 40) / delete of
 *    pmon configuration entries (config/progs, role 'edit-managers'; deleting a
 *    running manager stops it first and also needs 'control'), with **one tab per
 *    connected server**
 *    (distributed/redundant systems) — sourced from the per-system
 *    `ProcessMonitor_Node` datapoints.
 *  - **Project upload**: deploy a ZIP into the project across ALL connected
 *    servers (optional folder purge, 7-Zip extraction into non-protected folders,
 *    config.env, optional restart) — DPL import is NOT here.
 *  - **Logs**: the WinCC OA log files of each host (`<project>/log`, read by that
 *    host's agent), filtered, coloured, live tail / pause, .bak merge, export —
 *    role 'logs-read' (logs can hold user names and addresses).
 *  - **Instances** (issue 39): the real state of each host instance, checked over
 *    vRPC by the aggregator in the same `/managers` request (badge + colour on each
 *    tab, a compact list with last seen and agent version, "invalid only" filter);
 *    the last snapshot of an instance that is not connected is shown greyed with
 *    its age. "Delete instance" (role 'manage-instances') removes the node DP of an
 *    instance whose agent no longer answers — never the local node, re-checked by
 *    the server right before the delete.
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
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import { canEditFleet, canEditFleet$ } from '@visuelconcept-winccoa/wui-kit/data/permissions.js';
import '@visuelconcept-winccoa/wui-kit/ui/wui-confirm-dialog.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import {
  MSG,
  STATE_HINTS,
  STATE_LABELS,
  agoLabel,
  confirmControlMsg,
  confirmDeleteInstanceMsg,
  confirmDialogLabels,
  confirmRemoveMsg,
  dateLabel,
  localize,
  localizeDir,
  serverLabel,
  type ConfirmIntent
} from './process-monitor/i18n.js';
import { addManager, controlManager, deleteInstance, isBridgeError, listInstances, removeManager, restartAll, updateManager } from './process-monitor/data/api.js';
import { instanceState, isLive, lastSeenAgeMs, stateTone } from './process-monitor/instances.js';
import { configChanges, deletePlan, formatUptime } from './process-monitor/managers.js';
import { ensureStores, loadHistory, traceOperation } from './process-monitor/data/stores.js';
import type { DeployResult, HistoryEntry, Instance, ManagerInfo, ManagerSpec, ManagerUpdateIntent } from './process-monitor/types.js';
import './process-monitor/ui/pm-console.js';
import './process-monitor/ui/pm-instances.js';
import './process-monitor/ui/pm-manager-dialog.js';
import './process-monitor/ui/pm-upload.js';
import './process-monitor/ui/pm-history.js';
import './process-monitor/ui/pm-logs.js';
import type { LogsExportDetail } from './process-monitor/ui/pm-logs.js';

type Tab = 'console' | 'upload' | 'logs' | 'history';

/** Application-Security module id of this page. */
const MODULE_ID = 'process-monitor';
type ControlIntent = { action: 'start' | 'stop' | 'restart'; index: number; name: string };
type RemoveIntent = { index: number; name: string; options: string; stopFirst: boolean };
const REFRESH_MS = 5000;

export class WuiProcessMonitor extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private tab: Tab = 'console';
  @state() private instances: Instance[] = [];
  /** Active node tab, keyed by the node DP (unique per computer, vs. per system). */
  @state() private activeDp = '';
  @state() private history: HistoryEntry[] = [];
  @state() private lastUpdate = '';
  /** Last backend failure (null = none), kept as a message + detail so it follows the UI language. */
  @state() private errorMsg: MultiLangString | null = null;
  @state() private errorDetail = '';
  /** Add / remove applied by pmon but not written to config/progs (issue 35): kept until closed. */
  @state() private warningDetail = '';
  /** True when that failure is the vRPC bridge (502/503) → the manager needs a restart. */
  @state() private bridgeDown = false;
  @state() private canEdit = canEditFleet();
  /** Application-Security grants (open until the admin assigns groups). */
  @state() private roleControl = true;
  @state() private roleDeploy = true;
  @state() private roleEditManagers = true;
  @state() private roleLogs = true;
  @state() private roleManageInstances = true;
  /** Instance whose deletion waits for confirmation (issue 39). */
  @state() private deletePending: Instance | null = null;
  @state() private restartAllPending = false;
  @state() private controlPending: ControlIntent | null = null;
  @state() private addDialogOpen = false;
  @state() private removePending: RemoveIntent | null = null;
  /** Manager whose configuration is being edited (issue 40). */
  @state() private editPending: ManagerInfo | null = null;

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
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.permSub.add(hasRole$(MODULE_ID, 'control').subscribe((granted) => (this.roleControl = granted)));
    this.permSub.add(hasRole$(MODULE_ID, 'edit-managers').subscribe((granted) => (this.roleEditManagers = granted)));
    this.permSub.add(hasRole$(MODULE_ID, 'deploy').subscribe((granted) => (this.roleDeploy = granted)));
    this.permSub.add(hasRole$(MODULE_ID, 'manage-instances').subscribe((granted) => (this.roleManageInstances = granted)));
    this.permSub.add(
      hasRole$(MODULE_ID, 'logs-read').subscribe((granted) => {
        this.roleLogs = granted;
        if (!granted && this.tab === 'logs') this.tab = 'console';
      })
    );
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
            ${this.roleLogs ? this.tabBtn('logs', MSG.tabs.logs) : nothing}
            ${this.tabBtn('history', MSG.tabs.history)}
          </div>

          ${this.renderError()}${this.renderWarning()}
          ${this.tab === 'console' ? this.renderConsole() : nothing}
          ${this.tab === 'upload'
            ? html`<pm-upload
                .canEdit=${this.canEdit && this.roleDeploy}
                .servers=${this.instances.map((i) => ({ system: i.system, hostname: i.hostname }))}
                @wui:deployed=${(e: CustomEvent<DeployDetail>) => void this.onDeployed(e.detail)}
              ></pm-upload>`
            : nothing}
          ${this.tab === 'logs' && this.roleLogs
            ? html`<pm-logs
                .nodes=${this.instances.map((i) => ({ dp: i.dp, system: i.system, hostname: i.hostname }))}
                @wui:logsexported=${(e: CustomEvent<LogsExportDetail>) => void this.onLogsExported(e.detail)}
              ></pm-logs>`
            : nothing}
          ${this.tab === 'history'
            ? html`<pm-history .entries=${this.history} @wui:refreshhistory=${() => void this.refreshHistory()}></pm-history>`
            : nothing}
        </div>
      </div>
      ${this.renderDialogs()}
    `;
  }

  /**
   * Banner for the last backend failure. An empty console with no message reads as
   * "this server has no managers", when it usually means the bridge to the
   * processMonitor manager is down — so the reason is always shown, with the
   * restart hint when the fault is on the manager side.
   */
  private renderError(): TemplateResult | typeof nothing {
    if (this.errorMsg === null) return nothing;
    return html`<ix-message-bar class="error-bar" type="alarm" persistent>
      ${localizeDir(this.errorMsg)}${this.errorDetail ? ` — ${this.errorDetail}` : ''}
      ${this.bridgeDown ? html`<div class="error-hint">${localizeDir(MSG.errors.bridge)}</div>` : nothing}
    </ix-message-bar>`;
  }

  private renderWarning(): TemplateResult | typeof nothing {
    if (!this.warningDetail) return nothing;
    return html`<ix-message-bar class="error-bar" type="warning" persistent @closedChange=${() => (this.warningDetail = '')}>
      ${localizeDir(MSG.errors.notPersisted)} — ${this.warningDetail}
    </ix-message-bar>`;
  }

  private renderConsole(): TemplateResult {
    const active = this.active;
    const live = !active || isLive(active);
    // Nobody reads the `.cmd` of an instance whose agent does not answer: no control there.
    const controllable = !active || instanceState(active) !== 'agent-unreachable';
    return html`
      ${this.instances.length > 0
        ? html`<pm-instances
            .instances=${this.instances}
            .canDelete=${this.canEdit && this.roleManageInstances}
            @wui:deleteinstance=${(e: CustomEvent<Instance>) => (this.deletePending = e.detail)}
          ></pm-instances>`
        : nothing}
      ${this.instances.length > 1 ? this.renderServerTabs() : nothing}
      ${live || !active ? nothing : this.renderStaleBar(active)}
      <pm-console
        class=${live ? '' : 'stale'}
        .managers=${active?.managers ?? []}
        .canEdit=${this.canEdit && this.roleControl && controllable}
        .canConfig=${this.canEdit && this.roleEditManagers && controllable}
        .lastUpdate=${live ? this.lastUpdate : ''}
        @wui:refresh=${() => void this.refreshInstances()}
        @wui:restartall=${() => (this.restartAllPending = true)}
        @wui:control=${(e: CustomEvent<ControlIntent>) => (this.controlPending = e.detail)}
        @wui:addmanager=${() => (this.addDialogOpen = true)}
        @wui:removemanager=${(e: CustomEvent<RemoveIntent>) => (this.removePending = e.detail)}
        @wui:editmanager=${(e: CustomEvent<ManagerInfo>) => (this.editPending = e.detail)}
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
          <span class="dot tone-${stateTone(instanceState(i))}" title=${localize(STATE_LABELS[instanceState(i)])}></span>
          <ix-icon name="network-device" size="16"></ix-icon>${serverLabel(i)}
          <span class="count">${i.managers.length}</span>
        </button>`
      )}
    </div>`;
  }

  /** The active instance is not connected: its state, and the age of the snapshot shown greyed. */
  private renderStaleBar(i: Instance): TemplateResult {
    const st = instanceState(i);
    const age = lastSeenAgeMs(i, Date.now());
    const seen = `${dateLabel(i.updated)}${age === null ? '' : ` (${agoLabel(formatUptime(age, localize(MSG.console.dayUnit)))})`}`;
    return html`<ix-message-bar class="error-bar" type=${st === 'agent-unreachable' ? 'alarm' : 'warning'} persistent>
      <strong>${localizeDir(STATE_LABELS[st])}</strong> — ${localizeDir(STATE_HINTS[st])}
      <div class="error-hint">${localizeDir(MSG.instances.staleSnapshot)} ${localizeDir(MSG.instances.colLastSeen)}: ${seen}</div>
    </ix-message-bar>`;
  }

  /**
   * Every confirmation passes its own heading and button (issue 34): without them,
   * `<wui-confirm-dialog>` reads "Confirm deletion" / "Delete" — even for a stop.
   */
  private renderDialogs(): TemplateResult {
    return html`
      ${this.restartAllPending
        ? this.confirmDialog(
            'restart-all',
            localize(MSG.console.confirmRestartAll),
            () => void this.onRestartAll(),
            () => (this.restartAllPending = false)
          )
        : nothing}
      ${this.controlPending
        ? this.confirmDialog(
            this.controlPending.action,
            confirmControlMsg(this.controlPending.action, this.controlPending.name),
            () => void this.onControlConfirm(),
            () => (this.controlPending = null)
          )
        : nothing}
      ${this.addDialogOpen
        ? html`<pm-manager-dialog
            @wui:save=${(e: CustomEvent<ManagerSpec>) => void this.onAddManager(e.detail)}
            @wui:cancel=${() => (this.addDialogOpen = false)}
          ></pm-manager-dialog>`
        : nothing}
      ${this.editPending
        ? html`<pm-manager-dialog
            .manager=${this.editPending}
            .canRestart=${this.canEdit && this.roleControl}
            .canDelete=${this.canEdit && this.roleEditManagers}
            @wui:update=${(e: CustomEvent<ManagerUpdateIntent>) => void this.onUpdateManager(e.detail)}
            @wui:delete=${(e: CustomEvent<ManagerInfo>) => this.onDeleteFromDialog(e.detail)}
            @wui:cancel=${() => (this.editPending = null)}
          ></pm-manager-dialog>`
        : nothing}
      ${this.removePending
        ? this.confirmDialog(
            'remove',
            confirmRemoveMsg(this.removePending.name, this.removePending.index, this.removePending.options, this.removePending.stopFirst),
            () => void this.onRemoveConfirm(),
            () => (this.removePending = null)
          )
        : nothing}
      ${this.deletePending
        ? this.confirmDialog(
            'delete-instance',
            confirmDeleteInstanceMsg(serverLabel(this.deletePending), this.deletePending.system, dateLabel(this.deletePending.updated)),
            () => void this.onDeleteInstanceConfirm(),
            () => (this.deletePending = null)
          )
        : nothing}
    `;
  }

  private confirmDialog(intent: ConfirmIntent, message: string, onConfirm: () => void, onCancel: () => void): TemplateResult {
    const { heading, confirmLabel } = confirmDialogLabels(intent);
    return html`<wui-confirm-dialog
      .heading=${heading}
      .confirmLabel=${confirmLabel}
      message=${message}
      @wui:confirm=${onConfirm}
      @wui:cancel=${onCancel}
    ></wui-confirm-dialog>`;
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
      this.clearLoadError();
    } catch (error) {
      // The previous list is kept (a transient hiccup must not blank the console),
      // but the reason is surfaced — a silent empty table hides a dead bridge.
      this.reportError(MSG.errors.load, error);
    }
  }

  /** Surface a backend failure in the banner. */
  private reportError(message: MultiLangString, error: unknown): void {
    this.errorMsg = message;
    this.errorDetail = error instanceof Error ? error.message : String(error);
    this.bridgeDown = isBridgeError(error);
  }

  private clearError(): void {
    this.errorMsg = null;
    this.errorDetail = '';
    this.bridgeDown = false;
  }

  /**
   * Clear the banner only when it holds a LOAD failure: every action refreshes the
   * list right after, and that refresh must not wipe the reason the action failed.
   */
  private clearLoadError(): void {
    if (this.errorMsg === MSG.errors.load) this.clearError();
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
      this.clearError();
    } catch (error) {
      this.reportError(MSG.errors.action, error);
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
    this.warningDetail = '';
    const target = this.active;
    const label = nodeLabel(target);
    let ok = false;
    try {
      const res = await addManager(target?.dp ?? '', spec);
      ok = res.ok !== false;
      this.clearError();
      this.warningDetail = res.warning ?? '';
    } catch (error) {
      this.reportError(MSG.errors.action, error);
    }
    const parts = [spec.startMode, spec.options, spec.index === undefined ? '' : `#${spec.index}`].filter(Boolean);
    const unsaved = ok && this.warningDetail ? ' — config/progs not updated' : '';
    const detail = `${spec.name} — add (${parts.join(', ')})${unsaved}`;
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
    this.warningDetail = '';
    const target = this.active;
    const label = nodeLabel(target);
    let ok = false;
    try {
      const res = await removeManager(target?.dp ?? '', d.index, { name: d.name, stopFirst: d.stopFirst });
      ok = res.ok !== false;
      this.clearError();
      this.warningDetail = res.warning ?? '';
    } catch (error) {
      this.reportError(MSG.errors.action, error);
    }
    const stop = d.stopFirst ? ' — stopped first' : '';
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'manager',
        detail: `${d.name} — remove (#${d.index})${stop}${ok && this.warningDetail ? ' — config/progs not updated' : ''}`,
        status: ok ? 'success' : 'failed',
        host: hostName(),
        system: label
      },
      { action: 'REMOVE', item: d.name, oldval: JSON.stringify({ index: d.index, options: d.options, stopFirst: d.stopFirst }), reason: label }
    );
    await this.refreshInstances();
    void this.refreshHistory();
  }

  /** The labelled "Delete manager" of the edit dialog: the same plan and confirmation as the trashcan. */
  private onDeleteFromDialog(m: ManagerInfo): void {
    this.editPending = null;
    const plan = deletePlan(m, { editManagers: this.canEdit && this.roleEditManagers, control: this.canEdit && this.roleControl });
    if (!plan.allowed) {
      this.reportError(MSG.errors.action, localize(MSG.console.removeNeedsControl));
      return;
    }
    this.removePending = { index: m.index, name: m.name, options: m.options, stopFirst: plan.stopFirst };
  }

  /**
   * Save a configuration change (issue 40) — traced with its before / after values to the audit
   * trail and the History tab, whether pmon applied it or not.
   */
  private async onUpdateManager(d: ManagerUpdateIntent): Promise<void> {
    this.editPending = null;
    this.warningDetail = '';
    const target = this.active;
    const label = nodeLabel(target);
    let ok = false;
    let restarted = false;
    let after = d.config;
    try {
      const res = await updateManager(target?.dp ?? '', d.index, d.name, d.config, d.restart);
      ok = res.ok !== false;
      restarted = res.detail?.restarted === true;
      if (res.detail?.after) after = { ...d.config, ...res.detail.after };
      this.clearError();
      this.warningDetail = res.warning ?? '';
    } catch (error) {
      this.reportError(MSG.errors.action, error);
    }
    const changes = configChanges(d.before, d.config);
    const notes = [restarted ? 'restarted' : '', ok && this.warningDetail ? 'config/progs not updated' : ''].filter(Boolean);
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'manager-config',
        detail: `${d.name} (#${d.index}) — edit: ${changes.join(', ') || 'no change'}${notes.length > 0 ? ` — ${notes.join(', ')}` : ''}`,
        status: ok ? 'success' : 'failed',
        host: hostName(),
        system: label
      },
      {
        action: 'EDIT',
        item: d.name,
        oldval: JSON.stringify({ index: d.index, ...d.before }),
        newval: JSON.stringify({ index: d.index, ...after, restart: d.restart }),
        reason: label
      }
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
      this.clearError();
    } catch (error) {
      this.reportError(MSG.errors.action, error);
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

  /**
   * Delete an instance whose agent no longer answers (issue 39). The server pings it again and
   * refuses when it answers or when it is its own node; either way the attempt is traced with
   * who (the writer), the host, the system and the last-seen date.
   */
  private async onDeleteInstanceConfirm(): Promise<void> {
    const target = this.deletePending;
    this.deletePending = null;
    if (!target) return;
    const host = serverLabel(target);
    let ok = false;
    let reason = '';
    try {
      const res = await deleteInstance(target.dp);
      ok = res.ok !== false;
      this.clearError();
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      this.reportError(MSG.errors.action, error);
    }
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'delete-instance',
        detail: `${host} — ${target.dp} — last seen ${target.updated || '?'}${reason ? ` — refused: ${reason}` : ''}`,
        status: ok ? 'success' : 'failed',
        host: hostName(),
        system: cleanSystem(target.system)
      },
      {
        action: 'DELETE_INSTANCE',
        item: host,
        oldval: JSON.stringify({ dp: target.dp, system: target.system, hostname: target.hostname, lastSeen: target.updated, state: target.status?.state ?? '' }),
        reason: cleanSystem(target.system) || host
      }
    );
    if (ok && this.activeDp === target.dp) this.activeDp = '';
    await this.refreshInstances();
    void this.refreshHistory();
  }

  /** A logs export is traced like the other actions: who (the writer), which host, which files. */
  private async onLogsExported(d: LogsExportDetail): Promise<void> {
    const what = d.kind === 'raw' ? 'raw files' : `displayed entries (${d.format})`;
    const bak = d.mergeBak ? ' [.bak merged]' : '';
    await traceOperation(
      {
        time: new Date().toISOString(),
        action: 'logs-export',
        detail: `${d.files.join(', ')} — ${what}${bak}`,
        status: 'success',
        host: hostName(),
        system: d.host
      },
      { action: 'EXPORT_LOGS', item: d.files.join(', '), newval: JSON.stringify({ kind: d.kind, format: d.format, mergeBak: d.mergeBak }), reason: d.host }
    );
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
    .error-bar {
      margin-bottom: 0.6rem;
    }
    .error-hint {
      padding-top: 0.25rem;
      font-size: 0.85rem;
      opacity: 0.9;
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
    .server-tab .dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      flex: none;
      box-shadow: 0 0 0 1px var(--theme-color-1);
    }
    .tone-ok {
      background: var(--theme-color-success);
    }
    .tone-alarm {
      background: var(--theme-color-alarm);
    }
    .tone-warning {
      background: var(--theme-color-warning);
    }
    .tone-neutral {
      background: var(--theme-color-neutral);
    }
    pm-console.stale {
      opacity: 0.55;
      filter: grayscale(1);
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
