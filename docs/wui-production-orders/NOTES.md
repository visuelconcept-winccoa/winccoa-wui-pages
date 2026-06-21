# wui-production-orders — notes métier & architecture

Page WebUI standalone **Production Orders** (`/production-orders`, custom element `wui-production-orders`, classe `WuiProductionOrders`). Tier 3 (frontend + manager backend). Préfixe page `wui-`, préfixe sous-composants `po-`. Permission menu `connected`, icône `capacity`.

## Domaine / objet

Gestion des **ordres de fabrication (OF)** : table CRUD triable, workflow de statut, barre d'indicateurs (KPI), vue Planning Gantt et lien avec la flotte machines 3D.

Modèle `ProductionOrder` (`types.ts`) :
- **Identité / produit** : `orderNo`, `product`, `article`, `qtyOrdered` / `qtyProduced`.
- **Affectation** : `atelierId/Name`, `machineId/Name`.
- **Planning** : `planned`/`actual` start/end, stockés en chaînes locales `YYYY-MM-DDTHH:mm`.
- **Statut** : `planned | running | paused | done | cancelled`.
- **Autres** : `priority`, `progress`, `notes`.
- Les maps libellé+couleur de statut et de priorité vivent dans `types.ts`.

Fonctionnalités : table (`po-order-table`) avec boutons de workflow + edit/delete + barre de progression ; barre KPI (total / à venir / en cours / terminés / en retard) ; dialog create/edit (`po-order-dialog`, `<input type=datetime-local>` pour les dates) ; export JSON+CSV / import JSON (`data/io.ts`, enveloppe `{kind:'production-orders', version, orders}`) ; bascule de vue Table / Planning.

## Modèle de données (DPs)

**Persistance différente des autres pages** : la **liste entière est UN seul DP** (choix métier explicite « 1 seul DP = liste JSON »), et NON un DP par enregistrement.

- Type `ProductionOrders_List` : Struct avec un unique élément String `json` ; instance unique `ProductionOrders_List`.
- `OrderStore.load()` lit `<DP>.json` (helper `extractJsonString` qui repère une chaîne commençant par `[`) ; `saveAll(orders)` réécrit tout le tableau via PARA REST `/api/para/dp/set`.
- Auto-création type+DP via `/api/para/dptype/create` + `/api/para/dp/create` ; fallback transparent en mémoire en mode offline.

DP KPI (calculé côté serveur, voir Backend) :
- Type `ProductionOrders_Kpi` : Struct, Float `total / planned / running / paused / done / cancelled / late / avgProgress` + String `updatedAt` ; instance unique.

## Algorithmes / formules clés

- **Workflow de statut** (`workflow.ts`) : `actionsFor(status)` renvoie les transitions autorisées avec leur icône (play/pause/check/cancel). `applyTransition` estampille `actualStart`/`actualEnd` + ajuste `progress`. Les boutons-icônes inline de la table émettent `wui:status {id, target}`.
- **Gantt Planning** (`po-gantt.ts`) : echarts custom-series, une ligne par OF, axe x temporel, barre colorée selon le statut. echarts externalisé via l'import-map du shared-bundle (même schéma que fleet-stop-analysis).
- **KPI** : comptages par statut + `late` (planned-end dépassé) + `avgProgress`, calculés côté manager (voir ci-dessous).

## Backend / manager

Manager WinCC OA `productionOrdersKpi` (`manager/productionOrdersKpi/index.js`, JS pur, winccoa-manager). La barre d'indicateurs en haut de page **n'est PAS calculée dans le navigateur** : le manager en est propriétaire.

- Au démarrage il `dpTypeCreate` le type `ProductionOrders_Kpi` + son DP, puis **poll** `ProductionOrders_List.json` toutes les ~5 s (poll volontaire, et non `dpConnect`, pour que le compteur `late` se rafraîchisse au fil du passage des planned-ends), calcule les comptages et `dpSet` les champs — **gardé par une signature JSON** pour n'écrire que sur changement.
- Côté front, `po-kpi-bar.ts` résout `OaRxJsApi` (tsyringe) et `dpConnect` les DPE `ProductionOrders_Kpi.<champ>` en live ; il conserve le calcul en mémoire depuis `.orders` comme **fallback** (`live === null` → local) pour garder des chiffres en mode offline.
- pmon : `node | always | 30 | 3 | 1 | productionOrdersKpi/index.js`.

## Lien flotte (Machine Fleet 3D)

- La page instancie le `FleetStore` de Machine Fleet 3D (`./machine-fleet-3d/data/fleet-store.js`) pour peupler les selects cascade atelier→machine du dialog et pour seeder les OF de démo sur la **vraie** flotte (`data/demo-orders.ts buildDemoOrders(ateliers)`).
- Sur statut → `running`, push best-effort de `orderNo`/`product` vers les champs `workOrderDp`/`operationDp` de la machine affectée (ces champs MachineDef pilotent l'affichage OF/Op de la bulle 3D) ; nettoyés sur `done`/`cancelled` (`data/fleet-link.ts`, REST `/api/para/dp/set`, tout en try/catch silencieux).
- Partage le chunk rollup `chunks/fleet-store.js` avec les autres pages flotte.

## Pièges / à savoir

- **Extraction de champ DPE côté `po-kpi-bar`** : depuis l'émission dp normalisée via un `fieldOf` local (retirer `System1:`, `:_online.._value` et le point final, prendre la partie après le dernier `.`).
- **Icônes ix** : `play`/`pause`/`check`/`cancel` existent ; `floppy-disk`/`chart-bar`/`save` n'existent PAS → utiliser `check`/`barchart-horizontal`/`table`.
- **Lint** : `no-magic-numbers` non bloquant ; `unicorn/consistent-function-scoping` signale les arrows internes `pad`/`fmt` → les hisser au scope module.
- **Labels** : actuellement hard-codés en FR dans les composants (pas d'i18n FR/DE encore).
- **Non encore fait** : import d'OF depuis ERP/MES, archivage de l'historique des OF (le DP Kpi pourrait être archivé NGA pour du trending), binding live de `qtyProduced` depuis les compteurs machine.
