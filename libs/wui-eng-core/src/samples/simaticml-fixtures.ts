// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Realistic SimaticML fixtures (TIA Openness `Export()` shape) used by the
 * unit tests AND the demo gateway — single source, importable in Node and in
 * the browser without loaders.
 *
 * ⚠️ Authored by hand against the SimaticML v5 interface dialect. To be
 * re-calibrated against REAL exports from the user's TIA projects as soon as
 * they are provided (pending input — see docs/wui-eng-studio/README.md).
 */

/** UDT `UDT_Moteur` (SW.Types.PlcStruct export). */
export const UDT_MOTEUR_XML = `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <Engineering version="V17" />
  <SW.Types.PlcStruct ID="0">
    <AttributeList>
      <Interface>
        <Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5">
          <Section Name="None">
            <Member Name="Marche" Datatype="Bool">
              <Comment><MultiLanguageText Lang="fr-FR">Retour de marche</MultiLanguageText></Comment>
            </Member>
            <Member Name="Defaut" Datatype="Bool">
              <Comment><MultiLanguageText Lang="fr-FR">D&#233;faut moteur</MultiLanguageText></Comment>
            </Member>
            <Member Name="Vitesse" Datatype="Real">
              <Comment><MultiLanguageText Lang="fr-FR">Vitesse (tr/min)</MultiLanguageText></Comment>
            </Member>
            <Member Name="Courant" Datatype="Real">
              <Comment><MultiLanguageText Lang="fr-FR">Courant (A)</MultiLanguageText></Comment>
            </Member>
          </Section>
        </Sections>
      </Interface>
      <Name>UDT_Moteur</Name>
    </AttributeList>
  </SW.Types.PlcStruct>
</Document>
`;

/** Optimized global DB `DB_Four` referencing the UDT (symbolic-only access). */
export const DB_FOUR_OPTIMIZED_XML = `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <Engineering version="V17" />
  <SW.Blocks.GlobalDB ID="0">
    <AttributeList>
      <Interface>
        <Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5">
          <Section Name="Static">
            <Member Name="Etat" Datatype="Struct">
              <Member Name="EnChauffe" Datatype="Bool">
                <Comment><MultiLanguageText Lang="fr-FR">Four en chauffe</MultiLanguageText></Comment>
              </Member>
              <Member Name="PorteOuverte" Datatype="Bool" />
            </Member>
            <Member Name="Mesures" Datatype="Struct">
              <Member Name="Temperature" Datatype="Real">
                <Comment><MultiLanguageText Lang="fr-FR">Temp&#233;rature (&#176;C)</MultiLanguageText></Comment>
              </Member>
              <Member Name="Hygrometrie" Datatype="Real" />
            </Member>
            <Member Name="Consignes" Datatype="Struct">
              <Member Name="Temperature" Datatype="Real" />
              <Member Name="Rampe" Datatype="Real" />
            </Member>
            <Member Name="Moteur" Datatype="&quot;UDT_Moteur&quot;">
              <Comment><MultiLanguageText Lang="fr-FR">Moteur ventilation</MultiLanguageText></Comment>
            </Member>
            <Member Name="Alarmes" Datatype="Array[0..7] of Bool" />
          </Section>
        </Sections>
      </Interface>
      <MemoryLayout>Optimized</MemoryLayout>
      <Name>DB_Four</Name>
      <Number>5</Number>
      <ProgrammingLanguage>DB</ProgrammingLanguage>
    </AttributeList>
  </SW.Blocks.GlobalDB>
</Document>
`;

/** Standard (non-optimized) exchange DB `DB_Echange` → classic operands. */
export const DB_ECHANGE_STANDARD_XML = `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <Engineering version="V17" />
  <SW.Blocks.GlobalDB ID="0">
    <AttributeList>
      <Interface>
        <Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5">
          <Section Name="Static">
            <Member Name="Vie" Datatype="Bool">
              <Comment><MultiLanguageText Lang="fr-FR">Bit de vie</MultiLanguageText></Comment>
            </Member>
            <Member Name="Acquit" Datatype="Bool" />
            <Member Name="ModeAuto" Datatype="Bool" />
            <Member Name="Reserve" Datatype="Byte" />
            <Member Name="ConsigneTemp" Datatype="Real">
              <Comment><MultiLanguageText Lang="fr-FR">Consigne temp&#233;rature (&#176;C)</MultiLanguageText></Comment>
            </Member>
            <Member Name="MesureTemp" Datatype="Real" />
            <Member Name="NbPieces" Datatype="Int" />
            <Member Name="Recette" Datatype="String[20]" />
            <Member Name="Statut" Datatype="Struct">
              <Member Name="Code" Datatype="Int" />
              <Member Name="Message" Datatype="String[16]" />
            </Member>
          </Section>
        </Sections>
      </Interface>
      <MemoryLayout>Standard</MemoryLayout>
      <Name>DB_Echange</Name>
      <Number>12</Number>
      <ProgrammingLanguage>DB</ProgrammingLanguage>
    </AttributeList>
  </SW.Blocks.GlobalDB>
</Document>
`;
