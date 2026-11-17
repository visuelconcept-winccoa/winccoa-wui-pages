// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to create or edit one camera: identity (name/group), the source
 * kind, a description, then per kind —
 * - **RTSP**: the rtsp URL + optional stored credentials and the classic stream
 *   options (transport, audio, target resolution / frame-rate / bitrate,
 *   WebSocket auto-reconnect);
 * - **USB camera of this PC**: only a resolution preset. The device itself is
 *   not chosen here: device ids are per browser, so each browser picks (and
 *   remembers) its own camera in the viewer.
 * Emits `wui:save` / `wui:cancel`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  DEFAULT_RECONNECT_DELAY_SEC,
  LOCAL_RESOLUTIONS,
  blankStream,
  isLocalCamera,
  type CameraSourceKind,
  type CameraStream,
  type LocalResolution,
  type RtspTransport
} from '../types.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string | number;
}

const KINDS: readonly CameraSourceKind[] = ['rtsp', 'local'];
const KIND_LABELS: Record<CameraSourceKind, MultiLangString> = {
  rtsp: MSG.dialog.kindRtsp,
  local: MSG.dialog.kindLocal
};
const RESOLUTION_LABELS: Record<LocalResolution, MultiLangString> = {
  default: MSG.dialog.resDefault,
  '480p': MSG.dialog.res480p,
  '720p': MSG.dialog.res720p,
  '1080p': MSG.dialog.res1080p
};

/** First value of an ix-select `valueChange` detail. */
function selectValue(detail: string | string[]): string {
  return (Array.isArray(detail) ? detail[0] : detail) ?? '';
}

@customElement('cs-stream-dialog')
export class CsStreamDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  /** Camera to edit; when null the dialog creates a new one. */
  @property({ attribute: false }) stream: CameraStream | null = null;

  @state() private working: CameraStream = blankStream();
  @state() private showPassword = false;

  // eslint-disable-next-line max-lines-per-function -- single form template
  override render(): TemplateResult {
    const isNew = !this.stream;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${isNew
                ? localizeDir(isLocalCamera(this.working) ? MSG.page.newCamera : MSG.dialog.newCamera)
                : html`${localizeDir(MSG.dialog.editPrefix)} — ${this.working.name}`}
            </ix-typography>
          </div>

          <div class="panel-body">
            <div class="grid2">
              ${this.textField(MSG.dialog.fName, 'name')} ${this.textField(MSG.dialog.fGroup, 'group')}
            </div>

            <div class="field">
              <label>${localizeDir(MSG.dialog.fSourceKind)}</label>
              <ix-select
                .selectedIndices=${[Math.max(0, KINDS.indexOf(this.working.kind))]}
                @valueChange=${(e: CustomEvent<string | string[]>) =>
                  this.patch({ kind: selectValue(e.detail) === 'local' ? 'local' : 'rtsp' })}
              >
                ${KINDS.map(
                  (k) => html`<ix-select-item value=${k} label=${localize(KIND_LABELS[k])}></ix-select-item>`
                )}
              </ix-select>
            </div>

            <div class="field">
              <label>${localizeDir(MSG.dialog.fDescription)}</label>
              <ix-input
                .value=${this.working.description}
                @valueChange=${(e: IxValueEvent) => this.patch({ description: String(e.detail) })}
              ></ix-input>
            </div>

            ${isLocalCamera(this.working) ? this.renderLocalFields() : this.renderRtspFields()}
          </div>

          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.dialog.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${!this.isValid()}>
              <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.dialog.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- single form-section template
  private renderRtspFields(): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(MSG.dialog.fUrl)}</label>
        <ix-input
          placeholder="rtsp://10.0.5.21:554/Streaming/Channels/101"
          .value=${this.working.url}
          @valueChange=${(e: IxValueEvent) => this.patch({ url: String(e.detail) })}
        ></ix-input>
      </div>

      <div class="grid2">
        ${this.textField(MSG.dialog.fUsername, 'username')}
        <div class="field">
          <label>${localizeDir(MSG.dialog.fPassword)}</label>
          <div class="pw-row">
            <input
              class="pw"
              .type=${this.showPassword ? 'text' : 'password'}
              autocomplete="off"
              .value=${this.working.password}
              @input=${(e: Event) => this.patch({ password: (e.target as HTMLInputElement).value })}
            />
            <ix-button
              variant="secondary"
              outline
              @click=${() => (this.showPassword = !this.showPassword)}
            >
              <ix-icon name="eye" slot="icon"></ix-icon>
              ${this.showPassword ? localizeDir(MSG.dialog.hide) : localizeDir(MSG.dialog.show)}
            </ix-button>
          </div>
        </div>
      </div>
      <div class="warn">
        <ix-icon name="warning"></ix-icon>${localizeDir(MSG.dialog.credentialsWarning)}
      </div>

      <div class="subhead">${localizeDir(MSG.dialog.secStreamOptions)}</div>
      <div class="grid2">
        <div class="field">
          <label>${localizeDir(MSG.dialog.fTransport)}</label>
          <ix-select
            .selectedIndices=${[this.working.transport === 'udp' ? 1 : 0]}
            @valueChange=${(e: CustomEvent<string | string[]>) =>
              this.patch({ transport: this.readTransport(e.detail) })}
          >
            <ix-select-item value="tcp" label=${localize(MSG.dialog.transportTcp)}></ix-select-item>
            <ix-select-item value="udp" label=${localize(MSG.dialog.transportUdp)}></ix-select-item>
          </ix-select>
        </div>
        <div class="toggle-row standalone">
          <span>${localizeDir(MSG.dialog.audioToggle)}</span>
          <ix-toggle
            hide-text
            ?checked=${this.working.audio}
            @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ audio: e.detail })}
          ></ix-toggle>
        </div>
      </div>
      <div class="grid3">
        ${this.numberField(MSG.dialog.fMaxWidth, 'maxWidth')}
        ${this.numberField(MSG.dialog.fFrameRate, 'frameRate')}
        ${this.numberField(MSG.dialog.fVideoBitrate, 'videoBitrate')}
      </div>

      <div class="subhead">${localizeDir(MSG.dialog.secReconnect)}</div>
      <div class="grid2">
        <div class="toggle-row standalone">
          <span>${localizeDir(MSG.dialog.autoReconnectToggle)}</span>
          <ix-toggle
            hide-text
            ?checked=${this.working.autoReconnect}
            @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ autoReconnect: e.detail })}
          ></ix-toggle>
        </div>
        ${this.numberField(MSG.dialog.fReconnectDelay, 'reconnectDelaySec')}
      </div>
    `;
  }

  private renderLocalFields(): TemplateResult {
    return html`
      <div class="info">
        <ix-icon name="info"></ix-icon>${localizeDir(MSG.dialog.localInfo)}
      </div>
      <div class="field">
        <label>${localizeDir(MSG.dialog.fResolution)}</label>
        <ix-select
          .selectedIndices=${[Math.max(0, LOCAL_RESOLUTIONS.indexOf(this.working.localResolution))]}
          @valueChange=${(e: CustomEvent<string | string[]>) =>
            this.patch({ localResolution: this.readResolution(e.detail) })}
        >
          ${LOCAL_RESOLUTIONS.map(
            (r) => html`<ix-select-item value=${r} label=${localize(RESOLUTION_LABELS[r])}></ix-select-item>`
          )}
        </ix-select>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('stream')) {
      // Spread over blankStream() so older records are backfilled with defaults.
      this.working = this.stream
        ? { ...blankStream(), ...structuredClone(this.stream) }
        : blankStream();
      this.showPassword = false;
    }
  }

  private textField(label: MultiLangString, key: 'name' | 'group' | 'username'): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-input
          .value=${this.working[key]}
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ [key]: String(e.detail) } as Partial<CameraStream>)}
        ></ix-input>
      </div>
    `;
  }

  private numberField(
    label: MultiLangString,
    key: 'maxWidth' | 'frameRate' | 'videoBitrate' | 'reconnectDelaySec'
  ): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-number-input
          .value=${this.working[key]}
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ [key]: Math.max(0, Number(e.detail) || 0) } as Partial<CameraStream>)}
        ></ix-number-input>
      </div>
    `;
  }

  private readTransport(detail: string | string[]): RtspTransport {
    return selectValue(detail) === 'udp' ? 'udp' : 'tcp';
  }

  private readResolution(detail: string | string[]): LocalResolution {
    const value = selectValue(detail);
    return LOCAL_RESOLUTIONS.find((r) => r === value) ?? 'default';
  }

  private isValid(): boolean {
    if (this.working.name.trim() === '') return false;
    // A local camera has no URL: the browser opens a device of its own PC.
    return isLocalCamera(this.working) || /^rtsps?:\/\/\S+/i.test(this.working.url.trim());
  }

  private patch(part: Partial<CameraStream>): void {
    this.working = { ...this.working, ...part };
  }

  private save(): void {
    if (!this.isValid()) return;
    const clean: CameraStream = {
      ...this.working,
      reconnectDelaySec: this.working.reconnectDelaySec || DEFAULT_RECONNECT_DELAY_SEC
    };
    // A local camera has no RTSP endpoint: drop a URL / credentials typed before switching kind.
    if (isLocalCamera(clean)) Object.assign(clean, { url: '', username: '', password: '' });
    this.dispatchEvent(new CustomEvent('wui:save', { detail: clean, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .pw-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .pw {
      flex: 1;
      box-sizing: border-box;
      padding: 0.4rem 0.5rem;
      color: var(--theme-color-std-text);
      background: var(--theme-color-component-1, var(--theme-color-1));
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      font-family: inherit;
      font-size: 0.9rem;
    }
    .info {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      margin: 0.5rem 0;
      font-size: 0.82rem;
      color: var(--theme-color-soft-text);
    }
    .warn {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.35rem;
      font-size: 0.78rem;
      color: var(--theme-color-warning);
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0.4rem 0;
      font-size: 0.9rem;
    }
    .toggle-row.standalone {
      align-self: end;
      padding-bottom: 0.35rem;
    }
  `;
}
