// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `buildBookFromIngest` — the ONE place that chooses a file generator.
 *
 * What matters here is not the parsing (each generator has its own suite) but that
 * the routing and the refusals are identical for every caller: the backend route, the
 * offline demo gateway and the creation form's import preview all go through this
 * function, so a preview can never show a different book from the one that gets
 * stored. The tests therefore check the ROUTING, the provenance, and that a payload
 * which does not match its format is refused by NAME rather than yielding an empty book.
 */
import { describe, expect, it } from 'vitest';
import { buildBookFromIngest } from './ingest.js';
import { M580_PESAGE_XVM, M580_STATION_CSV } from './samples/schneider-fixtures.js';
import { DB_ECHANGE_STANDARD_XML } from './samples/simaticml-fixtures.js';

const NODESET_XML = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>http://example.org/Probe/</Uri></NamespaceUris>
  <Aliases>
    <Alias Alias="Double">i=11</Alias>
    <Alias Alias="HasComponent">i=47</Alias>
    <Alias Alias="HasTypeDefinition">i=40</Alias>
  </Aliases>
  <UAObjectType NodeId="ns=1;i=10" BrowseName="1:ProbeType"/>
  <UAObject NodeId="ns=1;i=100" BrowseName="1:P01">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=101</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=101" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3"/>
</UANodeSet>`;

describe('buildBookFromIngest — routing', () => {
  it('reads a Control Expert CSV', () => {
    const book = buildBookFromIngest({ bookId: 'm580', format: 'csv', text: M580_STATION_CSV });
    expect(book.provenance.kind).toBe('csv');
    expect(book.entries.length).toBeGreaterThan(0);
  });

  it('reads an XVM export', () => {
    const book = buildBookFromIngest({ bookId: 'pesage', format: 'xvm', xml: M580_PESAGE_XVM });
    expect(book.provenance.kind).toBe('xvm');
    expect(book.entries.length).toBeGreaterThan(0);
  });

  it('reads a TIA SimaticML BUNDLE (documents, not a single xml)', () => {
    const book = buildBookFromIngest({
      bookId: 'four1',
      format: 'simaticml',
      documents: [{ fileName: 'DB_Echange.xml', xml: DB_ECHANGE_STANDARD_XML }]
    });
    expect(book.provenance.kind).toBe('simaticml');
    expect(book.entries.length).toBeGreaterThan(0);
  });

  it('reads an OPC UA NodeSet2', () => {
    const book = buildBookFromIngest({ bookId: 'probe', format: 'nodeset', xml: NODESET_XML });
    expect(book.provenance.kind).toBe('nodeset');
    expect(book.entries.map((entry) => entry.path)).toEqual(['P01.SampleRate']);
  });
});

describe('buildBookFromIngest — identity and provenance', () => {
  it('carries the id, the name and the source file name through', () => {
    const book = buildBookFromIngest({
      bookId: 'm580',
      name: 'M580 station',
      format: 'csv',
      file: 'variables.csv',
      text: M580_STATION_CSV,
      generatedAt: '2026-08-03T00:00:00.000Z'
    });
    expect(book.id).toBe('m580');
    expect(book.name).toBe('M580 station');
    expect(book.provenance.file).toBe('variables.csv');
    expect(book.provenance.generatedAt).toBe('2026-08-03T00:00:00.000Z');
  });

  it('keeps the declared interface for a project catalog', () => {
    const book = buildBookFromIngest({
      bookId: 'm580',
      format: 'csv',
      text: M580_STATION_CSV,
      interface: { protocol: 'modbus', connection: 'M580_Station' }
    });
    expect(book.interface).toEqual({ protocol: 'modbus', connection: 'M580_Station' });
  });

  it('DROPS the interface for a NodeSet2 — its namespace indices are file-local', () => {
    const book = buildBookFromIngest({
      bookId: 'probe',
      format: 'nodeset',
      xml: NODESET_XML,
      interface: { protocol: 'opcua', connection: 'Probe_Server' }
    });
    expect(book.interface).toBeUndefined();
  });
});

describe('buildBookFromIngest — refusals', () => {
  it('names the missing field rather than returning an empty book', () => {
    expect(() => buildBookFromIngest({ bookId: 'x', format: 'csv' })).toThrow(/text/);
    expect(() => buildBookFromIngest({ bookId: 'x', format: 'xvm' })).toThrow(/xml/);
    expect(() => buildBookFromIngest({ bookId: 'x', format: 'nodeset' })).toThrow(/xml/);
    expect(() => buildBookFromIngest({ bookId: 'x', format: 'simaticml' })).toThrow(/documents/);
  });

  it('refuses an empty SimaticML bundle (a picked-nothing file field)', () => {
    expect(() => buildBookFromIngest({ bookId: 'x', format: 'simaticml', documents: [] })).toThrow(/documents/);
  });

  it('refuses an unknown format instead of guessing one', () => {
    expect(() => buildBookFromIngest({ bookId: 'x', format: 'json' as never, text: 'x' })).toThrow(/json/);
  });
});
