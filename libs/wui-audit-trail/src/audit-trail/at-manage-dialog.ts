// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Audit-trail DP manager dialog.
 *
 * Lists the existing `_AuditTrail` datapoints, lets the user create a new one
 * (always with NGA archiving enabled on a chosen group — archiving is mandatory)
 * and reassign each DP's archive group or delete it. The system `_AuditTrail` DP
 * can be (re)grouped but not deleted.
 *
 * Emits `wui:change` after any mutation (so the host page reloads its DP list)
 * and `wui:close` on dismiss.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { container } from 'tsyringe';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import {
  createAuditDp,
  deleteAuditDp,
  enableArchive,
  listArchiveGroups,
  listAuditDps,
  readArchiveStatus
} from './dp-admin.js';
import { AUDIT_DP_PREFIX, AUDIT_DP_TYPE } from './types.js';

const MANAGE_TAG = 'at-manage-dialog';

interface IxValueEvent {
  detail: string | string[];
}

interface DpEntry {
  name: string;
  archived: boolean;
  group: string;
}

function asString(detail: string | string[]): string {
  return Array.isArray(detail) ? (detail[0] ?? '') : detail;
}

/** Keep only DP-name-safe characters; drop a redundant leading prefix. */
function sanitizeSuffix(raw: string): string {
  const trimmed = raw.trim().replace(new RegExp(`^${AUDIT_DP_PREFIX}`), '');
  return trimmed.replaceAll(/[^\w-]+/g, '_');
}

export class AtManageDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, manageStyles()];

  @state() private dps: DpEntry[] = [];
  @state() private groups: string[] = [];
  @state() private loading = true;
  @state() private busy = false;
  @state() private suffix = '';
  @state() private newGroup = '';
  @state() private message = '';
  @state() private messageOk = false;
  @state() private confirmName: string | null = null;

  private readonly api = this.resolveApi();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.reload();
  }

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">Datapoints d'audit trail</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            ${this.renderNoGroups()} ${this.renderCreate()} ${this.renderMessage()} ${this.renderList()}
          </div>
          <div class="panel-foot">
            <ix-button @click=${this.close}>Fermer</ix-button>
          </div>
        </div>
      </div>
      ${this.renderConfirm()}
    `;
  }

  private renderNoGroups(): TemplateResult {
    if (this.loading || this.groups.length > 0) return html``;
    return html`<div class="notice warn">
      <ix-icon name="warning"></ix-icon>Aucun groupe d'archive NGA actif (type
      <code>_NGA_Group</code>). Activez-en un pour pouvoir créer un datapoint archivé.
    </div>`;
  }

  private renderCreate(): TemplateResult {
    const canCreate = !this.busy && this.groups.length > 0 && sanitizeSuffix(this.suffix) !== '';
    return html`
      <div class="subhead">Nouveau datapoint (type <code>${AUDIT_DP_TYPE}</code>, archivé)</div>
      <div class="create-row">
        <span class="prefix">${AUDIT_DP_PREFIX}</span>
        <ix-input
          class="suffix"
          placeholder="Nom (ex. Production)"
          .value=${this.suffix}
          @valueChange=${(e: IxValueEvent) => (this.suffix = asString(e.detail))}
        ></ix-input>
        <ix-select
          class="group"
          mode="single"
          ?disabled=${this.groups.length === 0}
          .value=${this.newGroup || this.groups[0] || ''}
          @valueChange=${(e: IxValueEvent) => (this.newGroup = asString(e.detail))}
        >
          ${this.groups.map((g) => html`<ix-select-item label=${g} value=${g}></ix-select-item>`)}
        </ix-select>
        <ix-button ?disabled=${!canCreate} @click=${() => void this.create()}>
          <ix-icon name="plus" slot="icon"></ix-icon>Créer
        </ix-button>
      </div>
    `;
  }

  private renderMessage(): TemplateResult {
    if (this.message === '') return html``;
    return html`<div class="msg ${this.messageOk ? 'ok' : 'err'}">${this.message}</div>`;
  }

  private renderList(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (this.dps.length === 0) {
      return html`<div class="hint">Aucun datapoint <code>${AUDIT_DP_TYPE}</code> pour le moment.</div>`;
    }
    return html`<div class="subhead">Datapoints existants (${this.dps.length})</div>
      <div class="list">
        <table>
          <thead>
            <tr><th>Datapoint</th><th>Groupe d'archive</th><th></th></tr>
          </thead>
          <tbody>
            ${this.dps.map((d) => this.renderRow(d))}
          </tbody>
        </table>
      </div>`;
  }

  private renderRow(d: DpEntry): TemplateResult {
    const isSystem = d.name === AUDIT_DP_TYPE;
    const group = d.group || this.groups[0] || '';
    return html`
      <tr>
        <td class="name">
          ${d.name}
          ${d.archived ? nothing : html`<span class="badge">non archivé</span>`}
        </td>
        <td>
          <ix-select
            mode="single"
            ?disabled=${this.busy || this.groups.length === 0}
            .value=${group}
            @valueChange=${(e: IxValueEvent) => void this.changeGroup(d, asString(e.detail))}
          >
            ${this.groups.map((g) => html`<ix-select-item label=${g} value=${g}></ix-select-item>`)}
          </ix-select>
        </td>
        <td class="actions">
          <ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title=${isSystem ? 'Datapoint système — non supprimable' : 'Supprimer'}
            ?disabled=${this.busy || isSystem}
            @click=${() => (this.confirmName = d.name)}
          ></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private renderConfirm(): TemplateResult {
    if (this.confirmName == null) return html``;
    return html`<wui-confirm-dialog
      heading="Supprimer le datapoint"
      message=${`Supprimer définitivement « ${this.confirmName} » et son historique archivé ?`}
      @wui:confirm=${this.confirmDelete}
      @wui:cancel=${() => (this.confirmName = null)}
    ></wui-confirm-dialog>`;
  }

  // --- actions ---------------------------------------------------------------

  private async reload(): Promise<void> {
    this.loading = true;
    this.groups = await listArchiveGroups(this.api);
    if (this.newGroup === '') this.newGroup = this.groups[0] ?? '';
    const names = await listAuditDps(this.api);
    const entries: DpEntry[] = [];
    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps the dpGet load gentle
      const status = await readArchiveStatus(this.api, name);
      entries.push({ name, archived: status.archived, group: status.group });
    }
    this.dps = entries;
    this.loading = false;
  }

  private async create(): Promise<void> {
    const suffix = sanitizeSuffix(this.suffix);
    const group = this.newGroup || this.groups[0] || '';
    if (suffix === '' || group === '') return;
    const name = `${AUDIT_DP_PREFIX}${suffix}`;
    this.busy = true;
    try {
      await createAuditDp(name);
      await enableArchive(name, group);
      this.suffix = '';
      this.setMessage(`Datapoint « ${name} » créé et archivé (groupe « ${group} »).`, true);
      await this.reload();
      this.emitChange();
    } catch (error) {
      this.setMessage(`Échec de création : ${this.errText(error)}`, false);
    } finally {
      this.busy = false;
    }
  }

  private async changeGroup(d: DpEntry, group: string): Promise<void> {
    if (group === '' || (group === d.group && d.archived)) return;
    this.busy = true;
    try {
      await enableArchive(d.name, group);
      this.setMessage(`Groupe « ${group} » appliqué à « ${d.name} ».`, true);
      await this.reload();
      this.emitChange();
    } catch (error) {
      this.setMessage(`Échec : ${this.errText(error)}`, false);
    } finally {
      this.busy = false;
    }
  }

  private async confirmDelete(): Promise<void> {
    const name = this.confirmName;
    this.confirmName = null;
    if (name == null) return;
    this.busy = true;
    try {
      await deleteAuditDp(name);
      this.setMessage(`Datapoint « ${name} » supprimé.`, true);
      await this.reload();
      this.emitChange();
    } catch (error) {
      this.setMessage(`Échec de suppression : ${this.errText(error)}`, false);
    } finally {
      this.busy = false;
    }
  }

  private emitChange(): void {
    this.dispatchEvent(new CustomEvent('wui:change', { bubbles: true, composed: true }));
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }

  private setMessage(message: string, ok: boolean): void {
    this.message = message;
    this.messageOk = ok;
  }

  private errText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

if (!customElements.get(MANAGE_TAG)) {
  customElements.define(MANAGE_TAG, AtManageDialog);
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function manageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: contents;
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .panel {
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      width: 720px;
      max-width: 96vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .panel-body {
      padding: 1rem;
      overflow-y: auto;
    }
    .panel-foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
    .subhead {
      font-weight: 600;
      margin: 0.75rem 0 0.4rem;
      color: var(--theme-color-soft-text);
    }
    .subhead:first-child {
      margin-top: 0;
    }
    code {
      font-family: monospace;
      font-size: 0.85em;
    }
    .create-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .create-row .prefix {
      font-family: monospace;
      color: var(--theme-color-soft-text);
    }
    .create-row .suffix {
      flex: 1;
      min-width: 8rem;
    }
    .create-row .group {
      min-width: 10rem;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--theme-default-border-radius);
      margin-bottom: 0.5rem;
    }
    .notice.warn {
      background: color-mix(in srgb, var(--theme-color-warning) 18%, transparent);
      border: 1px solid var(--theme-color-warning);
    }
    .msg {
      margin: 0.5rem 0;
      font-size: 0.85rem;
    }
    .msg.ok {
      color: var(--theme-color-success);
    }
    .msg.err {
      color: var(--theme-color-alarm);
    }
    .hint {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
      padding: 0.5rem 0;
    }
    .center {
      display: flex;
      justify-content: center;
      padding: 1.5rem;
    }
    .list {
      max-height: 40vh;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.375rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: middle;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--theme-color-2);
      z-index: 1;
    }
    td.name {
      font-family: monospace;
      word-break: break-all;
    }
    td.actions {
      text-align: right;
      white-space: nowrap;
    }
    .badge {
      margin-left: 0.4rem;
      padding: 0.05rem 0.4rem;
      border-radius: 0.7rem;
      font-size: 0.65rem;
      font-family: var(--theme-font-family, sans-serif);
      color: var(--theme-color-warning);
      border: 1px solid var(--theme-color-warning);
    }
  `;
}
