// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Minimal XML reader — the SHARED one of the engineering core: used by the
 * SimaticML parser (TIA Openness `Export()`) and by the Schneider XVM/XSY
 * reader (`../schneider/xvm.ts`).
 *
 * Deliberately dependency-free so wui-eng-core stays pure and testable in any
 * JS runtime (no DOMParser in Node, no external package to vendor). Supports
 * exactly what SimaticML block/UDT exports need: elements, attributes, text,
 * CDATA, comments, XML declaration/processing instructions, and entity
 * decoding (&amp; &lt; &gt; &quot; &apos; and numeric &#…;). NOT a general
 * XML parser — no DTD, no namespaces resolution (prefixes are kept verbatim
 * in the tag name).
 */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text/CDATA content (entity-decoded, trimmed). */
  text: string;
}

/** Decode the five predefined entities + numeric character references. */
function decodeEntities(raw: string): string {
  return raw.replaceAll(/&(#x?[\dA-Fa-f]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    }
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return named[body] ?? whole;
  });
}

/**
 * Parse an XML document string into its root {@link XmlNode}.
 * Throws an Error with a character offset on malformed input.
 */
export function parseXml(input: string): XmlNode {
  let pos = 0;
  const fail = (message: string): never => {
    throw new Error(`XML parse error at offset ${pos}: ${message}`);
  };

  const skipMisc = (): void => {
    for (;;) {
      while (pos < input.length && /\s/.test(input[pos])) pos += 1;
      if (input.startsWith('<?', pos)) {
        const end = input.indexOf('?>', pos);
        if (end === -1) fail('unterminated processing instruction');
        pos = end + 2;
        continue;
      }
      if (input.startsWith('<!--', pos)) {
        const end = input.indexOf('-->', pos);
        if (end === -1) fail('unterminated comment');
        pos = end + 3;
        continue;
      }
      return;
    }
  };

  const parseAttrs = (): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (;;) {
      while (pos < input.length && /\s/.test(input[pos])) pos += 1;
      const ch = input[pos];
      if (ch === '/' || ch === '>' || ch === undefined) return attrs;
      const nameMatch = /^[^\s=/>]+/.exec(input.slice(pos));
      if (!nameMatch) fail('attribute name expected');
      const name = nameMatch![0];
      pos += name.length;
      while (pos < input.length && /\s/.test(input[pos])) pos += 1;
      if (input[pos] !== '=') fail(`'=' expected after attribute '${name}'`);
      pos += 1;
      while (pos < input.length && /\s/.test(input[pos])) pos += 1;
      const quote = input[pos];
      if (quote !== '"' && quote !== "'") fail(`quoted value expected for '${name}'`);
      pos += 1;
      const end = input.indexOf(quote, pos);
      if (end === -1) fail(`unterminated value for '${name}'`);
      attrs[name] = decodeEntities(input.slice(pos, end));
      pos = end + 1;
    }
  };

  const parseElement = (): XmlNode => {
    if (input[pos] !== '<') fail('element expected');
    pos += 1;
    const nameMatch = /^[^\s/>]+/.exec(input.slice(pos));
    if (!nameMatch) fail('tag name expected');
    const tag = nameMatch![0];
    pos += tag.length;
    const attrs = parseAttrs();
    const node: XmlNode = { tag, attrs, children: [], text: '' };
    if (input.startsWith('/>', pos)) {
      pos += 2;
      return node;
    }
    if (input[pos] !== '>') fail(`'>' expected to close <${tag}>`);
    pos += 1;

    const textParts: string[] = [];
    for (;;) {
      if (pos >= input.length) fail(`unexpected end inside <${tag}>`);
      if (input.startsWith('</', pos)) {
        const end = input.indexOf('>', pos);
        if (end === -1) fail(`unterminated closing tag in <${tag}>`);
        const closing = input.slice(pos + 2, end).trim();
        if (closing !== tag) fail(`mismatched closing tag </${closing}> for <${tag}>`);
        pos = end + 1;
        node.text = textParts.join('').trim();
        return node;
      }
      if (input.startsWith('<!--', pos)) {
        const end = input.indexOf('-->', pos);
        if (end === -1) fail('unterminated comment');
        pos = end + 3;
        continue;
      }
      if (input.startsWith('<![CDATA[', pos)) {
        const end = input.indexOf(']]>', pos);
        if (end === -1) fail('unterminated CDATA');
        textParts.push(input.slice(pos + 9, end));
        pos = end + 3;
        continue;
      }
      if (input[pos] === '<') {
        node.children.push(parseElement());
        continue;
      }
      const next = input.indexOf('<', pos);
      const chunk = next === -1 ? input.slice(pos) : input.slice(pos, next);
      textParts.push(decodeEntities(chunk));
      pos = next === -1 ? input.length : next;
    }
  };

  skipMisc();
  const root = parseElement();
  skipMisc();
  return root;
}

/** First descendant (depth-first) whose tag matches (prefix-insensitive). */
export function findFirst(node: XmlNode, tag: string): XmlNode | null {
  if (localName(node.tag) === tag) return node;
  for (const child of node.children) {
    const hit = findFirst(child, tag);
    if (hit) return hit;
  }
  return null;
}

/** Every descendant (depth-first) whose tag matches (prefix-insensitive). */
export function findAll(node: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode): void => {
    if (localName(n.tag) === tag) out.push(n);
    for (const child of n.children) walk(child);
  };
  walk(node);
  return out;
}

/** Direct children whose tag matches (prefix-insensitive). */
export function childrenOf(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((child) => localName(child.tag) === tag);
}

/** Tag name without a namespace prefix (`ns:Member` → `Member`). */
export function localName(tag: string): string {
  const colon = tag.lastIndexOf(':');
  return colon === -1 ? tag : tag.slice(colon + 1);
}
