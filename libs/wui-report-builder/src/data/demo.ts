// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Demo seed for the Report Builder: one fully-featured template (one section of
 * each kind + a checklist + the default multi-signature workflow) and one report
 * instantiated from it. Used for the offline in-memory fallback and the
 * empty-state "generate demo" actions.
 */
import {
  blankColumn,
  blankField,
  blankChecklistItem,
  defaultWorkflow,
  instantiateReport,
  uid,
  type Report,
  type ReportTemplate,
  type TemplateSection
} from '../types.js';

function section(over: Partial<TemplateSection> & Pick<TemplateSection, 'kind' | 'title'>): TemplateSection {
  return { id: uid('sec'), ...over };
}

/** The reusable "Contrôle qualité" demo template. */
// eslint-disable-next-line max-lines-per-function -- single demo-data literal
function qualityTemplate(): ReportTemplate {
  const sections: TemplateSection[] = [
    section({
      kind: 'fields',
      title: 'Identification',
      fields: [
        { ...blankField(), label: 'Référence pièce', type: 'text' },
        { ...blankField(), label: 'Quantité', unit: 'pcs', type: 'number' },
        { ...blankField(), label: 'Lot', type: 'text' }
      ]
    }),
    section({
      kind: 'dataset',
      title: 'Mesures four (archives)',
      chart: true,
      datasets: [
        {
          id: uid('ds'),
          label: 'Température',
          dp: 'MachineSim_four1.temperature',
          ops: ['avg', 'min', 'max', 'stddev']
        }
      ]
    }),
    section({
      kind: 'table',
      title: 'Relevés dimensionnels',
      columns: [
        { ...blankColumn(), label: 'Cote', type: 'text' },
        { ...blankColumn(), label: 'Nominal', type: 'number' },
        { ...blankColumn(), label: 'Mesuré', type: 'number' }
      ]
    }),
    section({
      kind: 'checklist',
      title: 'Contrôles obligatoires',
      items: [
        { ...blankChecklistItem(), label: 'Étalonnage des instruments vérifié', required: true },
        { ...blankChecklistItem(), label: 'Aspect visuel conforme', required: true },
        { ...blankChecklistItem(), label: 'Documentation jointe', required: false }
      ]
    }),
    section({ kind: 'comment', title: 'Observations', placeholder: 'Remarques du contrôleur…' })
  ];
  return {
    id: 'demo-tpl-qc',
    dp: '',
    name: 'Contrôle qualité (démonstration)',
    description: 'Modèle de démonstration : identification, mesures four, relevés, checklist et observations.',
    sections,
    workflow: defaultWorkflow(),
    updatedAt: '',
    updatedBy: 'demo'
  };
}

export function buildDemoTemplates(): ReportTemplate[] {
  return [qualityTemplate()];
}

export function buildDemoReports(): Report[] {
  const template = qualityTemplate();
  const report = instantiateReport(template);
  report.id = 'demo-rep-001';
  report.reportNo = 'RC-2026-001';
  report.title = 'Contrôle lot A — démonstration';
  report.subject = 'Lot A / OF-1024';
  return [report];
}
