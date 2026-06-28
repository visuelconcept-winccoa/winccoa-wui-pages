# Audit IP préalable — `winccoa-wui-pages`

> **Statut : AUDIT — aucune licence posée, aucun commit effectué.**
> Document produit à l'étape 1 de la mise en open source. Il doit être validé
> **avant** toute pose de licence/en-tête (étapes 2 à 7).
> Date : 2026-06-28. Périmètre : arbre de travail complet hors `node_modules/`, `dist/`, `.git/`, `.nx/`.

---

## 1. Méthode

- Inventaire des fichiers par type (arbre de travail, hors dépendances/sorties de build).
- Recherche des marqueurs de propriété tierce : `Siemens`, `ETM`, `@wincc-oa`, `@etm-professional-control`, en-têtes `copyright`, `@license`, `SPDX`, licences OSS.
- Inspection ciblée des zones à risque (shell scaffoldé, backend, assets, archive `.zip`).
- Vérification du **statut Git réel** (suivi / non suivi) de chaque zone — déterminant car une grande partie de l'arbre est aujourd'hui non commitée (scaffold régénéré).

> ⚠️ **Limite importante.** Cet audit identifie l'**origine probable** des fichiers à partir des en-têtes, métadonnées `package.json`, structures et conventions. Il **ne constitue pas un avis juridique**. Les points marqués « À VÉRIFIER » nécessitent une décision humaine (et, pour le code dérivé de Siemens/ETM, idéalement une confirmation des intéressés).

---

## 2. Inventaire par type (arbre de travail, hors `node_modules`/`dist`)

| Type | Nb | Notes |
|---|---:|---|
| `.ts` | 692 | Source TypeScript. ~285 suivis (libs VC), le reste dans `apps/`+`packages/` non suivis (scaffold + pages générées) |
| `.md` | 151 | Documentation (VC) |
| `.js` | 145 | Inclut les managers backend — **dont 127 fichiers tiers ETM (mcpServer)** |
| `.json` | 127 | Configs, `module.json`, manifestes |
| `.mjs` | 37 | Scripts outillage (VC) |
| `.svg` | 36 | **33 = `semifab-icons` (origine à confirmer)** + 2 docs (VC) + 1 logo shell tiers |
| `.jsonc` | 35 | Fragments menu/config (VC) |
| `.png` | 26 | 24 captures doc (VC) + `logo.png` + **`sie-light.png` = logo ETM@Siemens (tiers)** |
| `.example` | 3 | `.env.example` (2× mcpServer tiers, 1× aliMcp VC) |
| `.html` | 2 | `apps/dashboard-wc/index.html` (VC) + `docs/diagrams/decision-tree.html` (VC) |
| `.zip` | 1 | **`winccoa_projectmanager.zip` — archive projet WinCC OA, contenu mixte à risque** |
| autres | — | `.scss`, `.css`, `.gitkeep`, configs lint/prettier (VC) |

**Statut Git (ce qui est réellement commité aujourd'hui)** :

| Zone | Suivi Git | Provenance dominante |
|---|---|---|
| `libs/wui-*` (20 libs, 285 fichiers) | ✅ suivi | **VC original** |
| `docs/` (67) | ✅ suivi | VC |
| `tools/` (12) | ✅ suivi | VC |
| `webserver/` (10) | ✅ suivi | VC |
| `backend/` (161) | ✅ suivi | VC **sauf** `backend/managers/mcpServer/` = **127 fichiers tiers ETM** |
| `LICENSE` | ✅ suivi | **MIT amont @wincc-oa (à remplacer)** |
| `package.json` (racine), `apps/`, `packages/`, `libs/default-components/`, `oa-data/`, `winccoa_projectmanager.zip` | ❌ **non suivi** | scaffold ETM régénéré + pages bundlées + archive |

> 🔑 **Conséquence directe** : aujourd'hui le dépôt commité est majoritairement du code VC **propre**, sauf un gros bloc tiers : `backend/managers/mcpServer/` (127 fichiers ETM). Le reste des éléments tiers (shell `default-components`, `package.json` ETM, archive `.zip`) est **non suivi** — il ne sera publié que si vous décidez de committer l'arbre complet. **C'est la première décision à trancher** (voir §6).

---

## 3. Fichiers À RISQUE (tiers / origine non-VC)

### 🔴 R1 — `LICENSE` (racine) : licence amont MIT @wincc-oa
- Contenu : `MIT License — Copyright (c) 2023 @wincc-oa/webui-runtime`.
- C'est la licence du **projet amont ETM/Siemens** `webui-runtime`, pas celle de VC. **Suivi par Git.**
- **Reco : RETIRER / REMPLACER** par la licence VC choisie (AGPL-3.0 ou BSL selon voie). À traiter en étape 2.

### 🔴 R2 — `package.json` (racine) : métadonnées du template ETM
- `name: "@wincc-oa/webui-runtime"`, `author: ETM <npm.user@etm.at>`, `homepage: winccoa.com`, `license: MIT`, `bin: webui-runtime-init`.
- Le dépôt est **construit par-dessus le scaffold ETM `webui-runtime`** ; ces métadonnées appartiennent à ETM, pas à VC. **Non suivi par Git.**
- **Reco : ISOLER + CORRIGER** — renommer (`@visuelconcept/winccoa-wui-pages`), `author = VISUEL CONCEPT`, ajuster `license`/`homepage`/`repository`. Ne pas apposer d'en-tête VC tant que les métadonnées ETM subsistent.

### 🔴 R3 — `libs/default-components/` : shell applicatif ETM (MIT)
- `package.json` : `name: "@wincc-oa/default-components"`, `author: ETM`, `license: MIT`, `homepage: winccoa.com`.
- C'est la **librairie shell de l'app, propriété ETM**, scaffoldée puis re-patchée par VC via `tools/wire-workspace.mjs` (cf. mémoire projet « never hand-edit the scaffolded default-components »). **Non suivi par Git.**
- Contient un logo tiers (voir R6) et des fichiers `webui-*.ts` ETM avec des patches VC ré-appliqués.
- **Reco : GARDER + ISOLER** si publié — **conserver la licence MIT + copyright ETM**, **NE PAS** apposer d'en-tête AGPL VC dessus (MIT est compatible mais le copyright d'origine doit être conservé ; les patches VC peuvent être notés séparément). Idéalement le laisser **non commité/régénéré** plutôt que de le vendoriser dans le dépôt public.

### 🔴 R4 — `backend/managers/mcpServer/` : serveur MCP ETM Control (ISC) — **127 fichiers, SUIVI par Git**
- `package.json` : `name: "@etm-professional-control/winccoa-mcp-server"`, `author: "ETM Control GesmbH"`, `license: "ISC"`, `repository: github.com/winccoa/winccoa-ae-js-mcpserver`.
- En-têtes source : `index_http.js` / `index_stdio.js` ligne 4-5 : *"This file was initially creates by Martin Kumhera and extended by AI with CNS (UNS) functions!"*.
- `helpers/icons/IconList.js` : liste de **1 407 noms d'icônes Siemens iX** (noms, pas de SVG embarqués).
- C'est le **plus gros bloc tiers réellement commité** (~79 % de `backend/`). Code ETM Control, dérivé d'un dépôt amont.
- **Reco : ISOLER (conserver licence ISC + attribution) ou RETIRER.** Décision à prendre (§6) : (a) le sortir du dépôt et le consommer comme dépendance npm `@etm-professional-control/winccoa-mcp-server`, ou (b) le conserver vendoré **avec son `LICENSE` ISC et son `NOTICE` d'origine**, **hors périmètre AGPL** (pas d'en-tête VC). Une 2ᵉ copie existe sous `packages/wui-machine-fleet-3d/manager/mcpServer/` (non suivie).

### 🔴 R5 — `winccoa_projectmanager.zip` : archive projet WinCC OA, contenu mixte — **non suivi mais référencé**
Décompressée, elle contient 25 fichiers mêlant **du dérivé Siemens/SDK** et **du VC** :
- **Dérivé SDK WinCC OA (risque haut)** : `scripts/webclient_http.ctl`, `scripts/libs/classes/MyHttpServer.ctl` (`class MyHttpServer : HttpServer`, `#uses CtrlHTTP/CtrlXml/CtrlPv2Admin` — schéma du gestionnaire d'exemple `webclient_http` livré avec WinCC OA), panneaux GEDI `panels/gedi/*.xml`.
- **Branding Siemens** : `data/html/proj.html` embarque un *« WinCC OA Logo SVG »* + titre *« WinCC Open Architecture - Project manager »*.
- **VC** : `ProjectUploaderLib.ctl` (en-tête `@copyright MIT @author orelmi`), `projectdownload.ctl` (commentaires FR, conventions VC).
- Référencée par du code suivi : `backend/managers/processMonitor/index.js`, `libs/wui-process-monitor/src/process-monitor.ts` (peut n'être qu'une référence de conception « legacy »).
- **Reco : RETIRER du dépôt public** (ou, si nécessaire, refactorer : extraire uniquement les `.ctl` VC sous licence claire, **supprimer** le logo WinCC OA et les `.ctl`/panneaux dérivés du SDK Siemens). Un `.zip` binaire opaque mêlant branding + code SDK est inadapté à une publication open source. **Vérifier d'abord l'impact fonctionnel** des deux références ci-dessus.

### 🔴 R6 — `libs/default-components/src/assets/sie-light.png` : logo « ETM@Siemens »
- Référencé comme logo par défaut : `webui-config.service.ts:12,154`, `webui-app-ix.ts:15` avec `alt="ETM@Siemens" title="ETM@Siemens"` (`webui-app-ix.ts:142-143`).
- **Branding Siemens/ETM — non relicenciable.**
- **Reco : REMPLACER** par un logo VISUEL CONCEPT (et corriger `alt/title`) avant publication. Vit dans le shell tiers R3.

### 🟡 R7 — `apps/dashboard-wc/public/semifab-icons/image1..33.svg` : 33 symboles industriels, origine non confirmée
- SVG de symboles industriels (cuves, pompes, vannes…) avec métadonnées **localisées en allemand** : `id="Ebene_1"` (« Calque_1 »), `Unbenannter_Verlauf` (« dégradé sans nom ») — signature d'un export depuis un outil vectoriel germanophone. **Non suivi par Git.**
- Aucune mention de copyright à l'intérieur, **mais** la facture « bibliothèque de symboles P&ID/SCADA » + la locale allemande laissent planer un doute : artwork **original VC** ? export d'un **catalogue de symboles Siemens/WinCC OA** ? pack de symboles **tiers** ?
- **Reco : À VÉRIFIER (humain).** Confirmer que ces 33 symboles sont créés par VC ou libres de droits. Si dérivés d'une bibliothèque Siemens/tierce → **ISOLER/RETIRER**.

---

## 4. Fichiers SÛRS (VISUEL CONCEPT — original) — recommandation : GARDER

| Zone | Fichiers | Verdict | Preuve |
|---|---|---|---|
| `libs/wui-*` (20 librairies de pages) | 285 suivis | **VC original** | `package.json` `author: "Visuel Concept"` ; en-têtes source descriptifs sans copyright tiers ; historique Git 100 % `orelmi`/visuelconcept |
| `backend/managers/*` **sauf** mcpServer (aiAssistant, aliMcp, dplAscii, kpiCalc, machineSim, processMonitor, productInfo, productionOrdersKpi, rtspProxy, vncProxy) | ~30 | **VC original** | En-têtes VC ; usage standard de `winccoa-manager` ; « Siemens PIH » référencé seulement comme **API HTTP externe**, non embarqué |
| `backend/routes/*` | ~ | **VC original** | Contrôleurs HTTP→vRPC, pont vers les managers |
| `webserver/` | 10 | **VC original** | `@visuelconcept/wui-webserver`, dépend de `@winccoa/backend` (dépendance, non embarqué) |
| `tools/` (`wire-workspace.mjs`, `dev-wiring/`, `scripts/`) | 12 | **VC original** | Outillage propre, aucune attribution tierce |
| `apps/dashboard-wc/src/` + configs Vite | non suivi | **VC original** (point d'entrée minimal) bootant le shell scaffoldé | `main.ts`, `polyfills.ts`, plugins Vite VC |
| `packages/*/_vendor/` | non suivi | **Duplication interne** des libs VC (`wui-kit`, `wui-fleet-core`, `wui-ai-kit`…) pour bundling des pages standalone — **propriété VC** | comparaison fichier-à-fichier avec `libs/` |
| `docs/`, captures `docs/images/manual/*.png`, diagrammes SVG/HTML | 67 | **VC original** | Documentation et captures applicatives |

> Note : les dépendances **`@siemens/ix*`, `@wincc-oa/wui-*`, `@etm-professional-control/oa-rx-js-api`** sont des paquets **npm externes** (dans `node_modules`, **non commitées**) — hors périmètre de relicensing. Leurs licences (Siemens iX = MIT, ETM = MIT, etc.) restent les leurs ; à documenter en étape 7 (THIRD-PARTY/`dep5`).

---

## 5. Synthèse des recommandations (garder / isoler / retirer)

| # | Élément | Statut Git | Origine | Recommandation |
|---|---|---|---|---|
| R1 | `LICENSE` racine (MIT @wincc-oa) | suivi | ETM/amont | **RETIRER → remplacer** (étape 2) |
| R2 | `package.json` racine (métadonnées ETM) | non suivi | ETM | **ISOLER + corriger** (nom/author/license) |
| R3 | `libs/default-components/` | non suivi | ETM (MIT) | **GARDER + ISOLER** (conserver MIT+ETM, pas d'en-tête AGPL) ; idéalement non vendoré |
| R4 | `backend/managers/mcpServer/` (127 f.) | **suivi** | ETM Control (ISC) | **ISOLER (licence ISC + NOTICE) ou RETIRER** → décision §6 |
| R5 | `winccoa_projectmanager.zip` | non suivi | mixte Siemens-SDK + VC | **RETIRER** (ou refactorer + retirer logo & .ctl SDK) |
| R6 | `sie-light.png` (logo ETM@Siemens) | non suivi | Siemens/ETM | **REMPLACER** par logo VC |
| R7 | `semifab-icons/*.svg` (33) | non suivi | **incertaine** | **À VÉRIFIER** (humain) avant de relicencier |
| — | `libs/wui-*`, `backend/*` (hors mcpServer), `webserver/`, `tools/`, `docs/`, `apps/src`, `_vendor/` | mixte | **VC** | **GARDER** → cibles des en-têtes SPDX (étape 4) |

---

## 6. Décisions requises AVANT de poser une licence (étape 2+)

Je m'arrête ici comme demandé. Pour continuer, j'ai besoin de vos arbitrages :

1. **Périmètre publié** — publie-t-on l'**arbre de travail complet** (apps/, packages/, default-components, package.json, zip… aujourd'hui non suivis) ou un **sous-ensemble curé** (essentiellement `libs/wui-*` + backend VC + docs) ? Cela détermine combien d'éléments tiers ci-dessus sont réellement concernés.

2. **R4 `mcpServer` ETM (ISC)** — (a) le **retirer** du dépôt et le consommer via npm, (b) le **conserver vendoré** avec sa licence ISC + attribution ETM Control (hors AGPL), ou (c) autre ? (C'est le plus gros bloc tiers actuellement commité.)

3. **R5 `winccoa_projectmanager.zip`** — confirmer qu'on peut le **retirer** (vérifier l'impact des 2 références dans `processMonitor`/`wui-process-monitor`), ou souhaitez-vous le refactorer ?

4. **R7 `semifab-icons` (33 SVG)** — pouvez-vous confirmer qu'ils sont **créés par VISUEL CONCEPT** (ou libres de droits) ? Sinon il faut les isoler/retirer.

5. **R6 logo** — OK pour **remplacer** `sie-light.png` par un logo VC (et corriger `alt/title="ETM@Siemens"`) ?

> Une fois ces points tranchés, je passerai aux étapes 2→7 (LICENSE, NOTICE, en-têtes SPDX sur le **seul** code VC, CONTRIBUTING+CLA, README, `.reuse/dep5`), puis je préparerai **un commit unique** (non poussé) et vous montrerai le diff. Aucune licence ni en-tête ne sera appliqué aux éléments R1–R7 tiers tant que vous ne l'avez pas validé.
