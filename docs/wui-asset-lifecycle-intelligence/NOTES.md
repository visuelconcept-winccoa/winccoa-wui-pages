# wui-asset-lifecycle-intelligence — notes métier & architecture

Page WebUI autonome **Asset Lifecycle Intelligence** (route `/asset-lifecycle`, custom element `wui-asset-lifecycle`, classe `WuiAssetLifecycle`). Premier niveau de la fonctionnalité **asset-management** : inventaire des équipements de terrain (parc d'actifs) avec moteur de scoring de risque composite. Sous-composants UI préfixés `ali-` (l'élément de page reste `wui-`). Tier 3 (backend `/api` + manager MSA).

## Domaine / objet

Gestion du cycle de vie et du risque d'obsolescence d'un **parc d'actifs industriels**. Chaque `Asset` regroupe :
- **Identité terrain** : MLFB (référence produit Siemens), station, IP, atelier/zone, firmware (terrain + disponible), successeur.
- **Entrées de risque** : phase de cycle de vie (PLM), écart firmware, criticité, approvisionnement (supply), sévérité de vulnérabilité, heures de fonctionnement, MTBF.
- **Provenance** (`source` : `tia` | `csv` | `manual`), libellés + couleurs de chip dans `types.ts`.

Données de démo : usine de fab semi-conducteurs / utilités salle blanche (16 actifs : HVAC, Chiller, UPW, séparation d'air ASU, gas cabinet, gaz/chimie en vrac, scrubber, distribution électrique, lithographie, inspection wafer, test, eaux usées, salle de contrôle), valeurs réglées pour couvrir toute la plage de risque Low→Critical.

### Phases de cycle de vie (PLM Siemens officiel)

`LifecyclePhase`, dans l'ordre :
- **PM300** — actif (commandable comme pièce neuve)
- **PM400** — phase-out annoncé (encore pièce neuve)
- **PM410** — annulation (pièce de rechange uniquement)
- **PM490** — discontinuation (sous garantie)
- **PM500** — fin de vie

Les codes inventés PM100/PM200 ont été retirés. `normalizePhase()` (`types.ts`) migre les codes legacy PM100/PM200 → PM300 et neutralise les valeurs inconnues ; appliqué à chaque lecture (`asset-store.readAsset`) et import (`io.normalize`). Attention : les anciens codes avaient un sens DIFFÉRENT (ancien PM300 « fin de production annoncée » = nouveau PM400) — la remappe se fait par SENS, pas par code.

## Modèle de données (DPs)

- **Persistance : 1 DP par actif**, type **`AssetLifecycle_Asset`** (Struct String `name` + `json`). Le pattern copie le FleetStore : création auto via REST PARA (`POST /api/para/dptype/create`, `/api/para/dp/create`, `/api/para/dp/set`, `DELETE /api/para/dp/:name?dpType=`) ; lecture via `WuiDpeService.listDatapoints` + `OaRxJsApi.dpGet`.
- **Fallback offline** en mémoire, amorcé avec `DEMO_ASSETS` si backend/droits absents → bannière d'avertissement.
- **Config product-info : DP `ProductInfo_Config`** (Struct String `apiKey` / `baseUrl` / `apiVersion`), côté manager — clé API jamais exposée au navigateur. Amorcée au premier démarrage via `dpGet` / `dpSetWait` RAW (ne pas amorcer via `readConfig()` : son masquage `||DEFAULT` rend le test « vide » toujours faux).

### Import / export

- **Export JSON** : enveloppe `{kind, version, assets}`, round-trip complet.
- **Export CSV** : ajoute score + niveau calculés, BOM UTF-8 pour Excel (export seulement).
- **Import JSON** : `parseAssets` normalise sur `blankAsset`, matche par `id` (update sinon create) ; les enregistrements sans `source` explicite sont auto-tagués `csv`.
- **Import AML / TIA** (`data/aml-import.ts`) : parse un export « CAx data » TIA Portal `.aml` (CAEX XML) via `DOMParser`. Walk projet → devices (rôle `Device`) → racks (TypeName `Rack` / nom `*Rail*`) → modules ; tout module avec un `TypeIdentifier` `OrderNumber:` devient un actif (MLFB nettoyé des espaces, firmware depuis `FirmwareVersion`, IP depuis le premier `NetworkAddress` descendant). Chaque actif porte `tiaProject` (nom du projet AML) + `tiaKey` (`device/module#slot`, stable entre ré-exports). **Ré-import** : matche sur `tiaProject+tiaKey` et appelle `mergeAmlAsset` → rafraîchit les champs matériels (name/mlfb/station/ip/firmwareField) tout en **préservant** l'évaluation de risque de l'utilisateur (phase/criticité/supply/vuln/hours/mtbf/area/notes/successeur/firmwareAvail).

## Algorithmes / formules clés

### Moteur de risque (`risk.ts`)

Score composite **0–100** = Σ(scoreComposante × poids) sur **6 composantes pondérées** :

| Composante     | Poids |
|----------------|-------|
| Obsolescence   | 0,25  |
| Firmware       | 0,20  |
| Criticité      | 0,20  |
| Approvisionnement (supply) | 0,15 |
| Vulnérabilité  | 0,10  |
| Âge            | 0,10  |

Tables de scoring par composante + matrice score → niveau :

| Niveau    | Plage   |
|-----------|---------|
| LOW       | 0–25    |
| MODERATE  | 26–50   |
| HIGH      | 51–75   |
| CRITICAL  | 76–100  |

Chaque niveau porte action / fréquence de revue / alarme / couleur. Les scores de démo sont **calculés** (donc ne collent pas exactement aux chiffres marketing du deck — ils sont illustratifs).

### Mappers Product Information Hub (`data/product-info.ts`)

- `phaseFromObsolescence` : déduit la phase PLM depuis les jalons de dates (jalon PM passé le plus avancé → PM490/PM410/PM400, sinon « purchasability » → PM300 ; PM500 manuel).
- `supplyFromDelivery` : convertit le délai de livraison pièce neuve (jours) en bucket d'approvisionnement.

## Backend / manager

### Manager `productInfo` (MSA vRPC, pmon index 18)

Croise la **MLFB / référence produit** avec le **Siemens Product Information Hub** (`https://product-information-hub.siemens.cloud`) pour obsolescence + délais de livraison. Détient la clé API côté serveur. Méthode unaire vRPC unique **`Lookup`**(Variant<JSON `{productNumber, withDelivery?}`>) → Variant<JSON `{obsolescence, delivery, errors}`>. `getResource()` fait un GET `/api/products/{n}/{obsolescence|delivery}` avec header `Authorization: <apiKey>`. Ne lève jamais sur statut HTTP (un 403/404 sur une ressource laisse passer l'autre) ; un 401 sur obsolescence → vRPC `Unauthenticated`.

### Pont webserver `/api/product-info`

Dans le customer-webserver-example (TS) : `productInfoController.ts` + `productInfoRoute.ts`, monté `router.use('/api/product-info', …)` + ACL `fullAccess`. `Vrpc` requis de façon gardée ; stub `createAndInitialize` mis en cache, recréé en cas d'erreur. Routes :
- `GET /health` → `{ok, service:'product-info', vrpc}`
- `POST /lookup {productNumber, withDelivery?}` → `callFunction('Lookup', …)` → 200 `{ok, ...parsed}` / 502 en erreur.

Frontend : `data/product-info.ts` → `lookupProductInfo(mlfb)` = `POST /api/product-info/lookup`. Câblé dans `ui/ali-asset-dialog.ts` : bouton « Recouper via MLFB (Siemens) » (désactivé si MLFB vide) → panneau `.pi-panel` (obsolescence + livraison ou erreur) → bouton « Appliquer aux champs » qui patche phase/supply/successeur.

### Assistant IA scopé sur les données de la page

La page place `<mf-ai-prompt>` (réutilisé depuis machine-fleet-3d) dans la barre d'outils, scopé aux actifs gérés : `data/ai-context.ts` expose `buildAssetAiSystemPrompt(assets)` (domaine + garde-fous + snapshot compact de l'inventaire live : désignation/MLFB/risque calculé/phase/criticité/appro/vuln/firmware/atelier/station/successeur, cap 200) et `ASSET_AI_SUGGESTIONS` (5 prompts préréglés). Le system prompt impose une section finale « Références » avec patterns d'URL canoniques (Industry Mall, Industry Online Support, Siemens ProductCERT, NVD CVE) pour éviter les deep-links hallucinés. Le system est reconstruit à chaque render (suit donc les éditions). Scoping = garde-fou « soft » (prompt + données injectées) ; les outils MCP winccoa restent globalement actifs, non désactivés par appel.

## Pièges / à savoir

- **Gateway Siemens — header `Api-Version`** : ne **jamais** l'envoyer sur les routes produit ; n'importe quelle valeur (y compris `v2-earlyaccess`) fait renvoyer **404 « Cannot GET »**. L'omettre utilise le défaut qui marche. (api-key-details exige aussi l'absence de version.)
- **Limitation de crédits (pas un bug)** : la clé dev a `{delivery:100, obsolescence:0}`. Les lookups d'obsolescence renvoient **403 « Insufficient credit »** → surfacé dans `errors.obsolescence` ; **delivery fonctionne** (prix €, délais jours, pays d'origine, ECCN…). Vérifier `api-key-details` pour le crédit si un lookup échoue. La page gère ce 403 gracieusement.
- **Amorçage de `ProductInfo_Config`** : passer par `dpGet`/`dpSetWait` RAW, pas par `readConfig()` (le masquage `||DEFAULT` rend l'empty-check toujours faux).
- **Icônes iX** : la version bundlée de `@siemens/ix-icons` dans l'app déployée est plus ancienne que `node_modules` — des noms comme `project`/`document` existent en SVG dans node_modules mais rendent le fallback « rectangle barré » au runtime. S'en tenir aux noms déjà utilisés ailleurs (download/upload/plus/info/warning/trashcan/pen/box-open/add/folder/cogwheel…) ou utiliser un chip texte CSS.
- **Persistance via REST uniquement** : les écritures de DP passent par PARA REST (pas d'écriture directe), lecture via `dpGet` (forme brute). Voir le pattern FleetStore (machine-fleet-3d) pour les détails.
- **Remappage des phases legacy** : ancien PM300 ≠ nouveau PM300 (sens différent) — toute donnée legacy doit être remappée par SENS, et `normalizePhase()` est appliqué systématiquement en lecture et en import.
