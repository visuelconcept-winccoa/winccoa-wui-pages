// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layout of the Catalogues panel and of its creation form (tokens and primitives
 * live in eng-theme). Both share the panel-head / panel-scroll frame, so that part
 * is declared once and used by the two elements.
 */
import { css } from 'lit';

/** The head + scrolling body every catalogue screen sits in. */
const frame = css`
  .panel-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.9rem;
    border-bottom: 1px solid var(--eng-border);
    flex-shrink: 0;
  }
  .panel-head h2 {
    margin: 0;
    font-size: 1rem;
  }
  /* --- walk progress ---------------------------------------------------- */
  .walk {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.5rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--eng-primary);
    border-radius: var(--eng-radius);
    background: var(--eng-surface-2);
  }
  .walk-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .walk-title {
    font-weight: 600;
    font-size: 0.82rem;
  }
  .walk-detail {
    font-size: 0.72rem;
    color: var(--eng-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
`;

/** The creation form: the frame plus the form's own column and file field. */
export const engBookFormStyles = [
  frame,
  css`
    :host {
      overflow: hidden;
    }
    .eng-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.9rem;
      max-width: 46rem;
    }
    input.filter.file {
      max-width: 22rem;
      padding: 0.2rem;
    }

    /* --- server explorer -------------------------------------------------- */
    .explorer {
      margin-top: 0.5rem;
      padding: 0.5rem;
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
      background: var(--eng-bg);
    }
    .explorer-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }
    .explorer-title {
      font-weight: 600;
      font-size: 0.85rem;
    }
    .explorer-tree {
      max-height: 22rem;
      overflow: auto;
      border-top: 1px solid var(--eng-border);
      padding-top: 0.35rem;
    }
    /* One indent step per level, driven by the row's own --depth. */
    .explorer-row,
    .explorer-counts,
    .explorer-empty {
      padding-left: calc(var(--depth, 0) * 1.1rem);
    }
    .explorer-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding-top: 0.1rem;
      padding-bottom: 0.1rem;
      font-size: 0.78rem;
    }
    .explorer-row:hover {
      background: var(--eng-hover);
    }
    .explorer-counts,
    .explorer-empty {
      font-size: 0.68rem;
      color: var(--eng-soft);
      padding-top: 0.15rem;
      padding-bottom: 0.15rem;
    }
    .explorer-toggle,
    .explorer-root {
      width: 1.3rem;
      flex-shrink: 0;
      border: none;
      background: transparent;
      color: var(--eng-soft);
      font: inherit;
      cursor: pointer;
    }
    .explorer-toggle:hover,
    .explorer-root:hover {
      color: var(--eng-primary);
    }
    .explorer-leaf {
      width: 1.3rem;
      flex-shrink: 0;
      text-align: center;
      color: var(--eng-weak);
    }
    .explorer-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 16rem;
    }
    .explorer-id {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* --- import preview --------------------------------------------------- */
    .preview-head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-bottom: 0.4rem;
    }
    .preview-head .card-title {
      margin: 0;
    }
    .preview-filter {
      width: 12rem;
    }
    .preview-busy {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .preview-warnings {
      margin: 0 0 0.5rem;
      padding-left: 1.1rem;
      font-size: 0.75rem;
    }
    /* The table scrolls on its own: the form column must not grow with the file. */
    .preview-table {
      max-height: 20rem;
      overflow: auto;
      border: 1px solid var(--eng-border);
      border-radius: var(--eng-radius);
    }
    .preview-table td.soft.small {
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preview-types {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
    }
  `
];

export const engBooksStyles = [
  frame,
  css`
  :host {
    /* The panel fills the studio's <main>, and only its two columns scroll. */
    overflow: hidden;
  }
  .split2 {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 22rem 1fr;
  }
  .browser {
    border-right: 1px solid var(--eng-border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--eng-surface);
  }
  .browser-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--eng-border);
  }
  .browser-head .filter {
    flex: 1;
  }
  .browser-list {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }
  .browser-foot {
    padding: 0.35rem 0.6rem;
    border-top: 1px solid var(--eng-border);
    font-size: 0.72rem;
    color: var(--eng-soft);
  }
  .book-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: none;
    border-left: 2px solid transparent;
    border-bottom: 1px solid var(--eng-border);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .book-row:hover {
    background: var(--eng-hover);
  }
  .book-row.selected {
    background: var(--eng-selected);
    border-left-color: var(--eng-primary);
  }
  .book-row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .book-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .book-row-sub {
    font-size: 0.68rem;
    color: var(--eng-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grid-wrap {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .grid-head-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--eng-border);
    flex-shrink: 0;
  }
  .detail-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 24rem;
  }
  .detail-message {
    display: block;
    margin: 0.75rem 0.9rem 0;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    padding: 0.9rem;
  }
  .card.warnings {
    margin: 0 0.9rem 0.9rem;
  }
  .panel-scroll > .card {
    margin: 0 0.9rem 0.9rem;
  }
  /* The signal table is SLOTTED from the page (see the element's header). */
  ::slotted(*) {
    display: block;
    margin: 0 0.9rem 0.9rem;
  }
  `
];
