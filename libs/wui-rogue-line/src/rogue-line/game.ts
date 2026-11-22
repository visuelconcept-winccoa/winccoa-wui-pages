// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the game on a canvas: the loop (simulation at 60 Hz, drawing at the screen's
 * rate), the controls (keyboard, mouse with pointer lock, USB gamepad), the raycaster, the HUD
 * and the sounds. The page (rogue-line.ts) owns the menus and the results.
 */
import { GameAudio } from './audio.js';
import { drawAutomap, drawCrosshair, drawMessages, drawMinimap, drawStatusBar, drawTarget, drawTitle, drawTool, type Message } from './hud.js';
import { LEVELS, MACHINE_LABELS } from './maps.js';
import { H, Raycaster, VIEW_H, W, type Sprite } from './render.js';
import { NO_INPUT, Sim, TOOL_LABELS, TOOLS, type Difficulty, type Input, type MachineState, type ToolId } from './sim.js';
import { makeSprites, setVcSymbol, type MachineFrame, type SpriteSet } from './sprites.js';
import { makeTextures, paintVc, type TextureSet } from './textures.js';
import { TouchControls } from './touch.js';
import { VC_SYMBOL_SVG, loadSvg } from './vc-logo.js';

const STEP = 1 / 60;

export interface GameSettings {
  /** Mouse turn, radians per pixel ×1000. */
  mouse: number;
  /** Keyboard / stick turn speed, radians per second. */
  turn: number;
  volume: number;
  muted: boolean;
  difficulty: Difficulty;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = { mouse: 2.2, turn: 2.6, volume: 0.7, muted: false, difficulty: 'normal' };

export interface LevelResult {
  level: number;
  name: string;
  time: number;
  par: number;
  faults: number;
  repaired: number;
  bumps: number;
  /** Output lost while machines were down (parts). */
  lost: number;
  bonus: { time: number; safety: number };
  /** The run's score so far (bonus included). */
  score: number;
}

export interface GameCallbacks {
  /** The machine states of the plant (datapoints), or of the demo. */
  machineState: (id: number, time: number) => MachineState;
  onLevelEnd: (r: LevelResult) => void;
  onPause: () => void;
}

const KEYS = {
  forward: ['KeyW', 'KeyZ', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'KeyQ'],
  right: ['KeyD'],
  turnLeft: ['ArrowLeft'],
  turnRight: ['ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  work: ['Space', 'KeyE', 'Enter'],
  use: ['KeyE', 'Enter'],
  map: ['Tab', 'KeyM'],
  pause: ['Escape', 'KeyP']
} as const;

export class RogueGame {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly low: HTMLCanvasElement;
  private readonly lowCtx: CanvasRenderingContext2D;
  private readonly tex: TextureSet;
  private readonly spr: SpriteSet;
  private readonly ray: Raycaster;
  readonly audio = new GameAudio();
  sim: Sim;
  levelIndex = 0;
  /** The run's score before this level. */
  private banked = 0;
  private raf = 0;
  private last = 0;
  private acc = 0;
  paused = false;
  private ended = false;
  private keys = new Set<string>();
  private mouseDx = 0;
  private mouseWork = false;
  private usePressed = false;
  private toolPick: ToolId | null = null;
  private mapOn = false;
  private messages: Message[] = [];
  private bumpFlash = 0;
  private pickFlash = 0;
  private padPrev: boolean[] = [];
  private readonly resize = new ResizeObserver(() => this.fit());
  /** The touch controls, on a touch screen only. */
  readonly touch: TouchControls | null;

  constructor(
    private readonly host: HTMLElement,
    private settings: GameSettings,
    private readonly cb: GameCallbacks
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game';
    this.canvas.tabIndex = 0;
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.low = document.createElement('canvas');
    this.low.width = W;
    this.low.height = H;
    this.lowCtx = this.low.getContext('2d') as CanvasRenderingContext2D;
    this.tex = makeTextures();
    this.spr = makeSprites();
    this.ray = new Raycaster(this.tex);
    void loadSvg(VC_SYMBOL_SVG).then(
      (img) => {
        paintVc(this.tex, img);
        setVcSymbol(img);
      },
      () => undefined
    );
    this.sim = this.newSim(0);
    this.resize.observe(host);
    this.touch = TouchControls.wanted()
      ? new TouchControls(
          host,
          () => (this.mapOn = !this.mapOn),
          () => this.cb.onPause()
        )
      : null;
    this.fit();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private newSim(index: number): Sim {
    const sim = new Sim(LEVELS[index], this.settings.difficulty);
    this.ray.seen = new Uint8Array(sim.level.w * sim.level.h);
    this.messages = [];
    return sim;
  }

  /** Starts a run at the first level (or another, for the tests). */
  newRun(index = 0): void {
    this.levelIndex = index;
    this.banked = 0;
    this.sim = this.newSim(index);
    this.ended = false;
    this.setPaused(false);
  }

  /** The next level. */
  nextLevel(): boolean {
    if (this.levelIndex + 1 >= LEVELS.length) return false;
    this.banked = this.result().score;
    this.levelIndex++;
    this.sim = this.newSim(this.levelIndex);
    this.ended = false;
    this.setPaused(false);
    return true;
  }

  /** The current level again, from its start (its score is dropped). */
  retryLevel(): void {
    this.sim = this.newSim(this.levelIndex);
    this.ended = false;
    this.setPaused(false);
  }

  get levelCount(): number {
    return LEVELS.length;
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const frame = (now: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (!this.paused && !this.ended) {
        this.acc += dt;
        while (this.acc >= STEP) {
          this.tick();
          this.acc -= STEP;
        }
      }
      this.draw();
    };
    this.raf = requestAnimationFrame(frame);
    this.audio.startHum();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resize.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.audio.dispose();
    this.canvas.remove();
    this.touch?.dispose();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.touch?.setVisible(!p);
    this.keys.clear();
    this.mouseWork = false;
    if (p && document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (p) this.audio.stopHum();
    else this.audio.startHum();
  }

  applySettings(s: GameSettings): void {
    this.settings = s;
    this.audio.setVolume(s.volume, s.muted);
  }

  /** The level's figures and the run's score. */
  result(): LevelResult {
    const s = this.sim;
    const bonus = s.finished ? s.bonus() : { time: 0, safety: 0 };
    return {
      level: this.levelIndex + 1,
      name: s.level.name,
      time: s.time,
      par: s.level.par,
      faults: s.stats.faults,
      repaired: s.stats.repaired,
      bumps: s.stats.bumps,
      lost: Math.round(s.stats.lost),
      bonus,
      score: this.banked + s.score + bonus.time + bonus.safety
    };
  }

  // --- simulation ---------------------------------------------------------------------------------

  private tick(): void {
    const sim = this.sim;
    sim.setMachineStates((id) => this.cb.machineState(id, sim.time));
    sim.step(STEP, this.readInput());
    this.usePressed = false;
    this.toolPick = null;
    this.mouseDx = 0;
    for (const m of this.messages) m.t += STEP;
    this.messages = this.messages.filter((m) => m.t < 3);
    this.bumpFlash = Math.max(0, this.bumpFlash - STEP * 2.5);
    this.pickFlash = Math.max(0, this.pickFlash - STEP * 3);
    this.handleEvents();
    if (sim.finished && !this.ended) {
      this.ended = true;
      this.cb.onLevelEnd(this.result());
    }
  }

  private say(text: string): void {
    this.messages.push({ text, t: 0 });
  }

  private handleEvents(): void {
    for (const e of this.sim.events.splice(0)) {
      switch (e.type) {
        case 'work':
          this.audio.play(e.tool);
          break;
        case 'wrong-tool':
          this.audio.play('denied');
          this.say(`M${e.id} needs the ${TOOL_LABELS[e.need].toLowerCase().replace('wincc oa', 'WinCC OA')} (${TOOLS.indexOf(e.need) + 1})`);
          break;
        case 'need-part':
          this.audio.play('denied');
          this.say(`M${e.id} needs a spare part: find one in the level`);
          break;
        case 'repair':
          this.audio.play('repair');
          this.say(`M${e.id} ${MACHINE_LABELS[e.kind]} running again · +${e.score}`);
          if (this.sim.faulted().length === 0) this.say('The line runs: go to the exit');
          break;
        case 'pickup':
          this.pickFlash = 0.35;
          this.audio.play(e.kind === 'part' ? 'pickup' : 'key');
          this.say(e.text);
          break;
        case 'door':
          this.audio.play(e.open ? 'door-open' : 'door-close');
          break;
        case 'need-key':
          this.audio.play('denied');
          this.say(`You need the ${e.key} key card`);
          break;
        case 'line-fault':
          this.audio.play('denied');
          this.say(`Line down: repair ${e.ids.map((i) => `M${i}`).join(', ')} first`);
          break;
        case 'bump':
          this.bumpFlash = 0.6;
          this.audio.play('bump');
          this.say('Bumped by an AGV: keep off its lane');
          break;
        case 'agv-near':
          this.audio.play('agv', e.distance);
          break;
        case 'splash':
          this.audio.play('splash');
          break;
        case 'exit':
          this.audio.play('exit');
          this.say('Exit open');
          break;
      }
    }
  }

  private on(codes: readonly string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private readInput(): Input {
    if (this.paused) return NO_INPUT;
    const s = this.settings;
    let forward = (this.on(KEYS.forward) ? 1 : 0) - (this.on(KEYS.back) ? 1 : 0);
    let strafe = (this.on(KEYS.right) ? 1 : 0) - (this.on(KEYS.left) ? 1 : 0);
    let turn = ((this.on(KEYS.turnRight) ? 1 : 0) - (this.on(KEYS.turnLeft) ? 1 : 0)) * s.turn * STEP + this.mouseDx * s.mouse * 0.001;
    let run = this.on(KEYS.run);
    let work = this.on(KEYS.work) || this.mouseWork;
    let use = this.usePressed;
    let tool = this.toolPick;
    if (this.touch) {
      const t = this.touch.take();
      forward = forward || t.forward;
      strafe = strafe || t.strafe;
      run = run || t.run;
      turn += t.turnPx * s.mouse * 0.0028;
      work = work || t.work;
      use = use || t.use;
      tool = tool ?? t.tool;
    }
    // the gamepad (standard mapping): left stick moves, right stick turns, A / RT work, LB RB tools
    const pad = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (pad) {
      const dz = (v: number): number => (Math.abs(v) < 0.18 ? 0 : v);
      const b = (i: number): boolean => pad.buttons[i]?.pressed === true;
      const edge = (i: number): boolean => b(i) && !this.padPrev[i];
      forward = forward || -dz(pad.axes[1] ?? 0);
      strafe = strafe || dz(pad.axes[0] ?? 0);
      turn += dz(pad.axes[2] ?? 0) * s.turn * STEP;
      run = run || b(10) || b(1);
      work = work || b(0) || (pad.buttons[7]?.value ?? 0) > 0.4;
      use = use || edge(0);
      if (edge(5) || edge(4)) tool = this.cycleTool(edge(5) ? 1 : -1);
      if (edge(2)) tool = TOOLS[0];
      if (edge(3)) tool = TOOLS[1];
      if (edge(9)) this.cb.onPause();
      if (edge(8)) this.mapOn = !this.mapOn;
      this.padPrev = pad.buttons.map((x) => x.pressed);
    }
    return { forward, strafe, turn, run, work, use, tool };
  }

  private cycleTool(dir: 1 | -1): ToolId {
    const k = TOOLS.indexOf(this.sim.player.tool);
    return TOOLS[(k + dir + TOOLS.length) % TOOLS.length];
  }

  // --- inputs -----------------------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.paused || this.ended) return;
    const target = e.composedPath()[0];
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    this.audio.unlock();
    if ((KEYS.pause as readonly string[]).includes(e.code)) {
      e.preventDefault();
      this.cb.onPause();
      return;
    }
    if (!e.repeat && (KEYS.use as readonly string[]).includes(e.code)) this.usePressed = true;
    if (!e.repeat && (KEYS.map as readonly string[]).includes(e.code)) this.mapOn = !this.mapOn;
    const digit = /^(?:Digit|Numpad)([1-3])$/.exec(e.code);
    if (digit) this.toolPick = TOOLS[Number(digit[1]) - 1];
    this.keys.add(e.code);
    if (/^(Arrow|Space|Tab)/.test(e.code) || e.code === 'KeyE') e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.mouseWork = false;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    this.audio.unlock();
    this.canvas.focus();
    if (this.paused || this.ended) return;
    if (document.pointerLockElement !== this.canvas) {
      void Promise.resolve(this.canvas.requestPointerLock?.()).catch(() => undefined);
      return;
    }
    if (e.button === 0) this.mouseWork = true;
    if (e.button === 2) this.usePressed = true;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseWork = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement === this.canvas) this.mouseDx += e.movementX;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    e.preventDefault();
    this.toolPick = this.cycleTool(e.deltaY > 0 ? 1 : -1);
  };

  // --- drawing ------------------------------------------------------------------------------

  private fit(): void {
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  private sprites(): Sprite[] {
    const sim = this.sim;
    const t = sim.time;
    const out: Sprite[] = [];
    for (const m of sim.machines) {
      let frame: MachineFrame = m.state === 'stop' || m.state === 'unknown' ? 'stop' : Math.floor(t * 2 + m.id) % 2 ? 'run2' : 'run';
      if (m.state === 'fault' && !m.repaired) frame = Math.floor(t * 3) % 2 ? 'fault-on' : 'fault-off';
      out.push({ x: m.x, y: m.y, tex: this.spr.machine(m.kind, m.id, frame), scale: 1, z: 0 });
    }
    for (const a of sim.agvs) out.push({ x: a.x, y: a.y, tex: this.spr.agv[Math.floor(t * 3) % 2], scale: 0.8, z: 0 });
    for (const k of sim.pickups) if (!k.taken) out.push({ x: k.x, y: k.y, tex: this.spr.pickups[k.kind], scale: 0.7, z: 0 });
    for (const d of sim.decor) out.push({ x: d.x, y: d.y, tex: this.spr.decor[d.kind], scale: 0.9, z: 0 });
    for (const l of sim.level.lamps) out.push({ x: l.x, y: l.y, tex: l.red ? this.spr.beacon[Math.floor(t * 4) % 3] : this.spr.lamp, scale: 1, z: 0 });
    for (const e of sim.effects) {
      if (e.kind === 'sparks') out.push({ x: e.x, y: e.y, tex: this.spr.sparks[Math.min(2, Math.floor(e.t * 6))], scale: 0.6, z: 0.2 });
      else out.push({ x: e.x, y: e.y, tex: this.spr.done[Math.min(3, Math.floor(e.t * 7))], scale: 1.2, z: 0 });
    }
    return out;
  }

  private draw(): void {
    const sim = this.sim;
    const p = sim.player;
    const g = this.lowCtx;
    const bob = p.stagger > 0 ? Math.sin(sim.time * 30) * 4 : Math.sin(p.walked * 4.4) * 1.6;
    this.ray.render(sim.level, { x: p.x, y: p.y, angle: p.angle, bob }, this.sprites(), { time: sim.time, exitOn: sim.exitOn });
    g.putImageData(this.ray.image, 0, 0);
    const cell = Math.floor(p.y) * sim.level.w + Math.floor(p.x);
    this.touch?.showTool(p.tool);
    drawTool(g, p.tool, p.walked, p.working, sim.time, sim.level.light[cell] ?? 0.5);
    drawCrosshair(g, sim.target !== null);
    if (this.bumpFlash > 0) {
      g.fillStyle = `rgba(255,150,0,${this.bumpFlash * 0.4})`;
      g.fillRect(0, 0, W, VIEW_H);
    }
    if (this.pickFlash > 0) {
      g.fillStyle = `rgba(255,220,120,${this.pickFlash * 0.35})`;
      g.fillRect(0, 0, W, VIEW_H);
    }
    if (this.mapOn) drawAutomap(g, sim, this.ray.seen);
    else {
      drawTarget(g, sim);
      drawMinimap(g, sim, this.ray.seen);
    }
    drawMessages(g, this.messages);
    drawTitle(g, sim, this.levelIndex + 1);
    drawStatusBar(g, sim, this.levelIndex + 1);
    // up to the screen, hard pixels, kept at 16:10 (black bars around)
    const c = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    c.fillStyle = '#000';
    c.fillRect(0, 0, cw, ch);
    const k = Math.min(cw / W, ch / H);
    c.imageSmoothingEnabled = false;
    // a tall screen (a phone upright): the view at the top, the touch controls below it
    const top = this.touch && ch > cw ? 0 : Math.floor((ch - H * k) / 2);
    c.drawImage(this.low, Math.floor((cw - W * k) / 2), top, Math.floor(W * k), Math.floor(H * k));
  }
}
