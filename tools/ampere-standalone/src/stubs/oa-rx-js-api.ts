// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
// Harness stub: constructing the API throws, so every `container.resolve(OaRxJsApi)`
// (always wrapped in try/catch by the pages) yields the clean offline path.
export class OaRxJsApi {
  constructor() {
    throw new Error('standalone harness: no WinCC OA backend');
  }
}
