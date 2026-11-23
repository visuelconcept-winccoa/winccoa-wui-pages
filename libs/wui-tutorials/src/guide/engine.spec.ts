// @vitest-environment jsdom
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { alternatives, parseAlternative } from './deep-query.js';
import { TutorEngine } from './engine.js';
import { expectOf, menuSelector, pointOf, routeMatches, type Text, type Tutorial } from './tutorial.js';

declare global {
  interface ImportMeta {
    /** Vite: the files of a pattern, imported (https://vite.dev/guide/features#glob-import). */
    glob<T>(pattern: string, options: { eager: true; import: 'default' }): Record<string, T>;
  }
}

/** The tests' language: French, else the text as it is. */
const fr = (value: Text | undefined) => (value === undefined ? '' : typeof value === 'string' ? value : (value.fr ?? Object.values(value)[0]));

describe('routeMatches', () => {
  test('the path, then each parameter asked for', () => {
    expect(routeMatches('/msp', '#/msp')).toBe(true);
    expect(routeMatches('/msp', '#/msp?p=configuration')).toBe(true);
    expect(routeMatches('/msp?p=configuration', '#/msp?p=configuration')).toBe(true);
    expect(routeMatches('/msp?p=configuration', '#/msp?p=configuration/articles')).toBe(false);
    expect(routeMatches('/alarms?p=history', '#/alarms?p=history&class=OOS%2CAOS')).toBe(true);
    expect(routeMatches('/msp', '#/mspx')).toBe(false);
    expect(routeMatches('/alarms', '#/alarms/')).toBe(true);
  });
});

describe('selectors', () => {
  test('alternatives: the commas outside quotes and parentheses', () => {
    expect(alternatives("a[href='#/msp'], ix-menu-item:has-text('A, B')")).toEqual(["a[href='#/msp']", "ix-menu-item:has-text('A, B')"]);
  });
  test(':has-text at the end of a selector', () => {
    expect(parseAlternative(".crumb a:has-text('Home')")).toEqual({ css: '.crumb a', text: 'home' });
    expect(parseAlternative('.tiles')).toEqual({ css: '.tiles', text: null });
  });
  test("a menu entry: wui dev's and the shell's, an apostrophe escaped", () => {
    expect(alternatives(menuSelector("L'atelier"))).toEqual(["nav a:has-text('L\\'atelier')", "ix-menu-item:has-text('L\\'atelier')"]);
    expect(parseAlternative(alternatives(menuSelector("L'atelier"))[0])).toEqual({ css: 'nav a', text: "l'atelier" });
  });
});

describe('a step', () => {
  test('what it waits for, and what it lights up', () => {
    expect(expectOf({ say: '', menu: 'MSP', route: '/msp' }, fr)).toEqual({ kind: 'menu', selector: menuSelector('MSP'), route: '/msp' });
    expect(expectOf({ say: '', route: '/msp?p=x' }, fr)).toEqual({ kind: 'route', route: '/msp?p=x' });
    expect(expectOf({ say: '', type: { into: 'input', text: { fr: 'Nord', en: 'North' } } }, fr)).toEqual({ kind: 'input', selector: 'input', value: 'Nord' });
    expect(expectOf({ say: '', open: '/msp' }, fr)).toBeNull();
    expect(pointOf({ say: '', click: '.tile' }, fr)).toBe('.tile');
    expect(pointOf({ say: '', click: '.tile', point: '.tiles' }, fr)).toBe('.tiles');
    expect(pointOf({ say: '', route: '/msp' }, fr)).toBeUndefined();
  });
});

describe("the module's own tutorials", () => {
  // Their contract is checked by `wui test` (wui-toolkit 0.30.0 or later); here, what the browser makes of them.
  const files = Object.entries(import.meta.glob<Tutorial>('../../tutorial/*.json', { eager: true, import: 'default' }));

  test('there are some', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)('%s: selectors the browser understands', (_file, tutorial) => {
    for (const step of tutorial.steps) {
      const expected = expectOf(step, fr);
      for (const selector of [pointOf(step, fr), expected && expected.kind !== 'route' ? expected.selector : undefined]) {
        if (!selector) continue;
        for (const alternative of alternatives(selector)) {
          expect(() => document.querySelector(parseAlternative(alternative).css), alternative).not.toThrow();
        }
      }
    }
  });
});

describe('the engine', () => {
  const tutorial: Tutorial = {
    id: 'trial',
    module: 'tutorials',
    title: 'Trial',
    steps: [
      { say: 'Hello' },
      { say: 'Open MSP', menu: 'MSP', route: '/msp' },
      { say: 'Click', click: '#target' },
      { say: 'Type', type: { into: '#field', text: 'north' } },
      { say: 'Done' }
    ]
  };
  let engine: TutorEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    history.replaceState(null, '', '#/home');
    document.body.innerHTML = '<nav><a href="#/msp">MSP</a></nav><button id="target">Target</button><input id="field">';
    engine = new TutorEngine();
    engine.setTutorials([tutorial]);
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  test('waits for each action asked for, then earns the badge', () => {
    engine.start('trial');
    expect(engine.index).toBe(0);
    engine.next();
    expect(engine.index).toBe(1);

    // As the shell's router does: history.pushState, without hashchange or popstate.
    history.pushState(null, '', '#/msp');
    expect(engine.phase).toBe('step');
    vi.advanceTimersByTime(300);
    expect(engine.phase).toBe('success');
    vi.advanceTimersByTime(1000);
    expect(engine.index).toBe(2);

    document.getElementById('target')!.click();
    vi.advanceTimersByTime(1000);
    expect(engine.index).toBe(3);

    const field = document.getElementById('field') as HTMLInputElement;
    field.value = 'South';
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(engine.phase).toBe('step');
    field.value = 'Station North';
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    vi.advanceTimersByTime(1000);
    expect(engine.index).toBe(4);

    engine.next();
    expect(engine.phase).toBe('finished');
    expect(engine.progress.trial).toBeDefined();
  });

  test('a menu entry: its click is enough, even before the address changes', () => {
    engine.start('trial');
    engine.next();
    const entry = document.querySelector('nav a') as HTMLElement;
    entry.addEventListener('click', (event) => event.preventDefault());
    entry.click();
    expect(engine.phase).toBe('success');
  });

  test('resumes the tutorial a reload interrupted, once the list is loaded', async () => {
    engine.start('trial');
    engine.next();
    const reloaded = new TutorEngine();
    expect(reloaded.tutorial).toBeNull();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ tutorials: [tutorial] })));
    await reloaded.load(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('/data/dashboard-wc/wui-tutorials.json', { cache: 'no-store' });
    expect(reloaded.tutorial?.id).toBe('trial');
    expect(reloaded.index).toBe(1);
    reloaded.stop();
  });

  test('no list (an older toolkit): no tutorial, no error', async () => {
    const empty = new TutorEngine();
    await empty.load((async () => new Response('', { status: 404 })) as unknown as typeof fetch);
    expect(empty.loaded).toBe(true);
    expect(empty.tutorials).toEqual([]);
  });
});
