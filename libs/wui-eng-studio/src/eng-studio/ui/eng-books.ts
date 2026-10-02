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
 * `EngGateway` (`wui:bookingest`, `wui:bookbrowse`, `wui:booksymbolicbrowse`, `wui:bookrefresh`,
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
import { dataBlocksAddressedBy, type AddressBook, type BrowseProgress, type Device, type OpcUaBrowseNode, type S7BlockVerdict, type S7InventoryBlock } from '@visuelconcept/wui-eng-core';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type {
  EngConnection,
  EngDriver,
  EngS7PlusConnection,
  EngS7PlusStation,
  S7InventoryResult,
  S7PlusManagerHealth
} from '../data/gateway.js';
import { engTheme } from '../eng-theme.js';
import { MSG, fmt, t, warnText, type Lang, type Ml } from '../i18n.js';
import './eng-book-form.js';
import { engBooksStyles } from './eng-books.styles.js';

/** `2026-08-03T09:15:00.000Z` → `2026-08-03 09:15` (minutes are enough here). */
const STAMP_LENGTH = 16;

/** `2026-08-03T09:15:00.000Z` → `2026-08-03` (a block's compilation DAY). */
const DAY_LENGTH = 10;

/**
 * One row of the CPU reading: a data block seen from both sides at once.
 *
 * The catalog half (`verdict`) and the machine half (`block`) are each optional,
 * and that is the whole point of the table — a row with no `block` is a data block
 * the catalog addresses and the PLC does not hold, a row with no `verdict` is a
 * block the PLC holds and the export left behind. Rendering them in one list is
 * what makes the two readings comparable line by line.
 */
interface S7Row {
  dbNumber: number;
  /** Project name of the block, when the catalog carries one (`Echange`). */
  label?: string;
  verdict?: S7BlockVerdict;
  block?: S7InventoryBlock;
  status: S7BlockVerdict['status'] | 'uncatalogued';
}

/**
 * Pill class per verdict — the colour carries the ACTION, not the severity.
 *
 * `absent` and `overrun` share the alarm colour because they share a consequence
 * (signals that will not bind, or will bind to nothing); `unknown` is a warning
 * because it asks for a second look rather than a fix; and `uncatalogued` gets no
 * colour at all — it is information, not a problem.
 */
function s7StatusClass(status: S7Row['status']): string {
  if (status === 'ok') return 'success';
  if (status === 'absent' || status === 'overrun') return 'conflict';
  if (status === 'unknown') return 'warning';
  return '';
}

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
  /** The S7Plus half of the same three: connections, sources, one level. */
  @property({ attribute: false }) s7plusConnections: EngS7PlusConnection[] = [];
  @property({ attribute: false }) s7plusManager?: S7PlusManagerHealth;
  @property({ attribute: false }) s7plusSources?: (connection: string) => Promise<EngS7PlusStation[]>;
  @property({ attribute: false }) browseS7PlusLevel?: (
    connection: string,
    item?: string,
    hmiVisibleOnly?: boolean
  ) => Promise<import('@visuelconcept/wui-eng-core').S7PlusBrowseNode[]>;

  /**
   * Whether the classic-S7 online check is offered at all.
   *
   * False when the `s7Browse` manager is not deployed — and the action is then
   * HIDDEN rather than shown failing: the S7 catalogs are built from the STEP 7
   * exports and are complete without it, so an absent manager is a missing extra,
   * not a broken page.
   */
  @property({ type: Boolean }) s7BrowseAvailable = false;
  /** The last inventory read, for the catalog it was read on. */
  @property({ attribute: false }) s7Inventory: (S7InventoryResult & { bookId: string }) | null = null;
  /** True while an inventory is in flight (it holds a TCP session to a PLC). */
  @property({ type: Boolean }) s7InventoryBusy = false;

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
          .s7plusConnections=${this.s7plusConnections}
          .s7plusManager=${this.s7plusManager}
          .s7plusSources=${this.s7plusSources}
          .browseS7PlusLevel=${this.browseS7PlusLevel}
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
          ${this.renderS7Inventory(book)}
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
        ${this.s7Verifiable(book)
          ? html`<ix-button
              variant="secondary"
              icon="hardware-cabinet"
              title=${this.tr(MSG.s7InventoryHint)}
              ?disabled=${this.busy || this.s7InventoryBusy}
              @click=${() => this.askS7Inventory(book.id)}
            >
              ${this.tr(this.s7InventoryBusy ? MSG.s7InventoryRunning : MSG.s7InventoryRun)}
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

  /**
   * Can this catalog be checked against a running CPU?
   *
   * Only a catalog that actually addresses classic S7 operands, and only when the
   * manager is there. A template catalog with no interface still qualifies — it is
   * bound to an equipment at generation, and the page asks which one.
   */
  private s7Verifiable(book: AddressBook): boolean {
    if (!this.s7BrowseAvailable) return false;
    if (book.interface !== undefined && book.interface.protocol !== 's7') return false;
    return book.entries.some((entry) => entry.addresses.s7 !== undefined);
  }

  private askS7Inventory(bookId: string): void {
    this.dispatchEvent(new CustomEvent('wui:bookinventory', { detail: { bookId }, bubbles: true, composed: true }));
  }

  /**
   * What the CPU said, beside the catalog that was checked against it.
   *
   * Deliberately NOT merged into the book's own warnings: those describe the
   * source file and travel with the stored catalog, while these describe a moment
   * in the life of a machine and are true only until the next download. Showing
   * them in one list would make a transient disagreement look like a defect of the
   * export.
   */
  /**
   * Merge the two readings into one list, ordered by block number.
   *
   * The union is deliberate: showing only the catalog's blocks would hide what the
   * export left behind, and showing only the CPU's would hide the blocks that are
   * missing from it — and those are the two findings worth the round-trip.
   */
  private s7Rows(book: AddressBook, result: S7InventoryResult): S7Row[] {
    const addressed = dataBlocksAddressedBy(book);
    const verdicts = new Map(result.crossCheck.verdicts.map((verdict) => [verdict.dbNumber, verdict]));
    const blocks = new Map(result.inventory.blocks.filter((block) => block.kind === 'DB').map((block) => [block.number, block]));
    const numbers = [...new Set([...verdicts.keys(), ...blocks.keys()])].sort((a, b) => a - b);
    return numbers.map((dbNumber) => {
      const verdict = verdicts.get(dbNumber);
      // The project name the catalog paths its members under (`Echange.Consigne`),
      // shown beside the number: it is how an engineer knows which block this is.
      const first = addressed.get(dbNumber)?.paths[0]?.split('.')[0];
      const label = first === undefined || first === `DB${dbNumber}` ? undefined : first;
      return {
        dbNumber,
        ...(label === undefined ? {} : { label }),
        ...(verdict === undefined ? {} : { verdict }),
        ...(blocks.get(dbNumber) === undefined ? {} : { block: blocks.get(dbNumber) as S7InventoryBlock }),
        status: verdict?.status ?? 'uncatalogued'
      } satisfies S7Row;
    });
  }

  /**
   * What the CPU said, and how far the catalog still matches it.
   *
   * Rendered as a CARD with a table rather than a message bar: the four verdicts
   * call for four different actions, and a paragraph of prose makes an operator
   * re-read every sentence to find the two blocks that matter. One row per data
   * block, both readings side by side, and the per-row tooltip says what the
   * verdict means — the warnings below then only have to say how many.
   */
  private renderS7Inventory(book: AddressBook): TemplateResult {
    const result = this.s7Inventory;
    if (result === null || result.bookId !== book.id) return html``;
    const { cpu, counts } = result.inventory;
    const identity = cpu.moduleTypeName ?? cpu.moduleName ?? cpu.orderCode ?? this.tr(MSG.s7CpuUnknown);
    const rows = this.s7Rows(book, result);
    const bad = rows.some((row) => row.status === 'absent' || row.status === 'overrun');
    const tally = Object.entries(counts)
      .filter(([, n]) => typeof n === 'number' && n > 0)
      .map(([kind, n]) => `${kind} ${n}`)
      .join(' · ');
    return html`
      <section class="card ${bad ? 'warnings' : ''}">
        <div class="card-title">${this.tr(MSG.s7InventoryTitle)} — ${identity}</div>
        <div class="box-list">
          ${cpu.orderCode === undefined ? nothing : html`<span class="chip mono">${cpu.orderCode}</span>`}
          ${cpu.serialNumber === undefined ? nothing : html`<span class="chip mono soft">${cpu.serialNumber}</span>`}
          ${result.inventory.endpoint === undefined ? nothing : html`<span class="chip mono">${result.inventory.endpoint}</span>`}
          ${result.inventory.pduLength === undefined
            ? nothing
            : html`<span class="chip" title=${this.tr(MSG.s7PduHint)}>${this.tr(MSG.s7Pdu, { n: result.inventory.pduLength })}</span>`}
          <span class="chip soft mono">${result.inventory.readAt.replace('T', ' ').slice(0, STAMP_LENGTH)}</span>
        </div>
        ${tally === '' ? nothing : html`<div class="small soft">${this.tr(MSG.s7Counts)} ${tally}</div>`}
        ${rows.length === 0
          ? html`<div class="empty small">${this.tr(MSG.s7NoDataBlock)}</div>`
          : html`
              <table class="grid compact">
                <thead>
                  <tr>
                    <th>${this.tr(MSG.s7ColBlock)}</th>
                    <th>${this.tr(MSG.s7ColStatus)}</th>
                    <th>${this.tr(MSG.s7ColSignals)}</th>
                    <th>${this.tr(MSG.s7ColRead)}</th>
                    <th>${this.tr(MSG.s7ColCpuSize)}</th>
                    <th>${this.tr(MSG.s7ColCompiled)}</th>
                    <th>${this.tr(MSG.s7ColAuthor)}</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((row) => this.renderS7Row(row))}
                </tbody>
              </table>
            `}
        ${result.crossCheck.warnings.map((warning) => html`<div class="warn-text">${warnText(warning, this.uiLang)}</div>`)}
      </section>
    `;
  }

  /** One data block, catalog side and CPU side on the same line. */
  private renderS7Row(row: S7Row): TemplateResult {
    const bytes = (n: number | undefined) => (n === undefined ? '—' : this.tr(MSG.s7Bytes, { n }));
    return html`
      <tr>
        <td class="mono">
          DB${row.dbNumber}${row.label === undefined ? nothing : html` <span class="soft">${row.label}</span>`}
        </td>
        <td>
          <span class="chip ${s7StatusClass(row.status)}" title=${this.tr(MSG.s7StatusHint[row.status])}>
            ${this.tr(MSG.s7Status[row.status])}
          </span>
        </td>
        <td class="mono">${row.verdict === undefined ? '—' : row.verdict.signals}</td>
        <td class="mono">${row.verdict === undefined ? '—' : bytes(row.verdict.highestByte)}</td>
        <td class="mono">${bytes(row.block?.mc7Size)}</td>
        <td class="mono soft">${row.block?.codeDate === undefined ? '—' : row.block.codeDate.slice(0, DAY_LENGTH)}</td>
        <td class="soft">${row.block?.error ?? row.block?.author ?? '—'}</td>
      </tr>
    `;
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

  /**
   * The source kind, in the operator's language — falling back to the raw kind when
   * the label map does not carry it. Indexed through a widened record on purpose: the
   * provenance union grows every time a generator is added, and a book whose label is
   * missing must show its kind rather than break the panel that lists it.
   */
  private sourceLabel(book: AddressBook): string {
    const labels: Partial<Record<string, Ml>> = MSG.sourceKind;
    const label = labels[book.provenance.kind];
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
