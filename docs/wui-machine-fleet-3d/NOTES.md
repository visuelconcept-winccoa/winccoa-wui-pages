# wui-machine-fleet-3d — notes métier & architecture

Page WebUI standalone **Machine Fleet 3D** : jumeau numérique 3D (Three.js) d'un parc
multi-machines / multi-ateliers, avec bulles d'état et de KPI par machine, catalogue de
causes d'arrêt, tableau de bord machine contextualisé (Gantt + Pareto) et assistant IA.

Tier : **hub** (page centrale du parc, point d'entrée par défaut au login). `three`
(`^0.169.0`) est une vraie dépendance npm bundlée dans la page (aucun CDN).

## Domaine / objet

- **Shell routeur** :
  - `/machine-fleet-3d` (`/fleet-3d`) = **overview** (`mf-atelier-overview`, grille de
    cartes d'ateliers + mini-plan SVG).
  - `/machine-fleet-3d/:atelier` = **vue 3D** d'un atelier (`mf-atelier-view`).
  - Le param de route `:atelier` arrive en **attribut** `atelier` ; navigation via
    `RouterEvent` (`@wincc-oa/wui-models/events/router-event.js`, accepte une string ;
    event `bubbles`+`composed` donc il s'échappe du shadow DOM des overlays).
- **Page d'accueil au login** : redirection `/` → `/fleet-3d` (atterrissage post-login forcé
  sur la vue parc sauf deep-link explicite).
- **Modèle machine** :
  - **Familles de procédé** `MachineProcess` = `generic | usinage | soudage`
    (`MachineDef.process?`). `resolveProcess(m)` = `process` explicite, sinon dérivé du
    `type` (tour/fraiseuse/brocheuse/scie → `usinage`, sinon `generic`). La famille pilote
    les paramètres domaine simulés et bindés.
  - **Types de rendu** : machines « géométriques » (furnace, robot, tour, basculeur,
    `portique-table` = portique + table rotative avec `tableDiameter`…), objets **GLB**
    (`type:'glb'`, réf `glbUrl`) et **billboards** (`type:'billboard'`, réf `billboardUrl`,
    plan texturé aligné écran).
- **États** : mapping d'état par machine (`StateMapping`) avec couleurs configurables
  (`StateMapping.colors`, `StateColorKey` = état | `disconnected`). Défauts :
  warn=rouge `#ef4444`, stop=jaune `#f59e0b`, maint=bleu, disconnected=violet.

## Modèle de données (DPs)

Provisioning/CRUD des DPs et types via l'**API REST PARA** du backend (voir Backend), car
`OaRxJsApi` ne sait **que lire/écrire des valeurs** (pas créer DP/type). `FleetStore`
(`data/fleet-store.ts`) centralise tout, avec **mode mémoire (offline)** seedé par
`DEMO_ATELIER` si le backend/les droits manquent (bandeau d'avertissement).

| Type DP | Forme | Contenu |
|---|---|---|
| `MachineFleet3D_Config` | Struct (`name` String, `json` String) | 1 atelier par DP ; `json` = l'`Atelier` sérialisé (machines, mappings, KPIs, display…). |
| `MachineFleet3D_StopCauses` | 1 DP JSON | Catalogue de causes d'arrêt (tableau sérialisé). |
| `MachineFleet3D_Glb` | Struct (`name` String, `data` String base64) | 1 objet 3D GLB importé. Réf `dp:<dpName>`. |
| `MachineFleet3D_Billboard` | Struct (`name` String, `data` String base64) | 1 image billboard importée. Réf `dp:<dpName>`. |
| `MachineFleet3D_Closures` | 1 DP JSON | Jours non travaillés / fermetures (consommés par kpiCalc). |
| `MachineFleet3D_Kpi` | Voir kpiCalc | DP par KPI calculé (1 par machine×KPI). |
| `MachineSim` (1 par machine) | Voir machineSim | DPs de simulation (état + cause + paramètres). |
| `AI_Assistant_Config` | Struct String (`provider`, `model`, `token`, `mcpServers` JSON) | Config assistant IA (token stocké ici, jamais livré). |

- **Persistance atelier** : sauvegarde **debouncée** (`wui:save`) depuis la vue 3D. Écritures
  de valeurs DP via **REST `/api/para/dp/set`** (le `dpSet` WebSocket d'`OaRxJsApi` est en
  lecture seule).
- **Ressources graphiques** : API générique `listResources(kind)`,
  `importResource(kind,name,dataUrl)`, `deleteResource(kind,ref)`, `readResourceDataUrl(ref)`
  (`kind` = `glb | billboard`, modèle identique). Le scene-controller a un unique résolveur
  (`setResourceResolver`) ; GLB → `GLTFLoader.parse(ArrayBuffer)` (jamais `.load()` sur un
  `data:`), billboard → `applyBillboardTexture` (SVG **et** raster). **Fallback** : si un
  `dp:` ne résout plus, l'objet est remplacé par un cabinet 3D (`swapToFallback`).
- **Affichage unifié** : source de vérité unique `MachineDef.display?: DisplayEntry[]`
  (`{ref, inBubble, inPopup}`, l'ordre = index). `ref` ∈ `state | stopCause | workOrder |
  operation | param:<key> | kpi:<id>`. `resolveDisplaySlots(m)` construit le catalogue
  ordonné ; les items absents de `display` sont auto-ajoutés (nouveaux params/KPI
  apparaissent seuls). Les anciens toggles de visibilité dispersés ont été supprimés.

## Algorithmes / formules clés

### KPI temps réel (manager kpiCalc) — TRS / MTBF / MTTR
Calcul **côté serveur** sur fenêtre glissante, DPs archivés pour le trending, valeur
poussée dans la bulle 3D. `KpiType = 'TRS'|'MTBF'|'MTTR'` (TRS en `%`, MTBF/MTTR en `min`).

- Requis = ouverture − arrêts planifiés.
- **TRS** = (requis − non planifié) / requis × 100.
- **MTBF/MTTR sur le temps NON PLANIFIÉ uniquement** (les arrêts planifiés comptent comme
  temps de fonctionnement et ne réduisent PAS les métriques) :
  - MTBF = (ouverture − non planifié) / N_pannes
  - MTTR = non planifié / N_pannes
  - une « panne » = un arrêt comportant du temps non planifié.
- **Catégorisation temporelle** : honore les **fermetures** (`MachineFleet3D_Closures`,
  soustraites de chaque intervalle) ET l'**affectation de cause** : le début sans cause d'un
  arrêt est rétro-rempli vers la 1ʳᵉ cause affectée puis reporté (`partitionByCause` /
  `causeBoundaries`). Tant qu'aucune cause n'est affectée le temps compte **non planifié** ;
  une fois affectée, l'arrêt entier est reclassé planifié/non planifié depuis son début.
  `classify(code)` : ''/null → non planifié, sinon `causeClass[code] || __default || unplanned` ;
  seul `planned` est soustrait du requis.

### Causes d'arrêt (catalogue + fallback)
- `StopCause` = `code` / `description` / `classification` / `isDefault?` (toggle « Défaut »
  radio : une seule par défaut, `setDefault`). Persistance JSON intégrale → tout nouveau champ
  persiste automatiquement.
- `formatStopCause(catalog, code)` → `"code — description"` pour un code connu ; pour un code
  **inconnu**, repli sur l'entrée `isDefault` (catalogue de démo : `{code:"NC",
  description:"Non catégorisé / hors catalogue", isDefault:true}`), sinon le code brut. Utilisé
  par la bulle, le popup machine et le moteur d'analyse d'arrêts.

### Tableau de bord machine contextualisé (intégré, sans echarts)
- Overlay plein écran `mf-machine-dashboard` : Paramètres process · barre de période ·
  Suivi alarmes (placeholder) · KPI = **Gantt état** + **Pareto arrêts non planifiés**
  (SVG/DOM, pas d'echarts).
- **Temps réel = `dpConnect`** (pas de polling) ; un changement du DP d'état recharge
  (debouncé) l'historique archivé pour garder le Gantt live.
- Gantt : segments depuis l'historique archivé du DP d'état (`resolveState` + `STATE_COLORS`),
  chaque segment porte sa cause (via l'historique du DP cause + `causeAt` + `formatStopCause`)
  et une bulle au survol.
- Pareto : `analyseStopCauses` (mono-machine) → non planifié → tri par downtime/fréquence,
  Top 5/10/Tous, métrique cumul/fréquence, classe planifié/non planifié, export CSV (`;`+BOM),
  CSS d'impression. Bouton « Analyser » → ouvre `/fleet-stops` (nouvel onglet) avec le filtre
  atelier+machine dans le **hash d'URL** (`#/fleet-stops?atelier=&machine=`).
- Choix du dashboard : `MachineDef.dashboardMode?: 'default'|'oa'` (`resolveDashboardMode` :
  explicite, sinon `oa` si `dashboardId` présent, sinon `default`). `mode=oa` →
  `RouterEvent('/dashboard/<id>')`, sinon l'overlay intégré.
- Liens custom : `MachineDef.dashboardLinks?` (`{label,icon,url}`, max 3) → boutons
  supplémentaires dans le popup, ouverts en nouvel onglet (`noopener,noreferrer`).

### Layout des bulles 3D
Callout à gouttières : `setBuildingBounds` pousse l'empreinte du bâtiment ;
chaque frame `projectBuildingRect` projette les 8 coins → AABB écran, et `placeBubbles`
repousse chaque bulle dans la gouttière gauche/droite **au-delà** du bâtiment (selon le côté
de la machine), empilée verticalement, avec leader du dot vers le bord interne. Repli
`placeBubblesAbove` si pas de bornes. KPI multiples empilés un par ligne.

## Backend / manager

Page **Tier hub** : backend module `backend/modules/machine-fleet-3d` + **4 managers**.

- **Module backend `/api/para`** (REST PARA) : seul moyen de **créer DP/type** et d'**écrire
  des valeurs** (`POST /api/para/dptype/create`, `/api/para/dp/create`, `/api/para/dp/set`,
  `DELETE /api/para/dp/:name?dpType=`). La route `/api/para/dp/set` doit accepter de gros
  corps (objets GLB/billboard base64) : `json({limit:'8mb'})` — la limite par défaut ~100 Ko
  casserait l'import. La lecture passe par `OaRxJsApi.dpGet/dpNames` et `dpConnect`.
- **machineSim** (manager WCCOAjavascript, `always`) : simulateur de parc. Crée les DPs
  `MachineSim`, fait l'**AUTO_MAP non destructif** (ne mappe que les machines sans `stateDp`,
  n'écrase jamais une config utilisateur) et écrit état/cause/paramètres par intervalles.
  - `cause` est une **String** (et non Int) pour émettre n'importe quel code catalogue ; il
    **recharge le catalogue avant chaque tick d'état** ; `pickCause()` émet un code valide
    ~90% du temps et un code **hors-catalogue (erroné)** ~10% (`ERRONEOUS_CAUSE_PROB`).
  - `PARAM_SETS` par famille : generic `[cadence,temperature,vitesse,charge]`, usinage
    `[programme,outil,broche,avance]`, soudage `[tension,intensite,vitesseSoudage]` ; **toute**
    machine simule `ALL_PARAMS` (union) pour qu'un binding KPI résolve toujours. Discrets
    (`programme`/`outil`) = String, analogiques = Float. `avance = broche × feedPerRev`.
    `basculeur.angle` = triangle 0→90° en 30 s, sa KPI `vitesse` = vitesse angulaire °/s.
- **kpiCalc** (manager, `always`) : crée le type `MachineFleet3D_Kpi` (`value` Float
  **archivé** + Strings `kpiType,machineId,machineName,window,unit,updatedAt`) ; un DP par KPI
  nommé `MachineFleet3D_Kpi_<sanitize(machineId)>_<sanitize(kpiId)>` (sanitize :
  `[^A-Za-z0-9_]→_`). Archivage NGA par KPI piloté par `MachineKpi.archive`/`archiveGroup`
  (`disableArchived` / `ensureArchived`). Relit config+fermetures+KPIs toutes les 60 s,
  tick de base 15 s. Bulle 3D abonnée à `…_<kpiId>.value` via `DpTarget` kind `kpiCalc`.
- **aiAssistant** (manager, `always`) : héberge le **service vRPC `AiAssistant`** (fonction
  `Chat`). Architecture 3 tiers : WebUI `mf-ai-prompt` → `POST /api/ai/chat` (webserver,
  même origine) → stub vRPC → service `AiAssistant` → provider via `fetch`. Le runtime WebUI
  n'a aucun client MSA/vRPC, d'où le pont HTTP obligatoire. Providers raw fetch (Anthropic
  `/v1/messages`, OpenAI/Mistral `/v1/chat/completions`, Gemini `:generateContent`) ;
  **aucun paramètre de sampling** envoyé (opus-4-x renvoie 400 sur temperature/top_p) ;
  `max_tokens` Anthropic requis (réglé à 8192). Boucle d'outils **MCP locale** : le manager est
  lui-même le client MCP (`gatherMcpTools` + exécution locale via `mcp.callTool`), donc le
  provider cloud n'atteint jamais le serveur MCP → `localhost` fonctionne.
- **mcpServer** (manager, `always`) : serveur MCP WinCC OA (Streamable-HTTP) consommé par
  aiAssistant (URL/token par défaut dans `mcpServers` de `AI_Assistant_Config`).

**Sécurité** : les tokens des providers IA sont lus depuis `AI_Assistant_Config` — **aucun
n'est livré**.

## Pièges / à savoir

- **OaRxJsApi (lecture/binding)** :
  - `dpGet` renvoie la **valeur brute** (`unknown | unknown[]`), PAS `{ value: [] }` — ne pas
    lire `.value[0]` aveuglément, extraire récursivement.
  - Lister les DP d'un type via `WuiDpeService.listDatapoints(typeName)` (commande
    `etm.model.type.listDps`), **pas** `dpNames('*', type)` (ne filtre pas comme attendu).
  - `dpConnect(dps,true)` émet `{ dp, value }` mais les noms `dp` sont **normalisés serveur**
    (préfixe `System1:`, suffixe `:_original.._value`, point final) → mapper les cibles par un
    nom **normalisé** (`normDp`), sinon le lookup rate et l'état/KPI ne se met jamais à jour.
  - `resolveState` : prévoir un fallback sur le 1ᵉʳ mapping si la machine n'a pas de
    `stateMappingId`.
  - `OaRxJsApi` ne crée pas de DP/type → passer par l'API PARA REST.
- **Écriture** : `dpSet` WebSocket = lecture seule → toute écriture de valeur passe par
  **REST `/api/para/dp/set`**.
- **Permissions** : `data/permissions.ts` (`canEditFleet()`/`canEditFleet$()`) repose sur
  `WuiUserService.canPublish` (résolu via tsyringe ; `@wincc-oa/wui-iam-data` externalisé donc
  singleton runtime résolu ; `canPublish` est **async** → s'abonner à l'Observable). En
  view-only : bouton modifier → œil, toutes les mutations (renommer/supprimer/déplacer/import/
  save-view/GLB) masquées.
- **Archivage** : sur ce projet le DPE `MachineSim.state` **est** archivé NGA mais `.cause`
  **ne l'est PAS** (le `dpTypeChange` Int→String a probablement perdu sa config d'archive) →
  pas d'historique de cause tant que l'archivage de `.cause` n'est pas réactivé.
  `FleetStore.listArchiveGroups()` ne renvoie que les groupes `_NGA_Group` **actifs**
  (`.active === true`).
- **Causes héritées « 0–5 »** : d'anciennes données de l'ère Int (codes 1–5 + ''→0) peuvent
  rester ; le simulateur actuel n'émet plus de codes numériques fictifs (`causeCodes` part
  **vide** → émet `''` si le catalogue ne charge pas ; les entrées `isDefault` sont **exclues**
  de l'ensemble émettable — le défaut est un bucket de repli, pas une cause active).
- **iX icônes dynamiques dans un bouton** : un `<ix-icon slot="icon" name=${dynamique}>`
  **ne s'affiche pas** (les ix-icons déployés lisent `name` une seule fois). Utiliser
  l'attribut/propriété **`icon=${x}`** sur `ix-button`/`ix-icon-button`. Les noms statiques
  slottés (`name="ontology"`) fonctionnent. Noms d'icônes valides :
  `node_modules/@siemens/ix-icons/dist/ix-icons/svg/` (nom inconnu → « rectangle barré »).
  Liste d'icônes de liens sûres au déploiement : `DASHBOARD_LINK_ICONS`.
- **iX shell** : composants enregistrés globalement par le shell → tags nus, ne pas
  réimporter `@siemens/ix`.
- **Lint strict (eslint)** : littéraux hex en `0xRR_GG_BB` ; ordre des membres de classe
  (public < protected < private ; les arrow-function fields comptent comme private → en
  dernier) ; noms de `CustomEvent` = littéraux string `^wui:[a-z]{3,}$` (pas de tiret) ;
  éviter une méthode nommée `flat` (collision `no-magic-array-flat-depth`).
  `no-magic-numbers` = warning seulement (OK pour le code 3D).
- **Redémarrage managers** : après édition d'un manager (machineSim / kpiCalc / aiAssistant /
  mcpServer) ou du backend webserver, **redémarrer le manager concerné** pour appliquer (mode
  `always` → pmon le relance ; un `start-manager` manuel juste après un stop renvoie souvent
  « START not possible » mais pmon le ramène en ~1 s). Aucun KPI n'est configuré par défaut →
  kpiCalc tourne à vide tant qu'un KPI n'est pas ajouté dans le dialogue machine.
- **Service worker** : le bundle de page a un nom stable → recharge forcée
  (Ctrl+Shift+R / Ctrl+F5) souvent nécessaire après redéploiement. Un déploiement pages-seul
  peut laisser le SW Siemens servir un snapshot périmé → échecs intermittents de résolution de
  module/route (page blanche) ; correctif fiable = un build complet qui régénère le SW.
