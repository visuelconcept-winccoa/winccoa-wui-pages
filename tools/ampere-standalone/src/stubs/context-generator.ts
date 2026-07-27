// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
// Pass-through stand-in: children render in light DOM, context config ignored.
class HarnessContextGenerator extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block';
  }
}
if (!customElements.get('wui-context-generator')) customElements.define('wui-context-generator', HarnessContextGenerator);
