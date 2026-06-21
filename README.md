# wui-pages — WinCC OA WebUI pages `@visuelconcept/wui-*`

Code source **et** packages distribuables des pages standalone WinCC OA WebUI.
Ce repo ne contient **que notre code** — aucun fichier installé par
`webui-runtime-init` (le shell `@wincc-oa/webui-runtime` reste hors repo).

## Structure
```
libs/        Source de DÉVELOPPEMENT des pages
             ├─ wui-kit/ wui-fleet-core/ wui-ai-kit/   (kits partagés)
             └─ wui-<page>/ × 15                        (une lib par page)
backend/
  routes/    Modules de route HTTP (source) : para, rtsp, vnc, ai, product-info
  managers/  Managers JavaScript WinCC OA (sans node_modules/.env) :
             machineSim, kpiCalc, aiAssistant, mcpServer, productInfo,
             productionOrdersKpi, rtspProxy, vncProxy
webserver/   @visuelconcept/wui-webserver — prérequis backend (source, maintenu à la main)
docs/        docs par page (README/INTEGRATION/NOTES) — recopiées dans les packages au build
tools/       Pipeline de build déterministe (chemins repo-relatifs)
packages/    Packages distribuables — GÉNÉRÉS, git-ignorés
             (rebuild: node tools/build-package.mjs tools/specs.json)
INSTALL.md   chaîne de prérequis [0]→[3] + commandes d'install
```

## Développer une page
La source (`libs/`) se développe dans un **workspace `@wincc-oa/webui-runtime`**
(le shell n'est pas dans ce repo) :
1. Installer le shell (`npm i @wincc-oa/webui-runtime` + `webui-runtime-init`) dans un workspace.
2. Y déposer/symlinker `libs/wui-*`, ajouter le plugin `discoverPageLibs` dans `vite.shared.ts` et les `paths` `@visuelconcept/wui-*` dans `tsconfig.base.json`.
3. `BASE_URL=https://<hôte-OA>:<httpsPort> npm start` → dev server vite (HMR), données live proxyfiées vers un WinCC OA en marche.

## Générer les packages distribuables
Depuis la source de ce repo (déterministe) :
```bash
node tools/build-package.mjs tools/specs.json
```
→ (re)génère `packages/wui-<page>/` : frontend vendorisée (kits sous `_vendor/`),
module backend + descripteur, manager(s), `module.json`, `install.mjs`.
Les `README.md`/`INTEGRATION.md` de chaque package sont écrits à la main (non régénérés).

## Installer une page dans un projet cible
Voir **[INSTALL.md](INSTALL.md)** (chaîne de prérequis [0]→[3]). `packages/` étant
généré, lance d'abord `node tools/build-package.mjs tools/specs.json` (ou récupère le
`.tgz` d'une Release). En bref, par page :
```bash
node packages/wui-<page>/install.mjs --workspace <runtime-workspace> --project <projet-winccoa> [--register-pmon]
```
puis rebuild du webserver (si backend), démarrage des managers, et **`Clear site data`** au navigateur.

## Validé
Build niveau cible (runtime v1.2.3) : les 15 pages buildent (`build:pages`) ;
les 5 modules backend compilent (tsc). Aucun secret embarqué (clés PIH / tokens LLM
fournis sur la cible via DP ou env).
