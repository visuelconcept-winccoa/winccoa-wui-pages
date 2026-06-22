/**
 * PARA Alarming tab — configure `_alert_hdl` per DP/DPE.
 *
 * Left: the Type→DP→element tree (wui-para-nav, no DPL checkboxes). Right: for
 * the selected datapoint/element, one row per leaf DPE:
 *   - BOOL elements  -> binary alert (alarm on TRUE/FALSE) + alarm class.
 *   - numeric elements -> analog alert (1-3 thresholds) + alarm class + direction.
 *
 * The config writes replicate the proven `alarm_set.js` MCP tool (verified
 * DPCONFIG/range constants) and go through `/api/para/dp/set`. Alarm classes are
 * the `_AlertClass` DP instances; the `_class` attribute stores `<className>.`
 * (trailing dot, the WinCC OA alert-class reference notation).
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
/** Verified _alert_hdl constants (see backend mcpServer constants.js). */
const ALERT_BINARY = 12; // DPCONFIG_ALERT_BINARYSIGNAL
const ALERT_ANALOG = 13; // DPCONFIG_ALERT_NONBINARYSIGNAL
const RANGE_MINMAX = 4; // DPDETAIL_RANGETYPE_MINMAX
const MAX_ROWS = 300;
const MAX_THRESHOLDS = 3;

/** Min/max bounds per numeric WinCC OA type (for the outer analog ranges). */
const NUMERIC_BOUNDS: Record<string, [number, number]> = {
  char: [-128, 127],
  int: [-32_768, 32_767],
  uint: [0, 65_535],
  long: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ulong: [0, Number.MAX_SAFE_INTEGER],
  float: [-3.4e38, 3.4e38]
};

type AlarmCategory = 'binary' | 'analog' | 'none';
type AlarmDir = 'ASC' | 'DESC';

interface AlarmRow {
  dpe: string;
  display: string;
  category: AlarmCategory;
  /** WinCC OA scalar type (e.g. 'float', 'int') — drives the analog range bounds. */
  baseType: string;
  active: boolean;
  alarmClass: string;
  direction: AlarmDir;
  thresholds: string;
  busy: boolean;
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

function bareName(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}

function categoryOf(baseType: string): AlarmCategory {
  if (baseType === 'bool') {
    return 'binary';
  }
  return baseType in NUMERIC_BOUNDS ? 'analog' : 'none';
}

export class WuiParaAlarm extends LitElement {
  static override readonly styles = [IXCoreStyles, alarmStyles()];

  @property({ type: Number }) reloadToken = 0;

  @state() private selectedDp: string | null = null;
  @state() private selectedType: string | null = null;
  @state() private ownerType: string | null = null;
  @state() private classes: string[] = [];
  @state() private rows: AlarmRow[] = [];
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
      return html`<div class="message">Sélectionnez un datapoint, un élément ou un type dans l'arbre pour configurer ses alarmes.</div>`;
    }
    if (this.loading) {
      return html`<div class="message">Chargement…</div>`;
    }
    return html`
      <div class="panel-head">
        <ix-icon name="bell" size="20"></ix-icon>
        <span class="sel">${this.selectedDp ?? this.selectedType}</span>
        ${this.classes.length === 0
          ? html`<span class="warn">Aucune classe d'alarme (_AlertClass) trouvée</span>`
          : nothing}
        ${this.message === '' ? nothing : html`<span class="msg ${this.messageOk ? 'ok' : 'err'}">${this.message}</span>`}
      </div>
      ${this.rows.length === 0
        ? html`<div class="message">Aucun élément à valeur sous cette sélection.</div>`
        : html`<div class="scroll">
            <table>
              <thead>
                <tr><th>Élément</th><th>Type</th><th>Classe d'alarme</th><th>Déclenchement</th><th>Seuils</th><th>Statut</th><th></th></tr>
              </thead>
              <tbody>
                ${this.rows.map((row) => this.renderRow(row))}
              </tbody>
            </table>
          </div>`}
    `;
  }

  private renderRow(row: AlarmRow): TemplateResult {
    if (row.category === 'none') {
      return html`<tr class="muted">
        <td class="element" title=${row.dpe}>${row.display}</td>
        <td colspan="6">non alarmable</td>
      </tr>`;
    }
    const analog = row.category === 'analog';
    return html`
      <tr>
        <td class="element" title=${row.dpe}>${row.display}</td>
        <td class="muted">${analog ? 'analogique' : 'binaire'}</td>
        <td>
          <ix-select
            mode="single"
            ?disabled=${this.classes.length === 0}
            .value=${row.alarmClass}
            @valueChange=${(e: CustomEvent) => this.patchRow(row.dpe, { alarmClass: String(e.detail) })}
          >
            ${this.classes.map((c) => html`<ix-select-item label=${c} value=${c}></ix-select-item>`)}
          </ix-select>
        </td>
        <td>
          <ix-select
            mode="single"
            .value=${row.direction}
            @valueChange=${(e: CustomEvent) => this.patchRow(row.dpe, { direction: String(e.detail) as AlarmDir })}
          >
            ${analog
              ? html`<ix-select-item label="Haut (ASC)" value="ASC"></ix-select-item>
                  <ix-select-item label="Bas (DESC)" value="DESC"></ix-select-item>`
              : html`<ix-select-item label="si VRAI" value="ASC"></ix-select-item>
                  <ix-select-item label="si FAUX" value="DESC"></ix-select-item>`}
          </ix-select>
        </td>
        <td>
          ${analog
            ? html`<ix-input
                class="thresholds"
                .value=${row.thresholds}
                placeholder="ex. 80 ou 50,75,90"
                @valueChange=${(e: Event) => this.patchRow(row.dpe, { thresholds: (e.target as HTMLInputElement).value })}
              ></ix-input>`
            : html`<span class="muted">—</span>`}
        </td>
        <td class="status">${row.active ? html`<span class="on">actif</span>` : 'inactif'}</td>
        <td class="actions">
          <ix-button
            size="16"
            variant="primary"
            ?disabled=${row.busy || this.classes.length === 0}
            @click=${() => this.apply(row)}
          >Appliquer</ix-button>
          ${row.active
            ? html`<ix-button size="16" outline ?disabled=${row.busy} @click=${() => this.disable(row)}>Désactiver</ix-button>`
            : nothing}
        </td>
      </tr>
    `;
  }

  private onSelect(event: CustomEvent<{ kind: 'type' | 'dp' | 'element'; path: string; type?: string }>): void {
    const { kind, path, type } = event.detail;
    if (kind === 'type') {
      // Selecting a type configures every alarmable DPE of every instance.
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
      this.classes = await this.listClasses();
      const targets = await this.resolveTargets();
      const fallbackClass = this.classes.includes('alert') ? 'alert' : this.classes[0] ?? '';
      const rows: AlarmRow[] = [];
      for (const target of targets) {
        const category = categoryOf(target.baseType);
        if (category === 'none') {
          continue; // skip non-alarmable elements (string/time/blob/…)
        }
        // eslint-disable-next-line no-await-in-loop -- sequential keeps dp/set load gentle
        const current = await this.readCurrent(target.dpe);
        rows.push({
          dpe: target.dpe,
          display: target.display,
          category,
          baseType: target.baseType,
          active: current.active,
          alarmClass: current.alarmClass || fallbackClass,
          direction: 'ASC',
          thresholds: '',
          busy: false
        });
      }
      this.rows = rows;
    } catch (error) {
      this.rows = [];
      this.setMessage(`Erreur de chargement : ${error instanceof Error ? error.message : String(error)}`, false);
    } finally {
      this.loading = false;
    }
  }

  /** Resolve target DPEs (+ base type): every instance×leaf for a type, or leaves under a DP/element. */
  private async resolveTargets(): Promise<{ dpe: string; display: string; baseType: string }[]> {
    if (this.selectedType != null) {
      const type = this.selectedType;
      const struct = (await firstValueFrom(this.dpe.getDatapointTypes(type))) as DpStruct;
      const dps = (await firstValueFrom(this.dpe.listDatapoints(type))) as string[];
      const leaves = collectLeaves(struct, '');
      const out: { dpe: string; display: string; baseType: string }[] = [];
      for (const dp of [...dps].sort((a, b) => a.localeCompare(b))) {
        for (const leaf of leaves) {
          out.push({
            dpe: makeDpeName(dp, leaf.relPath),
            display: `${stripSystem(dp)}${leaf.relPath ? `.${leaf.relPath}` : '.'}`,
            baseType: leaf.type
          });
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
        return { dpe, display: this.displayName(dpe, dp), baseType: leaf.type };
      });
  }

  /** Alarm classes = bare names of the `_AlertClass` DP instances. */
  private async listClasses(): Promise<string[]> {
    try {
      const names = (await firstValueFrom(this.api.dpNames('*', '_AlertClass'))) as string[];
      return names
        .map((n) => bareName(n))
        .filter((n) => n !== '')
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  /** Read the current alert type/active/class to prefill a row. */
  private async readCurrent(dpe: string): Promise<{ active: boolean; alarmClass: string }> {
    try {
      const raw = await firstValueFrom(
        this.api.dpGet([`${dpe}:_alert_hdl.._type`, `${dpe}:_alert_hdl.._active`, `${dpe}:_alert_hdl.._class`])
      );
      const values = Array.isArray(raw) ? raw : [raw];
      const active = scalarText(values[1]).toLowerCase() === 'true' || scalarText(values[1]) === '1';
      // `_class` is stored as `<class>.`; strip the trailing dot for the select.
      const alarmClass = bareName(scalarText(values[2])).replace(/\.$/, '');
      return { active, alarmClass };
    } catch {
      return { active: false, alarmClass: '' };
    }
  }

  private patchRow(dpe: string, patch: Partial<AlarmRow>): void {
    this.rows = this.rows.map((r) => (r.dpe === dpe ? { ...r, ...patch } : r));
  }

  private async apply(row: AlarmRow): Promise<void> {
    if (row.alarmClass === '') {
      this.setMessage('Choisissez une classe d\'alarme.', false);
      return;
    }
    this.patchRow(row.dpe, { busy: true });
    try {
      await (row.category === 'binary' ? this.applyBinary(row) : this.applyAnalog(row));
      this.setMessage(`Alarme configurée : ${row.display}`, true);
      await this.refreshRow(row.dpe);
    } catch (error) {
      this.setMessage(`Échec sur ${row.display} : ${String(error)}`, false);
    } finally {
      this.patchRow(row.dpe, { busy: false });
    }
  }

  /** Binary alert: ok_range TRUE when alarming on FALSE (DESC), FALSE when on TRUE (ASC). */
  private async applyBinary(row: AlarmRow): Promise<void> {
    const okRange = row.direction === 'DESC';
    await this.send({
      dpeNames: [
        `${row.dpe}:_alert_hdl.._type`,
        `${row.dpe}:_alert_hdl.._class`,
        `${row.dpe}:_alert_hdl.._ok_range`,
        `${row.dpe}:_alert_hdl.._active`
      ],
      values: [ALERT_BINARY, `${row.alarmClass}.`, okRange, true]
    });
  }

  /** Analog alert: n thresholds -> n+1 MINMAX ranges (replicates alarm_set.js). */
  private async applyAnalog(row: AlarmRow): Promise<void> {
    const thresholds = this.parseThresholds(row.thresholds);
    if (thresholds.length === 0) {
      throw new Error('seuil(s) requis (ex. 80 ou 50,75,90)');
    }
    const [minValue, maxValue] = NUMERIC_BOUNDS[row.baseType] ?? NUMERIC_BOUNDS['float'];
    const cls = `${row.alarmClass}.`;
    await this.send({ dpeNames: [`${row.dpe}:_alert_hdl.._type`, `${row.dpe}:_alert_hdl.._orig_hdl`], values: [ALERT_ANALOG, false] });

    const dpes: string[] = [];
    const values: unknown[] = [];
    const asc = row.direction === 'ASC';
    for (let i = 1; i <= thresholds.length + 1; i += 1) {
      dpes.push(`${row.dpe}:_alert_hdl.${i}._type`);
      values.push(RANGE_MINMAX);
      dpes.push(`${row.dpe}:_alert_hdl.${i}._l_limit`);
      values.push(i === 1 ? minValue : thresholds[i - 2]);
      dpes.push(`${row.dpe}:_alert_hdl.${i}._u_limit`);
      values.push(i > thresholds.length ? maxValue : thresholds[i - 1]);
      if (asc) {
        dpes.push(`${row.dpe}:_alert_hdl.${i}._l_incl`);
        values.push(true);
        dpes.push(`${row.dpe}:_alert_hdl.${i}._u_incl`);
        values.push(i > thresholds.length);
        if (i > 1) {
          dpes.push(`${row.dpe}:_alert_hdl.${i}._class`);
          values.push(cls);
        }
      } else {
        dpes.push(`${row.dpe}:_alert_hdl.${i}._l_incl`);
        values.push(i === 1);
        dpes.push(`${row.dpe}:_alert_hdl.${i}._u_incl`);
        values.push(true);
        if (i <= thresholds.length) {
          dpes.push(`${row.dpe}:_alert_hdl.${i}._class`);
          values.push(cls);
        }
      }
    }
    await this.send({ dpeNames: dpes, values });
    await this.send({ dpeName: `${row.dpe}:_alert_hdl.._active`, value: true });
  }

  private async disable(row: AlarmRow): Promise<void> {
    this.patchRow(row.dpe, { busy: true });
    try {
      await this.send({ dpeName: `${row.dpe}:_alert_hdl.._active`, value: false });
      this.setMessage(`Alarme désactivée : ${row.display}`, true);
      await this.refreshRow(row.dpe);
    } catch (error) {
      this.setMessage(`Échec sur ${row.display} : ${String(error)}`, false);
    } finally {
      this.patchRow(row.dpe, { busy: false });
    }
  }

  private async send(body: object): Promise<void> {
    const res = await fetch(DP_SET_URL, jsonPost(body));
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.ok !== true) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
  }

  private parseThresholds(raw: string): number[] {
    return raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map(Number)
      .filter((n) => !Number.isNaN(n))
      .slice(0, MAX_THRESHOLDS)
      .sort((a, b) => a - b);
  }

  private async refreshRow(dpe: string): Promise<void> {
    const current = await this.readCurrent(dpe);
    this.rows = this.rows.map((r) => (r.dpe === dpe ? { ...r, active: current.active } : r));
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

function alarmStyles(): ReturnType<typeof css> {
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
    .muted {
      color: var(--theme-color-soft-text);
    }
    .thresholds {
      width: 9rem;
    }
    .status .on {
      color: var(--theme-color-success);
      font-weight: 600;
    }
    .actions {
      display: flex;
      gap: 0.25rem;
      white-space: nowrap;
    }
    .message {
      padding: 1rem;
      color: var(--theme-color-soft-text);
    }
  `;
}

if (!customElements.get('wui-para-alarm')) {
  customElements.define('wui-para-alarm', WuiParaAlarm);
}
