# Intégrer la page Machine Fleet 3D (`@visuelconcept/wui-machine-fleet-3d`) — mode source, Tier hub

Page **standalone WinCC OA WebUI** : vue **3D three.js** du parc machines (`/fleet-3d`)
avec **bulles d'état/KPI** par machine, **catalogue des causes d'arrêt**, dashboard
machine contextuel (**Gantt + Pareto**) et un **assistant IA** (pont `/api/ai`).
C'est un **hub complet** : frontend + module backend `/api/ai` + **quatre managers
Node** (`machineSim`, `kpiCalc`, `aiAssistant`, `mcpServer`). Distribution **source
auto-contenue** : le kit partagé est **vendorisé** sous `machine-fleet-3d/_vendor/`
(`wui-kit`, `wui-fleet-core`, `wui-ai-kit` — pas de prérequis `@visuelconcept/*`),
et la page est **compilée sur le workspace runtime de la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. **`@visuelconcept/wui-webserver`** installé dans le projet : il héberge la route `/api/ai` (auto-découverte des modules backend).
3. La dépendance npm de `module.json.frontend.npmDeps` (**`three`**) est installée automatiquement dans le workspace par l'installeur.

## Installer (une commande)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet> --register-pmon
```
Exemple (WebDemo2) :
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
L'installeur :
1. copie la **source** (kit vendorisé sous `_vendor/`) → `<workspace>/…/standalone-pages/` ;
2. insère les **2 entrées de menu** → `menuconfig.jsonc` du workspace (idempotent : `/fleet-3d` + `/fleet-3d/:atelier`) ;
3. installe **`three`** dans le workspace (pour que `build:pages` le bundle) ;
4. dépose le **module backend** `/api/ai` → `customer-webserver/src/modules/machine-fleet-3d/` ;
5. déploie les **4 managers** → `<projet>/javascript/{machineSim,kpiCalc,aiAssistant,mcpServer}/` + `npm install` ; avec `--register-pmon`, ajoute leurs lignes à `config/progs` ;
6. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Webserver** : `cd <projet>/javascript/customer-webserver && npm run build`, puis **redémarrer** le manager webserver (il auto-monte `/api/ai`).
2. **Managers** : démarrer **`machineSim`**, **`kpiCalc`**, **`aiAssistant`**, **`mcpServer`** dans la console WinCC OA. Vérifier l'ordre/numéro des managers si pmon a été édité.
3. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas**.

## Vérifier
1. Connecté → entrée **« Parc machines 3D »**, `/fleet-3d` charge la vue 3D (bulles d'état/KPI par machine).
2. `GET https://<dashboard>/api/ai/health` → réponse `ok` (le pont IA est monté).
3. Les bulles KPI se mettent à jour (managers `machineSim` + `kpiCalc` actifs) ; l'assistant IA répond via `aiAssistant`/`mcpServer`.

## Notes / sécurité
- Le module monte `/api/ai/*` en **`fullAccess`** (démo) → restreindre l'`acl` dans `backend/modules/machine-fleet-3d/index.ts` avant prod.
- Les **4 managers** ont besoin de `winccoa-manager`, **fourni par le runtime WinCC OA** (pas dans le `package.json` du manager).
- **Tokens IA** : les jetons des providers sont lus depuis le DP **`AI_Assistant_Config`** (ou variable d'environnement) — **AUCUN n'est livré**. À renseigner avant que l'assistant fonctionne.
- **`mcpServer`** nécessite son **propre `npm install`** (fait par l'installeur) et un **token** — **AUCUN n'est livré**.
