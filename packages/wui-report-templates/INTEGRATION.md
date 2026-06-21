# Intégrer la page Report Templates (`@visuelconcept/wui-report-templates`) — mode source, Tier 1

Page **standalone WinCC OA WebUI** (`/report-templates`) pour créer des **modèles
de rapports configurables** : sections paramétrables (texte / commentaire /
champs / tableau / dataset DP + agrégation / checklist) avec un **workflow de
signature multi-niveaux**. Les modèles sont stockés en DP `ReportBuilder_Template`.
C'est un **Tier 1** (frontend pur, sans backend ni manager). Distribution **source
auto-contenue** : le code report-builder partagé réutilisé est **vendorisé** sous
`_vendor/` (pas de prérequis `@visuelconcept/wui-kit`), et la page est **compilée
sur le workspace runtime de la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. Aucun module backend ni manager requis : la page communique avec WinCC OA via le runtime. `@visuelconcept/wui-webserver` n'est **pas** nécessaire pour ce module.

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
3. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

## Vérifier
1. Connecté → l'entrée **« Modèles de rapports »** apparaît dans le menu.
2. `/report-templates` charge et affiche la liste des modèles (`ReportBuilder_Template`).
3. Créer / éditer un modèle (sections paramétrables + workflow de signature) → l'enregistrement crée/maj un DP `ReportBuilder_Template`.

## Notes / sécurité
- Module **frontend pur** : aucun endpoint `/api/*` exposé, aucun manager Node à démarrer — rien à durcir côté ACL/réseau pour ce package.
- La persistance passe par les DP `ReportBuilder_Template` (base générique `DpJsonStore`) ; les droits d'accès reposent sur les ACL WinCC OA / WebUI existantes du projet.
- L'entrée de menu est en permission `connected` ; restreindre la permission dans `menu.fragment.jsonc` si l'accès doit être limité.
