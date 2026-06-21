// -----------------------------------------------------------------------------
// ParaController
// -----------------------------------------------------------------------------
// Controller for the PARA engineering endpoints. These provide functionality
// that is NOT available over the dashboard WebSocket API - primarily
// datapoint-type creation (winccoa.dpTypeCreate) - to the PARA web page.
//
// WsjServerGlobal.winccoa is the shared (server-wide) WinCC OA API instance,
// used here because these are HTTP endpoints with no per-connection context.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';

import {
  ParaTypeStructure,
  createTypeFromStructure,
  structureFromType
} from './paraTypeNode';

/** Maps low-level dpType errors to a friendlier message. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('already exist')) return 'A datapoint type with this name already exists';
  if (message.includes('invalid characters')) return 'Name contains invalid characters';
  if (message.includes('refName')) return 'Referenced type does not exist or is invalid';
  return message;
}

/**
 * Controller exposing PARA engineering operations as HTTP endpoints.
 *
 * Handlers are arrow functions so they can be passed directly to the router
 * without losing their `this` binding.
 */
export class ParaController {
  /** GET /api/para/health -> simple liveness probe. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'para' });
  };

  /** POST /api/para/dptype/create  body { typeName, structure }. */
  public createDpType = async (req: Request, res: Response): Promise<void> => {
    const { typeName, structure } = (req.body ?? {}) as {
      typeName?: string;
      structure?: ParaTypeStructure;
    };
    if (!typeName || !structure) {
      res.status(400).json({ ok: false, error: 'typeName and structure are required' });
      return;
    }
    try {
      const root = createTypeFromStructure(typeName, structure);
      const created = await WsjServerGlobal.winccoa.dpTypeCreate(root);
      if (created) {
        res.status(200).json({ ok: true, typeName });
      } else {
        res.status(500).json({ ok: false, error: `dpTypeCreate('${typeName}') returned false` });
      }
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * GET /api/para/dptype/:name
   *
   * Reads an existing data point type and returns its structure in the same
   * JSON shape accepted by /dptype/create and /dptype/change -- so a client can
   * GET a type, edit the structure, and POST it back to /dptype/change.
   */
  public getDpType = (req: Request, res: Response): void => {
    const name = req.params['name'];
    try {
      // dpTypeGet is synchronous and throws a WinccoaError if the type is unknown.
      const root = WsjServerGlobal.winccoa.dpTypeGet(name);
      res.status(200).json({ ok: true, typeName: name, structure: structureFromType(root) });
    } catch (error) {
      res.status(404).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/para/dptype/change  body { typeName, structure }.
   *
   * Updates an EXISTING data point type in place via winccoa.dpTypeChange().
   * Unlike delete + create, this preserves the data points already created from
   * the type: elements you keep retain their values, added elements appear on
   * existing DPs, removed elements are dropped.
   *
   * `structure` uses the same shape as /dptype/create (name/type/refName/
   * children) with one extra capability: set `newName` on an element to rename
   * it (honored only by dpTypeChange). The root `name` must be the existing
   * type name -- it is forced to `typeName` -- and the whole subtree under it
   * replaces the current definition.
   */
  public changeDpType = async (req: Request, res: Response): Promise<void> => {
    const { typeName, structure } = (req.body ?? {}) as {
      typeName?: string;
      structure?: ParaTypeStructure;
    };
    if (!typeName || !structure) {
      res.status(400).json({ ok: false, error: 'typeName and structure are required' });
      return;
    }
    // dpTypeChange requires an existing type; dpTypeGet throws if it is unknown.
    try {
      WsjServerGlobal.winccoa.dpTypeGet(typeName);
    } catch {
      res.status(404).json({ ok: false, error: `data point type '${typeName}' does not exist` });
      return;
    }
    try {
      const root = createTypeFromStructure(typeName, structure);
      const changed = await WsjServerGlobal.winccoa.dpTypeChange(root);
      if (changed) {
        res.status(200).json({ ok: true, typeName });
      } else {
        res.status(500).json({ ok: false, error: `dpTypeChange('${typeName}') returned false` });
      }
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  /** POST /api/para/dp/create  body { dpName, dpType }. */
  public createDp = async (req: Request, res: Response): Promise<void> => {
    const { dpName, dpType } = (req.body ?? {}) as { dpName?: string; dpType?: string };
    if (!dpName || !dpType) {
      res.status(400).json({ ok: false, error: 'dpName and dpType are required' });
      return;
    }
    try {
      const created = await WsjServerGlobal.winccoa.dpCreate(dpName, dpType);
      res.status(created ? 200 : 500).json({ ok: Boolean(created), dpName });
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/para/dp/set
   *
   * Writes one or more data point element values. Because WinCC OA addresses
   * configuration attributes as special DPEs (e.g.
   * `<dp>.<dpe>:_address.._reference`, `<dp>.<dpe>:_default.._default`), this
   * same endpoint also writes *configurations* -- just pass the config DPE path
   * as the name. There is no separate config API: writing a value and writing a
   * config both go through dpSet().
   *
   * Accepts either a single pair or two parallel arrays:
   *   { "dpeName": "ExampleDP_Arg1.", "value": 42 }
   *   { "dpeNames": ["a.", "b:_default.._default"], "values": [1, 0] }
   *
   * Uses dpSetWait() (not dpSet()) so the database write is confirmed -- or its
   * error reported -- before responding, rather than returning optimistically.
   */
  public setValue = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      dpeName?: string;
      value?: unknown;
      dpeNames?: string[];
      values?: unknown[];
    };

    // Normalize the single-pair and batch (parallel-array) forms into arrays.
    let names: string[];
    let values: unknown[];
    if (body.dpeName !== undefined) {
      if (body.value === undefined) {
        res.status(400).json({ ok: false, error: "'value' is required when 'dpeName' is given" });
        return;
      }
      names = [body.dpeName];
      values = [body.value];
    } else if (Array.isArray(body.dpeNames) && Array.isArray(body.values)) {
      names = body.dpeNames;
      values = body.values;
    } else {
      res.status(400).json({
        ok: false,
        error: 'provide either { dpeName, value } or { dpeNames: [...], values: [...] }'
      });
      return;
    }

    if (names.length === 0) {
      res.status(400).json({ ok: false, error: 'no data point element specified' });
      return;
    }
    if (names.length !== values.length) {
      res
        .status(400)
        .json({ ok: false, error: 'dpeNames and values must have the same length' });
      return;
    }

    try {
      // dpSetWait accepts a single name/value or two equal-length arrays.
      const ok =
        names.length === 1
          ? await WsjServerGlobal.winccoa.dpSetWait(names[0], values[0])
          : await WsjServerGlobal.winccoa.dpSetWait(names, values);
      res.status(ok ? 200 : 500).json({ ok: Boolean(ok), dpeNames: names });
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/para/dp/rename  body { oldName, newName, expectedType? }.
   *
   * WinCC OA's JS API has no native dpRename(), so a rename is performed as
   * dpCopy(oldName -> newName) followed by dpDelete(oldName). dpCopy carries
   * over the source's configs and current values.
   *
   * Caveats (because this is a copy + delete, not an in-place rename):
   *   - The new DP gets a NEW internal DP id; archived history of the source
   *     is NOT moved to the new name.
   *   - Existing dpConnect subscriptions on the old name stop receiving values.
   *   - If dpCopy succeeds but the subsequent dpDelete fails, BOTH names exist;
   *     the response then reports ok:false with copied:true so the caller can
   *     retry the delete.
   *
   * Optional `expectedType` guards against renaming the wrong DP: if given and
   * the source DP is of a different type, the request is rejected (409).
   */
  public renameDp = async (req: Request, res: Response): Promise<void> => {
    const { oldName, newName, expectedType } = (req.body ?? {}) as {
      oldName?: string;
      newName?: string;
      expectedType?: string;
    };
    if (!oldName || !newName) {
      res.status(400).json({ ok: false, error: 'oldName and newName are required' });
      return;
    }
    try {
      if (!this.dpInstanceExists(oldName)) {
        res.status(404).json({ ok: false, error: `data point '${oldName}' does not exist` });
        return;
      }
      if (this.dpInstanceExists(newName)) {
        res.status(409).json({ ok: false, error: `data point '${newName}' already exists` });
        return;
      }
      if (expectedType) {
        const actualType = WsjServerGlobal.winccoa.dpTypeName(oldName);
        if (actualType !== expectedType) {
          res.status(409).json({
            ok: false,
            error: `'${oldName}' is of type '${actualType}', not '${expectedType}'`
          });
          return;
        }
      }

      const copied = await WsjServerGlobal.winccoa.dpCopy(oldName, newName);
      if (!copied) {
        res.status(500).json({ ok: false, error: `dpCopy('${oldName}','${newName}') returned false` });
        return;
      }
      const deleted = await WsjServerGlobal.winccoa.dpDelete(oldName);
      if (!deleted) {
        // Copy worked but the source could not be removed -- surface both facts.
        res.status(500).json({
          ok: false,
          copied: true,
          error: `created '${newName}' but dpDelete('${oldName}') failed; retry the delete`
        });
        return;
      }
      res.status(200).json({ ok: true, oldName, newName });
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * DELETE /api/para/dp/:name   (optional ?dpType= guard).
   *
   * Deletes a data point instance. When the `dpType` query parameter is
   * provided, the DP is only deleted if it is of that type (otherwise 409),
   * so a caller can safely scope deletion to "a DP of a certain DPType".
   *
   * Note: this is `/dp/:name` (a data point instance); `/dptype/:name` deletes
   * a data point *type*.
   */
  public deleteDp = async (req: Request, res: Response): Promise<void> => {
    const name = req.params['name'];
    const expectedType = req.query['dpType'] as string | undefined;
    try {
      if (!this.dpInstanceExists(name)) {
        res.status(404).json({ ok: false, error: `data point '${name}' does not exist` });
        return;
      }
      if (expectedType) {
        const actualType = WsjServerGlobal.winccoa.dpTypeName(name);
        if (actualType !== expectedType) {
          res.status(409).json({
            ok: false,
            error: `'${name}' is of type '${actualType}', not '${expectedType}'`
          });
          return;
        }
      }
      const deleted = await WsjServerGlobal.winccoa.dpDelete(name);
      res.status(deleted ? 200 : 500).json({ ok: Boolean(deleted), dpName: name });
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  /** DELETE /api/para/dptype/:name. */
  public deleteDpType = async (req: Request, res: Response): Promise<void> => {
    const name = req.params['name'];
    try {
      const deleted = await WsjServerGlobal.winccoa.dpTypeDelete(name);
      res.status(deleted ? 200 : 500).json({ ok: Boolean(deleted), typeName: name });
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * Returns true if a data point instance exists. dpExists() expects a DPE,
   * so we accept either the bare DP name or its root form (`<name>.`).
   */
  private dpInstanceExists(name: string): boolean {
    const w = WsjServerGlobal.winccoa;
    return w.dpExists(name) || w.dpExists(`${name}.`);
  }
}
