/**
 * Modal dialog to create or edit one VNC connection: identity (name/group),
 * target (host/port), the optional stored password, a description and the RFB
 * options (read-only, shared). Emits `wui:save` / `wui:cancel`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  DEFAULT_CONNECT_TIMEOUT_SEC,
  DEFAULT_RECONNECT_DELAY_SEC,
  DEFAULT_VNC_PORT,
  blankConnection,
  type VncConnection
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string | number;
}

@customElement('rv-connection-dialog')
export class RvConnectionDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  /** Connection to edit; when null the dialog creates a new one. */
  @property({ attribute: false }) connection: VncConnection | null = null;

  @state() private working: VncConnection = blankConnection();
  @state() private showPassword = false;

  // eslint-disable-next-line max-lines-per-function -- single form template
  override render(): TemplateResult {
    const isNew = !this.connection;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${isNew ? 'Nouvelle connexion VNC' : `Édition — ${this.working.name}`}
            </ix-typography>
          </div>

          <div class="panel-body">
            <div class="grid2">
              ${this.textField('Nom', 'name')} ${this.textField('Groupe', 'group')}
            </div>
            <div class="grid2">
              ${this.textField('Hôte / IP', 'host')}
              <div class="field">
                <label>Port</label>
                <ix-number-input
                  .value=${this.working.port}
                  @valueChange=${(e: IxValueEvent) =>
                    this.patch({ port: Number(e.detail) || DEFAULT_VNC_PORT })}
                ></ix-number-input>
              </div>
            </div>

            <div class="field">
              <label>Mot de passe VNC (optionnel)</label>
              <div class="pw-row">
                <input
                  class="pw"
                  .type=${this.showPassword ? 'text' : 'password'}
                  autocomplete="off"
                  .value=${this.working.password}
                  @input=${(e: Event) => this.patch({ password: (e.target as HTMLInputElement).value })}
                />
                <ix-button
                  variant="secondary"
                  outline
                  @click=${() => (this.showPassword = !this.showPassword)}
                >
                  <ix-icon name="eye" slot="icon"></ix-icon>
                  ${this.showPassword ? 'Masquer' : 'Afficher'}
                </ix-button>
              </div>
              <div class="warn">
                <ix-icon name="warning"></ix-icon>Le mot de passe est enregistré en clair dans le
                datapoint. À réserver à un environnement de confiance.
              </div>
            </div>

            <div class="field">
              <label>Description</label>
              <ix-input
                .value=${this.working.description}
                @valueChange=${(e: IxValueEvent) => this.patch({ description: String(e.detail) })}
              ></ix-input>
            </div>

            <div class="subhead">Options de session</div>
            <div class="toggle-row">
              <span>Lecture seule (pas de clavier/souris vers le poste distant)</span>
              <ix-toggle
                hide-text
                ?checked=${this.working.viewOnly}
                @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ viewOnly: e.detail })}
              ></ix-toggle>
            </div>
            <div class="toggle-row">
              <span>Session partagée (ne pas déconnecter les autres clients)</span>
              <ix-toggle
                hide-text
                ?checked=${this.working.shared}
                @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ shared: e.detail })}
              ></ix-toggle>
            </div>

            <div class="subhead">Délai & reconnexion</div>
            <div class="toggle-row">
              <span>Reconnexion automatique après coupure ou délai dépassé</span>
              <ix-toggle
                hide-text
                ?checked=${this.working.autoReconnect}
                @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ autoReconnect: e.detail })}
              ></ix-toggle>
            </div>
            <div class="grid3">
              <div class="field">
                <label>Délai de connexion (s)</label>
                <ix-number-input
                  .value=${this.working.connectTimeoutSec}
                  @valueChange=${(e: IxValueEvent) =>
                    this.patch({ connectTimeoutSec: Number(e.detail) || DEFAULT_CONNECT_TIMEOUT_SEC })}
                ></ix-number-input>
              </div>
              <div class="field">
                <label>Délai entre tentatives (s)</label>
                <ix-number-input
                  .value=${this.working.reconnectDelaySec}
                  @valueChange=${(e: IxValueEvent) =>
                    this.patch({ reconnectDelaySec: Number(e.detail) || DEFAULT_RECONNECT_DELAY_SEC })}
                ></ix-number-input>
              </div>
              <div class="field">
                <label>Tentatives max (0 = illimité)</label>
                <ix-number-input
                  .value=${this.working.maxReconnectAttempts}
                  @valueChange=${(e: IxValueEvent) =>
                    this.patch({ maxReconnectAttempts: Math.max(0, Number(e.detail) || 0) })}
                ></ix-number-input>
              </div>
            </div>
          </div>

          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>Annuler</ix-button>
            <ix-button
              @click=${this.save}
              ?disabled=${this.working.name.trim() === '' || this.working.host.trim() === ''}
            >
              <ix-icon name="check" slot="icon"></ix-icon>Enregistrer
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('connection')) {
      // Spread over blankConnection() so records saved before the timeout /
      // reconnect fields existed are backfilled with the default values.
      this.working = this.connection
        ? { ...blankConnection(), ...structuredClone(this.connection) }
        : blankConnection();
      this.showPassword = false;
    }
  }

  private textField(label: string, key: 'name' | 'group' | 'host'): TemplateResult {
    return html`
      <div class="field">
        <label>${label}</label>
        <ix-input
          .value=${this.working[key]}
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ [key]: String(e.detail) } as Partial<VncConnection>)}
        ></ix-input>
      </div>
    `;
  }

  private patch(part: Partial<VncConnection>): void {
    this.working = { ...this.working, ...part };
  }

  private save(): void {
    if (this.working.name.trim() === '' || this.working.host.trim() === '') return;
    this.dispatchEvent(
      new CustomEvent('wui:save', { detail: this.working, bubbles: true, composed: true })
    );
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .pw-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .pw {
      flex: 1;
      box-sizing: border-box;
      padding: 0.4rem 0.5rem;
      color: var(--theme-color-std-text);
      background: var(--theme-color-component-1, var(--theme-color-1));
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      font-family: inherit;
      font-size: 0.9rem;
    }
    .warn {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.35rem;
      font-size: 0.78rem;
      color: var(--theme-color-warning);
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0.4rem 0;
      font-size: 0.9rem;
    }
  `;
}
