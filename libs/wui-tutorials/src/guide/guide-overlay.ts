// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `<wui-tutorials-guide>`: the mascot and its speech bubble over the application, put on
 * `document.body` so that it outlives page changes. The step's element is lit up (the rest of the
 * screen dimmed); everything stays clickable: the operator does the actions.
 *
 * Colours: the iX theme's tokens; a site may set `--wui-tutorials-accent`, `-surface`, `-ink`.
 */
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { LitElement, css, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { MSG, fill } from '../i18n.js';
import { deepQuery } from './deep-query.js';
import { defineOnce } from './define.js';
import { tutorEngine } from './engine.js';
import './mascot.js';
import { expectOf, pointOf, text, type Mood } from './tutorial.js';

/** How fast the bubble writes: characters added every 16 ms. */
const TYPE_STEP = 2;
/** Room around the lit element, in pixels. */
const SPOT_PADDING = 6;
/** How often the target is looked for: pages draw after they open. */
const SPOT_POLL_MS = 250;

interface Spot {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class WuiTutorialsGuide extends LitElement {
  static override readonly styles = css`
    :host {
      --accent: var(--wui-tutorials-accent, var(--theme-color-primary));
      --on-accent: var(--theme-color-primary--contrast);
      --surface: var(--wui-tutorials-surface, var(--theme-color-3));
      --ink: var(--wui-tutorials-ink, var(--theme-color-std-text));
      --ink-soft: var(--theme-color-soft-text);
      --border: var(--theme-color-soft-bdr);
      --ok: var(--theme-color-success);
      position: fixed;
      inset: 0;
      z-index: 10000;
      pointer-events: none;
      color: var(--ink);
    }
    .g-spot {
      position: fixed;
      border-radius: 8px;
      box-shadow: 0 0 0 200vmax var(--theme-color-backdrop);
      outline: 3px solid var(--accent);
      outline-offset: 2px;
      transition: left 0.25s, top 0.25s, width 0.25s, height 0.25s;
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        outline-offset: 7px;
      }
    }
    .g-panel {
      position: fixed;
      bottom: 16px;
      right: 16px;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      max-width: min(480px, calc(100vw - 32px));
      pointer-events: auto;
      animation: enter 0.3s ease-out;
    }
    .g-panel.left {
      right: auto;
      left: 16px;
    }
    @keyframes enter {
      from {
        transform: translateY(24px);
        opacity: 0;
      }
    }
    .g-bubble {
      position: relative;
      flex: 1;
      min-width: 0;
      padding: 12px 14px;
      background: var(--surface);
      border: 2px solid var(--accent);
      border-radius: 14px;
      box-shadow: var(--theme-shadow-4);
    }
    .g-bubble::after {
      content: '';
      position: absolute;
      left: -10px;
      bottom: 28px;
      border: 8px solid transparent;
      border-right-color: var(--accent);
      border-left: 0;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8125rem;
      color: var(--ink-soft);
    }
    header .g-title {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .g-bar {
      height: 4px;
      margin: 6px 0 10px;
      background: var(--theme-color-ghost--selected);
      border-radius: 2px;
      overflow: hidden;
    }
    .g-bar div {
      height: 100%;
      background: var(--accent);
      transition: width 0.4s;
    }
    .g-text {
      min-height: 3em;
      font-size: 0.875rem;
      line-height: 1.45;
    }
    .g-goal {
      display: inline-flex;
      margin-top: 8px;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--accent);
      border: 1px solid var(--accent);
    }
    .g-goal.ok {
      color: var(--ok);
      border-color: var(--ok);
    }
    .g-hint {
      margin-top: 8px;
      padding: 6px 10px;
      border-left: 3px solid var(--accent);
      background: var(--theme-color-ghost--selected);
      font-size: 0.8125rem;
    }
    .g-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
    }
    .g-badge {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 12px;
      border-radius: 999px;
      background: var(--accent);
      color: var(--on-accent);
      font-weight: 700;
    }
    .g-mini {
      position: fixed;
      bottom: 16px;
      right: 16px;
      pointer-events: auto;
      cursor: pointer;
      background: none;
      border: 0;
      padding: 0;
    }
  `;

  @state() private shown = 0;
  @state() private spot: Spot | null = null;
  @state() private minimized = false;

  private typing?: ReturnType<typeof setInterval>;
  private polling?: ReturnType<typeof setInterval>;
  private textKey = '';
  private scrolledTo: Element | null = null;
  private readonly onChange = () => this.requestUpdate();

  override connectedCallback(): void {
    super.connectedCallback();
    tutorEngine.addEventListener('change', this.onChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    tutorEngine.removeEventListener('change', this.onChange);
    clearInterval(this.typing);
    clearInterval(this.polling);
  }

  protected override willUpdate(): void {
    const engine = tutorEngine;
    const key = engine.phase === 'off' ? '' : `${engine.tutorial?.id}#${engine.index}#${engine.phase === 'finished'}`;
    if (key === this.textKey) return;
    this.textKey = key;
    // A new line: the bubble writes it, the target is looked for.
    this.startTyping();
    this.startSpotting();
  }

  private get line(): string {
    const engine = tutorEngine;
    if (engine.phase === 'finished') return fill(String(localize(MSG.finished)), { s: text(engine.tutorial?.title) });
    return text(engine.step?.say);
  }

  private startTyping(): void {
    clearInterval(this.typing);
    this.shown = 0;
    const length = this.line.length;
    if (!length || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.shown = length;
      return;
    }
    this.typing = setInterval(() => {
      this.shown = Math.min(this.shown + TYPE_STEP, length);
      if (this.shown >= length) clearInterval(this.typing);
    }, 16);
  }

  private startSpotting(): void {
    clearInterval(this.polling);
    this.spot = null;
    this.scrolledTo = null;
    const step = tutorEngine.phase === 'step' || tutorEngine.phase === 'success' ? tutorEngine.step : null;
    const point = step ? pointOf(step) : undefined;
    if (!point) return;
    const locate = () => {
      const target = deepQuery(point);
      if (!target) {
        this.spot = null;
        return;
      }
      if (target !== this.scrolledTo) {
        this.scrolledTo = target;
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
      const r = target.getBoundingClientRect();
      const next = { left: r.left - SPOT_PADDING, top: r.top - SPOT_PADDING, width: r.width + 2 * SPOT_PADDING, height: r.height + 2 * SPOT_PADDING };
      const current = this.spot;
      const same = current !== null && (Object.keys(next) as (keyof Spot)[]).every((key) => Math.abs(current[key] - next[key]) < 1);
      if (!same) this.spot = next;
    };
    locate();
    this.polling = setInterval(locate, SPOT_POLL_MS);
  }

  private get mood(): Mood {
    const engine = tutorEngine;
    if (engine.phase === 'finished') return 'cheer';
    if (engine.phase === 'success') return 'happy';
    if (this.shown < this.line.length) return 'talk';
    const step = engine.step;
    return step?.mood ?? (step && expectOf(step) ? 'think' : 'idle');
  }

  /** The bubble on the left when the target is at the bottom right, under it. */
  private get side(): 'left' | 'right' {
    const spot = this.spot;
    if (!spot) return 'right';
    return spot.left + spot.width > innerWidth - 500 && spot.top + spot.height > innerHeight - 260 ? 'left' : 'right';
  }

  private finishTyping(): void {
    clearInterval(this.typing);
    this.shown = this.line.length;
  }

  private close(): void {
    tutorEngine.stop();
  }

  private toList(): void {
    tutorEngine.stop();
    location.hash = '#/tutorials';
  }

  override render() {
    const engine = tutorEngine;
    if (engine.phase === 'off' || !engine.tutorial) return nothing;
    if (this.minimized) {
      return html`<button class="g-mini" title=${localize(MSG.restore)} @click=${() => (this.minimized = false)}>
        <wui-tutorials-mascot mood="idle"></wui-tutorials-mascot>
      </button>`;
    }
    const spot = this.spot && engine.phase !== 'finished' ? this.spot : null;
    return html`
      ${spot ? html`<div class="g-spot" style="left:${spot.left}px;top:${spot.top}px;width:${spot.width}px;height:${spot.height}px"></div>` : nothing}
      <div class="g-panel ${this.side}" role="dialog" aria-label=${fill(String(localize(MSG.dialog)), { s: text(engine.tutorial.title) })}>
        <wui-tutorials-mascot .mood=${this.mood}></wui-tutorials-mascot>
        <div class="g-bubble">${engine.phase === 'finished' ? this.renderFinished() : this.renderStep()}</div>
      </div>
    `;
  }

  private renderStep() {
    const engine = tutorEngine;
    const tutorial = engine.tutorial!;
    const step = engine.step!;
    const expect = expectOf(step);
    const total = tutorial.steps.length;
    const last = engine.index === total - 1;
    const typed = this.shown >= this.line.length;
    const done = engine.index + (engine.phase === 'success' ? 1 : 0);
    return html`
      <header>
        <span class="g-title">${text(tutorial.title)}</span>
        <span>${fill(String(localize(MSG.step)), { n: engine.index + 1, t: total })}</span>
        <ix-icon-button ghost size="16" icon="minus" a11y-label=${localize(MSG.minimize)} title=${localize(MSG.minimize)} @click=${() => (this.minimized = true)}></ix-icon-button>
        <ix-icon-button ghost size="16" icon="close" a11y-label=${localize(MSG.quit)} title=${localize(MSG.quit)} @click=${this.close}></ix-icon-button>
      </header>
      <div class="g-bar"><div style="width:${(done / total) * 100}%"></div></div>
      <div class="g-text" aria-live="polite" @click=${this.finishTyping}>${this.line.slice(0, this.shown)}</div>
      ${expect && typed
        ? engine.phase === 'success'
          ? html`<span class="g-goal ok">✓ ${localize(MSG.wellDone)}</span>`
          : html`<span class="g-goal">${localize(MSG.yourTurn)}</span>`
        : nothing}
      ${engine.hintShown && step.hint && engine.phase === 'step' ? html`<div class="g-hint">💡 ${text(step.hint.say)}</div>` : nothing}
      <div class="g-actions">
        ${engine.index > 0 ? html`<ix-button variant="secondary" @click=${() => engine.previous()}>${localize(MSG.previous)}</ix-button>` : nothing}
        ${expect
          ? html`<ix-button variant="secondary" title=${localize(MSG.skipTitle)} ?disabled=${engine.phase !== 'step'} @click=${() => engine.next()}>${localize(MSG.skip)}</ix-button>`
          : html`<ix-button variant="primary" @click=${() => (typed ? engine.next() : this.finishTyping())}>
              ${step.next ? text(step.next) : localize(last ? MSG.finish : MSG.next)}
            </ix-button>`}
      </div>
    `;
  }

  private renderFinished() {
    const tutorial = tutorEngine.tutorial!;
    return html`
      <header>
        <span class="g-title">${text(tutorial.title)}</span>
        <ix-icon-button ghost size="16" icon="close" a11y-label=${localize(MSG.close)} title=${localize(MSG.close)} @click=${this.close}></ix-icon-button>
      </header>
      <div class="g-text" aria-live="polite" @click=${this.finishTyping}>${this.line.slice(0, this.shown)}</div>
      ${tutorial.badge ? html`<span class="g-badge">🏅 ${text(tutorial.badge)}</span>` : nothing}
      <div class="g-actions">
        <ix-button variant="secondary" @click=${this.close}>${localize(MSG.close)}</ix-button>
        <ix-button variant="primary" @click=${this.toList}>${localize(MSG.more)}</ix-button>
      </div>
    `;
  }
}

defineOnce('wui-tutorials-guide', WuiTutorialsGuide);

/** Puts the guide on the page (once), loads the tutorials and resumes the one a reload interrupted. */
export function installGuide(): void {
  if (!document.querySelector('wui-tutorials-guide')) document.body.append(document.createElement('wui-tutorials-guide'));
  void tutorEngine.load();
}
