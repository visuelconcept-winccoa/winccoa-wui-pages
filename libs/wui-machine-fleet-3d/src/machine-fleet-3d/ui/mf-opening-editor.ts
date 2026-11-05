// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Editor of an opening view (#70), shared by the module settings and an atelier's configuration:
 * three illustrated choice cards (A plan, B tilted plan in perspective, C tilted plan without
 * perspective — each a live render), the tilt and the margin, the building's front side when
 * `showFront`, and a larger live preview on which the tilt is set by dragging up / down (or the
 * arrow keys). `previews`: the ateliers it is tried on (the one configured, or the site's and
 * example ones); more than one shows a list to pick from.
 *
 * Emits `wui:change` with `{ view, front }` on every change; the dialog keeps the value.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, queryAll, state } from 'lit/decorators.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import {
  FRONT_SIDES,
  MARGIN_MAX,
  MARGIN_MIN,
  TILT_MAX,
  TILT_MIN,
  type FrontSide,
  type OpeningMode,
  type OpeningViewSetting
} from '@visuelconcept-winccoa/wui-fleet-core/opening-view.js';
import { drawOpeningPreview, type PreviewAtelier } from '../scene/opening-preview.js';
import { MSG, localize, localizeDir } from '../i18n.js';

export interface OpeningChange {
  view: OpeningViewSetting;
  front: FrontSide;
}

const MODES: { mode: OpeningMode; letter: string; title: MultiLangString; text: MultiLangString }[] = [
  { mode: 'plan', letter: 'A', title: MSG.opening.plan, text: MSG.opening.planText },
  { mode: 'tilted', letter: 'B', title: MSG.opening.tilted, text: MSG.opening.tiltedText },
  { mode: 'tilted-ortho', letter: 'C', title: MSG.opening.tiltedOrtho, text: MSG.opening.tiltedOrthoText }
];

const FRONT_LABELS: Record<FrontSide, MultiLangString> = {
  0: MSG.opening.frontSouth,
  90: MSG.opening.frontEast,
  180: MSG.opening.frontNorth,
  270: MSG.opening.frontWest
};

/** Degrees of tilt per pixel dragged on the preview. */
const DRAG_DEG_PER_PX = 0.25;

@customElement('mf-opening-editor')
export class MfOpeningEditor extends LitElement {
  static override readonly styles = [IXCoreStyles, editorStyles()];

  @property({ attribute: false }) view: OpeningViewSetting = { mode: 'tilted', tilt: 30, margin: 12 };
  @property({ type: Number }) front: FrontSide = 0;
  @property({ type: Boolean }) showFront = false;
  @property({ type: Boolean }) disabled = false;
  @property({ attribute: false }) previews: PreviewAtelier[] = [];

  @state() private picked = 0;
  @state() private webgl = true;

  @queryAll('canvas.thumb') private thumbs!: NodeListOf<HTMLCanvasElement>;
  @queryAll('canvas.sample-thumb') private sampleThumbs!: NodeListOf<HTMLCanvasElement>;
  @query('canvas.big') private big!: HTMLCanvasElement;

  private drag: { y: number; tilt: number } | null = null;

  private get atelier(): PreviewAtelier | undefined {
    return this.previews[Math.min(this.picked, this.previews.length - 1)];
  }

  override render(): TemplateResult {
    const t = MSG.opening;
    const tiltOff = this.disabled || this.view.mode === 'plan';
    return html`
      <div class="cards" role="radiogroup" aria-label=${localize(t.modeTitle)}>
        ${MODES.map(
          (m) => html`<button
            type="button"
            class="card"
            role="radio"
            aria-checked=${String(this.view.mode === m.mode)}
            ?disabled=${this.disabled}
            @click=${() => this.change({ ...this.view, mode: m.mode })}
          >
            <canvas class="thumb" width="320" height="200" data-mode=${m.mode}></canvas>
            <span class="card-text">
              <strong><i class="radio"></i>${m.letter} — ${localizeDir(m.title)}</strong>
              <span>${localizeDir(m.text)}</span>
            </span>
          </button>`
        )}
      </div>

      <div class="params">
        <div class="ctl">
          <div class="ctl-head"><span>${localizeDir(t.tilt)}</span><output>${this.view.tilt}°</output></div>
          <ix-slider
            .value=${this.view.tilt}
            min=${TILT_MIN}
            max=${TILT_MAX}
            step="1"
            ?disabled=${tiltOff}
            @valueChange=${(e: CustomEvent<number>) => this.change({ ...this.view, tilt: Number(e.detail) })}
          ></ix-slider>
        </div>
        <div class="ctl">
          <div class="ctl-head"><span>${localizeDir(t.margin)}</span><output>${this.view.margin} %</output></div>
          <ix-slider
            .value=${this.view.margin}
            min=${MARGIN_MIN}
            max=${MARGIN_MAX}
            step="1"
            ?disabled=${this.disabled}
            @valueChange=${(e: CustomEvent<number>) => this.change({ ...this.view, margin: Number(e.detail) })}
          ></ix-slider>
        </div>
        ${this.showFront
          ? html`<ix-select
              class="front"
              label=${localize(t.front)}
              helper-text=${localize(t.frontHint)}
              .value=${String(this.front)}
              ?disabled=${this.disabled}
              @valueChange=${(e: CustomEvent<string>) => this.change(this.view, Number(e.detail) as FrontSide)}
            >
              ${FRONT_SIDES.map((f) => html`<ix-select-item label=${localize(FRONT_LABELS[f])} value=${String(f)}></ix-select-item>`)}
            </ix-select>`
          : nothing}
      </div>

      <div class="preview">
        <div class="big-wrap">
          <canvas
            class="big"
            width="720"
            height="450"
            tabindex="0"
            aria-label=${localize(t.dragHint)}
            @pointerdown=${this.onDown}
            @pointermove=${this.onMove}
            @pointerup=${this.onUp}
            @pointercancel=${this.onUp}
            @keydown=${this.onKey}
          ></canvas>
          ${this.webgl ? nothing : html`<span class="no-webgl">${localizeDir(t.noWebgl)}</span>`}
        </div>
        <div class="side">
          <span class="hint">${localizeDir(t.dragHint)}</span>
          ${this.previews.length > 1
            ? html`<span class="side-title">${localizeDir(t.samples)}</span>
                <div class="samples" role="radiogroup" aria-label=${localize(t.samples)}>
                  ${this.previews.map(
                    (p, i) => html`<button
                      type="button"
                      class="sample"
                      role="radio"
                      aria-checked=${String(i === this.picked)}
                      @click=${() => (this.picked = i)}
                    >
                      <canvas class="sample-thumb" width="128" height="80" data-index=${i}></canvas>
                      <span><strong>${p.name}</strong><small>${p.note ?? ''}</small></span>
                    </button>`
                  )}
                </div>`
            : nothing}
        </div>
      </div>
    `;
  }

  protected override updated(_changed: PropertyValues): void {
    const atelier = this.atelier;
    if (!atelier) return;
    let ok = true;
    this.thumbs.forEach((c) => {
      ok = drawOpeningPreview(c, atelier, { ...this.view, mode: c.dataset['mode'] as OpeningMode }, this.front, false) && ok;
    });
    this.sampleThumbs.forEach((c) => {
      const p = this.previews[Number(c.dataset['index'])];
      if (p) drawOpeningPreview(c, p, this.view, 0, false);
    });
    if (this.big) ok = drawOpeningPreview(this.big, atelier, this.view, this.front, true) && ok;
    if (ok !== this.webgl) this.webgl = ok;
  }

  private change(view: OpeningViewSetting, front: FrontSide = this.front): void {
    if (this.disabled) return;
    this.view = view;
    this.front = front;
    const detail: OpeningChange = { view, front };
    this.dispatchEvent(new CustomEvent('wui:change', { detail, bubbles: true, composed: true }));
  }

  private setTilt(tilt: number): void {
    const bounded = Math.min(TILT_MAX, Math.max(TILT_MIN, Math.round(tilt)));
    if (bounded !== this.view.tilt) this.change({ ...this.view, tilt: bounded });
  }

  private get tiltEditable(): boolean {
    return !this.disabled && this.view.mode !== 'plan';
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.tiltEditable) return;
    this.drag = { y: e.clientY, tilt: this.view.tilt };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.drag) this.setTilt(this.drag.tilt + (this.drag.y - e.clientY) * DRAG_DEG_PER_PX);
  };

  private readonly onUp = (): void => {
    this.drag = null;
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.tiltEditable || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    this.setTilt(this.view.tilt + (e.key === 'ArrowUp' ? 1 : -1));
  };
}

function editorStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: grid;
      gap: 0.9rem;
      color: var(--theme-color-std-text);
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.6rem;
    }
    @media (max-width: 640px) {
      .cards {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .card {
      display: grid;
      grid-template-rows: auto 1fr;
      padding: 0;
      text-align: left;
      font: inherit;
      color: inherit;
      cursor: pointer;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      overflow: hidden;
      min-width: 0;
    }
    .card[aria-checked='true'] {
      border-color: var(--theme-color-primary);
      box-shadow: inset 0 0 0 1px var(--theme-color-primary);
    }
    .card[disabled] {
      cursor: default;
      opacity: 0.6;
    }
    .card:focus-visible,
    .sample:focus-visible,
    canvas.big:focus-visible {
      outline: 2px solid var(--theme-color-primary);
      outline-offset: 2px;
    }
    .thumb {
      width: 100%;
      aspect-ratio: 16 / 10;
      display: block;
    }
    .card-text {
      display: grid;
      gap: 0.2rem;
      padding: 0.5rem 0.6rem 0.6rem;
    }
    .card-text strong {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .card-text span,
    .hint,
    .sample small {
      color: var(--theme-color-soft-text);
      font-size: 0.82rem;
      line-height: 1.35;
    }
    .radio {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      border: 2px solid var(--theme-color-soft-text);
      flex: none;
    }
    .card[aria-checked='true'] .radio {
      border-color: var(--theme-color-primary);
      background: radial-gradient(var(--theme-color-primary) 45%, transparent 50%);
    }
    .params {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: 0.6rem 1.6rem;
      align-items: end;
    }
    .ctl {
      display: grid;
      gap: 0.1rem;
      min-width: 0;
    }
    .ctl-head {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .ctl-head output {
      font-variant-numeric: tabular-nums;
      color: var(--theme-color-std-text);
    }
    .preview {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: 0.8rem;
      align-items: start;
    }
    @media (max-width: 640px) {
      .preview {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .big-wrap {
      position: relative;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      overflow: hidden;
    }
    canvas.big {
      width: 100%;
      aspect-ratio: 16 / 10;
      display: block;
      cursor: ns-resize;
      touch-action: none;
    }
    .no-webgl {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--theme-color-soft-text);
    }
    .side {
      display: grid;
      gap: 0.4rem;
    }
    .side-title {
      font-weight: 600;
      font-size: 0.85rem;
    }
    .samples {
      display: grid;
      gap: 0.35rem;
    }
    .sample {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr);
      gap: 0.5rem;
      align-items: center;
      padding: 0.25rem;
      text-align: left;
      font: inherit;
      color: inherit;
      cursor: pointer;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      min-width: 0;
    }
    .sample[aria-checked='true'] {
      border-color: var(--theme-color-primary);
    }
    .sample canvas {
      width: 64px;
      aspect-ratio: 16 / 10;
      display: block;
    }
    .sample span {
      display: grid;
      min-width: 0;
    }
    .sample strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
}
