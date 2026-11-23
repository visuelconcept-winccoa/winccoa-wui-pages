// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A tutorial, as the modules declare it (`tutorial/<id>.json` beside their package.json) and
 * as wui-toolkit (0.30.0 or later) collects it into data/dashboard-wc/wui-tutorials.json —
 * schema `wui-tutorial.schema.json`, the toolkit's docs/REFERENCE.md "A module's tutorials".
 *
 * A step says something (`say`), lights something up (`point`) and waits for at most one action
 * of the operator — `wui tour`'s, so `wui tour --tutorial` replays the same file on the mock:
 *
 *   open    the guide opens the page itself, then speaks (the step waits for "Next")
 *   menu    the operator opens the menu entry with this text (or reaches `route`, when given)
 *   route   the operator reaches this page, by any way
 *   click   the operator clicks the element (or inside it)
 *   type    the operator types this text into this field
 *
 * Without an action, the step waits for "Next". Selectors are looked for in the document and in
 * every shadow root (./deep-query.ts).
 */
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** A text, or the same text in several languages: `{ "fr": "…", "en": "…" }` (`fr.utf8` keys too). */
export type Text = string | Record<string, string>;

/** The mascot's mood: its face during the step. */
export type Mood = 'idle' | 'talk' | 'happy' | 'cheer' | 'think';

export interface Step {
  say: Text;
  mood?: Mood;
  point?: Text;
  open?: string;
  menu?: Text;
  route?: string;
  click?: Text;
  type?: { into: Text; text: Text };
  hint?: { after: number; say: Text };
  next?: Text;
}

export interface Tutorial {
  /** Its file's name: the key of the progress. */
  id: string;
  /** The module that declares it (its page id). */
  module: string;
  title: Text;
  summary?: Text;
  badge?: Text;
  minutes?: number;
  /** Who it is for: Application Security roles (`<module>/<role>`), one of them suffices; absent: everyone. */
  roles?: string[];
  steps: Step[];
}

/** What a step waits for before the next one. */
export type Expect =
  | { kind: 'route'; route: string }
  | { kind: 'menu'; selector: string; route?: string }
  | { kind: 'click'; selector: string }
  | { kind: 'input'; selector: string; value: string };

/** A text in the WebUI's current language (lit-translate's), else English, else the first one. */
export function text(value: Text | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(localize(value) ?? '');
}

/** The text inside a `:has-text('…')`. */
const quoted = (value: string) => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

/** The menu entry with this text: `wui dev`'s menu (links) and the shell's (ix-menu-item). */
export function menuSelector(label: string): string {
  return `nav a:has-text('${quoted(label)}'), ix-menu-item:has-text('${quoted(label)}')`;
}

/** What the step waits for; null: the "Next" button. */
export function expectOf(step: Step, localized: (value: Text | undefined) => string = text): Expect | null {
  if (step.menu) return { kind: 'menu', selector: menuSelector(localized(step.menu)), route: step.route };
  if (step.route) return { kind: 'route', route: step.route };
  if (step.click) return { kind: 'click', selector: localized(step.click) };
  if (step.type) return { kind: 'input', selector: localized(step.type.into), value: localized(step.type.text) };
  return null;
}

/** What the step lights up: its `point`, else its action's target. */
export function pointOf(step: Step, localized: (value: Text | undefined) => string = text): string | undefined {
  if (step.point) return localized(step.point);
  const expect = expectOf(step, localized);
  return expect && expect.kind !== 'route' ? expect.selector : undefined;
}

/** A route (`/msp?p=configuration`) against the address: its path, then each of its query's parameters. */
export function routeMatches(route: string, hash: string): boolean {
  const [expectedPath, expectedQuery = ''] = route.split('?');
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const norm = (p: string) => `/${p.replace(/^\/+|\/+$/g, '')}`;
  if (norm(path) !== norm(expectedPath)) return false;
  const params = new URLSearchParams(query);
  return [...new URLSearchParams(expectedQuery)].every(([key, value]) => params.get(key) === value);
}
