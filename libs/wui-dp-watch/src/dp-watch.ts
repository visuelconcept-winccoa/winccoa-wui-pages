// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DP Watch — standalone page (WinCC OA WebUI Runtime) AND embeddable element.
 *
 * Lists every datapoint element matching `pattern` (dpNames) with its live value
 * (one dpConnect over the whole list). Read-only: nothing here is worth an
 * Application-Security role. Another page can embed it:
 *   <wui-dp-watch pattern="Line1_*" heading="Ligne 1"></wui-dp-watch>
 *
 * Its `mock/fixtures.json` feeds `wui dev` (wui-toolkit) with a few ExampleDP_*
 * elements, so the page runs without WinCC OA out of the box.
 */
import { OaRxJsApi, type DpConnectData } from '@etm-professional-control/oa-rx-js-api';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription, of, switchMap } from 'rxjs';
import { container } from 'tsyringe';
import { localize, ml } from '@visuelconcept/wui-kit/i18n.js';

const MSG = {
  title: ml('DP Watch', 'Surveillance DP', 'DP-Beobachtung'),
  pattern: ml('Pattern', 'Motif', 'Muster'),
  element: ml('Datapoint element', 'Élément de datapoint', 'Datenpunktelement'),
  value: ml('Value', 'Valeur', 'Wert'),
  empty: ml('No datapoint matches', 'Aucun datapoint ne correspond', 'Kein passender Datenpunkt')
};

interface IxValueEvent {
  detail: string;
}

@customElement('wui-dp-watch')
export class WuiDpWatch extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      padding: 1rem;
    }
    header {
      display: flex;
      align-items: end;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    h1 {
      flex: 1;
      margin: 0;
      font-size: 1.25rem;
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
    td.value {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  `;

  /** dpNames pattern; the page shows an input to change it. */
  @property() pattern = '*';
  /** Title override for an embedded instance. */
  @property() heading = '';

  @state() private rows: { dp: string; value: unknown }[] = [];

  private readonly api = container.resolve(OaRxJsApi);
  private subscription = new Subscription();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subscription.unsubscribe();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('pattern')) this.watch();
  }

  override render(): TemplateResult {
    return html`
      <header>
        <h1>${this.heading || localize(MSG.title)}</h1>
        <ix-input
          label=${localize(MSG.pattern)}
          .value=${this.pattern}
          @valueChange=${(event: IxValueEvent) => (this.pattern = event.detail || '*')}
        ></ix-input>
      </header>
      <table>
        <thead>
          <tr>
            <th>${localize(MSG.element)}</th>
            <th>${localize(MSG.value)}</th>
          </tr>
        </thead>
        <tbody>
          ${this.rows.length === 0
            ? html`<tr><td colspan="2">${localize(MSG.empty)}</td></tr>`
            : this.rows.map((row) => html`<tr><td>${row.dp}</td><td class="value">${row.value}</td></tr>`)}
        </tbody>
      </table>
    `;
  }

  private watch(): void {
    this.subscription.unsubscribe();
    this.rows = [];
    this.subscription = this.api
      .dpNames(this.pattern, '')
      .pipe(
        switchMap((names) =>
          names.length > 0 ? this.api.dpConnect(names, true) : of<DpConnectData>({ dp: [], value: [] })
        )
      )
      .subscribe((data: DpConnectData) => {
        this.rows = data.dp.map((dp, index) => ({ dp, value: data.value[index] }));
      });
  }
}
