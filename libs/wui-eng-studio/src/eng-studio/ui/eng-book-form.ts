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
  S7PLUS_ONLINE_STATION,
  bookIdFrom,
  detectColumnOrder,
  splitSymbolLine,
  buildBookFromIngest,
  s7plusChildItem,
  s7plusSymbolicPath,
  type AddressBook,
  type BookEntry,
  type BookInterface,
  type Device,
  type OpcUaBrowseNode,
  type ProtocolKind,
  type S7PlusBrowseNode
} from '@visuelconcept-winccoa/wui-eng-core';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type {
  EngConnection,
  EngDriver,
  EngS7PlusConnection,
  EngS7PlusStation,
  IngestRequest,
  S7PlusManagerHealth
} from '../data/gateway.js';
import { engTheme } from '../eng-theme.js';
import { MSG, fmt, t, warnText, type Lang, type Ml } from '../i18n.js';
import { engBookFormStyles } from './eng-books.styles.js';
import { driverMismatchHint, renderDriverSelect } from './eng-driver-select.js';

/**
 * The generators the form offers. `browse` (OPC UA) and `s7plus` (S7-1200/1500
 * symbolic) are the two ONLINE ones — they read a machine instead of a file, and
 * each is offered only when the project has a connection of its protocol.
 */
export type BookFormat = 'browse' | 's7plus' | 'simaticml' | 's7sym' | 's7awl' | 'csv' | 'xvm' | 'nodeset';

const FORMATS: BookFormat[] = ['browse', 's7plus', 'simaticml', 's7sym', 's7awl', 'csv', 'xvm', 'nodeset'];

/** The two generators that walk a live machine (no file, no interface card). */
const ONLINE_FORMATS = new Set<BookFormat>(['browse', 's7plus']);

/**
 * Generators that read a BUNDLE of files rather than one document.
 *
 * A TIA export is one XML per block, and *Generate source* in Simatic Manager is
 * one `.awl` per block just as often as it is one file for a whole program (a
 * single source may declare several DBs and their UDTs — both shapes are read).
 * Either way the members of a DB can only be laid out once the UDTs it references
 * are in hand, so these two accept many files and merge them.
 */
const BUNDLE_FORMATS = new Set<BookFormat>(['simaticml', 's7awl']);

/**
 * The interface protocol a file generator's addresses are written for.
 *
 * Not a preference: `modelgen` resolves a signal's address as
 * `book.interface.protocol`, so a book whose interface says `modbus` while its
 * entries carry `addresses.s7` generates a type with no address at all. Only the
 * generators whose output protocol is unambiguous are listed; the rest keep
 * whatever the operator chose.
 */
const INTERFACE_PROTOCOL: Partial<Record<BookFormat, string>> = {
  s7sym: 's7',
  s7awl: 's7',
  csv: 'modbus',
  xvm: 'modbus'
};

/** File extensions each generator reads (an `accept` hint, never a validation). */
const ACCEPT: Record<Exclude<BookFormat, 'browse' | 's7plus'>, string> = {
  simaticml: '.xml',
  s7sym: '.asc,.sdf,.seq,.csv,.txt',
  s7awl: '.awl,.stl,.scl,.txt,.db,.udt',
  csv: '.csv,.txt,.tsv',
  xvm: '.xvm,.xsy,.xef,.xml',
  nodeset: '.xml'
};

/**
 * Is this picked file a STEP 7 symbol table rather than an AWL source?
 *
 * Decided on the CONTENT, not on the extension: both exports are plain text and an
 * engineer renames files. An AWL source declares blocks (`DATA_BLOCK` / `TYPE`); a
 * symbol table never does, so the absence of a declaration is the reliable half of
 * the test, and the presence of a readable operand column is the confirming half.
 */
function isSymbolTableFile(file: { fileName: string; text: string }): boolean {
  if (/^\s*(DATA_BLOCK|TYPE)\b/im.test(file.text)) return false;
  const rows = file.text
    .split('\n')
    .slice(0, 40)
    .map((line) => splitSymbolLine(line))
    .filter((columns) => columns.length >= 2);
  return rows.length > 0 && detectColumnOrder(rows) !== null;
}

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

/**
 * What "Create" emits for an **S7Plus** walk. Its own event rather than a variant
 * of {@link BookBrowseDetail}: the two protocols address a sub-tree differently (a
 * TIA `project|station` plus an item path, versus a node id), and a shared shape
 * with half its fields ignored is how a wrong one gets sent.
 */
export interface BookS7PlusBrowseDetail {
  request: {
    bookId: string;
    connection: string;
    name: string;
    station: string;
    root?: string;
    hmiVisibleOnly?: boolean;
    driverNumber?: number;
  };
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

  // --- S7Plus (S7-1200/1500 symbolic) ----------------------------------------
  /** The project's S7Plus connections; empty hides the S7+ generator. */
  @property({ attribute: false }) s7plusConnections: EngS7PlusConnection[] = [];
  /** Whether the dedicated browse manager answers — a walk needs it. */
  @property({ attribute: false }) s7plusManager?: S7PlusManagerHealth;
  /** The TIA sources of a connection (online + its exports), injected by the panel. */
  @property({ attribute: false }) s7plusSources?: (connection: string) => Promise<EngS7PlusStation[]>;
  /** One S7Plus browse level, injected the same way as {@link browseLevel}. */
  @property({ attribute: false }) browseS7PlusLevel?: (
    connection: string,
    item?: string,
    hmiVisibleOnly?: boolean
  ) => Promise<S7PlusBrowseNode[]>;

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

  /** S7Plus draft: the connection, the TIA source, the sub-tree and the HMI filter. */
  @state() private fS7Connection = '';
  @state() private fS7Station = '';
  @state() private fS7Root = '';
  @state() private fS7HmiOnly = true;
  /** The TIA sources offered for `fS7Connection`, once asked for. */
  @state() private s7Stations: EngS7PlusStation[] = [];
  @state() private s7StationsError = '';
  /** S7Plus explorer: children per opened ITEM, in parallel to the OPC UA one. */
  @state() private s7Explored = new Map<string, S7PlusBrowseNode[]>();
  @state() private s7Open = new Set<string>();
  @state() private s7Loading = new Set<string>();
  @state() private s7ExplorerError = '';

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
    // An online generator is pre-selected when the project has a connection of its
    // protocol — the only case with no file to pick. OPC UA first, then S7+: a
    // project with both is far more often browsed over OPC UA.
    this.fFormat = this.connections.length > 0 ? 'browse' : (this.s7plusConnections.length > 0 ? 's7plus' : 'simaticml');
    this.fConnection = this.connections.find((connection) => connection.connected)?.name ?? this.connections[0]?.name ?? '';
    const s7 = this.s7plusConnections.find((connection) => connection.connected) ?? this.s7plusConnections[0];
    this.fS7Connection = s7?.name ?? '';
    // The station the WinCC OA side is already configured for is the honest default:
    // it is the one the standard panel browses, and retyping it invites a typo.
    this.fS7Station = s7?.station ?? '';
    if (this.fS7Connection !== '') void this.loadS7Sources(this.fS7Connection);
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
          ${ONLINE_FORMATS.has(this.fFormat) || this.fFormat === 'nodeset' ? nothing : this.renderInterfaceCard()}
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
    const offered = FORMATS.filter((format) => {
      if (format === 'browse') return this.connections.length > 0;
      if (format === 's7plus') return this.s7plusConnections.length > 0;
      return true;
    });
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
        ${this.fFormat === 'browse'
          ? this.renderBrowseFields()
          : (this.fFormat === 's7plus' ? this.renderS7PlusFields() : this.renderFileField())}
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
      ${this.renderDriverRow('opcua')}
      <div class="form-hint">${this.tr(MSG.driverHint)}</div>
      ${this.renderExplorer()}
    `;
  }

  /**
   * The S7Plus source fields: the connection, the TIA source, the sub-tree, the
   * driver's own HMI filter — plus the two diagnoses a walk depends on and that the
   * form must not hide (no browse manager, no running S7Plus driver).
   */
  private renderS7PlusFields(): TemplateResult {
    const manager = this.s7plusManager;
    const noManager = manager !== undefined && !manager.reachable;
    const noDriver = manager?.reachable === true && manager.drivers !== undefined && manager.drivers.length === 0;
    return html`
      ${noManager ? html`<div class="form-hint warn-inline">${this.tr(MSG.s7plusNoManager)}</div>` : nothing}
      ${noDriver ? html`<div class="form-hint warn-inline">${this.tr(MSG.s7plusNoDriver)}</div>` : nothing}
      <label class="form-row">
        <span>${this.tr(MSG.browseConnection)} *</span>
        <ix-select
          .value=${this.fS7Connection}
          @valueChange=${(event: CustomEvent<string | string[]>) => void this.onS7Connection(firstOf(event.detail))}
        >
          ${this.s7plusConnections.map(
            (connection) => html`<ix-select-item
              value=${connection.name}
              label=${connection.name + (connection.connected ? '' : this.tr(MSG.disconnectedSuffix))}
            ></ix-select-item>`
          )}
        </ix-select>
      </label>
      <label class="form-row">
        <span>${this.tr(MSG.s7plusSource)} *</span>
        <ix-select
          editable
          .value=${this.fS7Station}
          @valueChange=${(event: CustomEvent<string | string[]>) => this.onS7Station(firstOf(event.detail))}
        >
          ${this.s7StationOptions().map(
            (option) => html`<ix-select-item value=${option.station} label=${option.name}></ix-select-item>`
          )}
        </ix-select>
      </label>
      <div class="form-hint ${this.s7StationsError === '' ? '' : 'warn-inline'}">
        ${this.s7StationsError === '' ? this.tr(MSG.s7plusSourceHint) : this.s7StationsError}
      </div>
      <label class="form-row">
        <span>${this.tr(MSG.browseRoot)}</span>
        <ix-input
          placeholder=${this.fS7Station === '' ? 'Projet|Station|Blocks|DB_Echange' : `${this.fS7Station}|Blocks|DB_Echange`}
          .value=${this.fS7Root}
          @valueChange=${(event: CustomEvent<string>) => (this.fS7Root = String(event.detail))}
        ></ix-input>
      </label>
      <label class="form-row">
        <span>${this.tr(MSG.s7plusHmiOnly)}</span>
        <ix-toggle
          .checked=${this.fS7HmiOnly}
          @checkedChange=${(event: CustomEvent<boolean>) => this.onS7HmiOnly(Boolean(event.detail))}
        ></ix-toggle>
      </label>
      <div class="form-hint">${this.tr(MSG.s7plusHmiOnlyHint)}</div>
      ${this.renderDriverRow('s7plus')}
      <div class="form-hint">${this.tr(MSG.driverHint)}</div>
      ${this.renderS7PlusExplorer()}
    `;
  }

  /**
   * The TIA sources offered. The connection's own configured station is kept even
   * when the manager could not list the sources (a stopped driver answers nothing,
   * and dropping a value the WinCC OA side already holds would be a regression the
   * operator has to undo by typing).
   */
  private s7StationOptions(): EngS7PlusStation[] {
    const options = [...this.s7Stations];
    const configured = this.s7plusConnections.find((connection) => connection.name === this.fS7Connection)?.station;
    for (const station of [configured, this.fS7Station]) {
      if (station !== undefined && station !== '' && !options.some((option) => option.station === station)) {
        options.push({ name: this.s7StationLabel(station), station });
      }
    }
    return options;
  }

  /** The online marker reads as a sentence; a TIA source reads as `project|station`. */
  private s7StationLabel(station: string): string {
    return station.startsWith('S7Plus$Online') ? this.tr(MSG.s7plusOnline) : station;
  }

  /**
   * The station EXPLORER — the same "look before committing" as the OPC UA one, and
   * for a stronger reason: a station's blocks hold everything the program declares,
   * while a catalog usually wants one exchange block.
   */
  private renderS7PlusExplorer(): TemplateResult {
    if (this.browseS7PlusLevel === undefined || this.fS7Connection === '' || this.fS7Station === '') return html``;
    const root = this.fS7Root.trim() === '' ? this.fS7Station : this.fS7Root.trim();
    return html`
      <div class="explorer">
        <div class="explorer-head">
          <span class="explorer-title">${this.tr(MSG.s7plusExplorerTitle)}</span>
          <span class="soft small mono">${this.tr(MSG.explorerRootIs, { root })}</span>
          <div class="spacer"></div>
          <ix-button
            variant="secondary"
            icon="chevron-right-small"
            ?disabled=${this.busy}
            @click=${() => void this.openS7Node(root)}
          >
            ${this.tr(MSG.explorerOpen)}
          </ix-button>
        </div>
        <div class="form-hint">${this.tr(MSG.s7plusExplorerHint)}</div>
        ${this.s7ExplorerError === '' ? nothing : html`<div class="form-hint warn-inline">${this.s7ExplorerError}</div>`}
        ${this.s7Explored.has(root) ? html`<div class="explorer-tree">${this.renderS7PlusLevel(root, 0)}</div>` : nothing}
      </div>
    `;
  }

  private renderS7PlusLevel(item: string, depth: number): TemplateResult {
    const nodes = this.s7Explored.get(item) ?? [];
    if (nodes.length === 0) return html`<div class="explorer-empty" style="--depth:${depth}">${this.tr(MSG.explorerEmpty)}</div>`;
    const variables = nodes.filter((node) => isS7Leaf(node)).length;
    return html`
      <div class="explorer-counts" style="--depth:${depth}">
        ${this.tr(MSG.explorerCounts, { variables, containers: nodes.length - variables })}
      </div>
      ${nodes.map((node) => this.renderS7PlusNode(item, node, depth))}
    `;
  }

  private renderS7PlusNode(parent: string, node: S7PlusBrowseNode, depth: number): TemplateResult {
    const leaf = isS7Leaf(node);
    // The child ITEM is built by the core (the driver's own grammar, synthetic
    // `Blocks`/`Tags` segments included) — never re-derived here, or the explorer
    // and the walk would ask for different paths.
    const item = s7plusChildItem(parent, node);
    const opened = this.s7Open.has(item);
    return html`
      <div class="explorer-row" style="--depth:${depth}">
        ${leaf
          ? html`<span class="explorer-leaf">•</span>`
          : html`<button
              class="explorer-toggle"
              ?disabled=${this.busy}
              title=${this.tr(MSG.explorerOpen)}
              @click=${() => void this.toggleS7Node(item)}
            >
              ${this.s7BranchGlyph(item, opened)}
            </button>`}
        <span class="explorer-name">${node.nodePath}</span>
        ${leaf
          ? html`<span class="chip">${(node.valueType ?? '') === '' ? '?' : node.valueType}</span>`
          : html`<span class="chip mode">${node.systemType}</span>`}
        <span class="soft small mono explorer-id">${s7plusSymbolicPath(this.fS7Station, item)}</span>
        ${leaf
          ? nothing
          : html`<button class="explorer-root" title=${this.tr(MSG.explorerUseAsRoot)} @click=${() => (this.fS7Root = item)}>
              ⌖
            </button>`}
      </div>
      ${opened && this.s7Explored.has(item) ? this.renderS7PlusLevel(item, depth + 1) : nothing}
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

  /**
   * The driver row. `protocol` is what the section is about (an OPC UA walk, an S7+
   * walk, the interface being declared), and it FILTERS the list: only the drivers
   * that can serve it, never the simulator — see `offerableDrivers`.
   */
  private renderDriverRow(protocol: ProtocolKind): TemplateResult {
    return html`
      <label class="form-row">
        <span>${this.tr(MSG.deviceDriverNumber)}</span>
        ${renderDriverSelect({
          drivers: this.drivers,
          value: this.fDriver,
          lang: this.uiLang,
          protocol,
          onChange: (value) => (this.fDriver = value)
        })}
      </label>
    `;
  }

  private renderFileField(): TemplateResult {
    const multiple = BUNDLE_FORMATS.has(this.fFormat);
    const bytes = this.fFiles.reduce((total, file) => total + file.size, 0);
    return html`
      <label class="form-row">
        <span>${this.tr(multiple ? MSG.bookFiles : MSG.bookFile)} *</span>
        <input
          class="filter file"
          type="file"
          ?multiple=${multiple}
          accept=${ACCEPT[this.fFormat as Exclude<BookFormat, 'browse' | 's7plus'>]}
          @change=${(event: Event) => void this.onFiles(event.target as HTMLInputElement)}
        />
      </label>
      <div class="form-hint ${this.fFileError === '' ? '' : 'warn-inline'}">
        ${this.fFileError === '' ? this.fileSummary(bytes) : this.fFileError}
      </div>
      ${this.fFiles.length > 0
        ? html`<div class="box-list">
            ${this.fFiles.map(
              (file) => html`<span class="chip mono">
                ${file.fileName}
                ${multiple
                  ? html`<button
                      class="chip-remove"
                      type="button"
                      title=${this.tr(MSG.bookFileRemove, { file: file.fileName })}
                      @click=${() => void this.removeFile(file.fileName)}
                    >
                      ×
                    </button>`
                  : nothing}
              </span>`
            )}
          </div>`
        : nothing}
    `;
  }

  /**
   * Drop one file of a bundle without starting the selection over.
   *
   * The counterpart of accumulating: a picker that only ever ADDS would make a
   * mis-clicked file impossible to take back except by changing generator, which
   * throws away every other file too.
   */
  private async removeFile(fileName: string): Promise<void> {
    this.fFiles = this.fFiles.filter((file) => file.fileName !== fileName);
    this.clearPreview();
    if (this.fFiles.length > 0) await this.buildPreview();
  }

  /** "2 files, 348 kB", or the "no file chosen" prompt. */
  /**
   * What is loaded, and — for a bundle — that picking again ADDS to it.
   *
   * Said out loud because the browser's own control implies the opposite: a file
   * input shows only the last selection, so an operator has no way to know the
   * earlier one survived unless the form says so.
   */
  private fileSummary(bytes: number): string {
    if (this.fFiles.length === 0) {
      return BUNDLE_FORMATS.has(this.fFormat) ? `${this.tr(MSG.bookNoFile)} · ${this.tr(MSG.bookFilesAccumulate)}` : this.tr(MSG.bookNoFile);
    }
    const chosen = this.tr(MSG.bookFileChosen, {
      n: this.fFiles.length,
      size: Math.max(1, Math.round(bytes / BYTES_PER_KB))
    });
    return BUNDLE_FORMATS.has(this.fFormat) ? `${chosen} · ${this.tr(MSG.bookFilesAccumulate)}` : chosen;
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
    if (ONLINE_FORMATS.has(this.fFormat)) return nothing;
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
        ${this.renderDriverRow(this.fProtocol as ProtocolKind)}
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
    // The interface protocol decides which CANDIDATE ADDRESS a generation reads
    // (`modelgen`: `mode = book.interface.protocol`), so a default that contradicts
    // the generator is not cosmetic — it produces a type whose every DPE has no
    // address. The STEP 7 generators emit classic S7 operands, so they carry `s7`;
    // the Schneider ones emit Modbus references, hence the default this restores.
    const protocol = INTERFACE_PROTOCOL[format];
    if (protocol !== undefined) this.fProtocol = protocol;
    this.clearPreview();
  }

  /**
   * Read the picked files, ACCUMULATING them for the bundle generators.
   *
   * A native file input cannot append: every selection replaces the previous one.
   * That is wrong for a bundle, and it fails silently — an engineer who exports
   * `DB10.awl`, `DB11.awl` and `UDT_Moteur.awl` (often from different folders, so
   * in several goes) would keep only the last pick, and the catalog would come out
   * short with a "UDT not part of the ingested sources" warning pointing at
   * nothing they did wrong. So a bundle MERGES, keyed by file name: re-picking a
   * name replaces its content, which is what a re-export means.
   *
   * The input is cleared afterwards so that re-picking the SAME file fires
   * `change` again — otherwise correcting a file by re-exporting it would appear
   * to do nothing.
   */
  private async onFiles(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length === 0) return;
    this.fFileError = '';
    this.clearPreview();
    try {
      const read = await Promise.all(
        files.map(async (file) => ({ fileName: file.name, text: await file.text(), size: file.size }))
      );
      if (BUNDLE_FORMATS.has(this.fFormat)) {
        const merged = new Map(this.fFiles.map((file) => [file.fileName, file]));
        for (const file of read) merged.set(file.fileName, file);
        this.fFiles = [...merged.values()];
      } else {
        this.fFiles = read;
      }
      // A nameless catalog takes the first file's name — the common case, and it
      // keeps the derived id recognisable in the store.
      if (this.fName.trim() === '' && this.fFiles[0]) this.fName = this.fFiles[0].fileName.replace(/\.[^.]+$/, '');
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
    if (ONLINE_FORMATS.has(this.fFormat) || this.fFiles.length === 0) return;
    // Narrowed by the guard above: the two online generators have no file to parse.
    const format = this.fFormat as Exclude<BookFormat, 'browse' | 's7plus'>;
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

  // --- S7Plus handlers --------------------------------------------------------

  /**
   * Switching the connection re-asks for its TIA sources and DROPS the explored
   * tree: an item path is only meaningful under the station it came from, so keeping
   * the previous connection's tree would show a program that is not there.
   */
  private async onS7Connection(name: string): Promise<void> {
    this.fS7Connection = name;
    this.fS7Root = '';
    this.resetS7Explorer();
    const configured = this.s7plusConnections.find((connection) => connection.name === name)?.station;
    this.fS7Station = configured ?? '';
    await this.loadS7Sources(name);
  }

  private onS7Station(station: string): void {
    if (station === this.fS7Station) return;
    this.fS7Station = station;
    this.fS7Root = '';
    this.resetS7Explorer();
  }

  /**
   * The HMI filter changes WHAT the driver answers, so the explored tree is dropped
   * too — a tree read with the filter on is a subset, and mixing the two in one view
   * would misreport what the station exposes.
   */
  private onS7HmiOnly(value: boolean): void {
    if (value === this.fS7HmiOnly) return;
    this.fS7HmiOnly = value;
    this.resetS7Explorer();
  }

  private resetS7Explorer(): void {
    this.s7Explored = new Map();
    this.s7Open = new Set();
    this.s7ExplorerError = '';
  }

  /**
   * Ask the panel for the connection's TIA sources. A failure is a HINT, never a
   * block: the source select is editable and the connection's configured station is
   * still offered, so a stopped driver does not prevent declaring the catalog.
   */
  private async loadS7Sources(connection: string): Promise<void> {
    if (this.s7plusSources === undefined || connection === '') return;
    this.s7StationsError = '';
    try {
      this.s7Stations = await this.s7plusSources(connection);
    } catch (error) {
      this.s7Stations = [];
      this.s7StationsError = this.tr(MSG.explorerFailed, { error: (error as Error).message });
    }
  }

  private s7BranchGlyph(item: string, opened: boolean): string {
    if (this.s7Loading.has(item)) return '…';
    return opened ? '▾' : '▸';
  }

  /** Open one S7Plus branch (one request). Failures stay per-branch. */
  private async openS7Node(item: string): Promise<void> {
    if (this.browseS7PlusLevel === undefined || this.s7Explored.has(item)) return;
    this.s7Loading = new Set([...this.s7Loading, item]);
    this.s7ExplorerError = '';
    try {
      const nodes = await this.browseS7PlusLevel(this.fS7Connection, item, this.fS7HmiOnly);
      this.s7Explored = new Map([...this.s7Explored, [item, nodes]]);
    } catch (error) {
      this.s7ExplorerError = this.tr(MSG.explorerFailed, { error: (error as Error).message });
    } finally {
      const loading = new Set(this.s7Loading);
      loading.delete(item);
      this.s7Loading = loading;
    }
  }

  private async toggleS7Node(item: string): Promise<void> {
    const open = new Set(this.s7Open);
    if (open.has(item)) open.delete(item);
    else open.add(item);
    this.s7Open = open;
    if (open.has(item)) await this.openS7Node(item);
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
    if (this.fFormat === 's7plus') {
      const driverNumber = this.driverNumber();
      const detail: BookS7PlusBrowseDetail = {
        request: {
          bookId,
          connection: this.fS7Connection,
          name,
          // An empty source means "read the machine": that is what asking to browse
          // an S7Plus connection without naming a TIA export can only mean.
          station: this.fS7Station.trim() === '' ? S7PLUS_ONLINE_STATION : this.fS7Station.trim(),
          ...(this.fS7Root.trim() === '' ? {} : { root: this.fS7Root.trim() }),
          hmiVisibleOnly: this.fS7HmiOnly,
          ...(driverNumber === undefined ? {} : { driverNumber })
        },
        attachTo: this.fDevices
      };
      this.dispatchEvent(
        new CustomEvent<BookS7PlusBrowseDetail>('wui:booksymbolicbrowse', { detail, bubbles: true, composed: true })
      );
      return;
    }
    const iface = this.formInterface();
    const detail: BookIngestDetail = {
      request: {
        bookId,
        name,
        // Both online generators returned above, so what is left is a file format.
        format: this.fFormat as Exclude<BookFormat, 'browse' | 's7plus'>,
        file: this.fFiles.map((file) => file.fileName).join(', '),
        ...this.sourcePayload(),
        ...(iface === undefined ? {} : { interface: iface })
      },
      attachTo: this.fDevices
    };
    this.dispatchEvent(new CustomEvent<BookIngestDetail>('wui:bookingest', { detail, bubbles: true, composed: true }));
  }

  /**
   * The payload field the chosen generator reads. Two generators take a BUNDLE —
   * SimaticML (a TIA export is several documents) and AWL (a DB cannot be laid out
   * without the UDTs it references) — and the rest read one document, as XML or as
   * plain text.
   *
   * The AWL bundle additionally splits the picked files in two: whichever one is a
   * SYMBOL TABLE is passed as `symbolText` rather than as a source, because it is
   * read only for its block directory (`DB10` = `Echange`). Handing it to the AWL
   * parser instead would produce a file-wide "no DATA_BLOCK found" warning and lose
   * the block names, so the split is made here rather than asked of the operator.
   */
  private sourcePayload(): Pick<IngestRequest, 'documents' | 'xml' | 'text' | 'sources' | 'symbolText'> {
    if (this.fFormat === 'simaticml') {
      return { documents: this.fFiles.map((file) => ({ fileName: file.fileName, xml: file.text })) };
    }
    if (this.fFormat === 's7awl') {
      const symbols = this.fFiles.find((file) => isSymbolTableFile(file));
      const sources = this.fFiles.filter((file) => !isSymbolTableFile(file));
      return {
        sources: sources.map((file) => ({ fileName: file.fileName, text: file.text })),
        ...(symbols === undefined ? {} : { symbolText: symbols.text })
      };
    }
    const text = this.fFiles[0]?.text ?? '';
    return this.fFormat === 'csv' || this.fFormat === 's7sym' ? { text } : { xml: text };
  }

  /** The interface the form declares, or `undefined` for a template catalog. */
  private formInterface(): BookInterface | undefined {
    if (ONLINE_FORMATS.has(this.fFormat) || this.fFormat === 'nodeset') return undefined;
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
    } else if (this.fFormat === 's7plus') {
      if (this.fS7Connection === '') problems.push(this.tr(MSG.bookNeedConnection));
      // The station is what the driver browses; without it there is nothing to walk
      // (and unlike OPC UA there is no standard default root to fall back on).
      if (this.fS7Station.trim() === '') problems.push(this.tr(MSG.s7plusNeedStation));
    } else if (this.fFiles.length === 0) {
      problems.push(this.tr(MSG.bookNeedFile));
    }
    return problems;
  }

  private draftId(): string {
    return this.fName.trim() === '' ? '' : bookIdFrom(this.fName);
  }
}

/**
 * An S7Plus browse LEAF: the driver's `Variable` (a block member) and `Tag` (a PLC
 * tag). Everything else — `Block`, `ComplexTag`, `Struct`, `Array` — is browsed
 * into, which is the standard panel's own rule (`s7plus_symbolic.pnl`:
 * `if (dsST[i] != "Variable" && dsST[i] != "Tag") setExpandable(...)`).
 */
function isS7Leaf(node: S7PlusBrowseNode): boolean {
  return node.systemType === 'Variable' || node.systemType === 'Tag';
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
