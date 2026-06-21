# wui-audit-trail — notes métier & architecture

Module Tier 1 (front-end pur, aucun backend ni manager, `npmDeps` vide). Route `/audit-trail`, élément `wui-audit-trail`, visible dans le menu.

## Domaine / objet

Page autonome **Audit Trail** : visualise l'historique archivé (NGA) d'un datapoint sous forme de **table pivot large**.

- Colonnes = les éléments de structure (leaves) du DP cible.
- Lignes = timestamps de changement (ordre décroissant).
- Chaque ligne porte la valeur de **toutes** les colonnes par report (carry-forward) : à un instant `t`, on affiche pour chaque colonne la dernière valeur archivée ≤ `t`.

Configuration via un popup (bouton engrenage « Configurer ») : choix du DP cible, de la période, des colonnes/éléments affichés et du rafraîchissement auto.

## Modèle de données (DPs)

- **Persistance config** : un unique DP `AuditTrail_Config` (Struct, champ String `json`) contenant l'`AuditConfig` sérialisé. Type + DP déjà créés dans le projet.
- Accès via `AuditConfigStore` (calqué sur l'`OrderStore` de production-orders) :
  - création paresseuse type/DP par REST `/api/para/dptype|dp/create`,
  - écriture par `/api/para/dp/set`,
  - lecture par `OaRxJsApi.dpGet`,
  - fallback hors-ligne.
- Le **DP audité** n'est pas créé par la page : il doit déjà exister et être **archivé NGA** (sinon « Aucune donnée d'historique »).

`AuditConfig` retient : DP cible, période (today / 24h / 7d / 30d / custom), `maxRows` (200 / 500 / 1000 / 5000), liste des éléments cochés, toggle rafraîchissement auto.

## Algorithmes / formules clés

Moteur pur dans `engine.ts` : `structLeaves`, `queryHistory`, `buildPivot`.

- **Énumération des éléments** (`fetchElements`, point critique de faisabilité) :
  - `WuiDpeService.getDatapointTypes(name)` appelle `etm.model.type.get` qui attend un nom de **TYPE** → échoue généralement pour un **DP** choisi par l'utilisateur.
  - **Fallback** : `OaRxJsApi.dpNames('<dp>.*', '')` (type-agnostique), renvoie directement les DPE éléments — idéal pour les DP plats (ex. MachineSim).
  - Parcours des feuilles : `structLeaves`, où une feuille = `typeof value === 'string'` (motif para-nav).
- **Historique** : par colonne, `queryHistory(api, dpe, start, end)` = `api.dpGetPeriod(start, end, 0, dpe + ':_original.._value')` (même approche que le moteur fleet-stop). Parse `{data, dataTime}` → échantillons.
- **Pivot** (`buildPivot`) : union de tous les timestamps de changement (tri décroissant, plafonné à `maxRows`) ; chaque cellule = dernière valeur ≤ `t` par **recherche dichotomique** dans les échantillons de la colonne.

## Pièges / à savoir

- `getDatapointTypes` attend un **type**, pas un DP : ne pas compter dessus pour énumérer les éléments d'un DP arbitraire → utiliser le fallback `dpNames('<dp>.*','')`.
- Le DP audité **doit être archivé NGA** ; sans archivage, aucune donnée d'historique n'est retournée.
- **Live** : `dpConnect` sur les DPE affichés déclenche une re-query débouncée (motif vue 3D / dashboard), conditionnée par le toggle de rafraîchissement.
- Une feuille de structure est détectée par `typeof value === 'string'` (motif para-nav) — les éléments non-string peuvent être ignorés par ce critère.
- Bundle auto-découvert (`.ts` de premier niveau dans standalone-pages) et **self-contained** (pas de chunk partagé).
