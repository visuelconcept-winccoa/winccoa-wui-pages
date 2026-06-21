# wui-report-templates — notes métier & architecture

## Domaine / objet

Page autonome **Report Templates** (route `/report-templates`) : éditeur de **modèles de rapports** réutilisables et configurables. C'est la version *générique et paramétrable* de la page TTD codée en dur (thermal-reports).

- Élément `wui-report-templates`, classe `WuiReportTemplates`, entrée `report-templates.ts`. Préfixe des sous-composants : `rb-`.
- Affiche une liste de modèles + un éditeur modal en place `rb-template-editor`. L'édition est conditionnée par `canPublish`.
- Un modèle décrit la structure d'un rapport : une suite de **sections paramétrées** + un **workflow de signatures multi-niveaux**. Il ne contient aucune donnée d'exploitation : ce sont les *instances* `Report` (page Reports `/report-builder`, package séparé) qui figent (snapshot) `sections`+`workflow` du modèle à leur création et portent les données saisies.
- Séparation Reports / Templates en **deux pages indépendantes** : historiquement un seul composant avec bascule segmentée Rapports|Modèles partageait un état `deleting` unique → bug fantôme « supprimer le modèle undefined » au changement de vue. Chaque composant a désormais son propre `deletingId: string|null`.

## Modèle de données (DPs)

Tier 1 : persistance frontend uniquement (PARA-REST + repli offline), **pas de manager backend**. 1 DP par entité, Struct `name`+`json`.

- **`ReportTemplate`** — type DP `ReportBuilder_Template`, préfixe `ReportBuilder_Template_`. Entité réutilisable, contient :
  - `sections: TemplateSection[]`
  - `workflow: WorkflowState[]`
- (Pour mémoire, entité gérée par la page Reports, hors de ce package : **`Report`** = type `ReportBuilder_Report`, qui *snapshote* `sections`+`workflow` du modèle à la création.)

Côté code partagé : base générique `DpJsonStore<T extends {id; dp}>` (`data/dp-json-store.ts`) ; `template-store.ts` en est une sous-classe mince. Helpers modèle dans `types.ts` (factories de structures vierges, `instantiateReport`, `fieldConform`, `uid`, `nowLocal`).

### Types de sections (`TemplateSection.kind`, union discriminée)

- `text` — bloc texte.
- `comment` — commentaire libre.
- `fields` — paires clé/valeur (`FieldDef`) avec `min`/`max` numériques optionnels → `fieldConform` produit une puce OK / Hors-tolérance.
- `table` — colonnes configurables (`ColumnDef`), lignes saisies par l'opérateur dans l'instance.
- `dataset` — `DatasetDef` = un DP + une liste d'opérations d'agrégation `ops[]`. Dans l'instance, « Actualiser » lit les archives sur la période du rapport et fige les agrégations ; graphe optionnel `rb-dataset-chart` (echarts ligne, autonome, `getImageDataUrl()` pour l'impression).
- `checklist` — items ; ceux marqués `required` conditionnent la signature.

## Algorithmes / formules clés

- **Conformité champ** : `fieldConform` → OK si `min ≤ valeur ≤ max` (bornes optionnelles), sinon Hors-tolérance.
- **Workflow multi-niveaux** (le cœur de la fonctionnalité) : `WorkflowState[]` ordonnés. Chaque état non final porte `advance: SignOff { toStateId, actionLabel, roleLabel, level, requirePermission, requireChecklist }` → un niveau de signature, nombre de niveaux arbitraire.
  - Workflow par défaut : `Brouillon →[L1 Opérateur]→ Vérifié →[L2 Responsable, requireChecklist]→ Approuvé`, plus un état `Rejeté`.
  - Helpers (`engine.ts`, partagé) : `currentState`, `isLocked`, `checklistComplete`, `canAdvance`, `applySignature`, `applyReject`. `canAdvance` est conditionné par `canPublish` (+ checklist si `requireChecklist`). L'état final ⇒ `isLocked` ⇒ rapport en lecture seule.
- **Agrégation dataset** (côté instance, partagé) : `computeDataset` → `readSeries` via `dpGetPeriod(... ':_original.._value')` puis agrégat en boucle : avg / min / max / sum / last / count / stddev. Calcul **client-side** depuis les archives (comme TTD), pas de tâche serveur.

## Pièges / à savoir

- **Édition gated par `canPublish`** : l'utilisateur connecté et ses droits viennent de `WuiUserService` (`.name` / `.id` / `.canPublish`, souscription `user$`) — même mécanisme que les permissions fleet / ai-assistant. Les signatures = nom + timestamp ISO + permission (pas de signature cryptographique).
- **Colonne d'actions révélée au survol** : dans `rb-template-table`, les icônes par ligne (éditer / dupliquer / corbeille) sont dans `.actions-col` masquée par défaut (`opacity:0; pointer-events:none`), visible et cliquable seulement sur `tr:hover` / `:focus-within` (`table-styles.ts`). Correctif anti-suppression accidentelle : avant, cliquer à droite d'une ligne pour l'ouvrir pouvait tomber sur la corbeille toujours visible et déclencher la confirmation de suppression ; désormais ces clics « tombent » sur l'action ouvrir.
- **Snapshot à la création de rapport** : les modifications ultérieures d'un modèle n'altèrent jamais un rapport déjà créé/signé (l'instance fige `sections`+`workflow`). À garder à l'esprit pour toute évolution du modèle de données.
- **Composants partagés réutilisés** : `rb-template-editor` est onglé (Sections | Workflow), réutilise `mf-dp-input` (depuis machine-fleet-3d) pour saisir le DP d'un dataset, et un pattern `move()` / patch-par-index pour ajout/suppression/réordonnancement. Styles partagés `dialog-styles.ts` / `table-styles.ts`.
- **Non réalisé / limites connues** : i18n des libellés FR ; agrégation planifiée côté serveur ; export PDF / email ; signature électronique cryptographique.
