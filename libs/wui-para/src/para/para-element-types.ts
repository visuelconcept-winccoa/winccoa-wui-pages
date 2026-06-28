// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Single source of truth for the WinCC OA datapoint-element types offered by
 * the PARA model editor (and referenced by the AI assistant's system prompt).
 *
 * Names MUST match the backend `ELEMENT_TYPE_MAP` keys in
 * `backend/routes/paraTypeNode.ts`; the backend rejects any other type name.
 * The JSON node shape ({@link ParaStructureNode}) mirrors the backend
 * `ParaTypeStructure` accepted by `/api/para/dptype/create` and `/dptype/change`.
 */

/** A node of a datapoint-type structure (create/change payload + GET result). */
export interface ParaStructureNode {
  name: string;
  type: string;
  /** Referenced type name — only for `Typeref` elements. */
  refName?: string;
  /**
   * New element name. Honored ONLY by `dpTypeChange` to rename an existing
   * element (match by `name`, rename to `newName`). Ignored by `dpTypeCreate`.
   */
  newName?: string;
  children?: ParaStructureNode[];
}

/** Element-type catalog entry. */
export interface ElementTypeDef {
  name: string;
  label: string;
  group: 'struct' | 'scalar' | 'dynamic' | 'special';
}

/** The composite type whose children form the structure. */
export const STRUCT_TYPE = 'Struct';

/** The reference type; requires a `refName` pointing at another type. */
export const TYPEREF_TYPE = 'Typeref';

/**
 * Selectable element types, grouped for the editor's dropdown. Every `name`
 * exists in the backend `ELEMENT_TYPE_MAP`.
 */
export const ELEMENT_TYPES: ElementTypeDef[] = [
  { name: STRUCT_TYPE, label: 'Struct (sous-structure)', group: 'struct' },
  { name: 'Float', label: 'Float', group: 'scalar' },
  { name: 'Int', label: 'Int', group: 'scalar' },
  { name: 'UInt', label: 'UInt', group: 'scalar' },
  { name: 'Long', label: 'Long', group: 'scalar' },
  { name: 'ULong', label: 'ULong', group: 'scalar' },
  { name: 'Bool', label: 'Bool', group: 'scalar' },
  { name: 'Char', label: 'Char', group: 'scalar' },
  { name: 'String', label: 'String', group: 'scalar' },
  { name: 'LangString', label: 'LangString', group: 'scalar' },
  { name: 'Time', label: 'Time', group: 'scalar' },
  { name: 'Bit32', label: 'Bit32', group: 'scalar' },
  { name: 'Bit64', label: 'Bit64', group: 'scalar' },
  { name: 'Dpid', label: 'Dpid', group: 'scalar' },
  { name: 'Blob', label: 'Blob', group: 'scalar' },
  { name: 'DynFloat', label: 'DynFloat', group: 'dynamic' },
  { name: 'DynInt', label: 'DynInt', group: 'dynamic' },
  { name: 'DynUInt', label: 'DynUInt', group: 'dynamic' },
  { name: 'DynLong', label: 'DynLong', group: 'dynamic' },
  { name: 'DynULong', label: 'DynULong', group: 'dynamic' },
  { name: 'DynBool', label: 'DynBool', group: 'dynamic' },
  { name: 'DynChar', label: 'DynChar', group: 'dynamic' },
  { name: 'DynString', label: 'DynString', group: 'dynamic' },
  { name: 'DynLangString', label: 'DynLangString', group: 'dynamic' },
  { name: 'DynTime', label: 'DynTime', group: 'dynamic' },
  { name: 'DynBit32', label: 'DynBit32', group: 'dynamic' },
  { name: 'DynBit64', label: 'DynBit64', group: 'dynamic' },
  { name: 'DynDpid', label: 'DynDpid', group: 'dynamic' },
  { name: 'DynBlob', label: 'DynBlob', group: 'dynamic' },
  { name: TYPEREF_TYPE, label: 'Typeref (référence)', group: 'special' }
];

/** Flat list of valid type names (for validation / prompt text). */
export const ELEMENT_TYPE_NAMES: string[] = ELEMENT_TYPES.map((t) => t.name);

const ELEMENT_TYPE_NAME_SET = new Set(ELEMENT_TYPE_NAMES);

export function isStructType(type: string): boolean {
  return type === STRUCT_TYPE;
}

export function isTyperefType(type: string): boolean {
  return type === TYPEREF_TYPE;
}

export function isKnownElementType(type: string): boolean {
  return ELEMENT_TYPE_NAME_SET.has(type);
}
