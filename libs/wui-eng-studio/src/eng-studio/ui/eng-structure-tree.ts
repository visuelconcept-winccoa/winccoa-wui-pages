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
  isAlarmableLeafType,
  resolveLeafPolicy,
  setStructureNodeType,
  structureNodeAt,
  type BookEntry,
  type DpTypeStructure,
  type LeafPolicy,
  type ModelPolicy,
  type OaLeafType,
  type StructureBindings
} from '@visuelconcept/wui-eng-core';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
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

/**
 * A leaf's DEPLOYMENT was changed. `patch` is merged field by field by the page, so
 * pinning only an archive group keeps the default alarm (see the core's
 * `resolveLeafPolicy`); `{ range: undefined }` clears a range.
 */
export interface PolicyChangeDetail {
  leaf: string;
  patch: LeafPolicy;
}

/** The magnifier was pressed on one leaf's alarm class / archive group. */
export interface DpPickRequest {
  leaf: string;
  field: 'alarmClass' | 'archiveGroup';
  /** For `alarmClass`: which ALARMING RANGE (threshold order). Absent = the leaf's class. */
  range?: number;
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
  /** Per-leaf deployment decisions of the model being edited (see `renderNodePolicy`). */
  @property({ attribute: false }) policy: ModelPolicy = {};
  /**
   * The project's ALARM CLASSES (`_AlertClass` datapoints) and ARCHIVE GROUPS
   * (`_NGA_Group`) — offered per leaf instead of being typed.
   *
   * Both are datapoint names the runtime resolves, so a value typed from memory produces
   * a config it rejects. Empty means "the project could not tell": the field then accepts
   * FREE ENTRY, which is also what keeps a class or group created after the read usable.
   */
  @property({ attribute: false }) alarmClasses: string[] = [];
  @property({ attribute: false }) archiveGroups: string[] = [];
  /** The project's OPC UA subscriptions and the studio's poll groups (see `renderAcquisition`). */
  @property({ attribute: false }) subscriptions: string[] = [];
  @property({ attribute: false }) pollGroups: string[] = [];
  @property({ type: Boolean }) canEdit = false;
  @property({ type: String }) uiLang: Lang = 'en';

  /**
   * Leaves whose signal picker has been OPENED, and therefore carries the whole catalog.
   *
   * Local render state, not data: it exists so a tree of N leaves over a catalog of N
   * signals is not N² option nodes (see `renderBinding`). A `Set` on the element rather
   * than a reactive property because only this component reads it.
   */
  @state() private openPickers = new Set<string>();
  /**
   * Groups COLLAPSED by the operator, by dotted path.
   *
   * A house-standard type is tens of branches deep; a mirrored DB is hundreds. Reading one
   * group meant scrolling past all the others, so the groups fold — and the two buttons above
   * the tree fold or unfold every one of them at once, which is what "show me the shape" and
   * "show me this leaf" respectively need.
   */
  @state() private collapsed = new Set<string>();

  /**
   * The STRUCTURE of the model being edited — nothing else.
   *
   * It listed the project's models as its own first level for one iteration, when the
   * Model tab was a single column. The tab is now master–detail: the models are the
   * list on the left (they answer "which model"), so repeating them here showed the
   * same rows twice in one screen. What is left is this component's actual subject —
   * the branches, each carrying its mapping AND its deployment decisions.
   */
  override render(): TemplateResult {
    return html`
      ${this.renderStructure()}
      <!-- ONE datalist per list, for the whole tree: a per-leaf copy meant 331 duplicates
           of the same options on a real catalog. -->
      <datalist id="eng-alarm-classes">${this.alarmClasses.map((option) => html`<option value=${option}></option>`)}</datalist>
      <datalist id="eng-archive-groups">${this.archiveGroups.map((option) => html`<option value=${option}></option>`)}</datalist>
    `;
  }

  /** What a CLOSED picker needs: the value it displays, and nothing else. */
  private closedOption(current: string): TemplateResult {
    if (current === '') return html``;
    return html`<option value=${current} selected>${current}</option>`;
  }

  /** Fold / unfold one group. */
  private toggleFold(key: string): void {
    const next = new Set(this.collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsed = next;
  }

  /** Every GROUP path of the structure — what "fold all" folds. */
  private groupPaths(node: DpTypeStructure, path: string[]): string[] {
    const children = node.children ?? [];
    if (children.length === 0) return [];
    return children.flatMap((child) => {
      const here = [...path, child.name];
      const isGroup = (child.children ?? []).length > 0 || child.type === 'Struct';
      return isGroup ? [here.join('.'), ...this.groupPaths(child, here)] : [];
    });
  }

  /** Fill one signal picker's options — on the first pointer/focus, once. */
  private openPicker(leaf: string): void {
    if (this.openPickers.has(leaf)) return;
    this.openPickers = new Set([...this.openPickers, leaf]);
  }

  /** The selected model's structure. */
  private renderStructure(): TemplateResult {
    const root = this.structure;
    if (root === null) return html``;
    const groups = this.groupPaths(root, []);
    return html`
      ${groups.length === 0
        ? nothing
        : html`<div class="tree-fold">
            <ix-icon-button
              size="16"
              variant="tertiary"
              icon="chevron-right-small"
              a11y-label=${this.tr(MSG.treeCollapseAll)}
              title=${this.tr(MSG.treeCollapseAll)}
              @click=${() => (this.collapsed = new Set(groups))}
            ></ix-icon-button>
            <ix-icon-button
              size="16"
              variant="tertiary"
              icon="chevron-down-small"
              a11y-label=${this.tr(MSG.treeExpandAll)}
              title=${this.tr(MSG.treeExpandAll)}
              @click=${() => (this.collapsed = new Set())}
            ></ix-icon-button>
            <span class="soft small">${this.tr(MSG.treeGroupsCount, { n: groups.length, collapsed: this.collapsed.size })}</span>
          </div>`}
      <div class="tree tree-structure">
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
    const key = path.join('.');
    const folded = group && this.collapsed.has(key);
    return html`
      <div class="node" style="--level:${level}">
        ${group
          ? html`<button
              class="node-fold"
              aria-expanded=${folded ? 'false' : 'true'}
              title=${this.tr(folded ? MSG.treeExpand : MSG.treeCollapse)}
              @click=${() => this.toggleFold(key)}
            >
              <ix-icon name=${folded ? 'chevron-right-small' : 'chevron-down-small'} size="16"></ix-icon>
            </button>`
          : html`<span class="node-icon node-icon-leaf"></span>`}
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
        ${group ? nothing : this.renderNodePolicy(path)}
        ${this.canEdit ? this.renderNodeActions(path, group) : nothing}
      </div>
      ${group ? nothing : this.renderAlarmRanges(path, level)}
      ${group && !folded ? (node.children ?? []).map((child) => this.renderNode(child, [...path, child.name], level + 1)) : nothing}
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
   * The leaf's DEPLOYMENT: alarm, archiving and range, in the row itself.
   *
   * On the LEAF and nowhere else, because that is where the question exists: a group
   * (`Struct`) is not addressable, so it has no config to carry. It used to live in a
   * separate table under the tree, which meant reading a flat list of dotted paths
   * against the tree to know what each row was — the same mistake the mapping made
   * before it moved into the row.
   *
   * Each control shows the EFFECTIVE value: the core's default for the leaf's role
   * and its source's history, with whatever the model pinned on top — so a cell is
   * never blank and never lies about what a generation would write.
   */
  private renderNodePolicy(path: string[]): TemplateResult {
    const leaf = path.join('.');
    const node = this.structure === null ? null : structureNodeAt(this.structure, path);
    // No ALARM cells where an alert cannot exist: a String (or Blob, or Time) has no value to
    // compare, so offering the checkbox would offer a config the runtime rejects. The archive
    // and the range stay — those a String can have.
    const alarmable = isAlarmableLeafType(node?.type);
    const entry = this.entries.find((candidate) => candidate.path === (this.bindings[leaf] ?? ''));
    const effective = resolveLeafPolicy(
      entry ?? { path: leaf, sourceType: '', leafType: 'Float', access: 'r', addresses: {} },
      entry?.role ?? 'unknown',
      this.policy[leaf]
    );
    const alarmOn = effective.alarm?.active === true;
    const archiveOn = effective.archive?.active === true;
    return html`
      <span class="node-policy">
        ${this.renderAcquisition(leaf, effective)}
        ${alarmable ? this.renderAlarmCells(leaf, path, effective, alarmOn) : nothing}
        <label class="node-flag" title=${this.tr(MSG.colArchive)}>
          <input
            type="checkbox"
            .checked=${archiveOn}
            ?disabled=${!this.canEdit}
            @change=${(event: Event) =>
              this.emitPolicy(leaf, { archive: { active: (event.target as HTMLInputElement).checked, group: effective.archive?.group } })}
          />
          <span class="node-flag-label">${this.tr(MSG.policyArchiveShort)}</span>
        </label>
        ${this.renderPolicyPick(
          effective.archive?.group ?? '',
          'eng-archive-groups',
          MSG.policyArchiveGroup,
          !archiveOn || !this.canEdit,
          (value) => this.emitPolicy(leaf, { archive: { active: archiveOn, group: value } }),
          () => this.askForDp(leaf, 'archiveGroup')
        )}
        <input
          class="filter mono node-policy-range"
          placeholder="0..450"
          title=${this.tr(MSG.policyRangeHint)}
          ?disabled=${!this.canEdit}
          .value=${effective.range === undefined ? '' : `${effective.range.min}..${effective.range.max}`}
          @change=${(event: Event) => this.emitRange(leaf, (event.target as HTMLInputElement).value)}
        />
      </span>
    `;
  }

  /** One leaf's policy change, merged by the page (field by field). */
  /**
   * One deployment reference: pick from the project's own list, or type it.
   *
   * A native `<input list=…>` rather than a select, because both cases have to work in
   * one control: the project's classes/groups are the list, and free entry is what
   * remains possible when the list is empty (no runtime, no permission) or when the value
   * was created after it was read. A select would silently drop such a value.
   */
  private renderPolicyPick(
    value: string,
    listId: string,
    title: Ml,
    disabled: boolean,
    apply: (value: string) => void,
    browse: () => void
  ): TemplateResult {
    return html`
      <span class="node-policy-pick">
        <input
          class="filter mono node-policy-text"
          list=${listId}
          title=${this.tr(title)}
          ?disabled=${disabled}
          .value=${value}
          @change=${(event: Event) => apply((event.target as HTMLInputElement).value.trim())}
        />
        <ix-icon-button
          size="12"
          variant="tertiary"
          icon="search"
          ?disabled=${disabled}
          a11y-label=${this.tr(MSG.pickDp)}
          title=${this.tr(MSG.pickDp)}
          @click=${browse}
        ></ix-icon-button>
      </span>
    `;
  }

  /**
   * HOW the leaf is ACQUIRED: sampled at a rhythm, or pushed by the server.
   *
   * Two controls, because the mode decides which second value the address carries — a poll group
   * (`_PollGroup`) or a subscription (`_OPCUASubscription`, which is also where the publishing
   * interval and the deadband live). With no subscription in the project the second control is
   * empty, and the generator then writes POLLED and says so: an empty subscription in the
   * reference IS polling, so pretending otherwise would be the one silent outcome to avoid.
   */
  private renderAcquisition(leaf: string, effective: LeafPolicy): TemplateResult {
    const mode = effective.acquisition?.mode ?? 'poll';
    const spont = mode === 'spont';
    const options = spont ? this.subscriptions : this.pollGroups;
    const current = spont ? (effective.acquisition?.subscription ?? '') : (effective.acquisition?.pollGroup ?? '');
    return html`
      <select
        class="filter node-acq-mode"
        ?disabled=${!this.canEdit}
        title=${this.tr(MSG.acqHint)}
        @change=${(event: Event) =>
          this.emitPolicy(leaf, {
            acquisition: { ...effective.acquisition, mode: (event.target as HTMLSelectElement).value as 'poll' | 'spont' }
          })}
      >
        <option value="poll" ?selected=${!spont}>${this.tr(MSG.acqPoll)}</option>
        <option value="spont" ?selected=${spont}>${this.tr(MSG.acqSpont)}</option>
      </select>
      <select
        class="filter mono node-acq-target"
        ?disabled=${!this.canEdit || options.length === 0}
        title=${this.tr(spont ? MSG.acqSubscription : MSG.acqPollGroup)}
        @change=${(event: Event) => {
          const value = (event.target as HTMLSelectElement).value;
          this.emitPolicy(leaf, {
            acquisition: { ...effective.acquisition, mode, ...(spont ? { subscription: value } : { pollGroup: value }) }
          });
        }}
      >
        <option value="" ?selected=${current === ''}>${this.tr(spont ? MSG.acqNoSubscription : MSG.acqDefaultGroup)}</option>
        ${options.map((option) => html`<option value=${option} ?selected=${current === option}>${option}</option>`)}
      </select>
    `;
  }

  /** The ALARM half of a leaf's deployment: on/off, its class, and how it alarms. */
  private renderAlarmCells(leaf: string, path: string[], effective: LeafPolicy, alarmOn: boolean): TemplateResult {
    return html`
      <label class="node-flag" title=${this.tr(MSG.colAlarm)}>
        <input
          type="checkbox"
          .checked=${alarmOn}
          ?disabled=${!this.canEdit}
          @change=${(event: Event) =>
            this.emitPolicy(leaf, { alarm: { active: (event.target as HTMLInputElement).checked, alarmClass: effective.alarm?.alarmClass } })}
        />
        <span class="node-flag-label">${this.tr(MSG.policyAlarmShort)}</span>
      </label>
      ${this.renderPolicyPick(
        effective.alarm?.alarmClass ?? '',
        'eng-alarm-classes',
        MSG.policyAlarmClass,
        !alarmOn || !this.canEdit,
        (value) => this.emitPolicy(leaf, { alarm: { active: alarmOn, alarmClass: value } }),
        () => this.askForDp(leaf, 'alarmClass')
      )}
      ${alarmOn ? this.renderAlarmShape(leaf, path, effective) : nothing}
    `;
  }

  /**
   * HOW a leaf alarms — the half a class alone cannot express.
   *
   *  - a **BOOL** leaf gets its GOOD RANGE: which value is healthy, so the alert is raised
   *    on the other one. Half the fault bits of a plant are active-low, and WinCC OA's
   *    `_alert_hdl.._ok_range` is exactly this choice — guessing it arms alarms inverted.
   *  - a **numeric** leaf gets its THRESHOLDS and the alarming side. N thresholds are N+1
   *    ranges, which is what the analog alert handling models: one limit is "above 95 is a
   *    fault", three describe a band. Typed as a list because a row of the tree has no room
   *    for a table, and because "80, 95" is how an engineer says it.
   */
  private renderAlarmShape(leaf: string, path: string[], effective: LeafPolicy): TemplateResult {
    const node = this.structure === null ? null : structureNodeAt(this.structure, path);
    if (node?.type === 'Bool') {
      const good = effective.alarm?.goodRange ?? false;
      return html`
        <select
          class="filter node-policy-good"
          ?disabled=${!this.canEdit}
          title=${this.tr(MSG.policyGoodRange)}
          @change=${(event: Event) =>
            this.emitPolicy(leaf, {
              alarm: { active: true, alarmClass: effective.alarm?.alarmClass, goodRange: (event.target as HTMLSelectElement).value === 'true' }
            })}
        >
          <option value="false" ?selected=${!good}>${this.tr(MSG.policyGoodFalse)}</option>
          <option value="true" ?selected=${good}>${this.tr(MSG.policyGoodTrue)}</option>
        </select>
      `;
    }
    const thresholds = effective.alarm?.thresholds ?? [];
    const ascending = (effective.alarm?.direction ?? 'ASC') === 'ASC';
    return html`
      <input
        class="filter mono node-policy-thresholds"
        placeholder="80, 95"
        title=${this.tr(MSG.policyThresholds)}
        ?disabled=${!this.canEdit}
        .value=${thresholds.join(', ')}
        @change=${(event: Event) => this.emitThresholds(leaf, effective, (event.target as HTMLInputElement).value)}
      />
      <select
        class="filter node-policy-good"
        ?disabled=${!this.canEdit}
        title=${this.tr(MSG.policyDirection)}
        @change=${(event: Event) =>
          this.emitPolicy(leaf, {
            alarm: {
              active: true,
              alarmClass: effective.alarm?.alarmClass,
              thresholds: effective.alarm?.thresholds,
              direction: (event.target as HTMLSelectElement).value as 'ASC' | 'DESC'
            }
          })}
      >
        <option value="ASC" ?selected=${ascending}>${this.tr(MSG.policyAbove)}</option>
        <option value="DESC" ?selected=${!ascending}>${this.tr(MSG.policyBelow)}</option>
      </select>
    `;
  }

  /**
   * Parse a typed threshold list. Anything unreadable is DROPPED rather than guessed, and
   * an empty list turns the alarm back into the binary "non-zero" one — which is what the
   * generator does with no thresholds, so the screen and the generation agree.
   */
  private emitThresholds(leaf: string, effective: LeafPolicy, text: string): void {
    const values = text
      .split(/[,;]/)
      .map((part) => Number(part.trim().replace(',', '.')))
      .filter((value) => Number.isFinite(value))
      .sort((first, second) => first - second);
    this.emitPolicy(leaf, {
      alarm: {
        active: true,
        alarmClass: effective.alarm?.alarmClass,
        direction: effective.alarm?.direction,
        thresholds: values
      }
    });
  }

  /**
   * ONE ROW PER ALARMING RANGE, under the leaf — each with its own alert class.
   *
   * A plant escalates: crossing 80 warns, crossing 95 alarms. Same limits, different
   * severities, which in WinCC OA is a different class on that range
   * (`_alert_hdl.<i>._class`). A single field per leaf could not say it, and a row of the
   * tree has no width for N of them — so the ranges get their own lines, and only when the
   * leaf actually has thresholds (nothing is rendered otherwise, which is what keeps a
   * 331-leaf tree cheap).
   */
  private renderAlarmRanges(path: string[], level: number): TemplateResult {
    const leaf = path.join('.');
    const stored = this.policy[leaf];
    if (stored?.alarm?.active !== true) return html``;
    const node = this.structure === null ? null : structureNodeAt(this.structure, path);
    if (node?.type === 'Bool' || !isAlarmableLeafType(node?.type)) return html``;
    const thresholds = stored.alarm.thresholds ?? [];
    if (thresholds.length === 0) return html``;
    const ascending = (stored.alarm.direction ?? 'ASC') === 'ASC';
    const classes = stored.alarm.alarmClasses ?? [];
    return html`
      <div class="node-ranges" style="--level:${level}">
        ${thresholds.map((limit, index) => {
          const label = ascending ? `> ${limit}` : `< ${limit}`;
          return html`
            <span class="node-range">
              <span class="soft small node-range-limit mono">${label}</span>
              ${this.renderPolicyPick(
                classes[index] ?? '',
                'eng-alarm-classes',
                MSG.policyRangeClass,
                !this.canEdit,
                (value) => this.emitRangeClass(leaf, stored, index, value),
                () => this.askForDp(leaf, 'alarmClass', index)
              )}
            </span>
          `;
        })}
        <span class="soft small">${this.tr(MSG.policyRangeClassHint)}</span>
      </div>
    `;
  }

  /** Pin (or clear) the class of ONE range, keeping the others as they are. */
  private emitRangeClass(leaf: string, stored: LeafPolicy, index: number, value: string): void {
    const thresholds = stored.alarm?.thresholds ?? [];
    const classes = [...(stored.alarm?.alarmClasses ?? [])];
    while (classes.length < thresholds.length) classes.push('');
    classes[index] = value;
    this.emitPolicy(leaf, {
      alarm: {
        active: true,
        alarmClass: stored.alarm?.alarmClass,
        thresholds,
        direction: stored.alarm?.direction,
        // Empty everywhere means "no per-range decision": the key is dropped rather than
        // stored as a row of blanks the generator would have to interpret.
        ...(classes.some((name) => name !== '') ? { alarmClasses: classes } : {})
      }
    });
  }

  /** Ask the page to open its datapoint search for this field (the magnifier). */
  private askForDp(leaf: string, field: 'alarmClass' | 'archiveGroup', range?: number): void {
    this.dispatchEvent(
      new CustomEvent<DpPickRequest>('wui:pickdp', {
        detail: { leaf, field, ...(range === undefined ? {} : { range }) },
        bubbles: true,
        composed: true
      })
    );
  }

  private emitPolicy(leaf: string, patch: LeafPolicy): void {
    this.dispatchEvent(new CustomEvent<PolicyChangeDetail>('wui:policychange', { detail: { leaf, patch }, bubbles: true, composed: true }));
  }

  /**
   * `min..max` → a range, or a CLEAR when the text does not carry two numbers.
   * A range needs both bounds to mean anything; half of one would be a guess the
   * generator has to resolve.
   */
  private emitRange(leaf: string, typed: string): void {
    const parts = typed
      .trim()
      .split(/\s*(?:\.\.+|;)\s*/)
      .filter((part) => part !== '');
    const min = Number(parts[0]);
    const max = Number(parts[1]);
    const complete = parts.length === 2 && Number.isFinite(min) && Number.isFinite(max);
    this.emitPolicy(leaf, complete ? { range: { min, max } } : { range: undefined });
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
    // The options are filled ON DEMAND. A catalog of 331 signals across 331 leaves is
    // 110 000 <option> nodes if every picker carries the whole list, which is what made
    // applying a real catalog take seconds; a closed picker only needs to display the
    // value it holds, so it renders exactly that one until it is opened.
    const open = this.openPickers.has(leaf);
    // Closed: just the option it shows. Open: the catalog. (Kept out of the template so the
    // two cases read as the two cases they are.)
    const options = open
      ? this.entries.map(
          (entry) => html`<option value=${entry.path} ?selected=${current === entry.path}>
            ${entry.path} (${entry.leafType})
          </option>`
        )
      : this.closedOption(current);
    return html`
      <select
        class="filter node-bind ${current === '' ? 'unbound' : ''}"
        ?disabled=${!this.canEdit}
        title=${current === '' ? this.tr(MSG.treeUnbound) : current}
        @pointerdown=${() => this.openPicker(leaf)}
        @focus=${() => this.openPicker(leaf)}
        @change=${(event: Event) => this.bind(leaf, (event.target as HTMLSelectElement).value)}
      >
        <option value="" ?selected=${current === ''}>${this.tr(MSG.notMapped)}</option>
        ${options}
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
