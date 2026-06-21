# CLAUDE.md — guide agent pour le repo `winccoa-wui-pages`

Pages standalone WinCC OA WebUI `@visuelconcept/wui-*` : **source de dev + packages
distribuables**. Ce repo ne contient **que notre code** (aucun fichier
`@wincc-oa/webui-runtime` installé par `webui-runtime-init`).

## Carte du repo
- `libs/` — source de DÉV des pages. `wui-kit` / `wui-fleet-core` / `wui-ai-kit` = kits partagés ; `wui-<page>/src/<page>.ts` = entrée d'une page (+ ses composants).
- `backend/routes/` — modules de route HTTP (source, flat) : para, rtsp, vnc, ai, product-info.
- `backend/managers/` — managers JavaScript WinCC OA (sans `node_modules`/`.env`) : machineSim, kpiCalc, aiAssistant, mcpServer, productInfo, productionOrdersKpi, rtspProxy, vncProxy.
- `webserver/` — `@visuelconcept/wui-webserver`, prérequis backend (source maintenue à la main, PAS généré).
- `docs/wui-<page>/` — docs par page (README/INTEGRATION/NOTES, savoir métier/archi) ; recopiées dans le package au build.
- `tools/` — pipeline de build déterministe (chemins repo-relatifs).
- `packages/` — packages distribuables **GÉNÉRÉS et git-ignorés** (rebuild : `node tools/build-package.mjs tools/specs.json`).
- `INSTALL.md` — chaîne de prérequis [0]→[3] + install ; `DEVELOPMENT.md` — workflow de dev.

## Workflow (résumé — détails dans DEVELOPMENT.md)
- **Dév** : déposer `libs/` dans un workspace `@wincc-oa/webui-runtime`, puis `BASE_URL=https://<OA> npm start` (vite HMR + proxy données vers un OA réel).
- **Déployer dans un projet** : `OUT_DIR=<projet>/data/dashboard-wc npm run build:pages` (sur le workspace de la cible).
- **Régénérer les packages** : `node tools/build-package.mjs tools/specs.json` (depuis `libs/` + `backend/`).
- **Installer une page ailleurs** : `node packages/wui-<page>/install.mjs --workspace <ws> --project <projet> [--register-pmon]`.

## Comment ça marche (architecture)
- **Page autonome (vendoring)** : `tools/vendor-page.mjs` copie tout `src/` de la lib sous `<page>/`, écrit un shim d'entrée `<page>.ts`, vendorise la closure transitive `@visuelconcept` (cross-lib **et** siblings relatifs) sous `<page>/_vendor/<lib>/`, et réécrit chaque import en relatif → la page build sans aucun prérequis kit (pas de dépendance à la résolution `tsconfig paths` de la cible).
- **Découverte des pages** : le runtime ne scanne que le TOP-niveau de `standalone-pages/` (`<page>.ts`) ; les sous-dossiers sont bundlés via l'import du shim.
- **Backend auto-découvert** : `@visuelconcept/wui-webserver` (`wui-module-routes.ts`) scanne `dist/modules/*/index.js` et monte automatiquement `routes()` + `acl` (`mountModuleRoutes`) et `registerRaw()` (relais WebSocket, `mountModuleRelays`). Un module = `src/modules/<page>/index.ts` exportant `{ mount, acl?, routes?, registerRaw? }`. **Aucune édition de route à la main** : déposer le dossier, `npm run build` (tsc), redémarrer le webserver.
- **Managers** : managers WinCC OA classiques (`winccoa-manager` fourni par le runtime) ; les Tier-3 ajoutent un manager + (pour rtsp/vnc) un relais `registerRaw`.

## Conventions
- Packages nommés `@visuelconcept/wui-<page>` ; `module.json` déclare `tier`, `frontend.npmDeps`, `backend`, `managers`.
- Installeur unique `install.template.mjs` pour tous les tiers (sections no-op si surface absente).
- Ajouter une page = nouvelle lib `libs/wui-<page>/` + entrée dans `tools/specs.json` + `node tools/build-package.mjs tools/specs.json`.

## Pièges (IMPORTANT)
- **Builder sur le runtime de la CIBLE** : un bundle de page est couplé à la version du shell (carte d'imports). Pas de `.js` pré-buildé d'une autre version.
- **`Clear site data`** au navigateur après modif page/menu (le SW cache `menuconfig.json`) — `Ctrl+Shift+R` ne suffit pas.
- **`@novnc/novnc` épinglé `1.4.0`** (1.7.0 casse le deep-import) ; **`three`** tiré par `wui-fleet-core/types.ts`.
- **Jamais de secret committé** : clé PIH → `ProductInfo_Config` DP / env `PRODUCT_INFO_API_KEY` ; tokens LLM → `AI_Assistant_Config` DP. `.gitignore` exclut `node_modules/`, `*.tgz`, `.env*`.

## Ne pas committer
`node_modules/`, `*.tgz`, `dist/`, `.env*` (déjà dans `.gitignore`). Les packages
(`packages/`) sont committés (livrable + docs) ; les `.tgz` non (régénérables).
