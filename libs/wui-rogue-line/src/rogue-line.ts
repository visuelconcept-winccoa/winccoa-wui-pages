// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — standalone page (WinCC OA WebUI Runtime): an original retro first-person game in
 * a plant that is down. A maintenance technician — no weapons, nothing to fight — repairs its
 * machines (6-axis robots, CNC lathes and machining centres, presses, conveyors) with the right
 * tool, keeps off the AGVs' lanes and gets the line running again, level after level. The
 * machines follow datapoints (`RogueLine_Config`), demo without.
 *
 * - start screen: nickname, difficulty, controls, ranking (`RogueLine_Results`, nicknames only);
 * - game: its own engine (rogue-line/: raycaster, textures and sprites drawn at start-up,
 *   WebAudio sounds — no asset files);
 * - pause (settings), level summary, the end of the run with the ranking and the WinCC OA /
 *   Visuel Concept end card.
 *
 * Roles (Application Security): `play` (the page) and `configure` (RogueLine_Config, edited in
 * PARA — declared so that an admin can restrict it). Registered at `/rogue-line`.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { DpSingleJsonStore } from '@visuelconcept-winccoa/wui-kit/data/dp-single-json-store.js';
import appSecurityRoles from './app-security.roles.json';
import { DEFAULT_GAME_SETTINGS, RogueGame, type GameSettings, type LevelResult } from './rogue-line/game.js';
import { LEVELS } from './rogue-line/maps.js';
import { PlantLink } from './rogue-line/plant.js';
import {
  NICKNAME_MAX,
  RESULTS_DP,
  addResult,
  cleanNickname,
  leaderboard,
  newResultId,
  ordinal,
  parseResults,
  type BoardRow,
  type GameResult
} from './rogue-line/results.js';
import type { Difficulty } from './rogue-line/sim.js';
import { LOGO_GRID } from './rogue-line/textures.js';
import { VC_LOGO_SVG, svgDataUrl } from './rogue-line/vc-logo.js';

const MODULE_ID = 'rogue-line';
const SETTINGS_KEY = 'wui-rogue-line.settings';
const NICK_KEY = 'wui-rogue-line.nickname';

type View = 'menu' | 'playing' | 'paused' | 'level-end' | 'victory';

const DIFFICULTIES: { id: Difficulty; label: string; hint: string }[] = [
  { id: 'easy', label: 'Trainee', hint: 'Quicker repairs, slower AGVs' },
  { id: 'normal', label: 'Technician', hint: 'As designed' },
  { id: 'hard', label: 'Night shift', hint: 'Longer repairs, faster AGVs' }
];

const CONTROLS: [string, string][] = [
  ['W A S D · Z Q S D', 'Move · strafe'],
  ['Mouse · ← →', 'Turn (click the view to aim with the mouse)'],
  ['1 2 3 · wheel', 'Wrench (mechanical) · multimeter (electrical) · WinCC OA laptop (software)'],
  ['Hold Space · E · click', 'Repair the machine in front, with the right tool'],
  ['E · right click', 'Open a door · throw the exit switch'],
  ['Shift', 'Run'],
  ['Tab · M', 'Map'],
  ['Esc · P', 'Pause and settings'],
  ['Gamepad', 'Sticks · A or RT repair / use · LB RB tools · Start pause']
];

function loadSettings(): GameSettings {
  try {
    const o = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<GameSettings>;
    const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      mouse: num(o.mouse, DEFAULT_GAME_SETTINGS.mouse, 0.5, 6),
      turn: num(o.turn, DEFAULT_GAME_SETTINGS.turn, 1, 5),
      volume: num(o.volume, DEFAULT_GAME_SETTINGS.volume, 0, 1),
      muted: o.muted === true,
      difficulty: DIFFICULTIES.some((d) => d.id === o.difficulty) ? (o.difficulty as Difficulty) : 'normal'
    };
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // private window: the settings last for this visit
  }
}

const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

@customElement('wui-rogue-line')
export class WuiRogueLine extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private view: View = 'menu';
  @state() private rolePlay = true;
  @state() private settings = loadSettings();
  @state() private nickname = '';
  @state() private last: LevelResult | null = null;
  @state() private board: BoardRow[] = [];
  @state() private place: { place: number; of: number } | null = null;
  @state() private locked = false;
  @state() private plantNote = 'Demo plant: the machines fail on their own';

  @query('.stage') private stage!: HTMLElement;

  private game: RogueGame | null = null;
  private readonly plant = new PlantLink();
  private readonly resultsStore = new DpSingleJsonStore<GameResult[]>(RESULTS_DP, RESULTS_DP, () => [], { isArray: true });
  private roleSub = new Subscription();
  /** A run is under way (its score is saved when it ends or is left for the menu). */
  private running = false;

  override connectedCallback(): void {
    super.connectedCallback();
    try {
      this.nickname = cleanNickname(localStorage.getItem(NICK_KEY) ?? '');
    } catch {
      this.nickname = '';
    }
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$(MODULE_ID, 'play').subscribe((granted) => {
      this.rolePlay = granted;
      if (!granted && this.view === 'playing') this.pause();
    });
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('pointerlockchange', this.onLock);
    void this.plant.start().then(() => {
      this.plantNote = this.plant.demo ? 'Demo plant: the machines fail on their own' : `Live plant: ${this.plant.bound} machine(s) follow their datapoints`;
    });
    void this.loadBoard(null);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.roleSub.unsubscribe();
    this.plant.close();
    this.game?.stop();
    this.game = null;
  }

  private readonly onLock = (): void => {
    this.locked = !!this.game && document.pointerLockElement === this.game.canvas;
  };

  /** Enter: the overlay's main action; Esc: back to the game from the pause. */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.view === 'playing') return;
    const target = e.composedPath()[0];
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (e.repeat) return;
      e.preventDefault();
      if (this.view === 'menu') this.startRun();
      else if (this.view === 'paused') this.resume();
      else if (this.view === 'level-end') this.next();
      else if (this.view === 'victory') this.toMenu();
    } else if ((e.code === 'Escape' || e.code === 'KeyP') && this.view === 'paused' && !typing) {
      e.preventDefault();
      this.resume();
    }
  };

  // --- flow -------------------------------------------------------------------------------------

  private ensureGame(): RogueGame {
    if (this.game) return this.game;
    this.game = new RogueGame(this.stage, this.settings, {
      machineState: (id, time) => this.plant.state(id, time),
      onLevelEnd: (r) => this.levelEnd(r),
      onPause: () => this.pause()
    });
    this.game.applySettings(this.settings);
    this.game.start();
    return this.game;
  }

  private startRun(): void {
    if (!this.rolePlay) return;
    try {
      localStorage.setItem(NICK_KEY, this.nickname);
    } catch {
      // private window
    }
    const game = this.ensureGame();
    game.applySettings(this.settings);
    game.audio.unlock();
    game.newRun(0);
    this.running = true;
    this.place = null;
    this.view = 'playing';
    this.focusGame();
  }

  private focusGame(): void {
    void this.updateComplete.then(() => this.game?.canvas.focus());
  }

  private pause(): void {
    if (this.view !== 'playing') return;
    this.game?.setPaused(true);
    this.view = 'paused';
  }

  private resume(): void {
    this.game?.applySettings(this.settings);
    this.game?.setPaused(false);
    this.view = 'playing';
    this.focusGame();
  }

  private levelEnd(r: LevelResult): void {
    this.last = r;
    this.game?.setPaused(true);
    if (r.level >= LEVELS.length) {
      this.view = 'victory';
      this.running = false;
      void this.saveResult(r, true);
    } else this.view = 'level-end';
  }

  private next(): void {
    if (this.game?.nextLevel()) {
      this.view = 'playing';
      this.focusGame();
    }
  }

  private retry(): void {
    this.game?.retryLevel();
    this.view = 'playing';
    this.focusGame();
  }

  /** Back to the menu; a run left on the way still goes to the ranking with its score so far. */
  private toMenu(): void {
    this.game?.setPaused(true);
    this.view = 'menu';
    const r = this.running && this.game ? this.game.result() : null;
    this.running = false;
    if (r && r.score > 0) void this.saveResult(r, false).then(() => this.loadBoard(null));
    else void this.loadBoard(null);
  }

  private async loadBoard(mine: string | null): Promise<void> {
    const log = parseResults(await this.resultsStore.load().catch(() => []));
    this.board = leaderboard(log, mine, 8);
  }

  private async saveResult(r: LevelResult, completed: boolean): Promise<void> {
    const result: GameResult = { id: newResultId(), nickname: this.nickname || 'Technician', score: r.score, level: r.level, completed, difficulty: this.settings.difficulty, at: Date.now() };
    const log = addResult(parseResults(await this.resultsStore.load().catch(() => [])), result);
    await this.resultsStore.save(log).catch(() => undefined);
    const all = leaderboard(log, result.id, 100000);
    const mine = all.find((b) => b.mine);
    this.place = mine ? { place: mine.place, of: all.length } : null;
    this.board = leaderboard(log, result.id, 8);
  }

  private setSettings(patch: Partial<GameSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.game?.applySettings(this.settings);
  }

  // --- rendering ------------------------------------------------------------------------------

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{ headerTitle: { context: 'translate', config: { 'en_US.utf8': 'Rogue Line', 'fr.utf8': 'Rogue Line', 'de.utf8': 'Rogue Line' } } }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      <div class="stage"></div>
      ${!this.rolePlay
        ? html`<div class="overlay"><div class="card small">You are not allowed to play Rogue Line (role "play").</div></div>`
        : this.view === 'menu'
          ? this.renderMenu()
          : this.view === 'paused'
            ? this.renderPause()
            : this.view === 'level-end'
              ? this.renderLevelEnd()
              : this.view === 'victory'
                ? this.renderVictory()
                : this.renderPlayingHint()}
    `;
  }

  private logo(size = 3): TemplateResult {
    return html`<span class="cube" style="--s:${size}px">${LOGO_GRID.flat().map((c) => html`<i style="background:${c}"></i>`)}</span>`;
  }

  private renderTitle(): TemplateResult {
    return html`<div class="title">
      <div class="kicker"><span class="bar"></span>${this.logo(4)}WINCC OA<span class="bar"></span></div>
      <h1>ROGUE LINE</h1>
      <div class="tagline">The plant is down. Repair its machines with the right tool, keep off the AGVs' lanes, get the line running again.</div>
    </div>`;
  }

  private renderMenu(): TemplateResult {
    return html`<div class="overlay">
      <div class="card">
        ${this.renderTitle()}
        <div class="cols">
          <div class="col">
            <ix-input
              label="Nickname"
              maxlength=${NICKNAME_MAX}
              placeholder="Shown in the ranking"
              .value=${this.nickname}
              @valueChange=${(e: CustomEvent<string>) => (this.nickname = cleanNickname(e.detail ?? ''))}
            ></ix-input>
            <div class="label">Difficulty</div>
            <div class="choices">
              ${DIFFICULTIES.map(
                (d) =>
                  html`<ix-button variant=${this.settings.difficulty === d.id ? 'primary' : 'secondary'} title=${d.hint} @click=${() => this.setSettings({ difficulty: d.id })}
                    >${d.label}</ix-button
                  >`
              )}
            </div>
            <div class="plant"><ix-icon name="maintenance" size="16"></ix-icon>${this.plantNote}</div>
            <div class="muted">Three levels, nine machines: 6-axis robots, CNC lathes and machining centres, a press, a conveyor. Each fault takes its tool; a mechanical one also takes a spare part found in the level.</div>
            <ix-button class="go" icon="play" @click=${() => this.startRun()}>Start · Enter</ix-button>
          </div>
          <div class="col">
            <div class="label">Controls</div>
            <table class="keys">
              ${CONTROLS.map(([k, a]) => html`<tr><td><kbd>${k}</kbd></td><td>${a}</td></tr>`)}
            </table>
          </div>
          <div class="col">${this.renderBoard('Best technicians')}</div>
        </div>
        <div class="by">
          <span>A game brought to you by</span>
          <img class="vc" src=${svgDataUrl(VC_LOGO_SVG)} alt="Visuel Concept" />
        </div>
      </div>
    </div>`;
  }

  private renderBoard(title: string): TemplateResult {
    return html`<div class="board">
      <div class="label">${title}</div>
      ${this.board.length === 0
        ? html`<div class="muted">No run yet: be the first.</div>`
        : html`<table>
            ${this.board.map(
              (b) =>
                html`<tr class=${b.mine ? 'mine' : ''}>
                  <td class="num">${b.place}</td>
                  <td>${b.nickname}</td>
                  <td class="muted">${b.completed ? 'all clear' : `level ${b.level}`}</td>
                  <td class="num">${b.score}</td>
                </tr>`
            )}
          </table>`}
    </div>`;
  }

  private renderPause(): TemplateResult {
    const s = this.settings;
    return html`<div class="overlay">
      <div class="card small">
        <ix-typography format="h3">Paused</ix-typography>
        <ix-slider label=${`Mouse sensitivity (${s.mouse.toFixed(1)})`} min="0.5" max="6" step="0.1" .value=${s.mouse} @valueChange=${(e: CustomEvent<number>) => this.setSettings({ mouse: e.detail })}></ix-slider>
        <ix-slider label=${`Turn speed, keys and stick (${s.turn.toFixed(1)})`} min="1" max="5" step="0.1" .value=${s.turn} @valueChange=${(e: CustomEvent<number>) => this.setSettings({ turn: e.detail })}></ix-slider>
        <ix-slider label="Volume" min="0" max="1" step="0.05" .value=${s.volume} @valueChange=${(e: CustomEvent<number>) => this.setSettings({ volume: e.detail })}></ix-slider>
        <label class="row">Sound <ix-toggle hide-text ?checked=${!s.muted} @checkedChange=${(e: CustomEvent<boolean>) => this.setSettings({ muted: !e.detail })}></ix-toggle></label>
        <div class="actions">
          <ix-button variant="secondary" icon="home" @click=${() => this.toMenu()}>Menu</ix-button>
          <ix-button variant="secondary" icon="refresh" @click=${() => this.retry()}>Restart the level</ix-button>
          <ix-button icon="play" @click=${() => this.resume()}>Resume · Enter</ix-button>
        </div>
      </div>
    </div>`;
  }

  private stats(r: LevelResult): TemplateResult {
    const bonus = r.bonus.time + r.bonus.safety;
    return html`<table class="stats">
      <tr><td>Time</td><td class="num">${fmtTime(r.time)}</td><td class="muted">par ${fmtTime(r.par)}</td></tr>
      <tr><td>Machines repaired</td><td class="num">${r.repaired} / ${r.faults}</td><td class="muted">${r.faults === 0 ? 'no fault' : ''}</td></tr>
      <tr><td>Output lost while down</td><td class="num">${r.lost}</td><td class="muted">parts</td></tr>
      <tr><td>AGV bumps</td><td class="num">${r.bumps}</td><td class="muted">${r.bumps === 0 ? 'safe work' : `−${r.bumps * 150}`}</td></tr>
      ${bonus > 0
        ? html`<tr class="bonus"><td>Bonus</td><td class="num">+${bonus}</td><td class="muted">${[r.bonus.time ? 'under par' : '', r.bonus.safety ? 'no bump' : ''].filter(Boolean).join(' · ')}</td></tr>`
        : nothing}
      <tr class="total"><td>Score</td><td class="num">${r.score}</td><td></td></tr>
    </table>`;
  }

  private renderLevelEnd(): TemplateResult {
    const r = this.last as LevelResult;
    return html`<div class="overlay">
      <div class="card small">
        <div class="kicker"><span class="bar"></span>LEVEL ${r.level} · LINE RUNNING<span class="bar"></span></div>
        <ix-typography format="h2">${r.name}</ix-typography>
        ${this.stats(r)}
        <div class="next muted">Next: ${LEVELS[r.level]?.name ?? ''}</div>
        <div class="actions">
          <ix-button variant="secondary" icon="home" @click=${() => this.toMenu()}>Menu</ix-button>
          <ix-button variant="secondary" icon="refresh" @click=${() => this.retry()}>Play it again</ix-button>
          <ix-button icon="chevron-right" @click=${() => this.next()}>Next level · Enter</ix-button>
        </div>
      </div>
    </div>`;
  }

  private renderVictory(): TemplateResult {
    const r = this.last as LevelResult;
    return html`<div class="overlay">
      <div class="card">
        <div class="kicker"><span class="bar"></span>PLANT RESTORED<span class="bar"></span></div>
        <div class="cols">
          <div class="col">
            <ix-typography format="h2">${this.nickname || 'Technician'}, the plant runs again.</ix-typography>
            ${this.stats(r)}
            <div class="muted">${this.place ? `${ordinal(this.place.place)} of ${this.place.of}` : 'Saving the score…'}</div>
          </div>
          <div class="col">${this.renderBoard('Ranking')}</div>
        </div>
        <div class="endcard">
          ${this.logo(6)}
          <div>
            <div class="headline">You just played on WinCC OA.</div>
            <div class="muted">Imagine what we can build for your plant.</div>
          </div>
          <img class="vc" src=${svgDataUrl(VC_LOGO_SVG)} alt="Visuel Concept" />
        </div>
        <div class="actions"><ix-button icon="home" @click=${() => this.toMenu()}>Menu · Enter</ix-button></div>
      </div>
    </div>`;
  }

  private renderPlayingHint(): TemplateResult {
    return this.locked || this.game?.touch ? html`` : html`<div class="hint">Click the view to aim with the mouse · Esc pause</div>`;
  }
}

function pageStyles() {
  return css`
    :host {
      /* the Visuel Concept logo's own paper (brand colour, as in City Drive) */
      --vc-paper: #ffffff;
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
      background: #000;
      overflow: hidden;
    }
    .stage canvas.game {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      outline: none;
      image-rendering: pixelated;
      cursor: crosshair;
    }
    .overlay {
      position: absolute;
      inset: 0;
      top: 3.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--theme-color-1) 70%, transparent);
      backdrop-filter: blur(2px);
      z-index: 3;
      overflow: auto;
      padding: 1rem;
      box-sizing: border-box;
    }
        .card {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      width: min(68rem, 100%);
      max-height: 100%;
      overflow: auto;
      padding: 1.5rem;
      box-sizing: border-box;
      border: 1px solid var(--theme-color-warning);
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-2) 92%, transparent);
      box-shadow: 0 0 28px color-mix(in srgb, var(--theme-color-warning) 30%, transparent);
    }
    .card.small {
      width: min(30rem, 100%);
    }
    .title {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      text-align: center;
    }
    h1 {
      margin: 0;
      font-size: clamp(2.4rem, 7vw, 4.5rem);
      font-weight: 900;
      font-style: italic;
      letter-spacing: 0.06em;
      line-height: 1;
      color: var(--theme-color-warning);
      text-shadow:
        3px 3px 0 var(--theme-color-alarm),
        0 0 18px color-mix(in srgb, var(--theme-color-warning) 55%, transparent);
    }
    .tagline {
      color: var(--theme-color-soft-text);
    }
    .kicker {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.35em;
      color: var(--theme-color-primary);
    }
    .bar {
      width: 2.5rem;
      height: 2px;
      background: currentColor;
    }
    .cube {
      display: inline-grid;
      grid-template-columns: repeat(4, var(--s));
      gap: 1px;
    }
    .cube i {
      width: var(--s);
      height: var(--s);
    }
    .cols {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: 1.5rem;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      min-width: 0;
    }
    .label {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--theme-color-soft-text);
    }
    .choices,
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .actions {
      justify-content: flex-end;
    }
    .go {
      align-self: flex-start;
      margin-top: 0.5rem;
    }
    .plant {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.85rem;
    }
    td {
      padding: 0.2rem 0.4rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: top;
    }
    .keys td:first-child {
      white-space: nowrap;
    }
    kbd {
      font-family: var(--theme-font-family-mono, monospace);
      font-size: 0.75rem;
      padding: 0.05rem 0.3rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 3px;
      background: var(--theme-color-1);
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    tr.mine td {
      color: var(--theme-color-warning);
      font-weight: 700;
    }
    .stats tr.total td {
      font-weight: 700;
      font-size: 1rem;
      border-bottom: none;
    }
    .stats tr.bonus td {
      color: var(--theme-color-success);
    }
    .muted {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .big {
      font-size: 2.5rem;
      font-weight: 800;
      color: var(--theme-color-warning);
      font-variant-numeric: tabular-nums;
    }
    .by {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .vc {
      height: 2.2rem;
      padding: 0.3rem 0.6rem;
      border-radius: var(--theme-default-border-radius);
      background: var(--vc-paper);
    }
    .endcard {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 1.25rem;
      padding: 1rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
    .headline {
      font-size: 1.4rem;
      font-weight: 800;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .hint {
      position: absolute;
      left: 50%;
      bottom: 4.5rem;
      transform: translateX(-50%);
      z-index: 2;
      padding: 0.3rem 0.8rem;
      font-size: 0.8rem;
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-1) 80%, transparent);
      color: var(--theme-color-soft-text);
      pointer-events: none;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-rogue-line': WuiRogueLine;
  }
}
