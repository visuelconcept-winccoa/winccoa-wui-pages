// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Same first import as the app shell (`apps/dashboard-wc/src/main.ts`): tsyringe —
// which the kit's data modules use for DI — refuses to load without the reflect
// polyfill. The tests exercise pure logic, but they import modules that reach it.
import 'reflect-metadata';
