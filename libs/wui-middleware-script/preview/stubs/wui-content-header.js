// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Preview stub for @wincc-oa/wui-ix-wrappers wui-content-header — renders the
// page title resolved from the enclosing wui-context-generator's config
// (headerTitle translate map), roughly like the shell header.
import { localize } from './localize-multilang.js';

class WuiContentHeader extends HTMLElement {
  connectedCallback() {
    // The Lit template sets the generator's .config after children mount.
    requestAnimationFrame(() => {
      const generator = this.closest('wui-context-generator');
      const config = generator?.config?.headerTitle?.config ?? {};
      this.textContent = localize(config) || 'Preview';
      this.style.cssText =
        'display:block;padding:0.75rem 1rem;font-size:1.25rem;font-weight:600;color:var(--theme-color-std-text);';
    });
  }
}

if (!customElements.get('wui-content-header')) {
  customElements.define('wui-content-header', WuiContentHeader);
}
