// @vitest-environment jsdom
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// <wui-fleet-3d-view> with the three.js scene stubbed (SceneController: no
// WebGL in jsdom), the role stream, the backend (fetch) and the live datapoint
// API scripted: its states without a scene, the page's own view rendered in its
// display-only mode, and everything released when the element leaves the DOM.

import { BehaviorSubject, Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const role = vi.hoisted(() => ({ view: null as unknown as BehaviorSubject<boolean> }));
const scenes = vi.hoisted(
  () => [] as { canvas: HTMLCanvasElement; disposed: boolean; started: number; stopped: number }[]
);
const live = vi.hoisted(() => ({ subscribed: 0, connects: [] as string[][] }));
const observers = vi.hoisted(() => ({ active: 0 }));

vi.mock('./machine-fleet-3d/scene/scene-controller.js', () => ({
  SceneController: class {
    constructor(canvas: HTMLCanvasElement) {
      const record = { canvas, disposed: false, started: 0, stopped: 0 };
      scenes.push(record);
      const own: Record<string, unknown> = {
        start: () => (record.started += 1),
        stop: () => (record.stopped += 1),
        dispose: () => (record.disposed = true),
        getMachine: () => undefined,
        captureView: () => ({ pos: [0, 0, 0], target: [0, 0, 0] })
      };
      // Every other scene call is a no-op.
      return new Proxy(own, { get: (target, key: string) => (key in target ? target[key] : () => undefined) });
    }
  }
}));
vi.mock('@visuelconcept-winccoa/wui-kit/data/app-security.js', () => ({
  hasRole$: (_module: string, roleId: string) => (roleId === 'view' ? role.view : new BehaviorSubject(true))
}));
vi.mock('./machine-fleet-3d/data/fleet-store.js', () => ({
  FleetStore: class {
    readResourceDataUrl = async (): Promise<undefined> => undefined;
  }
}));
vi.mock('./machine-fleet-3d/data/ali-assets.js', () => ({
  AliAssetReader: class {
    list = async (): Promise<unknown[]> => [];
  }
}));
// English, whatever the shell's language service (none in a test).
vi.mock('@wincc-oa/wui-i18n-shared/localize-multilang.js', () => {
  const localize = (s: string | Record<string, string>): string => (typeof s === 'string' ? s : (s['en_US.utf8'] ?? ''));
  return { localize, localizeDir: localize };
});
vi.mock('@etm-professional-control/oa-rx-js-api', () => ({ OaRxJsApi: class {} }));
vi.mock('@wincc-oa/wui-dashboard-data/services/dashboard/dashboard.service.js', () => ({ DashboardService: class {} }));
vi.mock('@wincc-oa/wui-models/events/router-event.js', () => ({ RouterEvent: class extends Event {} }));
vi.mock('tsyringe', () => ({
  container: {
    resolve: () => ({
      dpGet: () => of(2),
      dpConnect: (dps: string[]) => {
        live.connects.push(dps);
        return new Observable(() => {
          live.subscribed += 1;
          return () => (live.subscribed -= 1);
        });
      }
    })
  }
}));
// The editing dialogs and overlays of the page: not part of the display-only view.
vi.mock('./machine-fleet-3d/ui/mf-ai-prompt.js', () => ({}));
vi.mock('./machine-fleet-3d/ui/mf-building-dialog.js', () => ({}));
vi.mock('./machine-fleet-3d/ui/mf-graphics-catalog.js', () => ({}));
vi.mock('./machine-fleet-3d/ui/mf-machine-dashboard.js', () => ({}));
vi.mock('./machine-fleet-3d/ui/mf-machine-dialog.js', () => ({}));
vi.mock('./machine-fleet-3d/ui/mf-state-mapping-dialog.js', () => ({}));
vi.mock('./machine-fleet-3d/ui/mf-trs-thresholds-dialog.js', () => ({}));
vi.mock('@visuelconcept-winccoa/wui-kit/ui/wui-confirm-dialog.js', () => ({}));

class FakeObserver {
  constructor(_callback: unknown) {}
  observe(): void {
    observers.active += 1;
  }
  disconnect(): void {
    observers.active -= 1;
  }
}

await import('./fleet-view');

type Reply = { status: number; body?: unknown } | Error;
let replies: Record<string, Reply> = {};
const calls: string[] = [];

const ATELIER = {
  id: 'usinage',
  name: 'Atelier usinage',
  building: { length: 120, width: 80, height: 12, bays: 2, roofType: 'flat', colStep: 20 },
  display: { roof: true, labels: true, alertOnly: false },
  mappings: [],
  machines: [
    { id: 'm1', name: 'Tour 1', type: 'tour', x: 0, z: 0, state: 'ok', stateDp: 'Sim_m1.state', kpis: [] },
    { id: 'm2', name: 'Four 2', type: 'four', x: 10, z: 0, state: 'ok', stateDp: 'Sim_m2.state', kpis: [] }
  ]
};

const tick = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type FleetView = HTMLElement & { viewState: string; requestFullscreen: () => Promise<void> };

function mount(id: string | null = 'usinage', attrs: string[] = ['fill']): FleetView {
  const el = document.createElement('wui-fleet-3d-view') as FleetView;
  if (id !== null) el.setAttribute('atelier', id);
  for (const attr of attrs) el.setAttribute(attr, '');
  document.body.append(el);
  return el;
}

const notice = (el: HTMLElement): string | null =>
  el.shadowRoot?.querySelector('.notice')?.getAttribute('data-state') ?? null;
const view = (el: HTMLElement): HTMLElement | null => el.shadowRoot?.querySelector('mf-atelier-view') ?? null;
const icons = (el: HTMLElement): string[] =>
  [...(view(el)?.shadowRoot?.querySelectorAll('ix-icon-button') ?? [])].map((b) => b.getAttribute('icon') ?? '');

beforeEach(() => {
  role.view = new BehaviorSubject(true);
  scenes.length = 0;
  calls.length = 0;
  live.subscribed = 0;
  live.connects.length = 0;
  observers.active = 0;
  replies = {
    '/api/ai/fleet/workshops/usinage': { status: 200, body: { ok: true, atelier: ATELIER, stopCauses: [] } },
    '/api/ai/fleet/workshops/gone': { status: 404, body: { ok: false, error: 'not-found' } },
    '/api/ai/fleet/workshops/secret': { status: 403, body: { ok: false, error: "forbidden: role 'view' of 'machine-fleet-3d' required" } }
  };
  vi.stubGlobal('ResizeObserver', FakeObserver);
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const reply = replies[url] ?? { status: 404, body: '<html>' };
      if (reply instanceof Error) throw reply;
      return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status });
    })
  );
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('<wui-fleet-3d-view>', () => {
  it('is defined once, with a guard (a second import does not throw)', async () => {
    await expect(import('./fleet-view')).resolves.toBeTruthy();
    expect(customElements.get('wui-fleet-3d-view')).toBeTruthy();
  });

  it('without an atelier id: a notice, no request, no scene', async () => {
    const el = mount(null);
    await tick();
    expect(el.viewState).toBe('not-found');
    expect(el.shadowRoot?.textContent).toContain('No atelier selected');
    expect(calls).toEqual([]);
    expect(scenes).toHaveLength(0);
  });

  it('without the view role (client grant): forbidden, no request, no scene', async () => {
    role.view.next(false);
    const el = mount();
    await tick();
    expect(notice(el)).toBe('forbidden');
    expect(calls).toEqual([]);
    expect(scenes).toHaveLength(0);
  });

  it('maps the server answers: 403 → forbidden, 404 → not found, no JSON / network → unavailable with Retry', async () => {
    const forbidden = mount('secret');
    const gone = mount('gone');
    const unmounted = mount('elsewhere'); // HTML 404: the backend is not mounted
    await tick();
    expect(notice(forbidden)).toBe('forbidden');
    expect(notice(gone)).toBe('not-found');
    expect(gone.shadowRoot?.textContent).toContain('no longer exists');
    expect(notice(unmounted)).toBe('unavailable');
    expect(scenes).toHaveLength(0);

    replies['/api/ai/fleet/workshops/elsewhere'] = { status: 200, body: { ok: true, atelier: { ...ATELIER, id: 'elsewhere' }, stopCauses: [] } };
    (unmounted.shadowRoot?.querySelector('.notice ix-button') as HTMLElement).click();
    await tick();
    expect(unmounted.viewState).toBe('ready');
    expect(scenes).toHaveLength(1);
  });

  it('renders the page’s view, display only: live states, no editing, no management, no navigation away', async () => {
    const el = mount();
    await tick();
    expect(el.viewState).toBe('ready');
    expect(calls).toEqual(['/api/ai/fleet/workshops/usinage']);
    const inner = view(el);
    expect(inner?.hasAttribute('display-only')).toBe(true);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].started).toBeGreaterThan(0);
    // One dpConnect block for the bound datapoints.
    expect(live.connects).toEqual([['Sim_m1.state', 'Sim_m2.state']]);
    expect(live.subscribed).toBe(1);
    expect(inner?.shadowRoot?.textContent).toContain('Atelier usinage');
    const shown = icons(el);
    for (const absent of ['arrow-left', 'pen', 'trashcan', 'move', 'upload', 'download', 'box-open', 'building1', 'configuration']) {
      expect(shown, absent).not.toContain(absent);
    }
    for (const present of ['undo', 'home', 'label', 'warning', 'screenshot', 'app-menu', 'maximize', 'zoom-in']) {
      expect(shown, present).toContain(present);
    }
    expect(inner?.shadowRoot?.querySelector('mf-ai-prompt')).toBeNull();
  });

  it('never saves: a display toggle stays local', async () => {
    const el = mount();
    await tick();
    const saves: Event[] = [];
    el.addEventListener('wui:save', (e) => saves.push(e));
    view(el)?.addEventListener('wui:save', (e) => saves.push(e));
    (view(el)?.shadowRoot?.querySelector('ix-icon-button[icon="label"]') as HTMLElement).click();
    await tick(700);
    expect(saves).toEqual([]);
  });

  it('the machine list only focuses machines (no view / edit / delete / add)', async () => {
    const el = mount();
    await tick();
    (view(el)?.shadowRoot?.querySelector('ix-icon-button[icon="app-menu"]') as HTMLElement).click();
    await tick();
    const panel = view(el)?.shadowRoot?.querySelector('mf-config-panel');
    expect(panel?.shadowRoot?.querySelectorAll('.row')).toHaveLength(2);
    expect(panel?.shadowRoot?.querySelector('.row ix-icon-button')).toBeNull();
    expect(panel?.shadowRoot?.querySelector('.add')).toBeNull();
  });

  it('hide-toolbar and hide-nav hide the top bar and the navigation pad', async () => {
    const el = mount('usinage', ['fill', 'hide-toolbar', 'hide-nav']);
    await tick();
    const root = view(el)?.shadowRoot;
    expect(root?.querySelector('canvas')).not.toBeNull();
    expect(root?.querySelector('.topbar')).toBeNull();
    expect(root?.querySelector('.nav')).toBeNull();
  });

  it('releases the scene, the live subscription and the observers when it leaves the DOM; rebuilds on return', async () => {
    const el = mount();
    await tick();
    expect(observers.active).toBe(2);
    el.remove();
    await tick();
    expect(scenes[0].disposed).toBe(true);
    expect(live.subscribed).toBe(0);
    expect(observers.active).toBe(0);
    expect(el.viewState).toBe('idle');
    expect(view(el)).toBeNull();

    document.body.append(el);
    await tick();
    expect(el.viewState).toBe('ready');
    expect(scenes).toHaveLength(2);
    expect(scenes[1].disposed).toBe(false);
    expect(live.subscribed).toBe(1);
  });

  it('a request still in flight when it leaves the DOM builds nothing', async () => {
    let answer: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    const el = mount();
    await tick();
    el.remove();
    answer(new Response(JSON.stringify({ ok: true, atelier: ATELIER, stopCauses: [] })));
    await tick();
    expect(scenes).toHaveLength(0);
    expect(el.viewState).toBe('idle');
  });

  it('a revoked view role removes the scene; granted again, it comes back', async () => {
    const el = mount();
    await tick();
    role.view.next(false);
    await tick();
    expect(notice(el)).toBe('forbidden');
    expect(scenes[0].disposed).toBe(true);
    expect(live.subscribed).toBe(0);
    role.view.next(true);
    await tick();
    expect(el.viewState).toBe('ready');
    expect(scenes).toHaveLength(2);
  });

  it('changing the atelier releases the scene and loads the new one', async () => {
    replies['/api/ai/fleet/workshops/soudage'] = { status: 200, body: { ok: true, atelier: { ...ATELIER, id: 'soudage', name: 'Soudage' }, stopCauses: [] } };
    const el = mount();
    await tick();
    el.setAttribute('atelier', 'soudage');
    await tick();
    expect(scenes[0].disposed).toBe(true);
    expect(scenes).toHaveLength(2);
    expect(view(el)?.shadowRoot?.textContent).toContain('Soudage');
  });

  it('full screen: the toggle requests it on the element, its icon follows the element’s own root — nested shadow roots included', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const el = document.createElement('wui-fleet-3d-view') as FleetView;
    el.setAttribute('atelier', 'usinage');
    el.requestFullscreen = vi.fn(async () => undefined);
    shadow.append(el);
    await tick();
    (view(el)?.shadowRoot?.querySelector('ix-icon-button[icon="maximize"]') as HTMLElement).click();
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);

    // The browser retargets: the document sees the outer host, the shadow root sees the element.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => host });
    Object.defineProperty(shadow, 'fullscreenElement', { configurable: true, get: () => el });
    document.dispatchEvent(new Event('fullscreenchange'));
    await tick();
    expect(icons(el)).toContain('minimize');

    // The host page itself in full screen: not this element.
    Object.defineProperty(shadow, 'fullscreenElement', { configurable: true, get: () => null });
    document.dispatchEvent(new Event('fullscreenchange'));
    await tick();
    expect(icons(el)).toContain('maximize');
    Reflect.deleteProperty(document, 'fullscreenElement');
  });
});
