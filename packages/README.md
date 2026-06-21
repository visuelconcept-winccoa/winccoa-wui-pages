# Déployer les pages `@visuelconcept` dans un projet WinCC OA — prérequis, dans l'ordre

Une page redistribuable (ex. `@visuelconcept/wui-para`) est une **feuille**. Elle a
besoin d'une **pile hôte**. Installez de bas en haut :

```
[3] Modules de page     @visuelconcept/wui-<page>     (para, camera-streams, …)   ← le contenu
[2] Webserver           @visuelconcept/wui-webserver  (sert data/ + /api + auto-découverte des modules backend)
[1] Shell WebUI Runtime @wincc-oa/webui-runtime        (data/dashboard-wc/ : index.html, entry/ [carte d'imports], menuconfig, SW)
[0] Projet WinCC OA     3.21+, webserver.js + WebSocket, Node 22 / npm 10, licence valide
```

> Une page (`para.js`) **externalise** lit / @siemens/ix / @wincc-oa/* / rxjs : ces
> dépendances sont fournies par la **carte d'imports du shell** (`index.html` +
> `entry/*.js`). Sans la couche [1], la page n'a ni hôte ni moyen de résoudre ses imports.

---

## [0] Projet WinCC OA (base)
- WinCC OA **3.21+**, **Node 22 LTS**, **npm 10+**.
- Un projet WinCC OA avec **webserver.js activé (support WebSocket)**.
- `config/config` : `[webserverjs] httpsPort` + certificats TLS (le dashboard est servi en https).
- Licence **Client** (lecture/écriture) ou **Light** (lecture seule).

## [1] Shell WebUI Runtime — *le host* (process officiel)
Réf. : WinCC OA → *WebUI Runtime → Setup and Deployment*.
Dans un workspace :
```bash
npm install @wincc-oa/webui-runtime
npx webui-runtime-init
npm install --save-dev --no-audit --no-fund
npm run init:oa-data
```
Builder + déployer le shell **dans le projet** (PowerShell) :
```powershell
$env:OUT_DIR = "D:\WinCC_OA_Proj_321\<PROJET>\data\dashboard-wc"
npm run build
```
Écrit dans `data/dashboard-wc/` : `index.html` (+ la carte d'imports), `entry/`
(bundles partagés lit/ix/rxjs/wui — ce que les pages externalisent), `assets/`,
`serviceworker.js`, `registerSW.js`, `manifest.webmanifest`, `appconfig.json`,
`menuconfig.json`, `customstyles.css`, `worker/`.
**Vérifier** : `https://host:httpsPort/data/dashboard-wc/index.html` charge le dashboard.

> C'est exactement la couche **manquante dans WebDemo2** (il n'avait que `pages/`).
> NB : ce projet `para_proj` **est** une instance personnalisée de `@wincc-oa/webui-runtime`.

## [2] Webserver — `@visuelconcept/wui-webserver`
Le dashboard doit être **servi** et les backends de page ont besoin des routes `/api`.
Notre webserver = la base customer-webserver + **auto-découverte des modules backend**.
```bash
node dist-packages/wui-webserver/install.mjs --project <PROJET> [--winccoa <install-WinCCOA>] [--register-pmon]
```
→ installe dans `<PROJET>/javascript/customer-webserver/`, `npm install` + build (tsc),
et donne la ligne pmon. **Un seul webserver par httpsPort** : désactiver `webserver-js/run.js`
standard s'il tourne. (Détails : `wui-webserver/SETUP.md`.)

> Requis seulement si vous installez des pages **avec backend** (Tier 3, ex. para,
> camera-streams). Pour des pages purement frontend (Tier 1), le webserver.js
> standard qui sert `data/dashboard-wc/` suffit.

## [3] Modules de page — `@visuelconcept/wui-<page>`
Les pages sont distribuées **en source** et **compilées sur le workspace runtime
de la cible** (un bundle de page est couplé à la version du shell — un `.js`
pré-buildé d'une autre version ne fonctionne pas). Pour para (après extraction du `.tgz`) :
```bash
node wui-para/install.mjs --workspace <WORKSPACE-RUNTIME> --project <PROJET>
```
→ copie la source de la page dans `<workspace>/…/standalone-pages/`, ajoute l'entrée
au `menuconfig.jsonc` du workspace, dépose le module backend dans
`customer-webserver/src/modules/`, et lance `build:pages` (déploie dans `<PROJET>/data/dashboard-wc/`).

Puis :
- **backend** : `cd <PROJET>/javascript/customer-webserver && npm run build`, redémarrer le webserver ;
- **navigateur** : DevTools → Application → Storage → **`Clear site data`** — le service-worker
  cache `menuconfig.json`, **`Ctrl+Shift+R` ne suffit pas**. Recharger connecté.

(Détails par page : `wui-<page>/INTEGRATION.md`.)

**Pages Tier 3 (avec manager + relais WebSocket)** — ex. `wui-camera-streams` : leur
`install.mjs` fait en plus (a) installer les **dépendances npm frontend** (ex.
`@cycjimmy/jsmpeg-player`) dans le workspace, (b) déployer le **manager Node** dans
`<PROJET>/javascript/<manager>/` + `npm install` + (avec `--register-pmon`) ajouter sa
ligne à `config/progs`, (c) monter un **relais ws brut** via `registerRaw` (auto-monté
par le wui-webserver). Démarrer le manager dans la console WinCC OA après l'install.
Le **kit partagé est vendorisé** dans le package (`_vendor/<lib>/`, ou `_kit/` pour
camera-streams) → pas de prérequis kit/fleet-core/ai-kit séparé.

---

## Packages de page disponibles
Chaque dossier `wui-<page>/` est un module source autonome (kit vendorisé), installé
par `node wui-<page>/install.mjs --workspace <ws> --project <projet> [--register-pmon]`.

| Package | Tier | npm (auto) | backend `/api` | manager(s) |
|---|---|---|---|---|
| wui-para | 1 | — | /api/para | — |
| wui-msp | 1 | — | — | — |
| wui-audit-trail | 1 | — | — | — |
| wui-mosaic | 1 | — | — | — |
| wui-report-builder | 1 | ix-echarts | — | — |
| wui-report-templates | 1 | — | — | — |
| wui-fleet-closures | 1 | three¹ | — | — |
| wui-fleet-stop-analysis | 1 | ix-echarts, three¹ | — | — |
| wui-thermal-reports | 1 | ix-echarts, three¹ | — | — |
| wui-fleet-kpi-analysis | 3 | ix-echarts, three¹ | — | kpiCalc |
| wui-production-orders | 3 | ix-echarts, three¹ | — | productionOrdersKpi |
| wui-camera-streams | 3 | jsmpeg-player | /api/rtsp (+ws relais) | rtspProxy |
| wui-remote-vnc | 3 | @novnc/novnc (1.4.0) | /api/vnc (+ws relais) | vncProxy |
| wui-asset-lifecycle-intelligence | 3 | — | /api/product-info | productInfo² |
| wui-machine-fleet-3d | hub | three | /api/ai | machineSim, kpiCalc, aiAssistant, mcpServer² |

¹ `three` est tiré par `wui-fleet-core/types.ts` (import) → requis au build de toute page fleet.
² **Secrets jamais embarqués** : clé PIH (`ProductInfo_Config` DP / env), tokens LLM (`AI_Assistant_Config` DP). À fournir sur la cible.

> Validé (build niveau cible, runtime v1.2.3) : les 15 pages buildent via `build:pages` ;
> les 5 modules backend (para, camera-streams, remote-vnc, product-info, ai) compilent (tsc).

## Outils internes (`_tools/`)
Pipeline de build **déterministe** (regénère tous les packages depuis les libs source) :
- `vendor-page.mjs <page> <libsRoot> <out>` — rend une page autonome : copie tout `src/` sous `<page>/`, écrit un shim d'entrée `<page>.ts`, vendorise la **closure transitive** `@visuelconcept` (cross-lib **et** siblings relatifs) sous `_vendor/<lib>/`, et réécrit chaque import en relatif.
- `build-package.mjs <specs.json>` — assemble `wui-<page>/` : vendorise la frontend, copie le menu, **détecte les deps npm** (scan), copie le module backend + génère son `index.ts` (mount/acl/routes/registerRaw), copie les managers (exclut `node_modules`/`.env`/maps), génère `module.json`, dépose l'installeur canonique.
- `install.template.mjs` — installeur **unique** pour tous les tiers (chaque section no-op si la surface est absente).
- `specs.json` — déclaration des 13 packages.

Regénérer tout : `node _tools/build-package.mjs _tools/specs.json`.

---

## Checklist d'ordre d'installation
1. **[0]** Projet WinCC OA 3.21 + webserver.js/WebSocket + Node 22/npm 10 + licence.
2. **[1]** `@wincc-oa/webui-runtime` → `webui-runtime-init` → `build` (OUT_DIR=`data/dashboard-wc`) → `init:oa-data`. **← le shell**
3. **[2]** `@visuelconcept/wui-webserver` (si des pages ont un backend).
4. **[3]** `@visuelconcept/wui-<page>` × N (les pages).

## État de WebDemo2 (ton cas)
| Couche | État |
|---|---|
| [0] projet + certs + progs | ✅ présent |
| [1] shell + workspace runtime (`webui-workspace/` v1.2.3, `data/dashboard-wc/`) | ✅ présent |
| [2] `wui-webserver` | ✅ installé, buildé, enregistré dans `config/progs` |
| [3] pages | ✅ **les 15 pages buildées + déployées** dans `data/dashboard-wc/pages/` ; modules backend + managers copiés (`--no-build`) |

**Reste pour le runtime** (tests à la fin) : `npm install` des managers qui ont un
`package.json` (mcpServer), enregistrer les managers Tier-3 dans pmon (`--register-pmon`),
recompiler le webserver, démarrer les managers, puis **`Clear site data`** au navigateur.
