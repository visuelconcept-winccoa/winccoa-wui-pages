// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
//
// Harness entry: register Siemens iX, register the harness stubs, mount
// <wui-ampere>. Route is driven by the `?network=<id>` query param and by the
// page's own navigation events (RouterEvent stub -> 'harness:route').
import 'reflect-metadata';
import '@siemens/ix/dist/siemens-ix/siemens-ix.css';
import { defineCustomElements as defineIx } from '@siemens/ix/loader';
import { defineCustomElements as defineIxIcons } from '@siemens/ix-icons/loader';
import './stubs/content-header.ts';
import './stubs/context-generator.ts';
import '../../../libs/wui-ampere/src/ampere.ts';

defineIx();
defineIxIcons();

const app = document.getElementById('app')!;
const el = document.createElement('wui-ampere');
app.appendChild(el);

function applyRoute(path: string): void {
  const m = path.match(/^\/ampere\/(.+)$/);
  if (m) el.setAttribute('networkid', decodeURIComponent(m[1]));
  else el.removeAttribute('networkid');
}

// initial route from ?network=<id>
const q = new URLSearchParams(location.search);
const initial = q.get('network');
if (initial) el.setAttribute('networkid', initial);

// follow the page's own navigation (list -> open network -> back)
window.addEventListener('harness:route', ((e: CustomEvent<{ path: string }>) => {
  applyRoute(e.detail.path);
}) as EventListener);
