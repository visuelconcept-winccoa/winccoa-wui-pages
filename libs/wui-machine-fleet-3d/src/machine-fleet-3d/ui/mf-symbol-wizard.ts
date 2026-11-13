// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Add a symbol" wizard (#67, reworked by winccoa-fra-msp-stma#338), three sources:
 *  - **From the site or an atelier**: one list, the site's catalogue (machines not yet in this atelier) and the
 *    symbols of the other ateliers, each with where it comes from;
 *  - **Import**: one or several symbols from a JSON text, a file's content or pasted (as Node-RED imports):
 *    one symbol, a list, or a workcenter's export (#337) with its state mappings (symbol-import.ts). Checked
 *    before anything is added; a symbol already in the atelier (same id) is replaced or skipped, asked symbol by
 *    symbol;
 *  - **New symbol**: its name and representation only — everything else is set in the symbol's dialog — and
 *    for a 3D model, the model picked or uploaded on the spot.
 * It opens on the list when it offers something, on the new symbol otherwise. The wizard only builds the
 * definitions and emits them (`wui:addsymbol`, `wui:importsymbols`); the page places them and saves.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GlbResource, MachineDef, MachineType } from '../types.js';
import type { FleetStore } from '../data/fleet-store.js';
import { MSG, importErrorMsg, importSummaryMsg, localize, localizeDir, machineTypeLabel, replaceSymbolMsg } from '../i18n.js';
import { conflictOf, parseSymbolImport, type ImportResult, type SymbolImportPlan } from '../symbol-import.js';
import { dialogStyles } from './dialog-styles.js';
import { MACHINE_TYPES } from './mf-machine-dialog.js';
import { overlayClicked, overlayDown } from '@visuelconcept-winccoa/wui-fleet-core/ui/overlay-dismiss.js';
import './mf-graphic-picker.js';

type Source = 'existing' | 'import' | 'create';

/** A symbol of another atelier, offered to copy. */
export interface OtherSymbol {
  atelier: string;
  machine: MachineDef;
}

/** What an import adds: new symbols, symbols replacing those of the same id, and state mappings. */
export type SymbolImport = SymbolImportPlan;

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
        grid-template-columns: repeat(3, 1fr);
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
      .ok {
        color: var(--theme-color-std-text);
      }
      .paste-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.35rem;
      }
      .paste {
        width: 100%;
        min-height: 14rem;
        box-sizing: border-box;
        resize: vertical;
        padding: 0.5rem;
        font-family: var(--theme-font-family-monospace, monospace);
        font-size: 0.8rem;
        color: var(--theme-color-std-text);
        background: var(--theme-color-1);
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
      }
      .paste:focus {
        outline: 2px solid var(--theme-color-primary);
        outline-offset: 1px;
      }
      .file-input {
        display: none;
      }
      .verdict {
        margin-top: 0.4rem;
        font-size: 0.85rem;
      }
      .confirm {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.5rem 0;
      }
      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `
  ];

  /** Machines of the site's catalogue not yet in this atelier. */
  @property({ attribute: false }) catalog: MachineDef[] = [];
  /** Symbols of the other ateliers (loaded by the page when the wizard opens). */
  @property({ attribute: false }) others: OtherSymbol[] = [];
  /** Symbols of this atelier: an imported one of the same id replaces one of them, if the user says so. */
  @property({ attribute: false }) existing: MachineDef[] = [];
  /** Graphics catalogue of the atelier: 3D models and icons for a new symbol. */
  @property({ attribute: false }) glbResources: GlbResource[] = [];
  @property({ attribute: false }) billboardResources: GlbResource[] = [];
  @property({ attribute: false }) store: FleetStore | null = null;

  @state() private source: Source = 'existing';
  @state() private query = '';
  @state() private name = '';
  @state() private type: MachineType = 'cabinet';
  /** The new symbol's 3D model (`glb`) or icon (`billboard`). */
  @state() private glbUrl = '';
  @state() private billboardUrl = '';
  /** Import: the JSON text, and what it holds. */
  @state() private importText = '';
  @state() private parsed: ImportResult | null = null;
  /** Import: the symbols already in the atelier, asked one by one; their answers (true = replace). */
  @state() private conflicts: MachineDef[] = [];
  @state() private asked = 0;
  private answers = new Map<string, boolean>();

  protected override willUpdate(): void {
    // Opening source, chosen once: the list when it offers a symbol, the new symbol otherwise.
    if (!this.hasUpdated) this.source = this.catalog.length + this.others.length > 0 ? 'existing' : 'create';
  }

  override render(): TemplateResult {
    const tab = (s: Source, label: Parameters<typeof localize>[0]): TemplateResult =>
      html`<ix-button variant=${this.source === s ? 'primary' : 'secondary'} @click=${() => this.setSource(s)}>${localizeDir(label)}</ix-button>`;
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.close()}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.wizard.title)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="sources">
              ${tab('existing', MSG.wizard.fromExisting)} ${tab('import', MSG.wizard.importTab)} ${tab('create', MSG.wizard.create)}
            </div>
            ${this.renderSource()}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${localizeDir(MSG.wizard.cancel)}</ix-button>
            ${this.source === 'create'
              ? html`<ix-button ?disabled=${this.name.trim() === ''} @click=${this.create}>${localizeDir(MSG.wizard.add)}</ix-button>`
              : ''}
            ${this.source === 'import' && this.conflicts.length === 0
              ? html`<ix-button ?disabled=${!this.parsed?.ok} @click=${this.startImport}>${localizeDir(MSG.wizard.importButton)}</ix-button>`
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  private setSource(s: Source): void {
    this.source = s;
    this.conflicts = [];
    this.asked = 0;
  }

  private renderSource(): TemplateResult {
    if (this.source === 'existing') return this.renderExisting();
    if (this.source === 'import') return this.conflicts.length ? this.renderConfirm() : this.renderImport();
    return this.renderCreate();
  }

  /** The site's catalogue and the other ateliers' symbols, in one list. */
  private renderExisting(): TemplateResult {
    const items = [
      ...this.catalog.map((m) => ({ key: `site:${m.id}`, label: m.name, hint: localize(MSG.wizard.site), def: m, keepId: true })),
      ...this.others.map((o, i) => ({ key: `at:${i}`, label: o.machine.name, hint: o.atelier, def: o.machine, keepId: false }))
    ];
    if (items.length === 0) return html`<div class="muted">${localizeDir(MSG.wizard.existingNone)}</div>`;
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
          (it) => html`<button type="button" class="item" @click=${() => this.emit(it.def, it.keepId)}>
            <span>${it.label}</span><span class="muted">${it.hint}</span>
          </button>`
        )}
      </div>
    `;
  }

  /** The JSON text, pasted or read from a file, and what it holds or why it is refused. */
  private renderImport(): TemplateResult {
    const r = this.parsed;
    let verdict: TemplateResult | string = '';
    if (r && r.ok) {
      const conflicts = r.symbols.filter((s) => conflictOf(s, this.existing)).length;
      const source = r.source ? [r.source.label, r.source.code].filter(Boolean).join(' · ') : '';
      verdict = html`<div class="verdict ok">${importSummaryMsg(r.symbols.length, conflicts, r.mappings.length, source)}</div>`;
    } else if (r && this.importText.trim() !== '') {
      verdict = html`<div class="verdict error">${importErrorMsg(r)}</div>`;
    }
    return html`
      <div class="paste-head">
        <span class="muted">${localizeDir(MSG.wizard.pasteLabel)}</span>
        <ix-button variant="secondary" @click=${this.pickFile}>
          <ix-icon name="folder" slot="icon"></ix-icon>${localizeDir(MSG.wizard.chooseFile)}
        </ix-button>
      </div>
      <textarea
        class="paste"
        spellcheck="false"
        aria-label=${localize(MSG.wizard.pasteLabel)}
        placeholder=${localize(MSG.wizard.pastePlaceholder)}
        .value=${this.importText}
        @input=${(e: Event) => this.setImportText((e.target as HTMLTextAreaElement).value)}
      ></textarea>
      <input class="file-input" type="file" accept="application/json,.json,.txt" @change=${this.onFile} />
      ${verdict}
    `;
  }

  /** A symbol of the import already in the atelier: replace it, or skip it. */
  private renderConfirm(): TemplateResult {
    const current = this.conflicts[this.asked];
    if (!current) return html``;
    return html`
      <div class="confirm">
        <div>${replaceSymbolMsg(current.name)}</div>
        <div class="muted">${this.asked + 1} / ${this.conflicts.length}</div>
        <div class="confirm-actions">
          <ix-button variant="secondary" @click=${() => this.answer(false)}>${localizeDir(MSG.wizard.replaceNo)}</ix-button>
          <ix-button @click=${() => this.answer(true)}>${localizeDir(MSG.wizard.replaceYes)}</ix-button>
        </div>
      </div>
    `;
  }

  /** Name and representation only; a 3D model or an icon when the representation needs one. */
  private renderCreate(): TemplateResult {
    return html`
      <div class="form">
        <ix-input
          label=${localize(MSG.wizard.name)}
          .value=${this.name}
          @valueChange=${(e: IxValueEvent) => (this.name = String(e.detail))}
        ></ix-input>
        <ix-select label=${localize(MSG.wizard.type)} .value=${this.type} @valueChange=${(e: IxValueEvent) => (this.type = e.detail as MachineType)}>
          ${MACHINE_TYPES.map((t) => html`<ix-select-item label=${machineTypeLabel(t)} value=${t}></ix-select-item>`)}
        </ix-select>
        ${this.type === 'glb'
          ? html`<mf-graphic-picker
              kind="glb"
              upload
              .value=${this.glbUrl}
              .glbResources=${this.glbResources}
              .store=${this.store}
              @wui:change=${(e: CustomEvent<{ value?: string }>) => (this.glbUrl = e.detail.value ?? '')}
            ></mf-graphic-picker>`
          : ''}
        ${this.type === 'billboard'
          ? html`<mf-graphic-picker
              kind="billboard"
              .value=${this.billboardUrl}
              .billboardResources=${this.billboardResources}
              .store=${this.store}
              @wui:change=${(e: CustomEvent<{ value?: string }>) => (this.billboardUrl = e.detail.value ?? '')}
            ></mf-graphic-picker>`
          : ''}
        <div class="muted">${localizeDir(MSG.wizard.later)}</div>
      </div>
    `;
  }

  private setImportText(text: string): void {
    this.importText = text;
    this.parsed = parseSymbolImport(text);
  }

  private pickFile(): void {
    this.renderRoot.querySelector<HTMLInputElement>('.file-input')?.click();
  }

  /** A file chosen: its text in the box, as if pasted (checked the same way). */
  private readonly onFile = async (e: Event): Promise<void> => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.setImportText(await file.text());
  };

  /** "Import": added at once without conflict, else each symbol already in the atelier asked first. */
  private startImport(): void {
    const r = this.parsed;
    if (!r || !r.ok) return;
    this.answers = new Map();
    this.asked = 0;
    this.conflicts = r.symbols.map((s) => conflictOf(s, this.existing)).filter((m): m is MachineDef => m !== null);
    if (this.conflicts.length === 0) this.finishImport();
  }

  private answer(replace: boolean): void {
    const current = this.conflicts[this.asked];
    if (!current) return;
    this.answers.set(current.id, replace);
    if (this.asked + 1 < this.conflicts.length) this.asked += 1;
    else this.finishImport();
  }

  private finishImport(): void {
    const r = this.parsed;
    if (!r || !r.ok) return;
    const add: MachineDef[] = [];
    const replace: MachineDef[] = [];
    for (const s of r.symbols) {
      if (!conflictOf(s, this.existing)) add.push(s);
      else if (this.answers.get(s.id)) replace.push(s);
    }
    this.conflicts = [];
    this.asked = 0;
    const detail: SymbolImport = { add: structuredClone(add), replace: structuredClone(replace), mappings: structuredClone(r.mappings) };
    this.dispatchEvent(new CustomEvent('wui:importsymbols', { detail, bubbles: true, composed: true }));
  }

  private create(): void {
    const def: MachineDef = { id: '', name: this.name.trim(), type: this.type, x: 0, z: 0, state: 'ok', kpis: [] };
    if (this.type === 'glb' && this.glbUrl) def.glbUrl = this.glbUrl;
    if (this.type === 'billboard' && this.billboardUrl) def.billboardUrl = this.billboardUrl;
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
