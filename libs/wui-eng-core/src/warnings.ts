// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * {@link EngWarning} — the core's diagnostics, machine-readable AND translatable.
 *
 * Why not a plain string. A generator warning is read by three very different
 * consumers, and a string serves only the first well:
 *  - the OPERATOR, in the studio, in their own language;
 *  - the TEST suite and the backend log, which must pin an exact, stable meaning;
 *  - a future rule/report that wants to react to a KIND of problem (all the
 *    "unverified" ones, all the truncations) without matching on prose.
 *
 * So a warning carries three things: a stable `code`, the English `message` (the
 * fallback, and what tests and logs assert on) and the `params` substituted into
 * it. A UI layer maps `code` → its own translated template and re-substitutes the
 * same params; anything it does not know falls back to `message`, so a new core
 * warning is never invisible — it is merely untranslated.
 *
 * Two rules keep that contract usable:
 *  1. **every value inside a message is a `{placeholder}` fed by `params`** — a
 *     translator cannot re-order text that already has values baked into it;
 *  2. **codes are stable**. Renaming one silently drops its translation, so treat a
 *     code like an API name (`tools/check-eng-i18n.mjs` fails on an untranslated
 *     code, which is what makes rule 2 enforceable rather than aspirational).
 */

/** Values substituted into a warning's message. */
export type EngWarningParams = Record<string, string | number>;

/** One diagnostic produced by the engineering core. */
export interface EngWarning {
  /**
   * Stable identifier, `<producer>.<what>` (e.g. `browse.truncated-entries`).
   * Namespacing by producer keeps the codes greppable back to their emitter.
   */
  code: string;
  /** English rendering, with `{placeholder}` for every value. The fallback. */
  message: string;
  params?: EngWarningParams;
}

/** Build a warning. `message` MUST place every value behind a `{placeholder}`. */
export function warn(code: string, message: string, params?: EngWarningParams): EngWarning {
  return params === undefined || Object.keys(params).length === 0 ? { code, message } : { code, message, params };
}

/** Substitute `{placeholder}`s; an unknown one is left visible rather than blanked. */
export function formatMessage(template: string, params: EngWarningParams = {}): string {
  return template.replaceAll(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}

/** English rendering of a warning (the core's own `toString`). */
export function formatWarning(warning: EngWarning): string {
  return formatMessage(warning.message, warning.params);
}

/**
 * Accept both shapes when READING stored data.
 *
 * Address books written before this refactor hold `warnings: string[]`, and they
 * live in the engineering store on disk. Rather than migrate files (and break a
 * project that rolls back), a legacy string is wrapped as
 * `{ code: 'legacy', message }` — it renders exactly as before and translates to
 * nothing, which is the truthful outcome.
 */
export function asEngWarnings(value: unknown): EngWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.trim() === '' ? [] : [{ code: 'legacy', message: item }];
    if (item !== null && typeof item === 'object' && typeof (item as EngWarning).message === 'string') {
      const warning = item as EngWarning;
      return [{ code: typeof warning.code === 'string' ? warning.code : 'legacy', message: warning.message, ...(warning.params ? { params: warning.params } : {}) }];
    }
    return [];
  });
}

/**
 * Every code the core emits, grouped by producer.
 *
 * A single place to read the whole diagnostic vocabulary — and the thing the UI's
 * translation table is checked against. Values are the codes themselves; the
 * indirection buys typo-safety at the emit sites and lets a consumer branch on
 * `WARNING_CODES.browse.TRUNCATED_ENTRIES` instead of a literal.
 */
export const WARNING_CODES = {
  book: {
    REMOVED: 'book.removed',
    CHANGED: 'book.changed',
    ADDED: 'book.added',
    EXCLUDED: 'book.excluded',
    DUPLICATE_PATHS: 'book.duplicate-paths'
  },
  template: {
    MISSING_ENTRIES: 'template.missing-entries',
    UNBOUND_LEAVES: 'template.unbound-leaves'
  },
  browse: {
    TRUNCATED_ENTRIES: 'browse.truncated-entries',
    TRUNCATED_REQUESTS: 'browse.truncated-requests',
    DEPTH_TRUNCATED: 'browse.depth-truncated',
    SKIPPED_BRANCHES: 'browse.skipped-branches',
    UNREADABLE_BRANCHES: 'browse.unreadable-branches',
    METHODS_SKIPPED: 'browse.methods-skipped',
    ARRAYS_FLAGGED: 'browse.arrays-flagged',
    UNNAMED_NODES: 'browse.unnamed-nodes',
    EMPTY_ROOT: 'browse.empty-root',
    ACCESS_ALL_ASSUMED: 'browse.access-all-assumed',
    ACCESS_PARTLY_ASSUMED: 'browse.access-partly-assumed',
    ACCESS_READ: 'browse.access-read'
  },
  nodeset: {
    FILE_LOCAL_NODEIDS: 'nodeset.file-local-nodeids',
    TEMPLATES_ONLY: 'nodeset.templates-only',
    NO_VARIABLE: 'nodeset.no-variable',
    METHODS_SKIPPED: 'nodeset.methods-skipped',
    ARRAYS_FLAGGED: 'nodeset.arrays-flagged',
    CYCLES_CUT: 'nodeset.cycles-cut',
    DEPTH_TRUNCATED: 'nodeset.depth-truncated'
  },
  modelgen: {
    NO_SELECTION: 'modelgen.no-selection',
    PREFIX_STRIPPED: 'modelgen.prefix-stripped',
    UNUSABLE_NAME: 'modelgen.unusable-name',
    NO_DEVICE: 'modelgen.no-device',
    UNBOUND_LEAVES: 'modelgen.unbound-leaves',
    DANGLING_BINDINGS: 'modelgen.dangling-bindings',
    TYPE_MISMATCH: 'modelgen.type-mismatch',
    UNUSED_SIGNALS: 'modelgen.unused-signals',
    UNQUALIFIED: 'modelgen.unqualified',
    MISSING_ADDRESS: 'modelgen.missing-address',
    UNRESOLVED_REFERENCE: 'modelgen.unresolved-reference',
    NO_DATATYPE: 'modelgen.no-datatype',
    DIRECTION_ADJUSTED: 'modelgen.direction-adjusted',
    ACCESS_ASSUMED: 'modelgen.access-assumed'
  },
  outline: {
    ODD_INDENT: 'outline.odd-indent',
    EMPTY_NAME: 'outline.empty-name',
    INVALID_IDENTIFIER: 'outline.invalid-identifier',
    SANITISED: 'outline.sanitised',
    UNKNOWN_TYPE: 'outline.unknown-type',
    TOO_DEEP: 'outline.too-deep',
    DUPLICATE: 'outline.duplicate'
  },
  schneider: {
    NO_HEADER: 'schneider.no-header',
    NOT_LOCATED: 'schneider.not-located',
    NOT_ADDRESSABLE: 'schneider.not-addressable',
    UNVERIFIED_TYPE: 'schneider.unverified-type',
    REGISTER_OVERLAP: 'schneider.register-overlap',
    MEMBER_NO_ADDRESS: 'schneider.member-no-address',
    XVM_UNVERIFIED_SCHEMA: 'schneider.xvm-unverified-schema',
    XVM_NOTHING_RECOGNISED: 'schneider.xvm-nothing-recognised',
    XVM_UNREADABLE: 'schneider.xvm-unreadable'
  },
  simaticml: {
    UDT_MISSING: 'simaticml.udt-missing',
    UDT_RECURSIVE: 'simaticml.udt-recursive',
    ARRAY_SKIPPED: 'simaticml.array-skipped',
    DOCUMENT_FAILED: 'simaticml.document-failed',
    NO_BLOCK_NUMBER: 'simaticml.no-block-number',
    DATATYPE_UNMAPPED: 'simaticml.datatype-unmapped'
  },
  diff: {
    RETYPE_UNSUPPORTED: 'diff.retype-unsupported',
    DP_TYPE_MISSING: 'diff.dp-type-missing'
  },
  device: {
    NAME_REQUIRED: 'device.name-required',
    NAME_INVALID: 'device.name-invalid',
    NAME_TAKEN: 'device.name-taken',
    ID_TAKEN: 'device.id-taken',
    NO_ACCESS_MODE: 'device.no-access-mode',
    PARAM_REQUIRED: 'device.param-required',
    PARAM_INVALID: 'device.param-invalid',
    DRIVER_INVALID: 'device.driver-invalid',
    DRIVER_RECOMMENDED: 'device.driver-recommended'
  }
} as const;
