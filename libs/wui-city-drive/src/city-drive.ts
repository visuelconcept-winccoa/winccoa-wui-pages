// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * City Drive — standalone page (WinCC OA WebUI Runtime), #79.
 *
 * A driving game in a neon city whose plant is bound to datapoints: the machines' halls glow in
 * the colour of their state, a machine in fault calls for an intervention mission, a datapoint
 * can force a crossroads red; the player's telemetry is written to `CityDrive_Player_<user>`.
 *
 * - start screen: nickname, vehicle (coupé / pickup / van) and neon colour (iX theme colours);
 *   kept in the browser and written to the player's datapoint;
 * - game: three.js + bloom (city-drive/world.ts), driven by city-drive/game.ts; HUD in iX;
 * - datapoints: city-drive/dp-link.ts only; demo mode without a backend (`npx wui dev`).
 *
 * Roles (Application Security): `play` (the page) and `configure` (CityDrive_Config, edited in
 * PARA in V1 — the role is declared so an admin can already restrict it). Registered at
 * `/city-drive` (component `wui-city-drive`). Three.js is bundled into this page.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import type { MachineState } from './city-drive/bindings.js';
import { DriveLink, ONLINE_MS, type LinkState, type RemotePlayer } from './city-drive/dp-link.js';
import { CityGame, type GameEvent, type HudState } from './city-drive/game.js';
import { MSG } from './city-drive/i18n.js';
import { drawMinimap } from './city-drive/minimap.js';
import { readPalette, type NeonPalette } from './city-drive/palette.js';
import { TelemetryThrottle } from './city-drive/telemetry.js';
import { NEON_COLORS, NICKNAME_MAX, type NeonColor, VEHICLES, cleanNickname, parseProfile, vehicleById, type Profile } from './city-drive/vehicles.js';

const MODULE_ID = 'city-drive';
const PROFILE_KEY = 'wui-city-drive.profile';
const TELEMETRY_MS = 250;
const EVENT_SHOW_MS = 2500;
const MINIMAP_PX = 180;

function loadProfile(): Profile {
  try {
    return parseProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}'));
  } catch {
    return parseProfile({});
  }
}

function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // private window: the profile lives for this visit only
  }
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const bars = (n: number): TemplateResult => html`<span class="bars">${[1, 2, 3, 4, 5].map((k) => html`<i class=${k <= n ? 'on' : ''}></i>`)}</span>`;

@customElement('wui-city-drive')
export class WuiCityDrive extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private rolePlay = true;
  @state() private started = false;
  @state() private profile: Profile = loadProfile();
  @state() private hud: HudState | null = null;
  @state() private eventText = '';
  @state() private demo = false;
  @state() private telemetryOn = false;
  @state() private remotes: RemotePlayer[] = [];

  @query('.stage') private stage!: HTMLElement;
  @query('canvas.minimap') private minimap?: HTMLCanvasElement;

  private game: CityGame | null = null;
  private palette: NeonPalette | null = null;
  private readonly link = new DriveLink();
  private readonly throttle = new TelemetryThrottle();
  private machines = new Map<string, MachineState>();
  private roleSub = new Subscription();
  private telemetryTimer = 0;
  private eventTimer = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$(MODULE_ID, 'play').subscribe((granted) => {
      this.rolePlay = granted;
      if (!granted) this.game?.setPaused(true);
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
    window.clearInterval(this.telemetryTimer);
    window.clearTimeout(this.eventTimer);
    this.link.close();
    this.game?.stop();
    this.game = null;
  }

  protected override firstUpdated(): void {
    if (this.rolePlay) void this.boot();
  }

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{ headerTitle: { context: 'translate', config: { 'en_US.utf8': 'City Drive', 'fr.utf8': 'City Drive', 'de.utf8': 'City Drive' } } }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      ${this.rolePlay
        ? html`<div class="stage" @click=${() => this.stage.focus()}></div>
            ${this.started ? this.renderHud() : this.renderSetup()}`
        : html`<div class="center muted">${MSG.hud.roleForbidden}</div>`}
    `;
  }

  // --- start screen ---------------------------------------------------------------

  private renderSetup(): TemplateResult {
    const p = this.palette;
    return html`<div class="overlay">
      <div class="setup">
        ${this.renderBanner(false)}
        <ix-input
          label="Nickname"
          maxlength=${NICKNAME_MAX}
          .value=${this.profile.nickname}
          @valueChange=${(e: CustomEvent<string>) => (this.profile = { ...this.profile, nickname: cleanNickname(e.detail ?? '') })}
        ></ix-input>
        <div class="label">${'Vehicle'}</div>
        <div class="vehicles">
          ${VEHICLES.map(
            (v) => html`<ix-card
              class="vehicle"
              variant="outline"
              ?selected=${this.profile.vehicle === v.id}
              @click=${() => this.pickVehicle(v.id)}
            >
              <ix-card-content>
                <ix-typography format="label-lg">${v.label}</ix-typography>
                <div class="stat"><span>${'Speed'}</span>${bars(v.rating.speed)}</div>
                <div class="stat"><span>${'Handling'}</span>${bars(v.rating.handling)}</div>
                <div class="stat"><span>${'Range'}</span>${bars(v.rating.range)}</div>
              </ix-card-content>
            </ix-card>`
          )}
        </div>
        <div class="label">${'Neon'}</div>
        <div class="colors">
          ${p
            ? NEON_COLORS.map(
                (c) => html`<button
                  class="swatch ${this.profile.color === c ? 'on' : ''}"
                  style="--c:${hex(p[c])}"
                  title=${c}
                  aria-pressed=${this.profile.color === c}
                  @click=${() => this.pickColor(c)}
                ></button>`
              )
            : nothing}
        </div>
        <div class="label">${MSG.hud.time}</div>
        <div class="times">
          ${(['night', 'day'] as const).map(
            (tm) => html`<ix-button
              variant=${this.profile.time === tm ? 'primary' : 'secondary'}
              icon=${tm === 'day' ? 'sun' : 'moon'}
              @click=${() => this.pickTime(tm)}
              >${tm === 'day' ? MSG.hud.day : MSG.hud.night}</ix-button
            >`
          )}
        </div>
        <ix-button class="go" ?disabled=${!this.game} @click=${() => this.startGame()}>
          ${'Drive'}
        </ix-button>
        <div class="keys">${MSG.hud.keys}</div>
      </div>
    </div>`;
  }

  private pickVehicle(id: Profile['vehicle']): void {
    this.profile = { ...this.profile, vehicle: id };
    this.game?.setProfile(this.profile);
  }

  private pickTime(time: Profile['time']): void {
    this.profile = { ...this.profile, time };
    this.game?.setProfile(this.profile);
    saveProfile(this.profile);
  }

  private pickColor(color: Profile['color']): void {
    this.profile = { ...this.profile, color };
    this.game?.setProfile(this.profile);
  }

  // --- HUD ----------------------------------------------------------------------------

  private renderHud(): TemplateResult {
    const h = this.hud;
    const m = h?.mission;
    const active = m && ['pickup', 'drop', 'reach'].includes(m.stage);
    const fuel = Math.round((h?.fuel ?? 1) * 100);
    return html`
      <div class="hud top-left">
        <div class="player">${this.profile.nickname || '—'} · ${vehicleById(this.profile.vehicle).label}</div>
        <div class="score"><span>${MSG.hud.score}</span> <strong>${h?.score ?? 0}</strong></div>
        ${active
          ? html`<div class="mission ${m.kind}">
              <ix-icon name=${m.kind === 'intervention' ? 'maintenance' : 'package'}></ix-icon>
              <div>
                <div class="m-title">${MSG.mission[m.kind]}</div>
                <div>${MSG.mission[m.stage as 'pickup' | 'drop' | 'reach']}</div>
              </div>
              ${Number.isFinite(m.timeLeft) ? html`<div class="timer">${Math.ceil(m.timeLeft)} s</div>` : nothing}
            </div>`
          : html`<ix-button variant="secondary" icon="add" @click=${() => this.act(() => this.game?.newMission())}>${MSG.hud.newMission}</ix-button>`}
        ${!this.demo ? html`<ix-pill variant=${this.telemetryOn ? 'success' : 'neutral'} outline>${this.telemetryOn ? MSG.hud.telemetry : MSG.hud.noTelemetry}</ix-pill>` : nothing}
      </div>
      <div class="hud top-right">
        <canvas class="minimap" width=${MINIMAP_PX} height=${MINIMAP_PX}></canvas>
        <div class="tools">
          <ix-icon-button ghost icon=${h?.paused ? 'play' : 'pause'} title=${h?.paused ? MSG.hud.resume : MSG.hud.pause} @click=${() => this.act(() => this.game?.setPaused(!h?.paused))}></ix-icon-button>
          <ix-icon-button
            ghost
            icon=${this.profile.time === 'day' ? 'moon' : 'sun'}
            title=${this.profile.time === 'day' ? MSG.hud.night : MSG.hud.day}
            @click=${() => this.act(() => this.game?.toggleTimeOfDay())}
          ></ix-icon-button>
          <ix-icon-button ghost icon="eye" title=${MSG.hud.camera} @click=${() => this.act(() => this.game?.toggleCamera())}></ix-icon-button>
          <ix-icon-button ghost icon="refresh" title=${MSG.hud.reset} @click=${() => this.act(() => this.game?.resetCar())}></ix-icon-button>
        </div>
        ${this.renderPlayers()}
      </div>
      <div class="hud bottom-left">
        <div class="speed"><strong>${h?.speed ?? 0}</strong><span>${MSG.hud.speed}</span></div>
        <ix-progress-indicator
          class="fuel"
          label=${MSG.hud.fuel}
          .value=${fuel}
          status=${fuel < 15 ? 'error' : fuel < 35 ? 'warning' : 'default'}
        ></ix-progress-indicator>
      </div>
      ${this.renderBanner(true)}
      ${this.eventText ? html`<div class="toast">${this.eventText}</div>` : nothing}
      ${h?.paused
        ? html`<div class="overlay">
            <div class="setup small">
              <ix-typography format="h3">${MSG.hud.paused}</ix-typography>
              <div class="keys">${MSG.hud.keys}</div>
              <ix-button @click=${() => this.act(() => this.game?.setPaused(false))}>${MSG.hud.resume}</ix-button>
            </div>
          </div>`
        : nothing}
    `;
  }

  /** The title banner: big on the start screen, compact at the top of the game. */
  private renderBanner(compact: boolean): TemplateResult {
    return html`<div class="banner ${compact ? 'compact' : ''}">
      <div class="kicker"><span class="bar"></span>${MSG.banner.kicker}<span class="bar"></span></div>
      <div class="headline">${MSG.banner.title}</div>
      ${compact ? nothing : html`<div class="tagline">${MSG.banner.tagline}</div>`}
    </div>`;
  }

  /** Multiplayer panel: one's own datapoint (written) and the other players' (dpConnect). */
  private renderPlayers(): TemplateResult {
    const p = this.palette;
    const now = Date.now();
    const online = this.remotes.filter((r) => now - r.updatedAt < ONLINE_MS);
    const color = (c: string): string => hex(p ? (p[c as NeonColor] ?? p.info) : 0x00bde3);
    const ago = (ms: number): string => {
      const s = Math.max(0, Math.round((now - ms) / 1000));
      return s < 2 ? 'live' : `${s} s`;
    };
    const own = this.demo ? 'CityDrive_Player_—' : this.link.player || '—';
    return html`<div class="players">
      <div class="players-head">
        <span class="live-dot"></span>
        <span>${'Players online'}</span>
        <ix-pill variant="primary" outline>${online.length + 1}</ix-pill>
      </div>
      <div class="player-row me">
        <span class="dot" style="--c:${color(this.profile.color)}"></span>
        <div class="who">
          <div class="name">${this.profile.nickname || '—'} <span class="you">${'(you)'}</span></div>
          <div class="dpe">${own}</div>
          <div class="meta">
            ${this.demo
              ? 'demo: not written'
              : html`↑ ${this.link.writes} ${'writes'}${this.link.lastWriteAt ? html` · ${ago(this.link.lastWriteAt)}` : nothing}`}
          </div>
        </div>
        <div class="num"><strong>${this.hud?.score ?? 0}</strong><span>${this.hud?.speed ?? 0} km/h</span></div>
      </div>
      ${online.map(
        (r) => html`<div class="player-row">
          <span class="dot" style="--c:${color(r.color)}"></span>
          <div class="who">
            <div class="name">${r.nickname || r.dp} · <span class="veh">${vehicleById(r.vehicle).label}</span></div>
            <div class="dpe">${r.dp}</div>
            <div class="meta">↓ ${ago(r.updatedAt)}${r.mission ? html` · ${r.mission.split(':')[0]}` : nothing}</div>
          </div>
          <div class="num"><strong>${r.score}</strong><span>${Math.round(r.speed)} km/h</span></div>
        </div>`
      )}
      <div class="players-foot">dpConnect · CityDrive_Player_* · ${this.remotes.length + 1} DP</div>
    </div>`;
  }

  /** A HUD button: run it, then give the keyboard back to the game. */
  private act(fn: () => void): void {
    fn();
    this.stage.focus();
  }

  private onPlayers(players: RemotePlayer[]): void {
    this.remotes = players;
    if (!this.game || !this.palette) return;
    const p = this.palette;
    const now = Date.now();
    this.game.remotes = players
      .filter((r) => now - r.updatedAt < ONLINE_MS)
      .map((r) => ({
        id: r.dp,
        nickname: r.nickname,
        vehicle: r.vehicle,
        color: p[r.color as NeonColor] ?? p.info,
        x: Number(r.x) || 0,
        z: Number(r.z) || 0,
        heading: ((Number(r.heading) || 0) * Math.PI) / 180
      }));
  }

  // --- flow ---------------------------------------------------------------------------

  private async boot(): Promise<void> {
    await this.updateComplete;
    this.palette = readPalette(this);
    this.game = new CityGame(this.stage, this.palette);
    this.game.setProfile(this.profile);
    this.game.setPaused(true);
    this.game.onHud = (hud) => this.onHud(hud);
    this.game.onEvent = (e) => this.onEvent(e);
    this.game.onProfile = (pr) => {
      this.profile = pr;
      saveProfile(pr);
    };
    this.game.start();
    this.requestUpdate();
    await this.link.open((s) => this.onLink(s));
    this.demo = this.link.demo;
    this.telemetryOn = !this.link.demo && this.link.player !== '';
    this.link.watchPlayers((players) => this.onPlayers(players), this.game.city.blocks);
  }

  private startGame(): void {
    this.profile = { ...this.profile, nickname: cleanNickname(this.profile.nickname) };
    saveProfile(this.profile);
    this.started = true;
    this.game?.setProfile(this.profile);
    this.game?.setPaused(false);
    this.stage.focus();
    this.telemetryTimer = window.setInterval(() => this.sendTelemetry(), TELEMETRY_MS);
  }

  private sendTelemetry(): void {
    if (!this.game || !this.telemetryOn) return;
    const fields = this.throttle.offer(this.game.telemetry(), performance.now() / 1000);
    if (fields) void this.link.write(fields);
  }

  private onLink(s: LinkState): void {
    if (!this.game) return;
    const newFault = [...s.machines].some(([id, st]) => st === 'fault' && this.machines.get(id) !== 'fault');
    this.machines = s.machines;
    this.game.machineStates = s.machines;
    this.game.overrides = { allRed: s.allRed };
    const m = this.game.mission;
    const idle = !m || m.stage === 'done' || m.stage === 'failed' || m.kind === 'delivery';
    // a breakdown takes over: the intervention replaces a delivery in progress
    if (this.started && newFault && idle) this.game.newMission();
  }

  private onHud(hud: HudState): void {
    this.hud = hud;
    const canvas = this.minimap;
    if (!canvas || !this.game || !this.palette) return;
    const m = hud.mission;
    const target = m && ['pickup', 'drop', 'reach'].includes(m.stage) ? m.target : null;
    const tc = m?.kind === 'intervention' ? this.palette.alarm : m?.stage === 'drop' ? this.palette.success : this.palette.warning;
    drawMinimap(canvas, this.game.city, this.palette, this.game.car, this.palette[this.profile.color], this.game.traffic, this.machines, target, tc, this.game.remotes);
  }

  private onEvent(e: GameEvent): void {
    this.eventText = MSG.event[e];
    window.clearTimeout(this.eventTimer);
    this.eventTimer = window.setTimeout(() => (this.eventText = ''), EVENT_SHOW_MS);
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function pageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
      color: var(--theme-color-std-text);
      background: var(--theme-color-1);
    }
    .stage {
      position: relative;
      flex: 1;
      min-height: 0;
      outline: none;
      overflow: hidden;
    }
    .stage:focus-visible {
      box-shadow: inset 0 0 0 2px var(--theme-color-primary);
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--theme-color-1) 45%, transparent);
      backdrop-filter: blur(2px);
      z-index: 3;
    }
    .setup {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      width: min(50rem, 94%);
      padding: 1.5rem;
      border: 1px solid var(--theme-color-primary);
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-2) 88%, transparent);
      box-shadow: 0 0 24px color-mix(in srgb, var(--theme-color-primary) 45%, transparent);
    }
    .setup.small {
      width: min(28rem, 92%);
      align-items: center;
      text-align: center;
    }
    .banner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      padding: 0.25rem 0 0.5rem;
      text-align: center;
    }
    .banner .kicker {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.9rem;
      font-weight: 700;
      letter-spacing: 0.45em;
      color: var(--theme-color-dynamic);
      text-shadow: 0 0 8px var(--theme-color-dynamic);
    }
    .banner .bar {
      width: 2.5rem;
      height: 2px;
      background: var(--theme-color-dynamic);
      box-shadow: 0 0 8px var(--theme-color-dynamic);
    }
    .banner .headline {
      font-size: 2.6rem;
      line-height: 1.05;
      font-weight: 800;
      font-style: italic;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: linear-gradient(180deg, var(--theme-color-std-text) 15%, var(--theme-color-primary) 55%, var(--theme-color-warning) 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      filter: drop-shadow(0 0 10px color-mix(in srgb, var(--theme-color-primary) 70%, transparent))
        drop-shadow(0 2px 0 rgba(0, 0, 0, 0.8));
    }
    .banner .tagline {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
      letter-spacing: 0.08em;
    }
    .banner.compact {
      position: absolute;
      top: 3.75rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2;
      pointer-events: none;
      padding: 0.35rem 1.25rem 0.45rem;
      border: 1px solid var(--theme-color-primary);
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-1) 70%, transparent);
      box-shadow: 0 0 16px color-mix(in srgb, var(--theme-color-primary) 40%, transparent);
    }
    .banner.compact .kicker {
      font-size: 0.65rem;
    }
    .banner.compact .bar {
      width: 1.25rem;
    }
    .banner.compact .headline {
      font-size: 1.25rem;
    }
    .label {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .vehicles {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.5rem;
    }
    .vehicle {
      cursor: pointer;
      width: 100%;
      min-width: 0;
      height: auto;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .bars {
      display: inline-flex;
      gap: 2px;
    }
    .bars i {
      width: 0.6rem;
      height: 0.35rem;
      background: var(--theme-color-component-1);
    }
    .bars i.on {
      background: var(--theme-color-primary);
      box-shadow: 0 0 4px var(--theme-color-primary);
    }
    .colors {
      display: flex;
      gap: 0.5rem;
    }
    .swatch {
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      border: 2px solid transparent;
      background: var(--c);
      box-shadow: 0 0 10px var(--c);
      cursor: pointer;
    }
    .swatch.on {
      border-color: var(--theme-color-std-text);
    }
    .go {
      align-self: flex-end;
    }
    .times {
      display: flex;
      gap: 0.5rem;
    }
    .keys {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .hud {
      position: absolute;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      pointer-events: none;
    }
    .hud ix-button,
    .hud ix-icon-button,
    .hud canvas {
      pointer-events: auto;
    }
    .top-left {
      top: 4.5rem;
      left: 1rem;
      align-items: flex-start;
    }
    .top-right {
      top: 4.5rem;
      right: 1rem;
      align-items: flex-end;
    }
    .bottom-left {
      bottom: 1rem;
      left: 1rem;
      width: 14rem;
    }
    .player {
      font-weight: 600;
      text-shadow: 0 0 6px var(--theme-color-primary);
    }
    .score {
      font-size: 1.1rem;
    }
    .score strong {
      color: var(--theme-color-dynamic);
      text-shadow: 0 0 8px var(--theme-color-dynamic);
    }
    .mission {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-warning);
      background: color-mix(in srgb, var(--theme-color-2) 80%, transparent);
      box-shadow: 0 0 12px color-mix(in srgb, var(--theme-color-warning) 50%, transparent);
    }
    .mission.intervention {
      border-color: var(--theme-color-alarm);
      box-shadow: 0 0 12px color-mix(in srgb, var(--theme-color-alarm) 55%, transparent);
    }
    .m-title {
      font-weight: 600;
    }
    .timer {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      color: var(--theme-color-warning);
    }
    .minimap {
      border: 1px solid var(--theme-color-primary);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 0 14px color-mix(in srgb, var(--theme-color-primary) 45%, transparent);
    }
    .tools {
      display: flex;
      gap: 0.25rem;
      background: color-mix(in srgb, var(--theme-color-2) 80%, transparent);
      border-radius: var(--theme-default-border-radius);
    }
    .speed {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
    }
    .speed strong {
      font-size: 3rem;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      color: var(--theme-color-primary);
      text-shadow: 0 0 12px var(--theme-color-primary);
    }
    .fuel {
      width: 100%;
    }
    .toast {
      position: absolute;
      top: 8.5rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2;
      padding: 0.4rem 1rem;
      font-size: 1.2rem;
      font-weight: 600;
      border: 1px solid var(--theme-color-dynamic);
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-2) 80%, transparent);
      box-shadow: 0 0 14px color-mix(in srgb, var(--theme-color-dynamic) 55%, transparent);
    }
    .players {
      pointer-events: auto;
      width: 17rem;
      max-height: 22rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--theme-color-primary);
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-2) 82%, transparent);
      box-shadow: 0 0 14px color-mix(in srgb, var(--theme-color-primary) 35%, transparent);
    }
    .players-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      font-weight: 600;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .players-head ix-pill {
      margin-left: auto;
    }
    .live-dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      background: var(--theme-color-success);
      box-shadow: 0 0 8px var(--theme-color-success);
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.35;
      }
    }
    .player-row {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.45rem 0.75rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .player-row.me {
      background: color-mix(in srgb, var(--theme-color-primary) 10%, transparent);
    }
    .dot {
      flex: none;
      width: 0.7rem;
      height: 0.7rem;
      margin-top: 0.3rem;
      border-radius: 50%;
      background: var(--c);
      box-shadow: 0 0 8px var(--c);
    }
    .who {
      flex: 1;
      min-width: 0;
    }
    .name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .you,
    .veh {
      font-weight: 400;
      color: var(--theme-color-soft-text);
    }
    .dpe {
      font-family: monospace;
      font-size: 0.7rem;
      color: var(--theme-color-dynamic);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta {
      font-size: 0.7rem;
      color: var(--theme-color-soft-text);
    }
    .num {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      font-size: 0.7rem;
      color: var(--theme-color-soft-text);
      font-variant-numeric: tabular-nums;
    }
    .num strong {
      font-size: 0.95rem;
      color: var(--theme-color-std-text);
    }
    .players-foot {
      padding: 0.4rem 0.75rem;
      font-family: monospace;
      font-size: 0.68rem;
      color: var(--theme-color-soft-text);
    }
    .center {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
  `;
}
