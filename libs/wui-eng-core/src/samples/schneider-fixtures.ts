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

/**
 * XVM/XSY-style export (Unity spelling: `elementaryVariable` / `typeName` /
 * `topologicalAddress`, `<comment>` child, Unity-style `<attribute>` pairs, and a
 * structured `derivedVariable` whose members carry their own addresses).
 *
 * ⚠️ Hand-authored — the XVM schema is NOT vendor-published and no real export
 * could be obtained. The reader is spelling-tolerant precisely because of that;
 * replace this fixture with a real export when one is available.
 */
export const M580_PESAGE_XVM = `<?xml version="1.0" encoding="UTF-8"?>
<VariableList version="2.0" producer="Control Expert">
  <variables>
    <elementaryVariable name="Poids_Brut" typeName="REAL" topologicalAddress="%MF400">
      <comment><![CDATA[Poids brut bascule]]></comment>
      <attribute name="unit" value="kg"/>
    </elementaryVariable>
    <elementaryVariable name="Poids_Net" typeName="REAL" topologicalAddress="%MF402">
      <comment>Poids net apr&#232;s tare</comment>
      <attribute name="unit" value="kg"/>
    </elementaryVariable>
    <elementaryVariable name="Tare" typeName="REAL" topologicalAddress="%MF404">
      <comment>Tare courante</comment>
      <attribute name="unit" value="kg"/>
    </elementaryVariable>
    <elementaryVariable name="Cadence_Pesee" typeName="INT" topologicalAddress="%MW406">
      <comment>Cadence de pes&#233;e</comment>
      <attribute name="unit" value="p/min"/>
    </elementaryVariable>
    <elementaryVariable name="Nb_Pesees" typeName="UDINT" topologicalAddress="%MD408">
      <comment>Nombre de pes&#233;es cumul&#233;</comment>
    </elementaryVariable>
    <elementaryVariable name="Bascule_Stable" typeName="EBOOL" topologicalAddress="%M40">
      <comment>Bascule stabilis&#233;e</comment>
    </elementaryVariable>
    <elementaryVariable name="Defaut_Cellule" typeName="EBOOL" topologicalAddress="%M41">
      <comment>D&#233;faut cellule de pes&#233;e</comment>
    </elementaryVariable>
    <derivedVariable name="Recette" typeName="ST_Recette" topologicalAddress="%MW420">
      <comment>Recette de dosage en cours</comment>
      <structMember name="Consigne" typeName="INT" topologicalAddress="%MW420">
        <comment>Consigne de dosage</comment>
        <attribute name="unit" value="kg"/>
      </structMember>
      <structMember name="Tolerance" typeName="INT" topologicalAddress="%MW421">
        <comment>Tol&#233;rance accept&#233;e</comment>
        <attribute name="unit" value="g"/>
      </structMember>
      <structMember name="Libelle" typeName="STRING[16]">
        <comment>Libell&#233; (membre sans adresse propre)</comment>
      </structMember>
    </derivedVariable>
  </variables>
</VariableList>
`;

/** Alternative spelling (attributes capitalised, `Address`/`Description`). */
export const ALT_SPELLING_XVM = `<?xml version="1.0" encoding="UTF-8"?>
<FileExport>
  <VariableList>
    <Variable Name="Debit_Dosage" Type="REAL" Address="%MF500" Description="D&#233;bit de dosage" Unit="m3/h"/>
    <Variable Name="Vanne_Ouverte" Type="EBOOL" Address="%M50" Description="Retour vanne ouverte"/>
  </VariableList>
</FileExport>
`;

