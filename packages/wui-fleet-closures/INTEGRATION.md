# Intégrer la page Fleet Closures (`@visuelconcept/wui-fleet-closures`) — mode source, Tier 1

Page **standalone WinCC OA WebUI** pour gérer les **jours non travaillés** de la
flotte sur **`/fleet-closures`** : filtres année / atelier / machine, import-export
JSON, et gestion des chevauchements (remplacer / ignorer / annuler). C'est un
**Tier 1** : **frontend uniquement** (aucun module backend, aucun manager).
Distribution **source auto-contenue** : le kit partagé (kit / fleet-core / ai-kit)
est **vendorisé** sous `_vendor/` (pas de prérequis `@visuelconcept/wui-kit`), et la
page est **compilée sur le workspace runtime de la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. Aucun prérequis webserver / backend (page frontend uniquement).

## Installer (une commande)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet>
```
Exemple (WebDemo2) :
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
L'installeur :
1. copie la **source** (kit vendorisé sous `_vendor/`) → `<workspace>/…/standalone-pages/` ;
2. insère l'**entrée de menu** → `menuconfig.jsonc` du workspace (idempotent) ;
3. installe les **dépendances npm** de la page (`three`) dans le workspace (pour que `build:pages` les bundle) ;
4. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

## Vérifier
1. Connecté → la page **`/fleet-closures`** charge (l'entrée « Jours non travaillés » est `hidden`, atteinte depuis l'aperçu flotte).
2. Les filtres année / atelier / machine fonctionnent, et l'import-export JSON s'ouvre.

## Notes / sécurité
- **Aucun module backend ni manager** : rien à monter, rien à démarrer, pas d'`acl` à durcir.
- L'entrée de menu est `hidden` (navigation depuis l'aperçu flotte) — pas une régression, c'est volontaire.
