# wui-report-builder — notes métier & architecture

Version générique et configurable de la page thermal-reports (TTD), dont elle reprend les
mécanismes (persistance 1-DP, lecture d'archives côté client, impression). Tier 1 : pas de
backend ni de manager dédié (cf. `module.json`). Dép. npm : `@siemens/ix-echarts`.
Préfixe des sous-composants : `rb-`.

## Domaine / objet

Construire des rapports configurables à partir de **modèles** (templates) paramétrables, puis
remplir des **rapports** (instances) avec un workflow de **signatures multi-niveaux** verrouillé
par checklist.

**Deux pages routées indépendantes** (séparées volontairement, voir Pièges) :
- **Reports** — entrée `report-builder.ts`, élément `wui-report-builder`, classe `WuiReportBuilder`.
  Routes `/report-builder` (liste) + `/report-builder/:reportid` (détail). **Chaque rapport a sa
  propre URL** : `@property({attribute:'reportid'}) reportId` pilote `selectedReport()` ; ouvrir un
  rapport émet `RouterEvent('/report-builder/<id>')`, retour = `RouterEvent('/report-builder')`,
  création → navigation vers le nouvel id (même pattern routé que la page remote-vnc / `connectionid`).
  Lit les modèles en lecture seule pour la boîte de création.
- **Templates** — entrée `report-templates.ts`, élément `wui-report-templates`, classe
  `WuiReportTemplates`. Route `/report-templates`. Liste + modale `rb-template-editor` (édition gated
  par `canPublish`).
- Menu : deux entrées (Reports `/report-builder` icône `document` ; Report Templates
  `/report-templates` icône `list`) + route cachée `/report-builder/:reportid`. Liens croisés entre
  les deux pages via boutons `RouterEvent` en barre d'outils.

**Genres de sections** (`TemplateSection.kind`, union discriminée) :
- `text` — texte libre.
- `comment` — commentaire.
- `fields` — couples clé/valeur (`FieldDef`) avec min/max numérique optionnel → `fieldConform`
  renvoie une puce OK / Hors-tolérance.
- `table` — colonnes configurables (`ColumnDef`), lignes saisies par l'opérateur.
- `dataset` — `DatasetDef = dp + ops[]` ; bouton **Actualiser** lit les archives sur `report.period`
  et fige les agrégations ; graphe ligne echarts optionnel `rb-dataset-chart` (autonome, expose
  `getImageDataUrl()` pour l'impression).
- `checklist` — items ; les items `required` conditionnent la signature.

## Modèle de données (DPs)

**Deux entités persistées**, chacune 1 DP (Struct `name` + `json`, PARA-REST + fallback offline —
mécanisme identique à thermal-reports).

- **`ReportTemplate`** — type DP `ReportBuilder_Template`, préfixe `ReportBuilder_Template_`.
  Réutilisable : `sections: TemplateSection[]` + `workflow: WorkflowState[]`.
- **`Report`** — type DP `ReportBuilder_Report`, préfixe `ReportBuilder_Report_`. Une instance.
  **Fige (snapshot)** les `sections` + `workflow` du modèle à la création (`instantiateReport`), si
  bien que les éditions ultérieures du modèle n'altèrent jamais un rapport signé. Contient
  `data: Record<sectionId, SectionData>`, `currentStateId`, `signatures: SignatureRecord[]`, `period`.

Stockage générique : `data/dp-json-store.ts` = base `DpJsonStore<T extends {id;dp}>` ;
`template-store.ts` / `report-store.ts` = sous-classes fines ; `io.ts` = import/export JSON ± CSV.

## Algorithmes / formules clés

- **Agrégation dataset** (`engine.ts > computeDataset`) : `readSeries` lit l'archive via
  `dpGetPeriod(... ':_original.._value')` sur la `period` du rapport, puis agrège par boucle :
  `avg` / `min` / `max` / `sum` / `last` / `count` / `stddev`. **Côté client**, depuis les archives
  (comme TTD) — aucune agrégation serveur.
- **Conformité champ** : `fieldConform(value, min, max)` → OK / Hors-tolérance.
- **Workflow + signatures multi-niveaux** (le cœur de la demande) : `WorkflowState[]` ordonné ;
  chaque état non final définit un niveau de signature via
  `advance: SignOff {toStateId, actionLabel, roleLabel, level, requirePermission, requireChecklist}`
  → nombre de niveaux arbitraire. Workflow par défaut :
  Brouillon →[L1 Opérateur]→ Vérifié →[L2 Responsable, `requireChecklist`]→ Approuvé, + Rejeté.
  Helpers : `currentState` / `isLocked` / `checklistComplete` / `canAdvance` / `applySignature` /
  `applyReject`. `canAdvance` est gated par `canPublish` (+ checklist) ; `applySignature` enregistre
  **l'utilisateur connecté** (`WuiUserService.name`/`id`) + horodatage ISO + commentaire (via
  `rb-signature-dialog`) puis avance. **État final ⇒ `isLocked` ⇒ rapport en lecture seule.**

## Pièges / à savoir

- **Deux composants séparés, pas un toggle.** L'ancienne page unique avec un toggle segmenté
  Rapports|Modèles partageait un seul état `deleting`, ce qui produisait un parasite
  « supprimer le modèle undefined » au changement de vue. La séparation en deux composants ayant
  chacun leur `deletingId: string | null` a corrigé le bug.
- **Actions de ligne révélées au survol.** Les icônes par ligne (edit/duplicate/trash) vivent dans
  `.actions-col` masquée par défaut (`opacity:0; pointer-events:none`) et rendue visible/cliquable
  uniquement sur `tr:hover` / `:focus-within` (`table-styles.ts`). Sans ça, un clic sur la partie
  droite d'une ligne (pour l'ouvrir) pouvait tomber sur la corbeille toujours visible et déclencher
  une suppression accidentelle. Désormais ces clics retombent sur « ouvrir ».
- **Snapshot à la création.** Un rapport fige `sections` + `workflow` du modèle ; ne jamais supposer
  qu'un rapport reflète l'état courant du modèle.
- **Utilisateur / permission** résolus depuis `WuiUserService` (`.name` / `.id` / `.canPublish`,
  abonnement `user$`) — même mécanisme que ai-assistant / permissions fleet. L'édition des modèles et
  l'avancement du workflow sont gated par `canPublish`.
- **Impression** (`print.ts`) : HTML par genre + bloc signatures + PNG des graphes ; réutilise le
  correctif `PRINT_SCRIPT` de TTD (imprimer **après** décodage des images).
- **`mf-dp-input` réutilisé** depuis machine-fleet-3d pour la saisie du DP de dataset (pattern
  `move()` / patch-par-index dans `rb-template-editor`).
- **Pas (encore) fait** : i18n des libellés FR ; agrégation planifiée côté serveur ; PDF / email ;
  signature électronique cryptographique (les signatures = nom + horodatage + permission, sans preuve
  cryptographique).
