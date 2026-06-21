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
Puis **brancher ce repo + installer les deps des pages, deux commandes**. Ce sont
de simples scripts node versionnés dans `tools/` — on les lance directement, **sans
script npm** : rien à ajouter au `package.json` du runtime (il est généré par
`webui-runtime-init`, git-ignoré, donc tout ajout y serait écrasé au re-scaffold).
```bash
node tools/wire-workspace.mjs              # (idempotent)
node tools/install-page-dependencies.mjs   # (idempotent)
```
`install-page-dependencies.mjs` installe les paquets tiers que les pages tirent **au-delà** de ce
que le runtime fournit déjà (`three`, `@novnc/novnc`, `@cycjimmy/jsmpeg-player`, …)
— sinon le dev server échoue à résoudre l'import d'une page (ex.
`@cycjimmy/jsmpeg-player not found`). Il lit les `dependencies` de chaque
`libs/wui-*/package.json` (les paquets) + [`tools/external-dependencies.mjs`](tools/external-dependencies.mjs)
(les versions, car les libs épinglent `*`), saute ce que le workspace fournit déjà,
et **épingle exactement** les versions sans préfixe (ex. `@novnc/novnc@1.4.0`, via
`--save-exact`). `node tools/install-page-dependencies.mjs --check` pour un dry-run.

`wire-workspace.mjs` patche le scaffold `webui-runtime-init` (non versionné) pour que le dev
server découvre/serve/menu-lie chaque `libs/wui-<page>`. Il est **idempotent** —
relance-le après chaque re-scaffold (ou `node tools/wire-workspace.mjs --check` pour voir
sans écrire). Ce qu'il câble :

1. **Pages** — déploie [`tools/dev-wiring/discover-page-libs.mjs`](tools/dev-wiring/discover-page-libs.mjs)
   dans `apps/dashboard-wc/scripts/` et le fusionne (`discoverPageLibs()`, scan de
   `libs/wui-<page>/src/<page>.ts`) dans `standalonePages` de
   [`apps/dashboard-wc/vite.shared.ts`](apps/dashboard-wc/vite.shared.ts). Le dev
   server sert alors chaque page sur `/data/dashboard-wc/pages/<page>.js` (proxy
   `/data` → source `.ts`, HMR).
2. **Menu** — déploie [`tools/dev-wiring/page-menu-merge-plugin.mjs`](tools/dev-wiring/page-menu-merge-plugin.mjs)
   et le branche dans [`apps/dashboard-wc/vite.config.ts`](apps/dashboard-wc/vite.config.ts)
   **avant** `copyConfigFilesPlugin` : il fusionne chaque
   `libs/wui-<page>/menu.fragment.jsonc` dans le `menuconfig.json` servi en dev
   (idempotent par `routeId`, sans toucher au `menuconfig.jsonc` committé).
   Équivalent dev de ce que fait `tools/install.template.mjs` au packaging.
3. **Kits** — régénère dans [`tsconfig.base.json`](tsconfig.base.json) les `paths`
   `@visuelconcept/wui-*/*` → `libs/wui-*/src/*` (un par dossier `libs/wui-*`), pour
   que les pages résolvent les kits (`wui-kit`, `wui-fleet-core`, `wui-ai-kit`, …)
   **en dev** (en packaging ils sont vendorisés).

> Les sources de vérité du câblage (`tools/wire-workspace.mjs` + `tools/dev-wiring/`)
> sont **versionnées** ; les fichiers patchés (`apps/`, `tsconfig.base.json`) viennent
> de `webui-runtime-init` et ne le sont pas. Si une ancre est introuvable (version de
> runtime différente), le tool s'arrête en erreur explicite → patch manuel.

> En production, le shell est servi par `webserver.js` / `@visuelconcept/wui-webserver`
> contre le `data/dashboard-wc/` buildé. Le dev server ci-dessous ne sert que la frontend.

### Ajouter une nouvelle page (convention)
Tout est piloté par la convention `wui-<page>` — aucun fichier de config à éditer :
1. Crée `libs/wui-<page>/` avec l'entrée **`src/<page>.ts`** (le nom du fichier =
   nom du dossier sans le préfixe `wui-`). Ce fichier `@customElement('wui-<page>')`
   est le point d'entrée standalone → découvert automatiquement par
   `discoverPageLibs()`.
2. Ajoute `libs/wui-<page>/menu.fragment.jsonc` : un tableau d'entrées de menu avec
   `routeId`, `path`, `title`, `icon`, `component: "wui-<page>"`,
   `module: "/data/dashboard-wc/pages/<page>.js"` → fusionné automatiquement dans la
   nav dev.
3. Si la page tire un **nouveau paquet npm tiers**, déclare-le dans les
   `dependencies` de `libs/wui-<page>/package.json` (version `*`) **et** ajoute sa
   version épinglée à [`tools/external-dependencies.mjs`](tools/external-dependencies.mjs),
   puis `node tools/install-page-dependencies.mjs`.
4. `npm start` → la page est servie et apparaît dans le menu (la découverte
   pages/menu scanne `libs/` **au démarrage** du dev server, donc aucun re-câblage
   n'est requis). Relance `node tools/wire-workspace.mjs` uniquement pour **régénérer le `paths`
   tsconfig** si cette nouvelle lib doit être importée par une autre (cas d'un kit).
   (Une lib **kit** comme `wui-kit`/`wui-fleet-core`/`wui-ai-kit` n'a **pas** de
   `src/<page>.ts` homonyme du dossier : elle est donc ignorée comme page, mais reste
   importable via les `paths` `@visuelconcept/wui-*`.)

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
- **`Clear site data`** au navigateur après tout ajout/modif de page ou de menu
  **sur une cible déployée** : le service-worker met `menuconfig.json` en cache →
  **`Ctrl+Shift+R` ne suffit pas**. _En dev_ le SW est désactivé et
  `pageMenuMergePlugin` re-fusionne les fragments à chaque requête → un simple
  rechargement (F5) suffit à voir une nouvelle page/menu.
- **`@novnc/novnc` épinglé `1.4.0`** (remote-vnc) : `^1.4.0` flotte vers 1.7.0 dont les
  `exports` interdisent le deep-import `@novnc/novnc/core/rfb.js`. `node tools/install-page-dependencies.mjs`
  l'installe **exact** (`--save-exact`) ; n'écris jamais `^1.4.0` à la main dans `package.json`.
- **`three`** est tiré par `wui-fleet-core/types.ts` → requis au build de toute page fleet
  (installé par `node tools/install-page-dependencies.mjs`).
- **Aucun secret dans le repo** : clé PIH (`ProductInfo_Config` DP / `PRODUCT_INFO_API_KEY`),
  tokens LLM (`AI_Assistant_Config` DP) → fournis sur la cible, jamais committés.
