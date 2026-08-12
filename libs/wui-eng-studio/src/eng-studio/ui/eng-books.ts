// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Catalogues panel — the address books as FIRST-CLASS objects.
 *
 * The studio is device-first, but a catalog is not: a vendor register map
 * (SENTRON PAC3200), a standard interface (PackML), a machine-model catalog
 * (`Catalogue_Pompe_KSB`) exists before — and independently of — any equipment,
 * and is then bound to several of them. So it must be creatable, refreshable,
 * qualifiable and deletable WITHOUT declaring a device first, which is what this
 * panel is for. The Devices panel keeps the device-side view of the same
 * many-to-many relation.
 *
 * It owns no I/O: every mutation is an event the page performs through the
 * `EngGateway` (`wui:bookingest`, `wui:bookbrowse`, `wui:bookrefresh`,
 * `wui:bookdelete`, `wui:bookattach`), and the page owns the selection and the
 * form's visibility — so a refusal keeps the form open with its fields, exactly
 * like the tag importer's connection step. The creation form itself is
 * {@link import('./eng-book-form.js').WuiEngBookForm}, whose events bubble
 * through here to the page.
 *
 * The selected catalog's SIGNAL TABLE is slotted in (`slot="signals"`) rather than
 * re-implemented: it is the same table as the Devices panel's, with the same
 * filter and role state, which the page owns because the model generator reads it.
 */
import type { AddressBook, BrowseProgress, Device, OpcUaBrowseNode } from '@visuelconcept/wui-eng-core';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { EngConnection, EngDriver } from '../data/gateway.js';
import { engTheme } from '../eng-theme.js';
import { MSG, fmt, t, warnText, type Lang, type Ml } from '../i18n.js';
import './eng-book-form.js';
import { engBooksStyles } from './eng-books.styles.js';

/** `2026-08-03T09:15:00.000Z` → `2026-08-03 09:15` (minutes are enough here). */
const STAMP_LENGTH = 16;

export class WuiEngBooks extends LitElement {
  static override readonly styles = [engTheme, engBooksStyles];

  @property({ attribute: false }) books: AddressBook[] = [];
  @property({ attribute: false }) devices: Device[] = [];
  @property({ attribute: false }) drivers: EngDriver[] = [];
  @property({ attribute: false }) connections: EngConnection[] = [];
  @property({ type: String }) selectedBookId = '';
  @property({ type: Boolean }) canManage = false;
  @property({ type: Boolean }) busy = false;
  /** The page owns this: it closes the form only when the creation succeeded. */
  @property({ type: Boolean }) formOpen = false;
  /** Refusal to show in the form (the page's own message from the gateway). */
  @property({ type: String }) error = '';
  @property({ type: String }) uiLang: Lang = 'en';
  /**
   * Progress of the walk in flight, or null. The page owns it because the page runs
   * the walk (the gateway is its own) — the panel only renders where it has got to.
   */
  @property({ attribute: false }) walking: BrowseProgress | null = null;
  /** One browse round-trip, handed to the form so it can explore before creating. */
  @property({ attribute: false }) browseLevel?: (connection: string, nodeId?: string) => Promise<OpcUaBrowseNode[]>;

  @state() private listFilter = '';
  /** Deletion armed by a first click — a catalog is not recoverable from here. */
  @state() private deleteArmed = false;
  /** Equipments checked in the "served by" card, before "Apply the links". */
  @state() private attachDraft: string[] = [];
  /** Book id the `attachDraft` was seeded from (so a re-render never re-seeds). */
  @state() private attachSeededFor = '';

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('selectedBookId')) this.deleteArmed = false;
  }

  override render(): TemplateResult {
    // The form is created on open and destroyed on close, so its draft never has
    // to be reset — a fresh element IS the blank draft.
    if (this.formOpen) {
      return html`
        <wui-eng-book-form
          .books=${this.books}
          .devices=${this.devices}
          .drivers=${this.drivers}
          .connections=${this.connections}
          .busy=${this.busy}
          .error=${this.error}
          .uiLang=${this.uiLang}
          .browseLevel=${this.browseLevel}
        ></wui-eng-book-form>
      `;
    }
    const selected = this.selectedBook();
    return html`
      ${this.renderHead()}
      <div class="split2">
        ${this.renderList()}
        ${selected === null
          ? html`<div class="empty">${this.tr(this.books.length === 0 ? MSG.booksEmpty : MSG.bookPickHint)}</div>`
          : this.renderDetail(selected)}
      </div>
    `;
  }

  private tr(message: Ml, params: Record<string, string | number> = {}): string {
    return fmt(t(message, this.uiLang), params);
  }

  private renderHead(): TemplateResult {
    const signals = this.books.reduce((total, book) => total + book.entries.length, 0);
    return html`
      <div class="panel-head">
        <h2>${this.tr(MSG.booksTitle)}</h2>
        <ix-chip outline variant="neutral">${this.tr(MSG.booksCount, { n: this.books.length })}</ix-chip>
        <ix-chip outline variant="neutral">${this.tr(MSG.booksSignalsTotal, { n: signals })}</ix-chip>
        <div class="spacer"></div>
        ${this.canManage
          ? html`<ix-button variant="primary" icon="plus" ?disabled=${this.busy} @click=${this.onNew}>
              ${this.tr(MSG.bookNew)}
            </ix-button>`
          : nothing}
      </div>
    `;
  }

  // --- the list ---------------------------------------------------------------

  private renderList(): TemplateResult {
    const needle = this.listFilter.trim().toLowerCase();
    const shown =
      needle === ''
        ? this.books
        : this.books.filter((book) => `${book.name} ${book.id} ${book.provenance.kind}`.toLowerCase().includes(needle));
    return html`
      <section class="browser">
        <div class="browser-head">
          <input
            class="filter"
            placeholder=${this.tr(MSG.bookFilterPlaceholder)}
            .value=${this.listFilter}
            @input=${(event: Event) => (this.listFilter = (event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="browser-list">
          ${this.books.length === 0
            ? html`<div class="empty small">${this.tr(MSG.booksEmpty)}</div>`
            : shown.map((book) => this.renderRow(book))}
        </div>
        <div class="browser-foot">${this.tr(MSG.signalsOf, { shown: shown.length, total: this.books.length })}</div>
      </section>
    `;
  }

  private renderRow(book: AddressBook): TemplateResult {
    const users = this.devicesUsing(book.id);
    return html`
      <button
        class="book-row ${book.id === this.selectedBookId ? 'selected' : ''}"
        title=${book.name}
        @click=${() => this.dispatchEvent(new CustomEvent('wui:bookselect', { detail: { bookId: book.id }, bubbles: true, composed: true }))}
      >
        <span class="book-row-main">
          <span class="book-row-name">${book.name}</span>
          <span class="book-row-sub mono">${book.id}</span>
        </span>
        <span class="chip mode">${this.sourceLabel(book)}</span>
        <span class="chip">${book.entries.length}</span>
        ${users.length === 0
          ? html`<span class="chip update" title=${this.tr(MSG.bookOrphanTitle)}>${this.tr(MSG.bookOrphan)}</span>`
          : html`<span class="chip" title=${users.map((device) => device.name).join(', ')}>⇆ ${users.length}</span>`}
      </button>
    `;
  }

  // --- the detail -------------------------------------------------------------

  private renderDetail(book: AddressBook): TemplateResult {
    const users = this.devicesUsing(book.id);
    return html`
      <div class="grid-wrap">
        ${this.renderDetailHead(book)}
        <div class="panel-scroll">
          ${this.renderWalkProgress()}
          ${this.deleteArmed ? this.renderDeleteWarning(users.length) : nothing}
          ${book.entries.length === 0 && this.walking === null
            ? html`<div class="empty small">${this.tr(MSG.bookEmptyYet)}</div>`
            : nothing}
          <div class="detail-grid">
            ${this.renderInterfaceCard(book)}
            ${this.renderProvenanceCard(book)}
          </div>
          ${this.renderUsedByCard(book, users)}
          ${book.warnings.length > 0
            ? html`<section class="card warnings">
                <div class="card-title">${this.tr(MSG.generatorWarnings)}</div>
                <ul>
                  ${book.warnings.map((warning) => html`<li>${this.warnText(warning)}</li>`)}
                </ul>
              </section>`
            : nothing}
          <slot name="signals"></slot>
        </div>
      </div>
    `;
  }

  /** Identity + the three actions only this panel can offer on any catalog. */
  private renderDetailHead(book: AddressBook): TemplateResult {
    // Walking needs the catalog's OWN server: a template catalog has no connection to
    // walk, and offering the action there would only produce an error.
    const walkable = this.canManage && book.interface?.protocol === 'opcua' && Boolean(book.interface.connection);
    return html`
      <div class="grid-head-bar">
        <span class="detail-name">${book.name}</span>
        <span class="chip mode">${this.sourceLabel(book)}</span>
        ${book.interface === undefined
          ? html`<span class="chip primary" title=${this.tr(MSG.fileCatalogHint)}>${this.tr(MSG.bookTemplate)}</span>`
          : html`<span class="chip proto">${protocolLabel(book.interface.protocol)}</span>`}
        <div class="spacer"></div>
        ${walkable
          ? html`<ix-button
              variant="secondary"
              icon="search"
              title=${this.tr(MSG.walkRunHint)}
              ?disabled=${this.busy || this.walking !== null}
              @click=${() => this.askWalk(book.id)}
            >
              ${this.tr(MSG.walkRun)}
            </ix-button>`
          : nothing}
        ${this.canManage
          ? html`
              <ix-button variant="secondary" icon="refresh" ?disabled=${this.busy} @click=${() => this.askRefresh(book.id)}>
                ${this.tr(MSG.refreshBook)}
              </ix-button>
              <ix-button
                variant=${this.deleteArmed ? 'danger-primary' : 'danger-secondary'}
                icon="trashcan"
                ?disabled=${this.busy}
                @click=${() => this.onDeleteClick(book)}
              >
                ${this.tr(this.deleteArmed ? MSG.bookDeleteConfirm : MSG.bookDelete)}
              </ix-button>
            `
          : nothing}
      </div>
    `;
  }

  /**
   * Where the walk has got to. No percentage on purpose: the size of an address space
   * is not known until it has been walked, so a bar filling to an invented total
   * would be a lie. What IS true and useful: the counts, and the branch it is waiting
   * on — which is how an operator tells "still working" from "stuck on one server".
   */
  private renderWalkProgress(): TemplateResult {
    const walking = this.walking;
    if (walking === null) return html``;
    return html`
      <div class="walk detail-message">
        <ix-spinner size="medium"></ix-spinner>
        <div class="walk-main">
          <span class="walk-title">${this.tr(MSG.walkTitle)}</span>
          <span class="walk-detail">
            ${this.tr(MSG.walkProgress, { entries: walking.entries, requests: walking.requests, depth: walking.depth })}
            ·
            ${walking.path === '' ? this.tr(MSG.walkAtRoot) : this.tr(MSG.walkAt, { path: walking.path })}
          </span>
        </div>
        <ix-button
          variant="danger-secondary"
          icon="cancel"
          @click=${() => this.dispatchEvent(new CustomEvent('wui:bookwalkstop', { bubbles: true, composed: true }))}
        >
          ${this.tr(MSG.walkCancel)}
        </ix-button>
      </div>
    `;
  }

  private renderDeleteWarning(users: number): TemplateResult {
    return html`
      <ix-message-bar type="alarm" persistent class="detail-message">
        ${this.tr(MSG.bookDeleteHint)}
        ${users > 0 ? html` <strong>${this.tr(MSG.bookDeleteUsedWarning, { n: users })}</strong>` : nothing}
      </ix-message-bar>
    `;
  }

  private renderInterfaceCard(book: AddressBook): TemplateResult {
    const iface = book.interface;
    return html`
      <section class="card">
        <div class="card-title">${this.tr(MSG.interfaceOf, { name: book.name })}</div>
        ${iface === undefined
          ? html`<div class="empty small">${this.tr(MSG.fileCatalogHint)}</div>`
          : html`
              <table class="kv">
                <tr><td>${this.tr(MSG.fieldProtocol)}</td><td>${protocolLabel(iface.protocol)}</td></tr>
                ${iface.connection
                  ? html`<tr><td>${this.tr(MSG.fieldConnection)}</td><td class="mono">${iface.connection}</td></tr>`
                  : nothing}
                ${Object.entries(iface.params ?? {}).map(
                  ([key, value]) => html`<tr><td>${key}</td><td class="mono">${String(value)}</td></tr>`
                )}
                <tr><td>${this.tr(MSG.fieldDriver)}</td><td class="mono">${iface.driverNumber ?? '—'}</td></tr>
              </table>
            `}
      </section>
    `;
  }

  private renderProvenanceCard(book: AddressBook): TemplateResult {
    const provenance = book.provenance;
    return html`
      <section class="card">
        <div class="card-title">${this.tr(MSG.addressBook)}</div>
        <table class="kv">
          <tr><td>${this.tr(MSG.fieldSource)}</td><td>${this.sourceLabel(book)}${provenance.file ? html` · <code>${provenance.file}</code>` : nothing}</td></tr>
          <tr><td>${this.tr(MSG.fieldGenerated)}</td><td class="mono">${provenance.generatedAt.replace('T', ' ').slice(0, STAMP_LENGTH)}</td></tr>
          <tr><td>${this.tr(MSG.fieldDetail)}</td><td>${provenance.detail ?? '—'}</td></tr>
          <tr><td>${this.tr(MSG.fieldEntries)}</td><td>${this.tr(MSG.entriesValue, { n: book.entries.length, types: book.types.length })}</td></tr>
          ${book.warnings.length > 0
            ? html`<tr><td>${this.tr(MSG.fieldWarnings)}</td><td class="warn-text">${book.warnings.length}</td></tr>`
            : nothing}
        </table>
      </section>
    `;
  }

  /**
   * Which equipments this catalog serves — editable from HERE, which is the point
   * of the panel: a shared catalog is bound to N equipments, and doing that from
   * each device form in turn is the workflow this replaces.
   */
  private renderUsedByCard(book: AddressBook, users: Device[]): TemplateResult {
    const checked = this.attachSeededFor === book.id ? this.attachDraft : users.map((device) => device.id);
    const dirty = !sameIds(checked, users.map((device) => device.id));
    return html`
      <section class="card">
        <div class="card-title">${this.tr(MSG.bookUsedBy)}</div>
        ${this.devices.length === 0
          ? html`<div class="empty small">${this.tr(MSG.bookNoDeviceYet)}</div>`
          : html`
              <div class="box-list">
                ${this.devices.map(
                  (device) => html`<label class="box" title=${device.name}>
                    <input
                      type="checkbox"
                      ?disabled=${!this.canManage || this.busy}
                      .checked=${checked.includes(device.id)}
                      @change=${() => this.toggleAttach(book, checked, device.id)}
                    />
                    <span class="box-name">${device.name}</span>
                    <span class="chip proto">${protocolLabel(device.protocol ?? '')}</span>
                  </label>`
                )}
              </div>
            `}
        <div class="form-hint">${this.tr(MSG.bookUsedByHint)}</div>
        ${this.canManage && this.devices.length > 0
          ? html`<ix-button
              variant="secondary"
              icon="link"
              ?disabled=${this.busy || !dirty}
              @click=${() => this.dispatchEvent(new CustomEvent('wui:bookattach', { detail: { bookId: book.id, deviceIds: checked }, bubbles: true, composed: true }))}
            >
              ${this.tr(MSG.bookAttachApply)}
            </ix-button>`
          : nothing}
      </section>
    `;
  }

  // --- actions ----------------------------------------------------------------

  private onNew(): void {
    this.dispatchEvent(new CustomEvent('wui:booknew', { bubbles: true, composed: true }));
  }

  /** Ask the page to walk this catalog's server into it (it owns the gateway). */
  private askWalk(bookId: string): void {
    this.dispatchEvent(new CustomEvent('wui:bookwalk', { detail: { bookId }, bubbles: true, composed: true }));
  }

  private askRefresh(bookId: string): void {
    this.dispatchEvent(new CustomEvent('wui:bookrefresh', { detail: { bookId }, bubbles: true, composed: true }));
  }

  /** Tick/untick one equipment in the "served by" draft (applied by its button). */
  private toggleAttach(book: AddressBook, current: string[], deviceId: string): void {
    this.attachSeededFor = book.id;
    this.attachDraft = current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId];
  }

  /**
   * Two-step delete, like the device form's: the first click arms the button and
   * shows what deleting does (and does NOT) touch, the second one goes through.
   */
  private onDeleteClick(book: AddressBook): void {
    if (!this.deleteArmed) {
      this.deleteArmed = true;
      return;
    }
    this.deleteArmed = false;
    this.dispatchEvent(new CustomEvent('wui:bookdelete', { detail: { bookId: book.id }, bubbles: true, composed: true }));
  }

  // --- helpers ----------------------------------------------------------------

  private selectedBook(): AddressBook | null {
    return this.books.find((book) => book.id === this.selectedBookId) ?? null;
  }

  private devicesUsing(bookId: string): Device[] {
    return this.devices.filter((device) => device.bookIds.includes(bookId));
  }

  private sourceLabel(book: AddressBook): string {
    const label = MSG.sourceKind[book.provenance.kind];
    return label === undefined ? book.provenance.kind : t(label, this.uiLang);
  }

  /** A core warning in the UI language (shared with the page — see `i18n.warnText`). */
  private warnText(warning: AddressBook['warnings'][number]): string {
    return warnText(warning, this.uiLang);
  }
}

/** Protocol display names (the same map the page uses). */
function protocolLabel(protocol: string): string {
  const map: Record<string, string> = { opcua: 'OPC UA', s7: 'S7', s7plus: 'S7+', modbus: 'Modbus' };
  return map[protocol] ?? (protocol === '' ? '—' : protocol);
}


function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}

if (!customElements.get('wui-eng-books')) {
  customElements.define('wui-eng-books', WuiEngBooks);
}
