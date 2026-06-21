# wui-thermal-reports — notes métier & architecture

Page WebUI autonome **Rapports de traitement thermique (TTD)** (`/thermal-reports`).
Custom element d'entrée `wui-thermal-reports` (classe `WuiThermalReports`), préfixe des sous-composants `tt-`. Permission requise : `connected`. Tier 1 (front pur, aucun backend ni manager dédié).

## Domaine / objet

Rapports de cycle de traitement thermique **par charge** (four). Chaque rapport documente :

- **Identité** : reportNo / charge / orderNo (OF) / pièce / matière / quantité.
- **Traitement** : `TreatmentType` (cementation, carbonitruration, nitruration, trempe, revenu, recuit, detente, normalisation, autre) + `QuenchMedium` (média de trempe) + `atmosphere` (texte libre).
- **Recette** : `steps: ThermalStep[]`, chaque palier = consigne (`setpoint` °C) / `durationMin` / tolérances `tolMinus`/`tolPlus` / `atmosphere` / `label`.
- **Lien four** : atelierId/Name, machineId/Name + `tempDp` (DPE de température) + fenêtre de cycle `startTime`/`endTime` (format `YYYY-MM-DDTHH:mm`).
- **Qualité** : `results: QualityResult[]` (label/value/unit/min/max), `conformity` (pending / conform / nonconform).
- **Cycle de vie** : `status` (draft / running / completed / validated / rejected) + operator / validatedBy / validatedAt / notes.

Modèle dans `types.ts` : maps libellés+couleurs, helpers `blankReport` / `blankStep` / `blankResult`, `resultConform`, `sanitizeId`, `tempDpForMachine`.

Vue **maître/détail** : l'entrée bascule entre la liste (`tt-report-table` + `tt-kpi-bar` + toolbar) et la vue détail via `selectedId`. La barre KPI est calculée **localement dans le navigateur** (pas de manager serveur).

## Modèle de données (DPs)

**1 DP par rapport** (choix assumé), type **`ThermalReport_Report`** (Struct : String `name` + String `json`), préfixe `ThermalReport_`.

- Auto-création du type et des DP via PARA REST (`/api/para/dptype|dp/create`, `/api/para/dp/set`, `DELETE /api/para/dp/:name?dpType=`) — copie exacte de l'`AssetStore` de la page asset-lifecycle. Le type **n'est pas pré-créé via MCP** : l'auto-création au premier chargement suffit.
- Lecture via `WuiDpeService.listDatapoints` + `OaRxJsApi.dpGet`.
- **Fallback offline transparent** (`mem()`) : amorce `buildDemoReports([])` → 4 rapports de démo hors-ligne.
- Persistance dans `data/report-store.ts` ; export/import JSON (enveloppe `{kind:'thermal-reports', version, reports}`) + export CSV dans `data/io.ts`.

## Algorithmes / formules clés

Cœur dans `engine.ts` :

- **Source de données = archives du four** (choix explicite). Le rapport lit la **courbe de température réelle** depuis le DPE archivé du four sur `[startTime, endTime]` :
  `readActualCurve` = `api.dpGetPeriod(start, end, 0, tempDp + ':_original.._value')` (même mécanisme que la page audit-trail / l'engine fleet).
- **DPE de température par défaut** auto-rempli dans le dialogue depuis le four sélectionné = **`MachineSim_<sanitize(machineId)>.temperature`** (le manager machineSim simule la température du four sous `MachineSim_<id>.temperature`).
- `synthesizeActual` : quand aucune donnée archivée n'est trouvée (offline / DPE non archivé), construit une courbe plausible **déterministe** (retard 1er ordre vers l'escalier de consignes + oscillation sinusoïdale, **pas de RNG**) ; le détail affiche alors « courbe simulée ».
- `buildProfile` : escalier des consignes + bande de tolérance (2 points/palier, `step:'end'`).
- `evaluateCycle` : → `inBandPct` / `maxDeviation` / min-max.

**Graphique** (`tt-temp-chart.ts`, echarts) : ligne réelle (smooth) + consigne en escalier pointillé + bande de tolérance via le **trick de bande de confiance empilée** (série basse invisible `bandBase` empilée sous une série d'épaisseur remplie `Tolérance`). `getImageDataUrl()` expose un PNG pour l'impression.

## Pièges / à savoir

- **Impression — courbe blanche (corrigé 2026-06-20)** : `win.print()` était appelé **de façon synchrone** juste après `document.write`, en concurrence avec le décodage du data-URL `<img>` du PNG. Correctif : `print.ts` injecte un `PRINT_SCRIPT` qui n'appelle `window.print()` **qu'après chargement de toutes les `document.images`** ; `tt-report-detail.print()` ne fait plus que `document.write` + `close`. Ceinture+bretelles dans `tt-temp-chart.ts` : `getImageDataUrl()` fait `chart.resize()` avant `getDataURL` (élimine la taille écran périmée — la raison pour laquelle le zoom « aidait parfois »), et l'option chart fixe `animation: false` (jamais de capture mi-dessinée).
- **echarts** : importé en `import * as echarts` (externalisé via l'import-map du shared-bundle, comme po-gantt / fleet-stop) — ce n'est PAS un chunk.
- **Validation/refus** : les boutons émettent `wui:status` ; `applyStatus` (dans l'entrée) estampille `validatedBy`/`validatedAt` et dérive la conformité depuis `pending`.
- **Impression** = `print.ts buildPrintHtml` (pur, embarque le PNG du chart) → document HTML autonome dans une nouvelle fenêtre.
- **Démo** (`data/demo-reports.ts`) : `buildDemoReports(ateliers)` bâtit 4 rapports (cémentation / nitruration / trempe / détensionnement, statuts+conformités mixtes) sur de vrais fours de la flotte (type `four`) ; fabrique 2 fours placeholder si la flotte n'en a aucun. Utilisé par le bouton empty-state ET l'amorce offline.

## Non fait / pistes

- Rafraîchissement **live `dpConnect`** de la courbe pendant qu'une charge tourne (actuellement lecture one-shot à l'ouverture/édition).
- i18n DE/EN des libellés FR in-component.
- Dérivation auto plus riche de la conformité (aujourd'hui champ manuel + indicateurs calculés).
- Archivage NGA des DP de rapport pour le trending.
