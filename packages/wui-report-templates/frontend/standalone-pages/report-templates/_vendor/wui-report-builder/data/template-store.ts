/** Persistence for report templates (1 DP per template, type `ReportBuilder_Template`). */
import type { ReportTemplate } from '../types.js';
import { buildDemoTemplates } from './demo.js';
import { DpJsonStore } from './dp-json-store.js';

export class TemplateStore extends DpJsonStore<ReportTemplate> {
  constructor() {
    super('ReportBuilder_Template', 'ReportBuilder_Template_', (t) => t.name || 'modèle', buildDemoTemplates);
  }
}
