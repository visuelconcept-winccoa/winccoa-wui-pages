// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DP-type structure as a TREE — shape the type and map its leaves in one place.
 *
 * The outline text remains the storage format (readable, diffable, pasteable, and
 * what a house standard looks like in a spec document), but *shaping* a type reads
 * far better as a tree, and the studio already has a reference for what that looks
 * like: PARA's type editor. Same grammar on purpose — an indented row per element,
 * its name, its element type, and the add/delete actions on the right — so an
 * engineer who knows one knows the other.
 *
 * What this adds that PARA has no reason to: every LEAF also carries the **book
 * signal it is mapped to**, with its state (mapped, ambiguous, or nothing yet). The
 * mapping is the point of a custom structure, and reading it in a separate flat list
 * meant holding the tree in your head to know what was still unbound.
 *
 * It owns nothing: each edit is emitted as a whole new structure (plus the bindings
 * that followed it — see the core's `structure.ts`, where renaming a group re-keys
 * every mapping under it), and the page writes it back through the outline. So the
 * two views can never disagree: there is one value, and the text is derived from it.
 *
 * Controls: `ix-input` / `ix-select` for the name and the element type — a bounded
 * vocabulary on a bounded tree (tens of nodes), exactly PARA's case. The SIGNAL
 * picker stays a native `<select>`: a book holds hundreds to thousands of entries,
 * and one Stencil dropdown per leaf carrying all of them is a different problem.
 */
import {
  OUTLINE_LEAF_TYPES,
  addStructureChild,
  removeStructureNode,
  renameStructureNode,
  setStructureNodeType,
  structureNodeAt,
  type BookEntry,
  type DpTypeStructure,
  type OaLeafType,
  type StructureBindings
} from '@visuelconcept/wui-eng-core';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { engTheme } from '../eng-theme.js';
import { MSG, fmt, t, type Lang, type Ml } from '../i18n.js';
import { engStructureTreeStyles } from './eng-structure-tree.styles.js';

/** Element types a node may take: the scalar set, plus the group. */
const NODE_TYPES: (OaLeafType | 'Struct')[] = ['Struct', ...OUTLINE_LEAF_TYPES];

/** What an edit hands back to the page: the new value, both halves together. */
export interface StructureChangeDetail {
  structure: DpTypeStructure;
  bindings: StructureBindings;
}

/** A leaf's mapping was changed. */
export interface StructureBindDetail {
  /** Dotted leaf path (`Mesures.Temperature`). */
  leaf: string;
  /** Book entry path, or '' to unmap. */
  entryPath: string;
}

export class WuiEngStructureTree extends LitElement {
  static override readonly styles = [engTheme, engStructureTreeStyles];

  @property({ attribute: false }) structure: DpTypeStructure | null = null;
  /** The book signals a leaf may be mapped to (already filtered by the page). */
  @property({ attribute: false }) entries: BookEntry[] = [];
  @property({ attribute: false }) bindings: StructureBindings = {};
  /** Leaves auto-binding could not decide — shown ON the leaf, not in a side list. */
  @property({ attribute: false }) ambiguous: { leaf: string; candidates: string[] }[] = [];
  @property({ type: Boolean }) canEdit = false;
  @property({ type: String }) uiLang: Lang = 'en';

  override render(): TemplateResult {
    const root = this.structure;
    if (root === null) return html``;
    return html`
      <div class="tree">
        ${(root.children ?? []).length === 0
          ? html`<div class="tree-empty">${this.tr(MSG.treeEmpty)}</div>`
          : (root.children ?? []).map((child) => this.renderNode(child, [child.name], 0))}
      </div>
      ${this.canEdit
        ? html`<div class="tree-foot">
            <ix-button variant="secondary" icon="plus" @click=${() => this.add([], 'Float')}>
              ${this.tr(MSG.treeAddLeaf)}
            </ix-button>
            <ix-button variant="secondary" icon="add-circle" @click=${() => this.add([], 'Struct')}>
              ${this.tr(MSG.treeAddGroup)}
            </ix-button>
          </div>`
        : nothing}
    `;
  }

  private tr(message: Ml, params: Record<string, string | number> = {}): string {
    return fmt(t(message, this.uiLang), params);
  }

  /** One row, then its children. `path` is the node's address from the root. */
  private renderNode(node: DpTypeStructure, path: string[], level: number): TemplateResult {
    const group = node.type === 'Struct';
    return html`
      <div class="node" style="--level:${level}">
        <ix-icon class="node-icon" name=${group ? 'chevron-down-small' : 'circle-dot'} size="16"></ix-icon>
        <ix-input
          class="node-name"
          ?disabled=${!this.canEdit}
          .value=${node.name}
          @valueChange=${(event: CustomEvent<string>) => this.rename(path, String(event.detail))}
        ></ix-input>
        <ix-select
          class="node-type"
          ?disabled=${!this.canEdit}
          .value=${node.type}
          @valueChange=${(event: CustomEvent<string | string[]>) => this.setType(path, firstOf(event.detail))}
        >
          ${NODE_TYPES.map(
            (type) => html`<ix-select-item
              value=${type}
              label=${type === 'Struct' ? this.tr(MSG.treeGroupType) : type}
            ></ix-select-item>`
          )}
        </ix-select>
        ${group ? html`<span class="node-fill"></span>` : this.renderBinding(path)}
        ${this.canEdit ? this.renderNodeActions(path, group) : nothing}
      </div>
      ${group ? (node.children ?? []).map((child) => this.renderNode(child, [...path, child.name], level + 1)) : nothing}
    `;
  }

  /** Add (groups only) and remove. Only a group can hold children. */
  private renderNodeActions(path: string[], group: boolean): TemplateResult {
    return html`
      <span class="node-actions">
        ${group
          ? html`
              <ix-icon-button
                size="16"
                variant="tertiary"
                icon="plus"
                a11y-label=${this.tr(MSG.treeAddLeaf)}
                title=${this.tr(MSG.treeAddLeaf)}
                @click=${() => this.add(path, 'Float')}
              ></ix-icon-button>
              <ix-icon-button
                size="16"
                variant="tertiary"
                icon="add-circle"
                a11y-label=${this.tr(MSG.treeAddGroup)}
                title=${this.tr(MSG.treeAddGroup)}
                @click=${() => this.add(path, 'Struct')}
              ></ix-icon-button>
            `
          : nothing}
        <ix-icon-button
          size="16"
          variant="tertiary"
          icon="trashcan"
          a11y-label=${this.tr(MSG.treeRemove)}
          title=${this.tr(MSG.treeRemove)}
          @click=${() => this.removeAt(path)}
        ></ix-icon-button>
      </span>
    `;
  }

  /**
   * The leaf's mapping, in the row itself.
   *
   * A native `<select>` (see the header) and — deliberately — `selected` on the
   * options rather than `.value` on the select: Lit sets a property before the
   * options of the same update exist, so `.value` would silently fall back to the
   * first option and show every leaf as unmapped.
   */
  private renderBinding(path: string[]): TemplateResult {
    const leaf = path.join('.');
    const current = this.bindings[leaf] ?? '';
    const unresolved = this.ambiguous.find((item) => item.leaf === leaf);
    return html`
      <select
        class="filter node-bind ${current === '' ? 'unbound' : ''}"
        ?disabled=${!this.canEdit}
        title=${current === '' ? this.tr(MSG.treeUnbound) : current}
        @change=${(event: Event) => this.bind(leaf, (event.target as HTMLSelectElement).value)}
      >
        <option value="" ?selected=${current === ''}>${this.tr(MSG.notMapped)}</option>
        ${this.entries.map(
          (entry) => html`<option value=${entry.path} ?selected=${current === entry.path}>
            ${entry.path} (${entry.leafType})
          </option>`
        )}
      </select>
      ${unresolved === undefined
        ? nothing
        : html`<span
            class="chip update node-ambiguous"
            title=${this.tr(MSG.ambiguousLeaf, { leaf, candidates: unresolved.candidates.join(', ') })}
            >?</span
          >`}
    `;
  }

  // --- edits (all pure, all delegated to the core) ----------------------------

  private rename(path: string[], name: string): void {
    if (this.structure === null || name.trim() === '') return;
    const current = structureNodeAt(this.structure, path);
    if (current === null || current.name === name) return;
    this.emitChange(renameStructureNode(this.structure, path, name, this.bindings));
  }

  private setType(path: string[], type: string): void {
    if (this.structure === null) return;
    this.emitChange(setStructureNodeType(this.structure, path, type as OaLeafType | 'Struct', this.bindings));
  }

  private add(parentPath: string[], type: OaLeafType | 'Struct'): void {
    if (this.structure === null) return;
    const name = type === 'Struct' ? 'Groupe' : 'Element';
    this.emitChange({ structure: addStructureChild(this.structure, parentPath, { name, type }), bindings: this.bindings });
  }

  private removeAt(path: string[]): void {
    if (this.structure === null) return;
    this.emitChange(removeStructureNode(this.structure, path, this.bindings));
  }

  private emitChange(detail: StructureChangeDetail): void {
    this.dispatchEvent(new CustomEvent<StructureChangeDetail>('wui:treechange', { detail, bubbles: true, composed: true }));
  }

  private bind(leaf: string, entryPath: string): void {
    this.dispatchEvent(
      new CustomEvent<StructureBindDetail>('wui:treebind', { detail: { leaf, entryPath }, bubbles: true, composed: true })
    );
  }
}

/** `ix-select` reports `string | string[]`; a single-mode select means the first. */
function firstOf(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

if (!customElements.get('wui-eng-structure-tree')) {
  customElements.define('wui-eng-structure-tree', WuiEngStructureTree);
}
