// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The tutorials' engine: the site's tutorials, the one being played, its step, and the wait for
 * the action the step asks for.
 *
 * The tutorials are the deployed modules': data/dashboard-wc/wui-tutorials.json, written by
 * `wui build` and served by `wui dev` (wui-toolkit 0.30.0 or later) from each module's
 * `tutorial/<id>.json`. No file (an older toolkit): no tutorial, no error.
 *
 * One instance per window (`tutorEngine`), shared by the bundles that import it: the module's
 * boot script in the shell (data/dashboard-wc/boot/tutorials.js) and its page
 * (pages/tutorials.js) are two bundles, each with its own copy of this code.
 *
 * The tutorial being played and its step survive a reload (localStorage), as the badges earned
 * do — the workstation's, not the user's.
 */
import { eventHits } from './deep-query.js';
import { expectOf, routeMatches, type Step, type Tutorial } from './tutorial.js';

const MANIFEST_URL = '/data/dashboard-wc/wui-tutorials.json';
const SESSION_KEY = 'wui-tutorials.session';
const PROGRESS_KEY = 'wui-tutorials.progress';
/** Time to enjoy a step done before the next one. */
const SUCCESS_DELAY_MS = 900;
/** How often the address is read: the only sign of a navigation by `history.pushState`. */
const LOCATION_POLL_MS = 250;

export interface Earned {
  at: string;
}

export type Phase = 'off' | 'step' | 'success' | 'finished';

function readJson<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage refused (private browsing): the tutorial goes on, without resuming.
  }
}

/**
 * Calls `changed` at each change of address, and returns what stops it. The shell's router
 * (@wincc-oa/wui-router) navigates by `history.pushState`, which fires neither `hashchange` nor
 * `popstate`: the address is read regularly too. `wui dev`'s harness writes `location.hash`.
 */
function watchLocation(changed: () => void): () => void {
  let last = location.href;
  const check = () => {
    if (location.href === last) return;
    last = location.href;
    changed();
  };
  window.addEventListener('hashchange', check);
  window.addEventListener('popstate', check);
  const timer = setInterval(check, LOCATION_POLL_MS);
  return () => {
    window.removeEventListener('hashchange', check);
    window.removeEventListener('popstate', check);
    clearInterval(timer);
  };
}

export class TutorEngine extends EventTarget {
  tutorials: readonly Tutorial[] = [];
  /** The list is loaded (or failed to: it stays empty). */
  loaded = false;
  tutorial: Tutorial | null = null;
  index = 0;
  phase: Phase = 'off';
  /** The step's hint is shown. */
  hintShown = false;

  private loading: Promise<void> | null = null;
  private disarm: (() => void)[] = [];

  get step(): Step | null {
    return this.tutorial?.steps[this.index] ?? null;
  }

  get progress(): Record<string, Earned> {
    return readJson<Record<string, Earned>>(PROGRESS_KEY, {});
  }

  /** Loads the list of tutorials (once), then resumes the one a reload interrupted. */
  load(fetcher: typeof fetch = fetch): Promise<void> {
    this.loading ??= fetcher(MANIFEST_URL, { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ tutorials?: Tutorial[] }>) : { tutorials: [] }))
      .then((manifest) => this.setTutorials(manifest.tutorials ?? []))
      .catch(() => this.setTutorials([]));
    return this.loading;
  }

  /** The list of tutorials, without loading it (tests). */
  setTutorials(tutorials: readonly Tutorial[]): void {
    this.tutorials = tutorials.filter((tutorial) => tutorial && typeof tutorial.id === 'string' && Array.isArray(tutorial.steps) && tutorial.steps.length > 0);
    this.loaded = true;
    this.resume();
    this.changed();
  }

  /** Resumes the tutorial a reload interrupted. */
  private resume(): void {
    if (this.tutorial) return;
    const saved = readJson<{ id: string; index: number } | null>(SESSION_KEY, null);
    const tutorial = saved && this.tutorials.find((candidate) => candidate.id === saved.id);
    if (tutorial) this.go(tutorial, Math.min(saved.index, tutorial.steps.length - 1));
  }

  start(id: string): void {
    const tutorial = this.tutorials.find((candidate) => candidate.id === id);
    if (tutorial) this.go(tutorial, 0);
  }

  /** "Next" on a step without action, or "Skip" on a step one is stuck on. */
  next(): void {
    if (this.phase !== 'step' || !this.tutorial) return;
    this.advance();
  }

  previous(): void {
    if (this.tutorial && this.index > 0) this.go(this.tutorial, this.index - 1);
  }

  stop(): void {
    this.clear();
    this.tutorial = null;
    this.phase = 'off';
    writeJson(SESSION_KEY, null);
    this.changed();
  }

  resetProgress(): void {
    writeJson(PROGRESS_KEY, null);
    this.changed();
  }

  private go(tutorial: Tutorial, index: number): void {
    this.clear();
    this.tutorial = tutorial;
    this.index = index;
    this.phase = 'step';
    this.hintShown = false;
    writeJson(SESSION_KEY, { id: tutorial.id, index });
    this.arm(tutorial.steps[index]);
    this.changed();
  }

  /** The action asked for is done: a moment of success, then the next step. */
  private succeed(): void {
    if (this.phase !== 'step') return;
    this.clear();
    this.phase = 'success';
    this.changed();
    const timer = setTimeout(() => this.advance(), SUCCESS_DELAY_MS);
    this.disarm.push(() => clearTimeout(timer));
  }

  private advance(): void {
    const tutorial = this.tutorial;
    if (!tutorial) return;
    if (this.index + 1 < tutorial.steps.length) {
      this.go(tutorial, this.index + 1);
      return;
    }
    this.clear();
    writeJson(PROGRESS_KEY, { ...this.progress, [tutorial.id]: { at: new Date().toISOString() } });
    writeJson(SESSION_KEY, null);
    this.phase = 'finished';
    this.changed();
  }

  /** Opens the step's page, and watches for the action it waits for. */
  private arm(step: Step): void {
    if (step.open && !routeMatches(step.open, location.hash)) location.hash = `#${step.open}`;
    if (step.hint) {
      const timer = setTimeout(() => {
        this.hintShown = true;
        this.changed();
      }, step.hint.after * 1000);
      this.disarm.push(() => clearTimeout(timer));
    }
    const expect = expectOf(step);
    if (!expect) return;

    // A page reached: `route`, or where the menu entry leads.
    const route = expect.kind === 'route' ? expect.route : expect.kind === 'menu' ? expect.route : undefined;
    if (route) {
      const check = () => {
        if (routeMatches(route, location.hash)) this.succeed();
      };
      this.disarm.push(watchLocation(check));
      // Already on the page: done at once, after the time to read the instruction.
      if (routeMatches(route, location.hash)) {
        const timer = setTimeout(check, 1500);
        this.disarm.push(() => clearTimeout(timer));
      }
    }
    if (expect.kind === 'click' || expect.kind === 'menu') {
      const onClick = (event: Event) => {
        if (eventHits(event, expect.selector)) this.succeed();
      };
      // Capturing: seen before a handler of the page stops it.
      document.addEventListener('click', onClick, true);
      this.disarm.push(() => document.removeEventListener('click', onClick, true));
    } else if (expect.kind === 'input') {
      const onInput = (event: Event) => {
        if (!eventHits(event, expect.selector)) return;
        const field = event.composedPath()[0] as { value?: unknown };
        const value = typeof field.value === 'string' ? field.value : '';
        if (value.toLowerCase().includes(expect.value.toLowerCase())) this.succeed();
      };
      document.addEventListener('input', onInput, true);
      this.disarm.push(() => document.removeEventListener('input', onInput, true));
    }
  }

  private clear(): void {
    for (const off of this.disarm.splice(0)) off();
  }

  private changed(): void {
    this.dispatchEvent(new Event('change'));
  }
}

const GLOBAL_KEY = Symbol.for('wui-tutorials.engine');
const shared = globalThis as unknown as Record<symbol, TutorEngine | undefined>;
/** The window's engine, the same for every bundle. */
export const tutorEngine: TutorEngine = (shared[GLOBAL_KEY] ??= new TutorEngine());
