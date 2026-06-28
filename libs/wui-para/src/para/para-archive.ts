// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA Archiving tab — enable/disable NGA value archiving per DP or DPE and
 * assign an archive group.
 *
 * Left: the Type→DP→element tree (wui-para-nav, no DPL checkboxes). Right: for
 * the selected datapoint/element, one row per leaf DPE with an archive-group
 * select and an on/off toggle.
 *
 * The archive config writes mirror the proven fleet-core logic (verified
 * DPCONFIG/DPATTR constants) and go through the same PARA REST endpoint
 * (`/api/para/dp/set`). Active archive groups are the `_NGA_Group` DP instances
 * whose `.active` flag is set.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import { type DpStruct, collectLeaves, leavesUnder, makeDpeName, splitDpPath, stripSystem } from './para-leaves.js';
import './para-nav.js';

const DP_SET_URL = '/api/para/dp/set';
/** WinCC OA archive-config constants (CTRL DPCONFIG/DPATTR values). */
const ARCHIVE_INFO = 45; // DPCONFIG_DB_ARCHIVEINFO
const ARCH_PROC_VALARCH = 15; // DPATTR_ARCH_PROC_VALARCH (NGA value archive)
/** Upper bound on rows rendered at once. */
const MAX_ROWS = 300;

interface ArchiveRow {
  dpe: string;
  display: string;
  enabled: boolean;
  group: string;
}

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function scalarText(raw: unknown): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && typeof v === 'object' && 'value' in v) {
    return scalarText((v as { value: unknown }).value);
  }
  return v == null ? '' : String(v);
}

function archiveFlag(raw: unknown): boolean {
  const v = scalarText(raw).toLowerCase();
  return v === 'true' || v === '1';
}

function bareName(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}

export class WuiParaArchive extends LitElement {
  static override readonly styles = [IXCoreStyles, archiveStyles()];

  @property({ type: Number }) reloadToken = 0;

  @state() private selectedDp: string | null = null;
  @state() private selectedType: string | null = null;
  @state() private ownerType: string | null = null;
  @state() private groups: string[] = [];
  @state() private rows: ArchiveRow[] = [];
  @state() private loading = false;
  @state() private message = '';
  @state() private messageOk = false;

  private readonly api = container.resolve<OaRxJsApi>(OaRxJsApi);
  private readonly dpe = container.resolve<WuiDpeService>(WuiDpeService);

  private get navKey(): string | null {
    if (this.selectedType != null) {
      return `type:${this.selectedType}`;
    }
    return this.selectedDp == null ? null : `path:${this.selectedDp}`;
  }

  override render(): TemplateResult {
    return html`
      <div class="split">
        <wui-para-nav
          class="nav"
          .showExport=${false}
          .selected=${this.navKey}
          .reloadToken=${this.reloadToken}
          @wui:select=${this.onSelect}
        ></wui-para-nav>
        <section class="panel">${this.renderPanel()}</section>
      </div>
    `;
  }

  private renderPanel(): TemplateResult {
    if (this.selectedDp == null && this.selectedType == null) {
      return html`<div class="message">Sélectionnez un datapoint, un élément ou un type dans l'arbre pour configurer son archivage.</div>`;
    }
    if (this.loading) {
      return html`<div class="message">Chargement…</div>`;
    }
    return html`
      <div class="panel-head">
        <ix-icon name="database" size="20"></ix-icon>
        <span class="sel">${this.selectedDp ?? this.selectedType}</span>
        ${this.groups.length === 0
          ? html`<span class="warn">Aucun groupe d'archive actif (type _NGA_Group)</span>`
          : nothing}
        ${this.message === '' ? nothing : html`<span class="msg ${this.messageOk ? 'ok' : 'err'}">${this.message}</span>`}
      </div>
      ${this.rows.length === 0
        ? html`<div class="message">Aucun élément à valeur sous cette sélection.</div>`
        : html`<div class="scroll">
            <table>
              <thead>
                <tr><th>Élément</th><th>Groupe d'archive</th><th>Archivé</th></tr>
              </thead>
              <tbody>
                ${this.rows.map((row) => this.renderRow(row))}
              </tbody>
            </table>
          </div>`}
    `;
  }

  private renderRow(row: ArchiveRow): TemplateResult {
    const group = row.group || this.groups[0] || '';
    return html`
      <tr>
        <td class="element" title=${row.dpe}>${row.display}</td>
        <td>
          <ix-select
            mode="single"
            ?disabled=${this.groups.length === 0}
            .value=${group}
            @valueChange=${(e: CustomEvent) => this.changeGroup(row, String(e.detail))}
          >
            ${this.groups.map((g) => html`<ix-select-item label=${g} value=${g}></ix-select-item>`)}
          </ix-select>
        </td>
        <td>
          <ix-toggle
            .checked=${row.enabled}
            ?disabled=${this.groups.length === 0}
            @checkedChange=${(e: Event) => this.toggle(row, (e.target as HTMLInputElement).checked, group)}
          ></ix-toggle>
        </td>
      </tr>
    `;
  }

  private onSelect(event: CustomEvent<{ kind: 'type' | 'dp' | 'element'; path: string; type?: string }>): void {
    const { kind, path, type } = event.detail;
    if (kind === 'type') {
      // Selecting a type configures every DPE of every instance of that type.
      this.selectedType = path;
      this.selectedDp = null;
      this.ownerType = null;
    } else {
      this.selectedType = null;
      this.selectedDp = path;
      this.ownerType = type != null && type !== '' ? type : null;
    }
    void this.loadPanel();
  }

  private async loadPanel(): Promise<void> {
    this.loading = true;
    this.message = '';
    try {
      this.groups = await this.listGroups();
      const targets = await this.resolveTargets();
      const rows: ArchiveRow[] = [];
      for (const target of targets) {
        // eslint-disable-next-line no-await-in-loop -- sequential keeps the dp/set load gentle
        const status = await this.readStatus(target.dpe);
        rows.push({ dpe: target.dpe, display: target.display, enabled: status.enabled, group: status.group });
      }
      this.rows = rows;
    } catch (error) {
      this.rows = [];
      this.setMessage(`Erreur de chargement : ${error instanceof Error ? error.message : String(error)}`, false);
    } finally {
      this.loading = false;
    }
  }

  /** Resolve the target DPEs: every instance×leaf for a type, or the leaves under a DP/element. */
  private async resolveTargets(): Promise<{ dpe: string; display: string }[]> {
    if (this.selectedType != null) {
      const type = this.selectedType;
      const struct = (await firstValueFrom(this.dpe.getDatapointTypes(type))) as DpStruct;
      const dps = (await firstValueFrom(this.dpe.listDatapoints(type))) as string[];
      const leaves = collectLeaves(struct, '');
      const out: { dpe: string; display: string }[] = [];
      for (const dp of [...dps].sort((a, b) => a.localeCompare(b))) {
        for (const leaf of leaves) {
          out.push({ dpe: makeDpeName(dp, leaf.relPath), display: `${stripSystem(dp)}${leaf.relPath ? `.${leaf.relPath}` : '.'}` });
          if (out.length >= MAX_ROWS) {
            return out;
          }
        }
      }
      return out;
    }
    const dp = this.selectedDp;
    if (dp == null) {
      return [];
    }
    if (this.ownerType == null || this.ownerType === '') {
      throw new Error("Type du datapoint inconnu — re-sélectionnez l'élément.");
    }
    const struct = (await firstValueFrom(this.dpe.getDatapointTypes(this.ownerType))) as DpStruct;
    const { root, relPath } = splitDpPath(dp);
    return leavesUnder(struct, relPath)
      .slice(0, MAX_ROWS)
      .map((leaf) => {
        const dpe = makeDpeName(root, leaf.relPath);
        return { dpe, display: this.displayName(dpe, dp) };
      });
  }

  /** Active NGA archive groups (bare names of `_NGA_Group` DPs with `.active` set). */
  private async listGroups(): Promise<string[]> {
    try {
      const names = (await firstValueFrom(this.api.dpNames('*', '_NGA_Group'))) as string[];
      const groups = names
        .map((n) => bareName(n))
        .filter((n) => n !== '' && !n.endsWith('_2'))
        .sort((a, b) => a.localeCompare(b));
      if (groups.length === 0) {
        return [];
      }
      // Keep only ACTIVE groups that are NOT specialized for alerts (`isAlert`).
      const activeRaw = await firstValueFrom(this.api.dpGet(groups.map((g) => `${g}.active`)));
      const alertRaw = await firstValueFrom(this.api.dpGet(groups.map((g) => `${g}.isAlert`)));
      const actives = Array.isArray(activeRaw) ? activeRaw : [activeRaw];
      const alerts = Array.isArray(alertRaw) ? alertRaw : [alertRaw];
      return groups.filter((_g, i) => archiveFlag(actives[i]) && !archiveFlag(alerts[i]));
    } catch {
      return [];
    }
  }

  private async readStatus(dpe: string): Promise<{ enabled: boolean; group: string }> {
    try {
      const raw = await firstValueFrom(this.api.dpGet([`${dpe}:_archive.._archive`, `${dpe}:_archive.1._class`]));
      const values = Array.isArray(raw) ? raw : [raw];
      return { enabled: archiveFlag(values[0]), group: bareName(scalarText(values[1])) };
    } catch {
      return { enabled: false, group: '' };
    }
  }

  private async setArchive(dpe: string, enabled: boolean, group: string): Promise<boolean> {
    try {
      await (enabled ? this.send({
          dpeNames: [`${dpe}:_archive.._type`, `${dpe}:_archive.1._type`, `${dpe}:_archive.1._class`, `${dpe}:_archive.._archive`],
          values: [ARCHIVE_INFO, ARCH_PROC_VALARCH, group, true]
        }) : this.send({ dpeName: `${dpe}:_archive.._archive`, value: false }));
      return true;
    } catch {
      return false;
    }
  }

  private async send(body: object): Promise<void> {
    const res = await fetch(DP_SET_URL, jsonPost(body));
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.ok !== true) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
  }

  private async toggle(row: ArchiveRow, enabled: boolean, group: string): Promise<void> {
    if (this.groups.length === 0) {
      return;
    }
    const ok = await this.setArchive(row.dpe, enabled, group);
    this.setMessage(ok ? `${enabled ? 'Archivage activé' : 'Archivage désactivé'} : ${row.display}` : `Échec sur ${row.display}`, ok);
    await this.refreshRow(row.dpe);
  }

  private async changeGroup(row: ArchiveRow, group: string): Promise<void> {
    const ok = await this.setArchive(row.dpe, true, group);
    this.setMessage(ok ? `Groupe « ${group} » : ${row.display}` : `Échec sur ${row.display}`, ok);
    await this.refreshRow(row.dpe);
  }

  private async refreshRow(dpe: string): Promise<void> {
    const status = await this.readStatus(dpe);
    this.rows = this.rows.map((r) => (r.dpe === dpe ? { ...r, enabled: status.enabled, group: status.group } : r));
  }

  private displayName(dpe: string, selectedDp: string): string {
    const local = stripSystem(dpe);
    const base = stripSystem(selectedDp);
    if (local === base || local === `${base}.`) {
      return base.split('.').at(-1) || base;
    }
    return local.startsWith(`${base}.`) ? local.slice(base.length + 1) : local;
  }

  private setMessage(message: string, ok: boolean): void {
    this.message = message;
    this.messageOk = ok;
  }
}

function archiveStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .split {
      display: flex;
      height: 100%;
      min-height: 0;
    }
    .nav {
      width: 22rem;
      flex-shrink: 0;
    }
    .panel {
      flex: 1;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      flex-shrink: 0;
    }
    .sel {
      font-weight: 600;
      word-break: break-all;
    }
    .warn {
      color: var(--theme-color-warning, #d9822b);
      font-size: 0.8125rem;
    }
    .msg {
      font-size: 0.8125rem;
    }
    .msg.ok {
      color: var(--theme-color-success);
    }
    .msg.err {
      color: var(--theme-color-alarm);
    }
    .scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      text-align: left;
      padding: 0.375rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      font-size: 0.875rem;
      vertical-align: middle;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--theme-color-2);
      z-index: 1;
    }
    td.element {
      font-family: monospace;
      word-break: break-all;
    }
    .message {
      padding: 1rem;
      color: var(--theme-color-soft-text);
    }
  `;
}

if (!customElements.get('wui-para-archive')) {
  customElements.define('wui-para-archive', WuiParaArchive);
}
