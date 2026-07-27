// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Preview entry — seeds the demo environment, then loads the REAL page code.
// The @wincc-oa/* / @visuelconcept/wui-kit / oa-rx-js-api imports inside the
// page are redirected to ./stubs/* by build.mjs (esbuild aliases); lit, rxjs,
// tsyringe and the Siemens iX components are the real packages.
import 'reflect-metadata';
import './seed.js';
import '../src/middleware-script.ts';
