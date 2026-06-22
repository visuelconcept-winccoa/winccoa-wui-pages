/**
 * Shared helpers to enumerate the scalar leaf elements of a datapoint from its
 * type STRUCTURE (as returned by WuiDpeService.getDatapointTypes). Used by the
 * value, archiving and alarming panels — all need "the value-bearing DPEs of a
 * selected DP / element", which the type structure gives reliably (walking
 * `dpNames('*')` misses struct branches and yields invalid paths).
 */

/** A datapoint-type structure: a scalar type name, or a struct of children. */
export type DpStruct = string | { [element: string]: DpStruct };

/** A scalar leaf: its path relative to the DP root + its WinCC OA type. */
export interface LeafEntry {
  relPath: string;
  type: string;
}

/** Flatten a type structure to its scalar leaves (relative path + WinCC OA type). */
export function collectLeaves(struct: DpStruct, base: string): LeafEntry[] {
  if (typeof struct === 'string') {
    return struct === '' ? [] : [{ relPath: base, type: struct }];
  }
  const out: LeafEntry[] = [];
  for (const [key, value] of Object.entries(struct)) {
    const rel = base === '' ? key : `${base}.${key}`;
    if (typeof value === 'string') {
      out.push({ relPath: rel, type: value });
    } else {
      out.push(...collectLeaves(value, rel));
    }
  }
  return out;
}

/** Leaves under a relative sub-path (relPath '' -> all leaves of the structure). */
export function leavesUnder(struct: DpStruct, relPath: string): LeafEntry[] {
  const all = collectLeaves(struct, '');
  if (relPath === '') {
    return all;
  }
  return all.filter((leaf) => leaf.relPath === relPath || leaf.relPath.startsWith(`${relPath}.`));
}

/** Split a selection path into DP root + element sub-path (a DP name has no '.'). */
export function splitDpPath(dp: string): { root: string; relPath: string } {
  const dot = dp.indexOf('.');
  return dot === -1 ? { root: dp, relPath: '' } : { root: dp.slice(0, dot), relPath: dp.slice(dot + 1) };
}

/** Full DPE name for a leaf: scalar root -> `<dp>.`, else `<dp>.<relPath>`. */
export function makeDpeName(root: string, relPath: string): string {
  return relPath === '' ? `${root}.` : `${root}.${relPath}`;
}

/** Strip the system prefix from a name (`System1:Foo` -> `Foo`). */
export function stripSystem(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}
