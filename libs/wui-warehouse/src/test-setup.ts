// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// tsyringe (pulled in by the DP stores) requires the reflect polyfill before
// its first import. The app shell provides it at runtime; tests provide it here.
import 'reflect-metadata';
