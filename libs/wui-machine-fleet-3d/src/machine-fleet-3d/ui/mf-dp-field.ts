// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A datapoint element field as in the dashboard's widget settings: the text can be typed, the clear
 * button empties it, the magnifier opens the platform's data selector (systems, datapoint tree, CNS,
 * details — `wui-data-selector-container`, the one the widget settings open) in an iX modal, and a
 * value naming no datapoint shows a red broken link (`MissingDatapathList`, as the platform does).
 * Emits `wui:change` with { value } like `wui-dp-input` did, so it replaces it as is.
 */
import { MissingDatapathList } from '@etm-professional-control/oa-rx-js-api';
import { closeModal, showModal } from '@siemens/ix';
import '@wincc-oa/wui-data-selector-smart-ui/components/wui-data-selector-container/wui-data-selector-container.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, render, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Subscription } from 'rxjs';
import { MSG, localize } from '../i18n.js';

interface IxValueEvent {
  detail: string;
}

@customElement('mf-dp-field')
export class MfDpField extends LitElement {
  static override readonly styles = [IXCoreStyles, fieldStyles()];

  @property() value = '';
  @property() label = '';
  @property() placeholder = '';
  /** What the selector picks: a datapoint element (default) or a whole datapoint. */
  @property() selectionMode: 'dp' | 'dpe' = 'dpe';

  /** The value names no datapoint (red broken link). */
  @state() private missing = false;

  private missingSub: Subscription | null = null;
  private modalContainer: HTMLElement | null = null;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.missingSub?.unsubscribe();
    this.missingSub = null;
    this.closeSelector();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('value')) this.watchMissing();
  }

  override render(): TemplateResult {
    return html`
      <ix-input
        label=${this.label || nothing}
        placeholder=${this.placeholder || nothing}
        class=${this.missing ? 'ix-invalid' : ''}
        .value=${this.value ?? ''}
        @valueChange=${(e: IxValueEvent) => this.select(String(e.detail ?? ''), false)}
      >
        ${this.missing
          ? html`<ix-icon
              slot="start"
              name="link-break"
              size="16"
              class="missing"
              title=${localize(MSG.dpField.missing)}
            ></ix-icon>`
          : nothing}
        <span slot="end">
          ${this.value
            ? html`<ix-icon-button
                icon="clear"
                variant="subtle-tertiary"
                size="16"
                title=${localize(MSG.dpField.clear)}
                @click=${() => this.select('', false)}
              ></ix-icon-button>`
            : nothing}
          <ix-icon-button
            icon="search"
            variant="subtle-tertiary"
            size="16"
            title=${localize(MSG.dpField.browse)}
            @click=${this.openSelector}
          ></ix-icon-button>
        </span>
      </ix-input>
    `;
  }

  /** The platform's data selector in an iX modal, as the widget settings open it. */
  private readonly openSelector = (): void => {
    this.closeSelector();
    const container = document.createElement('div');
    render(
      html`<ix-icon-button
          icon="close"
          variant="subtle-tertiary"
          size="16"
          style="margin-left: auto; margin-right: 0; display: block"
          @click=${() => this.closeSelector()}
        ></ix-icon-button>
        <wui-data-selector-container
          selectionmode=${this.selectionMode}
          .widgetTypes=${[]}
          .allowedDpt=${[]}
          @wui:itemselect=${(e: CustomEvent<string>) => this.select(String(e.detail ?? ''), true)}
          @wui:close=${() => this.closeSelector()}
        ></wui-data-selector-container>`,
      container
    );
    this.modalContainer = container;
    void showModal({ content: container, centered: true, closeOnBackdropClick: true, backdrop: true, size: '720' });
  };

  private closeSelector(): void {
    if (this.modalContainer) closeModal(this.modalContainer, true);
    this.modalContainer = null;
  }

  /** A value typed, cleared or picked: kept, told to the host, the selector closed when picked. */
  private select(value: string, fromSelector: boolean): void {
    this.value = value;
    if (fromSelector) this.closeSelector();
    this.dispatchEvent(new CustomEvent('wui:change', { detail: { value }, bubbles: true, composed: true }));
  }

  private watchMissing(): void {
    this.missingSub?.unsubscribe();
    this.missingSub = null;
    const value = (this.value ?? '').trim();
    if (!value) {
      this.missing = false;
      return;
    }
    try {
      this.missingSub = MissingDatapathList.getInstance()
        .isMissing([value])
        .subscribe((missing: boolean) => (this.missing = missing));
    } catch {
      this.missing = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mf-dp-field': MfDpField;
  }
}

function fieldStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    ix-input {
      width: 100%;
    }
    .missing {
      color: var(--theme-color-alarm);
    }
  `;
}
