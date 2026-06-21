/**
 * Persistence for the Audit-trail page configuration. The whole config is kept
 * in a single WinCC OA datapoint — type `AuditTrail_Config`, a Struct with one
 * String element `json` holding the serialized {@link AuditConfig}. Thin adapter
 * over the shared {@link DpSingleJsonStore} (object mode); the page calls the
 * inherited `load`/`save` directly, so no alias methods are needed.
 */
import { DpSingleJsonStore } from '@visuelconcept/wui-kit/data/dp-single-json-store.js';
import { DEFAULT_AUDIT_CONFIG, type AuditConfig } from './types.js';

export class AuditConfigStore extends DpSingleJsonStore<AuditConfig> {
  constructor() {
    super('AuditTrail_Config', 'AuditTrail_Config', () => structuredClone(DEFAULT_AUDIT_CONFIG));
  }
}
