/**
 * Predefined example atelier "templates" offered in the New-atelier dialog.
 *
 * To add a new example set: add one entry to {@link ATELIER_TEMPLATES} and a
 * matching case in {@link templateSeed} (the seed `Atelier` to clone from).
 */
import type { Atelier } from '../types.js';
import { DEMO_ATELIER } from './demo-layout.js';
import { SEMIFAB_ATELIER } from './semifab-demo.js';

export interface AtelierTemplate {
  /** Template id passed back in the create event (empty = blank atelier). */
  id: string;
  /** Label shown in the dialog's template selector. */
  name: string;
}

/** Selectable starter sets (first entry is the default = empty atelier). */
export const ATELIER_TEMPLATES: AtelierTemplate[] = [
  { id: '', name: 'Atelier vide' },
  { id: 'demo', name: 'Démonstration (machines variées)' },
  { id: 'semifab', name: 'SemiFab (semi-conducteurs)' }
];

/** Resolve a template id to the seed atelier to clone (undefined = blank). */
export function templateSeed(id: string | undefined): Atelier | undefined {
  if (id === 'demo') return DEMO_ATELIER;
  if (id === 'semifab') return SEMIFAB_ATELIER;
  return undefined;
}
