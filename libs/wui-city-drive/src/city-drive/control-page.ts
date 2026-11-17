// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * City Drive's control room (#96), `/city-drive/control`, role `city-drive/control`: a page for
 * a second screen of the stand, showing that the game runs on WinCC OA datapoints.
 *
 * - the **map** of the city: every player online (their `CityDrive_Player_*` datapoints,
 *   `dpConnect`), the plant's halls in the colour of their machine's state, wanted players
 *   ringed in red;
 * - **alerts**: the wanted players — the same WinCC OA alert the alarm list shows — with an
 *   **Acknowledge** button (`dpSet <dp>.wanted:_alert_hdl.._ack = 2` on the operator's own
 *   session, shown only with the write permission): the game then clears the player's level;
 * - the **players online** (car, speed, score, alert level, damage), the **plant** (machine
 *   states), the **weather** (its DPEs, or the game's own), **today** (matches, players, best
 *   logos, from `CityDrive_Results`).
 *
 * It does not play: no player datapoint is created (DriveLink.openViewer).
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { hasRole$ } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { canWriteDatapoints$ } from '@visuelconcept-winccoa/wui-kit/data/permissions.js';
import { DpSingleJsonStore } from '@visuelconcept-winccoa/wui-kit/data/dp-single-json-store.js';
import type { MachineState } from './bindings.js';
import { generateCity, type City } from './city.js';
import { drawCityMap } from './control-map.js';
import { DriveLink, ONLINE_MS, type LinkState, type RemotePlayer } from './dp-link.js';
import { readPalette, type NeonPalette } from './palette.js';
import type { GameResult } from './results.js';
import { vehicleById } from './vehicles.js';
import type { Weather } from './weather.js';

const RESULTS_DP = 'CityDrive_Results';
const MACHINE_LABEL: Record<MachineState, string> = { run: 'Running', stop: 'Stopped', fault: 'Fault', unknown: 'Not bound' };

@customElement('wui-city-drive-control')
export class WuiCityDriveControl extends LitElement {
  static override readonly styles = [IXCoreStyles, controlStyles()];

  @state() private allowed: boolean | null = null;
  @state() private canAck = false;
  @state() private players: RemotePlayer[] = [];
  @state() private machines = new Map<string, MachineState>();
  @state() private weather: Weather | null = null;
  @state() private demo = false;
  @state() private today = { matches: 0, players: 0, best: 0 };
  @state() private clock = '';
  @state() private acking = new Set<string>();
  @state() private note = '';
  @query('canvas.map') private canvas?: HTMLCanvasElement;
  private readonly link = new DriveLink();
  private readonly city: City = generateCity();
  private readonly results = new DpSingleJsonStore<GameResult[]>(RESULTS_DP, RESULTS_DP, () => [], { isArray: true });
  private palette: NeonPalette | null = null;
  private subs = new Subscription();
  private frame = 0;
  private timer = 0;
  private started = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.subs.add(
      hasRole$('city-drive', 'control').subscribe((granted) => {
        this.allowed = granted;
        if (granted) void this.start();
      })
    );
    this.subs.add(canWriteDatapoints$().subscribe((w) => (this.canAck = w)));
    this.timer = window.setInterval(() => {
      this.clock = new Date().toLocaleTimeString();
      void this.loadToday();
    }, 1000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subs.unsubscribe();
    this.link.close();
    cancelAnimationFrame(this.frame);
    window.clearInterval(this.timer);
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.updateComplete;
    this.palette = readPalette(this);
    await this.link.openViewer((s) => this.onState(s));
    this.demo = this.link.demo;
    this.link.watchPlayers((p) => (this.players = p), this.city.blocks, true);
    void this.loadToday(true);
    const draw = (now: number): void => {
      this.frame = requestAnimationFrame(draw);
      this.drawMap(now / 1000);
    };
    this.frame = requestAnimationFrame(draw);
  }

  private onState(s: LinkState): void {
    this.machines = s.machines;
    this.weather = s.weather;
  }

  private lastToday = 0;
  /** Today's matches (results ending today), at most every 30 s. */
  private async loadToday(force = false): Promise<void> {
    if (!force && Date.now() - this.lastToday < 30_000) return;
    this.lastToday = Date.now();
    const log = await this.results.load().catch(() => [] as GameResult[]);
    const day = new Date().toDateString();
    const mine = log.filter((r) => new Date(r.at).toDateString() === day);
    this.today = {
      matches: new Set(mine.map((r) => r.at)).size,
      players: new Set(mine.map((r) => (r.email || `#${r.nickname}`).toLowerCase())).size,
      best: mine.reduce((a, r) => Math.max(a, r.logos), 0)
    };
  }

  private get online(): RemotePlayer[] {
    const now = Date.now();
    return this.players.filter((p) => this.demo || now - p.updatedAt < ONLINE_MS).sort((a, b) => b.score - a.score);
  }

  private drawMap(t: number): void {
    const c = this.canvas;
    const p = this.palette;
    if (!c || !p) return;
    const w = Math.round(c.clientWidth * Math.min(2, devicePixelRatio));
    const h = Math.round(c.clientHeight * Math.min(2, devicePixelRatio));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const color = (name: string): number => (p as unknown as Record<string, number>)[name] ?? p.primary;
    drawCityMap(
      c,
      this.city,
      p,
      this.machines,
      this.online.map((pl) => ({
        x: pl.x,
        z: pl.z,
        heading: (pl.heading * Math.PI) / 180,
        color: color(pl.color),
        label: pl.nickname || pl.dp,
        wanted: pl.wanted === true,
        onFoot: pl.vehicle === 'foot'
      })),
      t
    );
  }

  /** Acknowledges a wanted player's alert (operator's session); the game clears its level. */
  private async acknowledge(pl: RemotePlayer): Promise<void> {
    this.acking = new Set([...this.acking, pl.dp]);
    const ok = await this.link.acknowledge(pl.dp);
    this.note = ok ? `Alert of ${pl.nickname || pl.dp} acknowledged.` : `The alert of ${pl.nickname || pl.dp} could not be acknowledged (write permission?).`;
    const next = new Set(this.acking);
    next.delete(pl.dp);
    this.acking = next;
  }

  override render(): TemplateResult {
    if (this.allowed === null) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (!this.allowed) return html`<div class="center muted">Your groups do not hold the "Control room" role of City Drive.</div>`;
    const online = this.online;
    const wanted = online.filter((p) => p.wanted);
    const w = this.weather;
    return html`<div class="room">
      <div class="head">
        <span class="kicker">WINCC OA</span>
        <ix-typography format="h2">City Drive · Control room</ix-typography>
        <span class="grow"></span>
        ${this.demo ? html`<ix-pill variant="warning" outline>Demo: simulated plant and players</ix-pill>` : nothing}
        <ix-pill variant="neutral" outline icon="user-management">${online.length} online</ix-pill>
        <span class="clock">${this.clock}</span>
      </div>
      <div class="body">
        <div class="map-card"><canvas class="map"></canvas></div>
        <div class="side">
          <section class="card ${wanted.length ? 'hot' : ''}">
            <div class="card-title"><ix-icon name="alarm-bell" size="16"></ix-icon>Alerts · wanted players</div>
            ${wanted.length === 0
              ? html`<div class="muted">No alert.</div>`
              : wanted.map(
                  (pl) => html`<div class="alarm">
                    <div>
                      <strong>${pl.nickname || pl.dp}</strong>
                      <div class="chev">${[1, 2, 3, 4, 5].map((n) => html`<span class=${n <= (pl.alert ?? 0) ? 'on' : ''}></span>`)}</div>
                      <div class="muted small">${pl.dp}.wanted · damage ${pl.damage ?? 0} %</div>
                    </div>
                    ${this.canAck || this.demo
                      ? html`<ix-button variant="danger-primary" icon="check" ?disabled=${this.acking.has(pl.dp)} @click=${() => void this.acknowledge(pl)}>Acknowledge</ix-button>`
                      : html`<span class="muted small">No write permission</span>`}
                  </div>`
                )}
            ${this.note ? html`<div class="muted small">${this.note}</div>` : nothing}
          </section>
          <section class="card">
            <div class="card-title"><ix-icon name="user-management" size="16"></ix-icon>Players online</div>
            ${online.length === 0
              ? html`<div class="muted">Nobody is driving.</div>`
              : html`<table class="players">
                  ${online.map(
                    (pl) => html`<tr class=${pl.wanted ? 'wanted' : ''}>
                      <td>${pl.nickname || pl.dp}</td>
                      <td class="muted">${pl.vehicle === 'foot' ? 'on foot' : vehicleById(pl.vehicle).label}</td>
                      <td class="n">${pl.speed} km/h</td>
                      <td class="n"><strong>${pl.score}</strong></td>
                    </tr>`
                  )}
                </table>`}
          </section>
          <section class="card">
            <div class="card-title"><ix-icon name="maintenance" size="16"></ix-icon>Plant</div>
            <div class="machines">
              ${['machine-1', 'machine-2', 'machine-3', 'machine-4'].map((id) => {
                const st = this.machines.get(id) ?? 'unknown';
                return html`<div class="machine ${st}"><span class="dot"></span>${id.replace('machine-', 'Machine ')}<span class="muted">${MACHINE_LABEL[st]}</span></div>`;
              })}
            </div>
          </section>
          <section class="card row2">
            <div>
              <div class="card-title"><ix-icon name="cloud" size="16"></ix-icon>Weather</div>
              <div class="big">${w ? (w.rain > 0.3 ? 'Rain' : w.fog > 0.4 ? 'Fog' : 'Clear') : 'Game cycle'}</div>
              <div class="muted small">${w ? `rain ${Math.round(w.rain * 100)} % · fog ${Math.round(w.fog * 100)} %` : 'no weather datapoint bound'}</div>
            </div>
            <div>
              <div class="card-title"><ix-icon name="calendar" size="16"></ix-icon>Today</div>
              <div class="big">${this.today.matches} matches</div>
              <div class="muted small">${this.today.players} players · best ${this.today.best} logos</div>
            </div>
          </section>
        </div>
      </div>
    </div>`;
  }
}

function controlStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      color: var(--theme-color-std-text);
      background: var(--theme-color-1);
    }
    .room {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 0.75rem 1rem;
      gap: 0.75rem;
      box-sizing: border-box;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .kicker {
      font-weight: 700;
      letter-spacing: 0.4em;
      color: var(--theme-color-dynamic);
    }
    .grow {
      flex: 1;
    }
    .clock {
      font-size: 1.4rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: var(--theme-color-primary);
    }
    .body {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) minmax(22rem, 1fr);
      gap: 0.75rem;
    }
    .map-card,
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
    }
    .map-card {
      min-height: 0;
      overflow: hidden;
    }
    .map {
      width: 100%;
      height: 100%;
      display: block;
    }
    .side {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      min-height: 0;
      overflow: auto;
    }
    .card {
      padding: 0.75rem 0.9rem;
    }
    .card.hot {
      border-color: var(--theme-color-alarm);
      box-shadow: 0 0 14px color-mix(in srgb, var(--theme-color-alarm) 40%, transparent);
    }
    .card-title {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--theme-color-soft-text);
    }
    .center {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .small {
      font-size: 0.8rem;
    }
    .alarm {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-alarm);
    }
    .chev {
      display: flex;
      gap: 0.15rem;
      margin: 0.2rem 0;
    }
    .chev span {
      width: 0.8rem;
      height: 0.6rem;
      clip-path: polygon(0 0, 50% 45%, 100% 0, 100% 55%, 50% 100%, 0 55%);
      background: color-mix(in srgb, var(--theme-color-std-text) 25%, transparent);
    }
    .chev span.on {
      background: var(--theme-color-alarm);
    }
    .players {
      width: 100%;
      border-collapse: collapse;
    }
    .players td {
      padding: 0.25rem 0.3rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .players tr.wanted td {
      color: var(--theme-color-alarm);
    }
    .players .n {
      text-align: right;
      white-space: nowrap;
    }
    .machines {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.4rem;
    }
    .machine {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .machine .muted {
      margin-left: auto;
      font-size: 0.8rem;
    }
    .machine .dot {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      background: var(--theme-color-neutral);
    }
    .machine.run .dot {
      background: var(--theme-color-success);
      box-shadow: 0 0 6px var(--theme-color-success);
    }
    .machine.fault .dot {
      background: var(--theme-color-alarm);
      box-shadow: 0 0 8px var(--theme-color-alarm);
    }
    .machine.unknown .dot {
      background: var(--theme-color-info);
    }
    .row2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
    .big {
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--theme-color-primary);
    }
  `;
}
