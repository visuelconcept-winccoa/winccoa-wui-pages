// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Alarms — Standalone page (WinCC OA WebUI Runtime).
 *
 * The plant's alarm list: the standing alarms live, or the alarm archive over a
 * period, with the unacknowledged counter, the P1–P4 bands as a filter, the
 * EEMUA-191 flood histogram, the recurring bad actors, a free-text search,
 * click-to-sort headers, paging and acknowledge.
 *
 * The page is deliberately THIN: everything above is the shared
 * `<wui-alarm-view>` of {@link @visuelconcept/wui-alarms-core}, which the Machine
 * Fleet machine dashboard embeds in its panel form. The page adds only what is
 * page-level — the content header, the Application-Security gate, and the
 * datapoint scope taken from the URL so a link can open the list on one machine
 * (`#/alarms?dp=System1:Press01`). That scope is **pushed in by the router**
 * ({@link WuiAlarms.onBeforeEnter}) rather than pulled while rendering; the comment there
 * says what pulling it cost.
 *
 * Registered at `/alarms` (component `wui-alarms`).
 */
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import { MSG, localizeDir } from '@visuelconcept/wui-alarms-core/i18n.js';
import { parseScopeAttribute, scopeFromSearch } from '@visuelconcept/wui-alarms-core/scope.js';
import '@visuelconcept/wui-alarms-core/ui/wui-alarm-view.js';
import '@visuelconcept/wui-alarms-core/ui/wui-alarm-ranges.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { WuiRouterServiceToken } from '@wincc-oa/wui-shared/tokens/wui-router-service.token.js';
import type { WuiRouterFacade } from '@wincc-oa/wui-models/interfaces/wui-router/wui-router.facade.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import appSecurityRoles from './app-security.roles.json';

/** Application-Security module id (= the page id). */
const MODULE_ID = 'alarms';

@customElement('wui-alarms')
export class WuiAlarms extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  /**
   * Datapoint scope, comma separated — the router hands it over as an attribute
   * when the route carries one, and a host page can set it directly.
   */
  @property() dp = '';

  /** Application-Security grant for the 'view' role (open until assigned). */
  @state() private roleView = true;

  /** Application-Security grant for the 'acknowledge' role (open until assigned). */
  @state() private roleAck = true;

  /** Application-Security grant for the 'configure' role (open until assigned). */
  @state() private roleConfigure = true;

  @state() private rangesOpen = false;

  /**
   * The `search` of the route as the ROUTER handed it over; `null` until it does.
   *
   * Reactive state rather than something read during render, because the router **pushes**
   * the resolved location into its route target and does it twice over: once before the
   * first paint ({@link onBeforeEnter}), and again when only the query string changes — see
   * the comment there for what pulling it instead cost.
   */
  @state() private routeSearch: string | null = null;

  private roleSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles (docs/wui-app-security/INTEGRATION.md).
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$(MODULE_ID, 'view').subscribe((granted) => (this.roleView = granted));
    this.roleSub.add(hasRole$(MODULE_ID, 'acknowledge').subscribe((granted) => (this.roleAck = granted)));
    this.roleSub.add(
      hasRole$(MODULE_ID, 'configure').subscribe((granted) => {
        this.roleConfigure = granted;
        // Close an editor opened before the grant was revoked.
        if (!granted) this.rangesOpen = false;
      })
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
  }

  /**
   * Vaadin Router's entry hook on a route target: where the `?dp=` scope comes from.
   *
   * Taking it from the router facade during `render()` instead was wrong twice over, and both
   * failures look like "it needs a reload":
   *
   * - it is a **pull from a global the router assigns late** in its navigation cycle, wrapped
   *   in a `try`/`catch` that degrades silently to "no scope" — so whether the first paint
   *   sees the scope depends on what else happened to be loaded first;
   * - and when only the query string changes — a second asset's drill-down, `?dp=A` → `?dp=B`
   *   — the router **reuses this very element** instead of building a new one (its
   *   `__skipAttach` path), so nothing would pull again and the list would keep the first
   *   scope for good.
   *
   * A pushed value held as reactive state has neither problem. Typed structurally, so the
   * page keeps no dependency on `@vaadin/router`: `search` is all it needs.
   */
  onBeforeEnter(location: { readonly search?: string }): void {
    this.routeSearch = location.search ?? '';
  }

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: { context: 'translate', config: MSG.view.title },
          headerSubtitle: { context: 'translate', config: MSG.view.help }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      <div class="body">
        ${this.roleView
          ? html`${this.renderConfigBar()}
              <wui-alarm-view .scope=${this.scope()} .noAck=${!this.roleAck}></wui-alarm-view>`
          : html`<div class="center">${localizeDir(MSG.view.forbidden)}</div>`}
      </div>
      ${this.rangesOpen
        ? html`<wui-alarm-ranges
            ?can-edit=${this.roleConfigure}
            @wui:close=${() => (this.rangesOpen = false)}
          ></wui-alarm-ranges>`
        : nothing}
    `;
  }

  /**
   * The page-level action bar. The range editor lives HERE and not in the view:
   * the view is embedded in other pages (a machine dashboard tile), and a project
   * setting must not be editable from every tile that happens to show alarms.
   */
  private renderConfigBar(): TemplateResult | typeof nothing {
    if (!this.roleConfigure) return nothing;
    return html`
      <div class="actions">
        <ix-button variant="secondary" @click=${() => (this.rangesOpen = true)}>
          <ix-icon name="cogwheel" slot="icon"></ix-icon>${localizeDir(MSG.ranges.open)}
        </ix-button>
      </div>
    `;
  }

  /**
   * The datapoint scope: the `dp` attribute, else the `dp` query parameter.
   *
   * `null` (not an empty array) when nothing is given, so the view reads the
   * whole system instead of showing nothing.
   */
  private scope(): readonly string[] | null {
    const fromAttribute = parseScopeAttribute(this.dp);
    if (fromAttribute.length > 0) return fromAttribute;
    const parameter = this.routerScope();
    return parameter.length > 0 ? parameter : null;
  }

  /**
   * The scope the route carries: what the router pushed in, else — for a host that renders
   * this page outside the router, where {@link onBeforeEnter} never fires — whatever the
   * facade can tell us.
   */
  private routerScope(): readonly string[] {
    if (this.routeSearch !== null) return scopeFromSearch(this.routeSearch);
    try {
      const router = container.resolve<WuiRouterFacade>(WuiRouterServiceToken);
      return parseScopeAttribute(router.getSearchParam('dp') ?? '');
    } catch {
      // No router in the container (embedded / test host) — the attribute rules.
      return [];
    }
  }
}

function pageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      color: var(--theme-color-std-text);
    }
    .body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      padding: 1rem;
      box-sizing: border-box;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 0.5rem;
    }
    .center {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      color: var(--theme-color-soft-text);
    }
  `;
}
