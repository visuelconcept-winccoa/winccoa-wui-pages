// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Step 2 (online) — lazy OPC UA browse tree. Expands nodes on demand via the
 * backend `/browse`, and lets the operator pick ONE instance whose subtree
 * defines the datapoint type. Emits `wui:selection`
 * ({ primary: { nodeId, displayName }, parentNodeId }).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { browse, type BrowseNode } from '../data/api.js';
import { MSG, localizeDir } from '../i18n.js';

const ROOT = '__root__';
/** Indentation per tree level, in rem. */
const INDENT_REM = 1.2;

export class TiBrowseTree extends LitElement {
  static override readonly styles = [IXCoreStyles, treeStyles()];

  @property({ type: String }) connection = '';

  @state() private childrenByParent = new Map<string, BrowseNode[]>();
  @state() private expanded = new Set<string>();
  @state() private loading = new Set<string>();
  @state() private parentOf = new Map<string, string>();
  @state() private selected = '';
  @state() private error = '';
  private loadedConnection = '';

  override updated(): void {
    if (this.connection && this.connection !== this.loadedConnection) {
      this.loadedConnection = this.connection;
      this.reset();
      void this.load(ROOT);
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="hint">${localizeDir(MSG.online.pickInstance)}</div>
      ${this.error ? html`<ix-message-bar type="alert" .dismissible=${false}>${this.error}</ix-message-bar>` : nothing}
      <div class="tree">${this.renderLevel(ROOT, 0)}</div>
    `;
  }

  private reset(): void {
    this.childrenByParent = new Map();
    this.expanded = new Set();
    this.loading = new Set();
    this.parentOf = new Map();
    this.selected = '';
    this.error = '';
  }

  private async load(parentKey: string, nodeId?: string): Promise<void> {
    if (this.childrenByParent.has(parentKey)) return;
    this.loading = new Set(this.loading).add(parentKey);
    try {
      const nodes = await browse(this.connection, nodeId);
      this.childrenByParent = new Map(this.childrenByParent).set(parentKey, nodes);
      const parents = new Map(this.parentOf);
      for (const n of nodes) parents.set(n.nodeId, nodeId ?? '');
      this.parentOf = parents;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      const l = new Set(this.loading);
      l.delete(parentKey);
      this.loading = l;
    }
  }

  private toggle(node: BrowseNode): void {
    const ex = new Set(this.expanded);
    if (ex.has(node.nodeId)) {
      ex.delete(node.nodeId);
    } else {
      ex.add(node.nodeId);
      void this.load(node.nodeId, node.nodeId);
    }
    this.expanded = ex;
  }

  private select(node: BrowseNode): void {
    this.selected = node.nodeId;
    this.dispatchEvent(
      new CustomEvent('wui:selection', {
        detail: { primary: { nodeId: node.nodeId, displayName: node.displayName }, parentNodeId: this.parentOf.get(node.nodeId) ?? '' },
        bubbles: true,
        composed: true
      })
    );
  }

  private iconFor(nodeClass: string): string {
    if (nodeClass.includes('Variable')) return 'variable';
    if (nodeClass.includes('Method')) return 'function';
    return 'folder';
  }

  private renderLevel(parentKey: string, level: number): TemplateResult {
    const nodes = this.childrenByParent.get(parentKey);
    if (this.loading.has(parentKey)) return html`<div class="loading" style="padding-left:${level * INDENT_REM}rem">${localizeDir(MSG.online.browsing)}</div>`;
    if (!nodes) return html``;
    return html`${nodes.map((n) => this.renderNode(n, level))}`;
  }

  private renderNode(node: BrowseNode, level: number): TemplateResult {
    const isOpen = this.expanded.has(node.nodeId);
    const isObject = !node.nodeClass.includes('Variable') && !node.nodeClass.includes('Method');
    return html`
      <div class="row ${node.nodeId === this.selected ? 'selected' : ''}" style="padding-left:${level * INDENT_REM}rem">
        <button class="caret" ?disabled=${!node.hasChildren} @click=${() => this.toggle(node)}>
          ${node.hasChildren
            ? html`<ix-icon name=${isOpen ? 'chevron-down' : 'chevron-right'} size="16"></ix-icon>`
            : html`<span class="caret-spacer"></span>`}
        </button>
        <ix-icon class="node-icon" name=${this.iconFor(node.nodeClass)} size="16"></ix-icon>
        <span class="label" title=${node.nodeId}>${node.displayName}</span>
        ${node.dataType ? html`<span class="dtype">${node.dataType}</span>` : nothing}
        ${isObject
          ? html`<ix-button variant=${node.nodeId === this.selected ? 'primary' : 'secondary'} outline @click=${() => this.select(node)}>
              ${node.nodeId === this.selected ? '✓' : localizeDir(MSG.online.use)}
            </ix-button>`
          : nothing}
      </div>
      ${isOpen ? this.renderLevel(node.nodeId, level + 1) : nothing}
    `;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function treeStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .hint {
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
      opacity: 0.8;
    }
    .tree {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
      max-height: 26rem;
      overflow: auto;
      padding: 0.25rem 0;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding-top: 0.15rem;
      padding-bottom: 0.15rem;
      min-height: 1.9rem;
    }
    .row.selected {
      background: var(--theme-color-2);
    }
    .caret {
      background: none;
      border: none;
      color: var(--theme-color-text);
      cursor: pointer;
      display: inline-flex;
    }
    .caret:disabled {
      opacity: 0.25;
      cursor: default;
    }
    .caret-spacer {
      display: inline-block;
      width: 16px;
      height: 16px;
    }
    .node-icon {
      opacity: 0.8;
    }
    .label {
      color: var(--theme-color-text);
    }
    .dtype {
      font-size: 0.72rem;
      opacity: 0.6;
    }
    .loading {
      font-size: 0.8rem;
      opacity: 0.7;
      padding: 0.3rem 0;
    }
  `;
}

if (!customElements.get('ti-browse-tree')) {
  customElements.define('ti-browse-tree', TiBrowseTree);
}
