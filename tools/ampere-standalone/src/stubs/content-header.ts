// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
// Minimal look-alike of the shell's content header for standalone screenshots.
class HarnessContentHeader extends HTMLElement {
  connectedCallback() {
    this.style.cssText = 'display:block;padding:0.9rem 1rem;font-size:1.35rem;font-weight:700;';
    this.textContent = 'Ampère — Réseaux électriques';
  }
}
if (!customElements.get('wui-content-header')) customElements.define('wui-content-header', HarnessContentHeader);
