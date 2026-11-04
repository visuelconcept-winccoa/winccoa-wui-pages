// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Logs panel (issue 37): the WinCC OA log files of one host (`<project>/log`), read by
 * the agent of that host through `/api/process-monitor/logs*`.
 *
 *  - host chosen from the page's nodes; the host's files discovered by its agent, with a
 *    filter on name / manager and a multiple selection;
 *  - optional merge of each file with its `.bak` (previous rotation, marker in between);
 *  - entries parsed (`logs.ts`), coloured by severity and category with theme variables,
 *    filtered by category, minimum severity and free text (regex optional, highlighted);
 *  - **live**: the last N lines, refreshed every few seconds by ONE request for all the
 *    selected files (incremental, by offset) — never one request or stream per file: the
 *    WinCC OA webserver is HTTP/1.1 and a browser opens only 6 connections per server.
 *    **Pause** freezes the display and loads the whole files; resuming goes back to the end;
 *  - export of the displayed entries (.log / CSV) or of the raw files; each export emits
 *    `wui:logsexported {host, node, files, kind, format, mergeBak}` for the page to trace.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir, serverLabel } from '../i18n.js';
import { exportLogs, listLogs, readLogs } from '../data/api.js';
import {
  SEVERITIES,
  appendLog,
  categoriesOf,
  exportFileName,
  filterEntries,
  highlightSegments,
  isMatcherError,
  keepLastLines,
  makeMatcher,
  mergeByTime,
  mergeWithBak,
  parseLog,
  toCsv,
  toLogText,
  type LogEntry,
  type LogSeverity,
  type TextMatcher
} from '../logs.js';
import type { LogFileInfo, LogReadFile } from '../types.js';

export interface LogNode {
  dp: string;
  system: string;
  hostname: string;
}

export interface LogsExportDetail {
  host: string;
  node: string;
  files: string[];
  kind: 'displayed' | 'raw';
  format: 'log' | 'csv';
  mergeBak: boolean;
}

const INTERVALS_S = [2, 5, 10, 30];
const LAST_LINES = [100, 500, 1000, 5000];
/** Most entries drawn at once (pause on a big file): the newest ones; export has them all. */
const RENDER_CAP = 10000;

interface FileState {
  entries: LogEntry[];
  offset: number;
  truncated: boolean;
}

/** Severity → theme colour of its text / mark. */
const SEVERITY_VAR: Record<string, string> = {
  fatal: 'var(--theme-color-alarm)',
  severe: 'var(--theme-color-alarm)',
  warning: 'var(--theme-color-warning)',
  info: 'var(--theme-color-std-text)',
  debug: 'var(--theme-color-soft-text)'
};

/** Category → theme colour of its badge (unknown categories: soft text). */
const CATEGORY_VAR: Record<string, string> = {
  CTRL: 'var(--theme-color-primary)',
  PARAM: 'var(--theme-color-information)',
  SYS: 'var(--theme-color-success)',
  IMPL: 'var(--theme-color-warning)',
  REDU: 'var(--theme-color-dynamic)',
  API: 'var(--theme-color-neutral)'
};

@customElement('pm-logs')
export class PmLogs extends LitElement {
  static override readonly styles = [IXCoreStyles, logsStyles()];

  @property({ attribute: false }) nodes: LogNode[] = [];

  @state() private node = '';
  @state() private files: LogFileInfo[] = [];
  @state() private fileFilter = '';
  @state() private selected: string[] = [];
  @state() private mergeBak = true;
  @state() private live = true;
  @state() private intervalS = 5;
  @state() private lastLines = 500;
  @state() private categories: string[] = [];
  @state() private minSeverity: LogSeverity = '';
  @state() private search = '';
  @state() private regex = false;
  @state() private perFile = new Map<string, FileState>();
  @state() private error = '';

  @query('.log-view') private logView?: HTMLElement;

  private timer: ReturnType<typeof globalThis.setInterval> | undefined;
  /** One request at a time: a tick is skipped while one is running. */
  private inFlight = false;
  /** Bumped on every fresh load: a reply for an older selection is dropped. */
  private generation = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.restartTimer();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    globalThis.clearInterval(this.timer);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('nodes') && !this.nodes.some((n) => n.dp === this.node)) {
      this.node = this.nodes[0]?.dp ?? '';
      void this.loadFiles();
    }
  }

  override updated(): void {
    // Live: follow the end of the log.
    if (this.live && this.logView) this.logView.scrollTop = this.logView.scrollHeight;
  }

  private get host(): string {
    const n = this.nodes.find((x) => x.dp === this.node);
    return n ? serverLabel(n) : '';
  }

  override render(): TemplateResult {
    const merged = mergeByTime(this.selected.map((name) => this.perFile.get(name)?.entries ?? []));
    const all = this.live ? keepLastLines(merged, this.lastLines) : merged;
    const filter = { categories: this.categories, minSeverity: this.minSeverity, text: this.search, regex: this.regex };
    const { entries, error } = filterEntries(all, filter);
    const m = makeMatcher(this.search, this.regex);
    const matcher = isMatcherError(m) ? null : m;
    const drawn = entries.length > RENDER_CAP ? entries.slice(-RENDER_CAP) : entries;
    const truncated = this.selected.some((n) => this.perFile.get(n)?.truncated);
    return html`
      <div class="layout">
        ${this.renderSide()}
        <div class="main">
          ${this.renderToolbar(categoriesOf(merged), entries)}
          ${error ? html`<div class="note alarm">${localizeDir(MSG.logs.badRegex)}: ${error}</div>` : nothing}
          ${this.error ? html`<div class="note alarm">${localizeDir(MSG.logs.loadError)} — ${this.error}</div>` : nothing}
          ${!this.live ? html`<div class="note">${localizeDir(MSG.logs.paused)}</div>` : nothing}
          ${truncated ? html`<div class="note muted">${localizeDir(MSG.logs.truncated)}</div>` : nothing}
          ${drawn.length < entries.length ? html`<div class="note muted">${localizeDir(MSG.logs.renderCap)}</div>` : nothing}
          <div class="log-view">
            ${this.selected.length === 0
              ? html`<div class="empty">${localizeDir(MSG.logs.selectHint)}</div>`
              : drawn.map((e) => this.renderEntry(e, matcher))}
          </div>
          <div class="status muted">${entries.length} ${localizeDir(MSG.logs.shown)}</div>
        </div>
      </div>
    `;
  }

  private renderSide(): TemplateResult {
    const q = this.fileFilter.trim().toLowerCase();
    const shown = this.files.filter(
      (f) => !q || f.name.toLowerCase().includes(q) || (f.manager?.name ?? '').toLowerCase().includes(q) || String(f.manager?.manNum ?? '') === q
    );
    return html`<div class="side">
      <label class="field">
        <span class="lbl">${localizeDir(MSG.logs.host)}</span>
        <ix-select .value=${this.node} @valueChange=${(e: CustomEvent<string | string[]>) => this.onNode(first(e.detail))}>
          ${this.nodes.map((n) => html`<ix-select-item value=${n.dp} label=${serverLabel(n)}></ix-select-item>`)}
        </ix-select>
      </label>
      <div class="files-head">
        <span class="lbl">${localizeDir(MSG.logs.files)} (${this.files.length})</span>
        <ix-icon-button ghost size="16" icon="refresh" title=${localize(MSG.logs.refreshFiles)} @click=${() => void this.loadFiles()}></ix-icon-button>
      </div>
      <ix-input
        placeholder=${localize(MSG.logs.fileFilter)}
        .value=${this.fileFilter}
        @valueChange=${(e: CustomEvent<string>) => (this.fileFilter = String(e.detail ?? ''))}
      ></ix-input>
      <div class="file-list">
        ${shown.length === 0 ? html`<div class="muted">${localizeDir(MSG.logs.noFiles)}</div>` : nothing}
        ${shown.map(
          (f) => html`<label class="file ${this.selected.includes(f.name) ? 'on' : ''}" title=${`${f.name} · ${fmtSize(f.size)} · ${f.mtime}`}>
            <input type="checkbox" ?checked=${this.selected.includes(f.name)} @change=${(e: Event) => this.toggleFile(f.name, (e.target as HTMLInputElement).checked)} />
            <span class="fname">${f.name}${f.bak ? html`<span class="bak">+.bak</span>` : nothing}</span>
            <span class="fmeta muted">${f.manager ? `${f.manager.name}${f.manager.manNum === null ? '' : ` -num ${f.manager.manNum}`} · ` : ''}${fmtSize(f.size)}</span>
          </label>`
        )}
      </div>
    </div>`;
  }

  private renderToolbar(categories: string[], displayed: LogEntry[]): TemplateResult {
    return html`<div class="toolbar">
      <div class="row">
        ${this.live
          ? html`<ix-button variant="secondary" @click=${() => this.setLive(false)}><ix-icon name="pause" slot="icon"></ix-icon>${localizeDir(MSG.logs.pause)}</ix-button>`
          : html`<ix-button @click=${() => this.setLive(true)}><ix-icon name="play" slot="icon"></ix-icon>${localizeDir(MSG.logs.resume)}</ix-button>`}
        <span class="live-dot ${this.live ? 'on' : ''}"></span><span class="muted">${localizeDir(this.live ? MSG.logs.live : MSG.logs.pause)}</span>
        <label class="inline">
          <span class="lbl">${localizeDir(MSG.logs.interval)}</span>
          <ix-select .value=${String(this.intervalS)} @valueChange=${(e: CustomEvent<string | string[]>) => this.onInterval(Number(first(e.detail)))}>
            ${INTERVALS_S.map((s) => html`<ix-select-item value=${String(s)} label=${`${s} s`}></ix-select-item>`)}
          </ix-select>
        </label>
        <label class="inline">
          <span class="lbl">${localizeDir(MSG.logs.lastLines)}</span>
          <ix-select .value=${String(this.lastLines)} @valueChange=${(e: CustomEvent<string | string[]>) => this.onLastLines(Number(first(e.detail)))}>
            ${LAST_LINES.map((n) => html`<ix-select-item value=${String(n)} label=${String(n)}></ix-select-item>`)}
          </ix-select>
        </label>
        <label class="check">
          <input type="checkbox" ?checked=${this.mergeBak} @change=${(e: Event) => this.onMergeBak((e.target as HTMLInputElement).checked)} />
          ${localizeDir(MSG.logs.mergeBak)}
        </label>
      </div>
      <div class="row">
        <span class="lbl">${localizeDir(MSG.logs.categories)}</span>
        <button class="chip ${this.categories.length === 0 ? 'on' : ''}" @click=${() => (this.categories = [])}>${localizeDir(MSG.logs.allCategories)}</button>
        ${categories.map(
          (c) => html`<button class="chip ${this.categories.includes(c) ? 'on' : ''}" style="--cat:${categoryVar(c)}" @click=${() => this.toggleCategory(c)}>${c}</button>`
        )}
        <label class="inline">
          <span class="lbl">${localizeDir(MSG.logs.minSeverity)}</span>
          <ix-select .value=${this.minSeverity || 'all'} @valueChange=${(e: CustomEvent<string | string[]>) => this.onMinSeverity(first(e.detail))}>
            <ix-select-item value="all" label=${localize(MSG.logs.allSeverities)}></ix-select-item>
            ${SEVERITIES.map((s) => html`<ix-select-item value=${s} label=${s}></ix-select-item>`)}
          </ix-select>
        </label>
      </div>
      <div class="row">
        <ix-input
          class="search"
          placeholder=${localize(MSG.logs.search)}
          .value=${this.search}
          @valueChange=${(e: CustomEvent<string>) => (this.search = String(e.detail ?? ''))}
        ></ix-input>
        <label class="check">
          <input type="checkbox" ?checked=${this.regex} @change=${(e: Event) => (this.regex = (e.target as HTMLInputElement).checked)} />
          ${localizeDir(MSG.logs.regex)}
        </label>
        <span class="grow"></span>
        <ix-button variant="secondary" outline ?disabled=${displayed.length === 0} @click=${() => this.exportDisplayed(displayed, 'log')}>
          <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.logs.exportLog)}
        </ix-button>
        <ix-button variant="secondary" outline ?disabled=${displayed.length === 0} @click=${() => this.exportDisplayed(displayed, 'csv')}>
          <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.logs.exportCsv)}
        </ix-button>
        <ix-button variant="secondary" outline ?disabled=${this.selected.length === 0} @click=${() => void this.exportRaw()}>
          <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.logs.exportRaw)}
        </ix-button>
      </div>
    </div>`;
  }

  private renderEntry(e: LogEntry, matcher: TextMatcher | null): TemplateResult {
    if (e.marker) return html`<div class="marker">${e.lines[0]}</div>`;
    return html`<div class="entry sev-${e.severity || 'none'}" style="--sev:${SEVERITY_VAR[e.severity] ?? 'var(--theme-color-std-text)'}">
      ${e.category ? html`<span class="cat" style="--cat:${categoryVar(e.category)}">${e.category}</span>` : nothing}
      ${e.lines.map((line) => html`<div class="line">${highlightSegments(line, matcher).map((s) => (s.hit ? html`<mark>${s.text}</mark>` : s.text))}</div>`)}
    </div>`;
  }

  // ---- data -----------------------------------------------------------------

  private async loadFiles(): Promise<void> {
    if (!this.node && this.nodes.length > 0) return;
    try {
      this.files = await listLogs(this.node);
      const names = new Set(this.files.map((f) => f.name));
      const kept = this.selected.filter((n) => names.has(n));
      if (kept.length !== this.selected.length) {
        this.selected = kept;
        void this.reload();
      }
      this.error = '';
    } catch (error) {
      this.files = [];
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  /** Fresh read of the selection: the last N lines (live) or the whole files (pause). */
  private async reload(): Promise<void> {
    const gen = ++this.generation;
    this.perFile = new Map();
    if (this.selected.length === 0) return;
    this.inFlight = true;
    try {
      const files = await readLogs(this.node, {
        files: this.selected,
        maxLines: this.live ? this.lastLines : 0,
        mergeBak: this.mergeBak
      });
      if (gen !== this.generation) return;
      const next = new Map<string, FileState>();
      for (const f of files) next.set(f.name, this.freshState(f));
      this.perFile = next;
      this.error = '';
    } catch (error) {
      if (gen === this.generation) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (gen === this.generation) this.inFlight = false;
    }
  }

  private freshState(f: LogReadFile): FileState {
    const current = parseLog(f.text, f.name);
    const entries = f.bak ? mergeWithBak(parseLog(f.bak.text, f.bak.name), current, f.name, f.bak.name) : current;
    return { entries, offset: f.offset, truncated: f.truncated || Boolean(f.bak?.truncated) };
  }

  /** Live tick: what was written since the last read, for every selected file, in ONE request. */
  private async poll(): Promise<void> {
    if (!this.live || this.inFlight || this.selected.length === 0 || this.perFile.size === 0) return;
    const gen = this.generation;
    const fromOffset: Record<string, number> = {};
    for (const name of this.selected) {
      const st = this.perFile.get(name);
      if (st) fromOffset[name] = st.offset;
    }
    this.inFlight = true;
    try {
      const files = await readLogs(this.node, { files: this.selected, fromOffset, maxLines: this.lastLines, mergeBak: this.mergeBak });
      if (gen !== this.generation || !this.live) return;
      const next = new Map(this.perFile);
      for (const f of files) {
        const st = next.get(f.name);
        if (f.reset || !st) {
          next.set(f.name, this.freshState(f));
        } else if (f.text) {
          next.set(f.name, { ...st, entries: keepLastLines(appendLog(st.entries, f.text, f.name), this.lastLines), offset: f.offset });
        } else {
          st.offset = f.offset;
        }
      }
      this.perFile = next;
      this.error = '';
    } catch (error) {
      if (gen === this.generation) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (gen === this.generation) this.inFlight = false;
    }
  }

  private restartTimer(): void {
    globalThis.clearInterval(this.timer);
    this.timer = globalThis.setInterval(() => void this.poll(), this.intervalS * 1000);
  }

  // ---- intents --------------------------------------------------------------

  private onNode(dp: string): void {
    if (!dp || dp === this.node) return;
    this.node = dp;
    this.selected = [];
    this.perFile = new Map();
    this.generation += 1;
    void this.loadFiles();
  }

  private toggleFile(name: string, on: boolean): void {
    this.selected = on ? [...this.selected.filter((n) => n !== name), name] : this.selected.filter((n) => n !== name);
    void this.reload();
  }

  private setLive(live: boolean): void {
    this.live = live;
    // Pause: the whole files, frozen. Resume: back to the end of the log.
    void this.reload();
  }

  private onInterval(seconds: number): void {
    if (!INTERVALS_S.includes(seconds)) return;
    this.intervalS = seconds;
    this.restartTimer();
  }

  private onLastLines(n: number): void {
    if (!LAST_LINES.includes(n) || n === this.lastLines) return;
    this.lastLines = n;
    if (this.live) void this.reload();
  }

  private onMergeBak(on: boolean): void {
    this.mergeBak = on;
    void this.reload();
  }

  private onMinSeverity(value: string): void {
    this.minSeverity = (SEVERITIES as readonly string[]).includes(value) ? (value as LogSeverity) : '';
  }

  private toggleCategory(c: string): void {
    this.categories = this.categories.includes(c) ? this.categories.filter((x) => x !== c) : [...this.categories, c];
  }

  // ---- export ---------------------------------------------------------------

  private exportDisplayed(entries: LogEntry[], format: 'log' | 'csv'): void {
    const text = format === 'csv' ? toCsv(entries) : toLogText(entries);
    download(exportFileName(this.host, format, new Date()), text, format === 'csv' ? 'text/csv' : 'text/plain');
    this.emitExport('displayed', format);
  }

  /** The raw files (`.bak` first when merged), one download: a header line per file. */
  private async exportRaw(): Promise<void> {
    try {
      const files = await exportLogs(this.node, this.selected, this.mergeBak);
      const parts: string[] = [];
      for (const f of files) {
        if (files.length > 1) parts.push(`===== ${f.name} =====\n`);
        if (f.bak) parts.push(f.bak.text, `----- ${f.bak.name} → ${f.name} (rotation) -----\n`);
        parts.push(f.text);
      }
      download(exportFileName(this.host, 'log', new Date()), parts.join(''), 'text/plain');
      this.emitExport('raw', 'log');
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private emitExport(kind: LogsExportDetail['kind'], format: LogsExportDetail['format']): void {
    const detail: LogsExportDetail = { host: this.host, node: this.node, files: [...this.selected], kind, format, mergeBak: this.mergeBak };
    this.dispatchEvent(new CustomEvent('wui:logsexported', { detail, bubbles: true, composed: true }));
  }
}

function first(detail: string | string[]): string {
  return String(Array.isArray(detail) ? (detail[0] ?? '') : (detail ?? ''));
}

function categoryVar(category: string): string {
  return CATEGORY_VAR[category] ?? 'var(--theme-color-soft-text)';
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Hand a text to the browser as a file to save. */
function download(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function logsStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      flex: 1;
      min-height: 0;
    }
    .layout {
      display: flex;
      gap: 0.8rem;
      height: 100%;
      min-height: 28rem;
    }
    .side {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      width: 18rem;
      flex-shrink: 0;
      min-height: 0;
    }
    .main {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 0;
      gap: 0.4rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .lbl {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
    }
    .muted {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .files-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .file-list {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
      padding: 0.25rem;
    }
    .file {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 0.4rem;
      padding: 0.2rem 0.3rem;
      border-radius: 4px;
      cursor: pointer;
    }
    .file:hover,
    .file.on {
      background: var(--theme-color-2);
    }
    .file input {
      grid-row: span 2;
    }
    .fname {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bak {
      margin-left: 0.3rem;
      font-size: 0.7rem;
      color: var(--theme-color-soft-text);
    }
    .toolbar {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .row .grow {
      flex: 1;
    }
    .inline {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .search {
      min-width: 18rem;
    }
    .chip {
      padding: 0.1rem 0.55rem;
      border: 1px solid var(--cat, var(--theme-color-soft-bdr));
      border-radius: 999px;
      background: transparent;
      color: var(--theme-color-std-text);
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
    }
    .chip.on {
      background: var(--theme-color-2);
      box-shadow: inset 0 0 0 1px var(--cat, var(--theme-color-primary));
    }
    .live-dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      background: var(--theme-color-soft-text);
    }
    .live-dot.on {
      background: var(--theme-color-success);
    }
    .note {
      font-size: 0.82rem;
      padding: 0.25rem 0.5rem;
      border-left: 3px solid var(--theme-color-information);
      background: var(--theme-color-2);
    }
    .note.alarm {
      border-left-color: var(--theme-color-alarm);
    }
    .log-view {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 0.3rem 0.4rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
      background: var(--theme-color-1);
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.78rem;
      line-height: 1.35;
    }
    .entry {
      position: relative;
      padding: 0.05rem 0 0.05rem 0.5rem;
      border-left: 3px solid var(--sev);
      color: var(--sev);
    }
    .entry.sev-info,
    .entry.sev-none {
      border-left-color: transparent;
    }
    .entry .line {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .entry .line + .line {
      padding-left: 1.2rem;
    }
    .cat {
      float: right;
      margin-left: 0.4rem;
      padding: 0 0.35rem;
      border: 1px solid var(--cat);
      border-radius: 999px;
      color: var(--cat);
      font-size: 0.68rem;
      font-weight: 600;
    }
    mark {
      background: var(--theme-color-warning);
      color: var(--theme-color-inv-text);
      border-radius: 2px;
    }
    .marker {
      margin: 0.3rem 0;
      padding: 0.1rem 0.4rem;
      border-top: 1px dashed var(--theme-color-information);
      border-bottom: 1px dashed var(--theme-color-information);
      color: var(--theme-color-information);
      text-align: center;
    }
    .empty {
      padding: 1rem;
      color: var(--theme-color-soft-text);
    }
  `;
}
