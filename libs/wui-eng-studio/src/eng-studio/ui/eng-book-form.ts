// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Catalogue creation form — the screen that makes an address book WITHOUT an
 * equipment.
 *
 * One card per question, in the order an engineer answers them:
 *   1. **Identity** — the name, from which the id is derived once and then fixed
 *      (equipments reference a catalog by id, so a rename must not orphan them);
 *   2. **Source** — which generator, then what it reads. The file is read HERE, in
 *      the browser, and only travels on "Create": a mis-picked file costs nothing;
 *   3. **Interface** — the template/project distinction the whole mutualisation
 *      story rests on (see `bookInterfaceHint`). Hidden for the two generators
 *      where the question does not exist: an online walk carries the connection it
 *      walked, and a NodeSet2 is always a template (file-local namespace indices);
 *   4. **Attach** — optional, and additive: the catalog can be bound later.
 *
 * It performs no I/O. `wui:bookingest` / `wui:bookbrowse` carry the request, the
 * page executes it, and a refusal comes back as `error` — the form stays as it is,
 * so a rejected name never costs the files that were picked.
 */
import {
  OPCUA_OBJECTS_FOLDER,
  PROTOCOLS,
  bookIdFrom,
  buildBookFromIngest,
  type AddressBook,
  type BookEntry,
  type BookInterface,
  type Device,
  type OpcUaBrowseNode
} from '@visuelconcept/wui-eng-core';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { EngConnection, EngDriver, IngestRequest } from '../data/gateway.js';
import { engTheme } from '../eng-theme.js';
import { MSG, fmt, t, warnText, type Lang, type Ml } from '../i18n.js';
import { engBookFormStyles } from './eng-books.styles.js';
import { driverMismatchHint, renderDriverSelect } from './eng-driver-select.js';

/** The generators the form offers. `browse` is the only online one. */
export type BookFormat = 'browse' | 'simaticml' | 'csv' | 'xvm' | 'nodeset';

const FORMATS: BookFormat[] = ['browse', 'simaticml', 'csv', 'xvm', 'nodeset'];

/** File extensions each generator reads (an `accept` hint, never a validation). */
const ACCEPT: Record<Exclude<BookFormat, 'browse'>, string> = {
  simaticml: '.xml',
  csv: '.csv,.txt,.tsv',
  xvm: '.xvm,.xsy,.xef,.xml',
  nodeset: '.xml'
};

/** Bytes per kB, for the "2 files, 348 kB" summary. */
const BYTES_PER_KB = 1024;

/**
 * Rows the preview renders at most. A NodeSet2 of a real server yields thousands of
 * signals and the DOM cost is real; the count and the filter stay exact, so what is
 * capped is the SCROLLING, never the reading — and the cap says so (`bookPreviewShowing`).
 */
const PREVIEW_ROWS = 300;

/** One source document read in the browser (never uploaded until "Create"). */
interface SourceFile {
  fileName: string;
  text: string;
  size: number;
}

/** What "Create" emits for a file generator. */
export interface BookIngestDetail {
  request: IngestRequest;
  /** Equipments to attach the fresh catalog to (may be empty). */
  attachTo: string[];
}

/** What "Create" emits for an online walk. */
export interface BookBrowseDetail {
  request: { bookId: string; connection: string; name: string; rootNodeId?: string; driverNumber?: number };
  attachTo: string[];
}

export class WuiEngBookForm extends LitElement {
  static override readonly styles = [engTheme, engBookFormStyles];

  /** The registry, to warn that a derived id would REPLACE an existing catalog. */
  @property({ attribute: false }) books: AddressBook[] = [];
  @property({ attribute: false }) devices: Device[] = [];
  @property({ attribute: false }) drivers: EngDriver[] = [];
  @property({ attribute: false }) connections: EngConnection[] = [];
  @property({ type: Boolean }) busy = false;
  /** Refusal of the last attempt, from the page (the gateway's own message). */
  @property({ type: String }) error = '';
  @property({ type: String }) uiLang: Lang = 'en';

  /** One browse round-trip, injected by the panel (never a fetch from here). */
  @property({ attribute: false }) browseLevel?: (connection: string, nodeId?: string) => Promise<OpcUaBrowseNode[]>;

  @state() private fName = '';
  @state() private fFormat: BookFormat = 'simaticml';
  @state() private fFiles: SourceFile[] = [];
  @state() private fFileError = '';
  @state() private fConnection = '';
  @state() private fRoot = '';
  @state() private fProtocol = 'modbus';
  @state() private fInterfaceConnection = '';
  @state() private fDriver = '';
  @state() private fDevices: string[] = [];

  /** What the picked files ACTUALLY contain — parsed here, never stored (see `buildPreview`). */
  @state() private preview: AddressBook | null = null;
  @state() private previewError = '';
  @state() private parsing = false;
  @state() private previewFilter = '';

  /** Explorer: children per opened node id, and which ones are open. */
  @state() private explored = new Map<string, OpcUaBrowseNode[]>();
  @state() private open = new Set<string>();
  /** Node ids whose request is in flight — each row shows its own spinner. */
  @state() private loading = new Set<string>();
  @state() private explorerError = '';

  override connectedCallback(): void {
    super.connectedCallback();
    // The element is created when the form opens and destroyed when it closes, so
    // the draft needs no reset: this IS the blank draft. The online generator is
    // pre-selected when the project has a connection — the case with no file.
    this.fFormat = this.connections.length > 0 ? 'browse' : 'simaticml';
    this.fConnection = this.connections.find((connection) => connection.connected)?.name ?? this.connections[0]?.name ?? '';
  }

  override render(): TemplateResult {
    const problems = this.problems();
    return html`
      <div class="panel-head">
        <h2>${this.tr(MSG.bookFormNew)}</h2>
        <div class="spacer"></div>
        <ix-button variant="tertiary" ?disabled=${this.busy} @click=${this.onCancel}>${this.tr(MSG.cancel)}</ix-button>
        <ix-button variant="primary" icon="check" ?disabled=${this.busy || problems.length > 0} @click=${this.onSubmit}>
          ${this.tr(MSG.bookCreate)}
        </ix-button>
      </div>
      <div class="panel-scroll">
        <div class="eng-form">
          ${this.error === '' ? nothing : html`<ix-message-bar type="alarm" persistent>${this.error}</ix-message-bar>`}
          ${this.renderIdentityCard()}
          ${this.renderSourceCard()}
          ${this.renderPreviewCard()}
          ${this.fFormat === 'browse' || this.fFormat === 'nodeset' ? nothing : this.renderInterfaceCard()}
          ${this.renderAttachCard()}
          ${problems.length === 0
            ? nothing
            : html`<section class="card warnings">
                <div class="card-title">${this.tr(MSG.deviceProblems)}</div>
                <ul>
                  ${problems.map((problem) => html`<li class="warn-text">${problem}</li>`)}
                </ul>
              </section>`}
        </div>
      </div>
    `;
  }

  private tr(message: Ml, params: Record<string, string | number> = {}): string {
    return fmt(t(message, this.uiLang), params);
  }

  // --- the cards --------------------------------------------------------------

  private renderIdentityCard(): TemplateResult {
    const id = this.draftId();
    const exists = id !== '' && this.books.some((book) => book.id === id);
    return html`
      <section class="card">
        <div class="card-title">${this.tr(MSG.bookIdentity)}</div>
        <label class="form-row">
          <span>${this.tr(MSG.bookName)} *</span>
          <ix-input
            placeholder="Catalogue_Pompe_KSB"
            .value=${this.fName}
            @valueChange=${(event: CustomEvent<string>) => (this.fName = String(event.detail))}
          ></ix-input>
        </label>
        <div class="form-hint">${this.tr(MSG.bookIdDerived, { id: id === '' ? '…' : id })}</div>
        ${exists ? html`<div class="form-hint warn-inline">${this.tr(MSG.bookIdExists, { id })}</div>` : nothing}
      </section>
    `;
  }

  private renderSourceCard(): TemplateResult {
    // A project with no OPC UA connection has nothing to walk: offering the online
    // generator there would only lead to an empty picker.
    const offered = FORMATS.filter((format) => format !== 'browse' || this.connections.length > 0);
    return html`
      <section class="card">
        <div class="card-title">${this.tr(MSG.bookSourceSection)}</div>
        <label class="form-row">
          <span>${this.tr(MSG.bookFormat)} *</span>
          <ix-select
            .value=${this.fFormat}
            @valueChange=${(event: CustomEvent<string | string[]>) => this.onFormat(firstOf(event.detail) as BookFormat)}
          >
            ${offered.map(
              (format) => html`<ix-select-item value=${format} label=${t(MSG.format[format], this.uiLang)}></ix-select-item>`
            )}
          </ix-select>
        </label>
        <div class="form-hint">${t(MSG.formatHint[this.fFormat], this.uiLang)}</div>
        ${this.fFormat === 'browse' ? this.renderBrowseFields() : this.renderFileField()}
        ${this.fFormat === 'nodeset'
          ? html`<div class="form-hint warn-inline">${this.tr(MSG.bookNodesetNoInterface)}</div>`
          : nothing}
      </section>
    `;
  }

  private renderBrowseFields(): TemplateResult {
    return html`
      <label class="form-row">
        <span>${this.tr(MSG.browseConnection)} *</span>
        <ix-select
          .value=${this.fConnection}
          @valueChange=${(event: CustomEvent<string | string[]>) => (this.fConnection = firstOf(event.detail))}
        >
          ${this.connections.map(
            (connection) => html`<ix-select-item
              value=${connection.name}
              label=${connection.name + (connection.connected ? '' : this.tr(MSG.disconnectedSuffix))}
            ></ix-select-item>`
          )}
        </ix-select>
      </label>
      <label class="form-row">
        <span>${this.tr(MSG.browseRoot)}</span>
        <ix-input
          placeholder="ns=0;i=85 (Objects)"
          .value=${this.fRoot}
          @valueChange=${(event: CustomEvent<string>) => (this.fRoot = String(event.detail))}
        ></ix-input>
      </label>
      ${this.renderDriverRow()}
      <div class="form-hint">${this.tr(MSG.driverHint)}</div>
      ${this.renderExplorer()}
    `;
  }

  /**
   * The server EXPLORER — look before committing.
   *
   * A walk of a real server catalogues thousands of variables, and most of them are
   * not what the project needs. So the address space is browsable here one level at a
   * time (one request per branch, nothing stored), and any branch can be promoted to
   * the walk root — which is the difference between a catalog of 200 useful signals
   * and one of 12 000. It is also the only honest answer to "what is actually on this
   * machine?", which no amount of documentation replaces.
   */
  private renderExplorer(): TemplateResult {
    if (this.browseLevel === undefined || this.fConnection === '') return html``;
    const root = this.fRoot.trim() === '' ? OPCUA_OBJECTS_FOLDER : this.fRoot.trim();
    return html`
      <div class="explorer">
        <div class="explorer-head">
          <span class="explorer-title">${this.tr(MSG.explorerTitle)}</span>
          <span class="soft small mono">${this.tr(MSG.explorerRootIs, { root })}</span>
          <div class="spacer"></div>
          <ix-button
            variant="secondary"
            icon="chevron-right-small"
            ?disabled=${this.busy}
            @click=${() => void this.openNode(root)}
          >
            ${this.tr(MSG.explorerOpen)}
          </ix-button>
        </div>
        <div class="form-hint">${this.tr(MSG.explorerHint)}</div>
        ${this.explorerError === ''
          ? nothing
          : html`<div class="form-hint warn-inline">${this.explorerError}</div>`}
        ${this.explored.has(root) ? html`<div class="explorer-tree">${this.renderExplorerLevel(root, 0)}</div>` : nothing}
      </div>
    `;
  }

  /** One explored level, indented; recurses into the branches the operator opened. */
  private renderExplorerLevel(nodeId: string, depth: number): TemplateResult {
    const nodes = this.explored.get(nodeId) ?? [];
    if (nodes.length === 0) return html`<div class="explorer-empty" style="--depth:${depth}">${this.tr(MSG.explorerEmpty)}</div>`;
    const variables = nodes.filter((node) => node.nodeClass.includes('Variable')).length;
    return html`
      <div class="explorer-counts" style="--depth:${depth}">
        ${this.tr(MSG.explorerCounts, { variables, containers: nodes.length - variables })}
      </div>
      ${nodes.map((node) => this.renderExplorerNode(node, depth))}
    `;
  }

  private renderExplorerNode(node: OpcUaBrowseNode, depth: number): TemplateResult {
    const variable = node.nodeClass.includes('Variable');
    const opened = this.open.has(node.nodeId);
    return html`
      <div class="explorer-row" style="--depth:${depth}">
        ${variable
          ? html`<span class="explorer-leaf">•</span>`
          : html`<button
              class="explorer-toggle"
              ?disabled=${this.busy}
              title=${this.tr(MSG.explorerOpen)}
              @click=${() => void this.toggleNode(node.nodeId)}
            >
              ${this.branchGlyph(node.nodeId, opened)}
            </button>`}
        <span class="explorer-name">${node.displayName}</span>
        ${variable
          ? html`<span class="chip">${node.dataType ?? '?'}</span>`
          : html`<span class="chip mode">${node.nodeClass}</span>`}
        <span class="soft small mono explorer-id">${node.nodeId}</span>
        ${variable
          ? nothing
          : html`<button class="explorer-root" title=${this.tr(MSG.explorerUseAsRoot)} @click=${() => this.useAsRoot(node.nodeId)}>
              ⌖
            </button>`}
      </div>
      ${opened && this.explored.has(node.nodeId) ? this.renderExplorerLevel(node.nodeId, depth + 1) : nothing}
    `;
  }

  private renderDriverRow(): TemplateResult {
    return html`
      <label class="form-row">
        <span>${this.tr(MSG.deviceDriverNumber)}</span>
        ${renderDriverSelect({
          drivers: this.drivers,
          value: this.fDriver,
          lang: this.uiLang,
          onChange: (value) => (this.fDriver = value)
        })}
      </label>
    `;
  }

  private renderFileField(): TemplateResult {
    const multiple = this.fFormat === 'simaticml';
    const bytes = this.fFiles.reduce((total, file) => total + file.size, 0);
    return html`
      <label class="form-row">
        <span>${this.tr(multiple ? MSG.bookFiles : MSG.bookFile)} *</span>
        <input
          class="filter file"
          type="file"
          ?multiple=${multiple}
          accept=${ACCEPT[this.fFormat as Exclude<BookFormat, 'browse'>]}
          @change=${(event: Event) => void this.onFiles(event.target as HTMLInputElement)}
        />
      </label>
      <div class="form-hint ${this.fFileError === '' ? '' : 'warn-inline'}">
        ${this.fFileError === '' ? this.fileSummary(bytes) : this.fFileError}
      </div>
      ${this.fFiles.length > 0
        ? html`<div class="box-list">
            ${this.fFiles.map((file) => html`<span class="chip mono">${file.fileName}</span>`)}
          </div>`
        : nothing}
    `;
  }

  /** "2 files, 348 kB", or the "no file chosen" prompt. */
  private fileSummary(bytes: number): string {
    if (this.fFiles.length === 0) return this.tr(MSG.bookNoFile);
    return this.tr(MSG.bookFileChosen, {
      n: this.fFiles.length,
      size: Math.max(1, Math.round(bytes / BYTES_PER_KB))
    });
  }

  /**
   * The IMPORT PREVIEW — what the file holds, before anything is created.
   *
   * Parsed in the browser by `buildBookFromIngest`, i.e. by the very function the
   * server ingests with (see the core's `ingest.ts`): a preview that chose its
   * generator differently from the ingestion would be worse than none. So a wrong
   * file, a wrong generator, a source that yields nothing — or one that yields 12 000
   * signals instead of 200 — is visible while it still costs nothing, and the
   * generator's own warnings (unresolved UDTs, duplicate paths, unmapped types) are
   * read at the moment they can still change the decision rather than after the fact.
   */
  private renderPreviewCard(): TemplateResult | typeof nothing {
    if (this.fFormat === 'browse') return nothing;
    if (this.parsing) {
      return html`<section class="card">
        <div class="card-title">${this.tr(MSG.bookPreviewSection)}</div>
        <div class="preview-busy"><ix-spinner size="small"></ix-spinner><span class="soft small">${this.tr(MSG.bookPreviewParsing)}</span></div>
      </section>`;
    }
    if (this.previewError !== '') {
      return html`<section class="card warnings">
        <div class="card-title">${this.tr(MSG.bookPreviewSection)}</div>
        <div class="warn-text">${this.previewError}</div>
      </section>`;
    }
    const book = this.preview;
    if (book === null) return nothing;
    const unmapped = book.entries.filter((entry) => entry.unmapped === true).length;
    const shown = this.previewEntries(book);
    return html`
      <section class="card">
        <div class="preview-head">
          <div class="card-title">${this.tr(MSG.bookPreviewSection)}</div>
          <span class="chip primary">${this.tr(MSG.bookPreviewCounts, { signals: book.entries.length, types: book.types.length })}</span>
          ${unmapped === 0 ? nothing : html`<span class="chip warning">${this.tr(MSG.bookPreviewUnmapped, { n: unmapped })}</span>`}
          <div class="spacer"></div>
          ${book.entries.length === 0
            ? nothing
            : html`<input
                class="filter preview-filter"
                type="search"
                placeholder=${this.tr(MSG.filterPlaceholder)}
                .value=${this.previewFilter}
                @input=${(event: Event) => (this.previewFilter = (event.target as HTMLInputElement).value)}
              />`}
        </div>
        ${book.warnings.length === 0
          ? nothing
          : html`<ul class="preview-warnings">
              ${book.warnings.map((warning) => html`<li class="warn-text">${warnText(warning, this.uiLang)}</li>`)}
            </ul>`}
        ${book.entries.length === 0 ? html`<div class="empty small">${this.tr(MSG.bookPreviewEmpty)}</div>` : this.renderPreviewTable(book, shown)}
        ${book.types.length === 0 ? nothing : this.renderPreviewTypes(book)}
        <div class="form-hint">${this.tr(MSG.bookPreviewHint)}</div>
      </section>
    `;
  }

  /** The filtered entries, capped — the cap is stated, never silent. */
  private previewEntries(book: AddressBook): BookEntry[] {
    const needle = this.previewFilter.trim().toLowerCase();
    const matching =
      needle === ''
        ? book.entries
        : book.entries.filter(
            (entry) => entry.path.toLowerCase().includes(needle) || (entry.comment ?? '').toLowerCase().includes(needle)
          );
    return matching.slice(0, PREVIEW_ROWS);
  }

  private renderPreviewTable(book: AddressBook, shown: BookEntry[]): TemplateResult {
    if (shown.length === 0) return html`<div class="empty small">${this.tr(MSG.bookPreviewNoMatch)}</div>`;
    return html`
      <div class="preview-table">
        <table class="grid compact">
          <thead>
            <tr>
              <th>${this.tr(MSG.colPath)}</th>
              <th>${this.tr(MSG.colSourceType)}</th>
              <th>${this.tr(MSG.colType)}</th>
              <th>${this.tr(MSG.colAccess)}</th>
              <th>${this.tr(MSG.colComment)}</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map(
              (entry) => html`<tr>
                <td class="mono">${entry.path}</td>
                <td class="soft">${entry.sourceType}</td>
                <td>
                  <span class="chip ${entry.unmapped === true ? 'warning' : ''}">${entry.leafType}</span>
                </td>
                <td><span class="chip acc">${entry.access}</span></td>
                <td class="soft small">${entry.comment ?? ''}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
      <div class="form-hint">${this.tr(MSG.bookPreviewShowing, { n: shown.length, total: book.entries.length })}</div>
    `;
  }

  /** The structured types the source declares — the DPT candidates of the model step. */
  private renderPreviewTypes(book: AddressBook): TemplateResult {
    return html`
      <div class="preview-types">
        <span class="soft small">${this.tr(MSG.bookPreviewTypes)}</span>
        ${book.types.map(
          (type) => html`<span class="chip mono" title=${type.members.map((member) => member.path).join(', ')}>
            ${type.name} · ${this.tr(MSG.bookPreviewMembers, { n: type.members.length })}
          </span>`
        )}
      </div>
    `;
  }

  private renderInterfaceCard(): TemplateResult {
    const mismatch = driverMismatchHint(this.drivers, this.fDriver, this.fProtocol, this.uiLang);
    return html`
      <section class="card">
        <div class="card-title">${this.tr(MSG.bookInterfaceSection)}</div>
        <label class="form-row">
          <span>${this.tr(MSG.fieldProtocol)}</span>
          <ix-select
            .value=${this.fProtocol}
            @valueChange=${(event: CustomEvent<string | string[]>) => (this.fProtocol = firstOf(event.detail))}
          >
            ${PROTOCOLS.map(
              (protocol) => html`<ix-select-item value=${protocol} label=${protocolLabel(protocol)}></ix-select-item>`
            )}
          </ix-select>
        </label>
        <label class="form-row">
          <span>${this.tr(MSG.fieldConnection)}</span>
          <ix-input
            placeholder="M580_Station"
            .value=${this.fInterfaceConnection}
            @valueChange=${(event: CustomEvent<string>) => (this.fInterfaceConnection = String(event.detail))}
          ></ix-input>
        </label>
        ${this.renderDriverRow()}
        ${mismatch === null ? nothing : html`<div class="form-hint warn-inline">${mismatch}</div>`}
        <div class="form-hint">${this.tr(MSG.bookInterfaceHint)}</div>
      </section>
    `;
  }

  private renderAttachCard(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-title">${this.tr(MSG.bookAttachSection)}</div>
        ${this.devices.length === 0
          ? html`<div class="empty small">${this.tr(MSG.bookNoDeviceYet)}</div>`
          : html`<div class="box-list">
              ${this.devices.map(
                (device) => html`<label class="box" title=${device.name}>
                  <input
                    type="checkbox"
                    .checked=${this.fDevices.includes(device.id)}
                    @change=${() => this.toggleDevice(device.id)}
                  />
                  <span class="box-name">${device.name}</span>
                  <span class="chip proto">${protocolLabel(device.protocol ?? '')}</span>
                </label>`
              )}
            </div>`}
      </section>
    `;
  }

  // --- actions ----------------------------------------------------------------

  private onCancel(): void {
    this.dispatchEvent(new CustomEvent('wui:bookcancel', { bubbles: true, composed: true }));
  }

  private onFormat(format: BookFormat): void {
    this.fFormat = format;
    // Files read for another generator would be handed to a parser that cannot read
    // them: drop them rather than let "Create" fail on the server.
    this.fFiles = [];
    this.fFileError = '';
    this.clearPreview();
  }

  private async onFiles(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    this.fFileError = '';
    this.clearPreview();
    try {
      const read = await Promise.all(
        files.map(async (file) => ({ fileName: file.name, text: await file.text(), size: file.size }))
      );
      this.fFiles = read;
      // A nameless catalog takes the first file's name — the common case, and it
      // keeps the derived id recognisable in the store.
      if (this.fName.trim() === '' && read[0]) this.fName = read[0].fileName.replace(/\.[^.]+$/, '');
    } catch (error) {
      this.fFiles = [];
      this.fFileError = this.tr(MSG.bookReadFailed, { error: (error as Error).message });
      return;
    }
    await this.buildPreview();
  }

  private clearPreview(): void {
    this.preview = null;
    this.previewError = '';
    this.previewFilter = '';
  }

  /**
   * Parse the picked files with the INGESTION function itself.
   *
   * The interface is deliberately left out: no generator derives an entry from it (it
   * is only recorded on the book, and the addresses are bound at creation), so leaving
   * it out keeps the preview identical to what "Create" produces while sparing a
   * re-parse on every keystroke in the interface fields.
   *
   * The parse is synchronous and a multi-megabyte NodeSet2 blocks the thread for a
   * moment, so the "reading…" line is painted FIRST: a screen that freezes with no
   * explanation reads as a crash.
   */
  private async buildPreview(): Promise<void> {
    if (this.fFormat === 'browse' || this.fFiles.length === 0) return;
    const format = this.fFormat;
    this.parsing = true;
    await this.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      this.preview = buildBookFromIngest({
        bookId: this.draftId() === '' ? 'preview' : this.draftId(),
        name: this.fName.trim(),
        format,
        file: this.fFiles.map((file) => file.fileName).join(', '),
        ...this.sourcePayload()
      });
    } catch (error) {
      this.previewError = this.tr(MSG.bookPreviewFailed, {
        format: t(MSG.format[format], this.uiLang),
        error: (error as Error).message
      });
    } finally {
      this.parsing = false;
    }
  }

  /** Branch marker: waiting for its request, open, or closed. */
  private branchGlyph(nodeId: string, opened: boolean): string {
    if (this.loading.has(nodeId)) return '…';
    return opened ? '▾' : '▸';
  }

  /** Open a branch (one request), remembering its children. Failures are per-branch. */
  private async openNode(nodeId: string): Promise<void> {
    if (this.browseLevel === undefined || this.explored.has(nodeId)) return;
    this.loading = new Set([...this.loading, nodeId]);
    this.explorerError = '';
    try {
      const nodes = await this.browseLevel(this.fConnection, nodeId);
      this.explored = new Map([...this.explored, [nodeId, nodes]]);
    } catch (error) {
      // One unreadable branch must not stop the exploration of the others — the same
      // tolerance the walker itself applies.
      this.explorerError = this.tr(MSG.explorerFailed, { error: (error as Error).message });
    } finally {
      const loading = new Set(this.loading);
      loading.delete(nodeId);
      this.loading = loading;
    }
  }

  private async toggleNode(nodeId: string): Promise<void> {
    const open = new Set(this.open);
    if (open.has(nodeId)) open.delete(nodeId);
    else open.add(nodeId);
    this.open = open;
    if (open.has(nodeId)) await this.openNode(nodeId);
  }

  /**
   * Promote the explored branch to the walk root. The whole point of exploring: the
   * root is what decides whether the catalog holds the machine's 200 useful signals
   * or the server's 12 000.
   */
  private useAsRoot(nodeId: string): void {
    this.fRoot = nodeId;
  }

  private toggleDevice(deviceId: string): void {
    this.fDevices = this.fDevices.includes(deviceId)
      ? this.fDevices.filter((id) => id !== deviceId)
      : [...this.fDevices, deviceId];
  }

  private onSubmit(): void {
    if (this.problems().length > 0) return;
    const bookId = this.draftId();
    const name = this.fName.trim();
    if (this.fFormat === 'browse') {
      const driverNumber = this.driverNumber();
      const detail: BookBrowseDetail = {
        request: {
          bookId,
          connection: this.fConnection,
          name,
          ...(this.fRoot.trim() === '' ? {} : { rootNodeId: this.fRoot.trim() }),
          ...(driverNumber === undefined ? {} : { driverNumber })
        },
        attachTo: this.fDevices
      };
      this.dispatchEvent(new CustomEvent<BookBrowseDetail>('wui:bookbrowse', { detail, bubbles: true, composed: true }));
      return;
    }
    const iface = this.formInterface();
    const detail: BookIngestDetail = {
      request: {
        bookId,
        name,
        format: this.fFormat,
        file: this.fFiles.map((file) => file.fileName).join(', '),
        ...this.sourcePayload(),
        ...(iface === undefined ? {} : { interface: iface })
      },
      attachTo: this.fDevices
    };
    this.dispatchEvent(new CustomEvent<BookIngestDetail>('wui:bookingest', { detail, bubbles: true, composed: true }));
  }

  /**
   * The payload field the chosen generator reads. SimaticML takes the whole bundle
   * (a TIA export is several documents); the others read one document — as XML, or
   * as plain text for the Control Expert CSV.
   */
  private sourcePayload(): Pick<IngestRequest, 'documents' | 'xml' | 'text'> {
    if (this.fFormat === 'simaticml') {
      return { documents: this.fFiles.map((file) => ({ fileName: file.fileName, xml: file.text })) };
    }
    const text = this.fFiles[0]?.text ?? '';
    return this.fFormat === 'csv' ? { text } : { xml: text };
  }

  /** The interface the form declares, or `undefined` for a template catalog. */
  private formInterface(): BookInterface | undefined {
    if (this.fFormat === 'browse' || this.fFormat === 'nodeset') return undefined;
    const connection = this.fInterfaceConnection.trim();
    const driverNumber = this.driverNumber();
    if (connection === '' && driverNumber === undefined) return undefined;
    return {
      protocol: this.fProtocol as BookInterface['protocol'],
      ...(connection === '' ? {} : { connection }),
      ...(driverNumber === undefined ? {} : { driverNumber })
    };
  }

  private driverNumber(): number | undefined {
    const text = this.fDriver.trim();
    if (text === '') return undefined;
    const value = Number(text);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  /** What blocks "Create" — stated as sentences, not as a disabled button alone. */
  private problems(): string[] {
    const problems: string[] = [];
    if (this.fName.trim() === '') problems.push(this.tr(MSG.bookNeedName));
    if (this.fFormat === 'browse') {
      if (this.fConnection === '') problems.push(this.tr(MSG.bookNeedConnection));
    } else if (this.fFiles.length === 0) {
      problems.push(this.tr(MSG.bookNeedFile));
    }
    return problems;
  }

  private draftId(): string {
    return this.fName.trim() === '' ? '' : bookIdFrom(this.fName);
  }
}

/** Protocol display names (the same map the panel and the page use). */
function protocolLabel(protocol: string): string {
  const map: Record<string, string> = { opcua: 'OPC UA', s7: 'S7', s7plus: 'S7+', modbus: 'Modbus' };
  return map[protocol] ?? (protocol === '' ? '—' : protocol);
}

function firstOf(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

if (!customElements.get('wui-eng-book-form')) {
  customElements.define('wui-eng-book-form', WuiEngBookForm);
}
