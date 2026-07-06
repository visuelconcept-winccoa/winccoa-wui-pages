// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA model editor — define and edit datapoint *types* (the "Modèle" tab).
 *
 * Left: the list of existing datapoint types (WuiDpeService.listTypes) plus a
 * "new type" action. Right: an ergonomic, nested tree editor for the selected
 * (or new) type — add elements, add sub-structures, rename, change element
 * type, set a Typeref target, delete.
 *
 * Persistence goes through the webserver.js PARA extension (same origin):
 *   new type      -> POST   /api/para/dptype/create  { typeName, structure }
 *   existing type -> POST   /api/para/dptype/change   { typeName, structure }
 *   delete type   -> DELETE /api/para/dptype/:name
 *
 * `dptype/change` updates the type IN PLACE, preserving the datapoints already
 * created from it. To rename an existing element we send its original name as
 * `name` and the new name as `newName` (the contract honored by dpTypeChange);
 * each editor node therefore remembers the name it was loaded with (origName).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { hasRole$ } from '@visuelconcept/wui-kit/data/app-security.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import {
  ELEMENT_TYPES,
  STRUCT_TYPE,
  isStructType,
  isTyperefType,
  type ParaStructureNode
} from './para-element-types.js';
import type { TypeProposal } from './para-ai-context.js';
import {
  ELEMENT_TYPE_LABEL,
  MSG,
  couldNotLoadTypesMsg,
  couldNotReachApiMsg,
  couldNotReadTypeMsg,
  deleteRefusedMsg,
  deleteTypeConfirmMsg,
  duplicateElementMsg,
  localize,
  localizeDir,
  saveFailedMsg,
  scalarRootNoteMsg,
  typeCreatedMsg,
  typeDeletedMsg,
  typeExistsMsg,
  typeUpdatedMsg,
  typerefNeedsRefMsg
} from './i18n.js';

const GET_TYPE_URL = (name: string): string => `/api/para/dptype/${encodeURIComponent(name)}`;
const CREATE_TYPE_URL = '/api/para/dptype/create';
const CHANGE_TYPE_URL = '/api/para/dptype/change';
const DELETE_TYPE_BASE = '/api/para/dptype';

/** Indent (rem) added per nesting level in the tree. */
const INDENT_REM = 1.25;

/** One node of the editable working tree. */
interface EditorNode {
  /** Stable client id (keys rows + targets immutable updates). */
  uid: string;
  /**
   * Element name when this type was loaded from the backend, or null for a node
   * the user just added. Drives the dpTypeChange rename contract.
   */
  origName: string | null;
  name: string;
  type: string;
  refName: string;
  children: EditorNode[];
}

/** Pure tree transform: replace the node with `uid` by `fn(node)`. */
function updateTree(node: EditorNode, uid: string, fn: (n: EditorNode) => EditorNode): EditorNode {
  if (node.uid === uid) {
    return fn(node);
  }
  if (node.children.length === 0) {
    return node;
  }
  return { ...node, children: node.children.map((child) => updateTree(child, uid, fn)) };
}

/** Pure tree transform: drop the node with `uid` wherever it sits. */
function removeFromTree(node: EditorNode, uid: string): EditorNode {
  return {
    ...node,
    children: node.children.filter((child) => child.uid !== uid).map((child) => removeFromTree(child, uid))
  };
}

export class WuiParaTypeEditor extends LitElement {
  static override readonly styles = [IXCoreStyles, editorStyles()];

  /** Bump from the parent to reload the type list (e.g. after external changes). */
  @property({ type: Number }) reloadToken = 0;
  /** A model proposed by the AI assistant; loaded as an unsaved draft when set. */
  @property({ attribute: false }) incomingProposal: TypeProposal | null = null;

  @state() private types: string[] = [];
  @state() private filter = '';
  @state() private loadingTypes = false;
  @state() private typesError = '';

  /** Name of the existing type currently loaded (null while editing a new one). */
  @state() private selectedTypeName: string | null = null;
  @state() private isNew = false;
  @state() private typeNameDraft = '';
  @state() private root: EditorNode | null = null;
  @state() private loadingType = false;
  @state() private busy = false;
  @state() private confirmDelete = false;
  /** Application-Security grant for type editing (open until groups are assigned). */
  @state() private canEdit = true;

  @state() private error = '';
  @state() private status = '';
  @state() private statusOk = false;

  private readonly api = container.resolve<OaRxJsApi>(OaRxJsApi);
  private subs = new Subscription();
  private uidSeq = 0;
  /** The proposal object reference already consumed (avoids re-loading on re-render). */
  private consumedProposal: TypeProposal | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.subs.add(hasRole$('para', 'edit-types').subscribe((granted) => (this.canEdit = granted)));
    this.loadTypes();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subs.unsubscribe();
    this.subs = new Subscription();
  }

  override render(): TemplateResult {
    return html`
      <div class="layout">
        <aside class="types">${this.renderTypeList()}</aside>
        <section class="editor">${this.renderEditor()}</section>
      </div>
    `;
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('reloadToken') && changed.get('reloadToken') !== undefined) {
      this.loadTypes();
    }
    if (this.incomingProposal != null && this.incomingProposal !== this.consumedProposal) {
      this.consumedProposal = this.incomingProposal;
      this.loadProposal(this.incomingProposal);
    }
  }

  // ---- type list -----------------------------------------------------------

  private renderTypeList(): TemplateResult {
    return html`
      <div class="types-toolbar">
        ${this.canEdit
          ? html`<ix-button icon="plus" variant="primary" @click=${this.startNewType}>${localizeDir(MSG.typeEditor.newType)}</ix-button>`
          : nothing}
        <ix-input
          .value=${this.filter}
          placeholder=${localize(MSG.typeEditor.filterTypes)}
          @valueChange=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
        ></ix-input>
      </div>
      <div class="types-list">${this.renderTypeRows()}</div>
    `;
  }

  private renderTypeRows(): TemplateResult {
    if (this.loadingTypes) {
      return html`<div class="message">${localizeDir(MSG.typeEditor.loadingTypes)}</div>`;
    }
    if (this.typesError !== '') {
      return html`<div class="message error">${this.typesError}</div>`;
    }
    const needle = this.filter.trim().toLowerCase();
    const visible = needle === '' ? this.types : this.types.filter((t) => t.toLowerCase().includes(needle));
    if (visible.length === 0) {
      return html`<div class="message">${localizeDir(MSG.typeEditor.noType)}</div>`;
    }
    return html`${visible.map(
      (name) => html`
        <button
          class="type-row ${name === this.selectedTypeName ? 'selected' : ''}"
          title=${name}
          @click=${() => this.selectType(name)}
        >
          <ix-icon name="tree" size="16"></ix-icon><span class="type-label">${name}</span>
        </button>
      `
    )}`;
  }

  // ---- editor --------------------------------------------------------------

  private renderEditor(): TemplateResult {
    const root = this.root;
    if (root == null) {
      return html`<div class="message">${localizeDir(MSG.typeEditor.selectOrCreate)}</div>`;
    }
    if (this.loadingType) {
      return html`<div class="message">${localizeDir(MSG.typeEditor.loadingType)}</div>`;
    }
    return html`
      ${this.renderEditorHeader()}
      ${this.isNew && this.types.includes(this.typeNameDraft.trim())
        ? html`<div class="warn">${typeExistsMsg(this.typeNameDraft.trim())}</div>`
        : nothing}
      ${this.renderRootBody(root)}
      ${this.error === '' ? nothing : html`<div class="message error">${this.error}</div>`}
      ${this.status === '' ? nothing : html`<div class="status ${this.statusOk ? 'ok' : 'error'}">${this.status}</div>`}
      ${this.confirmDelete ? this.renderDeleteConfirm() : nothing}
    `;
  }

  /** Root body: the element tree for a Struct root, or a scalar/ref note otherwise. */
  private renderRootBody(root: EditorNode): TemplateResult {
    if (isStructType(root.type)) {
      return html`
        <div class="tree">${root.children.map((child) => this.renderNode(child, 0))}</div>
        ${this.canEdit
          ? html`<div class="tree-add">
              <ix-button outline icon="plus" @click=${() => this.addChild(root.uid, false)}>${localizeDir(MSG.typeEditor.addElement)}</ix-button>
              <ix-button outline icon="add-circle" @click=${() => this.addChild(root.uid, true)}>${localizeDir(MSG.typeEditor.addSubstruct)}</ix-button>
            </div>`
          : nothing}
      `;
    }
    return html`
      <div class="scalar-root">
        <ix-icon name="info" size="16"></ix-icon>
        <span>${scalarRootNoteMsg(root.type)}</span>
        <!-- type shown as code in the localized note above -->
        ${isTyperefType(root.type)
          ? html`<ix-input
              class="node-ref"
              label=${localize(MSG.typeEditor.refLabel)}
              .value=${root.refName}
              placeholder=${localize(MSG.typeEditor.scalarRootRef)}
              @valueChange=${(e: Event) => this.patch(root.uid, { refName: (e.target as HTMLInputElement).value })}
            ></ix-input>`
          : nothing}
      </div>
    `;
  }

  private renderEditorHeader(): TemplateResult {
    return html`
      <div class="editor-header">
        <ix-icon name=${this.isNew ? 'add-circle' : 'tree'} size="24"></ix-icon>
        ${this.isNew
          ? html`<ix-input
              class="type-name-input"
              label=${localize(MSG.typeEditor.typeNameLabel)}
              .value=${this.typeNameDraft}
              placeholder=${localize(MSG.typeEditor.typeNamePlaceholder)}
              @valueChange=${(e: Event) => (this.typeNameDraft = (e.target as HTMLInputElement).value)}
            ></ix-input>`
          : html`<span class="type-title">${this.typeNameDraft}</span>`}
        ${this.root == null
          ? nothing
          : html`<label class="root-type">
              <span class="root-type-lbl">${localizeDir(MSG.typeEditor.root)}</span>
              <ix-select
                mode="single"
                .value=${this.root.type}
                @valueChange=${(e: CustomEvent) => this.changeRootType(String(e.detail))}
              >
                ${ELEMENT_TYPES.map((t) => html`<ix-select-item label=${this.elementTypeLabel(t)} value=${t.name}></ix-select-item>`)}
              </ix-select>
            </label>`}
        <span class="spacer"></span>
        ${this.isNew || !this.canEdit
          ? nothing
          : html`<ix-button
              outline
              variant="danger"
              icon="trashcan"
              ?disabled=${this.busy}
              @click=${() => (this.confirmDelete = true)}
            >${localizeDir(MSG.shared.delete)}</ix-button>`}
        ${this.canEdit
          ? html`<ix-button variant="primary" icon="upload" ?disabled=${this.busy} .loading=${this.busy} @click=${this.save}>
              ${this.isNew ? localizeDir(MSG.typeEditor.createType) : localizeDir(MSG.typeEditor.save)}
            </ix-button>`
          : nothing}
      </div>
    `;
  }

  private renderNode(node: EditorNode, level: number): TemplateResult {
    const struct = isStructType(node.type);
    const typeref = isTyperefType(node.type);
    return html`
      <div class="node" style="padding-left:${level * INDENT_REM}rem">
        <ix-icon class="node-icon" name=${struct ? 'chevron-down-small' : 'dot'} size="16"></ix-icon>
        <ix-input
          class="node-name"
          .value=${node.name}
          placeholder=${localize(MSG.typeEditor.namePlaceholder)}
          @valueChange=${(e: Event) => this.patch(node.uid, { name: (e.target as HTMLInputElement).value })}
        ></ix-input>
        <ix-select
          class="node-type"
          mode="single"
          .value=${node.type}
          @valueChange=${(e: CustomEvent) => this.changeType(node.uid, String(e.detail))}
        >
          ${ELEMENT_TYPES.map((t) => html`<ix-select-item label=${this.elementTypeLabel(t)} value=${t.name}></ix-select-item>`)}
        </ix-select>
        ${typeref
          ? html`<ix-input
              class="node-ref"
              .value=${node.refName}
              placeholder=${localize(MSG.typeEditor.scalarRootRef)}
              @valueChange=${(e: Event) => this.patch(node.uid, { refName: (e.target as HTMLInputElement).value })}
            ></ix-input>`
          : nothing}
        ${this.canEdit
          ? html`<span class="node-actions">
              ${struct
                ? html`
                    <ix-icon-button size="16" ghost icon="plus" title=${localize(MSG.typeEditor.addElement)} @click=${() => this.addChild(node.uid, false)}></ix-icon-button>
                    <ix-icon-button size="16" ghost icon="add-circle" title=${localize(MSG.typeEditor.addSubstruct)} @click=${() => this.addChild(node.uid, true)}></ix-icon-button>
                  `
                : nothing}
              <ix-icon-button size="16" ghost icon="trashcan" title=${localize(MSG.shared.delete)} @click=${() => this.removeNode(node.uid)}></ix-icon-button>
            </span>`
          : nothing}
      </div>
      ${struct ? node.children.map((child) => this.renderNode(child, level + 1)) : nothing}
    `;
  }

  private renderDeleteConfirm(): TemplateResult {
    return html`
      <div class="overlay" @click=${() => (this.confirmDelete = false)}>
        <div class="confirm" @click=${(e: Event) => e.stopPropagation()}>
          <div class="confirm-head"><ix-icon name="trashcan" size="20"></ix-icon> ${localizeDir(MSG.typeEditor.deleteHead)}</div>
          <p>${deleteTypeConfirmMsg(this.selectedTypeName ?? '')}</p>
          <div class="confirm-actions">
            <ix-button outline @click=${() => (this.confirmDelete = false)}>${localizeDir(MSG.shared.cancel)}</ix-button>
            <ix-button variant="danger-primary" ?disabled=${this.busy} .loading=${this.busy} @click=${this.deleteType}>${localizeDir(MSG.shared.delete)}</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  /** Localized dropdown label for an element type (descriptive entries are translated). */
  private elementTypeLabel(t: { name: string; label: string }): string {
    const ml = ELEMENT_TYPE_LABEL[t.name];
    return ml ? localize(ml) : t.label;
  }

  // ---- tree editing --------------------------------------------------------

  private makeNode(asStruct: boolean): EditorNode {
    this.uidSeq += 1;
    return {
      uid: `n${this.uidSeq}`,
      origName: null,
      name: '',
      type: asStruct ? STRUCT_TYPE : 'Float',
      refName: '',
      children: []
    };
  }

  private patch(uid: string, patch: Partial<EditorNode>): void {
    if (this.root == null) {
      return;
    }
    this.root = updateTree(this.root, uid, (node) => ({ ...node, ...patch }));
  }

  private changeType(uid: string, type: string): void {
    if (this.root == null) {
      return;
    }
    // Leaving Struct drops children; leaving Typeref clears the reference.
    this.root = updateTree(this.root, uid, (node) => ({
      ...node,
      type,
      refName: isTyperefType(type) ? node.refName : '',
      children: isStructType(type) ? node.children : []
    }));
  }

  /** Change the ROOT element type (Struct ↔ scalar/Typeref). Seeds one element when becoming a Struct. */
  private changeRootType(type: string): void {
    if (this.root == null) {
      return;
    }
    const rootUid = this.root.uid;
    this.changeType(rootUid, type);
    if (isStructType(type) && this.root.children.length === 0) {
      this.addChild(rootUid, false);
    }
  }

  private addChild(parentUid: string, asStruct: boolean): void {
    if (this.root == null) {
      return;
    }
    const child = this.makeNode(asStruct);
    this.root = updateTree(this.root, parentUid, (node) => ({ ...node, children: [...node.children, child] }));
  }

  private removeNode(uid: string): void {
    if (this.root == null) {
      return;
    }
    this.root = removeFromTree(this.root, uid);
  }

  // ---- loading -------------------------------------------------------------

  private loadTypes(): void {
    this.loadingTypes = true;
    this.typesError = '';
    // excludeEmpty:false so DP-types with NO instances still appear here (the
    // model tab is for modeling, so empty types must be visible/editable).
    // WuiDpeService.listTypes hardcodes excludeEmpty:true, hence the raw command.
    this.subs.add(
      this.api
        .customCommand<string[]>('etm.model.type.list', {
          pattern: '*',
          internal: false,
          typeMatchSubTree: false,
          excludeEmpty: false
        })
        .subscribe({
          next: (types) => {
            this.types = [...(types ?? [])].sort((a, b) => a.localeCompare(b));
            this.loadingTypes = false;
          },
          error: (err: unknown) => {
            this.typesError = couldNotLoadTypesMsg(String(err));
            this.loadingTypes = false;
          }
        })
    );
  }

  private startNewType(): void {
    this.uidSeq += 1;
    this.selectedTypeName = null;
    this.isNew = true;
    this.typeNameDraft = '';
    this.error = '';
    this.status = '';
    this.root = {
      uid: `n${this.uidSeq}`,
      origName: null,
      name: '',
      type: STRUCT_TYPE,
      refName: '',
      children: [this.makeNode(false)]
    };
    this.emitSelection(null);
  }

  /** Tell the page which type is loaded, so the AI assistant context stays relevant. */
  private emitSelection(typeName: string | null): void {
    this.dispatchEvent(
      new CustomEvent('wui:typeselected', { detail: { typeName }, bubbles: true, composed: true })
    );
  }

  private async selectType(name: string): Promise<void> {
    this.selectedTypeName = name;
    this.isNew = false;
    this.typeNameDraft = name;
    this.error = '';
    this.status = '';
    this.loadingType = true;
    this.emitSelection(name);
    this.root = { uid: 'root', origName: name, name, type: STRUCT_TYPE, refName: '', children: [] };
    try {
      const response = await fetch(GET_TYPE_URL(name));
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; structure?: ParaStructureNode; error?: string };
      if (!response.ok || !result.ok || !result.structure) {
        this.error = result.error ?? couldNotReadTypeMsg(response.status);
        this.loadingType = false;
        return;
      }
      this.root = this.structureToEditor(result.structure, true);
      this.loadingType = false;
    } catch (error) {
      this.error = couldNotReachApiMsg(String(error));
      this.loadingType = false;
    }
  }

  private loadProposal(proposal: TypeProposal): void {
    this.selectedTypeName = null;
    this.isNew = true;
    this.typeNameDraft = proposal.typeName;
    this.error = '';
    this.status = localize(MSG.typeEditor.proposalLoaded);
    this.statusOk = true;
    this.root = this.structureToEditor(proposal.structure, false);
    this.emitSelection(proposal.typeName);
  }

  private structureToEditor(node: ParaStructureNode, existing: boolean): EditorNode {
    this.uidSeq += 1;
    return {
      uid: `n${this.uidSeq}`,
      origName: existing ? node.name : null,
      name: node.name,
      type: node.type,
      refName: node.refName ?? '',
      children: (node.children ?? []).map((child) => this.structureToEditor(child, existing))
    };
  }

  // ---- saving --------------------------------------------------------------

  private editorToStructure(node: EditorNode, existing: boolean): ParaStructureNode {
    const result: ParaStructureNode = { name: existing && node.origName != null ? node.origName : node.name, type: node.type };
    if (existing && node.origName != null && node.name !== node.origName) {
      result.newName = node.name;
    }
    if (isTyperefType(node.type) && node.refName.trim() !== '') {
      result.refName = node.refName.trim();
    }
    if (isStructType(node.type)) {
      result.children = node.children.map((child) => this.editorToStructure(child, existing));
    }
    return result;
  }

  private validate(): string | null {
    const typeName = this.typeNameDraft.trim();
    if (typeName === '') {
      return localize(MSG.typeEditor.typeNameRequired);
    }
    const root = this.root;
    if (root == null) {
      return localize(MSG.typeEditor.emptyStructure);
    }
    if (isTyperefType(root.type) && root.refName.trim() === '') {
      return localize(MSG.typeEditor.rootTyperefRef);
    }
    if (isStructType(root.type)) {
      if (root.children.length === 0) {
        return localize(MSG.typeEditor.rootStructNeedsChild);
      }
      return this.validateChildren(root);
    }
    // Scalar root: nothing else to validate.
    return null;
  }

  private validateChildren(node: EditorNode): string | null {
    const names = new Set<string>();
    for (const child of node.children) {
      const name = child.name.trim();
      if (name === '') {
        return localize(MSG.typeEditor.elementNeedsName);
      }
      if (names.has(name)) {
        return duplicateElementMsg(name);
      }
      names.add(name);
      if (isTyperefType(child.type) && child.refName.trim() === '') {
        return typerefNeedsRefMsg(name);
      }
      if (isStructType(child.type)) {
        const childError = this.validateChildren(child);
        if (childError != null) {
          return childError;
        }
      }
    }
    return null;
  }

  private async save(): Promise<void> {
    if (this.busy || this.root == null) {
      return;
    }
    this.error = '';
    this.status = '';
    const validationError = this.validate();
    if (validationError != null) {
      this.error = validationError;
      return;
    }
    const typeName = this.typeNameDraft.trim();
    const existing = !this.isNew;
    const structure = this.editorToStructure({ ...this.root, name: typeName }, existing);
    structure.name = typeName;
    this.busy = true;
    try {
      const url = existing ? CHANGE_TYPE_URL : CREATE_TYPE_URL;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typeName, structure })
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (response.ok && result.ok) {
        this.setStatus(existing ? typeUpdatedMsg(typeName) : typeCreatedMsg(typeName), true);
        this.notifyChanged(typeName);
        this.loadTypes();
        await this.selectType(typeName);
      } else {
        this.error = result.error ?? saveFailedMsg(response.status);
      }
    } catch (error) {
      this.error = couldNotReachApiMsg(String(error));
    } finally {
      this.busy = false;
    }
  }

  private async deleteType(): Promise<void> {
    if (this.busy || this.selectedTypeName == null) {
      return;
    }
    const name = this.selectedTypeName;
    this.busy = true;
    try {
      const response = await fetch(`${DELETE_TYPE_BASE}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (response.ok && result.ok) {
        this.confirmDelete = false;
        this.root = null;
        this.selectedTypeName = null;
        this.setStatus(typeDeletedMsg(name), true);
        this.notifyChanged(name);
        this.emitSelection(null);
        this.loadTypes();
      } else {
        this.confirmDelete = false;
        this.error = result.error ?? deleteRefusedMsg(response.status);
      }
    } catch (error) {
      this.confirmDelete = false;
      this.error = couldNotReachApiMsg(String(error));
    } finally {
      this.busy = false;
    }
  }

  private notifyChanged(typeName: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:typeschanged', { detail: { typeName }, bubbles: true, composed: true })
    );
  }

  private setStatus(message: string, ok: boolean): void {
    this.status = message;
    this.statusOk = ok;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function editorStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .layout {
      display: flex;
      height: 100%;
      min-height: 0;
    }
    .types {
      width: 20rem;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-right: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
    }
    .types-toolbar {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .types-list {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 0.25rem;
    }
    .type-row {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      width: 100%;
      padding: 0.375rem 0.5rem;
      border: none;
      border-radius: var(--theme-default-border-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    .type-row:hover {
      background: var(--theme-color-2);
    }
    .type-row.selected {
      background: var(--theme-color-primary);
      color: var(--theme-color-primary--contrast);
    }
    .type-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .editor {
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
    }
    .editor-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 0.75rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      position: sticky;
      top: 0;
      background: var(--theme-color-1);
      z-index: 1;
    }
    .type-title {
      font-weight: 600;
      font-size: 1.05rem;
    }
    .type-name-input {
      width: 18rem;
    }
    .root-type {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    .root-type-lbl {
      font-size: 0.8125rem;
      color: var(--theme-color-soft-text);
    }
    .root-type ix-select {
      width: 13rem;
    }
    .scalar-root {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.75rem;
      margin: 0.5rem 0.75rem;
      border: 1px dashed var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
    }
    .scalar-root code {
      font-family: monospace;
      color: var(--theme-color-std-text);
    }
    .scalar-root .node-ref {
      width: 14rem;
    }
    .spacer {
      flex: 1;
    }
    .tree {
      padding: 0.5rem 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .node {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    .node-icon {
      flex-shrink: 0;
      color: var(--theme-color-soft-text);
    }
    .node-name {
      flex: 1;
      min-width: 8rem;
    }
    .node-type {
      width: 13rem;
      flex-shrink: 0;
    }
    .node-ref {
      width: 12rem;
      flex-shrink: 0;
    }
    .node-actions {
      display: flex;
      align-items: center;
      gap: 0.125rem;
      flex-shrink: 0;
    }
    .tree-add {
      display: flex;
      gap: 0.5rem;
      padding: 0 0.75rem 0.75rem;
    }
    .message {
      padding: 1rem;
      color: var(--theme-color-soft-text);
    }
    .warn {
      margin: 0.5rem 0.75rem 0;
      padding: 0.5rem 0.625rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-warning, #d9822b);
      color: var(--theme-color-warning, #d9822b);
      font-size: 0.8125rem;
    }
    .status {
      padding: 0.375rem 0.75rem;
      font-size: 0.8125rem;
    }
    .status.ok,
    .message.ok {
      color: var(--theme-color-success);
    }
    .status.error,
    .message.error {
      color: var(--theme-color-alarm);
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .confirm {
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 1rem;
      width: 26rem;
      max-width: 92vw;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }
    .confirm-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
  `;
}

if (!customElements.get('wui-para-type-editor')) {
  customElements.define('wui-para-type-editor', WuiParaTypeEditor);
}
