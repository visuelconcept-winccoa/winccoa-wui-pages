// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tree view of the inventory: Workshop → Asset → Station → MLFB. Grouping nodes
 * show the number of MLFBs and the **summed** risk score (total exposure),
 * coloured by the worst descendant level; leaves show the individual MLFB score.
 * Nodes collapse/expand on click; clicking a leaf emits `wui:edit` (open editor).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { bandForLevel } from '../risk.js';
import { allNodePaths, buildAssetTree, type TreeLeaf, type TreeNode, type TreeSort } from '../data/asset-tree.js';
import type { Asset } from '../types.js';

@customElement('ali-asset-tree')
export class AliAssetTree extends LitElement {
  static override readonly styles = [IXCoreStyles, treeStyles()];

  @property({ attribute: false }) assets: Asset[] = [];

  /** Paths of collapsed nodes. */
  @state() private collapsed = new Set<string>();
  @state() private sortBy: TreeSort = 'score';

  override render(): TemplateResult {
    const tree = buildAssetTree(this.assets, this.sortBy);
    return html`
      <div class="toolbar">
        <span class="grow"></span>
        <span class="sort-label">${localizeDir(MSG.tree.sortLabel)}</span>
        <span class="sort-group">
          ${this.sortBtn('score', localizeDir(MSG.tree.byScore))}
          ${this.sortBtn('sum', localizeDir(MSG.tree.bySum))}
          ${this.sortBtn('name', localizeDir(MSG.tree.byName))}
        </span>
        <ix-button variant="secondary" outline @click=${this.expandAll}>
          <ix-icon name="chevron-down" slot="icon"></ix-icon>${localizeDir(MSG.tree.expandAll)}
        </ix-button>
        <ix-button variant="secondary" outline @click=${this.collapseAll}>
          <ix-icon name="chevron-right" slot="icon"></ix-icon>${localizeDir(MSG.tree.collapseAll)}
        </ix-button>
      </div>
      <div class="tree">
        <div class="legend">${localizeDir(MSG.tree.sumLabel)}</div>
        ${tree.map((node) => this.renderNode(node, 0, node.label))}
      </div>
    `;
  }

  /** Collapse everything by default the first time the tree is shown. */
  protected override firstUpdated(_changed: PropertyValues): void {
    this.collapseAll();
  }

  private sortBtn(mode: TreeSort, label: unknown): TemplateResult {
    return html`<ix-button
      variant=${this.sortBy === mode ? 'primary' : 'secondary'}
      outline
      @click=${() => (this.sortBy = mode)}
    >
      ${label}
    </ix-button>`;
  }

  private readonly expandAll = (): void => {
    this.collapsed = new Set();
  };

  private readonly collapseAll = (): void => {
    this.collapsed = new Set(allNodePaths(buildAssetTree(this.assets, this.sortBy)));
  };

  private renderNode(node: TreeNode, depth: number, path: string): TemplateResult {
    const open = !this.collapsed.has(path);
    const band = bandForLevel(node.worst);
    return html`
      <div class="row node k-${node.kind}" style="--indent:${depth}" @click=${() => this.toggle(path)}>
        <ix-icon name=${open ? 'chevron-down' : 'chevron-right'} size="16"></ix-icon>
        <span class="label">${node.label || this.placeholder(node.kind)}</span>
        <span class="exposure">${node.count} · Σ${node.sum}</span>
        <span class="score" style="--c:${band.color}">${node.score}</span>
      </div>
      ${open
        ? node.children.map((child) =>
            child.kind === 'mlfb'
              ? this.renderLeaf(child, depth + 1)
              : this.renderNode(child, depth + 1, `${path}|${child.label}`)
          )
        : nothing}
    `;
  }

  private renderLeaf(leaf: TreeLeaf, depth: number): TemplateResult {
    const band = bandForLevel(leaf.level);
    return html`
      <div
        class="row leaf"
        style="--indent:${depth}"
        title=${leaf.item.mlfb}
        @click=${() => this.requestEdit(leaf.item.id)}
      >
        <span class="bullet"></span>
        <span class="label strong">${leaf.item.name}</span>
        <span class="mono">${leaf.item.mlfb}</span>
        <span class="score" style="--c:${band.color}">${leaf.score}</span>
      </div>
    `;
  }

  private placeholder(kind: TreeNode['kind']): string {
    if (kind === 'asset') return localize(MSG.tree.ungrouped);
    if (kind === 'station') return localize(MSG.tree.noStation);
    return '—';
  }

  private toggle(path: string): void {
    const next = new Set(this.collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.collapsed = next;
  }

  private requestEdit(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function treeStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      overflow: auto;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      padding: 0 0.5rem 0.5rem;
    }
    .toolbar .grow {
      flex: 1;
    }
    .sort-label {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .sort-group {
      display: inline-flex;
      gap: 0.2rem;
    }
    .tree {
      font-size: 0.9rem;
    }
    .legend {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
      padding: 0.25rem 0.5rem 0.5rem;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0.5rem;
      padding-left: calc(0.5rem + var(--indent, 0) * 1.25rem);
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      cursor: pointer;
    }
    .row:hover {
      background: var(--theme-color-2);
    }
    .k-workshop {
      font-weight: 700;
    }
    .k-asset {
      font-weight: 600;
    }
    .k-station {
      color: var(--theme-color-soft-text);
    }
    .label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .leaf .label {
      font-weight: 600;
      color: var(--theme-color-std-text);
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .count {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
      min-width: 1.5rem;
      text-align: right;
    }
    .bullet {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--theme-color-soft-text);
      flex: none;
      margin-left: 0.25rem;
    }
    .exposure {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
    }
    .score {
      display: inline-block;
      min-width: 2.2rem;
      text-align: center;
      font-weight: 700;
      color: #fff;
      background: var(--c);
      border-radius: 999px;
      padding: 0.1rem 0.5rem;
    }
  `;
}
