/**
 * PARA "create datapoint type" dialog.
 *
 * Collects a type name and a flat list of struct elements, then POSTs to the
 * webserver.js PARA extension (`/api/para/dptype/create`, same origin). Emits
 * `wui:done` with `{ created: boolean }` so the parent can close and refresh.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';

/** Element types offered in the dialog (names match the backend ELEMENT_TYPE_MAP). */
const ELEMENT_TYPES = [
  'Int', 'UInt', 'Float', 'Bool', 'String', 'Time', 'Char', 'Long', 'ULong',
  'Bit32', 'Bit64', 'LangString', 'Dpid', 'Blob',
  'DynInt', 'DynFloat', 'DynBool', 'DynString', 'Typeref'
];

/** Endpoint exposed by the webserver.js PARA extension (relative = same origin). */
const CREATE_TYPE_URL = '/api/para/dptype/create';

interface ElementRow {
  name: string;
  type: string;
  refName: string;
}

export class WuiParaCreateTypeDialog extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .panel {
        background: var(--theme-color-2);
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
        width: 640px;
        max-width: 92vw;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      }
      .header,
      .footer {
        padding: 0.75rem 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .header {
        border-bottom: 1px solid var(--theme-color-soft-bdr);
      }
      .footer {
        border-top: 1px solid var(--theme-color-soft-bdr);
        justify-content: flex-end;
      }
      .body {
        padding: 1rem;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .title {
        font-weight: 600;
        flex: 1;
      }
      .elements {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .element-row {
        display: flex;
        gap: 0.375rem;
        align-items: center;
      }
      .element-row .el-name {
        flex: 1;
      }
      .element-row ix-select {
        width: 9rem;
      }
      .element-row .el-ref {
        flex: 1;
      }
      .error {
        color: var(--theme-color-alarm);
      }
    `
  ];

  @state() private typeName = '';
  @state() private elements: ElementRow[] = [{ name: '', type: 'Float', refName: '' }];
  @state() private busy = false;
  @state() private error = '';

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="header">
            <ix-icon name="add-circle" size="24"></ix-icon>
            <span class="title">Create datapoint type</span>
            <ix-icon-button icon="close" ghost @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="body">
            <ix-input
              label="Type name"
              .value=${this.typeName}
              placeholder="MyType"
              @valueChange=${(e: Event) => (this.typeName = (e.target as HTMLInputElement).value)}
            ></ix-input>
            <div class="elements">${this.elements.map((row, i) => this.renderElementRow(row, i))}</div>
            <div>
              <ix-button outline icon="plus" @click=${this.addRow}>Add element</ix-button>
            </div>
            ${this.error === '' ? nothing : html`<div class="error">${this.error}</div>`}
          </div>
          <div class="footer">
            <ix-button outline @click=${this.cancel}>Cancel</ix-button>
            <ix-button variant="primary" ?disabled=${this.busy} .loading=${this.busy} @click=${this.submit}>
              Create
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderElementRow(row: ElementRow, index: number): TemplateResult {
    return html`
      <div class="element-row">
        <ix-input
          class="el-name"
          .value=${row.name}
          placeholder="element name"
          @valueChange=${(e: Event) => this.updateRow(index, { name: (e.target as HTMLInputElement).value })}
        ></ix-input>
        <ix-select
          mode="single"
          .value=${row.type}
          @valueChange=${(e: CustomEvent) => this.updateRow(index, { type: String(e.detail) })}
        >
          ${ELEMENT_TYPES.map((t) => html`<ix-select-item label="${t}" value="${t}"></ix-select-item>`)}
        </ix-select>
        ${row.type === 'Typeref'
          ? html`<ix-input
              class="el-ref"
              .value=${row.refName}
              placeholder="referenced type"
              @valueChange=${(e: Event) => this.updateRow(index, { refName: (e.target as HTMLInputElement).value })}
            ></ix-input>`
          : nothing}
        <ix-icon-button
          icon="trashcan"
          ghost
          ?disabled=${this.elements.length === 1}
          @click=${() => this.removeRow(index)}
        ></ix-icon-button>
      </div>
    `;
  }

  private addRow(): void {
    this.elements = [...this.elements, { name: '', type: 'Float', refName: '' }];
  }

  private removeRow(index: number): void {
    this.elements = this.elements.filter((_, i) => i !== index);
  }

  private updateRow(index: number, patch: Partial<ElementRow>): void {
    this.elements = this.elements.map((row, i) => (i === index ? { ...row, ...patch } : row));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:done', { detail: { created: false }, bubbles: true, composed: true }));
  }

  private buildStructure(): { typeName: string; structure: object } | null {
    const name = this.typeName.trim();
    if (name === '') {
      this.error = 'Type name is required';
      return null;
    }
    const children = [];
    for (const row of this.elements) {
      const elName = row.name.trim();
      if (elName === '') {
        this.error = 'All elements need a name';
        return null;
      }
      if (row.type === 'Typeref' && row.refName.trim() === '') {
        this.error = `Element '${elName}' (Typeref) needs a referenced type`;
        return null;
      }
      children.push({ name: elName, type: row.type, refName: row.refName.trim() });
    }
    return { typeName: name, structure: { name, type: 'Struct', children } };
  }

  private async submit(): Promise<void> {
    this.error = '';
    const payload = this.buildStructure();
    if (payload === null) {
      return;
    }
    this.busy = true;
    try {
      const response = await fetch(CREATE_TYPE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        this.dispatchEvent(
          new CustomEvent('wui:done', { detail: { created: true, typeName: payload.typeName }, bubbles: true, composed: true })
        );
      } else {
        this.error = result.error ?? `Request failed (HTTP ${response.status})`;
      }
    } catch (error) {
      this.error = `Could not reach the PARA API: ${String(error)}`;
    } finally {
      this.busy = false;
    }
  }
}

if (!customElements.get('wui-para-create-type-dialog')) {
  customElements.define('wui-para-create-type-dialog', WuiParaCreateTypeDialog);
}
