// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Preview stub for @wincc-oa/wui-oarxjs-context wui-context-generator — a
// passthrough container that just holds the `.config` the page assigns
// (wui-content-header reads it back). Children render in the light DOM.

class WuiContextGenerator extends HTMLElement {
  set config(value) {
    this._config = value;
  }

  get config() {
    return this._config;
  }

  connectedCallback() {
    this.style.display = 'block';
  }
}

if (!customElements.get('wui-context-generator')) {
  customElements.define('wui-context-generator', WuiContextGenerator);
}
