// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Player settings of City Drive (#79): key bindings, USB gamepad, driving, camera, graphics,
 * display. Kept in the browser (localStorage). Pure, no DOM but `localStorage` in load / save.
 *
 * Gamepad: the browser's Gamepad API with the "standard" mapping (Xbox-like layout; most USB
 * pads are reported this way). See {@link GAMEPAD_LEGEND}.
 */

export type Action = 'up' | 'down' | 'left' | 'right' | 'brake' | 'run' | 'foot' | 'camera' | 'time' | 'reset' | 'mission' | 'pause';

export const ACTIONS: readonly { id: Action; label: string }[] = [
  { id: 'up', label: 'Throttle / walk forward' },
  { id: 'down', label: 'Brake, reverse / walk back' },
  { id: 'left', label: 'Steer left' },
  { id: 'right', label: 'Steer right' },
  { id: 'brake', label: 'Handbrake (drift)' },
  { id: 'run', label: 'Run (on foot)' },
  { id: 'foot', label: 'Get out / get in' },
  { id: 'camera', label: 'Next camera' },
  { id: 'time', label: 'Day / night' },
  { id: 'reset', label: 'Back on the road' },
  { id: 'mission', label: 'New mission' },
  { id: 'pause', label: 'Pause' }
];

export type Quality = 'high' | 'low';
export type Units = 'kmh' | 'mph';

export interface Settings {
  /** Key codes (KeyboardEvent.code) per action; the first one is shown. */
  keys: Record<Action, string[]>;
  gamepad: {
    enabled: boolean;
    /** Stick dead zone, 0..0.5. */
    deadzone: number;
    invertSteer: boolean;
  };
  /** Steering sensitivity, 0.5..1.5 (×). */
  steering: number;
  /** Chase camera distance, 0.7..1.6 (×). */
  cameraDistance: number;
  /** high: shadows, full resolution, bloom; low: for machines without a strong GPU. */
  quality: Quality;
  units: Units;
  showMinimap: boolean;
  showPlayers: boolean;
}

export const DEFAULT_KEYS: Record<Action, string[]> = {
  up: ['KeyW', 'KeyZ', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'KeyQ', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  brake: ['Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  foot: ['KeyF', 'Enter'],
  camera: ['KeyC'],
  time: ['KeyT'],
  reset: ['KeyR'],
  mission: ['KeyN'],
  pause: ['Escape', 'KeyP']
};

export const DEFAULT_SETTINGS: Settings = {
  keys: DEFAULT_KEYS,
  gamepad: { enabled: true, deadzone: 0.15, invertSteer: false },
  steering: 1,
  cameraDistance: 1,
  quality: 'high',
  units: 'kmh',
  showMinimap: true,
  showPlayers: true
};

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Stored settings, repaired field by field (unknown keys dropped, missing ones defaulted). */
export function parseSettings(raw: unknown): Settings {
  const o = isRecord(raw) ? raw : {};
  const keysIn = isRecord(o.keys) ? o.keys : {};
  const keys = Object.fromEntries(
    ACTIONS.map(({ id }) => {
      const list = keysIn[id];
      const codes = Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string' && /^[A-Za-z0-9]+$/.test(c)) : [];
      return [id, codes.length > 0 ? codes.slice(0, 3) : DEFAULT_KEYS[id]];
    })
  ) as Record<Action, string[]>;
  const gp = isRecord(o.gamepad) ? o.gamepad : {};
  return {
    keys,
    gamepad: {
      enabled: gp.enabled !== false,
      deadzone: clamp(gp.deadzone, 0, 0.5, DEFAULT_SETTINGS.gamepad.deadzone),
      invertSteer: gp.invertSteer === true
    },
    steering: clamp(o.steering, 0.5, 1.5, 1),
    cameraDistance: clamp(o.cameraDistance, 0.7, 1.6, 1),
    quality: o.quality === 'low' ? 'low' : 'high',
    units: o.units === 'mph' ? 'mph' : 'kmh',
    showMinimap: o.showMinimap !== false,
    showPlayers: o.showPlayers !== false
  };
}

/** The action bound to a key code, or null. */
export function actionOf(settings: Settings, code: string): Action | null {
  for (const { id } of ACTIONS) if (settings.keys[id].includes(code)) return id;
  return null;
}

/**
 * Binds `code` as the main key of `action`, removing it from any other action (a key does one
 * thing). The action keeps its other keys behind the new one.
 */
export function rebind(settings: Settings, action: Action, code: string): Settings {
  const keys = { ...settings.keys };
  for (const { id } of ACTIONS) keys[id] = keys[id].filter((c) => c !== code);
  keys[action] = [code, ...keys[action]].slice(0, 3);
  for (const { id } of ACTIONS) if (keys[id].length === 0) keys[id] = DEFAULT_KEYS[id].filter((c) => !Object.values(keys).flat().includes(c)).slice(0, 1);
  return { ...settings, keys };
}

/** A key code for people: `KeyW` → W, `ArrowUp` → ↑, `ShiftLeft` → Shift. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const named: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter',
    Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl',
    AltLeft: 'Alt', Tab: 'Tab', Backspace: '⌫'
  };
  return named[code] ?? code;
}

/** Speed in the chosen unit. */
export const speedIn = (kmh: number, units: Units): number => (units === 'mph' ? Math.round(kmh / 1.609) : kmh);

// --- gamepad (standard mapping) ----------------------------------------------------------

/** Buttons of the standard mapping. */
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9 } as const;

export const GAMEPAD_LEGEND: readonly { control: string; action: string }[] = [
  { control: 'RT', action: 'Throttle' },
  { control: 'LT', action: 'Brake / reverse' },
  { control: 'Left stick', action: 'Steer · walk' },
  { control: 'A', action: 'Handbrake · run on foot' },
  { control: 'B', action: 'Get out / get in' },
  { control: 'Y', action: 'Next camera' },
  { control: 'X', action: 'New mission' },
  { control: 'LB', action: 'Day / night' },
  { control: 'RB', action: 'Back on the road' },
  { control: 'Start', action: 'Pause' }
];

/** One reading of a pad: analog controls and the buttons pressed. */
export interface PadState {
  throttle: number;
  brake: number;
  /** -1 (left) .. 1 (right), after dead zone. */
  steer: number;
  /** -1 (back) .. 1 (forward), after dead zone (walking). */
  move: number;
  handbrake: boolean;
  /** Buttons that went down since the previous reading, as actions. */
  pressed: Action[];
}

/** Applies the dead zone and rescales the rest to 0..1. */
export function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return (Math.sign(v) * (a - dz)) / (1 - dz);
}

/** Minimal shape of a browser Gamepad (testable without the DOM). */
export interface PadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

/** Reads a pad; `previous` is the buttons-pressed state of the last reading (updated in place). */
export function readPad(pad: PadLike, s: Settings, previous: boolean[]): PadState {
  const b = (i: number): { pressed: boolean; value: number } => pad.buttons[i] ?? { pressed: false, value: 0 };
  const edges: Action[] = [];
  const edge = (i: number, action: Action): void => {
    const now = b(i).pressed;
    if (now && !previous[i]) edges.push(action);
    previous[i] = now;
  };
  edge(BTN.B, 'foot');
  edge(BTN.Y, 'camera');
  edge(BTN.X, 'mission');
  edge(BTN.LB, 'time');
  edge(BTN.RB, 'reset');
  edge(BTN.START, 'pause');
  const steer = deadzone(pad.axes[0] ?? 0, s.gamepad.deadzone) * (s.gamepad.invertSteer ? -1 : 1);
  return {
    throttle: b(BTN.RT).value,
    brake: b(BTN.LT).value,
    steer,
    move: -deadzone(pad.axes[1] ?? 0, s.gamepad.deadzone),
    handbrake: b(BTN.A).pressed,
    pressed: edges
  };
}

const SETTINGS_KEY = 'wui-city-drive.settings';

export function loadSettings(): Settings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'));
  } catch {
    return parseSettings({});
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // private window: the settings last for this visit
  }
}
