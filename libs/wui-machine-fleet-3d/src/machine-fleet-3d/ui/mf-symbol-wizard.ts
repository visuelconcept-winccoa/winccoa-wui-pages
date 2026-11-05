// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Add a symbol" wizard (#67): one entry point, replacing "Add a machine" (a symbol from scratch)
 * and "Add a machine of the site" (a select of the catalogue).
 *
 * A symbol is imported from the site's catalogue, copied from another atelier, read from a JSON
 * file (as the symbol dialog exports it), or created from a short form (name, representation,
 * state datapoint) — everything else is set later in the symbol's dialog. The wizard only builds
 * the definition and emits it (`wui:addsymbol`); the page places it ("à placer") and saves.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { MachineDef, MachineType } from '../types.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';
import { MACHINE_TYPES } from './mf-machine-dialog.js';
import { overlayClicked, overlayDown } from '@visuelconcept-winccoa/wui-fleet-core/ui/overlay-dismiss.js';
import '@visuelconcept-winccoa/wui-kit/ui/wui-dp-input.js';

type Source = 'catalog' | 'atelier' | 'file' | 'create';

/** A symbol of another atelier, offered to copy. */
export interface OtherSymbol {
  atelier: string;
  machine: MachineDef;
}

interface IxValueEvent {
  detail: string | number;
}

@customElement('mf-symbol-wizard')
export class MfSymbolWizard extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    dialogStyles(),
    css`
      .sources {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.4rem;
        margin-bottom: 0.75rem;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        max-height: 18rem;
        overflow: auto;
        margin-top: 0.5rem;
      }
      .item {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.4rem 0.6rem;
        text-align: left;
        cursor: pointer;
        color: var(--theme-color-std-text);
        background: var(--theme-color-1);
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
      }
      .item:hover {
        border-color: var(--theme-color-primary);
      }
      .muted {
        color: var(--theme-color-soft-text);
        font-size: 0.8rem;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .error {
        color: var(--theme-color-alarm);
      }
    `
  ];

  /** Machines of the site's catalogue not yet in this atelier. */
  @property({ attribute: false }) catalog: MachineDef[] = [];
  /** Symbols of the other ateliers (loaded by the page when the wizard opens). */
  @property({ attribute: false }) others: OtherSymbol[] = [];

  @state() private source: Source = 'catalog';
  @state() private query = '';
  @state() private name = '';
  @state() private type: MachineType = 'cabinet';
  @state() private stateDp = '';
  @state() private fileError = false;

  override render(): TemplateResult {
    const tab = (s: Source, label: Parameters<typeof localize>[0]): TemplateResult =>
      html`<ix-button variant=${this.source === s ? 'primary' : 'secondary'} @click=${() => (this.source = s)}>${localizeDir(label)}</ix-button>`;
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.close()}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.wizard.title)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="sources">
              ${tab('catalog', MSG.wizard.fromCatalog)} ${tab('atelier', MSG.wizard.fromAtelier)}
              ${tab('file', MSG.wizard.fromFile)} ${tab('create', MSG.wizard.create)}
            </div>
            ${this.renderSource()}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${localizeDir(MSG.wizard.cancel)}</ix-button>
            ${this.source === 'create'
              ? html`<ix-button ?disabled=${this.name.trim() === ''} @click=${this.create}>${localizeDir(MSG.wizard.add)}</ix-button>`
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  private renderSource(): TemplateResult {
    if (this.source === 'catalog') {
      return this.renderList(this.catalog.map((m) => ({ key: m.id, label: m.name, hint: m.type, def: m })));
    }
    if (this.source === 'atelier') {
      return this.renderList(
        this.others.map((o, i) => ({ key: `${i}`, label: o.machine.name, hint: o.atelier, def: o.machine }))
      );
    }
    if (this.source === 'file') {
      return html`
        <input type="file" accept="application/json,.json" aria-label=${localize(MSG.wizard.chooseFile)} @change=${this.onFile} />
        ${this.fileError ? html`<div class="error">${localizeDir(MSG.wizard.badFile)}</div>` : ''}
      `;
    }
    return html`
      <div class="form">
        <ix-input
          label=${localize(MSG.wizard.name)}
          .value=${this.name}
          @valueChange=${(e: IxValueEvent) => (this.name = String(e.detail))}
        ></ix-input>
        <ix-select label=${localize(MSG.wizard.type)} .value=${this.type} @valueChange=${(e: IxValueEvent) => (this.type = e.detail as MachineType)}>
          ${MACHINE_TYPES.map((t) => html`<ix-select-item label=${t} value=${t}></ix-select-item>`)}
        </ix-select>
        <wui-dp-input
          label=${localize(MSG.wizard.stateDp)}
          .value=${this.stateDp}
          @wui:change=${(e: CustomEvent<{ value: string }>) => (this.stateDp = e.detail.value)}
        ></wui-dp-input>
        <div class="muted">${localizeDir(MSG.wizard.later)}</div>
      </div>
    `;
  }

  private renderList(items: { key: string; label: string; hint: string; def: MachineDef }[]): TemplateResult {
    const q = this.query.trim().toLowerCase();
    const shown = q ? items.filter((it) => `${it.label} ${it.hint}`.toLowerCase().includes(q)) : items;
    return html`
      <ix-input
        placeholder=${localize(MSG.wizard.search)}
        .value=${this.query}
        @valueChange=${(e: IxValueEvent) => (this.query = String(e.detail))}
      ></ix-input>
      <div class="list">
        ${shown.length === 0 ? html`<div class="muted">${localizeDir(MSG.wizard.none)}</div>` : ''}
        ${shown.map(
          (it) => html`<button type="button" class="item" @click=${() => this.emit(it.def, this.source === 'catalog')}>
            <span>${it.label}</span><span class="muted">${it.hint}</span>
          </button>`
        )}
      </div>
    `;
  }

  private readonly onFile = async (e: Event): Promise<void> => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const def = JSON.parse(await file.text()) as MachineDef;
      if (!def || typeof def !== 'object' || typeof def.name !== 'string' || typeof def.type !== 'string') throw new Error('shape');
      this.fileError = false;
      this.emit(def, false);
    } catch {
      this.fileError = true;
    }
  };

  private create(): void {
    const def: MachineDef = { id: '', name: this.name.trim(), type: this.type, x: 0, z: 0, state: 'ok', kpis: [] };
    if (this.stateDp.trim()) def.stateDp = this.stateDp.trim();
    this.emit(def, false);
  }

  /** The new symbol's definition; `keepId` for a catalogue machine (its id is the site's). */
  private emit(def: MachineDef, keepId: boolean): void {
    this.dispatchEvent(
      new CustomEvent('wui:addsymbol', { detail: { def: structuredClone(def), keepId }, bubbles: true, composed: true })
    );
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}
