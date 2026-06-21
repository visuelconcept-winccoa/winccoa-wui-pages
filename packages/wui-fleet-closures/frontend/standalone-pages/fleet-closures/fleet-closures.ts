/**
 * Non-Worked Periods (Jours non travaillés) — Standalone page (WinCC OA WebUI).
 *
 * Reached from the Machine Fleet 3D overview ("Jours non travaillés"). Manages
 * the closures (non-worked periods) that reduce a machine's opening time — the
 * denominator of the availability-TRS used by the KPI page. Closures are defined
 * per atelier (applies to all its machines) or per machine, and persisted as one
 * app-level JSON datapoint via the {@link FleetStore} (shared with the KPI page,
 * which reads them for the TRS computation).
 *
 * Features: a single editable table of every closure range (scope · start · end
 * · duration), filters on year / atelier / machine (multi-select), inline edit
 * of scope and bounds, add / delete, and JSON import / export. On import, if any
 * incoming range overlaps an existing one in the same scope, the user is asked to
 * replace, ignore (keep existing, add only non-conflicting), or cancel.
 *
 * Registered at `/fleet-closures` (component `wui-fleet-closures`).
 */
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { pageStyles } from './_vendor/wui-fleet-core/styles.js';
import { FleetStore } from './_vendor/wui-fleet-core/data/fleet-store.js';
import type { Atelier } from './_vendor/wui-fleet-core/types.js';
import {
  emptyClosureConfig,
  hasOverlap,
  mergeClosures,
  normaliseClosures,
  strictlyContains,
  type ClosureConfig,
  type ClosureRange
} from './_vendor/wui-fleet-core/closures.js';

const DATE_FORMAT = 'yyyy-MM-dd';
const TIME_FORMAT = 'HH:mm';
const DEFAULT_START_TIME = '00:00';
const DEFAULT_END_TIME = '23:59';
const ALL_YEARS = 0;
const MS_PER_HOUR = 60 * 60 * 1000;
const HOURS_PER_DAY = 24;

/** "All years" + the descending list of years offered by the year filter. */
const YEAR_SPAN_BACK = 2;
const YEAR_SPAN_FWD = 1;

/** A flattened, addressable closure row (scope + position within its bucket). */
interface FlatRow {
  scope: string;
  label: string;
  atelierId: string;
  machineId: string;
  index: number;
  range: ClosureRange;
}

/** Scope option: `a:<atelierId>` (atelier-wide) or `m:<machineId>` (one machine). */
interface ScopeOption {
  key: string;
  label: string;
}

interface IxValueEvent {
  detail: string | string[];
}

/** Coerce an ix-select value (string | string[]) to a string array. */
function toList(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function firstOf(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

@customElement('wui-fleet-closures')
export class WuiFleetClosures extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles(), extraStyles()];

  @state() private ateliers: Atelier[] = [];
  @state() private working: ClosureConfig = emptyClosureConfig();
  @state() private selectedAteliers: string[] = [];
  @state() private selectedMachines: string[] = [];
  @state() private year = ALL_YEARS;
  @state() private addScope = '';
  @state() private loading = false;
  @state() private offline = false;
  @state() private dirty = false;
  @state() private saving = false;
  @state() private toast = '';
  /** Pending import awaiting an overlap decision. */
  @state() private pendingImport: ClosureConfig | null = null;

  private readonly store = new FleetStore();

  override connectedCallback(): void {
    super.connectedCallback();
    this.year = new Date().getFullYear();
  }

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: { 'en_US.utf8': 'Non-Worked Periods', 'fr.utf8': 'Jours non travaillés' }
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      <div class="body">
        ${this.renderToolbar()} ${this.renderOffline()} ${this.renderTable()}
        ${this.renderOverlapDialog()} ${this.renderToast()}
      </div>
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.bootstrap();
  }

  private renderToolbar(): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" outline @click=${this.back}>
          <ix-icon name="arrow-left" slot="icon"></ix-icon>Retour
        </ix-button>
        <span class="sep"></span>
        ${this.renderYearField()} ${this.renderAtelierField()} ${this.renderMachineField()}
        <span class="grow"></span>
        <ix-button variant="secondary" outline @click=${this.triggerImport}>
          <ix-icon name="upload" slot="icon"></ix-icon>Importer
        </ix-button>
        <ix-button variant="secondary" outline @click=${this.exportJson}>
          <ix-icon name="download" slot="icon"></ix-icon>Exporter
        </ix-button>
        <ix-button @click=${() => void this.save()} ?disabled=${!this.dirty || this.saving}>
          <ix-icon name="save" slot="icon"></ix-icon>Enregistrer
        </ix-button>
      </div>
      <input
        id="import-file"
        type="file"
        accept="application/json,.json"
        hidden
        @change=${this.onImportFile}
      />
    `;
  }

  private renderYearField(): TemplateResult {
    return html`
      <label class="field">
        <span class="lbl">Année</span>
        <ix-select
          .value=${String(this.year)}
          @valueChange=${(e: IxValueEvent) => (this.year = Number(firstOf(e.detail)) || ALL_YEARS)}
        >
          <ix-select-item value=${String(ALL_YEARS)} label="Toutes les années"></ix-select-item>
          ${this.yearOptions().map(
            (y) => html`<ix-select-item value=${String(y)} label=${String(y)}></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  private renderAtelierField(): TemplateResult {
    return html`
      <label class="field">
        <span class="lbl">Ateliers</span>
        <ix-select
          mode="multiple"
          allow-clear
          i18n-placeholder="Tous les ateliers"
          .value=${this.selectedAteliers}
          @valueChange=${(e: IxValueEvent) => this.onSelect('ateliers', e.detail)}
        >
          ${this.ateliers.map(
            (a) => html`<ix-select-item value=${a.id} label=${a.name}></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  private renderMachineField(): TemplateResult {
    return html`
      <label class="field">
        <span class="lbl">Machines</span>
        <ix-select
          mode="multiple"
          allow-clear
          i18n-placeholder="Toutes les machines"
          .value=${this.selectedMachines}
          @valueChange=${(e: IxValueEvent) => this.onSelect('machines', e.detail)}
        >
          ${this.machineOptions().map(
            (m) => html`<ix-select-item value=${m.id} label=${m.label}></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  private renderOffline(): TemplateResult {
    if (!this.offline) return html``;
    return html`<div class="notice">
      <ix-icon name="info"></ix-icon>Mode hors-ligne : la configuration ne peut pas être lue ni
      enregistrée (backend non connecté).
    </div>`;
  }

  private renderTable(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const rows = this.visibleRows();
    return html`
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Périmètre</th>
              <th>Début</th>
              <th>Fin</th>
              <th class="num">Durée</th>
              <th class="num"></th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? html`<tr>
                  <td colspan="5" class="muted">Aucune période sur ce filtre.</td>
                </tr>`
              : rows.map((r) => this.renderRow(r))}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5">
                <ix-button variant="secondary" @click=${this.addRange}>
                  <ix-icon name="plus" slot="icon"></ix-icon>Ajouter une période
                </ix-button>
                <span class="foot-scope">
                  <span class="lbl">pour</span>
                  ${this.renderScopeSelect(this.currentAddScope(), (v) => (this.addScope = v))}
                </span>
                <span class="grow"></span>
                <span class="count">${rows.length} période(s)</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  private renderRow(r: FlatRow): TemplateResult {
    const start = splitDateTime(r.range.start);
    const end = splitDateTime(r.range.end);
    const covered = this.coveredReason(r);
    return html`
      <tr class=${covered ? 'covered' : ''}>
        <td>
          ${covered
            ? html`<ix-icon
                class="warn"
                name="warning"
                size="16"
                title=${covered}
              ></ix-icon>`
            : ''}
          ${this.renderScopeSelect(r.scope, (v) => this.moveScope(r, v))}
        </td>
        <td class="nowrap">
          <ix-date-input
            format=${DATE_FORMAT}
            .value=${start.date}
            @valueChange=${(e: IxValueEvent) => this.patchBound(r, 'start', 'date', e.detail)}
          ></ix-date-input>
          <ix-time-input
            format=${TIME_FORMAT}
            .value=${start.time}
            @valueChange=${(e: IxValueEvent) => this.patchBound(r, 'start', 'time', e.detail)}
          ></ix-time-input>
        </td>
        <td class="nowrap">
          <ix-date-input
            format=${DATE_FORMAT}
            .value=${end.date}
            @valueChange=${(e: IxValueEvent) => this.patchBound(r, 'end', 'date', e.detail)}
          ></ix-date-input>
          <ix-time-input
            format=${TIME_FORMAT}
            .value=${end.time}
            @valueChange=${(e: IxValueEvent) => this.patchBound(r, 'end', 'time', e.detail)}
          ></ix-time-input>
        </td>
        <td class="num">${formatSpan(r.range)}</td>
        <td class="num">
          <ix-icon-button
            ghost
            icon="trashcan"
            title="Supprimer"
            @click=${() => this.removeRange(r)}
          ></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private renderScopeSelect(value: string, onChange: (v: string) => void): TemplateResult {
    return html`
      <ix-select
        class="scope-select"
        .value=${value}
        @valueChange=${(e: IxValueEvent) => onChange(firstOf(e.detail))}
      >
        ${this.scopeOptions().map(
          (s) => html`<ix-select-item value=${s.key} label=${s.label}></ix-select-item>`
        )}
      </ix-select>
    `;
  }

  private renderOverlapDialog(): TemplateResult {
    if (!this.pendingImport) return html``;
    return html`
      <div class="overlay" @click=${() => (this.pendingImport = null)}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">Recouvrement de périodes</ix-typography>
          </div>
          <div class="panel-body">
            Certaines périodes importées chevauchent des périodes existantes. Que souhaitez-vous
            faire ?
            <ul class="hint">
              <li><strong>Remplacer</strong> : la configuration importée remplace l'existante.</li>
              <li>
                <strong>Ignorer</strong> : conserver l'existant, n'ajouter que les périodes sans
                chevauchement.
              </li>
              <li><strong>Annuler</strong> : ne rien importer.</li>
            </ul>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${() => (this.pendingImport = null)}>
              Annuler
            </ix-button>
            <ix-button variant="secondary" outline @click=${() => this.resolveImport('ignore')}>
              Ignorer
            </ix-button>
            <ix-button @click=${() => this.resolveImport('replace')}>Remplacer</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderToast(): TemplateResult {
    if (!this.toast) return html``;
    return html`<div class="toast">${this.toast}</div>`;
  }

  // --- data flow -------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    this.loading = true;
    this.ateliers = await this.store.listAteliers();
    this.offline = this.store.offline;
    this.working = normaliseClosures(await this.store.listClosures());
    this.addScope = this.scopeOptions()[0]?.key ?? '';
    this.loading = false;
  }

  private async save(): Promise<void> {
    if (this.offline) return;
    this.saving = true;
    const ok = await this.store.saveClosures(this.working);
    this.saving = false;
    if (ok) this.dirty = false;
    this.flash(ok ? 'Périodes enregistrées.' : "Échec de l'enregistrement.");
  }

  private readonly back = (): void => {
    this.dispatchEvent(new RouterEvent('/fleet-3d'));
  };

  // --- filtering -------------------------------------------------------------

  private visibleRows(): FlatRow[] {
    const ateliers = new Set(this.selectedAteliers);
    const machines = new Set(this.selectedMachines);
    return this.allRows().filter((r) => {
      const atelierOk = ateliers.size === 0 || ateliers.has(r.atelierId);
      const machineOk = machines.size === 0 || !r.machineId || machines.has(r.machineId);
      const yearOk = this.year === ALL_YEARS || rangeInYear(r.range, this.year);
      return atelierOk && machineOk && yearOk;
    });
  }

  private allRows(): FlatRow[] {
    const out: FlatRow[] = [];
    const multi = this.ateliers.length > 1;
    for (const a of this.ateliers) {
      for (const [index, range] of (this.working.ateliers[a.id] ?? []).entries()) {
        out.push({
          scope: `a:${a.id}`,
          label: `Atelier : ${a.name}`,
          atelierId: a.id,
          machineId: '',
          index,
          range
        });
      }
      for (const m of a.machines) {
        for (const [index, range] of (this.working.machines[m.id] ?? []).entries()) {
          out.push({
            scope: `m:${m.id}`,
            label: `${m.name}${multi ? ` · ${a.name}` : ''}`,
            atelierId: a.id,
            machineId: m.id,
            index,
            range
          });
        }
      }
    }
    return out;
  }

  /**
   * Non-empty message when this range is subsumed (and therefore ignored at
   * computation time): a strictly larger range exists in the same effective set
   * — for a machine range, that includes its atelier-wide ranges.
   */
  private coveredReason(r: FlatRow): string {
    const cover = this.coveringCandidates(r).find((c) => strictlyContains(c.range, r.range));
    if (!cover) return '';
    const where = cover.kind === 'a' && r.machineId ? ' au niveau atelier' : '';
    return (
      `Période ignorée : entièrement couverte par une période plus large${where} ` +
      `(du ${formatDateTimeFr(cover.range.start)} au ${formatDateTimeFr(cover.range.end)}).`
    );
  }

  /** Ranges that could subsume `r` (its effective set, excluding `r` itself). */
  private coveringCandidates(r: FlatRow): { range: ClosureRange; kind: 'a' | 'm' }[] {
    const [kind, id] = splitScope(r.scope);
    const out: { range: ClosureRange; kind: 'a' | 'm' }[] = [];
    const sameBucket = kind === 'a' ? this.working.ateliers[id] : this.working.machines[id];
    for (const [i, range] of (sameBucket ?? []).entries()) {
      if (i !== r.index) out.push({ range, kind: kind === 'a' ? 'a' : 'm' });
    }
    // A machine range is also covered by any atelier-wide range of its atelier.
    if (kind === 'm') {
      for (const range of this.working.ateliers[r.atelierId] ?? []) out.push({ range, kind: 'a' });
    }
    return out;
  }

  private scopeOptions(): ScopeOption[] {
    const multi = this.ateliers.length > 1;
    const out: ScopeOption[] = [];
    for (const a of this.ateliers) {
      out.push({ key: `a:${a.id}`, label: `Atelier : ${a.name}` });
      for (const m of a.machines) {
        out.push({ key: `m:${m.id}`, label: `   ${m.name}${multi ? ` · ${a.name}` : ''}` });
      }
    }
    return out;
  }

  private machineOptions(): { id: string; label: string }[] {
    const selected = new Set(this.selectedAteliers);
    const out: { id: string; label: string }[] = [];
    for (const a of this.ateliers) {
      if (selected.size > 0 && !selected.has(a.id)) continue;
      for (const m of a.machines) {
        out.push({ id: m.id, label: this.ateliers.length > 1 ? `${m.name} · ${a.name}` : m.name });
      }
    }
    return out;
  }

  private yearOptions(): number[] {
    const now = new Date().getFullYear();
    const years = new Set<number>();
    for (let y = now - YEAR_SPAN_BACK; y <= now + YEAR_SPAN_FWD; y++) years.add(y);
    for (const row of this.allRows()) {
      const y = new Date(row.range.start).getFullYear();
      if (Number.isFinite(y)) years.add(y);
    }
    return [...years].sort((a, b) => b - a);
  }

  private currentAddScope(): string {
    const options = this.scopeOptions();
    if (this.addScope && options.some((o) => o.key === this.addScope)) return this.addScope;
    return options[0]?.key ?? '';
  }

  private onSelect(which: 'ateliers' | 'machines', value: string | string[]): void {
    const list = toList(value);
    if (which === 'ateliers') {
      this.selectedAteliers = list;
      const allowed = new Set(this.machineOptions().map((m) => m.id));
      this.selectedMachines = this.selectedMachines.filter((id) => allowed.has(id));
    } else {
      this.selectedMachines = list;
    }
  }

  // --- range mutation --------------------------------------------------------

  private rangesFor(scope: string): ClosureRange[] {
    const [kind, id] = splitScope(scope);
    if (!id) return [];
    const bucket = kind === 'a' ? this.working.ateliers : this.working.machines;
    return bucket[id] ?? [];
  }

  private setRangesFor(scope: string, ranges: ClosureRange[]): void {
    const [kind, id] = splitScope(scope);
    if (!id) return;
    const key = kind === 'a' ? 'ateliers' : 'machines';
    this.working = { ...this.working, [key]: { ...this.working[key], [id]: ranges } };
    this.dirty = true;
  }

  private addRange = (): void => {
    const scope = this.currentAddScope();
    if (!scope) return;
    const today = new Date().toISOString().slice(0, 10);
    const range: ClosureRange = {
      start: `${today}T${DEFAULT_START_TIME}`,
      end: `${today}T${DEFAULT_END_TIME}`
    };
    this.setRangesFor(scope, [...this.rangesFor(scope), range]);
  };

  private removeRange(r: FlatRow): void {
    this.setRangesFor(
      r.scope,
      this.rangesFor(r.scope).filter((_, i) => i !== r.index)
    );
  }

  private moveScope(r: FlatRow, newScope: string): void {
    if (newScope === r.scope) return;
    const moved = this.rangesFor(r.scope)[r.index];
    if (!moved) return;
    // Remove from the old bucket first, then append to the new one.
    this.setRangesFor(
      r.scope,
      this.rangesFor(r.scope).filter((_, i) => i !== r.index)
    );
    this.setRangesFor(newScope, [...this.rangesFor(newScope), moved]);
  }

  private patchBound(
    r: FlatRow,
    bound: 'start' | 'end',
    part: 'date' | 'time',
    value: string | string[]
  ): void {
    const v = firstOf(value);
    const ranges = this.rangesFor(r.scope).map((range, i) => {
      if (i !== r.index) return range;
      const current = splitDateTime(range[bound]);
      const next = part === 'date' ? { ...current, date: v } : { ...current, time: v.slice(0, 5) };
      return { ...range, [bound]: joinDateTime(next.date, next.time) };
    });
    this.setRangesFor(r.scope, ranges);
  }

  // --- import / export -------------------------------------------------------

  private readonly triggerImport = (): void => {
    this.renderRoot.querySelector<HTMLInputElement>('#import-file')?.click();
  };

  private readonly onImportFile = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void file
      .text()
      .then((text) => this.applyImport(text))
      .catch(() => this.flash('Fichier illisible.'));
  };

  private applyImport(text: string): void {
    let incoming: ClosureConfig;
    try {
      incoming = normaliseClosures(JSON.parse(text));
    } catch {
      this.flash('JSON invalide.');
      return;
    }
    if (hasOverlap(this.working, incoming)) {
      this.pendingImport = incoming;
      return;
    }
    this.working = mergeClosures(this.working, incoming, 'ignore');
    this.dirty = true;
    this.flash('Périodes importées.');
  }

  private resolveImport(mode: 'replace' | 'ignore'): void {
    if (!this.pendingImport) return;
    this.working = mergeClosures(this.working, this.pendingImport, mode);
    this.pendingImport = null;
    this.dirty = true;
    this.flash(mode === 'replace' ? 'Configuration remplacée.' : 'Périodes non conflictuelles ajoutées.');
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.working, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jours-non-travailles.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private flash(message: string): void {
    this.toast = message;
    window.setTimeout(() => (this.toast = ''), TOAST_MS);
  }
}

const TOAST_MS = 2500;

/** Split a scope key `a:<id>` / `m:<id>` into [kind, id]. */
function splitScope(scope: string): ['a' | 'm' | '', string] {
  const sep = scope.indexOf(':');
  if (sep === -1) return ['', ''];
  const kind = scope.slice(0, sep);
  return [kind === 'a' || kind === 'm' ? kind : '', scope.slice(sep + 1)];
}

/** Split `yyyy-MM-ddTHH:mm` → { date, time }. */
function splitDateTime(value: string): { date: string; time: string } {
  const [date, time] = (value || '').split('T');
  return { date: date ?? '', time: (time ?? '').slice(0, 5) };
}

/** Join a date + time into `yyyy-MM-ddTHH:mm` (empty date → empty string). */
function joinDateTime(date: string, time: string): string {
  if (!date) return '';
  return `${date}T${time || DEFAULT_START_TIME}`;
}

/** True when a range intersects the calendar `year`. */
function rangeInYear(range: ClosureRange, year: number): boolean {
  const s = Date.parse(range.start);
  const e = Date.parse(range.end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  return s < yearEnd && e >= yearStart;
}

/** Format a `yyyy-MM-ddTHH:mm` value as a French date+time (e.g. "08/06/2026 14:32"). */
function formatDateTimeFr(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Human-readable duration of a range (e.g. "2 j 4 h" or "6 h"). */
function formatSpan(range: ClosureRange): string {
  const s = Date.parse(range.start);
  const e = Date.parse(range.end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return '—';
  const hours = Math.round((e - s) / MS_PER_HOUR);
  const days = Math.floor(hours / HOURS_PER_DAY);
  const rem = hours % HOURS_PER_DAY;
  if (days > 0) return rem > 0 ? `${days} j ${rem} h` : `${days} j`;
  return `${hours} h`;
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .scope-select {
      min-width: 14rem;
    }
    .tbl tr.covered td {
      opacity: 0.6;
    }
    .tbl td .warn {
      color: var(--theme-color-warning, #f59e0b);
      vertical-align: middle;
      margin-right: 0.35rem;
      cursor: help;
    }
    .tbl td ix-date-input,
    .tbl td ix-time-input {
      display: inline-block;
      vertical-align: middle;
    }
    .tbl td ix-time-input {
      width: 6rem;
      margin-left: 0.35rem;
    }
    .tbl tfoot td {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .foot-scope {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-weight: 400;
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .panel {
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      width: 520px;
      max-width: 92vw;
      display: flex;
      flex-direction: column;
    }
    .panel-head,
    .panel-body,
    .panel-foot {
      padding: 1rem;
    }
    .panel-foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
    .panel .hint {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
      margin: 0.5rem 0 0;
      padding-left: 1.1rem;
    }
    .toast {
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%);
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.5rem 1rem;
      z-index: 1100;
    }
  `;
}
