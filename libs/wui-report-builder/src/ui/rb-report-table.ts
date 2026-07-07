// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Table of report instances: identity, source template, current workflow state
 * chip and signature count. Emits `wui:open` / `wui:edit` / `wui:delete` (`{ id }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tableStyles } from './table-styles.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { Report } from '../types.js';

@customElement('rb-report-table')
export class RbReportTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) reports: Report[] = [];
  @property({ type: Boolean }) canEdit = true;

  override render(): TemplateResult {
    return html`
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.reportTable.reportNo)}</th>
            <th>${localizeDir(MSG.reportTable.titleSubject)}</th>
            <th>${localizeDir(MSG.reportTable.model)}</th>
            <th>${localizeDir(MSG.reportTable.state)}</th>
            <th>${localizeDir(MSG.reportTable.signatures)}</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${this.reports.map((r) => this.renderRow(r))}
        </tbody>
      </table>
    `;
  }

  private renderRow(r: Report): TemplateResult {
    const state = r.workflow.find((s) => s.id === r.currentStateId);
    return html`
      <tr class="clickable" @click=${() => this.open(r.id)}>
        <td class="mono strong">${r.reportNo || '—'}</td>
        <td>
          <div class="strong">${r.title || localizeDir(MSG.reportTable.untitled)}</div>
          <div class="muted">${r.subject}</div>
        </td>
        <td>${r.templateName || '—'}</td>
        <td>
          <span class="chip solid" style="--c:${state?.color ?? '#888'}">${state?.label ?? '—'}</span>
        </td>
        <td>${r.signatures.length}</td>
        <td class="actions-col" @click=${(e: Event) => e.stopPropagation()}>
          <ix-icon-button ghost size="16" icon="eye" title=${localize(MSG.reportTable.open)} @click=${() => this.open(r.id)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.reportTable.remove)} ?disabled=${!this.canEdit} @click=${() => this.requestDelete(r.id)}></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private open(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:open', { detail: { id }, bubbles: true, composed: true }));
  }

  /** Named to avoid shadowing Element.remove(). */
  private requestDelete(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:delete', { detail: { id }, bubbles: true, composed: true }));
  }
}
