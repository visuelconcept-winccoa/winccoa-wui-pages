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
import { CC_NODESET_XML } from '../samples/opcua-cc-fixtures.js';
import { formatWarning as warningText } from '../warnings.js';
import { buildBookFromNodeSet } from './nodeset.js';
import type { AddressBook } from '../model.js';

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

/**
 * The shape that produced DUPLICATE paths: two instances (P01, P02) each holding a
 * TYPED sub-object (`AcquisitionConfig`). A sub-object of an instance carries a type
 * definition and — being part of an instance, not of a type declaration — no
 * modelling rule, so the naive "every typed object is a root" filter walked it a
 * THIRD and FOURTH time as if it were a machine of its own.
 */
const NESTED_INSTANCES = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>http://example.org/Probe/</Uri></NamespaceUris>
  <Aliases>
    <Alias Alias="Double">i=11</Alias>
    <Alias Alias="HasComponent">i=47</Alias>
    <Alias Alias="HasTypeDefinition">i=40</Alias>
    <Alias Alias="HasModellingRule">i=37</Alias>
  </Aliases>
  <UAObjectType NodeId="ns=1;i=10" BrowseName="1:ProbeType">
    <References><Reference ReferenceType="HasComponent">ns=1;i=11</Reference></References>
  </UAObjectType>
  <UAObject NodeId="ns=1;i=11" BrowseName="1:AcquisitionConfig">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=20</Reference>
      <Reference ReferenceType="HasModellingRule">i=78</Reference>
    </References>
  </UAObject>
  <UAObjectType NodeId="ns=1;i=20" BrowseName="1:AcquisitionConfigType">
    <References><Reference ReferenceType="HasComponent">ns=1;i=21</Reference></References>
  </UAObjectType>
  <UAVariable NodeId="ns=1;i=21" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3">
    <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
  </UAVariable>
  <UAObject NodeId="ns=1;i=100" BrowseName="1:P01">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=101</Reference>
    </References>
  </UAObject>
  <UAObject NodeId="ns=1;i=101" BrowseName="1:AcquisitionConfig">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=20</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=102</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=102" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3"/>
  <UAObject NodeId="ns=1;i=200" BrowseName="1:P02">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=201</Reference>
    </References>
  </UAObject>
  <UAObject NodeId="ns=1;i=201" BrowseName="1:AcquisitionConfig">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=20</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=202</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=202" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3"/>
</UANodeSet>`;

describe('buildBookFromNodeSet — nested instances must not be walked as roots', () => {
  it('roots each MACHINE, never its typed sub-objects (the duplicate-path bug)', () => {
    const book = buildBookFromNodeSet({ bookId: 'probe', xml: NESTED_INSTANCES });
    const paths = book.entries.map((entry) => entry.path);
    expect(paths).toEqual(['P01.AcquisitionConfig.SampleRate', 'P02.AcquisitionConfig.SampleRate']);
  });

  it('never produces the same path twice — a book is keyed by path everywhere', () => {
    const paths = buildBookFromNodeSet({ bookId: 'probe', xml: NESTED_INSTANCES }).entries.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

/**
 * A VENDOR-SHAPED file: two ObjectTypes, each holding a nested instance declaration
 * (`Config`, `Processing`) that carries NO `HasModellingRule` — the shape a real device
 * model has, and the one that made an import report "115 duplicate signal path(s)
 * dropped (Config.SampleRate, Processing.Function…)": every nested declaration was read
 * as a machine of its own, so the same path came out once per type.
 */
const TYPES_WITH_NESTED_DECLARATIONS = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>http://example.org/Vendor/</Uri></NamespaceUris>
  <Aliases>
    <Alias Alias="Double">i=11</Alias>
    <Alias Alias="String">i=12</Alias>
    <Alias Alias="HasComponent">i=47</Alias>
    <Alias Alias="HasTypeDefinition">i=40</Alias>
  </Aliases>
  <UAObjectType NodeId="ns=1;i=10" BrowseName="1:ProbeType">
    <References>
      <Reference ReferenceType="HasComponent">ns=1;i=11</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=13</Reference>
    </References>
  </UAObjectType>
  <UAObject NodeId="ns=1;i=11" BrowseName="1:Config">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=30</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=12</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=12" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3"/>
  <UAObject NodeId="ns=1;i=13" BrowseName="1:Processing">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=31</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=14</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=14" BrowseName="1:Function" DataType="String" AccessLevel="3"/>
  <UAObjectType NodeId="ns=1;i=20" BrowseName="1:ScaleType">
    <References>
      <Reference ReferenceType="HasComponent">ns=1;i=21</Reference>
    </References>
  </UAObjectType>
  <UAObject NodeId="ns=1;i=21" BrowseName="1:Config">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=30</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=22</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=22" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3"/>
  <UAObjectType NodeId="ns=1;i=30" BrowseName="1:ConfigType"/>
  <UAObjectType NodeId="ns=1;i=31" BrowseName="1:ProcessingType"/>
</UANodeSet>`;

describe('buildBookFromNodeSet — instance declarations nested in a TYPE', () => {
  it('never roots at an object that lives inside a type (the 115-duplicates bug)', () => {
    const book = buildBookFromNodeSet({ bookId: 'vendor', xml: TYPES_WITH_NESTED_DECLARATIONS });
    const paths = book.entries.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    // No bare `Config.SampleRate`: it belongs to a type, so it is catalogued under it.
    expect(paths).not.toContain('Config.SampleRate');
    expect(paths).not.toContain('Processing.Function');
  });

  it('catalogues the full structure of each type instead — that IS the model the file declares', () => {
    const book = buildBookFromNodeSet({ bookId: 'vendor', xml: TYPES_WITH_NESTED_DECLARATIONS });
    expect(book.entries.map((entry) => entry.path).sort()).toEqual([
      'ProbeType.Config.SampleRate',
      'ProbeType.Processing.Function',
      'ScaleType.Config.SampleRate'
    ]);
    // And the types are the DPT candidates, with their members.
    expect(book.types.map((type) => type.name)).toContain('ProbeType');
  });

  it('raises no duplicate-path warning at all', () => {
    const book = buildBookFromNodeSet({ bookId: 'vendor', xml: TYPES_WITH_NESTED_DECLARATIONS });
    expect(book.warnings.map((warning) => warning.code)).not.toContain('book.duplicate-paths');
  });
});

/**
 * The realistic vendor shape: the members live on the COMPONENT TYPE, and the same
 * component type is used TWICE by the machine type (`Channel1`/`Channel2` — an IO card,
 * a two-way valve, a dual scale…). Both facts broke the reading:
 *  - `ChannelType` rooted entries of its own, duplicating what `DeviceType.ChannelN`
 *    already catalogued under a name no equipment carries;
 *  - the walk-wide cycle guard stopped at the FIRST use, so `Channel2` came out empty —
 *    half a structure, silently.
 */
const TYPE_REUSED_TWICE = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>http://example.org/Vendor/</Uri></NamespaceUris>
  <Aliases>
    <Alias Alias="Double">i=11</Alias>
    <Alias Alias="HasComponent">i=47</Alias>
    <Alias Alias="HasTypeDefinition">i=40</Alias>
  </Aliases>
  <UAObjectType NodeId="ns=1;i=10" BrowseName="1:DeviceType">
    <References>
      <Reference ReferenceType="HasComponent">ns=1;i=11</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=12</Reference>
    </References>
  </UAObjectType>
  <UAObject NodeId="ns=1;i=11" BrowseName="1:Channel1">
    <References><Reference ReferenceType="HasTypeDefinition">ns=1;i=20</Reference></References>
  </UAObject>
  <UAObject NodeId="ns=1;i=12" BrowseName="1:Channel2">
    <References><Reference ReferenceType="HasTypeDefinition">ns=1;i=20</Reference></References>
  </UAObject>
  <UAObjectType NodeId="ns=1;i=20" BrowseName="1:ChannelType">
    <References>
      <Reference ReferenceType="HasComponent">ns=1;i=21</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=22</Reference>
    </References>
  </UAObjectType>
  <UAVariable NodeId="ns=1;i=21" BrowseName="1:RawRange" DataType="Double" AccessLevel="3"/>
  <UAVariable NodeId="ns=1;i=22" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3"/>
</UANodeSet>`;

describe('buildBookFromNodeSet — a component type used several times', () => {
  it('catalogues EVERY use of the type, not just the first', () => {
    const book = buildBookFromNodeSet({ bookId: 'vendor', xml: TYPE_REUSED_TWICE });
    expect(book.entries.map((entry) => entry.path).sort()).toEqual([
      'DeviceType.Channel1.RawRange',
      'DeviceType.Channel1.SampleRate',
      'DeviceType.Channel2.RawRange',
      'DeviceType.Channel2.SampleRate'
    ]);
  });

  it('does not root entries at the component type itself, but keeps it as a DP-type candidate', () => {
    const book = buildBookFromNodeSet({ bookId: 'vendor', xml: TYPE_REUSED_TWICE });
    expect(book.entries.map((entry) => entry.path)).not.toContain('ChannelType.SampleRate');
    expect(book.types.map((type) => type.name).sort()).toEqual(['ChannelType', 'DeviceType']);
  });

  it('keeps every path unique — no duplicate warning', () => {
    const book = buildBookFromNodeSet({ bookId: 'vendor', xml: TYPE_REUSED_TWICE });
    const paths = book.entries.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(book.warnings.map((warning) => warning.code)).not.toContain('book.duplicate-paths');
  });
});

/**
 * The reported file's shape: the hierarchy is serialised on the CHILD
 * (`IsForward="false"`), which is what most NodeSet2 exporters emit. Read with
 * forward-only references, `P01` and `P02` looked childless while `Config`, `Processing`
 * and `RawRange` each looked like a machine — so the book came out with a bare
 * `Config.SampleRate` per probe, i.e. the "115 duplicate signal path(s) dropped
 * (Config.SampleRate, Processing.Function, RawRange.MinimumValue…)" report.
 */
const INVERSE_HIERARCHY = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>http://example.org/Probe/</Uri></NamespaceUris>
  <Aliases>
    <Alias Alias="Double">i=11</Alias>
    <Alias Alias="String">i=12</Alias>
    <Alias Alias="HasComponent">i=47</Alias>
    <Alias Alias="HasProperty">i=46</Alias>
    <Alias Alias="HasTypeDefinition">i=40</Alias>
  </Aliases>
  <UAObjectType NodeId="ns=1;i=10" BrowseName="1:ProbeType"/>
  <UAObjectType NodeId="ns=1;i=30" BrowseName="1:ConfigType"/>
  <UAObjectType NodeId="ns=1;i=31" BrowseName="1:RangeType"/>

  <UAObject NodeId="ns=1;i=100" BrowseName="1:P01">
    <References><Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference></References>
  </UAObject>
  <UAObject NodeId="ns=1;i=101" BrowseName="1:Config">
    <References>
      <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=100</Reference>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=30</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=102" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3">
    <References><Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=101</Reference></References>
  </UAVariable>
  <UAObject NodeId="ns=1;i=103" BrowseName="1:RawRange">
    <References>
      <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=100</Reference>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=31</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=104" BrowseName="1:MinimumValue" DataType="Double" AccessLevel="3">
    <References><Reference ReferenceType="HasProperty" IsForward="false">ns=1;i=103</Reference></References>
  </UAVariable>

  <UAObject NodeId="ns=1;i=200" BrowseName="1:P02">
    <References><Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference></References>
  </UAObject>
  <UAObject NodeId="ns=1;i=201" BrowseName="1:Config">
    <References>
      <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=200</Reference>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=30</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=202" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3">
    <References><Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=201</Reference></References>
  </UAVariable>
</UANodeSet>`;

describe('buildBookFromNodeSet — hierarchy declared on the CHILD (IsForward="false")', () => {
  it('roots every signal at its instance, relative to its parent objects', () => {
    const book = buildBookFromNodeSet({ bookId: 'probe', xml: INVERSE_HIERARCHY });
    expect(book.entries.map((entry) => entry.path).sort()).toEqual([
      'P01.Config.SampleRate',
      'P01.RawRange.MinimumValue',
      'P02.Config.SampleRate'
    ]);
  });

  it('produces no bare sub-object path and no duplicate warning', () => {
    const book = buildBookFromNodeSet({ bookId: 'probe', xml: INVERSE_HIERARCHY });
    const paths = book.entries.map((entry) => entry.path);
    expect(paths).not.toContain('Config.SampleRate');
    expect(new Set(paths).size).toBe(paths.length);
    expect(book.warnings.map((warning) => warning.code)).not.toContain('book.duplicate-paths');
  });

  it('reads a MIXED file too (some references forward, some inverse)', () => {
    const mixed = INVERSE_HIERARCHY.replace(
      `  <UAObject NodeId="ns=1;i=200" BrowseName="1:P02">
    <References><Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference></References>
  </UAObject>`,
      `  <UAObject NodeId="ns=1;i=200" BrowseName="1:P02">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=201</Reference>
    </References>
  </UAObject>`
    );
    const paths = buildBookFromNodeSet({ bookId: 'probe', xml: mixed }).entries.map((entry) => entry.path);
    expect(paths.filter((path) => path === 'P02.Config.SampleRate')).toHaveLength(1);
  });
});

/**
 * The REAL file (a SiOME export, `Opc.Ua.CC.NodeSet_v1.1`) that reported
 * "115 duplicate signal path(s) dropped (Config.SampleRate, Processing.Function,
 * Processing.WindowSize, RawRange.MinimumValue, RawRange.MaximumValue…)".
 *
 * The subset in `opcua-cc-fixtures.ts` is verbatim, node ids included — see its header
 * for the four mechanisms it exercises at once.
 */
describe('buildBookFromNodeSet — the CC NodeSet2 (SiOME export)', () => {
  const book = (): AddressBook => buildBookFromNodeSet({ bookId: 'cc', xml: CC_NODESET_XML });

  it('roots every signal at its parameter, with the full relative path', () => {
    expect(book().entries.map((entry) => entry.path)).toEqual([
      'P01.ParameterIndex',
      'P01.Name',
      'P01.SampleIndex',
      'P01.SampleValue',
      'P01.StartAcq',
      'P01.EngValue',
      'P01.Config.SampleRate',
      'P01.Config.EngRange.MaximumValue',
      'P01.Config.EngRange.MinimumValue',
      'P01.Config.Processing.Function',
      'P01.Config.Processing.WindowSize',
      'P01.Config.RawRange.MaximumValue',
      'P01.Config.RawRange.MinimumValue',
      'P02.ParameterIndex',
      'P02.Name',
      'P02.SampleIndex',
      'P02.SampleValue',
      'P02.StartAcq',
      'P02.EngValue',
      'P02.Config.SampleRate',
      'P02.Config.EngRange.MaximumValue',
      'P02.Config.EngRange.MinimumValue',
      'P02.Config.Processing.Function',
      'P02.Config.Processing.WindowSize',
      'P02.Config.RawRange.MaximumValue',
      'P02.Config.RawRange.MinimumValue'
    ]);
  });

  it('drops nothing: no duplicate path, hence no duplicate warning', () => {
    const catalogued = book();
    expect(catalogued.warnings.map((warning) => warning.code)).toEqual(['nodeset.file-local-nodeids']);
    const paths = catalogued.entries.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('never catalogues the file OWN bookkeeping as a machine', () => {
    // NamespaceMetadataType (i=11616) and the DataType encodings (i=76) are about the
    // FILE. `http://framatome.com/UA/msp.NamespaceUri` is not a signal — nor a DPE name.
    const paths = book().entries.map((entry) => entry.path);
    expect(paths.some((path) => path.includes('Namespace'))).toBe(false);
    expect(paths.some((path) => path.includes('framatome'))).toBe(false);
    expect(paths.some((path) => path.includes('Default'))).toBe(false);
  });

  it('keeps the datatypes and the ACCESS the file declares (a browse cannot)', () => {
    const entries = new Map(book().entries.map((entry) => [entry.path, entry]));
    // AccessLevel="5" on SampleValue → read-only; "3" on SampleRate → read/write.
    expect(entries.get('P01.SampleValue')).toMatchObject({ sourceType: 'Double', leafType: 'Float', access: 'r' });
    expect(entries.get('P01.Config.SampleRate')).toMatchObject({ sourceType: 'UInt32', leafType: 'UInt', access: 'rw' });
    expect(entries.get('P01.StartAcq')).toMatchObject({ leafType: 'Bool', access: 'rw' });
  });

  it('catalogues the types as DP-type candidates, component types included', () => {
    expect(book().types.map((type) => type.name)).toEqual([
      'CCParameterType',
      'AcquisitionConfigType',
      'CCRangeType',
      'CCProcessingConfigType'
    ]);
  });
});
