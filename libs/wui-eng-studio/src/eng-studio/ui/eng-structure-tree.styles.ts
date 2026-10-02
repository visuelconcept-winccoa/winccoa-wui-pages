// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layout of the structure tree. Same shape as PARA's type editor — one indented row
 * per element — with the mapping picker occupying the space a group does not need.
 */
import { css } from 'lit';

export const engStructureTreeStyles = css`
  :host {
    display: block;
    height: auto;
    min-height: 0;
  }
  .tree {
    max-height: 20rem;
    overflow: auto;
    padding: 0.15rem 0;
  }
  .tree-empty {
    padding: 0.6rem 0.4rem;
    font-size: 0.75rem;
    color: var(--eng-soft);
  }
  .tree-foot {
    display: flex;
    gap: 0.35rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--eng-border);
  }
  /* One indent step per level, driven by the row's own --level (PARA's grammar).
     The row WRAPS: this editor lives in the model panel's narrow left column, and
     name + type + actions + a signal picker do not fit on one line there — so the
     picker drops to its own line rather than being squeezed out of sight. */
  .node {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0;
    padding-left: calc(var(--level, 0) * 0.9rem);
  }
  .node:hover {
    background: var(--eng-hover);
  }
  .node-icon {
    flex-shrink: 0;
    color: var(--eng-soft);
  }
  /* Explicit order + a small basis so the name yields rather than pushing the
     actions onto a line of their own; only the mapping is meant to wrap. */
  .node-name {
    order: 1;
    flex: 1 1 3rem;
    min-width: 0;
  }
  .node-type {
    order: 2;
    flex: 0 0 5.5rem;
    min-width: 0;
  }
  /* A group needs no picker and takes no second line. */
  .node-fill {
    display: none;
  }
  /* The mapping, on its own line under the element it belongs to. */
  .node-bind {
    order: 4;
    flex: 1 1 100%;
    min-width: 0;
    margin-left: 1.3rem;
    font-size: 0.72rem;
  }
  /* An unmapped leaf is visible at a glance: the mapping is the point of this mode. */
  .node-bind.unbound {
    border-color: var(--eng-warn);
    color: var(--eng-warn);
  }
  .node-ambiguous {
    flex-shrink: 0;
    cursor: help;
    order: 3;
  }
  .node-actions {
    order: 3;
    display: flex;
    align-items: center;
    gap: 0.1rem;
    flex-shrink: 0;
  }

  /* The structure is framed: the Model tab's detail column stacks it between the
     sources above and the generator below, and the frame says where it starts. */
  .tree-structure {
    border-left: 1px solid var(--eng-border);
    padding-left: 0.35rem;
  }

  /* --- The leaf's DEPLOYMENT, on the mapping line ------------------------ */
  .node-policy {
    order: 5;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1 1 100%;
    min-width: 0;
    margin-left: 1.3rem;
    font-size: 0.72rem;
  }
  .node-flag {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--eng-soft);
    white-space: nowrap;
  }
  .node-flag-label {
    font-size: 0.68rem;
    text-transform: uppercase;
  }
  /* An alarm class and an archive group are DATAPOINT names (_alert_high,
     _NGA_G_EVENT), so the field is sized for one — 4.5rem truncated every real value. */
  .node-policy-text {
    width: 8rem;
    min-width: 0;
    font-size: 0.72rem;
  }
  /* Fold / unfold, globally (above the tree) and per group (on its own row). */
  .tree-fold {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0 0.3rem;
  }
  .node-fold {
    width: 1rem;
    flex-shrink: 0;
    border: 0;
    padding: 0;
    background: none;
    color: var(--eng-soft);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .node-fold:hover {
    color: var(--eng-text);
  }

  /* One line per ALARMING RANGE, under its leaf: the limit, then the class of that range. */
  .node-ranges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    padding: 0.1rem 0 0.25rem calc(1.4rem + var(--level, 0) * 1.1rem);
    font-size: 0.72rem;
  }
  .node-range {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .node-range-limit {
    min-width: 3.2rem;
    text-align: right;
  }

  /* HOW the leaf is acquired: the mode, then what it is acquired THROUGH. */
  .node-acq-mode {
    width: 5.5rem;
    min-width: 0;
    font-size: 0.72rem;
  }
  .node-acq-target {
    width: 7.5rem;
    min-width: 0;
    font-size: 0.72rem;
  }

  /* class / group + its magnifier, as one control. */
  .node-policy-pick {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
  }
  /* HOW a leaf alarms: the good range of a BOOL, or the thresholds of a number. */
  .node-policy-good {
    width: 6.5rem;
    min-width: 0;
    font-size: 0.72rem;
  }
  .node-policy-thresholds {
    width: 6rem;
    min-width: 0;
    font-size: 0.72rem;
  }
  /* The leaf marker is a spacer now: the dot in front of every field read as a radio
     button nobody could select, and 331 of them were 331 Stencil icons. */
  .node-icon-leaf {
    display: inline-block;
    width: 1rem;
    flex-shrink: 0;
  }
  .node-policy-range {
    width: 5rem;
    min-width: 0;
    font-size: 0.72rem;
  }
`;
