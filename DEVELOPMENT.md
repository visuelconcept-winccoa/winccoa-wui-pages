# Développement

Ce repo contient **la source des pages + les packages distribuables**, pas un
workspace exécutable. Une page se développe **dans un workspace
`@wincc-oa/webui-runtime`** (le shell), puis ressort sous deux formes.

## 1. Préparer un workspace de dev (une fois)
Le shell runtime n'est pas dans ce repo (c'est du tiers, installé par WinCC OA).
```bash
# dans un dossier de travail séparé
npm install @wincc-oa/webui-runtime
npx webui-runtime-init
npm install --save-dev --no-audit --no-fund
npm run init:oa-data
```
Puis brancher ce repo dans le workspace :
1. Déposer/symlinker `libs/wui-*` → `<workspace>/libs/`.
2. Dans `<workspace>/apps/dashboard-wc/vite.shared.ts`, ajouter le plugin
   `discoverPageLibs()` (scanne `libs/wui-<page>/src/<page>.ts`) à `standalonePages`.
3. Dans `<workspace>/tsconfig.base.json`, ajouter les `paths`
   `@visuelconcept/wui-*` → `libs/wui-*/src/*` (kit/fleet-core/ai-kit), pour que
   les pages résolvent les kits **en dev** (en packaging ils sont vendorisés).

> En production, le shell est servi par `webserver.js` / `@visuelconcept/wui-webserver`
> contre le `data/dashboard-wc/` buildé. Le dev server ci-dessous ne sert que la frontend.

## 2. Développer (HMR)
Le dev server Vite sert la frontend en HMR ; **toutes les données live viennent
d'un WinCC OA qui tourne**, proxyfiées (`/UI_WebSocket` ws, `/api/*`, `/data`, login)
vers `BASE_URL` :
```bash
BASE_URL=https://<hôte-OA>:<httpsPort> npm start   # vite serve, https://127.0.0.1:4300
```
On édite les composants dans `libs/wui-<page>/src/` → rechargement à chaud.
Les `/api/<module>` testés doivent exister sur le backend OA pointé.

## 3. Deux sorties depuis la MÊME source
### (a) Build & déploiement dans un projet
```bash
OUT_DIR=<projet>/data/dashboard-wc npm run build:pages   # juste les pages
OUT_DIR=<projet>/data/dashboard-wc npm run build         # shell + shared-bundles + pages + deploy:oa-data
```
⚠️ **Builder sur le workspace runtime de la CIBLE** : un bundle de page est couplé à
la carte d'imports du shell (sa version). Un `.js` buildé contre une autre version ne marche pas.

### (b) Package distribuable par page
```bash
node tools/build-package.mjs tools/specs.json
```
→ (re)génère `packages/wui-<page>/` autonome (kits vendorisés sous `_vendor/`, backend +
descripteur, manager(s), `module.json`, `install.mjs`). Installation : voir
[packages/README.md](packages/README.md).

## Pièges à connaître
- **`Clear site data`** au navigateur après tout ajout/modif de page ou de menu : le
  service-worker met `menuconfig.json` en cache → **`Ctrl+Shift+R` ne suffit pas**.
- **`@novnc/novnc` épinglé `1.4.0`** (remote-vnc) : `^1.4.0` flotte vers 1.7.0 dont les
  `exports` interdisent le deep-import `@novnc/novnc/core/rfb.js`.
- **`three`** est tiré par `wui-fleet-core/types.ts` → requis au build de toute page fleet.
- **Aucun secret dans le repo** : clé PIH (`ProductInfo_Config` DP / `PRODUCT_INFO_API_KEY`),
  tokens LLM (`AI_Assistant_Config` DP) → fournis sur la cible, jamais committés.
