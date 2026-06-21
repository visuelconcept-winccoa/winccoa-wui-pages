/**
 * Stop-cause catalog manager (single-level). Each entry has a code, a
 * description and a time classification (unplanned / planned / production).
 * Persisted as one app-level datapoint via {@link FleetStore}. Emits `wui:close`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { FleetStore } from '../data/fleet-store.js';
import {
  STOP_CLASSIFICATION_LABELS,
  type StopCause,
  type StopClassification
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string;
}

interface IxCheckedEvent {
  detail: boolean;
}

const CLASSIFICATIONS: StopClassification[] = ['unplanned', 'planned', 'production'];

@customElement('mf-stop-causes')
export class MfStopCauses extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) store: FleetStore | null = null;
  /** When false, the catalog is view-only: editing/saving is disabled. */
  @property({ type: Boolean }) canEdit = true;

  @state() private causes: StopCause[] = [];
  @state() private busy = false;

  @query('.import-input') private importInput!: HTMLInputElement;

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel causes" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">Catalogue des causes d'arrêt</ix-typography>
            <span class="head-spacer"></span>
            ${this.canEdit
              ? html`<ix-icon-button
                  ghost
                  icon="upload"
                  title="Importer (JSON)"
                  @click=${this.triggerImport}
                ></ix-icon-button>`
              : ''}
            <ix-icon-button
              ghost
              icon="download"
              title="Exporter (JSON)"
              ?disabled=${this.causes.length === 0}
              @click=${this.exportCauses}
            ></ix-icon-button>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <input
            type="file"
            accept="application/json,.json"
            class="import-input"
            @change=${this.onImportFile}
          />
          <div class="panel-body">
            <div class="cause-row cause-head">
              <span>Code</span><span>Description</span><span>Classification</span><span>Défaut</span
              ><span></span>
            </div>
            ${this.causes.length === 0
              ? html`<div class="muted">Aucune cause.</div>`
              : this.causes.map((c, i) => this.renderRow(c, i))}
            ${this.canEdit
              ? html`<ix-button class="add" variant="secondary" @click=${this.addCause}>
                  <ix-icon name="plus" slot="icon"></ix-icon>Ajouter une cause
                </ix-button>`
              : ''}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>Fermer</ix-button>
            ${this.canEdit
              ? html`<ix-button ?disabled=${this.busy} @click=${this.save}>Enregistrer</ix-button>`
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.reload();
  }

  private renderRow(c: StopCause, i: number): TemplateResult {
    const ro = !this.canEdit;
    return html`
      <div class="cause-row">
        <ix-input
          ?disabled=${ro}
          .value=${c.code}
          @valueChange=${(e: IxValueEvent) => this.patch(i, { code: String(e.detail) })}
        ></ix-input>
        <ix-input
          ?disabled=${ro}
          .value=${c.description}
          @valueChange=${(e: IxValueEvent) => this.patch(i, { description: String(e.detail) })}
        ></ix-input>
        <ix-select
          ?disabled=${ro}
          .value=${c.classification}
          @valueChange=${(e: IxValueEvent) =>
            this.patch(i, { classification: e.detail as StopClassification })}
        >
          ${CLASSIFICATIONS.map(
            (k) => html`<ix-select-item label=${STOP_CLASSIFICATION_LABELS[k]} value=${k}></ix-select-item>`
          )}
        </ix-select>
        <ix-toggle
          class="default-toggle"
          hide-text
          ?disabled=${ro}
          title="Cause affichée quand le code est absent du catalogue"
          ?checked=${c.isDefault === true}
          @checkedChange=${(e: IxCheckedEvent) => this.setDefault(i, e.detail)}
        ></ix-toggle>
        ${ro
          ? html`<span></span>`
          : html`<ix-icon-button
              ghost
              icon="trashcan"
              title="Supprimer"
              @click=${() => this.removeCause(i)}
            ></ix-icon-button>`}
      </div>
    `;
  }

  private async reload(): Promise<void> {
    if (this.store) this.causes = await this.store.listStopCauses();
  }

  private patch(index: number, patch: Partial<StopCause>): void {
    this.causes = this.causes.map((c, i) => (i === index ? { ...c, ...patch } : c));
  }

  /** Mark one entry as the catalog default (radio-style: clears the others). */
  private setDefault(index: number, on: boolean): void {
    this.causes = this.causes.map((c, i) => ({ ...c, isDefault: on && i === index }));
  }

  private addCause(): void {
    this.causes = [...this.causes, { code: '', description: '', classification: 'unplanned' }];
  }

  private removeCause(index: number): void {
    this.causes = this.causes.filter((_, i) => i !== index);
  }

  private async save(): Promise<void> {
    if (!this.store || this.busy) return;
    this.busy = true;
    const ok = await this.store.saveStopCauses(this.causes);
    this.busy = false;
    if (ok) this.close();
  }

  private exportCauses(): void {
    const json = JSON.stringify(this.causes, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'causes-arret.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  private triggerImport(): void {
    this.importInput.value = '';
    this.importInput.click();
  }

  private async onImportFile(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('Le fichier doit contenir un tableau de causes.');
      this.causes = onlyFirstDefault(parsed.map((c) => normaliseCause(c)));
    } catch {
      // Invalid file — keep the current catalog unchanged.
    }
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}

const VALID_CLASSIFICATIONS = new Set<StopClassification>(['unplanned', 'planned', 'production']);

/** Coerce an imported entry into a valid {@link StopCause}. */
function normaliseCause(raw: unknown): StopCause {
  const entry = (raw ?? {}) as Partial<StopCause>;
  const classification = VALID_CLASSIFICATIONS.has(entry.classification as StopClassification)
    ? (entry.classification as StopClassification)
    : 'unplanned';
  return {
    code: String(entry.code ?? ''),
    description: String(entry.description ?? ''),
    classification,
    isDefault: entry.isDefault === true
  };
}

/** Keep only the first `isDefault` entry (the catalog has a single default). */
function onlyFirstDefault(causes: StopCause[]): StopCause[] {
  let seen = false;
  return causes.map((c) => {
    if (c.isDefault && !seen) {
      seen = true;
      return c;
    }
    return c.isDefault ? { ...c, isDefault: false } : c;
  });
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .panel.causes {
      width: 720px;
    }
    .cause-row {
      display: grid;
      grid-template-columns: 6rem 1fr 12rem 4rem auto;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 0.4rem;
    }
    .default-toggle {
      justify-self: center;
    }
    .cause-head {
      color: var(--theme-color-soft-text);
      font-size: 0.8rem;
      font-weight: 600;
    }
    .add {
      margin-top: 0.5rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
      margin-bottom: 0.5rem;
    }
    .head-spacer {
      flex: 1;
    }
    .import-input {
      display: none;
    }
  `;
}
