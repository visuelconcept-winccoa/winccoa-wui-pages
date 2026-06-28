// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Table of report templates. Each row opens the template editor; actions edit /
 * duplicate / delete. Emits `wui:edit` / `wui:duplicate` / `wui:delete` (`{ id }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tableStyles } from './table-styles.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { ReportTemplate } from '../types.js';

@customElement('rb-template-table')
export class RbTemplateTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) templates: ReportTemplate[] = [];
  @property({ type: Boolean }) canEdit = true;

  override render(): TemplateResult {
    return html`
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.templateTable.model)}</th>
            <th>${localizeDir(MSG.templateTable.sections)}</th>
            <th>${localizeDir(MSG.templateTable.statesSignatures)}</th>
            <th>${localizeDir(MSG.templateTable.updated)}</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${this.templates.map((t) => this.renderRow(t))}
        </tbody>
      </table>
    `;
  }

  private renderRow(t: ReportTemplate): TemplateResult {
    const levels = t.workflow.filter((s) => s.advance).length;
    return html`
      <tr class="clickable" @click=${() => this.edit(t.id)}>
        <td>
          <div class="strong">${t.name || localizeDir(MSG.templateTable.unnamed)}</div>
          <div class="muted">${t.description}</div>
        </td>
        <td>${t.sections.length}</td>
        <td>${t.workflow.length} ${localizeDir(MSG.templateTable.statesLevels)} · ${levels} ${localizeDir(MSG.templateTable.signatureLevels)}</td>
        <td class="mono">${t.updatedAt || '—'}</td>
        <td class="actions-col" @click=${(e: Event) => e.stopPropagation()}>
          <ix-icon-button
            ghost
            size="16"
            icon=${this.canEdit ? 'pen' : 'eye'}
            title=${this.canEdit ? localize(MSG.templateTable.edit) : localize(MSG.templateTable.view)}
            @click=${() => this.edit(t.id)}
          ></ix-icon-button>
          <ix-icon-button ghost size="16" icon="copy" title=${localize(MSG.templateTable.duplicate)} ?disabled=${!this.canEdit} @click=${() => this.duplicate(t.id)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.templateTable.remove)} ?disabled=${!this.canEdit} @click=${() => this.remove(t.id)}></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private edit(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true }));
  }

  private duplicate(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:duplicate', { detail: { id }, bubbles: true, composed: true }));
  }

  private remove(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:delete', { detail: { id }, bubbles: true, composed: true }));
  }
}
