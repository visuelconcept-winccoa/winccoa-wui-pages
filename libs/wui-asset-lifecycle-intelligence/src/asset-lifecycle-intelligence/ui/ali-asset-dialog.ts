// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to create or edit one asset: field identity (MLFB, station, IP,
 * firmware) plus the structured risk inputs (lifecycle phase, firmware gap,
 * criticality, supply, vulnerabilities, hours/MTBF). A live risk-score preview
 * updates as inputs change. Emits `wui:save` with the edited asset, `wui:cancel`
 * on dismiss.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, daysMsg, dateLocale, localizeDir, obsLevelMsg } from '../i18n.js';
import { bandForLevel, computeRisk } from '../risk.js';
import {
  CRITICALITY_LABELS,
  FIRMWARE_LABELS,
  PHASE_LABELS,
  SOURCE_LABELS,
  SUPPLY_LABELS,
  VULN_LABELS,
  blankAsset,
  type Asset,
  type AssetSource,
  type Criticality,
  type FirmwareStatus,
  type LifecyclePhase,
  type SupplyStatus,
  type VulnSeverity
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';
import {
  assetPatchFromProductInfo,
  lookupProductInfo,
  type ProductInfoResult
} from '../data/product-info.js';

interface IxValueEvent {
  detail: string | number;
}

function options<T extends string>(labels: Record<T, MultiLangString>): { value: T; label: MultiLangString }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

/** Format an ISO date (or null) as a short date in the active UI language. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(dateLocale());
}

const PHASE_OPTIONS = options<LifecyclePhase>(PHASE_LABELS);
const FIRMWARE_OPTIONS = options<FirmwareStatus>(FIRMWARE_LABELS);
const CRITICALITY_OPTIONS = options<Criticality>(CRITICALITY_LABELS);
const SUPPLY_OPTIONS = options<SupplyStatus>(SUPPLY_LABELS);
const VULN_OPTIONS = options<VulnSeverity>(VULN_LABELS);
const SOURCE_OPTIONS = options<AssetSource>(SOURCE_LABELS);

@customElement('ali-asset-dialog')
export class AliAssetDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  /** Asset to edit; when null the dialog creates a new one. */
  @property({ attribute: false }) asset: Asset | null = null;

  /** Local working copy so parent re-renders never discard in-progress edits. */
  @state() private working: Asset = blankAsset();

  /** Siemens Product Information cross-reference state (by MLFB). */
  @state() private piResult: ProductInfoResult | null = null;
  @state() private piLoading = false;
  @state() private piError = '';

  // eslint-disable-next-line max-lines-per-function -- single form template
  override render(): TemplateResult {
    const risk = computeRisk(this.working);
    const band = bandForLevel(risk.level);
    const isNew = !this.asset;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${isNew
                ? localizeDir(MSG.dialog.newAsset)
                : html`${localizeDir(MSG.dialog.editPrefix)} — ${this.working.name}`}
            </ix-typography>
            <span class="score-badge" style="--c:${band.color}">
              ${risk.score} · ${localizeDir(band.label)}
            </span>
          </div>

          <div class="panel-body">
            <div class="subhead">${localizeDir(MSG.dialog.secIdentity)}</div>
            <div class="grid2">
              ${this.textField(MSG.dialog.fName, 'name')}
              ${this.textField(MSG.dialog.fMlfb, 'mlfb')}
              ${this.textField(MSG.dialog.fStation, 'station')}
              ${this.textField(MSG.dialog.fIp, 'ip')}
              ${this.textField(MSG.dialog.fArea, 'area')}
              ${this.textField(MSG.dialog.fAssetGroup, 'assetGroup')}
              ${this.textField(MSG.dialog.fSuccessor, 'successor')}
              ${this.textField(MSG.dialog.fFirmwareField, 'firmwareField')}
              ${this.textField(MSG.dialog.fFirmwareAvail, 'firmwareAvail')}
              ${this.selectField(MSG.dialog.fSource, 'source', SOURCE_OPTIONS)}
            </div>

            <div class="pi-bar">
              <ix-button
                variant="secondary"
                ?disabled=${this.piLoading || this.working.mlfb.trim() === ''}
                @click=${() => void this.crossReference()}
              >
                <ix-icon name="cloud-download" slot="icon"></ix-icon>${localizeDir(MSG.dialog.crossRef)}
              </ix-button>
              ${this.piLoading ? html`<ix-spinner size="small"></ix-spinner>` : ''}
              ${this.piError ? html`<span class="pi-error">${this.piError}</span>` : ''}
            </div>
            ${this.renderProductInfo()}

            <div class="subhead">${localizeDir(MSG.dialog.secRisk)}</div>
            <div class="grid2">
              ${this.selectField(MSG.dialog.fPhase, 'phase', PHASE_OPTIONS)}
              ${this.selectField(MSG.dialog.fFirmware, 'firmware', FIRMWARE_OPTIONS)}
              ${this.selectField(MSG.dialog.fCriticality, 'criticality', CRITICALITY_OPTIONS)}
              ${this.selectField(MSG.dialog.fSupply, 'supply', SUPPLY_OPTIONS)}
              ${this.selectField(MSG.dialog.fVuln, 'vuln', VULN_OPTIONS)}
              <span></span>
              ${this.numberField(MSG.dialog.fHours, 'operatingHours')}
              ${this.numberField(MSG.dialog.fMtbf, 'mtbfHours')}
            </div>

            <div class="subhead">${localizeDir(MSG.dialog.secNotes)}</div>
            <ix-input
              .value=${this.working.notes}
              @valueChange=${(e: IxValueEvent) => this.patch({ notes: String(e.detail) })}
            ></ix-input>
          </div>

          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.dialog.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${this.working.name.trim() === ''}>
              <ix-icon name="floppy-disk" slot="icon"></ix-icon>${localizeDir(MSG.dialog.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('asset')) {
      this.working = this.asset ? structuredClone(this.asset) : blankAsset();
      this.piResult = null;
      this.piError = '';
    }
  }

  /** Render the Siemens cross-reference panel (obsolescence + delivery). */
  private renderProductInfo(): TemplateResult {
    const r = this.piResult;
    if (!r) return html``;
    const obs = r.obsolescence;
    const del = r.delivery;
    return html`
      <div class="pi-panel">
        <div class="pi-head">
          <span class="subhead">${localizeDir(MSG.dialog.secSiemens)}</span>
          <span class="grow"></span>
          <ix-button variant="secondary" outline @click=${() => this.applyProductInfo()}>
            <ix-icon name="copy" slot="icon"></ix-icon>${localizeDir(MSG.dialog.applyFields)}
          </ix-button>
        </div>
        <div class="pi-grid">
          ${obs
            ? html`
                <div class="pi-kv"><span>${localizeDir(MSG.pi.purchasability)}</span><b>${obs.purchasabilityStatus}</b></div>
                <div class="pi-kv"><span>${localizeDir(MSG.pi.obsolescence)}</span><b>${localizeDir(obsLevelMsg(obs.obsolescenceLevel))}</b></div>
                <div class="pi-kv"><span>${localizeDir(MSG.pi.phaseOut)}</span><b>${fmtDate(obs.phaseOutAnnouncement)}</b></div>
                <div class="pi-kv"><span>${localizeDir(MSG.pi.cancellation)}</span><b>${fmtDate(obs.productCancellation)}</b></div>
                ${obs.successor
                  ? html`<div class="pi-kv"><span>${localizeDir(MSG.pi.successor)}</span><b>${obs.successor.productNumber}</b></div>`
                  : ''}
                ${obs.substitute
                  ? html`<div class="pi-kv"><span>${localizeDir(MSG.pi.substitute)}</span><b>${obs.substitute.productNumber}</b></div>`
                  : ''}
                ${obs.supportUrl
                  ? html`<div class="pi-kv"><span>${localizeDir(MSG.pi.support)}</span><a href=${obs.supportUrl} target="_blank" rel="noreferrer">${localizeDir(MSG.pi.open)}</a></div>`
                  : ''}
              `
            : html`<div class="pi-kv pi-warn"><span>${localizeDir(MSG.pi.obsolescence)}</span><b>${r.errors.obsolescence ?? localizeDir(MSG.pi.unavailable)}</b></div>`}
          ${del
            ? html`
                <div class="pi-kv"><span>${localizeDir(MSG.pi.newPartLead)}</span><b>${localizeDir(daysMsg(del.deliveryTimes.newPart))}</b></div>
                <div class="pi-kv"><span>${localizeDir(MSG.pi.sparePartLead)}</span><b>${localizeDir(daysMsg(del.deliveryTimes.sparePart))}</b></div>
                <div class="pi-kv"><span>${localizeDir(MSG.pi.newPartPrice)}</span><b>${del.prices.newPart ?? '—'}</b></div>
                <div class="pi-kv"><span>${localizeDir(MSG.pi.origin)}</span><b>${del.countryOfOrigin}</b></div>
                <div class="pi-kv"><span>${localizeDir(MSG.pi.eccn)}</span><b>${del.eccn}</b></div>
              `
            : html`<div class="pi-kv pi-warn"><span>${localizeDir(MSG.pi.delivery)}</span><b>${r.errors.delivery ?? localizeDir(MSG.pi.unavailable)}</b></div>`}
        </div>
      </div>
    `;
  }

  /** Fetch obsolescence + delivery for the asset's MLFB. */
  private async crossReference(): Promise<void> {
    const mlfb = this.working.mlfb.trim();
    if (!mlfb) return;
    this.piLoading = true;
    this.piError = '';
    try {
      this.piResult = await lookupProductInfo(mlfb, true);
    } catch (error) {
      this.piResult = null;
      this.piError = error instanceof Error ? error.message : String(error);
    } finally {
      this.piLoading = false;
    }
  }

  /** Apply the fetched data into the risk-input fields (phase / supply / successor / support). */
  private applyProductInfo(): void {
    if (!this.piResult) return;
    this.patch(assetPatchFromProductInfo(this.piResult));
  }

  private textField(label: MultiLangString, key: keyof Asset): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-input
          .value=${String(this.working[key] ?? '')}
          @valueChange=${(e: IxValueEvent) => this.patch({ [key]: String(e.detail) } as Partial<Asset>)}
        ></ix-input>
      </div>
    `;
  }

  private numberField(label: MultiLangString, key: 'operatingHours' | 'mtbfHours'): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-number-input
          .value=${this.working[key]}
          @valueChange=${(e: IxValueEvent) => this.patch({ [key]: Number(e.detail) } as Partial<Asset>)}
        ></ix-number-input>
      </div>
    `;
  }

  private selectField<T extends string>(
    label: MultiLangString,
    key: keyof Asset,
    opts: { value: T; label: MultiLangString }[]
  ): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-select
          .value=${String(this.working[key])}
          @valueChange=${(e: IxValueEvent) => this.patch({ [key]: String(e.detail) } as Partial<Asset>)}
        >
          ${opts.map((o) => html`<ix-select-item label=${localizeDir(o.label)} value=${o.value}></ix-select-item>`)}
        </ix-select>
      </div>
    `;
  }

  private patch(part: Partial<Asset>): void {
    this.working = { ...this.working, ...part };
  }

  private save(): void {
    if (this.working.name.trim() === '') return;
    this.dispatchEvent(
      new CustomEvent('wui:save', { detail: this.working, bubbles: true, composed: true })
    );
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single CSS block
function extraStyles(): ReturnType<typeof css> {
  return css`
    .score-badge {
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      color: #fff;
      background: var(--c);
      white-space: nowrap;
    }
    .pi-bar {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin: 0.6rem 0 0.2rem;
    }
    .pi-error {
      color: var(--theme-color-warning, #f59e0b);
      font-size: 0.85rem;
    }
    .grow {
      flex: 1;
    }
    .pi-panel {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.6rem 0.75rem;
      margin-bottom: 0.5rem;
      background: color-mix(in srgb, var(--theme-color-primary) 6%, transparent);
    }
    .pi-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.4rem;
    }
    .pi-head .subhead {
      margin: 0;
    }
    .pi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.25rem 0.75rem;
    }
    .pi-kv {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.2rem 0;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      font-size: 0.85rem;
    }
    .pi-kv > span {
      color: var(--theme-color-soft-text);
    }
    .pi-warn b {
      color: var(--theme-color-warning, #f59e0b);
      font-weight: 600;
    }
  `;
}
