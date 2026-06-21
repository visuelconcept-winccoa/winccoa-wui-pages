# wui-msp — notes métier & architecture

## Domaine / objet

Page WebUI autonome **MSP** (route `/msp`, custom element `wui-msp`, classe `WuiMsp`, permission `connected`). Elle héberge la **démo de tableau de bord SPC (Statistical Process Control) des paramètres** : cartes de contrôle X et moving-range, limites de contrôle et de tolérance, alarmes, streaming live.

La page elle-même est une coquille Lit fine : un `wui-content-header` + un `<iframe>` qui remplit le corps. Tout le SPC vit dans le prototype chargé par l'iframe ; la page n'est qu'un hôte isolant.

Tier 1 : **aucun backend ni manager**, **aucun datapoint** connecté à ce jour (cf. module.json — `frontend` seul, pas de `backend`).

## Architecture (iframe d'isolation)

- L'iframe charge un prototype HTML **autonome** (vanilla JS + Chart.js, application monolithique : cartes X / moving-range, limites contrôle & tolérance, alarmes, streaming live).
- **Pourquoi un iframe plutôt qu'une réécriture Lit/iX** : le prototype fait un usage massif de `document`/`window` globaux et embarque son propre CSS. L'iframe l'isole totalement du shell applicatif iX, sans réécriture. Choix assumé « démo pour l'instant », remplaçable plus tard par un vrai rendu iX.
- Le chargeur de vendor du HTML tente plusieurs chemins (`../vendor/`, `/data/html/vendor/`, puis `vendor/` relatif) ; c'est le 3e (relatif) qui résout les libs. Les fallbacks de scripts au niveau racine font des 404 inoffensifs (`onerror=""`).

## Mode démo (sans datapoint)

- **Activation automatique** : si aucune donnée WinCC OA CTL n'est poussée (`window._initialParametersData` non défini), la fonction `initializeWhenReady()` du prototype charge ses `demoData` intégrées (paramètres : courant, tension, vitesse_fil, deviation, temperature, pression), sélectionne courant + tension, et lance le flux de démo live.
- **`sendEvent` no-op hors WinCC OA** : quand `oaJsApi` est absent (cas d'un iframe normal, hors EWO WebView WinCC OA), `sendEvent` se contente d'un `console.warn`. Le prototype tourne donc proprement en iframe simple, sans erreur.

## Pièges / à savoir

- **Pas de données réelles** : aucune connexion datapoint pour l'instant. Pour câbler du live, il faudra pousser les vraies données de paramètres dans le prototype (ex. via `window.initParametersDashboard(data)` / `addDataPoint`) en remplacement de `demoData`.
- **Signification de « MSP »** non figée : titres / traductions et icône finale restent à décider (l'icône `cogwheel` est un placeholder connu-bon dans le bundle déployé).
- Les assets de l'iframe (HTML du prototype, composants SPC, vendor Chart.js) ne sont **pas** construits par Vite : ce sont des assets statiques servis tels quels. Seul le custom element de la page passe par le build des pages.
- L'iframe garantit l'isolation CSS/JS : ne pas compter sur le partage d'état ou de styles avec le shell iX.
