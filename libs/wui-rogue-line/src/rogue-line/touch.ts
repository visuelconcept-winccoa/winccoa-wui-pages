// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — touch controls (phones, tablets), shown on a touch screen only, over the view:
 *
 * - a joystick: up / down walk forward / back, left / right turn the view; running when pushed
 *   to the edge;
 * - REPAIR (hold it on a machine), USE (doors, the exit switch), the three tools, MAP and PAUSE.
 *
 * They keep their own strips, so that nothing covers the view: below it on a tall screen (a
 * phone upright), at its sides on a wide one (`reserve`).
 *
 * Read by game.ts each tick, merged with the keyboard, the mouse and the gamepad.
 */
import { TOOLS, type ToolId } from './sim.js';

export interface TouchInput {
  forward: number;
  strafe: number;
  run: boolean;
  /** -1..1 turn left / right. */
  turn: number;
  work: boolean;
  /** USE pressed since the last tick. */
  use: boolean;
  tool: ToolId | null;
}

const TOOL_TEXT: Record<ToolId, string> = { wrench: 'Wrench', multimeter: 'Meter', laptop: 'Laptop' };

const CSS = `
.touch { position: absolute; inset: 0; z-index: 2; pointer-events: none; user-select: none; -webkit-user-select: none; }
.touch > * { pointer-events: auto; }
.stick { position: absolute; left: max(16px, env(safe-area-inset-left, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  width: min(34vmin, 150px); aspect-ratio: 1; border-radius: 50%; touch-action: none;
  background: color-mix(in srgb, var(--theme-color-2) 50%, transparent);
  border: 2px solid color-mix(in srgb, var(--theme-color-warning) 70%, transparent); }
.knob { position: absolute; left: 50%; top: 50%; width: 42%; aspect-ratio: 1; border-radius: 50%; transform: translate(-50%, -50%);
  background: var(--theme-color-warning); opacity: 0.85; }
.pad { position: absolute; right: max(16px, env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  display: grid; grid-template-columns: repeat(3, auto); gap: 8px; align-items: end; justify-items: center; }
.pad button, .top button { font: inherit; font-weight: 700; touch-action: none; color: var(--theme-color-std-text);
  border: 2px solid var(--c, var(--theme-color-soft-bdr)); border-radius: 12px; padding: 0;
  background: color-mix(in srgb, var(--theme-color-2) 72%, transparent); }
.pad .tool { width: min(14vmin, 60px); height: min(10vmin, 42px); font-size: 11px; --c: var(--theme-color-soft-bdr); }
.pad .tool.on { --c: var(--theme-color-warning); background: color-mix(in srgb, var(--theme-color-warning) 35%, transparent); }
.pad .repair { grid-column: 1 / 3; width: calc(min(14vmin, 60px) * 2 + 8px); height: min(18vmin, 76px); font-size: 15px; --c: var(--theme-color-success); }
.pad .use { width: min(14vmin, 60px); height: min(18vmin, 76px); font-size: 13px; --c: var(--theme-color-primary); }
.pad button.down { background: color-mix(in srgb, var(--c) 45%, transparent); }
.top { position: absolute; right: max(16px, env(safe-area-inset-right, 0px)); top: 10px; display: flex; flex-direction: row; gap: 8px; }
.stick .mark { position: absolute; font-size: 9px; font-weight: 700; color: var(--theme-color-soft-text); }
.stick .mark.n { top: 4px; left: 50%; transform: translateX(-50%); }
.stick .mark.s { bottom: 4px; left: 50%; transform: translateX(-50%); }
.stick .mark.w { left: 5px; top: 50%; transform: translateY(-50%); }
.stick .mark.e { right: 5px; top: 50%; transform: translateY(-50%); }
.top button { width: min(12vmin, 52px); height: min(9vmin, 36px); font-size: 10px; }
@media (orientation: portrait) {
  .top { top: auto; flex-direction: row; bottom: calc(16px + env(safe-area-inset-bottom, 0px) + min(18vmin, 76px) + min(10vmin, 42px) + 24px); }
}
`;

export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly knob: HTMLElement;
  private readonly toolButtons = new Map<ToolId, HTMLButtonElement>();
  private stickId: number | null = null;
  private state: TouchInput = { forward: 0, strafe: 0, run: false, turn: 0, work: false, use: false, tool: null };

  constructor(
    host: HTMLElement,
    private readonly onMap: () => void,
    private readonly onPause: () => void
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.innerHTML = `<style>${CSS}</style>
      <div class="stick" aria-label="Walk and turn"><span class="mark n">▲</span><span class="mark s">▼</span><span class="mark w">⟲</span><span class="mark e">⟳</span><div class="knob"></div></div>
      <div class="top"><button class="map" aria-label="Map">MAP</button><button class="pause" aria-label="Pause">PAUSE</button></div>
      <div class="pad">
        ${TOOLS.map((t, k) => `<button class="tool" data-tool="${t}">${k + 1} · ${TOOL_TEXT[t]}</button>`).join('')}
        <button class="repair" aria-label="Repair (hold)">REPAIR</button>
        <button class="use" aria-label="Use">USE</button>
      </div>`;
    host.append(this.root);
    this.knob = this.root.querySelector('.knob') as HTMLElement;
    const stick = this.root.querySelector('.stick') as HTMLElement;
    stick.addEventListener('pointerdown', (e) => {
      this.stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      this.moveStick(stick, e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(stick, e);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.setStick(0, 0);
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    // the buttons
    const hold = (el: HTMLButtonElement, on: (down: boolean) => void): void => {
      const set = (down: boolean) => (e: PointerEvent): void => {
        e.preventDefault();
        if (down) el.setPointerCapture(e.pointerId);
        el.classList.toggle('down', down);
        on(down);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold(this.root.querySelector('.repair') as HTMLButtonElement, (d) => (this.state.work = d));
    hold(this.root.querySelector('.use') as HTMLButtonElement, (d) => {
      if (d) this.state.use = true;
    });
    this.root.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
      const tool = b.dataset.tool as ToolId;
      this.toolButtons.set(tool, b);
      hold(b, (d) => {
        if (d) this.state.tool = tool;
      });
    });
    hold(this.root.querySelector('.map') as HTMLButtonElement, (d) => d && this.onMap());
    hold(this.root.querySelector('.pause') as HTMLButtonElement, (d) => d && this.onPause());
  }

  /** Is this a touch screen (or `?touch` in the address, to try it with a mouse)? */
  static wanted(): boolean {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return coarse || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || /[?&]touch\b/.test(location.search);
  }

  private moveStick(stick: HTMLElement, e: PointerEvent): void {
    e.preventDefault();
    const r = stick.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.setStick(x, y);
  }

  private setStick(x: number, y: number): void {
    const dz = (v: number): number => (Math.abs(v) < 0.15 ? 0 : v);
    this.state.forward = -dz(y);
    this.state.turn = dz(x);
    this.state.run = Math.hypot(x, y) > 0.92;
    this.knob.style.left = `${50 + x * 32}%`;
    this.knob.style.top = `${50 + y * 32}%`;
  }

  /** The input since the last tick (the one-shot presses are then cleared). */
  take(): TouchInput {
    const s = { ...this.state };
    this.state.use = false;
    this.state.tool = null;
    return s;
  }

  /**
   * The strips the controls take, CSS pixels, for a host of w × h: below the view on a tall
   * screen, at its left and right on a wide one.
   */
  reserve(w: number, h: number): { left: number; right: number; bottom: number } {
    if (this.root.hidden) return { left: 0, right: 0, bottom: 0 };
    const vmin = Math.min(w, h) / 100;
    const stick = Math.min(34 * vmin, 150);
    const btn = Math.min(14 * vmin, 60);
    if (h > w) return { left: 0, right: 0, bottom: Math.min(h * 0.5, stick + 2 * 16 + 8) };
    return { left: stick + 2 * 16, right: 3 * btn + 2 * 8 + 2 * 16, bottom: 0 };
  }

  /** Shows the tool in hand. */
  showTool(tool: ToolId): void {
    for (const [t, b] of this.toolButtons) b.classList.toggle('on', t === tool);
  }

  /** Lets go of everything (pause, menus). */
  reset(): void {
    this.stickId = null;
    this.setStick(0, 0);
    this.state = { forward: 0, strafe: 0, run: false, turn: 0, work: false, use: false, tool: null };
    this.root.querySelectorAll('button.down').forEach((b) => b.classList.remove('down'));
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.reset();
  }

  dispose(): void {
    this.root.remove();
  }
}
