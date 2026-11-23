// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Finding a tutorial's target through the shadow roots: `document.querySelector` does not see
 * inside the pages (Lit elements), where nearly every target is.
 *
 *   - alternatives separated by commas: the first one that finds a visible element wins
 *     (`a[href='#/msp'], ix-menu-item:has-text('MSP')`) — `wui dev`'s menu and the shell's do
 *     not have the same markup;
 *   - each alternative is looked for in the document, then in every open shadow root: it must
 *     hold within one root (`.tile[title='Configuration']` inside the page's element);
 *   - `:has-text('…')` at the end of an alternative keeps the elements whose shown text contains
 *     it (case and spaces ignored), as Playwright's selector of that name.
 */

/** Every root to look in: the document and each open shadow root, depth first. */
function roots(): (Document | ShadowRoot)[] {
  const found: (Document | ShadowRoot)[] = [document];
  for (let i = 0; i < found.length; i++) {
    for (const element of found[i].querySelectorAll('*')) {
      if (element.shadowRoot) found.push(element.shadowRoot);
    }
  }
  return found;
}

/** A selector's alternatives: its commas outside quotes, brackets and parentheses; `\` escapes. */
export function alternatives(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  let escaped = false;
  for (const char of selector) {
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (quote) {
      if (char === quote) quote = '';
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/** `ix-button:has-text('Save')` → `{ css: 'ix-button', text: 'save' }`. */
export function parseAlternative(alternative: string): { css: string; text: string | null } {
  const match = /^(.*?):has-text\((['"])(.*)\2\)\s*$/.exec(alternative);
  if (!match) return { css: alternative, text: null };
  return { css: match[1].trim() || '*', text: normalize(match[3].replace(/\\(.)/g, '$1')) };
}

/** An element's shown text, its shadow root's included (an ix-button renders its label in a slot). */
function shownText(element: Element): string {
  const own = (element as HTMLElement).innerText ?? element.textContent ?? '';
  const shadow = element.shadowRoot?.textContent ?? '';
  return normalize(`${own} ${shadow}`);
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** The first visible element the selector names, or null. An invalid selector finds nothing. */
export function deepQuery(selector: string): Element | null {
  const all = roots();
  for (const alternative of alternatives(selector)) {
    const { css, text } = parseAlternative(alternative);
    for (const root of all) {
      let candidates: NodeListOf<Element>;
      try {
        candidates = root.querySelectorAll(css);
      } catch {
        console.warn(`[wui-tutorials] invalid selector: ${alternative}`);
        break;
      }
      for (const element of candidates) {
        if (text !== null && !shownText(element).includes(text)) continue;
        if (isVisible(element)) return element;
      }
    }
  }
  return null;
}

/** True when the event went through an element the selector names (the target or a parent). */
export function eventHits(event: Event, selector: string): boolean {
  const parsed = alternatives(selector).map(parseAlternative);
  return event.composedPath().some(
    (node) =>
      node instanceof Element &&
      parsed.some(({ css, text }) => {
        try {
          return node.matches(css) && (text === null || shownText(node).includes(text));
        } catch {
          return false;
        }
      })
  );
}
