// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Exercise tab — pick a drill scenario, run it, act from the other tabs
 * (3D / synoptic / modes: every command is intercepted and simulated, nothing
 * reaches the field), follow the expected-actions checklist live, and read
 * the scored report at the end. Pure presentation: the tunnel view owns the
 * {@link ExerciseEngine}, the clock, the twin updates and the interception.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { builtinScenarios, type ExerciseReport, type Scenario } from '../data/exercise.js';
import { MSG, localizeDir } from '../i18n.js';

@customElement('hd-exercise')
export class HdExercise extends LitElement {
  static override readonly styles = [IXCoreStyles, exerciseStyles()];

  @property({ type: Boolean }) canRun = false;
  /** Active scenario (null = idle). */
  @property({ attribute: false }) scenario: Scenario | null = null;
  @property({ type: Number }) elapsedS = 0;
  /** Ids of the expected actions already satisfied. */
  @property({ attribute: false }) satisfied: string[] = [];
  /** Report of the last finished run (null while idle/running). */
  @property({ attribute: false }) report: ExerciseReport | null = null;

  override render(): TemplateResult {
    if (this.scenario) return this.renderRunning(this.scenario);
    return html`
      <div class="intro">
        <ix-typography format="h4">${localizeDir(MSG.exercise.title)}</ix-typography>
        <p class="hint">${localizeDir(MSG.exercise.hint)}</p>
      </div>
      <div class="grid">
        ${builtinScenarios().map(
          (s) => html`
            <div class="card">
              <ix-typography format="h4">${localizeDir(s.name)}</ix-typography>
              <p class="description">${localizeDir(s.description)}</p>
              <div class="facts">
                ${Math.round(s.durationS / 60)} min · ${s.expected.length}
                ${localizeDir(MSG.exercise.expectedCount)}
              </div>
              <ix-button ?disabled=${!this.canRun} @click=${() => this.start(s)}>
                <ix-icon name="play" slot="icon"></ix-icon>${localizeDir(MSG.exercise.start)}
              </ix-button>
            </div>
          `
        )}
      </div>
      ${this.report ? this.renderReport(this.report) : nothing}
    `;
  }

  private renderRunning(scenario: Scenario): TemplateResult {
    const done = new Set(this.satisfied);
    const remaining = Math.max(0, scenario.durationS - this.elapsedS);
    return html`
      <div class="running">
        <div class="run-head">
          <ix-icon name="analysis" size="24"></ix-icon>
          <div class="run-title">
            <b>${localizeDir(MSG.exercise.runningTag)} — ${localizeDir(scenario.name)}</b>
            <span>${formatClock(this.elapsedS)} / ${formatClock(scenario.durationS)}
              (${localizeDir(MSG.exercise.remaining)} ${formatClock(remaining)})</span>
          </div>
          <ix-button variant="secondary" @click=${() => this.stop()}>
            ${localizeDir(MSG.exercise.finish)}
          </ix-button>
        </div>
        <p class="hint">${localizeDir(MSG.exercise.runningHint)}</p>
        <div class="checklist">
          ${scenario.expected.map(
            (action) => html`
              <div class="check ${done.has(action.id) ? 'done' : ''}">
                <ix-icon name=${done.has(action.id) ? 'check' : 'info'} size="16"></ix-icon>
                ${localizeDir(action.label)}
                <span class="target">≤ ${formatClock(action.targetS)}</span>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  private renderReport(report: ExerciseReport): TemplateResult {
    return html`
      <div class="report">
        <div class="score ${report.score >= 75 ? 'good' : report.score >= 40 ? 'mid' : 'bad'}">
          ${report.score} / 100
        </div>
        <div class="report-body">
          <ix-typography format="h4">${localizeDir(MSG.exercise.reportTitle)}</ix-typography>
          ${report.actions.map((a) => {
            const state = a.doneAtS === undefined ? 'missed' : a.withinTarget ? 'ok' : 'late';
            return html`<div class="line ${state}">
              <ix-icon name=${state === 'missed' ? 'warning' : 'check'} size="16"></ix-icon>
              ${localizeDir(a.action.label)} —
              ${a.doneAtS === undefined
                ? localizeDir(MSG.exercise.missed)
                : html`${formatClock(a.doneAtS)}
                    (${a.withinTarget ? localizeDir(MSG.exercise.onTime) : localizeDir(MSG.exercise.late)})`}
            </div>`;
          })}
        </div>
      </div>
    `;
  }

  private start(scenario: Scenario): void {
    this.dispatchEvent(new CustomEvent<Scenario>('wui:start-exercise', { detail: scenario }));
  }

  private stop(): void {
    this.dispatchEvent(new CustomEvent('wui:stop-exercise'));
  }
}

function formatClock(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = Math.floor(totalS % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function exerciseStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      padding: 1rem;
    }
    .intro .hint,
    .hint {
      color: var(--theme-color-soft-text);
      max-width: 60rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
      gap: 1rem;
      margin-top: 0.6rem;
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.9rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      align-items: flex-start;
    }
    .description {
      color: var(--theme-color-soft-text);
      margin: 0;
    }
    .facts {
      color: var(--theme-color-weak-text);
      font-size: 0.8rem;
    }
    .running {
      border: 1px solid var(--theme-color-info);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.9rem;
    }
    .run-head {
      display: flex;
      align-items: center;
      gap: 0.8rem;
    }
    .run-title {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .run-title span {
      color: var(--theme-color-soft-text);
      font-variant-numeric: tabular-nums;
    }
    .checklist {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin-top: 0.6rem;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-soft-text);
    }
    .check.done {
      color: var(--theme-color-success);
      border-color: var(--theme-color-success);
    }
    .check .target {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
      font-size: 0.8rem;
    }
    .report {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      margin-top: 1rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.9rem;
    }
    .score {
      font-size: 2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      padding: 0.6rem 1rem;
      border-radius: var(--theme-default-border-radius);
    }
    .score.good {
      color: var(--theme-color-success);
      border: 2px solid var(--theme-color-success);
    }
    .score.mid {
      color: var(--theme-color-warning);
      border: 2px solid var(--theme-color-warning);
    }
    .score.bad {
      color: var(--theme-color-alarm);
      border: 2px solid var(--theme-color-alarm);
    }
    .line {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.2rem 0;
    }
    .line.ok {
      color: var(--theme-color-success);
    }
    .line.late {
      color: var(--theme-color-warning);
    }
    .line.missed {
      color: var(--theme-color-alarm);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-exercise': HdExercise;
  }
}
