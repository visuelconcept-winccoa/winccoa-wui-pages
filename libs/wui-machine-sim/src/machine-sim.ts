// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Machine Sim — status page of the optional production simulator
 * (WinCC OA WebUI Runtime), registered hidden at `/machine-sim`.
 *
 * The module exists for its `machineSim` manager (managers/machineSim/), which
 * creates and drives one `MachineSim_<machine>` datapoint per Machine Fleet 3D
 * atelier machine. A module needs a page to be selected and deployed, so this
 * one stays small and read-only: the warning that the simulator is not for
 * production, how AUTO_MAP is turned on, and the simulated machines with their
 * live state and communication bit (dpNames + one dpConnect). It writes nothing.
 */
import { OaRxJsApi, type DpConnectData } from '@etm-professional-control/oa-rx-js-api';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Subscription, of, switchMap } from 'rxjs';
import { container } from 'tsyringe';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import { MSG, localize, localizeDir } from './machine-sim/i18n.js';

/** The state element of every simulated machine; `.comm` sits beside it. */
const STATE_PATTERN = 'MachineSim_*.state';

interface SimRow {
  dp: string;
  state: unknown;
  comm: unknown;
}

/** `System1:MachineSim_four1.state` → `MachineSim_four1`. */
function machineDp(stateDpe: string): string {
  const bare = stateDpe.includes(':') ? stateDpe.slice(stateDpe.indexOf(':') + 1) : stateDpe;
  return bare.replace(/\.state.*$/, '');
}

@customElement('wui-machine-sim')
export class WuiMachineSim extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1rem;
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: 0.5rem;
        text-align: left;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
      }
      .muted {
        color: var(--theme-color-soft-text);
      }
    `
  ];

  @state() private rows: SimRow[] = [];
  @state() private loaded = false;
  @state() private failed = false;
  /** Application-Security grant for the 'view' role (open until assigned). */
  @state() private canView = true;

  private readonly api = this.resolveApi();
  private roleSub = new Subscription();
  private dataSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$('machine-sim', 'view').subscribe((granted) => {
      this.canView = granted;
    });
    this.watch();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
    this.dataSub.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: MSG.title
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      <div class="body">
        ${this.canView
          ? html`
              <ix-message-bar type="warning" persistent>${localizeDir(MSG.warning)}</ix-message-bar>
              <ix-typography format="body">${localizeDir(MSG.autoMap)}</ix-typography>
              ${this.renderMachines()}
            `
          : html`<div class="muted">${localizeDir(MSG.roleForbidden)}</div>`}
      </div>
    `;
  }

  private renderMachines(): TemplateResult {
    if (this.failed) return html`<div class="muted">${localizeDir(MSG.unavailable)}</div>`;
    if (!this.loaded) return html``;
    if (this.rows.length === 0) return html`<div class="muted">${localizeDir(MSG.none)}</div>`;
    return html`
      <ix-typography format="label">${this.rows.length} ${localizeDir(MSG.count)}</ix-typography>
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.datapoint)}</th>
            <th>${localizeDir(MSG.state)}</th>
            <th>${localizeDir(MSG.comm)}</th>
          </tr>
        </thead>
        <tbody>
          ${this.rows.map(
            (row) => html`<tr>
              <td>${row.dp}</td>
              <td>${this.stateLabel(row.state)}</td>
              <td>${row.comm == null ? '' : localize(row.comm === true ? MSG.commOk : MSG.commLost)}</td>
            </tr>`
          )}
        </tbody>
      </table>
    `;
  }

  private stateLabel(value: unknown): string {
    if (value == null) return '';
    const label = MSG.states[Number(value)];
    return label ? localize(label) : String(value);
  }

  private watch(): void {
    this.dataSub.unsubscribe();
    const api = this.api;
    if (!api) {
      this.failed = true;
      return;
    }
    this.dataSub = api
      .dpNames(STATE_PATTERN, '')
      .pipe(
        switchMap((names) => {
          const states = [...new Set(names as string[])].sort();
          this.rows = states.map((name) => ({ dp: machineDp(name), state: null, comm: null }));
          this.loaded = true;
          if (states.length === 0) return of<DpConnectData>({ dp: [], value: [] });
          const dpes = states.flatMap((name) => [name, name.replace(/\.state(.*)$/, '.comm$1')]);
          return api.dpConnect(dpes, true);
        })
      )
      .subscribe({
        next: (data: DpConnectData) => this.apply(data),
        error: () => {
          this.failed = true;
        }
      });
  }

  private apply(data: DpConnectData): void {
    if (data.dp.length === 0) return;
    const byDp = new Map(this.rows.map((row) => [row.dp, { ...row }]));
    for (const [i, dpe] of data.dp.entries()) {
      const row = byDp.get(machineDp(dpe.replace(/\.comm/, '.state')));
      if (!row) continue;
      if (/\.state/.test(dpe)) row.state = data.value[i];
      else row.comm = data.value[i];
    }
    this.rows = [...byDp.values()];
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}
