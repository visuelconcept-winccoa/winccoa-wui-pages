// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// paraTypeNode
// -----------------------------------------------------------------------------
// Helper that converts the plain JSON structure sent by the PARA web page into
// a WinccoaDpTypeNode tree suitable for winccoa.dpTypeCreate().
//
// The element-type map mirrors the proven reference at
// javascript/mcpServer/tools/datapoints/dp_type_create.js.
// -----------------------------------------------------------------------------

import { WinccoaDpTypeNode } from 'winccoa-manager';

/** A single element of an incoming type structure. */
export interface ParaTypeStructure {
  name: string;
  type: string;
  refName?: string;
  children?: ParaTypeStructure[];
  /**
   * Optional new name for this element. Only honored by dpTypeChange() -- it
   * renames an existing element of the type. Ignored by dpTypeCreate().
   */
  newName?: string;
}

/** Map of element-type names to WinccoaElementType enum values. */
const ELEMENT_TYPE_MAP: Record<string, number> = {
  Struct: 1,
  Int: 21,
  Float: 22,
  Bool: 23,
  Bit32: 24,
  String: 25,
  Time: 26,
  Dpid: 27,
  Char: 19,
  UInt: 20,
  Typeref: 41,
  LangString: 42,
  Blob: 46,
  Long: 54,
  ULong: 58,
  Bit64: 50,
  DynChar: 3,
  DynUInt: 4,
  DynInt: 5,
  DynFloat: 6,
  DynBool: 7,
  DynBit32: 8,
  DynString: 9,
  DynTime: 10,
  DynDpid: 29,
  DynLangString: 44,
  DynBlob: 48,
  DynBit64: 51,
  DynLong: 55,
  DynULong: 59
};

/** Reverse of ELEMENT_TYPE_MAP: WinccoaElementType value -> type name. */
const ELEMENT_TYPE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(ELEMENT_TYPE_MAP).map(([name, value]) => [value, name])
);

/**
 * Serializes a WinccoaDpTypeNode tree (as returned by dpTypeGet) back into the
 * plain ParaTypeStructure JSON used by the create/change endpoints, so a type
 * can be read, edited and posted back without an impedance mismatch.
 *
 * @param node Root (or child) node of a type tree.
 * @returns The equivalent ParaTypeStructure. Unknown element-type values fall
 *          back to their numeric string so nothing is silently lost.
 */
export function structureFromType(node: WinccoaDpTypeNode): ParaTypeStructure {
  const result: ParaTypeStructure = {
    name: node.name,
    type: ELEMENT_TYPE_NAME[node.type] ?? String(node.type)
  };
  if (node.refName) result.refName = node.refName;
  if (node.children && node.children.length > 0) {
    result.children = node.children.map((child) => structureFromType(child));
  }
  return result;
}

/**
 * Recursively builds a WinccoaDpTypeNode from a validated JSON structure.
 *
 * @param node JSON node definition (name, type, optional refName/children).
 * @returns A WinccoaDpTypeNode instance.
 * @throws Error if a node is malformed or uses an unknown element type.
 */
function buildNode(node: ParaTypeStructure): WinccoaDpTypeNode {
  if (!node || typeof node !== 'object') {
    throw new Error('Invalid node structure: must be an object');
  }
  if (!node.name || typeof node.name !== 'string') {
    throw new Error('Invalid node structure: name is required and must be a string');
  }
  if (!node.type || typeof node.type !== 'string') {
    throw new Error(`Invalid node structure for '${node.name}': type is required`);
  }
  const elementType = ELEMENT_TYPE_MAP[node.type];
  if (elementType === undefined) {
    throw new Error(
      `Invalid element type '${node.type}' for node '${node.name}'. Valid types: ${Object.keys(ELEMENT_TYPE_MAP).join(', ')}`
    );
  }
  if (node.newName !== undefined && typeof node.newName !== 'string') {
    throw new Error(`Invalid node structure for '${node.name}': newName must be a string`);
  }
  const children = (node.children ?? []).map((child) => buildNode(child));
  return new WinccoaDpTypeNode(
    node.name,
    elementType,
    node.refName ?? '',
    children,
    node.newName
  );
}

/**
 * Builds the root WinccoaDpTypeNode for a datapoint type.
 *
 * @param typeName Datapoint-type name (also forced as the root node name).
 * @param structure JSON structure describing the root node and its children.
 * @returns The root WinccoaDpTypeNode, ready for winccoa.dpTypeCreate().
 */
export function createTypeFromStructure(
  typeName: string,
  structure: ParaTypeStructure
): WinccoaDpTypeNode {
  if (structure && typeof structure === 'object' && structure.name !== typeName) {
    structure.name = typeName;
  }
  return buildNode(structure);
}
