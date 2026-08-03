// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NodeSet2 XML → address book: alias/datatype resolution, AccessLevel decoding,
 * the instance vs template-only shapes, supertype folding, and the file-local
 * NodeId caveat that makes every address a placeholder candidate.
 *
 * The fixtures are hand-written `UANodeSet` documents following OPC UA Part 6.
 * ⚠️ They are NOT vendor exports — see NOTES: a real companion-spec NodeSet
 * (PackML/OPC 30050) is still to be calibrated against.
 */
import { describe, expect, it } from 'vitest';
import { formatWarning as warningText } from '../warnings.js';
import { buildBookFromNodeSet } from './nodeset.js';

/** A NodeSet declaring one ObjectType and two INSTANCES of it (a real machine). */
const WITH_INSTANCES = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>http://visuelconcept.com/Four/</Uri></NamespaceUris>
  <Aliases>
    <Alias Alias="Boolean">i=1</Alias>
    <Alias Alias="Double">i=11</Alias>
    <Alias Alias="HasComponent">i=47</Alias>
    <Alias Alias="HasTypeDefinition">i=40</Alias>
    <Alias Alias="HasModellingRule">i=37</Alias>
  </Aliases>
  <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:FourType">
    <DisplayName>FourType</DisplayName>
    <References>
      <Reference ReferenceType="HasComponent">ns=1;i=1001</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=1002</Reference>
    </References>
  </UAObjectType>
  <UAVariable NodeId="ns=1;i=1001" BrowseName="1:Temperature" DataType="Double" AccessLevel="1">
    <DisplayName>Temperature</DisplayName>
    <Description>Température de la chambre</Description>
    <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
  </UAVariable>
  <UAVariable NodeId="ns=1;i=1002" BrowseName="1:EnChauffe" DataType="Boolean" AccessLevel="3">
    <DisplayName>EnChauffe</DisplayName>
    <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
  </UAVariable>
  <UAObject NodeId="ns=1;i=2001" BrowseName="1:Four001">
    <DisplayName>Four001</DisplayName>
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=1000</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=2011</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=2011" BrowseName="1:Temperature" DataType="Double" AccessLevel="1">
    <DisplayName>Temperature</DisplayName>
  </UAVariable>
  <UAObject NodeId="ns=1;i=2002" BrowseName="1:Four002">
    <DisplayName>Four002</DisplayName>
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=1000</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=2012</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=2012" BrowseName="1:Temperature" DataType="Double" AccessLevel="3">
    <DisplayName>Temperature</DisplayName>
  </UAVariable>
</UANodeSet>`;

/** A companion-spec shaped NodeSet: TYPES only, with inheritance and nesting. */
const TYPES_ONLY = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>http://example.org/PackMLish/</Uri></NamespaceUris>
  <Aliases>
    <Alias Alias="Int32">i=6</Alias>
    <Alias Alias="Float">i=10</Alias>
    <Alias Alias="HasComponent">i=47</Alias>
    <Alias Alias="HasProperty">i=46</Alias>
    <Alias Alias="HasSubtype">i=45</Alias>
    <Alias Alias="HasTypeDefinition">i=40</Alias>
  </Aliases>
  <UAObjectType NodeId="ns=1;i=100" BrowseName="1:BaseUnitType">
    <References><Reference ReferenceType="HasComponent">ns=1;i=101</Reference></References>
  </UAObjectType>
  <UAVariable NodeId="ns=1;i=101" BrowseName="1:StateCurrent" DataType="Int32" AccessLevel="1"/>
  <UAObjectType NodeId="ns=1;i=200" BrowseName="1:FillerType">
    <References>
      <Reference ReferenceType="HasSubtype" IsForward="false">ns=1;i=100</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=201</Reference>
      <Reference ReferenceType="HasProperty">ns=1;i=203</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=204</Reference>
    </References>
  </UAObjectType>
  <UAObject NodeId="ns=1;i=201" BrowseName="1:Status">
    <References>
      <Reference ReferenceType="HasComponent">ns=1;i=202</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=202" BrowseName="1:CurMachSpeed" DataType="Float" AccessLevel="1"/>
  <UAVariable NodeId="ns=1;i=203" BrowseName="1:Profil" DataType="Float" ValueRank="1" AccessLevel="1"/>
  <UAMethod NodeId="ns=1;i=204" BrowseName="1:Reset"/>
</UANodeSet>`;

describe('buildBookFromNodeSet — a file with instances', () => {
  const book = buildBookFromNodeSet({ bookId: 'ns1', xml: WITH_INSTANCES, file: 'four.xml', generatedAt: '2026-08-02T10:00:00.000Z' });

  it('roots the entries at each real instance, not at the type', () => {
    expect(book.entries.map((e) => e.path)).toEqual(['Four001.Temperature', 'Four002.Temperature']);
  });

  it('ignores instance DECLARATIONS (nodes carrying a modelling rule)', () => {
    // ns=1;i=1001/1002 belong to the TYPE — they must not appear as instances.
    expect(book.entries.some((e) => e.path === 'Temperature')).toBe(false);
  });

  it('decodes AccessLevel (1 = read, 3 = read+write)', () => {
    expect(book.entries[0].access).toBe('r');
    expect(book.entries[1].access).toBe('rw');
  });

  it('resolves the DataType alias to the OPC UA name and maps the leaf type', () => {
    expect(book.entries[0]).toMatchObject({ sourceType: 'Double', leafType: 'Float' });
  });

  it('catalogues the ObjectType as a BookType (the DPT candidate)', () => {
    const type = book.types.find((t) => t.name === 'FourType');
    expect(type?.members.map((m) => m.path).sort()).toEqual(['EnChauffe', 'Temperature']);
  });

  it('carries the source description as the entry comment', () => {
    const declared = book.types.find((t) => t.name === 'FourType')?.members.find((m) => m.path === 'Temperature');
    expect(declared?.comment).toBe('Température de la chambre');
  });

  it('is a TEMPLATE catalog: no interface, placeholder addresses, loud caveat', () => {
    expect(book.interface).toBeUndefined();
    expect(book.entries[0].addresses.opcua).toBe('<Connection>$$1$1$ns=1;i=2011');
    expect(warningText(book.warnings[0])).toContain('FILE-LOCAL');
  });

  it('records the provenance', () => {
    expect(book.provenance).toMatchObject({ kind: 'nodeset', file: 'four.xml', generatedAt: '2026-08-02T10:00:00.000Z' });
    expect(book.provenance.detail).toContain('2 instance(s)');
  });
});

describe('buildBookFromNodeSet — a types-only (companion spec) file', () => {
  const book = buildBookFromNodeSet({ bookId: 'ns2', xml: TYPES_ONLY });

  it('roots the entries at the TYPE name and says the catalog is a gabarit', () => {
    expect(book.entries.map((e) => e.path)).toContain('FillerType.Status.CurMachSpeed');
    expect(book.warnings.some((w) => warningText(w).includes('TEMPLATES'))).toBe(true);
  });

  it('folds the supertype members into the subtype (WinCC OA has no inheritance)', () => {
    expect(book.entries.map((e) => e.path)).toContain('FillerType.StateCurrent');
  });

  it('walks HasProperty as well as HasComponent', () => {
    expect(book.entries.map((e) => e.path)).toContain('FillerType.Profil');
  });

  it('flags the array property and skips the method', () => {
    expect(book.entries.find((e) => e.path.endsWith('Profil'))).toMatchObject({ sourceType: 'Float[]', unmapped: true });
    expect(book.warnings.some((w) => warningText(w).includes('method'))).toBe(true);
  });
});

describe('buildBookFromNodeSet — robustness', () => {
  it('rejects a document that is not a UANodeSet', () => {
    expect(() => buildBookFromNodeSet({ bookId: 'x', xml: '<Document><A/></Document>' })).toThrow(/not a NodeSet2 document/);
  });

  it('warns rather than throwing on a NodeSet with no usable variable', () => {
    const xml = '<UANodeSet><NamespaceUris><Uri>http://x/</Uri></NamespaceUris></UANodeSet>';
    const book = buildBookFromNodeSet({ bookId: 'x', xml });
    expect(book.entries).toHaveLength(0);
    expect(book.warnings.some((w) => warningText(w).includes('No usable variable found'))).toBe(true);
  });

  it('ignores a reference into a namespace the file does not carry', () => {
    const xml = `<UANodeSet>
      <UAObjectType NodeId="ns=1;i=1" BrowseName="1:T">
        <References><Reference ReferenceType="i=47">ns=9;i=999</Reference></References>
      </UAObjectType>
    </UANodeSet>`;
    expect(buildBookFromNodeSet({ bookId: 'x', xml }).entries).toHaveLength(0);
  });
});
