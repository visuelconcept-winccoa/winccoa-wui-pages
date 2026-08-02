// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Control Expert / Unity Pro variables-export fixtures, used by the unit tests
 * AND the demo gateway. Hand-authored in the shape a data-editor export takes
 * (semicolon-separated, FR headers — the common case on French projects).
 *
 * Deliberately contains the situations a real export throws at the parser:
 *  - located `%MW` / `%M` / `%IW` variables of several types;
 *  - an **unlocated** variable (no address) → invisible over Modbus;
 *  - a **register overlap** (`Debit_Brut` DINT at %MW112 spans 112-113, while
 *    `Niveau_Cuve` INT sits at %MW113);
 *  - a **topological** address (`%I0.2.3`) → not Modbus-addressable;
 *  - a **derived type** (unmapped) variable.
 *
 * ⚠️ To be re-calibrated against a REAL Control Expert export when one is
 * provided (see docs/wui-eng-studio/INTEGRATION.md "inputs needed").
 */

/** M580 station export — semicolon-separated, French headers. */
export const M580_STATION_CSV = `Nom;Adresse;Type;Commentaire;Unité
Marche_Pompe1;%M10;EBOOL;Commande marche pompe 1;
Marche_Pompe2;%M11;EBOOL;Commande marche pompe 2;
Defaut_Pompe1;%M20;EBOOL;Défaut pompe 1;
Defaut_Pompe2;%M21;EBOOL;Défaut pompe 2;
Mode_Auto;%M30;EBOOL;Mode automatique actif;
Consigne_Debit;%MW100;INT;Consigne de débit;m3/h
Consigne_Niveau;%MW101;INT;Consigne de niveau;%
Pression_Reseau;%MF104;REAL;Pression réseau;bar
Temperature_Eau;%MF106;REAL;Température eau;°C
Compteur_Volume;%MD108;UDINT;Volume cumulé;m3
Nb_Demarrages;%MW110;UINT;Nombre de démarrages pompe 1;
Debit_Brut;%MW112;DINT;Débit brut capteur (2 mots);m3/h
Niveau_Cuve;%MW113;INT;Niveau cuve (CHEVAUCHEMENT volontaire);%
Etat_Vanne;%IW200;INT;Retour position vanne;%
Securite_Niveau_Bas;%I0.2.3;EBOOL;Sécurité niveau bas (topologique);
Recette_Courante;;STRING[16];Recette en cours (non localisée);
Bloc_Regulation;%MW300;PID_Params;Paramètres régulation (type dérivé);
`;
