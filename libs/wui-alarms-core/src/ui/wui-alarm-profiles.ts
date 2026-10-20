// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `<wui-alarm-profiles>` — the editor of the named display profiles, the
 * engineering layer of the alarm view's customisation (see `profile.ts`).
 *
 * A profile is JSON, edited as JSON: the profile vocabulary (columns, filters,
 * counters, acknowledgement, defaults) grows with the modules that use it, and a
 * form would lag behind it. What protects the list is the validation: a profile
 * is parsed before it is saved, and what the view would not understand is
 * reported with its path, not stored.
 *
 * Editing is gated by the caller (`can-edit`, the `configure` role); without it
 * the dialog still opens, read-only.
 *
 * Emits `wui:close` when dismissed and `wui:save` once the datapoint is written.
 */
import { dialogCore } from '@visuelconcept-winccoa/wui-kit/ui/dialog-styles.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { AlarmConfigStore } from '../data/alarm-config-store.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { parseProfile, type AlarmViewProfile } from '../profile.js';
import { severityTokens } from './alarm-tokens.js';

/** The profile a new entry starts from: the reference layout, spelled out. */
const NEW_PROFILE: AlarmViewProfile = {
  columns: ['severity', 'raised', 'class', 'source', 'text', 'value', 'state'],
  filters: { severity: true, classes: true, search: true, unackOnly: true, fields: [] },
  tiles: true,
  stats: true,
  defaults: {},
  ack: { selection: true, all: true, confirm: true }
};
const INDENT = 2;
const NAME_PATTERN = /^[\w.-]+$/;

export class WuiAlarmProfiles extends LitElement {
  static override readonly styles = [severityTokens(), dialogCore(), profileStyles()];

  /** Read-only when false (the `configure` role is not granted). */
  @property({ type: Boolean, attribute: 'can-edit' }) canEdit = false;

  /** The profiles being edited, as JSON text per name. */
  @state() private drafts: Record<string, string> = {};
  @state() private current = '';
  @state() private newName = '';
  @state() private errors: string[] = [];
  @state() private busy = false;
  @state() private offline = false;

  private readonly store = new AlarmConfigStore();

  override render(): TemplateResult {
    const names = Object.keys(this.drafts).sort((a, b) => a.localeCompare(b));
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(event: Event) => event.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h4">${localizeDir(MSG.profiles.title)}</ix-typography>
            <ix-icon-button variant="tertiary" icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="hint">${localizeDir(MSG.profiles.intro)}</div>
            ${this.offline ? html`<div class="notice">${localizeDir(MSG.ranges.offline)}</div>` : nothing}
            ${this.errors.length === 0 ? nothing : html`<div class="notice">${this.errors.map((error) => html`<div>${error}</div>`)}</div>`}
            <div class="layout">
              <div class="names">
                ${names.map(
                  (name) => html`<button class="name" aria-current=${name === this.current ? 'true' : 'false'} @click=${() => this.pick(name)}>
                    ${name}
                  </button>`
                )}
                ${names.length === 0 ? html`<div class="hint">${localizeDir(MSG.profiles.empty)}</div>` : nothing}
                ${this.canEdit ? this.renderAdd() : nothing}
              </div>
              <div class="editor">${this.current === '' ? nothing : this.renderEditor()}</div>
            </div>
          </div>
          <div class="panel-foot">
            <span class="spacer"></span>
            <ix-button variant="secondary" @click=${this.close}>${localizeDir(MSG.ranges.cancel)}</ix-button>
            ${this.canEdit
              ? html`<ix-button ?disabled=${this.busy} @click=${() => void this.save()}>${localizeDir(MSG.ranges.save)}</ix-button>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.load();
  }

  private renderAdd(): TemplateResult {
    const valid = NAME_PATTERN.test(this.newName) && !(this.newName in this.drafts);
    return html`<div class="add">
      <ix-input
        placeholder=${localize(MSG.profiles.name)}
        .value=${this.newName}
        @valueChange=${(event: { detail: string }) => (this.newName = String(event.detail))}
      ></ix-input>
      <ix-button variant="secondary" ?disabled=${!valid} @click=${this.add}>${localizeDir(MSG.profiles.add)}</ix-button>
    </div>`;
  }

  private renderEditor(): TemplateResult {
    return html`
      <div class="row">
        <b class="grow">${this.current}</b>
        ${this.canEdit
          ? html`<ix-button variant="tertiary" @click=${() => this.removeProfile(this.current)}>${localizeDir(MSG.ranges.remove)}</ix-button>`
          : nothing}
      </div>
      <textarea
        spellcheck="false"
        .value=${this.drafts[this.current] ?? ''}
        ?readonly=${!this.canEdit}
        @input=${(event: Event) => (this.drafts = { ...this.drafts, [this.current]: (event.target as HTMLTextAreaElement).value })}
      ></textarea>
      <div class="hint">${localizeDir(MSG.profiles.keys)}</div>
    `;
  }

  private async load(): Promise<void> {
    const config = await this.store.load();
    this.offline = this.store.offline;
    this.drafts = Object.fromEntries(
      Object.entries(config.profiles).map(([name, profile]) => [name, JSON.stringify(profile, null, INDENT)])
    );
    this.current = Object.keys(this.drafts).sort((a, b) => a.localeCompare(b))[0] ?? '';
  }

  private pick(name: string): void {
    this.current = name;
    this.errors = [];
  }

  private readonly add = (): void => {
    const name = this.newName.trim();
    if (!NAME_PATTERN.test(name) || name in this.drafts) return;
    this.drafts = { ...this.drafts, [name]: JSON.stringify(NEW_PROFILE, null, INDENT) };
    this.current = name;
    this.newName = '';
  };

  private removeProfile(name: string): void {
    const { [name]: _removed, ...rest } = this.drafts;
    this.drafts = rest;
    this.current = Object.keys(rest).sort((a, b) => a.localeCompare(b))[0] ?? '';
  }

  /**
   * Parse every draft first; save only when ALL of them read cleanly — a
   * half-understood profile stored silently would make a view drop a column
   * nobody knows why.
   */
  private async save(): Promise<void> {
    const profiles: Record<string, AlarmViewProfile> = {};
    const errors: string[] = [];
    for (const [name, text] of Object.entries(this.drafts)) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const parsed = parseProfile(json);
      errors.push(...parsed.errors.map((error) => `${name}: ${error}`));
      profiles[name] = parsed.profile;
    }
    this.errors = errors;
    if (errors.length > 0) return;
    this.busy = true;
    try {
      await this.store.update({ profiles });
      if (this.store.offline) {
        this.offline = true;
        this.errors = [localize(MSG.ranges.saveFailed)];
        return;
      }
      this.dispatchEvent(new CustomEvent('wui:save', { detail: profiles, bubbles: true, composed: true }));
      this.close();
    } catch {
      this.errors = [localize(MSG.ranges.saveFailed)];
    } finally {
      this.busy = false;
    }
  }

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };
}

function profileStyles(): ReturnType<typeof css> {
  return css`
    .panel {
      width: min(60rem, 94vw);
    }
    .layout {
      display: grid;
      grid-template-columns: 13rem 1fr;
      gap: 1rem;
      min-height: 22rem;
    }
    .names {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .name {
      font: inherit;
      text-align: left;
      color: inherit;
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--_radius);
      padding: 0.25rem 0.5rem;
      cursor: pointer;
    }
    .name[aria-current='true'] {
      border-color: var(--_accent);
      color: var(--_accent);
    }
    .add {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      margin-top: 0.5rem;
    }
    .editor {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-width: 0;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .grow {
      flex: 1;
    }
    textarea {
      flex: 1;
      min-height: 20rem;
      resize: vertical;
      font-family: var(--_mono);
      font-size: 0.8125rem;
      color: var(--_text);
      background: var(--_surface-sunken);
      border: 1px solid var(--_border-strong);
      border-radius: var(--_radius);
      padding: 0.5rem;
    }
    .notice {
      margin: 0.375rem 0;
      padding: 0.375rem 0.625rem;
      border-left: 3px solid var(--_to-ack);
      background: var(--_surface);
      font-size: 0.75rem;
    }
  `;
}

// Guarded registration: the kit is vendored into several self-contained page
// bundles that share one CustomElementRegistry per SPA session.
if (!customElements.get('wui-alarm-profiles')) {
  customElements.define('wui-alarm-profiles', WuiAlarmProfiles);
}
