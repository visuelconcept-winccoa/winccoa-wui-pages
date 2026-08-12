// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The period bar of the archived tab: previous / preset / next, plus the two date
 * inputs when the preset is `custom`.
 *
 * A template function rather than a component: it owns no state (the view does)
 * and rendering it inside the view's shadow root keeps it under the view's
 * stylesheet — a separate element would need its own copy of the toolbar styles
 * for three controls.
 */
import { html, nothing, type TemplateResult } from 'lit';
import { MSG, localize, localizeDir } from '../i18n.js';
import { ALARM_PERIODS, type AlarmPeriod } from '../period.js';

/** `ix-select` / `ix-date-input` hand their value over as a string or a list. */
interface IxValueEvent {
  detail: string | string[];
}

function firstValue(detail: string | string[]): string {
  return Array.isArray(detail) ? (detail[0] ?? '') : detail;
}

export interface PeriodState {
  period: AlarmPeriod;
  /** Whole periods back from the current one. */
  shift: number;
  customStart: string;
  customEnd: string;
}

export type PeriodPatch = (change: Partial<PeriodState>) => void;

function renderCustomDates(state: PeriodState, patch: PeriodPatch): TemplateResult {
  return html`
    <label class="ctl">
      <span>${localizeDir(MSG.period.start)}</span>
      <ix-date-input
        format="yyyy-MM-dd"
        .value=${state.customStart}
        @valueChange=${(event: IxValueEvent) => patch({ customStart: firstValue(event.detail) })}
      ></ix-date-input>
    </label>
    <label class="ctl">
      <span>${localizeDir(MSG.period.end)}</span>
      <ix-date-input
        format="yyyy-MM-dd"
        .value=${state.customEnd}
        @valueChange=${(event: IxValueEvent) => patch({ customEnd: firstValue(event.detail) })}
      ></ix-date-input>
    </label>
  `;
}

export function renderPeriodBar(state: PeriodState, patch: PeriodPatch): TemplateResult {
  return html`
    <ix-icon-button
      ghost
      icon="chevron-left"
      title=${localize(MSG.period.previous)}
      @click=${() => patch({ shift: state.shift + 1 })}
    ></ix-icon-button>
    <label class="ctl">
      <span>${localizeDir(MSG.period.label)}</span>
      <ix-select
        .value=${state.period}
        @valueChange=${(event: IxValueEvent) => patch({ period: firstValue(event.detail) as AlarmPeriod, shift: 0 })}
      >
        ${ALARM_PERIODS.map(
          (period) => html`<ix-select-item value=${period} label=${localize(MSG.period[period])}></ix-select-item>`
        )}
      </ix-select>
    </label>
    <ix-icon-button
      ghost
      icon="chevron-right"
      title=${localize(MSG.period.next)}
      ?disabled=${state.shift === 0}
      @click=${() => patch({ shift: Math.max(0, state.shift - 1) })}
    ></ix-icon-button>
    ${state.period === 'custom' ? renderCustomDates(state, patch) : nothing}
  `;
}
