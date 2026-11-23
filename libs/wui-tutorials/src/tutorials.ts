// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tutorials (#/tutorials): the deployed modules' tutorials, the badges earned, and the start of
 * a tutorial. The tutorial itself is played by the guide (`<wui-tutorials-guide>`, ./guide/),
 * put on the page by the module's boot script — or by this page under `wui dev`, whose harness
 * runs no boot script.
 *
 * The list is data/dashboard-wc/wui-tutorials.json, written by `wui build` for the selected
 * modules (wui-toolkit 0.30.0 or later): each one brings its `tutorial/<id>.json`.
 *
 * Grouped by module, each group titled by the module's menu title (wui-modules.json, written
 * beside it by every build), else its Application Security title, else its id.
 *
 * Roles: a tutorial with `roles` is played by a user who holds one of them (wui-kit `hasRole$`:
 * a role no group is assigned to is open, so nothing is forbidden until an admin restricts it);
 * otherwise its card stays in the list, greyed, saying the role it needs — the operator knows
 * whom to ask. The roles' labels come from app-security-manifest.json, written beside it.
 * Without the app-security backend (`wuiPage.optional`), every tutorial can be played.
 */
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { hasRole$ } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Subscription, combineLatest, map } from 'rxjs';
import { tutorEngine } from './guide/engine.js';
import { installGuide } from './guide/guide-overlay.js';
import './guide/mascot.js';
import { text, type Text, type Tutorial } from './guide/tutorial.js';
import { allowed, groupByModule } from './catalog.js';
import { MSG, fill } from './i18n.js';

/** A module of wui-modules.json, as far as this page reads it. */
interface DeployedModule {
  id: string;
  title: Text | null;
}

/** A declaration of app-security-manifest.json, as far as this page reads it. */
interface RoleDeclaration {
  module: string;
  title: Text;
  roles: { id: string; label: Text }[];
}

@customElement('wui-tutorials')
export class WuiTutorials extends LitElement {
  static override readonly styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.875rem;
      background: var(--theme-color-2);
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .brand {
      font-size: 1rem;
      font-weight: 700;
      color: var(--theme-color-primary);
    }
    .brand small {
      font-weight: 400;
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
      margin-left: 0.375rem;
    }
    .score {
      margin-left: auto;
      font-size: 0.8125rem;
      color: var(--theme-color-soft-text);
    }
    .body {
      flex: 1;
      overflow: auto;
      padding: 1.375rem;
    }
    .intro {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }
    .intro p {
      margin: 0;
      max-width: 40rem;
      padding: 0.75rem 1rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 8px;
      line-height: 1.45;
    }
    .group + .group {
      margin-top: 1.5rem;
    }
    .group h2 {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin: 0 0 0.75rem;
      font-size: 0.9375rem;
      font-weight: 700;
    }
    .group h2 small {
      font-weight: 400;
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .tuto-cards {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .card {
      width: 270px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 6px;
    }
    .card.done {
      border-color: var(--theme-color-success);
    }
    .card.locked {
      opacity: 0.55;
      border-style: dashed;
    }
    .card.locked .roles {
      color: var(--theme-color-std-text);
      font-weight: 600;
    }
    .card h3 {
      margin: 0;
      font-size: 0.9375rem;
    }
    .card p {
      flex: 1;
      margin: 0;
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
      line-height: 1.45;
    }
    .roles {
      font-size: 0.75rem;
      color: var(--theme-color-weak-text);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .badge {
      padding: 1px 8px;
      border-radius: 999px;
      border: 1px solid var(--theme-color-success);
      color: var(--theme-color-success);
      font-weight: 600;
    }
    .badge.todo {
      border-color: var(--theme-color-soft-bdr);
      color: var(--theme-color-weak-text);
      font-weight: 400;
    }
    .reset {
      margin-top: 1.5rem;
    }
  `;

  /** Each module's title, page id → text. */
  @state() private moduleTitles = new Map<string, string>();
  /** Each role's label, `<module>/<role>` → text. */
  @state() private roleLabels = new Map<string, string>();
  /** The roles the user holds, `<module>/<role>` → granted; a role not known yet counts as granted. */
  @state() private granted = new Map<string, boolean>();

  private readonly subscription = new Subscription();
  private watchedRoles = '';
  private readonly onChange = () => {
    this.watchRoles();
    this.requestUpdate();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    installGuide();
    tutorEngine.addEventListener('change', this.onChange);
    this.watchRoles();
    void fetch('/data/dashboard-wc/app-security-manifest.json')
      .then((response) => (response.ok ? (response.json() as Promise<RoleDeclaration[]>) : []))
      .then((declarations) => {
        this.roleLabels = new Map(
          declarations.flatMap((declaration) => declaration.roles.map((role) => [`${declaration.module}/${role.id}`, `${text(role.label)} — ${text(declaration.title)}`] as const))
        );
        // A module without a menu title (headless) is named by its roles' title.
        const titles = new Map(this.moduleTitles);
        for (const declaration of declarations) if (!titles.has(declaration.module)) titles.set(declaration.module, text(declaration.title));
        this.moduleTitles = titles;
      })
      .catch(() => undefined);
    void fetch('/data/dashboard-wc/wui-modules.json', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ modules?: DeployedModule[] }>) : { modules: [] }))
      .then((manifest) => {
        // The menu title wins over the roles' title.
        const titles = new Map(this.moduleTitles);
        for (const module of manifest.modules ?? []) if (module.title) titles.set(module.id, text(module.title));
        this.moduleTitles = titles;
      })
      .catch(() => undefined);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    tutorEngine.removeEventListener('change', this.onChange);
    this.subscription.unsubscribe();
  }

  /** Follows the roles the tutorials name, once the list is loaded. */
  private watchRoles(): void {
    const roles = [...new Set(tutorEngine.tutorials.flatMap((tutorial) => tutorial.roles ?? []))].filter((role) => role.includes('/'));
    const key = roles.join(',');
    if (key === this.watchedRoles || roles.length === 0) return;
    this.watchedRoles = key;
    this.subscription.add(
      combineLatest(
        roles.map((role) => {
          const [module, id] = role.split('/');
          return hasRole$(module, id).pipe(map((ok) => [role, ok] as const));
        })
      ).subscribe((entries) => (this.granted = new Map(entries)))
    );
  }

  override render() {
    const progress = tutorEngine.progress;
    const tutorials = tutorEngine.tutorials;
    // The badges count the tutorials this user may play: a locked one is no badge to earn.
    const playable = tutorials.filter((tutorial) => allowed(tutorial, this.granted));
    const earned = playable.filter((tutorial) => progress[tutorial.id]).length;
    return html`
      <div class="topbar">
        <span class="brand">${localize(MSG.title)}<small>${localize(MSG.subtitle)}</small></span>
        ${playable.length ? html`<span class="score">🏅 ${fill(String(localize(MSG.badges)), { n: earned, t: playable.length })}</span>` : nothing}
      </div>
      <div class="body">
        <div class="intro">
          <wui-tutorials-mascot mood=${!tutorEngine.loaded ? 'think' : earned ? 'idle' : 'happy'}></wui-tutorials-mascot>
          <p>${this.greeting(tutorials.length, playable.length, earned)}</p>
        </div>
        ${groupByModule(tutorials).map(
          (group) => html`<section class="group">
            <h2>${this.moduleTitles.get(group.module) ?? group.module}<small>${fill(String(localize(MSG.tutorialCount)), { n: group.tutorials.length })}</small></h2>
            <div class="tuto-cards">${group.tutorials.map((tutorial) => this.renderCard(tutorial, Boolean(progress[tutorial.id])))}</div>
          </section>`
        )}
        ${earned ? html`<ix-button class="reset" variant="tertiary" @click=${() => tutorEngine.resetProgress()}>${localize(MSG.reset)}</ix-button>` : nothing}
      </div>
    `;
  }

  private greeting(total: number, playable: number, earned: number): string {
    if (!tutorEngine.loaded) return String(localize(MSG.loading));
    if (total === 0) return String(localize(MSG.none));
    if (earned === 0) return String(localize(MSG.hello));
    if (earned < playable) return fill(String(localize(MSG.welcomeBack)), { n: playable - earned });
    return String(localize(MSG.allEarned));
  }

  private renderCard(tutorial: Tutorial, done: boolean) {
    const running = tutorEngine.tutorial?.id === tutorial.id && (tutorEngine.phase === 'step' || tutorEngine.phase === 'success');
    const badge = text(tutorial.badge);
    const roles = (tutorial.roles ?? []).map((role) => this.roleLabels.get(role) ?? role);
    const playable = allowed(tutorial, this.granted);
    return html`
      <div class="card ${done ? 'done' : ''} ${playable ? '' : 'locked'}" aria-disabled=${playable ? 'false' : 'true'}>
        <h3>${text(tutorial.title)}</h3>
        <p>${text(tutorial.summary)}</p>
        ${roles.length
          ? html`<div class="roles" title=${localize(playable ? MSG.forRolesTitle : MSG.lockedTitle)}>
              ${playable ? '' : '🔒 '}${fill(String(localize(playable ? MSG.forRoles : MSG.requires)), { s: roles.join(' · ') })}
            </div>`
          : nothing}
        <div class="meta">
          <span>${tutorial.minutes ? `⏱ ${tutorial.minutes} min · ` : ''}${fill(String(localize(MSG.steps)), { n: tutorial.steps.length })}</span>
          ${badge ? html`<span class="badge ${done ? '' : 'todo'}">${done ? '🏅' : '🔒'} ${badge}</span>` : nothing}
        </div>
        <ix-button
          variant=${done ? 'secondary' : 'primary'}
          ?disabled=${!playable}
          title=${playable ? '' : localize(MSG.lockedTitle)}
          @click=${() => playable && tutorEngine.start(tutorial.id)}
        >
          ${localize(running ? MSG.restart : done ? MSG.again : MSG.start)}
        </ix-button>
      </div>
    `;
  }
}
