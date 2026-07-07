// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Static catalog of the roles each page module expects — the source used by
 * the "Discover modules" action to seed/refresh every `AppSecurity_<module>`
 * datapoint (covers pages that were never visited and visitors without write
 * rights; modules ALSO self-register their declaration at page load via
 * `registerModuleRoles`, so a newer module can add roles ahead of this list).
 *
 * Convention: a `view` role gates opening the page's data at all; the other
 * roles gate specific abilities. Per the validated design every role is OPEN
 * until the administrator assigns at least one group to it.
 */
import type { AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import { ml } from './i18n.js';

/** Reused role builders (kept terse — the catalog is long). */
const view = { id: 'view', label: ml('View', 'Consulter', 'Ansehen') };
const edit = { id: 'edit', label: ml('Edit', 'Éditer', 'Bearbeiten') };

export const MODULE_MANIFEST: AppModuleRoles[] = [
  {
    module: 'para',
    title: ml('Parametrization (PARA)', 'Paramétrage (PARA)', 'Parametrierung (PARA)'),
    roles: [
      view,
      {
        id: 'edit-types',
        label: ml('Edit DP types', 'Éditer les types de DP', 'DP-Typen bearbeiten'),
        description: ml('Create/change/delete datapoint types.', 'Créer/modifier/supprimer des types de datapoints.', 'Datenpunkttypen anlegen/ändern/löschen.')
      },
      {
        id: 'edit-values',
        label: ml('Write values & configs', 'Écrire valeurs & configs', 'Werte & Configs schreiben'),
        description: ml('Set element values and config attributes.', 'Écrire les valeurs et attributs de configuration.', 'Elementwerte und Config-Attribute schreiben.')
      },
      {
        id: 'dpl-import',
        label: ml('DPL import/export', 'Import/export DPL', 'DPL-Import/-Export'),
        description: ml('ASCII DPL import into the project.', 'Import DPL ASCII dans le projet.', 'ASCII-DPL-Import in das Projekt.')
      }
    ]
  },
  {
    module: 'machine-fleet-3d',
    title: ml('Machine Fleet 3D', 'Parc machine 3D', 'Maschinenpark 3D'),
    roles: [
      view,
      {
        id: 'edit',
        label: ml('Edit workshops', 'Éditer les ateliers', 'Werkstätten bearbeiten'),
        description: ml('Edit 3D layout, machines and configuration.', 'Éditer l’implantation 3D, machines et configuration.', '3D-Layout, Maschinen und Konfiguration bearbeiten.')
      },
      {
        id: 'ai',
        label: ml('AI assistant', 'Assistant IA', 'KI-Assistent'),
        description: ml('Use the embedded AI assistant.', 'Utiliser l’assistant IA intégré.', 'Den integrierten KI-Assistenten verwenden.')
      }
    ]
  },
  {
    module: 'process-monitor',
    title: ml('Process Monitor', 'Moniteur de processus', 'Prozessmonitor'),
    roles: [
      view,
      {
        id: 'control',
        label: ml('Control managers', 'Piloter les managers', 'Manager steuern'),
        description: ml('Start/stop/restart managers (enforced server-side).', 'Démarrer/arrêter/redémarrer les managers (contrôlé côté serveur).', 'Manager starten/stoppen/neu starten (serverseitig erzwungen).')
      },
      {
        id: 'edit-managers',
        label: ml('Edit manager configuration', 'Éditer la configuration des managers', 'Manager-Konfiguration bearbeiten'),
        description: ml('Add/remove pmon configuration entries — config/progs (enforced server-side).', 'Ajouter/supprimer des entrées de la configuration pmon — config/progs (contrôlé côté serveur).', 'pmon-Konfigurationseinträge hinzufügen/entfernen — config/progs (serverseitig erzwungen).')
      },
      {
        id: 'deploy',
        label: ml('Deploy projects', 'Déployer des projets', 'Projekte deployen'),
        description: ml('Upload and deploy project ZIPs (enforced server-side).', 'Téléverser et déployer des ZIP projet (contrôlé côté serveur).', 'Projekt-ZIPs hochladen und deployen (serverseitig erzwungen).')
      }
    ]
  },
  {
    module: 'ampere',
    title: ml('Ampère (electrical)', 'Ampère (électrique)', 'Ampère (elektrisch)'),
    roles: [
      view,
      {
        id: 'edit',
        label: ml('Edit networks', 'Éditer les réseaux', 'Netze bearbeiten'),
        description: ml('Draw/modify single-line diagrams and bindings.', 'Dessiner/modifier les schémas unifilaires et les liaisons DP.', 'Einpolige Schemata und DP-Bindungen bearbeiten.')
      }
    ]
  },
  {
    module: 'mosaic',
    title: ml('Mosaic', 'Mosaïque', 'Mosaik'),
    roles: [view, { ...edit, description: ml('Compose display walls.', 'Composer les murs d’images.', 'Anzeigewände zusammenstellen.') }]
  },
  {
    module: 'camera-streams',
    title: ml('Camera Streams (RTSP)', 'Flux caméras (RTSP)', 'Kamera-Streams (RTSP)'),
    roles: [view, { ...edit, description: ml('Manage cameras and stream options.', 'Gérer les caméras et options de flux.', 'Kameras und Stream-Optionen verwalten.') }]
  },
  {
    module: 'remote-vnc',
    title: ml('Remote VNC', 'VNC distant', 'Remote-VNC'),
    roles: [
      view,
      {
        id: 'connect',
        label: ml('Open sessions', 'Ouvrir des sessions', 'Sitzungen öffnen'),
        description: ml('Connect to remote desktops.', 'Se connecter aux postes distants.', 'Mit entfernten Desktops verbinden.')
      },
      { ...edit, description: ml('Manage the connection list.', 'Gérer la liste des connexions.', 'Verbindungsliste verwalten.') }
    ]
  },
  {
    module: 'report-builder',
    title: ml('Report Builder', 'Générateur de rapports', 'Berichtsgenerator'),
    roles: [
      view,
      {
        id: 'fill',
        label: ml('Fill reports', 'Remplir les rapports', 'Berichte ausfüllen'),
        description: ml('Create report instances and enter data.', 'Créer des instances de rapport et saisir les données.', 'Berichtsinstanzen anlegen und Daten erfassen.')
      },
      {
        id: 'sign',
        label: ml('Sign reports', 'Signer les rapports', 'Berichte signieren'),
        description: ml('Advance the signing workflow.', 'Faire avancer le circuit de signature.', 'Den Signatur-Workflow fortführen.')
      }
    ]
  },
  {
    module: 'report-templates',
    title: ml('Report Templates', 'Modèles de rapports', 'Berichtsvorlagen'),
    roles: [view, { ...edit, description: ml('Design report templates.', 'Concevoir les modèles de rapports.', 'Berichtsvorlagen gestalten.') }]
  },
  {
    module: 'thermal-reports',
    title: ml('Thermal Treatment Reports', 'Rapports traitement thermique', 'Wärmebehandlungsberichte'),
    roles: [view, { ...edit, description: ml('Create/validate treatment reports.', 'Créer/valider les rapports de traitement.', 'Behandlungsberichte anlegen/freigeben.') }]
  },
  {
    module: 'production-orders',
    title: ml('Production Orders', 'Ordres de production', 'Fertigungsaufträge'),
    roles: [view, { ...edit, description: ml('Manage orders and their workflow.', 'Gérer les OF et leur cycle de vie.', 'Aufträge und deren Workflow verwalten.') }]
  },
  {
    module: 'audit-trail',
    title: ml('Audit Trail', 'Piste d’audit', 'Audit-Trail'),
    roles: [
      view,
      {
        id: 'manage',
        label: ml('Manage audit DPs', 'Gérer les DP d’audit', 'Audit-DPs verwalten'),
        description: ml('Create audit-trail datapoints.', 'Créer les datapoints de piste d’audit.', 'Audit-Trail-Datenpunkte anlegen.')
      }
    ]
  },
  {
    module: 'fleet-stop-analysis',
    title: ml('Fleet Stop-Cause Analysis', 'Analyse des causes d’arrêts', 'Stillstandsursachen-Analyse'),
    roles: [view]
  },
  {
    module: 'fleet-kpi-analysis',
    title: ml('Fleet KPI Analysis', 'Analyse des KPI', 'KPI-Analyse'),
    roles: [view]
  },
  {
    module: 'fleet-closures',
    title: ml('Fleet Closures', 'Fermetures du parc', 'Betriebsschließungen'),
    roles: [view, { ...edit, description: ml('Manage non-working periods.', 'Gérer les périodes non travaillées.', 'Nichtarbeitszeiten verwalten.') }]
  },
  {
    module: 'app-security',
    title: ml('Application Security', 'Sécurité applicative', 'Anwendungssicherheit'),
    roles: [
      {
        id: 'manage',
        label: ml('Manage role assignments', 'Gérer les associations de rôles', 'Rollenzuordnungen verwalten'),
        description: ml(
          'Assign WinCC OA groups to module roles. Assign this role first — it protects this page itself.',
          'Associer les groupes WinCC OA aux rôles des modules. À assigner en premier — il protège cette page elle-même.',
          'WinCC-OA-Gruppen den Modulrollen zuordnen. Zuerst zuweisen — sie schützt diese Seite selbst.'
        )
      }
    ]
  }
];
