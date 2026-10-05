// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Classic-S7 fixtures — STEP 7 symbol tables (three dialects), AWL/STL sources,
 * and one online inventory. Used by the unit tests AND by the offline demo, so
 * the screenshots and the tests read the same bytes.
 *
 * ⚠️ Authored by hand against the published descriptions of the export formats.
 * To be re-calibrated against REAL exports from the user's STEP 7 projects as
 * soon as they are provided — the same standing caveat the SimaticML fixtures
 * carry (see `docs/wui-eng-studio/NOTES.md`).
 *
 * The three symbol dialects are deliberately the SAME table, so a test can
 * assert that the generator does not care which one an engineer happens to have:
 * that indifference is the feature.
 */

/**
 * `.SDF` — System Data Format: quoted CSV, symbol first.
 * The comma inside a comment is what makes the quoting load-bearing.
 */
export const SYMBOLS_SDF = `"Marche_Pompe_1","A      4.0","BOOL","Ordre de marche pompe 1"
"Defaut_Pompe_1","E      0.3","BOOL","Defaut pompe 1, toutes causes"
"Pression_Reseau","PEW  256","INT","Pression reseau (mbar)"
"Compteur_Cycles","MW      20","INT","Nombre de cycles"
"Consigne_Debit","MD      30","REAL","Consigne de debit (m3/h)"
"Temporisation_1","T      5","TIMER","Temporisation demarrage"
"Echange","DB      10","DB      10","Bloc d'echange superviseur"
"Recettes","DB      11","DB      11","Bloc de recettes"
`;

/**
 * `.ASC` — fixed-width columns, every record prefixed by its length and a comma.
 * German mnemonics (`E`/`A`/`Z`), because a STEP 7 project configured in German
 * exports them and the book must come out identical.
 */
export const SYMBOLS_ASC = `126,Marche_Pompe_1           A      4.0        BOOL      Ordre de marche pompe 1
126,Defaut_Pompe_1           E      0.3        BOOL      Defaut pompe 1
126,Pression_Reseau          PEW  256          INT       Pression reseau (mbar)
126,Compteur_Cycles          MW      20        INT       Nombre de cycles
126,Consigne_Debit           MD      30        REAL      Consigne de debit (m3/h)
126,Echange                  DB      10        DB    10  Bloc d'echange superviseur
`;

/**
 * A reference-data CSV export: **address first**, semicolon separator, and a
 * header row. Everything the symbol-first dialects are not — which is the point:
 * the column order is detected, never configured.
 */
export const SYMBOLS_CSV_ADDRESS_FIRST = `Address;Symbol;Data type;Comment
A 4.0;Marche_Pompe_1;BOOL;Ordre de marche pompe 1
E 0.3;Defaut_Pompe_1;BOOL;Defaut pompe 1
MW 20;Compteur_Cycles;INT;Nombre de cycles
DB 10;Echange;DB 10;Bloc d'echange superviseur
`;

/** A symbol table with a stale type: `MW` addresses a word, `BOOL` claims a bit. */
export const SYMBOLS_WIDTH_MISMATCH = `"Alarme_Generale","MW      40","BOOL","Type errone"
"Compteur_Cycles","MW      20","INT","Nombre de cycles"
`;

/**
 * AWL source of the exchange block (`DB10`), with a nested STRUCT and a UDT
 * reference — the two shapes that make the offset computation non-trivial.
 *
 * Layout, in the standard (non-optimized) rule:
 *   0  Consigne_Vitesse  REAL   -> DB10.DBD0
 *   4  Marche            BOOL   -> DB10.DBX4.0
 *   4.1 Arret            BOOL   -> DB10.DBX4.1
 *   6  Compteur_Pieces   DINT   -> DB10.DBD6   (word alignment after the bits)
 *   10 Mesures.Debit     REAL   -> DB10.DBD10
 *   14 Mesures.Pression  REAL   -> DB10.DBD14
 *   18 Moteur.*          UDT_Moteur
 */
export const AWL_DB_ECHANGE = `DATA_BLOCK DB 10
TITLE = Echange superviseur
VERSION : 0.1

  STRUCT
   Consigne_Vitesse : REAL := 0.000000e+000;   //Consigne de vitesse (tr/min)
   Marche : BOOL ;   //Ordre de marche
   Arret : BOOL ;   //Ordre d'arret
   Compteur_Pieces : DINT ;   //Nombre de pieces produites
   Mesures : STRUCT
    Debit : REAL ;   //Debit (m3/h)
    Pression : REAL ;   //Pression (bar)
   END_STRUCT ;
   Moteur : "UDT_Moteur";
  END_STRUCT ;
BEGIN
   Consigne_Vitesse := 0.000000e+000;
   Marche := FALSE;
END_DATA_BLOCK
`;

/** The UDT the exchange block references. */
export const AWL_UDT_MOTEUR = `TYPE "UDT_Moteur"
TITLE =Moteur standard
VERSION : 0.1

  STRUCT
   Retour_Marche : BOOL ;   //Retour de marche
   Defaut : BOOL ;   //Defaut moteur
   Vitesse : REAL ;   //Vitesse (tr/min)
   Courant : REAL ;   //Courant (A)
  END_STRUCT ;
END_TYPE
`;

/**
 * ONE source file declaring a UDT and TWO data blocks — what *Generate source* on
 * a whole program writes, and the common case in the field.
 *
 * `DB11` deliberately references the UDT declared ABOVE it in the same file: a
 * parser that only looked at the file's first declaration, or that resolved UDTs
 * per file rather than across the ingested bundle, would silently drop its members.
 */
export const AWL_MULTI_BLOCK = `TYPE "UDT_Vanne"
TITLE =Vanne standard
VERSION : 0.1

  STRUCT
   Ouverte : BOOL ;   //Position ouverte
   Fermee : BOOL ;   //Position fermee
   Position : REAL ;   //Position (%)
  END_STRUCT ;
END_TYPE

DATA_BLOCK DB 20
TITLE =Mesures reseau
VERSION : 0.1

  STRUCT
   Debit : REAL ;   //Debit (m3/h)
   Pression : REAL ;   //Pression (bar)
   Temperature : REAL ;   //Temperature (degC)
  END_STRUCT ;
BEGIN
   Debit := 0.000000e+000;
END_DATA_BLOCK

DATA_BLOCK DB 21
TITLE =Vannes
VERSION : 0.1

  STRUCT
   Marche_Generale : BOOL ;   //Ordre de marche general
   Vanne_Amont : "UDT_Vanne";
   Vanne_Aval : "UDT_Vanne";
  END_STRUCT ;
BEGIN
   Marche_Generale := FALSE;
END_DATA_BLOCK
`;

/** An INSTANCE data block: no STRUCT of its own, declared from the UDT. */
export const AWL_DB_INSTANCE = `DATA_BLOCK DB 12 "UDT_Moteur"
TITLE =Moteur pompe 1
VERSION : 0.1
BEGIN
   Retour_Marche := FALSE;
END_DATA_BLOCK
`;

/** A block whose declaration cannot be read, beside one that can. */
export const AWL_PARTLY_BROKEN = `DATA_BLOCK DB 20
  STRUCT
   Bonne_Mesure : REAL ;   //Lisible
   ceci n'est pas une declaration
   Autre_Mesure : REAL ;
  END_STRUCT ;
BEGIN
END_DATA_BLOCK
`;

/**
 * One online inventory, as the `s7Browse` manager reports it: a CPU 315-2 PN/DP
 * holding DB10 (48 B) and DB11 (200 B) — but NOT the DB12 an instance block was
 * exported for, and with DB10 shorter than the AWL source describes once the
 * UDT is expanded. Both divergences are the ones the cross-check exists to find.
 */
export const S7_INVENTORY = {
  connection: 'S7_Pompage',
  endpoint: '192.168.0.1:0/2',
  readAt: '2026-08-02T00:00:00.000Z',
  pduLength: 240,
  cpu: {
    moduleName: 'CPU 315-2 PN/DP',
    moduleTypeName: 'CPU 315-2 PN/DP',
    orderCode: '6ES7 315-2EH14-0AB0',
    serialNumber: 'S C-C2UC12345678',
    version: 'V3.2.6'
  },
  counts: { OB: 3, DB: 2, FB: 1, FC: 4, SFC: 12, SFB: 6, SDB: 2 },
  blocks: [
    { kind: 'DB' as const, number: 10, mc7Size: 24, loadSize: 92, codeDate: '2024-11-05', author: 'VC' },
    { kind: 'DB' as const, number: 11, mc7Size: 200, loadSize: 268, codeDate: '2024-11-05', author: 'VC' },
    { kind: 'OB' as const, number: 1, mc7Size: 520, loadSize: 620 },
    { kind: 'FB' as const, number: 1, mc7Size: 310, loadSize: 400 }
  ]
};
