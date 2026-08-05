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
 * (`#/alarms?dp=System1:Press01`).
 *
 * Registered at `/alarms` (component `wui-alarms`).
 */
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import { MSG, localizeDir } from '@visuelconcept/wui-alarms-core/i18n.js';
import { parseScopeAttribute } from '@visuelconcept/wui-alarms-core/scope.js';
import '@visuelconcept/wui-alarms-core/ui/wui-alarm-view.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { WuiRouterServiceToken } from '@wincc-oa/wui-shared/tokens/wui-router-service.token.js';
import type { WuiRouterFacade } from '@wincc-oa/wui-models/interfaces/wui-router/wui-router.facade.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
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

  private roleSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles (docs/wui-app-security/INTEGRATION.md).
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$(MODULE_ID, 'view').subscribe((granted) => (this.roleView = granted));
    this.roleSub.add(hasRole$(MODULE_ID, 'acknowledge').subscribe((granted) => (this.roleAck = granted)));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
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
          ? html`<wui-alarm-view .scope=${this.scope()} .noAck=${!this.roleAck}></wui-alarm-view>`
          : html`<div class="center">${localizeDir(MSG.view.forbidden)}</div>`}
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

  private routerScope(): readonly string[] {
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
    .center {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      color: var(--theme-color-soft-text);
    }
  `;
}
