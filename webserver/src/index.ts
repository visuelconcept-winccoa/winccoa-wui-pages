// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Entry point exports
// -----------------------------------------------------------------------------
// This file is the package's main entry point (see "main": "dist/index.js"
// in package.json). It re-exports the classes that run.js needs to start
// the server.
//
// When you add new top-level classes that need to be accessible from run.js,
// export them here.
// -----------------------------------------------------------------------------

export { WsjServerGlobal } from '@winccoa/backend';
export { CustomerDashboardServer } from './customerDashboardServer';
