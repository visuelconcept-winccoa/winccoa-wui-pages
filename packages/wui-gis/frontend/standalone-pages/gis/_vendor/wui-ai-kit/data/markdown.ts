// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Minimal, safe Markdown -> HTML renderer for AI answers (no dependency).
 *
 * Safety: the source is HTML-escaped FIRST, so no raw HTML from the (untrusted)
 * LLM output can be injected -- the markdown transforms then only ever ADD a
 * fixed, safe set of tags (headings, p, br, strong, em, code, pre, ul/ol/li, a).
 * Link hrefs are restricted to http(s)/mailto/relative; anything else stays as
 * plain text. The result is meant to be passed to Lit's `unsafeHTML`.
 *
 * Supported: fenced code blocks, ATX headings, unordered/ordered lists,
 * paragraphs with soft line breaks, inline code, bold, italic, links.
 */

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeHref(url: string): boolean {
  return /^(https?:\/\/|mailto:|\/)/i.test(url);
}

/** Apply bold / italic / link transforms to an already-escaped text segment. */
function richText(seg: string): string {
  let s = seg;
  s = s.replaceAll(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) =>
    safeHref(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : m
  );
  s = s.replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replaceAll(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replaceAll(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replaceAll(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return s;
}

/**
 * Inline formatting. Splits on inline-code spans (so their content is never
 * touched by the bold/italic/link transforms), escapes everything, then
 * rich-formats the non-code segments.
 */
function inline(text: string): string {
  return escapeHtml(text)
    .split(/(`[^`]+`)/g)
    .map((seg) =>
      seg.length >= 2 && seg.startsWith('`') && seg.endsWith('`')
        ? `<code>${seg.slice(1, -1)}</code>`
        : richText(seg)
    )
    .join('');
}

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_UL = /^\s*[-*]\s+/;
const RE_OL = /^\s*\d+\.\s+/;
const RE_FENCE = /^```/;

function isBlockStart(line: string): boolean {
  return RE_FENCE.test(line) || RE_HEADING.test(line) || RE_UL.test(line) || RE_OL.test(line);
}

/** Render a Markdown string to a safe HTML string. */
export function renderMarkdown(src: string): string {
  const lines = String(src ?? '')
    .replaceAll(/\r\n?/g, '\n')
    .split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (RE_FENCE.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !RE_FENCE.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (RE_UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && RE_UL.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(RE_UL, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (RE_OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && RE_OL.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(RE_OL, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      para.push(inline(lines[i]));
      i++;
    }
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return out.join('');
}
